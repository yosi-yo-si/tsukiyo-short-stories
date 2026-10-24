const SYNC = 'sync-notion.yml';
const DEPLOY = 'deploy-cloudflare.yml';
const ACTIVE = new Set(['queued', 'in_progress', 'waiting', 'pending', 'requested']);
const HOUR = 3600000;

async function jsonRequest(url, init = {}) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Upstream HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}

export function githubRequest(env, path, init = {}) {
  return jsonRequest(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/${path}`, {
    ...init, headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'tsukiyo-sync-monitor',
      'Content-Type': 'application/json', ...init.headers
    }
  });
}

// KV is only for alert suppression and cooldown, never the publication lock.
// GitHub concurrency and the sync's stable page ID/path mapping protect publication.
export async function setIncident(env, key, text, active = true) {
  const storageKey = `incident:${key}`;
  const existing = await env.STATE.get(storageKey);
  if (!active) {
    if (existing) await env.STATE.delete(storageKey);
    return;
  }
  if (existing) return;
  if (!env.ALERT_WEBHOOK_URL) throw new Error('ALERT_WEBHOOK_URL is not configured');
  const response = await fetch(env.ALERT_WEBHOOK_URL, {
    method: 'POST', signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text })
  });
  if (!response.ok) throw new Error(`Alert delivery HTTP ${response.status}`);
  // Only suppress an alert after delivery succeeds. No automatic expiry for unresolved holds.
  await env.STATE.put(storageKey, 'active');
}

export async function recordReport(env, payload) {
  const { kind = 'sync', run_id: runId, attempt, result, report } = payload;
  if (!['sync', 'deploy'].includes(kind) || !/^\d+$/.test(String(runId))
    || !Number.isInteger(attempt) || attempt < 1
    || !['success', 'failure', 'cancelled', 'skipped'].includes(result)) {
    throw new Error('Invalid report envelope');
  }
  const link = `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${runId}`;
  const order = `${String(runId).padStart(24, '0')}:${String(attempt).padStart(8, '0')}`;
  const previous = await env.STATE.get(`last-report:${kind}`, 'json');
  if (previous && previous.order > order) return; // Ignore late callbacks from older runs.
  if (kind === 'sync') {
    const valid = report && ['prepared', 'nothing', 'held_only', 'fatal'].includes(report.status)
      && Array.isArray(report.held) && report.held.every(x => x.notionPageId && x.reason_code);
    await setIncident(env, 'missing-report', `同期レポートがありません、または不正です。 ${link}`, !valid);
    if (valid) {
      await setIncident(env, 'sync-fatal', `同期が全体停止しました [${report.fatal?.reason_code ?? 'UNEXPECTED'}] ${link}`, report.status === 'fatal');
      const keys = [...new Set(report.held.map(x => `${x.notionPageId}:${x.reason_code}`))];
      for (const key of keys) await setIncident(env, `held:${key}`, `作品を保留しました [${key}] ${link}`);
      // A failed/partial fetch cannot prove a previous hold has been resolved.
      if (result === 'success' && report.status !== 'fatal') {
        const oldKeys = JSON.parse(await env.STATE.get('held-keys') || '[]');
        for (const key of oldKeys) if (!keys.includes(key)) await setIncident(env, `held:${key}`, '', false);
        await env.STATE.put('held-keys', JSON.stringify(keys));
      }
    }
  }
  await setIncident(env, `${kind}-run-failed`, `${kind === 'sync' ? '同期' : '本番配信'}ジョブが ${result} で終了しました。 ${link}`, result !== 'success');
  await env.STATE.put(`last-report:${kind}`, JSON.stringify({ order, at: Date.now(), result }));
}

export async function approvedExists(env) {
  const result = await jsonRequest(`https://api.notion.com/v1/data_sources/${env.NOTION_DATA_SOURCE_ID}/query`, {
    method: 'POST', headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`, 'Notion-Version': env.NOTION_VERSION,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ page_size: 1, filter: { and: [
      { property: '公開状態', select: { equals: '公開承認' } },
      { property: '公開先', select: { equals: env.PUBLISH_TARGET } }
    ] } })
  });
  if (!Array.isArray(result.results)) throw new Error('Invalid Notion query response');
  return result.results.length > 0;
}

export async function tick(env, { now = Date.now(), api = githubRequest, approved = approvedExists } = {}) {
  if (!env.STATE || !env.GITHUB_TOKEN || !env.NOTION_TOKEN || !env.MONITOR_TOKEN || !env.ALERT_WEBHOOK_URL) {
    throw new Error('Monitor secrets or STATE binding are missing');
  }
  let startedAt = Number(await env.STATE.get('started-at') || 0);
  if (!startedAt) {
    startedAt = now;
    await env.STATE.put('started-at', String(now));
  }
  for (const workflow of [SYNC, DEPLOY]) {
    // An active run may be older than the latest page of completed runs.
    const active = [];
    for (const status of ['queued', 'in_progress', 'waiting', 'pending', 'requested']) {
      const data = await api(env, `actions/workflows/${workflow}/runs?branch=main&status=${status}&per_page=100`);
      active.push(...data.workflow_runs);
    }
    const latest = await api(env, `actions/workflows/${workflow}/runs?branch=main&per_page=1`);
    const run = latest.workflow_runs[0];
    const stuck = active.some(x => now - Date.parse(x.created_at) > HOUR);
    const lastReport = await env.STATE.get(`last-report:${workflow === SYNC ? 'sync' : 'deploy'}`, 'json');
    await setIncident(env, `${workflow}-stuck`, `${workflow} が1時間以上待機・実行中です。`, stuck);
    const failed = run?.status === 'completed' && !['success', 'skipped'].includes(run.conclusion);
    await setIncident(env, `${workflow === SYNC ? 'sync' : 'deploy'}-run-failed`, `${workflow} が ${run?.conclusion} で終了しました。 ${run?.html_url ?? ''}`, failed);
    // Catches cancellations, runner loss, checkout failure, and callback delivery failure.
    const missing = run?.status === 'completed' && Date.parse(run.updated_at) >= startedAt
      && now - Date.parse(run.updated_at) > 1800000
      && (!lastReport || lastReport.order < `${String(run.id).padStart(24, '0')}:${String(run.run_attempt || 1).padStart(8, '0')}`);
    await setIncident(env, `${workflow}-callback-missing`, `${workflow} の監視レポートが30分以上届いていません。 ${run?.html_url ?? ''}`, Boolean(missing));
    if (workflow === SYNC) {
      const hasApproved = await approved(env);
      const pendingSince = Number(await env.STATE.get('pending-since') || now);
      if (hasApproved) {
        if (!await env.STATE.get('pending-since')) await env.STATE.put('pending-since', String(now));
      } else if (await env.STATE.get('pending-since')) await env.STATE.delete('pending-since');
      const idle = hasApproved && now - pendingSince > 2 * HOUR
        && (!lastReport || now - lastReport.at > 2 * HOUR);
      await setIncident(env, 'sync-silent', '公開承認作品がありますが、同期レポートが2時間以上届いていません。', idle);
      const lastDispatch = Number(await env.STATE.get('last-dispatch') || 0);
      if (hasApproved && !active.some(x => ACTIVE.has(x.status)) && now - lastDispatch > 10 * 60000) {
        await api(env, `actions/workflows/${SYNC}/dispatches`, { method: 'POST', body: JSON.stringify({ ref: 'main' }) });
        await env.STATE.put('last-dispatch', String(now));
      }
    }
  }
}

export default {
  async scheduled(_event, env) {
    try {
      await tick(env);
      await setIncident(env, 'monitor-failed', '', false);
    } catch (error) {
      console.error('Monitor failed:', error.message);
      await setIncident(env, 'monitor-failed', `同期監視に失敗しました: ${error.message}`);
      throw error;
    }
  },
  async fetch(request, env) {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/report') return new Response('Not found', { status: 404 });
    if (!env.MONITOR_TOKEN || request.headers.get('Authorization') !== `Bearer ${env.MONITOR_TOKEN}`) return new Response('Unauthorized', { status: 401 });
    if (Number(request.headers.get('Content-Length') || 0) > 262144) return new Response('Too large', { status: 413 });
    const body = await request.text();
    if (body.length > 262144) return new Response('Too large', { status: 413 });
    let payload;
    try { payload = JSON.parse(body); } catch { return new Response('Invalid JSON', { status: 400 }); }
    await recordReport(env, payload);
    return new Response('OK');
  }
};

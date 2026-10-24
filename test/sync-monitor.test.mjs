import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { recordReport, tick, latestApprovedEdit } from '../worker/index.mjs';

function fixture() {
  const values = new Map(), alerts = [];
  const env = {
    GITHUB_REPOSITORY: 'owner/blog', GITHUB_TOKEN: 'fake', NOTION_TOKEN: 'fake',
    MONITOR_TOKEN: 'secret', ALERT_WEBHOOK_URL: 'https://example.invalid/alert',
    STATE: {
      async get(key, type) { const value = values.get(key) ?? null; return value && type === 'json' ? JSON.parse(value) : value; },
      async put(key, value) { values.set(key, value); },
      async delete(key) { values.delete(key); }
    }
  };
  return { env, values, alerts };
}
async function withAlerts(fn) {
  const f = fixture(), original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => { f.alerts.push(JSON.parse(init.body)); return new Response('OK'); };
  try { await fn(f); } finally { globalThis.fetch = original; }
}
const held = { notionPageId: 'page-1', reason_code: 'EMPTY_TITLE' };
const envelope = (run, entries = [], status = 'held_only', result = 'success') => ({
  run_id: String(run), attempt: 1, result,
  report: { status, ran_at: '2026-10-24T15:00:10.000Z', held: entries, prepared: [], fatal: status === 'fatal' ? { reason_code: 'NOTION_FETCH_FAILED' } : null }
});

test('mixed prepared/held reports notify, suppress repeats, and notify a resolved recurrence', async () => withAlerts(async ({ env, alerts }) => {
  await recordReport(env, envelope(1, [held], 'prepared'));
  await recordReport(env, envelope(2, [held]));
  assert.equal(alerts.length, 1);
  await recordReport(env, envelope(3, [], 'nothing'));
  await recordReport(env, envelope(4, [held]));
  assert.equal(alerts.length, 2);
}));

test('fatal fetch and delayed callbacks do not clear existing holds', async () => withAlerts(async ({ env, alerts }) => {
  await recordReport(env, envelope(2, [held]));
  await recordReport(env, envelope(3, [], 'fatal', 'failure'));
  await recordReport(env, envelope(1, [], 'nothing'));
  await recordReport(env, envelope(4, [held]));
  assert.equal(alerts.filter(x => x.text.includes('作品を保留')).length, 1);
}));

test('missing reports and downstream workflow failures are detected separately', async () => withAlerts(async ({ env, alerts }) => {
  await recordReport(env, { ...envelope(1), report: null, result: 'failure' });
  assert.ok(alerts.some(x => x.text.includes('レポートがありません')));
  await recordReport(env, envelope(2, [], 'prepared', 'failure'));
  assert.ok(alerts.some(x => x.text.includes('ジョブが failure')));
  await recordReport(env, { ...envelope(3), kind: 'deploy', report: null, result: 'failure' });
  assert.ok(alerts.some(x => x.text.includes('本番配信')));
}));

test('report callback requires authentication and has no public trigger route', async () => {
  const { env } = fixture();
  assert.equal((await worker.fetch(new Request('https://example.invalid/report', { method: 'POST' }), env)).status, 401);
  assert.equal((await worker.fetch(new Request('https://example.invalid/run'), env)).status, 404);
});

test('dispatches main only when approved work exists and no run is active; cooldown is enforced', async () => withAlerts(async ({ env }) => {
  const calls = []; let active = false;
  const api = async (_env, path, init) => {
    if (init?.method === 'POST') { calls.push(JSON.parse(init.body)); return null; }
    return { workflow_runs: active && path.includes('sync-notion') && path.includes('status=queued')
      ? [{ status: 'queued', created_at: new Date(1000000).toISOString() }] : [] };
  };
  await tick(env, { now: 1000000, api, approved: async () => null });
  assert.equal(calls.length, 0);
  active = true;
  await tick(env, { now: 1000000, api, approved: async () => 999000 });
  assert.equal(calls.length, 0);
  active = false;
  await tick(env, { now: 1000000, api, approved: async () => 999000 });
  await tick(env, { now: 1001000, api, approved: async () => 999000 });
  assert.deepEqual(calls, [{ ref: 'main' }]);
}));

test('watchdog detects stalled runs and absent callbacks, without warning for pre-install runs', async () => withAlerts(async ({ env, values, alerts }) => {
  const now = 20000000;
  values.set('started-at', String(now - 7200000));
  const api = async (_env, path) => ({ workflow_runs: path.includes('status=in_progress')
    ? [{ status: 'in_progress', created_at: new Date(now - 7200000).toISOString() }]
    : path.includes('per_page=1') ? [{ id: 7, run_attempt: 1, status: 'completed', conclusion: 'success', updated_at: new Date(now - 3600000).toISOString() }] : [] });
  await tick(env, { now, api, approved: async () => null });
  assert.ok(alerts.some(x => x.text.includes('1時間以上')));
  assert.ok(alerts.some(x => x.text.includes('30分以上')));
}));

test('failed notification delivery is retried rather than marked sent', async () => {
  const { env, values } = fixture(), original = globalThis.fetch;
  globalThis.fetch = async () => new Response('failure', { status: 503 });
  try {
    await assert.rejects(recordReport(env, envelope(1, [held])), /Alert delivery/);
    assert.equal(values.has('incident:held:page-1:EMPTY_TITLE'), false);
  } finally { globalThis.fetch = original; }
});

test('Notion query selects the most recently edited approved page; empty and invalid timestamps differ', async () => {
  const { env } = fixture(), original = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(init.body);
      assert.deepEqual(body.sorts, [{ timestamp: 'last_edited_time', direction: 'descending' }]);
      assert.equal(body.page_size, 1);
      assert.equal(body.filter.and[0].select.equals, '公開承認');
      return Response.json({ results: [{ last_edited_time: '2026-10-24T14:00:00Z' }] });
    };
    assert.equal(await latestApprovedEdit(env), Date.parse('2026-10-24T14:00:00Z'));
    globalThis.fetch = async () => Response.json({ results: [] });
    assert.equal(await latestApprovedEdit(env), null);
    globalThis.fetch = async () => Response.json({ results: [{}] });
    await assert.rejects(latestApprovedEdit(env), /Invalid approved/);
  } finally { globalThis.fetch = original; }
});

test('unchanged held approvals stay idle; editing a hold resumes sync without consuming it at dispatch', async () => withAlerts(async ({ env, values, alerts }) => {
  const start = Date.parse('2026-10-24T15:00:10Z');
  await recordReport(env, envelope(1, [held]));
  assert.equal(Number(values.get('last-successful-sync-start')), start);
  const dispatches = [];
  const api = async (_env, path, init) => {
    if (init?.method === 'POST') dispatches.push(path);
    return { workflow_runs: [] };
  };
  values.set('pending-since', String(start - 3 * 3600000));
  await tick(env, { now: start + 3 * 3600000, api, approved: async () => start - 1000 });
  assert.equal(dispatches.length, 0);
  assert.equal(values.has('pending-since'), false);
  assert.ok(!alerts.some(x => x.text.includes('2時間以上')));
  await tick(env, { now: start + 3 * 3600000 + 900000, api, approved: async () => start + 1000 });
  assert.equal(dispatches.length, 1);
  assert.equal(Number(values.get('last-successful-sync-start')), start);
}));

test('failure, fatal, missing reports and requested retries cannot advance the successful-sync watermark', async () => withAlerts(async ({ env, values, alerts }) => {
  for (const [run, data] of [
    [1, envelope(1, [], 'prepared', 'failure')],
    [2, envelope(2, [], 'fatal')],
    [3, { ...envelope(3), report: null }],
    [4, { ...envelope(4, [], 'prepared'), sync_outcome: 'retry_requested' }]
  ]) {
    await recordReport(env, data);
    assert.equal(values.has('last-successful-sync-start'), false, `run ${run}`);
  }
  const count = alerts.length;
  await recordReport(env, { ...envelope(5, [], 'prepared'), sync_outcome: 'retry_requested' });
  assert.equal(alerts.length, count);
  await recordReport(env, envelope(6, [], 'nothing'));
  assert.equal(Number(values.get('last-successful-sync-start')), Date.parse('2026-10-24T15:00:10Z'));
}));

test('edits during synchronization and equal timestamps are rechecked, regardless of callback time', async () => withAlerts(async ({ env }) => {
  const start = Date.parse('2026-10-24T15:00:10Z');
  await recordReport(env, envelope(1, [], 'prepared'));
  const calls = [];
  const api = async (_env, _path, init) => { if (init?.method === 'POST') calls.push(init); return { workflow_runs: [] }; };
  await tick(env, { now: start + 900000, api, approved: async () => start + 10000 });
  assert.equal(calls.length, 1);
  await tick(env, { now: start + 1800000, api, approved: async () => start });
  assert.equal(calls.length, 2);
}));

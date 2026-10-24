import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { recordReport, tick } from '../worker/index.mjs';

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
  report: { status, held: entries, prepared: [], fatal: status === 'fatal' ? { reason_code: 'NOTION_FETCH_FAILED' } : null }
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
  await tick(env, { now: 1000000, api, approved: async () => false });
  assert.equal(calls.length, 0);
  active = true;
  await tick(env, { now: 1000000, api, approved: async () => true });
  assert.equal(calls.length, 0);
  active = false;
  await tick(env, { now: 1000000, api, approved: async () => true });
  await tick(env, { now: 1001000, api, approved: async () => true });
  assert.deepEqual(calls, [{ ref: 'main' }]);
}));

test('watchdog detects stalled runs and absent callbacks, without warning for pre-install runs', async () => withAlerts(async ({ env, values, alerts }) => {
  const now = 20000000;
  values.set('started-at', String(now - 7200000));
  const api = async (_env, path) => ({ workflow_runs: path.includes('status=in_progress')
    ? [{ status: 'in_progress', created_at: new Date(now - 7200000).toISOString() }]
    : path.includes('per_page=1') ? [{ id: 7, run_attempt: 1, status: 'completed', conclusion: 'success', updated_at: new Date(now - 3600000).toISOString() }] : [] });
  await tick(env, { now, api, approved: async () => false });
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

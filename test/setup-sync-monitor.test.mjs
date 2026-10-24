import test from 'node:test';
import assert from 'node:assert/strict';
import { deploymentConfig, ensureNamespace, validateSetup } from '../scripts/setup-sync-monitor.mjs';

const env = {
  CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_API_TOKEN: 'fake', NOTION_TOKEN: 'fake',
  SYNC_DISPATCH_TOKEN: 'fake', SYNC_MONITOR_TOKEN: 'x'.repeat(64),
  ALERT_WEBHOOK_URL: 'https://script.google.com/macros/s/example/exec', ALERT_WEBHOOK_TOKEN: 'y'.repeat(64),
  GITHUB_REPOSITORY: 'owner/blog'
};
const template = { name: 'tsukiyo-sync-monitor', triggers: { crons: ['7,22,37,52 * * * *'] }, vars: { NOTION_VERSION: 'old' } };
const config = { notionDataSourceId: 'data-source', notionVersion: '2026-03-11', publishTarget: '月夜の短編集' };
test('setup rejects missing secrets before provisioning and never accepts arbitrary mail endpoints', () => {
  validateSetup(env);
  assert.throws(() => validateSetup({ ...env, SYNC_DISPATCH_TOKEN: '' }), /SYNC_DISPATCH_TOKEN/);
  assert.throws(() => validateSetup({ ...env, ALERT_WEBHOOK_URL: 'https://example.invalid/exec' }), /Apps Script/);
});

test('namespace creation is repeatable and reuses existing state', async () => {
  const calls = [];
  const api = async (path, init) => {
    calls.push({ path, init });
    return init ? { result: { id: 'b'.repeat(32) } } : { result: [] };
  };
  assert.equal(await ensureNamespace(api), 'b'.repeat(32));
  assert.equal(calls[1].init.method, 'POST');
  assert.equal(await ensureNamespace(async () => ({ result: [{ title: 'tsukiyo-sync-monitor-state', id: 'c'.repeat(32) }] })), 'c'.repeat(32));
});

test('first deployment keeps cron off until the callback URL is configured, preserving STATE on updates', () => {
  const first = deploymentConfig(template, config, env, 'b'.repeat(32), 'account');
  assert.equal(first.enabled, false);
  assert.deepEqual(first.config.triggers.crons, []);
  assert.equal(first.config.vars.NOTION_VERSION, config.notionVersion);
  const next = deploymentConfig(template, config, { ...env, SYNC_MONITOR_URL: first.monitorUrl }, 'b'.repeat(32), 'account');
  assert.deepEqual(next.config.triggers.crons, template.triggers.crons);
  assert.deepEqual(next.config.kv_namespaces, first.config.kv_namespaces);
  assert.throws(() => deploymentConfig(template, config, { ...env, SYNC_MONITOR_URL: 'https://wrong.invalid/report' }, 'b'.repeat(32), 'account'), /differs/);
});

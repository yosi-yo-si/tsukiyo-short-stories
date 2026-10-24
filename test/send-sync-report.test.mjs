import test from 'node:test';
import assert from 'node:assert/strict';
import { sendReport } from '../scripts/send-sync-report.mjs';

test('report delivery preserves the retry outcome independently of the preparation report', async () => {
  let body;
  await sendReport({
    env: { SYNC_MONITOR_URL: 'https://example.invalid/report', SYNC_MONITOR_TOKEN: 'test',
      GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', JOB_RESULT: 'success', SYNC_OUTCOME: 'retry_requested' },
    request: async (_url, init) => { body = JSON.parse(init.body); return new Response('OK'); }
  });
  assert.equal(body.sync_outcome, 'retry_requested');
  assert.equal(body.result, 'success');
});

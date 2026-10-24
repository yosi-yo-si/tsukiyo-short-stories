import { readFile } from 'node:fs/promises';

export async function sendReport({ env = process.env, request = fetch } = {}) {
  if (!env.SYNC_MONITOR_URL || !env.SYNC_MONITOR_TOKEN) {
    console.warn('::warning::Sync monitor is not configured; inspect the run summary and artifact.');
    return;
  }
  let report = null;
  try { report = JSON.parse(await readFile('sync-report.json', 'utf8')); }
  catch { /* Report absence is reported explicitly, including checkout/import failures. */ }
  const response = await request(env.SYNC_MONITOR_URL, {
    method: 'POST', signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.SYNC_MONITOR_TOKEN}` },
    body: JSON.stringify({
      run_id: env.GITHUB_RUN_ID, attempt: Number(env.GITHUB_RUN_ATTEMPT || 1),
      kind: env.MONITOR_KIND || 'sync', result: env.JOB_RESULT, report
    })
  });
  if (!response.ok) throw new Error(`Sync monitor HTTP ${response.status}`);
}

if (process.argv[1]?.endsWith('/send-sync-report.mjs')) {
  await sendReport();
}

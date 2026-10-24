import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sendEmailAlert, validateEmailRelay } from '../worker/email-relay.mjs';

const TITLE = 'tsukiyo-sync-monitor-state';

export function validateSetup(env) {
  for (const key of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'NOTION_TOKEN',
    'SYNC_DISPATCH_TOKEN', 'SYNC_MONITOR_TOKEN', 'ALERT_WEBHOOK_URL', 'ALERT_WEBHOOK_TOKEN', 'GITHUB_REPOSITORY']) {
    if (!env[key]) throw new Error(`Required secret is missing: ${key}`);
  }
  if (!/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID)) throw new Error('Invalid Cloudflare account ID');
  if (env.SYNC_MONITOR_TOKEN.length < 32) throw new Error('SYNC_MONITOR_TOKEN must have at least 32 characters');
  validateEmailRelay(env);
}

export function cloudflareClient(env, request = fetch) {
  return async (path, init = {}) => {
    const response = await request(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/${path}`, {
      ...init, signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' }
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.success !== true) {
      throw new Error(`Cloudflare HTTP ${response.status}; check Workers Scripts / Workers KV Storage permissions`);
    }
    return body;
  };
}

export async function ensureNamespace(api) {
  for (let page = 1; page <= 100; page++) {
    const data = await api(`storage/kv/namespaces?per_page=100&page=${page}`);
    if (!Array.isArray(data.result)) throw new Error('Invalid Cloudflare namespace list');
    const match = data.result.find(item => item.title === TITLE);
    if (match) return match.id;
    if (data.result.length < 100) {
      const created = await api('storage/kv/namespaces', { method: 'POST', body: JSON.stringify({ title: TITLE }) });
      if (!created.result?.id) throw new Error('Cloudflare did not return a namespace ID');
      return created.result.id;
    }
  }
  throw new Error('Namespace pagination limit reached');
}

export function deploymentConfig(template, config, env, namespaceId, subdomain) {
  if (!/^[a-f0-9]{32}$/i.test(namespaceId) || !/^[a-z0-9-]+$/i.test(subdomain || '')) {
    throw new Error('Invalid namespace ID or workers.dev subdomain');
  }
  const monitorUrl = `https://${template.name}.${subdomain}.workers.dev/report`;
  if (env.SYNC_MONITOR_URL && env.SYNC_MONITOR_URL !== monitorUrl) throw new Error('SYNC_MONITOR_URL differs from the deployed Worker URL');
  const enabled = env.SYNC_MONITOR_URL === monitorUrl;
  return { monitorUrl, enabled, config: {
    ...template, account_id: env.CLOUDFLARE_ACCOUNT_ID, workers_dev: true,
    kv_namespaces: [{ binding: 'STATE', id: namespaceId }],
    triggers: { ...template.triggers, crons: enabled ? template.triggers.crons : [] },
    vars: { ...template.vars,
      GITHUB_REPOSITORY: env.GITHUB_REPOSITORY,
      NOTION_DATA_SOURCE_ID: config.notionDataSourceId,
      NOTION_VERSION: config.notionVersion, PUBLISH_TARGET: config.publishTarget
    }
  } };
}

export async function setup(env = process.env) {
  validateSetup(env);
  // Verify credentials and external prerequisites before creating any resources.
  const authResponse = await fetch(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/actions/workflows/sync-notion.yml`, {
    headers: { Authorization: `Bearer ${env.SYNC_DISPATCH_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'tsukiyo-monitor-setup' },
    signal: AbortSignal.timeout(20000)
  });
  if (!authResponse.ok) throw new Error('GitHub dispatch token cannot read the sync workflow');
  const api = cloudflareClient(env);
  const domain = await api('workers/subdomain');
  if (!domain.result?.subdomain) throw new Error('Configure a workers.dev subdomain in Cloudflare Workers first');
  if (env.SEND_TEST_EMAIL === 'true') {
    await sendEmailAlert(env, { id: `setup-${crypto.randomUUID()}`, text: '月夜の短編集の同期・公開監視メールの接続テストです。' });
    console.log('Email relay accepted the test email.');
  }
  const namespace = await ensureNamespace(api);
  const template = JSON.parse(await readFile('worker/wrangler.jsonc', 'utf8'));
  const config = JSON.parse(await readFile('automation.config.json', 'utf8'));
  const deployment = deploymentConfig(template, config, env, namespace, domain.result.subdomain);
  await writeFile('worker/wrangler.deploy.json', JSON.stringify(deployment.config, null, 2) + '\n');
  const secretsPath = resolve(env.RUNNER_TEMP || '.', 'monitor-secrets.json');
  await writeFile(secretsPath, JSON.stringify({
    GITHUB_TOKEN: env.SYNC_DISPATCH_TOKEN, NOTION_TOKEN: env.NOTION_TOKEN,
    MONITOR_TOKEN: env.SYNC_MONITOR_TOKEN, ALERT_WEBHOOK_URL: env.ALERT_WEBHOOK_URL,
    ALERT_WEBHOOK_TOKEN: env.ALERT_WEBHOOK_TOKEN
  }), { mode: 0o600 });
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY,
    `## Worker setup\n\n- Callback URL: ${deployment.monitorUrl}\n- Cron: ${deployment.enabled ? 'enabled after deployment' : 'disabled until SYNC_MONITOR_URL is configured'}\n\n` +
    (deployment.enabled ? 'Check deployment success below.\n' : 'Add SYNC_MONITOR_URL as an Actions variable (or secret), then run this workflow again to enable cron.\n'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await setup();

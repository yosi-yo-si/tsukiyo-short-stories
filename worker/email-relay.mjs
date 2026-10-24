export function isEmailRelay(url) {
  try { return new URL(url).hostname === 'script.google.com'; } catch { return false; }
}

export function validateEmailRelay(env) {
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(env.ALERT_WEBHOOK_URL || '')) {
    throw new Error('Email relay must be an Apps Script /exec URL');
  }
  if ((env.ALERT_WEBHOOK_TOKEN || '').length < 32) throw new Error('Email relay token is missing or too short');
}

export async function sendEmailAlert(env, { id, text }, request = fetch) {
  validateEmailRelay(env);
  const response = await request(env.ALERT_WEBHOOK_URL, {
    method: 'POST', redirect: 'follow', signal: AbortSignal.timeout(30000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, text, token: env.ALERT_WEBHOOK_TOKEN })
  });
  // Apps Script can return HTTP 200 for an application error or a sign-in page.
  const receipt = await response.json().catch(() => null);
  if (!response.ok || receipt?.ok !== true || receipt.id !== id) {
    throw new Error('Email relay did not confirm delivery');
  }
}

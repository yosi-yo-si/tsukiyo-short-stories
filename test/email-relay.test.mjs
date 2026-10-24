import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { sendEmailAlert } from '../worker/email-relay.mjs';
import { setIncident } from '../worker/index.mjs';

const env = { ALERT_WEBHOOK_URL: 'https://script.google.com/macros/s/test-deployment/exec', ALERT_WEBHOOK_TOKEN: 'x'.repeat(64) };
const source = await readFile(new URL('../email-relay/Code.gs', import.meta.url), 'utf8');
function relay() {
  const values = new Map([['ALERT_TOKEN', env.ALERT_WEBHOOK_TOKEN], ['ALERT_TO', 'owner@example.invalid']]);
  const messages = [];
  const context = vm.createContext({
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => values.get(key) ?? null, setProperty: (key, value) => values.set(key, value) }) },
    MailApp: { getRemainingDailyQuota: () => 100, sendEmail: message => messages.push(message) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: body => ({ body, setMimeType() { return this; } }) }
  });
  vm.runInContext(source, context);
  const post = data => JSON.parse(context.doPost({ postData: { contents: JSON.stringify(data) } }).body);
  return { values, messages, post };
}

test('email relay authenticates and ignores request-supplied recipients', () => {
  const { post, messages } = relay();
  const data = { id: 'delivery-id-123456', token: env.ALERT_WEBHOOK_TOKEN, text: 'sync held', to: 'attacker@example.invalid' };
  assert.equal(post({ ...data, token: 'wrong' }).ok, false);
  assert.equal(messages.length, 0);
  assert.deepEqual(post(data), { ok: true, id: data.id });
  assert.equal(messages[0].to, 'owner@example.invalid');
});

test('email relay suppresses duplicate delivery IDs and caps daily mail', () => {
  const { post, messages } = relay();
  const data = { id: 'delivery-id-123456', token: env.ALERT_WEBHOOK_TOKEN, text: 'sync held' };
  post(data); post(data);
  assert.equal(messages.length, 1);
  for (let i = 1; i <= 19; i++) assert.equal(post({ ...data, id: `delivery-id-123456-${i}` }).ok, true);
  assert.equal(post({ ...data, id: 'delivery-id-over-limit' }).error, 'DAILY_LIMIT');
  assert.equal(messages.length, 20);
});

test('an HTTP 200 error or login page is not a delivery receipt', async () => {
  for (const response of [Response.json({ ok: false }), new Response('<html>Sign in</html>')]) {
    await assert.rejects(sendEmailAlert(env, { id: 'delivery-id-123456', text: 'test' }, async () => response), /did not confirm/);
  }
  await assert.rejects(sendEmailAlert({ ...env, ALERT_WEBHOOK_TOKEN: '' }, { id: 'delivery-id-123456', text: 'test' }), /token/);
});

test('worker reuses the receipt ID after delivery failure and renews it on recurrence', async () => {
  const values = new Map(), ids = [], original = globalThis.fetch;
  const settings = { ...env, STATE: {
    get: async key => values.get(key) ?? null,
    put: async (key, value) => values.set(key, value),
    delete: async key => values.delete(key)
  } };
  let fail = true;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body); ids.push(body.id);
    assert.equal(body.token, env.ALERT_WEBHOOK_TOKEN);
    return Response.json(fail ? { ok: false } : { ok: true, id: body.id });
  };
  try {
    await assert.rejects(setIncident(settings, 'held:page:EMPTY_TITLE', 'test'), /did not confirm/);
    assert.equal(values.has('incident:held:page:EMPTY_TITLE'), false);
    fail = false;
    await setIncident(settings, 'held:page:EMPTY_TITLE', 'test');
    await setIncident(settings, 'held:page:EMPTY_TITLE', 'test');
    assert.equal(ids.length, 2); assert.equal(ids[0], ids[1]);
    await setIncident(settings, 'held:page:EMPTY_TITLE', '', false);
    await setIncident(settings, 'held:page:EMPTY_TITLE', 'test');
    assert.notEqual(ids[1], ids[2]);
  } finally { globalThis.fetch = original; }
});

// Deploy as a Web app: execute as yourself, access Anyone. No time triggers.
// Recipient and secrets live only in Script Properties, never in requests or source.
function initializeRelay() {
  const properties = PropertiesService.getScriptProperties();
  const address = Session.getEffectiveUser().getEmail();
  if (!address) throw new Error('Googleアカウントを確認できません。');
  if (!properties.getProperty('ALERT_TO')) properties.setProperty('ALERT_TO', address);
  for (const name of ['ALERT_TOKEN', 'MONITOR_TOKEN']) {
    if (!properties.getProperty(name)) properties.setProperty(name, Utilities.getUuid() + Utilities.getUuid());
  }
  console.log('初期設定完了。プロジェクト設定のスクリプトプロパティで宛先とトークンを確認してください。');
}

function sameToken_(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

function json_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  let input;
  try {
    const raw = e && e.postData && e.postData.contents;
    if (!raw || raw.length > 16000) return json_({ ok: false, error: 'INVALID_REQUEST' });
    input = JSON.parse(raw);
  } catch (_) { return json_({ ok: false, error: 'INVALID_REQUEST' }); }
  const properties = PropertiesService.getScriptProperties();
  const token = properties.getProperty('ALERT_TOKEN');
  if (!token || token.length < 32 || !sameToken_(input.token, token)) return json_({ ok: false, error: 'UNAUTHORIZED' });
  if (typeof input.id !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(input.id)
    || typeof input.text !== 'string' || !input.text.trim() || input.text.length > 8000) {
    return json_({ ok: false, error: 'INVALID_REQUEST' });
  }
  const recipient = properties.getProperty('ALERT_TO');
  if (!recipient || !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(recipient)) return json_({ ok: false, error: 'RECIPIENT_NOT_CONFIGURED' });
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return json_({ ok: false, error: 'BUSY' });
  try {
    const now = Date.now();
    const receipts = JSON.parse(properties.getProperty('DELIVERY_RECEIPTS') || '[]')
      .filter(item => now - item.at < 48 * 3600000);
    if (receipts.some(item => item.id === input.id)) return json_({ ok: true, id: input.id });
    const day = new Date(now).toISOString().slice(0, 10);
    const counter = JSON.parse(properties.getProperty('DAILY_COUNT') || '{}');
    const count = counter.day === day ? counter.count : 0;
    if (count >= 20 || MailApp.getRemainingDailyQuota() < 1) return json_({ ok: false, error: 'DAILY_LIMIT' });
    MailApp.sendEmail({
      to: recipient, subject: '【月夜の短編集】同期・公開の通知', name: '月夜の短編集 監視',
      body: input.text + '\n\nこのメールは同期・公開監視から送信されました。'
    });
    receipts.push({ id: input.id, at: now });
    properties.setProperty('DELIVERY_RECEIPTS', JSON.stringify(receipts));
    properties.setProperty('DAILY_COUNT', JSON.stringify({ day: day, count: count + 1 }));
    return json_({ ok: true, id: input.id });
  } catch (_) {
    return json_({ ok: false, error: 'SEND_FAILED' });
  } finally { lock.releaseLock(); }
}

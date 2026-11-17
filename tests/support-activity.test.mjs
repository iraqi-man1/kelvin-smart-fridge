import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createSupport } from '../server/support.mjs';
import { createActivity } from '../server/activity.mjs';
import { createJsonStore } from '../server/store.mjs';

const store = () => createJsonStore(path.join(tmpdir(), `kelvin-support-${Math.random()}`));
const ali = { id: 'u1', name: 'Ali', email: 'ali@example.test', role: 'viewer', createdAt: Date.UTC(2026, 10, 1) };

/** Telegram stand-in: records each message. */
function fakeTelegram(ok = true) {
  const sent = [];
  const fetchImpl = async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return { ok, status: ok ? 200 : 401 }; };
  return { sent, fetchImpl };
}

test('IT reports go to the IT bot, are kept, and the token never comes back', async () => {
  const tg = fakeTelegram();
  const s = createSupport({ store: store(), env: {}, fetchImpl: tg.fetchImpl, now: () => Date.UTC(2026, 10, 17, 9, 30) });
  await assert.rejects(s.report(ali, { category: 'fault', message: 'The fridge screen is off' }), { code: 'support-not-configured' });
  await assert.rejects(s.update({ token: 'not-a-token' }), { code: 'bad-token' });
  const config = await s.update({ token: '123456789:AAbbCCddEEffGGhhIIjjKKllMMnn', chatId: '-1001234567', lang: 'en' });
  assert.equal(config.configured, true);
  assert.equal(JSON.stringify(config).includes('AAbbCC'), false);

  await assert.rejects(s.report(ali, { message: 'hi' }), { code: 'support-too-short' });
  const ticket = await s.report(ali, { category: 'fault', message: 'The fridge screen is off' });
  assert.match(tg.sent[0].url, /bot123456789:AAbbCC.*\/sendMessage$/);
  assert.equal(tg.sent[0].body.chat_id, '-1001234567');
  assert.match(tg.sent[0].body.text, /Type: Fault/);
  assert.match(tg.sent[0].body.text, /Ali <ali@example\.test>/);
  assert.match(tg.sent[0].body.text, new RegExp(`#${ticket.id}`));
  assert.equal((await s.list(ali)).length, 1);
  assert.equal((await s.list({ id: 'someone-else' })).length, 0);
  assert.equal((await s.list({ id: 'admin' }, true))[0].email, 'ali@example.test');

  // At most 5 an hour.
  for (let i = 0; i < 4; i++) await s.report(ali, { message: `Problem number ${i}` });
  await assert.rejects(s.report(ali, { message: 'One too many' }), { code: 'support-too-many' });
});

test('a report that Telegram refuses is not kept', async () => {
  const tg = fakeTelegram(false);
  const st = store();
  const s = createSupport({ store: st, env: { IT_BOT_TOKEN: '1:x', IT_CHAT_ID: '123' }, fetchImpl: tg.fetchImpl });
  await assert.rejects(s.report(ali, { message: 'Printer on fire' }), { code: 'support-send-failed' });
  assert.equal((await s.list(ali)).length, 0);
});

test('active days, streaks and actions are counted on the server', async () => {
  const clock = { t: Date.UTC(2026, 10, 10, 12) };
  const a = createActivity({ store: store(), now: () => clock.t });
  for (let d = 0; d < 4; d++) { await a.seen('u1'); await a.seen('u1'); clock.t += 86400000; } // 4 days in a row
  clock.t += 2 * 86400000; // a gap
  await a.record('u1', 'login');
  await a.record('u1', 'export');
  await a.record('u1', 'made-up');
  const s = await a.stats(ali);
  assert.equal(s.activeDays, 5);
  assert.equal(s.bestStreak, 4);
  assert.equal(s.streak, 1);
  assert.equal(s.logins, 1);
  assert.equal(s.exports, 1);
  assert.equal(s.memberDays, 16);
  await a.forget('u1');
  assert.equal((await a.stats(ali)).activeDays, 0);
});

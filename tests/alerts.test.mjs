import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createAlerts } from '../server/alerts.mjs';

const reading = (o = {}) => ({ temperature: 25, humidity: 50, eco2: 600, tvoc: 40, deviceId: 'esp', ...o });

function setup() {
  const sent = []; let t = 0;
  const alerts = createAlerts({
    file: path.join(tmpdir(), `alerts-${Math.random()}.json`),
    env: { TELEGRAM_BOT_TOKEN: 'T', TELEGRAM_CHAT_ID: '1' },
    fetchImpl: async (url, opts) => { sent.push({ url, body: JSON.parse(opts.body) }); return { ok: true }; },
    now: () => t,
  });
  return { alerts, sent, tick: ms => { t += ms; } };
}

test('alerts once on high, stays quiet during cooldown, then notifies recovery', async () => {
  const { alerts, sent, tick } = setup();
  await alerts.check(reading());
  assert.equal(sent.length, 0);
  await alerts.check(reading({ temperature: 40 }));
  assert.equal(sent.length, 1);
  assert.match(sent[0].body.text, /ارتفعت/);
  tick(60000);
  await alerts.check(reading({ temperature: 41 }));
  assert.equal(sent.length, 1);
  await alerts.check(reading());
  assert.equal(sent.length, 2);
  assert.match(sent[1].body.text, /رجعت/);
});

test('alerts when a reading drops below the minimum', async () => {
  const { alerts, sent } = setup();
  await alerts.check(reading({ temperature: 0 }));
  assert.equal(sent.length, 1);
  assert.match(sent[0].body.text, /انخفضت/);
});

test('sends Telegram text in the language picked in the dashboard', async () => {
  const { alerts, sent } = setup();
  await alerts.update({ lang: 'en' });
  await alerts.check(reading({ eco2: 1500 }));
  assert.match(sent[0].body.text, /eCO2 rose above the limit/);
  await alerts.update({ lang: 'ms' });
  await alerts.check(reading());
  assert.match(sent[1].body.text, /kembali normal/);
});

test('sends the message the user wrote, with placeholders filled', async () => {
  const { alerts, sent } = setup();
  await alerts.update({ templates: { alert: 'Fridge: {sensor} = {value} (max {limit}) on {device} {unknown}', back: 'OK again: {sensor}' } });
  await alerts.check(reading({ temperature: 40 }));
  assert.equal(sent[0].body.text, 'Fridge: درجة الحرارة = 40 °C (max 35 °C) on esp {unknown}');
  await alerts.check(reading());
  assert.equal(sent[1].body.text, 'OK again: درجة الحرارة');
  await alerts.update({ templates: { alert: '' } });
  await alerts.check(reading({ temperature: 41 }));
  assert.match(sent[2].body.text, /ارتفعت عن الحد المسموح/);
  await assert.rejects(alerts.update({ templates: { alert: 'x'.repeat(1001) } }));
});

test('ntfy: alerts are pushed to the topic with a title and priority, next to Telegram', async () => {
  const { alerts, sent } = setup();
  await assert.rejects(alerts.update({ ntfy: { enabled: true } }), /topic/);
  await assert.rejects(alerts.update({ ntfy: { server: 'http://ntfy.example', topic: 'x' } }), /https/);
  await assert.rejects(alerts.update({ ntfy: { topic: 'has spaces' } }), /topic/);
  await alerts.update({ lang: 'en', ntfy: { enabled: true, topic: 'kelvin-fridge-a8f3k2', priority: 'urgent', token: 'tk_secret123' } });
  assert.equal(JSON.stringify(alerts.getPublic()).includes('tk_secret123'), false);
  assert.equal(alerts.getPublic().ntfy.hasToken, true);

  await alerts.check(reading({ temperature: 40 }));
  const push = sent.find(s => s.url === 'https://ntfy.sh');
  assert.ok(sent.some(s => s.url.includes('api.telegram.org')), 'Telegram still gets it');
  assert.equal(push.body.topic, 'kelvin-fridge-a8f3k2');
  assert.equal(push.body.title, 'Temperature rose above the limit');
  assert.equal(push.body.priority, 5);
  assert.deepEqual(push.body.tags, ['warning', 'kelvin']);
  assert.match(push.body.message, /Reading: 40 °C/);

  await alerts.check(reading());
  assert.deepEqual(sent.at(-1).body.tags, ['white_check_mark', 'kelvin']);
  assert.equal(sent.at(-1).body.priority, 3);
});

test('ntfy works on its own, and a failing channel does not stop the other', async () => {
  const sent = [];
  const alerts = createAlerts({
    file: path.join(tmpdir(), `alerts-${Math.random()}.json`),
    env: { TELEGRAM_BOT_TOKEN: 'T', TELEGRAM_CHAT_ID: '1' },
    fetchImpl: async (url, opts) => { sent.push({ url, body: JSON.parse(opts.body), headers: opts.headers }); return { ok: !url.includes('telegram'), status: 500 }; },
  });
  await alerts.update({ ntfy: { enabled: true, topic: 'kelvin-only', token: 'tk_abc' } });
  await alerts.check(reading({ humidity: 95 }));
  const push = sent.find(s => s.url === 'https://ntfy.sh');
  assert.ok(push, 'ntfy still got the alert');
  assert.equal(push.headers.Authorization, 'Bearer tk_abc');
  await alerts.test('ntfy');
  assert.deepEqual(sent.at(-1).body.tags, ['test_tube', 'kelvin']);
});

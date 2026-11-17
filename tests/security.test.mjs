import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { PGlite } from '@electric-sql/pglite';
import { createAccounts } from '../server/accounts.mjs';
import { createDevice } from '../server/device.mjs';
import { createMailer } from '../server/mailer.mjs';
import { browserName, createSecurity } from '../server/security.mjs';
import { bucketReadings, createJsonStore, createPostgresStore } from '../server/store.mjs';

const stores = {
  json: async () => createJsonStore(path.join(tmpdir(), `kelvin-sec-${Math.random()}`)),
  postgres: async () => { const db = new PGlite(); return createPostgresStore({ query: (t, p) => db.query(t, p) }); },
};
const mailbox = () => {
  const sent = [];
  return { sent, mailer: createMailer({}, { transport: { sendMail: async m => { sent.push(m); } } }) };
};
const EDGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

test('browser names are short and readable', () => {
  assert.equal(browserName(EDGE), 'Edge · Windows');
  assert.equal(browserName(IPHONE), 'Safari · iOS');
  assert.equal(browserName(''), 'Browser');
});

for (const [name, make] of Object.entries(stores)) {
  test(`${name}: a sign-in from a new browser emails the owner; the first sign-in and known browsers do not`, async () => {
    const store = await make();
    const mail = mailbox();
    const sec = createSecurity({ store, mailer: mail.mailer, log: () => {} });
    const user = { id: 'u1', name: 'Ali', email: 'ali@example.test', prefs: { lang: 'en' } };
    const first = await sec.signedIn(user, { deviceId: '', ip: '1.2.3.4', ua: EDGE, link: 'https://x.test' });
    assert.equal(first.isNew, false); // the account's very first browser
    assert.match(first.deviceId, /^[A-Za-z0-9_-]{20,64}$/);
    assert.equal(mail.sent.length, 0);
    assert.equal((await sec.signedIn(user, { deviceId: first.deviceId, ip: '1.2.3.4', ua: EDGE })).isNew, false);
    const phone = await sec.signedIn(user, { deviceId: '', ip: '5.6.7.8', ua: IPHONE, link: 'https://x.test' });
    assert.equal(phone.isNew, true);
    assert.equal(mail.sent.length, 1);
    assert.equal(mail.sent[0].to, 'ali@example.test');
    assert.match(mail.sent[0].subject, /New sign-in/);
    assert.match(mail.sent[0].text, /Safari · iOS/);
    assert.match(mail.sent[0].text, /5\.6\.7\.8/);
    // A made-up cookie value is not trusted as a known device.
    assert.notEqual((await sec.signedIn(user, { deviceId: 'x', ip: '1', ua: EDGE })).deviceId, 'x');

    const log = await sec.list();
    assert.deepEqual(log.map(e => e.action), ['new-device', 'login', 'new-device', 'login', 'login', 'login']);
    assert.equal(log[1].actor.email, 'ali@example.test');
    assert.equal(log[2].browser, 'Safari · iOS');
  });

  test(`${name}: the audit log keeps the newest entries first and never breaks a request`, async () => {
    const store = await make();
    const sec = createSecurity({ store, log: () => {} });
    for (let i = 0; i < 410; i++) await sec.record('login-failed', { ip: '9.9.9.9', detail: `try${i}` });
    const all = await sec.list({ limit: 1000 });
    assert.equal(all.length, 400);
    assert.equal(all[0].detail, 'try409');
    const broken = createSecurity({ store: { getSetting: async () => { throw new Error('db down'); } }, log: () => {} });
    assert.equal(await broken.record('login'), null);
  });

  test(`${name}: a replaced device key works until the device uses the new one, or for a day`, async () => {
    const store = await make();
    let t = 1_000_000;
    const d = createDevice({ store, now: () => t });
    const { key: oldKey, entry } = await d.createKey('Fridge', 'Ali');
    const { key: newKey, old } = await d.rotateKey(entry.id, 'Ali');
    assert.equal(old.id, entry.id);
    assert.notEqual(newKey, oldKey);
    assert.ok((await d.check({ 'x-device-key': oldKey })).ok, 'old key still works right after rotating');
    assert.ok((await d.check({ 'x-device-key': newKey })).ok);
    assert.equal((await d.check({ 'x-device-key': oldKey })).ok, false, 'first use of the new key ends the old one');
    assert.equal((await d.status()).keys.length, 1);

    // Never uploaded: the old key stops by itself after 24 hours.
    const again = await d.rotateKey((await d.status()).keys[0].id, 'Ali');
    t += 23 * 3600000;
    assert.ok((await d.check({ 'x-device-key': newKey })).ok);
    t += 2 * 3600000;
    assert.equal((await d.check({ 'x-device-key': newKey })).ok, false);
    assert.ok((await d.check({ 'x-device-key': again.key })).ok);
    await assert.rejects(d.rotateKey('nope', 'Ali'), { code: 'no-key' });
  });

  test(`${name}: passwords sealed before VAULT_KEY was set are re-sealed with it and still readable`, async () => {
    const store = await make();
    const mail = mailbox();
    const before = createAccounts({ store, mailer: mail.mailer, vaultKey: 'postgres://old-database-address' });
    await before.register({ name: 'Ali', email: 'ali@example.test', password: 'admin-pass1' });
    const admin = (await before.listUsers())[0];
    await before.createInvite(admin, { name: 'B', email: 'b@example.test', role: 'member', password: 'given-pass1' }, 'https://x.test');
    const code = decodeURIComponent(mail.sent.at(-1).text.match(/\?invite=(\S+)/)[1]);
    const { user: b } = await before.acceptInvite({ invite: code, password: 'given-pass1' });
    const sealedBefore = (await store.getSetting('password_vault'))[b.id].sealed;

    const after = createAccounts({ store, mailer: mail.mailer, vaultKey: 'a-new-random-vault-key', oldVaultKeys: ['postgres://old-database-address'] });
    await after.ready;
    assert.equal((await after.revealPassword(b.id)).password, 'given-pass1');
    assert.notEqual((await store.getSetting('password_vault'))[b.id].sealed, sealedBefore);
    // The old key alone can no longer read it.
    const oldOnly = createAccounts({ store, vaultKey: 'postgres://old-database-address' });
    assert.notEqual((await oldOnly.revealPassword(b.id)).password, 'given-pass1');
  });

  test(`${name}: readings for another period come back averaged into slices`, async () => {
    const store = await make();
    const base = 1_700_000_000_000;
    for (let i = 0; i < 120; i++) {
      await store.insertReading({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, timestamp: base + i * 60000, temperature: i < 60 ? 4 : 8, humidity: 50, eco2: 400 + i, tvoc: 10, deviceId: 'ESP32' });
    }
    const out = await store.readingsBetween(base, base + 120 * 60000, 2);
    assert.equal(out.length, 2);
    assert.equal(out[0].temperature, 4);
    assert.equal(out[1].temperature, 8);
    assert.equal(out[0].samples + out[1].samples, 120);
    assert.ok(out[0].timestamp < out[1].timestamp);
    assert.deepEqual(await store.readingsBetween(base - 7200000, base - 3600000, 10), []);
  });
}

test('bucketReadings leaves empty slices out', () => {
  const r = (t, v) => ({ timestamp: t, temperature: v, humidity: v, eco2: v, tvoc: v });
  const out = bucketReadings([r(0, 1), r(5, 3), r(95, 5)], 0, 100, 10);
  assert.deepEqual(out.map(o => [o.temperature, o.samples]), [[2, 2], [5, 1]]);
});

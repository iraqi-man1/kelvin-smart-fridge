import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { PGlite } from '@electric-sql/pglite';
import { createAccounts } from '../server/accounts.mjs';
import { createMailer } from '../server/mailer.mjs';
import { createJsonStore, createPostgresStore } from '../server/store.mjs';

function fakeMail() {
  const sent = [];
  const mailer = createMailer({}, { transport: { sendMail: async m => { sent.push(m); } } });
  return { mailer, sent, lastCode: () => sent.at(-1).text.match(/(\d{3}) (\d{3})/).slice(1).join('') };
}
const stores = {
  json: async () => createJsonStore(path.join(tmpdir(), `kelvin-reset-${Math.random()}`)),
  postgres: async () => { const db = new PGlite(); return createPostgresStore({ query: (t, p) => db.query(t, p) }); },
};

for (const [name, make] of Object.entries(stores)) {
  test(`${name}: a forgotten password is reset with the emailed code; old sessions end`, async () => {
    const mail = fakeMail();
    const store = await make();
    const a = createAccounts({ store, mailer: mail.mailer });
    const { token: oldSession } = await a.register({ name: 'Ali', email: 'ali@example.test', password: 'old-password' });

    const req = await a.requestReset({ email: 'ALI@example.test ', lang: 'en' });
    assert.equal(req.email, 'a**@example.test');
    assert.match(mail.sent.at(-1).subject, /Reset your Kelvin password/);
    await assert.rejects(a.resetPassword({ challenge: req.challenge, code: mail.lastCode(), password: 'short' }, 'k'), { code: 'weak-password' });
    await assert.rejects(a.resetPassword({ challenge: req.challenge, code: '000000', password: 'new-password' }, 'k'), { code: 'wrong-otp' });
    const done = await a.resetPassword({ challenge: req.challenge, code: mail.lastCode(), password: 'new-password' }, 'k');
    assert.ok(done.token);

    // After a restart: old password and old session are gone, the new password works.
    const b = createAccounts({ store, mailer: mail.mailer });
    assert.equal(await b.userFor(oldSession), null);
    assert.ok(await b.userFor(done.token));
    await assert.rejects(b.login({ email: 'ali@example.test', password: 'old-password' }, 'x'), { code: 'bad-credentials' });
    assert.ok((await b.login({ email: 'ali@example.test', password: 'new-password' }, 'x')).token);
  });

  test(`${name}: settings saved to the account come back on another device`, async () => {
    const store = await make();
    const a = createAccounts({ store });
    const { token } = await a.register({ name: 'Ali', email: 'ali@example.test', password: 'account-pass' });
    const user = await a.userFor(token);
    await a.savePrefs(user, { settings: { deviceName: 'Fridge A', currency: 'IQD', tariff: 10 }, lang: 'en' });
    await a.savePrefs(user, { theme: 'dark', lock: { hidden: '60', idle: 5 } });

    const elsewhere = createAccounts({ store }); // a restart / another browser signing in
    const { user: again } = await elsewhere.login({ email: 'ali@example.test', password: 'account-pass' }, 'k');
    assert.deepEqual(again.prefs, { settings: { deviceName: 'Fridge A', currency: 'IQD', tariff: 10 }, lang: 'en', theme: 'dark', lock: { hidden: '60', idle: 5 } });
    await assert.rejects(a.savePrefs(user, { big: 'x'.repeat(17000) }), { code: 'invalid-field' });
    await assert.rejects(a.savePrefs(user, ['not', 'an', 'object']), { code: 'invalid-field' });
  });
}

test('a reset for an unknown email looks the same and sends nothing', async () => {
  const mail = fakeMail();
  const a = createAccounts({ store: await stores.json(), mailer: mail.mailer });
  const r = await a.requestReset({ email: 'nobody@example.test' });
  assert.equal(r.email, 'n*****@example.test');
  assert.ok(r.challenge);
  assert.equal(mail.sent.length, 0);
  await assert.rejects(a.resetPassword({ challenge: r.challenge, code: '123456', password: 'new-password' }, 'k'), { code: 'otp-expired' });
  await assert.rejects(createAccounts({ store: await stores.json() }).requestReset({ email: 'a@b.co' }), { code: 'email-not-configured' });
});

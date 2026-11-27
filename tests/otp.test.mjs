import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { PGlite } from '@electric-sql/pglite';
import { createAccounts } from '../server/accounts.mjs';
import { createMailer, codeEmail } from '../server/mailer.mjs';
import { createJsonStore, createPostgresStore } from '../server/store.mjs';
import { signUp } from './signup.mjs';

/** A mailbox instead of SMTP: every email lands in `sent`. */
function fakeMail() {
  const sent = [];
  const mailer = createMailer({}, { transport: { sendMail: async m => { sent.push(m); } } });
  const lastCode = () => sent.at(-1).text.match(/(\d{3}) (\d{3})/).slice(1).join('');
  return { mailer, sent, lastCode };
}
const stores = {
  json: async () => createJsonStore(path.join(tmpdir(), `kelvin-otp-${Math.random()}`)),
  postgres: async () => { const db = new PGlite(); return createPostgresStore({ query: (t, p) => db.query(t, p) }); },
};

async function userWithOtp(store, mail, clock) {
  const a = createAccounts({ store, mailer: mail.mailer, now: () => clock.t });
  const { token } = await signUp(a, { name: 'Ali', email: 'ali.ahmed@example.test', password: 'account-pass' }, mail.sent);
  const user = await a.userFor(token);
  const start = await a.startOtp(user, 'en');
  assert.match(mail.sent.at(-1).subject, /Confirm your email/);
  await assert.rejects(a.enableOtp(user, { challenge: start.challenge, code: '000000' }, 'k'), { code: 'wrong-otp' });
  assert.equal((await a.enableOtp(user, { challenge: start.challenge, code: mail.lastCode() }, 'k')).otpEmail, true);
  return a;
}

for (const [name, make] of Object.entries(stores)) {
  test(`${name}: with two-step on, the password alone opens no session; the emailed code does`, async () => {
    const mail = fakeMail(), clock = { t: 1_800_000_000_000 };
    const store = await make();
    await userWithOtp(store, mail, clock);

    // A fresh accounts object = after a server restart: the setting came from the store.
    const a = createAccounts({ store, mailer: mail.mailer, now: () => clock.t });
    const step1 = await a.login({ email: 'ali.ahmed@example.test', password: 'account-pass', lang: 'ar' }, 'ip');
    assert.equal(step1.token, undefined);
    assert.equal(step1.otp.email, 'a******@example.test');
    assert.match(mail.sent.at(-1).subject, /رمز تسجيل الدخول/);
    assert.equal(mail.sent.at(-1).to, 'ali.ahmed@example.test');

    await assert.rejects(a.verifyLogin({ challenge: step1.otp.challenge, code: '111111' }, 'ip'), { code: 'wrong-otp' });
    const done = await a.verifyLogin({ challenge: step1.otp.challenge, code: mail.lastCode() }, 'ip');
    assert.ok(done.token);
    assert.equal((await a.userFor(done.token)).email, 'ali.ahmed@example.test');
    // A code works once.
    await assert.rejects(a.verifyLogin({ challenge: step1.otp.challenge, code: mail.lastCode() }, 'ip'), { code: 'otp-expired' });
  });
}

test('codes expire after 10 minutes and after 5 wrong tries', async () => {
  const mail = fakeMail(), clock = { t: 1_800_000_000_000 };
  const a = await userWithOtp(await stores.json(), mail, clock);

  const late = await a.login({ email: 'ali.ahmed@example.test', password: 'account-pass' }, 'ip1');
  const code = mail.lastCode();
  clock.t += 10 * 60000 + 1;
  await assert.rejects(a.verifyLogin({ challenge: late.otp.challenge, code }, 'ip1'), { code: 'otp-expired' });

  const tried = await a.login({ email: 'ali.ahmed@example.test', password: 'account-pass' }, 'ip2');
  for (let i = 0; i < 4; i++) await assert.rejects(a.verifyLogin({ challenge: tried.otp.challenge, code: '999999' }, 'ip2'), { code: 'wrong-otp' });
  await assert.rejects(a.verifyLogin({ challenge: tried.otp.challenge, code: '999999' }, 'ip2'), { code: 'otp-expired' });
  await assert.rejects(a.verifyLogin({ challenge: tried.otp.challenge, code: mail.lastCode() }, 'ip2'), { code: 'otp-expired' });
});

test('resending waits a minute, and the new code replaces the old one', async () => {
  const mail = fakeMail(), clock = { t: 1_800_000_000_000 };
  const a = await userWithOtp(await stores.json(), mail, clock);
  const { otp } = await a.login({ email: 'ali.ahmed@example.test', password: 'account-pass' }, 'ip');
  const first = mail.lastCode();
  await assert.rejects(a.resendCode({ challenge: otp.challenge }), { code: 'otp-wait' });
  clock.t += 61000;
  await a.resendCode({ challenge: otp.challenge });
  const second = mail.lastCode();
  if (first !== second) await assert.rejects(a.verifyLogin({ challenge: otp.challenge, code: first }, 'ip'), { code: 'wrong-otp' });
  assert.ok((await a.verifyLogin({ challenge: otp.challenge, code: second }, 'ip')).token);
});

test('turning it off needs the password; without email set up it cannot be turned on', async () => {
  const mail = fakeMail(), clock = { t: 1_800_000_000_000 };
  const a = await userWithOtp(await stores.json(), mail, clock);
  const { otp } = await a.login({ email: 'ali.ahmed@example.test', password: 'account-pass' }, 'ip');
  const { token } = await a.verifyLogin({ challenge: otp.challenge, code: mail.lastCode() }, 'ip');
  const user = await a.userFor(token);
  await assert.rejects(a.disableOtp(user, 'wrong'), { code: 'wrong-password' });
  assert.equal((await a.disableOtp(user, 'account-pass')).otpEmail, false);
  assert.ok((await a.login({ email: 'ali.ahmed@example.test', password: 'account-pass' }, 'ip')).token);

  const noMail = createAccounts({ store: await stores.json() });
  const r = await noMail.register({ name: 'B', email: 'b@example.test', password: 'account-pass' });
  const b = await noMail.userFor(r.token);
  assert.equal(noMail.publicUser(b).emailReady, false);
  await assert.rejects(noMail.startOtp(b, 'en'), { code: 'email-not-configured' });
});

test('the code email exists in three languages and carries the code', () => {
  for (const lang of ['ar', 'en', 'ms']) {
    const m = codeEmail({ code: '482913', purpose: 'login', lang, name: 'Ali' });
    assert.match(m.text, /482 913/);
    assert.match(m.html, /482 913/);
    assert.ok(m.subject.length > 5);
  }
  assert.match(codeEmail({ code: '000001', purpose: 'login', lang: 'ar' }).html, /dir="rtl"/);
});

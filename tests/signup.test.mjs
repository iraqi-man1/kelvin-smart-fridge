import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createAccounts } from '../server/accounts.mjs';
import { createMailer } from '../server/mailer.mjs';
import { createJsonStore } from '../server/store.mjs';

const mailbox = () => {
  const sent = [];
  const mailer = createMailer({}, { transport: { sendMail: async m => { sent.push(m); } } });
  return { sent, mailer, lastCode: () => sent.at(-1).text.match(/(\d{3}) (\d{3})/).slice(1).join('') };
};
const freshStore = () => createJsonStore(path.join(tmpdir(), `kelvin-signup-${Math.random()}`));

test('anyone can sign up; the account exists only after the emailed code is typed', async () => {
  const mail = mailbox(), clock = { t: 1_800_000_000_000 };
  const a = createAccounts({ store: freshStore(), mailer: mail.mailer, now: () => clock.t });

  const first = await a.register({ name: 'Ali', email: 'Ali@Example.test', password: 'admin-pass1', lang: 'en' }, 'ip1');
  assert.ok(first.otp && !first.user && !first.token, 'no session before the email is confirmed');
  assert.equal(mail.sent.at(-1).to, 'ali@example.test');
  assert.match(mail.sent.at(-1).subject, /Confirm your new Kelvin account/);
  assert.doesNotMatch(mail.sent.at(-1).text + mail.sent.at(-1).html, /admin-pass1/);
  // Not an account yet: it cannot sign in, and the address is still free.
  await assert.rejects(a.login({ email: 'ali@example.test', password: 'admin-pass1' }, 'x'), { code: 'bad-credentials' });
  assert.equal((await a.signupInfo()).firstAccount, true);

  await assert.rejects(a.verifySignup({ challenge: first.otp.challenge, code: '000000' }, 'ip1'), { code: 'wrong-otp' });
  const done = await a.verifySignup({ challenge: first.otp.challenge, code: mail.lastCode() }, 'ip1');
  assert.equal(done.user.role, 'admin', 'the first account is the admin');
  assert.ok(done.token);
  assert.equal((await a.login({ email: 'ali@example.test', password: 'admin-pass1' }, 'x')).user.email, 'ali@example.test');

  // Later accounts sign themselves up too, and start as viewers.
  const second = await a.register({ name: 'Sara', email: 'sara@example.test', password: 'viewer-pass1', lang: 'ar' }, 'ip2');
  assert.match(mail.sent.at(-1).subject, /أكّد حسابك/);
  const sara = await a.verifySignup({ challenge: second.otp.challenge, code: mail.lastCode() }, 'ip2');
  assert.equal(sara.user.role, 'viewer');
  await assert.rejects(a.register({ name: 'X', email: 'sara@example.test', password: 'another-pass' }, 'ip3'), { code: 'email-taken' });
});

test('a sign-up code can be sent again, and runs out after 10 minutes', async () => {
  const mail = mailbox(), clock = { t: 1_800_000_000_000 };
  const a = createAccounts({ store: freshStore(), mailer: mail.mailer, now: () => clock.t });
  const { otp } = await a.register({ name: 'Ali', email: 'ali@example.test', password: 'admin-pass1' }, 'ip');
  const firstCode = mail.lastCode();
  await assert.rejects(a.resendCode({ challenge: otp.challenge }), { code: 'otp-wait' });
  clock.t += 61_000;
  await a.resendCode({ challenge: otp.challenge });
  assert.equal(mail.sent.length, 2);
  assert.equal(mail.sent.at(-1).to, 'ali@example.test');
  const secondCode = mail.lastCode();
  if (secondCode !== firstCode) await assert.rejects(a.verifySignup({ challenge: otp.challenge, code: firstCode }, 'ip'), { code: 'wrong-otp' });
  clock.t += 11 * 60_000;
  await assert.rejects(a.verifySignup({ challenge: otp.challenge, code: secondCode }, 'ip'), { code: 'otp-expired' });
});

test('one address cannot send endless sign-up emails', async () => {
  const mail = mailbox();
  const a = createAccounts({ store: freshStore(), mailer: mail.mailer });
  for (let i = 0; i < 5; i++) await a.register({ name: 'X', email: `x${i}@example.test`, password: 'some-pass1' }, 'same-ip');
  await assert.rejects(a.register({ name: 'X', email: 'x9@example.test', password: 'some-pass1' }, 'same-ip'), { code: 'too-many' });
  assert.equal(mail.sent.length, 5);
  // Another address is not blocked.
  assert.ok((await a.register({ name: 'Y', email: 'y@example.test', password: 'some-pass1' }, 'other-ip')).otp);
});

test('without email set up, only the first account can be made (at once); others need email', async () => {
  const a = createAccounts({ store: freshStore() });
  assert.deepEqual(await a.signupInfo(), { firstAccount: true, open: true, emailReady: false });
  const first = await a.register({ name: 'Ali', email: 'ali@example.test', password: 'admin-pass1' }, 'ip');
  assert.equal(first.user.role, 'admin');
  await assert.rejects(a.register({ name: 'B', email: 'b@example.test', password: 'member-pass1' }, 'ip'), { code: 'email-not-configured' });
});

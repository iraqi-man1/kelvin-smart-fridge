import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createAccounts } from '../server/accounts.mjs';
import { createDevice } from '../server/device.mjs';
import { createMailer } from '../server/mailer.mjs';
import { createPostgresStore } from '../server/store.mjs';

// Online (Netlify) each request may land on a different copy of the server. These copies
// share only the database, so everything they need must be read from it.
const shared = async () => { const db = new PGlite(); return createPostgresStore({ query: (t, p) => db.query(t, p) }); };

test('an emailed sign-in code made by one server copy works on another', async () => {
  const store = await shared();
  const sent = [];
  const mailer = createMailer({}, { transport: { sendMail: async m => { sent.push(m); } } });
  const code = () => sent.at(-1).text.match(/(\d{3}) (\d{3})/).slice(1).join('');
  const one = createAccounts({ store, mailer });
  const { token } = await one.register({ name: 'Ali', email: 'copy@example.test', password: 'account-pass' });
  const user = await one.userFor(token);
  const start = await one.startOtp(user, 'en');
  await one.enableOtp(user, { challenge: start.challenge, code: code() }, 'k');

  const two = createAccounts({ store, mailer });
  const step1 = await two.login({ email: 'copy@example.test', password: 'account-pass' }, 'ip');
  const three = createAccounts({ store, mailer });
  const done = await three.verifyLogin({ challenge: step1.otp.challenge, code: code() }, 'ip');
  // The session it opened is known to the first copy after a refresh.
  await one.refresh();
  assert.equal((await one.userFor(done.token)).email, 'copy@example.test');
});

test('failed sign-ins count across server copies', async () => {
  const store = await shared();
  const first = createAccounts({ store });
  await first.register({ name: 'Ali', email: 'lock@example.test', password: 'account-pass' });
  for (let i = 0; i < 10; i++) {
    const copy = createAccounts({ store });
    await assert.rejects(copy.login({ email: 'lock@example.test', password: 'wrong' }, 'ip9'), { code: 'bad-credentials' });
  }
  await assert.rejects(createAccounts({ store }).login({ email: 'lock@example.test', password: 'account-pass' }, 'ip9'), { code: 'too-many' });
});

test('a command queued on one server copy reaches the device through another', async () => {
  const store = await shared();
  const web = createDevice({ store });
  const cmd = await web.add('beep', 2, 'Ali');
  const ingest = createDevice({ store });
  assert.deepEqual((await ingest.deliver()).map(c => c.id), [cmd.id]);
  await createDevice({ store }).acknowledge([cmd.id]);
  await web.refresh();
  assert.equal((await web.status()).commands[0].status, 'done');
});

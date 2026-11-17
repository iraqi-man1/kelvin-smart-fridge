import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createAccounts } from '../server/accounts.mjs';

const fresh = () => createAccounts({ dir: path.join(tmpdir(), `kelvin-accounts-${Math.random()}`) });
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

test('registers, logs in and finds the user by session; passwords are not stored in plain text', async () => {
  const a = fresh();
  const { user, token } = await a.register({ name: 'Ali', email: 'Ali@Example.com ', password: 'secret-pass' });
  assert.equal(user.email, 'ali@example.com');
  assert.equal(user.password, undefined);
  assert.equal((await a.userFor(token)).name, 'Ali');
  const again = await a.login({ email: 'ali@example.com', password: 'secret-pass' });
  assert.ok(again.token && again.token !== token);
  await a.logout(token);
  assert.equal(await a.userFor(token), null);
  assert.ok(await a.userFor(again.token));
});

test('rejects bad sign-ups and wrong passwords with stable codes', async () => {
  const a = fresh();
  await a.register({ name: 'A', email: 'a@x.io', password: '12345678' });
  await assert.rejects(a.register({ name: 'B', email: 'a@x.io', password: '12345678' }), { code: 'email-taken' });
  await assert.rejects(a.register({ name: 'B', email: 'not-an-email', password: '12345678' }), { code: 'invalid-email' });
  await assert.rejects(a.register({ name: 'B', email: 'b@x.io', password: 'short' }), { code: 'weak-password' });
  await assert.rejects(a.register({ name: ' ', email: 'c@x.io', password: '12345678' }), { code: 'name-required' });
  await assert.rejects(a.login({ email: 'a@x.io', password: 'wrong-one' }), { code: 'bad-credentials' });
  await assert.rejects(a.login({ email: 'nobody@x.io', password: 'wrong-one' }), { code: 'bad-credentials' });
});

test('locks a sign-in key after repeated failures', async () => {
  const a = fresh();
  await a.register({ name: 'A', email: 'a@x.io', password: '12345678' });
  // One address guessing across many accounts: stopped after 10.
  for (let i = 0; i < 10; i++) await assert.rejects(a.login({ email: `guess${i}@x.io`, password: 'nope-nope' }, 'ip1'));
  await assert.rejects(a.login({ email: 'a@x.io', password: '12345678' }, 'ip1'), { code: 'too-many' });
  assert.ok(await a.login({ email: 'a@x.io', password: '12345678' }, 'ip2'));
});

test('locks an account after 5 wrong passwords from any address, and tells its owner once', async () => {
  const locked = [];
  const a = createAccounts({ dir: path.join(tmpdir(), `kelvin-accounts-${Math.random()}`), onLocked: async u => { locked.push(u.email); } });
  await a.register({ name: 'A', email: 'a@x.io', password: '12345678' });
  for (let i = 0; i < 5; i++) await assert.rejects(a.login({ email: 'a@x.io', password: 'nope-nope' }, `ip${i}`), { code: 'bad-credentials' });
  await assert.rejects(a.login({ email: 'a@x.io', password: '12345678' }, 'ip-new'), { code: 'too-many' });
  assert.deepEqual(locked, ['a@x.io']);
});

test('updates the profile, changes the password and signs out other sessions', async () => {
  const a = fresh();
  const { token } = await a.register({ name: 'A', email: 'a@x.io', password: '12345678' });
  const other = (await a.login({ email: 'a@x.io', password: '12345678' })).token;
  const user = await a.userFor(token);
  const updated = await a.updateProfile(user, { studentId: '22301234', university: 'USM', bio: 'IoT' });
  assert.equal(updated.studentId, '22301234');
  await assert.rejects(a.updateProfile(user, { bio: 'x'.repeat(501) }), { code: 'invalid-field' });
  await assert.rejects(a.changePassword(user, { current: 'wrong', next: 'new-password' }, token), { code: 'wrong-password' });
  await a.changePassword(user, { current: '12345678', next: 'new-password' }, token);
  assert.ok(await a.userFor(token));
  assert.equal(await a.userFor(other), null);
  assert.ok(await a.login({ email: 'a@x.io', password: 'new-password' }));
});

test('accepts only real image files as a profile photo, and deletes everything with the account', async () => {
  const a = fresh();
  const { token } = await a.register({ name: 'A', email: 'a@x.io', password: '12345678' });
  const user = await a.userFor(token);
  await assert.rejects(a.setAvatar(user, Buffer.from('<svg onload=alert(1)>')), { code: 'bad-image' });
  const withPhoto = await a.setAvatar(user, jpeg);
  assert.match(withPhoto.avatar, /^\/api\/avatar\//);
  assert.equal((await a.avatar(user.id)).type, 'image/jpeg');
  await assert.rejects(a.deleteAccount(user, 'wrong'), { code: 'wrong-password' });
  await a.deleteAccount(user, '12345678');
  assert.equal(await a.userFor(token), null);
  assert.equal(await a.avatar(user.id), null);
});

test('a locked session opens only with the right password', async () => {
  const a = fresh();
  const { token } = await a.register({ name: 'A', email: 'a@x.io', password: '12345678' });
  await a.lock(token);
  assert.equal((await a.sessionFor(token)).session.locked, true);
  await assert.rejects(a.unlock(token, { secret: 'wrong-pass' }, 'k'), { code: 'wrong-password' });
  assert.equal((await a.sessionFor(token)).session.locked, true);
  await a.unlock(token, { secret: '12345678' }, 'k');
  assert.equal((await a.sessionFor(token)).session.locked, false);
  await assert.rejects(a.lock('not-a-token'), { code: 'signed-out' });
});

test('a lock-screen PIN is separate from the account password', async () => {
  const a = fresh();
  const { token } = await a.register({ name: 'A', email: 'a@x.io', password: 'account-pass' });
  const user = await a.userFor(token);
  await assert.rejects(a.setLockCode(user, { password: 'wrong', code: '2468' }), { code: 'wrong-password' });
  await assert.rejects(a.setLockCode(user, { password: 'account-pass', code: '12' }), { code: 'weak-code' });
  assert.equal((await a.setLockCode(user, { password: 'account-pass', code: '2468' })).hasLockCode, true);
  assert.equal(JSON.stringify(user).includes('2468'), false);
  await a.lock(token);
  await assert.rejects(a.unlock(token, { method: 'code', secret: 'account-pass' }, 'k'), { code: 'wrong-code' });
  await a.unlock(token, { method: 'code', secret: '2468' }, 'k');
  await a.lock(token);
  await a.unlock(token, { method: 'password', secret: 'account-pass' }, 'k');
  assert.equal((await a.setLockCode(user, { password: 'account-pass', code: null })).hasLockCode, false);
});

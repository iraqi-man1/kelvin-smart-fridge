import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { PGlite } from '@electric-sql/pglite';
import { can, createAccounts } from '../server/accounts.mjs';
import { createDevice } from '../server/device.mjs';
import { createMailer } from '../server/mailer.mjs';
import { createJsonStore, createPostgresStore } from '../server/store.mjs';
import { signUp } from './signup.mjs';

const stores = {
  json: async () => createJsonStore(path.join(tmpdir(), `kelvin-roles-${Math.random()}`)),
  postgres: async () => { const db = new PGlite(); return createPostgresStore({ query: (t, p) => db.query(t, p) }); },
};

/** A mailbox instead of SMTP; returns the code from the newest invitation link. */
function fakeMail() {
  const sent = [];
  const mailer = createMailer({}, { transport: { sendMail: async m => { sent.push(m); } } });
  const lastInvite = () => decodeURIComponent(sent.at(-1).text.match(/\?invite=(\S+)/)[1]);
  return { mailer, sent, lastInvite };
}

for (const [name, make] of Object.entries(stores)) {
  test(`${name}: only the first account signs itself up; others join by an emailed invitation with the admin's password`, async () => {
    const store = await make();
    const mail = fakeMail();
    const a = createAccounts({ store, mailer: mail.mailer });
    assert.deepEqual(await a.signupInfo(), { firstAccount: true, open: true, emailReady: true });
    const { user: admin } = await signUp(a, { name: 'Ali', email: 'ali@example.test', password: 'admin-pass1' }, mail.sent);
    assert.equal(admin.role, 'admin');
    assert.equal((await a.signupInfo()).firstAccount, false);

    const adminUser = (await a.listUsers())[0];
    await assert.rejects(a.createInvite(adminUser, { name: 'B', email: 'b@example.test', role: 'member', password: 'short' }, 'https://x.test'), { code: 'weak-password' });
    await assert.rejects(a.createInvite(adminUser, { name: 'B', email: 'ali@example.test', role: 'member', password: 'given-pass1' }, 'https://x.test'), { code: 'email-taken' });
    const { invite } = await a.createInvite(adminUser, { name: 'B', email: 'b@example.test', role: 'member', password: 'given-pass1', lang: 'en' }, 'https://x.test');
    assert.equal(invite.password, undefined);
    assert.equal(invite.hash, undefined);
    const email = mail.sent.at(-1);
    assert.equal(email.to, 'b@example.test');
    assert.match(email.subject, /Ali invited you/);
    assert.match(email.text, /https:\/\/x\.test\/\?invite=/);
    assert.doesNotMatch(email.text + email.html, /given-pass1/); // the password is never emailed
    const code = mail.lastInvite();

    assert.deepEqual(await a.previewInvite(code), { email: 'b@example.test', name: 'B', role: 'member', by: 'Ali', expires: invite.expires });
    await assert.rejects(a.previewInvite('made-up'), { code: 'invite-invalid' });
    await assert.rejects(a.acceptInvite({ invite: code, password: 'wrong-pass1' }, 'ip'), { code: 'bad-credentials' });
    const { user: b, token } = await a.acceptInvite({ invite: code, password: 'given-pass1' }, 'ip');
    assert.equal(b.role, 'member');
    assert.equal(b.email, 'b@example.test');
    assert.ok(token);
    // One use only, and the password works for a normal sign-in afterwards.
    await assert.rejects(a.acceptInvite({ invite: code, password: 'given-pass1' }, 'ip'), { code: 'invite-invalid' });
    assert.ok((await a.login({ email: 'b@example.test', password: 'given-pass1' }, 'ip2')).token);

    // Roles survive a restart.
    const again = createAccounts({ store });
    assert.deepEqual((await again.listUsers()).map(u => u.role), ['admin', 'member']);
  });
}

test('admins manage roles; the last admin cannot be demoted, and nobody removes themselves', async () => {
  const mail = fakeMail();
  const a = createAccounts({ store: await stores.json(), mailer: mail.mailer });
  const { token } = await signUp(a, { name: 'Ali', email: 'ali@example.test', password: 'admin-pass1' }, mail.sent);
  const admin = await a.userFor(token);
  await assert.rejects(a.setRole(admin, admin.id, 'viewer'), { code: 'last-admin' });
  await assert.rejects(a.removeUser(admin, admin.id), { code: 'not-yourself' });
  await a.createInvite(admin, { name: 'V', email: 'v@example.test', role: 'viewer', password: 'viewer-pass1' }, 'http://localhost');
  const { user: v } = await a.acceptInvite({ invite: mail.lastInvite(), password: 'viewer-pass1' });
  assert.equal((await a.setRole(admin, v.id, 'member')).role, 'member');
  await a.removeUser(admin, v.id);
  assert.equal((await a.listUsers()).length, 1);

  assert.equal(can({ role: 'admin' }, 'manage'), true);
  assert.equal(can({ role: 'member' }, 'manage'), false);
  assert.equal(can({ role: 'member' }, 'control'), true);
  assert.equal(can({ role: 'viewer' }, 'control'), false);
  assert.equal(can(null, 'view'), false);
});

test('inviting needs email sending to be set up', async () => {
  const a = createAccounts({ store: await stores.json() });
  const { token } = await a.register({ name: 'Ali', email: 'ali@example.test', password: 'admin-pass1' });
  await assert.rejects(a.createInvite(await a.userFor(token), { name: 'X', email: 'x@example.test', password: 'viewer-pass1' }, 'http://localhost'), { code: 'email-not-configured' });
});

test('accounts from before roles: the oldest becomes admin', async () => {
  const store = await stores.json();
  await store.saveUser({ id: 'u1', email: 'old@example.test', password: 'x:y', createdAt: 1, name: 'Old' });
  await store.saveUser({ id: 'u2', email: 'new@example.test', password: 'x:y', createdAt: 2, name: 'New' });
  const a = createAccounts({ store });
  assert.deepEqual((await a.listUsers()).map(u => [u.email, u.role]), [['old@example.test', 'admin'], ['new@example.test', 'member']]);
});

test('device keys: open until one exists, then only the right key; shown once, stored hashed', async () => {
  const store = await stores.json();
  const d = createDevice({ store });
  assert.deepEqual(await d.check({}), { ok: true, protected: false });
  const { key, entry } = await d.createKey('Fridge', 'Ali');
  assert.match(key, /^kv_/);
  assert.equal(entry.hash, undefined);
  assert.equal(JSON.stringify(await store.getSetting('device_keys')).includes(key), false);
  assert.equal((await d.check({})).ok, false);
  assert.equal((await d.check({ 'x-device-key': 'kv_wrong' })).ok, false);
  assert.equal((await d.check({ 'x-device-key': key })).ok, true);
  assert.equal((await d.check({ authorization: `Bearer ${key}` })).ok, true);
  // A restart reads the keys back from the store.
  assert.equal((await createDevice({ store }).check({ 'x-device-key': key })).ok, true);
  await d.revokeKey(entry.id);
  assert.equal((await d.check({ 'x-device-key': key })).protected, false);
});

test('the admin sees the password they set, can change it any time, and loses sight of it when the user picks their own', async () => {
  const mail = fakeMail();
  const store = await stores.json();
  const a = createAccounts({ store, mailer: mail.mailer, vaultKey: 'test-key' });
  const { token } = await signUp(a, { name: 'Ali', email: 'ali@example.test', password: 'admin-pass1' }, mail.sent);
  const admin = await a.userFor(token);
  const { link } = await a.createInvite(admin, { name: 'S', email: 's@example.test', role: 'viewer', password: 'given-pass1' }, 'http://localhost');
  assert.match(link, /\?invite=/);
  // Resending makes a new link; the old one stops working.
  const again = await a.resendInvite(admin, (await a.listInvites())[0].id, 'en', 'http://localhost');
  await assert.rejects(a.acceptInvite({ invite: decodeURIComponent(link.split('=')[1]), password: 'given-pass1' }), { code: 'invite-invalid' });
  const { user: s, token: sToken } = await a.acceptInvite({ invite: decodeURIComponent(again.link.split('=')[1]), password: 'given-pass1' });

  assert.equal((await a.revealPassword(s.id)).password, 'given-pass1');
  assert.deepEqual((await a.listUsers()).find(u => u.id === s.id).password.known, true);
  // Stored encrypted, not as typed.
  assert.doesNotMatch(JSON.stringify(await store.getSetting('password_vault')), /given-pass1/);
  // Another key cannot read it.
  assert.equal((await createAccounts({ store, vaultKey: 'other' }).revealPassword(s.id)).password, null);

  await a.setPassword(admin, s.id, 'changed-pass2');
  assert.equal(await a.userFor(sToken), null); // signed out
  assert.equal((await a.revealPassword(s.id)).password, 'changed-pass2');
  await assert.rejects(a.setPassword(admin, admin.id, 'whatever-123'), { code: 'not-yourself' });

  const { token: t2 } = await a.login({ email: 's@example.test', password: 'changed-pass2' }, 'ip');
  await a.changePassword(await a.userFor(t2), { current: 'changed-pass2', next: 'own-secret-3' }, t2);
  assert.deepEqual(await a.revealPassword(s.id), { password: null, self: true, at: (await a.revealPassword(s.id)).at });
});

test('a viewer sees the admin\'s dashboard settings and cannot change them', async () => {
  const mail = fakeMail();
  const a = createAccounts({ store: await stores.json(), mailer: mail.mailer });
  const { token } = await signUp(a, { name: 'Ali', email: 'ali@example.test', password: 'admin-pass1' }, mail.sent);
  const admin = await a.userFor(token);
  await a.savePrefs(admin, { settings: { tempMax: 6 } });
  await a.createInvite(admin, { name: 'V', email: 'v@example.test', role: 'viewer', password: 'viewer-pass1' }, 'http://localhost');
  const { token: vt } = await a.acceptInvite({ invite: mail.lastInvite(), password: 'viewer-pass1' });
  const viewer = await a.userFor(vt);
  assert.deepEqual(a.viewFor(viewer).prefs.settings, { tempMax: 6 });
  await assert.rejects(a.savePrefs(viewer, { settings: { tempMax: 99 } }), { code: 'forbidden' });
  // Personal choices still work.
  assert.equal((await a.savePrefs(viewer, { lang: 'en' })).prefs.lang, 'en');
});

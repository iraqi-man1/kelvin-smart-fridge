import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { PGlite } from '@electric-sql/pglite';
import { createJsonStore, createPostgresStore, importFromJson } from '../server/store.mjs';
import { createAccounts } from '../server/accounts.mjs';
import { createAlerts } from '../server/alerts.mjs';

// PGlite is PostgreSQL 16 compiled to WebAssembly: the same SQL Supabase runs.
async function pgStore() {
  const db = new PGlite();
  return createPostgresStore({ query: (text, params) => db.query(text, params), close: () => db.close() });
}
const tmp = () => path.join(tmpdir(), `kelvin-store-${Math.random()}`);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7]);
const reading = (i, extra = {}) => ({ id: crypto.randomUUID(), timestamp: 1_800_000_000_000 + i * 5000, temperature: 26.4, humidity: 58, eco2: 600 + i, tvoc: 30, deviceId: 'ESP32-WROOM-32', ...extra });

for (const [name, make] of [['json', async () => createJsonStore(tmp())], ['postgres', pgStore]]) {
  test(`${name} store: readings come back newest-last with exact values`, async () => {
    const store = await make();
    for (let i = 0; i < 5; i++) await store.insertReading(reading(i, i === 4 ? { rssi: -61, uptime: 3600 } : {}));
    const last3 = await store.recentReadings(3);
    assert.deepEqual(last3.map(r => r.eco2), [602, 603, 604]);
    assert.equal(last3[2].temperature, 26.4);
    assert.equal(last3[2].rssi, -61);
    assert.equal(last3[2].uptime, 3600);
    assert.equal(last3[0].rssi, undefined);
    assert.equal(await store.countReadings(), 5);
    await store.close();
  });

  test(`${name} store: settings round-trip as JSON`, async () => {
    const store = await make();
    assert.equal(await store.getSetting('alerts'), null);
    await store.setSetting('alerts', { enabled: true, limits: { eco2: { min: null, max: 1000 } } });
    await store.setSetting('alerts', { enabled: false, limits: { eco2: { min: null, max: 900 } } });
    assert.deepEqual(await store.getSetting('alerts'), { enabled: false, limits: { eco2: { min: null, max: 900 } } });
    await store.close();
  });

  test(`${name} store: accounts, sessions, PIN and photo survive a restart`, async () => {
    const store = await make();
    const a = createAccounts({ store });
    const { token } = await a.register({ name: 'Ali', email: 'ali@example.test', password: 'account-pass' });
    const user = await a.userFor(token);
    await a.updateProfile(user, { studentId: '22301234' });
    await a.setLockCode(user, { password: 'account-pass', code: '2468' });
    await a.setAvatar(user, jpeg);
    await a.lock(token);

    // A second accounts object over the same store = the server restarted.
    const b = createAccounts({ store });
    const found = await b.sessionFor(token);
    assert.equal(found.user.studentId, '22301234');
    assert.equal(found.session.locked, true);
    assert.deepEqual([...(await b.avatar(user.id)).data], [...jpeg]);
    await b.unlock(token, { method: 'code', secret: '2468' }, 'k');
    assert.equal((await createAccounts({ store }).sessionFor(token)).session.locked, false);

    await b.deleteAccount(found.user, 'account-pass');
    const c = createAccounts({ store });
    assert.equal(await c.userFor(token), null);
    assert.equal(await store.getAvatar(user.id), null);
    assert.equal((await store.loadSessions()).length, 0);
    await store.close();
  });
}

test('postgres store: passwords and PINs are stored hashed, never as typed', async () => {
  const db = new PGlite();
  const store = await createPostgresStore({ query: (t, p) => db.query(t, p) });
  const a = createAccounts({ store });
  const { token } = await a.register({ name: 'A', email: 'a@x.io', password: 'account-pass' });
  await a.setLockCode(await a.userFor(token), { password: 'account-pass', code: '2468' });
  const row = (await db.query('select password, lock_code from kelvin_users')).rows[0];
  assert.doesNotMatch(row.password, /account-pass/);
  assert.doesNotMatch(row.lock_code, /2468/);
  assert.match(row.password, /^[0-9a-f]{32}:[0-9a-f]{128}$/);
  // Supabase's public API must not see these tables.
  const rls = (await db.query("select relname, relrowsecurity from pg_class where relname like 'kelvin_%' and relkind = 'r'")).rows;
  assert.equal(rls.length, 5);
  assert.ok(rls.every(r => r.relrowsecurity));
});

test('the JSON data is copied into an empty database once', async () => {
  const dir = tmp();
  await mkdir(path.join(dir, 'avatars'), { recursive: true });
  const json = createJsonStore(dir);
  const a = createAccounts({ store: json });
  const { token } = await a.register({ name: 'Ali', email: 'ali@example.test', password: 'account-pass' });
  const user = await a.userFor(token);
  await a.setAvatar(user, jpeg);
  for (let i = 0; i < 3; i++) await json.insertReading(reading(i));
  await writeFile(path.join(dir, 'alerts.json'), JSON.stringify({ enabled: true, chatId: '42', cooldownMin: 15, lang: 'ar' }));

  const db = await pgStore();
  const fromFiles = createJsonStore(dir); // a fresh read of the files, as at server start
  const counts = await importFromJson(db, fromFiles);
  assert.deepEqual(counts, { users: 1, sessions: 1, avatars: 1, readings: 3, settings: 1 });
  assert.equal(await importFromJson(db, fromFiles), null);

  const moved = createAccounts({ store: db });
  assert.equal((await moved.userFor(token)).email, 'ali@example.test');
  assert.deepEqual([...(await moved.avatar(user.id)).data], [...jpeg]);
  assert.equal((await db.getSetting('alerts')).chatId, '42');
  assert.equal((await db.recentReadings(10)).length, 3);

  // Telegram settings now load from the database.
  const alerts = createAlerts({ load: () => db.getSetting('alerts'), save: v => db.setSetting('alerts', v), env: {} });
  await alerts.ready;
  assert.equal(alerts.getPublic().chatId, '42');
  await alerts.update({ cooldownMin: 30 });
  assert.equal((await db.getSetting('alerts')).cooldownMin, 30);
  await db.close();
});

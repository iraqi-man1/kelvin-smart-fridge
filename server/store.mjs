import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

/**
 * Where Kelvin keeps its data. Two stores share one interface:
 *  - postgres: a real database (Supabase, or any PostgreSQL), used when DATABASE_URL is set;
 *  - json:     the original files in data/, used when it is not.
 *
 * Interface (all async):
 *   users:      loadUsers(), saveUser(user), deleteUser(id)
 *   sessions:   loadSessions(), saveSession(s), deleteSession(hash), deleteUserSessions(userId, exceptHash)
 *   photos:     getAvatar(userId), putAvatar(userId, type, bytes), deleteAvatar(userId)
 *   readings:   insertReading(r), recentReadings(limit), readingsSince(ts, limit), readingsBetween(from, to, points), countReadings()
 *   settings:   getSetting(key), setSetting(key, value)
 */

/**
 * Readings between two times, averaged into at most `points` equal time slices, so a long
 * period (a week ago, for comparison) comes back small. Empty slices are left out.
 */
export function bucketReadings(list, from, to, points) {
  const size = Math.max(1, (to - from) / points);
  const slots = new Map();
  for (const r of list) {
    if (r.timestamp < from || r.timestamp > to) continue;
    const b = Math.min(points - 1, Math.floor((r.timestamp - from) / size));
    const s = slots.get(b) ?? { t: 0, temperature: 0, humidity: 0, eco2: 0, tvoc: 0, n: 0 };
    s.t += r.timestamp; s.temperature += r.temperature; s.humidity += r.humidity; s.eco2 += r.eco2; s.tvoc += r.tvoc; s.n++;
    slots.set(b, s);
  }
  return [...slots.entries()].sort((a, b) => a[0] - b[0]).map(([b, s]) => ({
    id: `avg-${b}`, timestamp: Math.round(s.t / s.n), deviceId: 'avg', samples: s.n,
    temperature: s.temperature / s.n, humidity: s.humidity / s.n, eco2: s.eco2 / s.n, tvoc: s.tvoc / s.n,
  }));
}

const KEEP_IN_FILE = 2000; // the JSON store keeps a rolling window; Postgres keeps everything
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

const readJson = async file => { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; } };

export function createJsonStore(dir, { readingsFile = path.join(dir, 'readings.json') } = {}) {
  const files = { users: path.join(dir, 'users.json'), sessions: path.join(dir, 'sessions.json'), settings: path.join(dir, 'settings.json') };
  const avatarDir = path.join(dir, 'avatars');
  let users = [], sessions = [], readings = [], settings = {};
  const ready = Promise.all([
    readJson(files.users).then(v => { if (Array.isArray(v)) users = v; }),
    readJson(files.sessions).then(v => { if (Array.isArray(v)) sessions = v; }),
    readJson(readingsFile).then(v => { if (Array.isArray(v)) readings = v.slice(-KEEP_IN_FILE); }),
    readJson(files.settings).then(v => { if (v && typeof v === 'object') settings = v; }),
    // Telegram settings lived in their own file before the store existed.
    readJson(path.join(dir, 'alerts.json')).then(v => { if (v && !settings.alerts) settings.alerts = v; }),
  ]);
  let queue = Promise.resolve();
  const write = (file, data) => {
    const run = queue.then(async () => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(data), 'utf8'); });
    queue = run.catch(() => {});
    return run;
  };
  const avatarPath = (id, type) => path.join(avatarDir, `${id}.${EXT[type] ?? 'img'}`);

  return {
    kind: 'json',
    async loadUsers() { await ready; return users.map(u => ({ ...u })); },
    async saveUser(user) { await ready; users = [...users.filter(u => u.id !== user.id), { ...user }]; await write(files.users, users); },
    async deleteUser(id) {
      await ready;
      const user = users.find(u => u.id === id);
      users = users.filter(u => u.id !== id); sessions = sessions.filter(s => s.userId !== id);
      if (user?.avatar) await rm(avatarPath(id, user.avatar.type), { force: true });
      await write(files.users, users); await write(files.sessions, sessions);
    },
    async loadSessions() { await ready; return sessions.map(s => ({ ...s })); },
    async saveSession(s) { await ready; sessions = [...sessions.filter(x => x.hash !== s.hash), { ...s }]; await write(files.sessions, sessions); },
    async deleteSession(hash) { await ready; sessions = sessions.filter(s => s.hash !== hash); await write(files.sessions, sessions); },
    async deleteUserSessions(userId, exceptHash) { await ready; sessions = sessions.filter(s => s.userId !== userId || s.hash === exceptHash); await write(files.sessions, sessions); },
    async getAvatar(userId) {
      await ready;
      const type = users.find(u => u.id === userId)?.avatar?.type;
      if (!type) return null;
      try { return { type, data: await readFile(avatarPath(userId, type)) }; } catch { return null; }
    },
    async putAvatar(userId, type, data) {
      await mkdir(avatarDir, { recursive: true });
      for (const ext of Object.values(EXT)) await rm(path.join(avatarDir, `${userId}.${ext}`), { force: true });
      await writeFile(avatarPath(userId, type), data);
    },
    async deleteAvatar(userId) { for (const ext of Object.values(EXT)) await rm(path.join(avatarDir, `${userId}.${ext}`), { force: true }); },
    async insertReading(r) { await ready; readings = [...readings, r].slice(-KEEP_IN_FILE); await write(readingsFile, readings); },
    async recentReadings(limit) { await ready; return readings.slice(-limit); },
    async readingsSince(ts, limit) { await ready; return readings.filter(r => r.timestamp > ts).slice(-limit); },
    async readingsBetween(from, to, points) { await ready; return bucketReadings(readings, from, to, points); },
    async countReadings() { await ready; return readings.length; },
    async getSetting(key) { await ready; return settings[key] ?? null; },
    async setSetting(key, value) { await ready; settings = { ...settings, [key]: value }; await write(files.settings, settings); },
    async close() { await queue; },
  };
}

// Every table starts with kelvin_ so it can share a Supabase project with other work.
// Row Level Security is on with no policies: Supabase's public API (anon key) cannot read
// these tables; only the server, connected as the database owner, can.
export const SCHEMA = `
create table if not exists kelvin_users (
  id uuid primary key,
  email text not null unique,
  password text not null,
  created_at bigint not null,
  name text not null default '',
  student_id text not null default '',
  university text not null default '',
  faculty text not null default '',
  phone text not null default '',
  bio text not null default '',
  lock_code text,
  avatar_type text,
  avatar_version bigint
);
create table if not exists kelvin_sessions (
  hash text primary key,
  user_id uuid not null references kelvin_users(id) on delete cascade,
  expires bigint not null,
  locked boolean not null default false
);
alter table kelvin_users add column if not exists otp_email boolean not null default false;
alter table kelvin_users add column if not exists prefs jsonb not null default '{}'::jsonb;
alter table kelvin_users add column if not exists role text not null default 'member';
create index if not exists kelvin_sessions_user_idx on kelvin_sessions (user_id);
create table if not exists kelvin_avatars (
  user_id uuid primary key references kelvin_users(id) on delete cascade,
  type text not null,
  data bytea not null
);
create table if not exists kelvin_readings (
  id uuid primary key,
  ts bigint not null,
  temperature double precision not null,
  humidity double precision not null,
  eco2 integer not null,
  tvoc integer not null,
  device_id text not null,
  rssi integer,
  uptime bigint
);
create index if not exists kelvin_readings_ts_idx on kelvin_readings (ts desc);
create table if not exists kelvin_settings (
  key text primary key,
  value jsonb not null,
  updated_at bigint not null
);
alter table kelvin_users enable row level security;
alter table kelvin_sessions enable row level security;
alter table kelvin_avatars enable row level security;
alter table kelvin_readings enable row level security;
alter table kelvin_settings enable row level security;
`;

const PROFILE_COLUMNS = { name: 'name', studentId: 'student_id', university: 'university', faculty: 'faculty', phone: 'phone', bio: 'bio' };
const num = v => (v === null || v === undefined ? undefined : Number(v));

function userFromRow(r) {
  return {
    id: r.id, email: r.email, password: r.password, createdAt: Number(r.created_at),
    ...Object.fromEntries(Object.entries(PROFILE_COLUMNS).map(([k, c]) => [k, r[c]])),
    ...(r.lock_code ? { lockCode: r.lock_code } : {}),
    ...(r.otp_email ? { otpEmail: true } : {}),
    ...(r.role ? { role: r.role } : {}),
    ...(r.prefs && Object.keys(r.prefs).length ? { prefs: typeof r.prefs === 'string' ? JSON.parse(r.prefs) : r.prefs } : {}),
    ...(r.avatar_type ? { avatar: { type: r.avatar_type, ext: EXT[r.avatar_type], version: Number(r.avatar_version) } } : {}),
  };
}

function readingFromRow(r) {
  return {
    id: r.id, timestamp: Number(r.ts), temperature: Number(r.temperature), humidity: Number(r.humidity),
    eco2: Number(r.eco2), tvoc: Number(r.tvoc), deviceId: r.device_id,
    ...(r.rssi !== null ? { rssi: num(r.rssi) } : {}), ...(r.uptime !== null ? { uptime: num(r.uptime) } : {}),
  };
}

/**
 * A PostgreSQL store over any `query(text, params) -> { rows }` function:
 * node-postgres's Pool in the server, PGlite in the tests.
 */
const SCHEMA_VERSION = createHash('sha256').update(SCHEMA).digest('hex').slice(0, 16);

export async function createPostgresStore({ query, close = async () => {} }) {
  // The tables are created (or updated) only when the schema changed since the last start,
  // so a fresh serverless copy does not run every statement on each cold start.
  let current = null;
  try { current = (await query("select value from kelvin_settings where key = 'schema_version'")).rows[0]?.value ?? null; } catch {}
  if (current !== SCHEMA_VERSION) {
    for (const statement of SCHEMA.split(';').map(s => s.trim()).filter(Boolean)) await query(statement);
    await query(`insert into kelvin_settings (key, value, updated_at) values ('schema_version', $1::jsonb, $2)
      on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at`, [JSON.stringify(SCHEMA_VERSION), Date.now()]);
  }

  return {
    kind: 'postgres',
    async loadUsers() { return (await query('select * from kelvin_users order by created_at')).rows.map(userFromRow); },
    async saveUser(u) {
      await query(`insert into kelvin_users (id, email, password, created_at, name, student_id, university, faculty, phone, bio, lock_code, avatar_type, avatar_version, otp_email, prefs, role)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16)
        on conflict (id) do update set email = excluded.email, password = excluded.password, name = excluded.name,
          student_id = excluded.student_id, university = excluded.university, faculty = excluded.faculty, phone = excluded.phone,
          bio = excluded.bio, lock_code = excluded.lock_code, avatar_type = excluded.avatar_type, avatar_version = excluded.avatar_version,
          otp_email = excluded.otp_email, prefs = excluded.prefs, role = excluded.role`,
      [u.id, u.email, u.password, u.createdAt, u.name ?? '', u.studentId ?? '', u.university ?? '', u.faculty ?? '', u.phone ?? '', u.bio ?? '',
        u.lockCode ?? null, u.avatar?.type ?? null, u.avatar?.version ?? null, Boolean(u.otpEmail), JSON.stringify(u.prefs ?? {}), u.role ?? 'member']);
    },
    // Sessions and the photo go with the user (on delete cascade).
    async deleteUser(id) { await query('delete from kelvin_users where id = $1', [id]); },
    async loadSessions() {
      return (await query('select * from kelvin_sessions')).rows.map(r => ({ hash: r.hash, userId: r.user_id, expires: Number(r.expires), locked: Boolean(r.locked) }));
    },
    async saveSession(s) {
      await query(`insert into kelvin_sessions (hash, user_id, expires, locked) values ($1,$2,$3,$4)
        on conflict (hash) do update set expires = excluded.expires, locked = excluded.locked`, [s.hash, s.userId, s.expires, Boolean(s.locked)]);
    },
    async deleteSession(hash) { await query('delete from kelvin_sessions where hash = $1', [hash]); },
    async deleteUserSessions(userId, exceptHash) { await query('delete from kelvin_sessions where user_id = $1 and hash <> $2', [userId, exceptHash ?? '']); },
    async getAvatar(userId) {
      const row = (await query('select type, data from kelvin_avatars where user_id = $1', [userId])).rows[0];
      return row ? { type: row.type, data: Buffer.from(row.data) } : null;
    },
    async putAvatar(userId, type, data) {
      await query(`insert into kelvin_avatars (user_id, type, data) values ($1,$2,$3)
        on conflict (user_id) do update set type = excluded.type, data = excluded.data`, [userId, type, data]);
    },
    async deleteAvatar(userId) { await query('delete from kelvin_avatars where user_id = $1', [userId]); },
    async insertReading(r) {
      await query(`insert into kelvin_readings (id, ts, temperature, humidity, eco2, tvoc, device_id, rssi, uptime)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (id) do nothing`,
      [r.id, r.timestamp, r.temperature, r.humidity, r.eco2, r.tvoc, r.deviceId ?? 'ESP32-WROOM-32', r.rssi ?? null, r.uptime ?? null]);
    },
    async recentReadings(limit) {
      const rows = (await query('select * from kelvin_readings order by ts desc limit $1', [limit])).rows;
      return rows.map(readingFromRow).reverse();
    },
    async readingsSince(ts, limit) {
      const rows = (await query('select * from kelvin_readings where ts > $1 order by ts desc limit $2', [ts, limit])).rows;
      return rows.map(readingFromRow).reverse();
    },
    async readingsBetween(from, to, points) {
      const size = Math.max(1, Math.ceil((to - from) / points));
      const rows = (await query(`select floor((ts - $1) / $3) as b, avg(ts) as ts, avg(temperature) as temperature, avg(humidity) as humidity,
        avg(eco2) as eco2, avg(tvoc) as tvoc, count(*) as n from kelvin_readings where ts between $1 and $2 group by b order by b`, [from, to, size])).rows;
      return rows.map(r => ({
        id: `avg-${r.b}`, timestamp: Math.round(Number(r.ts)), deviceId: 'avg', samples: Number(r.n),
        temperature: Number(r.temperature), humidity: Number(r.humidity), eco2: Number(r.eco2), tvoc: Number(r.tvoc),
      }));
    },
    async countReadings() { return Number((await query('select count(*) as n from kelvin_readings')).rows[0].n); },
    async getSetting(key) { return (await query('select value from kelvin_settings where key = $1', [key])).rows[0]?.value ?? null; },
    async setSetting(key, value) {
      await query(`insert into kelvin_settings (key, value, updated_at) values ($1, $2::jsonb, $3)
        on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at`, [key, JSON.stringify(value), Date.now()]);
    },
    close,
  };
}

/** Copies the JSON files into a new, empty database once. Returns what was copied. */
export async function importFromJson(db, json) {
  if (await db.getSetting('imported_from_json')) return null;
  const counts = { users: 0, sessions: 0, avatars: 0, readings: 0, settings: 0 };
  if ((await db.loadUsers()).length === 0) {
    for (const u of await json.loadUsers()) {
      await db.saveUser(u); counts.users++;
      const photo = await json.getAvatar(u.id);
      if (photo) { await db.putAvatar(u.id, photo.type, photo.data); counts.avatars++; }
    }
    const known = new Set((await db.loadUsers()).map(u => u.id));
    for (const s of await json.loadSessions()) if (known.has(s.userId) && s.expires > Date.now()) { await db.saveSession(s); counts.sessions++; }
  }
  if (await db.countReadings() === 0) for (const r of await json.recentReadings(KEEP_IN_FILE)) { await db.insertReading(r); counts.readings++; }
  for (const key of ['alerts']) {
    const value = await json.getSetting(key);
    if (value && !(await db.getSetting(key))) { await db.setSetting(key, value); counts.settings++; }
  }
  await db.setSetting('imported_from_json', { at: Date.now(), counts });
  return counts;
}

/** The store the server runs on: Postgres when DATABASE_URL is set, else the JSON files. */
export async function openStore({ dataDir, readingsFile, databaseUrl, serverless = false, log = console.log }) {
  if (serverless && !databaseUrl) throw new Error('DATABASE_URL is not set (needed when hosted online).');
  const json = serverless ? null : createJsonStore(dataDir, { readingsFile });
  if (!databaseUrl) return json;
  if (serverless) {
    // Many short-lived copies: Supabase's transaction pooler (port 6543) suits them better
    // than the session pooler (5432), and each copy needs only one connection.
    try {
      const u = new URL(databaseUrl);
      if (/pooler\.supabase\.com$/.test(u.hostname) && (u.port === '5432' || !u.port)) { u.port = '6543'; databaseUrl = u.toString(); }
    } catch {}
  }

  const { default: pg } = await import('pg');
  // Supabase requires TLS. Its certificate is signed by Supabase's own CA, so either give the
  // path of that CA file in DATABASE_CA (Supabase dashboard → Database → SSL), or the
  // connection is encrypted without checking the certificate.
  const ca = process.env.DATABASE_CA ? await readFile(process.env.DATABASE_CA, 'utf8') : null;
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    ssl: /localhost|127\.0\.0\.1/.test(databaseUrl) ? false : ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false },
    max: serverless ? 1 : Number(process.env.DATABASE_POOL_MAX) || 5, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000,
  });
  pool.on('error', e => console.error('[database]', e.message));
  const db = await createPostgresStore({ query: (text, params) => pool.query(text, params), close: () => pool.end() });
  if (!json) return db;
  const copied = await importFromJson(db, json);
  if (copied) log(`[database] copied the JSON data into PostgreSQL: ${JSON.stringify(copied)}`);
  return db;
}


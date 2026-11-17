import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { codeEmail, inviteEmail } from './mailer.mjs';
import { createJsonStore } from './store.mjs';

const scrypt = promisify(scryptCb);

export const SESSION_COOKIE = 'kelvin_session';
export const SESSION_DAYS = 30;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const PROFILE = { name: 80, studentId: 32, university: 120, faculty: 120, phone: 32, bio: 500 };
const MAX_AVATAR = 2 * 1024 * 1024;
const MAX_PREFS = 16 * 1024; // the account's saved settings, as JSON

/**
 * Roles: admin (everything, including users, Telegram and device keys), member (uses the
 * dashboard and sends commands to the device), viewer (looks only).
 */
export const ROLES = ['admin', 'member', 'viewer'];
export const can = (user, action) => ({
  manage: user?.role === 'admin',
  control: user?.role === 'admin' || user?.role === 'member',
  view: Boolean(user),
})[action] ?? false;
const INVITE_DAYS = 7;
const FAIL_LIMIT = 10, FAIL_WINDOW = 15 * 60000;
// Email codes: 6 digits, 10 minutes, 5 tries, one new email a minute, 5 emails per code.
const OTP_TTL = 10 * 60000, OTP_TRIES = 5, OTP_RESEND = 60000, OTP_SENDS = 5;
const LANGS = ['ar', 'en', 'ms'];
const notConfigured = { configured: false, send: async () => { throw new AccountError('email-not-configured', 503); } };

/** An error the client can translate: `code` is stable, `status` is the HTTP status. */
export class AccountError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

const sha256 = s => createHash('sha256').update(s).digest('hex');
async function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${(await scrypt(password, salt, 64)).toString('hex')}`;
}
async function checkPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const given = await scrypt(password, salt, 64);
  return timingSafeEqual(given, Buffer.from(hash, 'hex'));
}

function imageType(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' };
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', type: 'image/png' };
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { ext: 'webp', type: 'image/webp' };
  return null;
}

/**
 * Accounts keep a copy of users and sessions in memory for fast look-ups, and write each
 * change straight to the store (PostgreSQL or the JSON files, see store.mjs).
 */
export function createAccounts({ store, dir, now = Date.now, mailer = notConfigured, vaultKey = 'kelvin-local' }) {
  // Passwords an admin sets (by invitation or by changing it) are also kept encrypted
  // (AES-256-GCM, key from VAULT_KEY or the database address) so the admin can look them up.
  // A password the user chooses themselves is never kept: only its scrypt hash, as always.
  const key = createHash('sha256').update(`kelvin-password-vault:${vaultKey}`).digest();
  const seal = text => {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
    return [iv, c.getAuthTag(), enc].map(b => b.toString('base64url')).join('.');
  };
  const unseal = s => {
    try {
      const [iv, tag, enc] = s.split('.').map(x => Buffer.from(x, 'base64url'));
      const d = createDecipheriv('aes-256-gcm', key, iv);
      d.setAuthTag(tag);
      return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
    } catch { return null; }
  };
  const loadVault = async () => (await store.getSetting('password_vault')) ?? {};
  /** entry: { sealed, at, by, self } — sealed is null when the user chose the password. */
  async function remember(userId, entry) {
    const v = await loadVault();
    if (entry) v[userId] = { ...entry, at: now() }; else delete v[userId];
    await store.setSetting('password_vault', v);
  }

  store ??= createJsonStore(dir);
  // Emailed codes and failed sign-ins live in the store too (settings otp_challenges and
  // login_failures), so they hold across server copies and restarts.
  let challenges = new Map(); // id -> { userId, purpose, hash, expires, tries, sentAt, sends, lang }
  let users = [], sessions = [];
  let failures = new Map(); // key -> { count, since }
  async function loadState() {
    const [c, f] = await Promise.all([store.getSetting('otp_challenges'), store.getSetting('login_failures')]);
    challenges = new Map(Object.entries(c && typeof c === 'object' ? c : {}));
    failures = new Map(Object.entries(f && typeof f === 'object' ? f : {}));
  }
  async function saveState() {
    const t = now();
    await Promise.all([
      store.setSetting('otp_challenges', Object.fromEntries([...challenges].filter(([, c]) => c.expires > t))),
      store.setSetting('login_failures', Object.fromEntries([...failures].filter(([, f]) => t - f.since < FAIL_WINDOW))),
    ]);
  }
  /** Reloads accounts, sessions and codes from the store (another server copy may have changed them). */
  async function refresh() {
    const [u, s] = await Promise.all([store.loadUsers(), store.loadSessions(), loadState()]);
    users = u;
    sessions = s.filter(x => x.expires > now());
  }
  const ready = Promise.all([
    loadState(),
    store.loadUsers().then(async v => {
      users = v;
      // Accounts made before roles existed: the oldest becomes admin, the rest members.
      let changed = users.filter(u => !ROLES.includes(u.role));
      for (const u of changed) u.role = 'member';
      if (users.length && !users.some(u => u.role === 'admin')) {
        const oldest = [...users].sort((a, b) => a.createdAt - b.createdAt)[0];
        oldest.role = 'admin';
        if (!changed.includes(oldest)) changed = [...changed, oldest];
      }
      for (const u of changed) await store.saveUser(u);
    }),
    store.loadSessions().then(v => { sessions = v.filter(s => s.expires > now()); }),
  ]);

  const publicUser = u => ({
    id: u.id, email: u.email, createdAt: u.createdAt,
    ...Object.fromEntries(Object.keys(PROFILE).map(k => [k, u[k] ?? ''])),
    avatar: u.avatar ? `/api/avatar/${u.id}?v=${u.avatar.version}` : null,
    hasLockCode: Boolean(u.lockCode),
    otpEmail: Boolean(u.otpEmail),
    emailReady: mailer.configured,
    prefs: u.prefs ?? {},
    role: u.role ?? 'member',
  });

  const publicInvite = ({ hash, password, sealed, ...rest }) => rest;
  const loadInvites = async () => ((await store.getSetting('invites')) ?? []).filter(i => i.expires > now());

  // a***@gmail.com: enough to recognise your own address, not enough to learn someone else's.
  const mask = email => { const [name, domain] = email.split('@'); return `${name[0]}${'*'.repeat(Math.max(2, Math.min(6, name.length - 1)))}@${domain}`; };
  const codeHash = (id, code) => sha256(`${id}:${code}`);

  /** Emails a fresh 6-digit code and remembers only its hash. */
  async function sendCode(id, challenge, user) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    challenge.hash = codeHash(id, code);
    challenge.tries = 0;
    challenge.expires = now() + OTP_TTL;
    challenge.sentAt = now();
    challenge.sends = (challenge.sends ?? 0) + 1;
    try { await mailer.send({ to: user.email, ...codeEmail({ code, purpose: challenge.purpose, lang: challenge.lang, name: user.name }) }); }
    catch (e) {
      if (e instanceof AccountError) throw e;
      console.error('[email]', e.message);
      throw new AccountError('email-failed', 502);
    }
  }

  async function issue(user, purpose, lang) {
    if (!mailer.configured) throw new AccountError('email-not-configured', 503);
    for (const [id, c] of challenges) if (c.expires < now()) challenges.delete(id);
    const id = randomUUID();
    const challenge = { userId: user.id, purpose, lang: LANGS.includes(lang) ? lang : 'ar' };
    await sendCode(id, challenge, user);
    challenges.set(id, challenge);
    return { challenge: id, email: mask(user.email), resendIn: OTP_RESEND / 1000 };
  }

  /** Checks a code; each wrong try counts, and the 5th cancels the code. */
  function checkCode(input, purpose, key) {
    limit(key);
    const id = String(input?.challenge ?? '');
    const c = challenges.get(id);
    if (!c || c.purpose !== purpose || c.expires < now()) { challenges.delete(id); throw new AccountError('otp-expired', 400); }
    const given = String(input?.code ?? '').replace(/\D/g, '');
    const ok = given.length === 6 && timingSafeEqual(Buffer.from(codeHash(id, given)), Buffer.from(c.hash));
    if (!ok) {
      fail(key);
      c.tries++;
      if (c.tries >= OTP_TRIES) { challenges.delete(id); throw new AccountError('otp-expired', 400); }
      throw new AccountError('wrong-otp', 403);
    }
    challenges.delete(id);
    failures.delete(key);
    return c;
  }

  function cleanProfile(input, { requireName }) {
    const out = {};
    for (const [key, max] of Object.entries(PROFILE)) {
      const v = input?.[key];
      if (v === undefined) continue;
      if (typeof v !== 'string' || v.trim().length > max) throw new AccountError('invalid-field');
      out[key] = v.trim();
    }
    if ((requireName || 'name' in out) && !out.name) throw new AccountError('name-required');
    return out;
  }

  function checkNewPassword(p) {
    if (typeof p !== 'string' || p.length < 8 || p.length > 200) throw new AccountError('weak-password');
  }

  async function newSession(user) {
    const token = randomBytes(32).toString('base64url');
    const session = { hash: sha256(token), userId: user.id, expires: now() + SESSION_DAYS * 86400000 };
    await store.saveSession(session);
    sessions.push(session);
    return token;
  }

  function limit(key) {
    const f = failures.get(key);
    if (f && now() - f.since < FAIL_WINDOW && f.count >= FAIL_LIMIT) throw new AccountError('too-many', 429);
  }
  function fail(key) {
    const f = failures.get(key);
    failures.set(key, f && now() - f.since < FAIL_WINDOW ? { ...f, count: f.count + 1 } : { count: 1, since: now() });
  }

  const api = {
    ready, publicUser, refresh,

    async register(input) {
      await ready;
      const email = typeof input?.email === 'string' ? input.email.trim().toLowerCase() : '';
      if (!EMAIL.test(email)) throw new AccountError('invalid-email');
      checkNewPassword(input.password);
      const profile = cleanProfile({ name: input.name }, { requireName: true });
      if (users.some(u => u.email === email)) throw new AccountError('email-taken', 409);
      // Only the very first account signs itself up (and becomes the admin). Everyone after
      // that joins through an emailed invitation from an admin (acceptInvite).
      if (users.length) throw new AccountError('invite-required', 403);
      const user = { id: randomUUID(), email, password: await hashPassword(input.password), createdAt: now(), role: 'admin', ...profile };
      await store.saveUser(user);
      users.push(user);
      return { user: publicUser(user), token: await newSession(user) };
    },

    async login(input, key = 'any') {
      await ready;
      limit(key);
      const email = typeof input?.email === 'string' ? input.email.trim().toLowerCase() : '';
      const user = users.find(u => u.email === email);
      // Same answer and similar work whether the email exists or not.
      const ok = user ? await checkPassword(String(input?.password ?? ''), user.password)
        : (await hashPassword(String(input?.password ?? '')), false);
      if (!ok) { fail(key); throw new AccountError('bad-credentials', 401); }
      failures.delete(key);
      // Two-step sign-in: the password was right, now a code goes to the user's email.
      if (user.otpEmail) return { otp: await issue(user, 'login', input?.lang) };
      return { user: publicUser(user), token: await newSession(user) };
    },

    /** Second step of sign-in: the emailed code opens a session. */
    async verifyLogin(input, key = 'any') {
      await ready;
      const c = checkCode(input, 'login', key);
      const user = users.find(u => u.id === c.userId);
      if (!user) throw new AccountError('otp-expired', 400);
      return { user: publicUser(user), token: await newSession(user) };
    },

    async resendCode(input) {
      await ready;
      const id = String(input?.challenge ?? '');
      const c = challenges.get(id);
      if (!c || c.expires < now()) throw new AccountError('otp-expired', 400);
      if (now() - c.sentAt < OTP_RESEND) throw new AccountError('otp-wait', 429);
      if (c.sends >= OTP_SENDS) { challenges.delete(id); throw new AccountError('too-many', 429); }
      const user = users.find(u => u.id === c.userId);
      if (!user) throw new AccountError('otp-expired', 400);
      await sendCode(id, c, user);
      return { challenge: id, email: mask(user.email), resendIn: OTP_RESEND / 1000 };
    },

    /**
     * Forgotten password, step 1: a code to the account's email. The answer looks the same
     * whether or not the address has an account, so it cannot be used to find accounts.
     */
    async requestReset(input) {
      await ready;
      if (!mailer.configured) throw new AccountError('email-not-configured', 503);
      const email = typeof input?.email === 'string' ? input.email.trim().toLowerCase() : '';
      if (!EMAIL.test(email)) throw new AccountError('invalid-email');
      const user = users.find(u => u.email === email);
      if (user) return issue(user, 'reset', input?.lang);
      return { challenge: randomUUID(), email: mask(email), resendIn: OTP_RESEND / 1000 };
    },

    /** Step 2: the emailed code and a new password. Every other session of the account ends. */
    async resetPassword(input, key = 'any') {
      await ready;
      checkNewPassword(input?.password);
      const c = checkCode(input, 'reset', key);
      const user = users.find(u => u.id === c.userId);
      if (!user) throw new AccountError('otp-expired', 400);
      user.password = await hashPassword(input.password);
      await store.saveUser(user);
      await remember(user.id, { sealed: null, by: user.name, self: true });
      await store.deleteUserSessions(user.id, '');
      sessions = sessions.filter(s => s.userId !== user.id);
      return { user: publicUser(user), token: await newSession(user) };
    },

    /** What the sign-in page needs to know: is this the first account, and is sign-up open. */
    async signupInfo() {
      await ready;
      return { firstAccount: users.length === 0 };
    },

    // ----- Admin: users, roles and invitations -----
    async listUsers() {
      await ready;
      const vault = await loadVault();
      return [...users].sort((a, b) => a.createdAt - b.createdAt).map(u => ({
        ...publicUser(u), prefs: undefined,
        password: vault[u.id] ? { known: Boolean(vault[u.id].sealed), self: Boolean(vault[u.id].self), by: vault[u.id].by, at: vault[u.id].at } : { known: false, self: false, by: null, at: null },
      }));
    },

    async setRole(admin, userId, role) {
      if (!ROLES.includes(role)) throw new AccountError('invalid-field');
      const target = users.find(u => u.id === userId);
      if (!target) throw new AccountError('not-found', 404);
      // There must always be an admin left.
      if (target.role === 'admin' && role !== 'admin' && users.filter(u => u.role === 'admin').length === 1) throw new AccountError('last-admin', 409);
      target.role = role;
      await store.saveUser(target);
      return publicUser(target);
    },

    async removeUser(admin, userId) {
      if (admin.id === userId) throw new AccountError('not-yourself', 409);
      const target = users.find(u => u.id === userId);
      if (!target) throw new AccountError('not-found', 404);
      await store.deleteUser(target.id);
      await remember(target.id, null);
      users = users.filter(u => u.id !== target.id);
      sessions = sessions.filter(s => s.userId !== target.id);
    },

    /** Admin: the password they set for someone, or null if that person chose their own since. */
    async revealPassword(userId) {
      await ready;
      if (!users.some(u => u.id === userId)) throw new AccountError('not-found', 404);
      const entry = (await loadVault())[userId];
      return { password: entry?.sealed ? unseal(entry.sealed) : null, self: Boolean(entry?.self), at: entry?.at ?? null };
    },

    /** Admin: gives someone a new password. Their sessions end, so they sign in again with it. */
    async setPassword(admin, userId, password) {
      await ready;
      if (admin.id === userId) throw new AccountError('not-yourself', 409);
      const target = users.find(u => u.id === userId);
      if (!target) throw new AccountError('not-found', 404);
      checkNewPassword(password);
      target.password = await hashPassword(password);
      await store.saveUser(target);
      await remember(target.id, { sealed: seal(password), by: admin.name, self: false });
      await store.deleteUserSessions(target.id, '');
      sessions = sessions.filter(s => s.userId !== target.id);
      return { ok: true };
    },

    /**
     * An admin invites someone by email and chooses their password. The link goes to that
     * email only; opening it and typing the password the admin gave them creates the account.
     * Only hashes of the link code and the password are kept.
     */
    async createInvite(admin, input, origin) {
      await ready;
      const role = ROLES.includes(input?.role) ? input.role : 'viewer';
      const email = typeof input?.email === 'string' ? input.email.trim().toLowerCase() : '';
      if (!EMAIL.test(email)) throw new AccountError('invalid-email');
      const profile = cleanProfile({ name: input?.name }, { requireName: true });
      checkNewPassword(input?.password);
      if (users.some(u => u.email === email)) throw new AccountError('email-taken', 409);
      if (!mailer.configured) throw new AccountError('email-not-configured', 503);
      const code = randomBytes(18).toString('base64url');
      const invite = {
        id: randomUUID(), hash: sha256(code), role, email, name: profile.name, password: await hashPassword(input.password), sealed: seal(input.password),
        expires: now() + INVITE_DAYS * 86400000, createdAt: now(), by: admin.name,
      };
      const link = `${origin}/?invite=${encodeURIComponent(code)}`;
      try { await mailer.send({ to: email, ...inviteEmail({ link, name: profile.name, by: admin.name, role, lang: input?.lang, days: INVITE_DAYS }) }); }
      catch (e) { console.error('[email]', e.message); throw new AccountError('email-failed', 502); }
      // A new invitation for the same email replaces the old one.
      await store.setSetting('invites', [...(await loadInvites()).filter(i => i.email !== email), invite]);
      return { invite: publicInvite(invite), link };
    },

    /** Sends a waiting invitation again with a fresh link (the old link stops working). */
    async resendInvite(admin, id, lang, origin) {
      if (!mailer.configured) throw new AccountError('email-not-configured', 503);
      const invites = await loadInvites();
      const invite = invites.find(i => i.id === id);
      if (!invite) throw new AccountError('invite-invalid', 404);
      const code = randomBytes(18).toString('base64url');
      const link = `${origin}/?invite=${encodeURIComponent(code)}`;
      try { await mailer.send({ to: invite.email, ...inviteEmail({ link, name: invite.name, by: admin.name, role: invite.role, lang, days: INVITE_DAYS }) }); }
      catch (e) { console.error('[email]', e.message); throw new AccountError('email-failed', 502); }
      invite.hash = sha256(code);
      invite.expires = now() + INVITE_DAYS * 86400000;
      await store.setSetting('invites', invites);
      return { invite: publicInvite(invite), link };
    },

    /** What the invitation page shows before the password is typed. */
    async previewInvite(code) {
      const invite = (await loadInvites()).find(i => i.hash === sha256(String(code ?? '')));
      if (!invite) throw new AccountError('invite-invalid', 404);
      return { email: invite.email, name: invite.name, role: invite.role, by: invite.by, expires: invite.expires };
    },

    /** The link's code plus the password the admin chose: the account is made and signed in. */
    async acceptInvite(input, key = 'any') {
      await ready;
      limit(key);
      const invites = await loadInvites();
      const invite = invites.find(i => i.hash === sha256(String(input?.invite ?? '')));
      if (!invite) { fail(key); throw new AccountError('invite-invalid', 403); }
      if (!invite.password || !await checkPassword(String(input?.password ?? ''), invite.password)) { fail(key); throw new AccountError('bad-credentials', 401); }
      await store.setSetting('invites', invites.filter(i => i.id !== invite.id)); // one use only
      if (users.some(u => u.email === invite.email)) throw new AccountError('email-taken', 409);
      const user = { id: randomUUID(), email: invite.email, password: invite.password, createdAt: now(), role: invite.role, name: invite.name };
      await store.saveUser(user);
      users.push(user);
      if (invite.sealed) await remember(user.id, { sealed: invite.sealed, by: invite.by, self: false });
      failures.delete(key);
      return { user: publicUser(user), token: await newSession(user) };
    },

    async listInvites() { return (await loadInvites()).map(publicInvite); },

    async revokeInvite(id) { await store.setSetting('invites', (await loadInvites()).filter(i => i.id !== id)); },

    /** Saves part of the account's settings (dashboard, lock, language, theme), merged into the rest. */
    /**
     * The dashboard settings (limits, energy, currency…) a viewer sees: the first admin's.
     * A viewer looks only, so they get the system's values and cannot change them.
     */
    viewFor(user) {
      const out = publicUser(user);
      if (user.role !== 'viewer') return out;
      const admin = [...users].filter(u => u.role === 'admin').sort((a, b) => a.createdAt - b.createdAt)[0];
      return { ...out, prefs: { ...out.prefs, settings: admin?.prefs?.settings ?? {} } };
    },

    async savePrefs(user, patch) {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new AccountError('invalid-field');
      // Language, theme, lock and data source are personal; the dashboard settings are not.
      if (user.role === 'viewer' && 'settings' in patch) throw new AccountError('forbidden', 403);
      const next = { ...(user.prefs ?? {}), ...patch };
      if (JSON.stringify(next).length > MAX_PREFS) throw new AccountError('invalid-field');
      user.prefs = next;
      await store.saveUser(user);
      return this.viewFor(user);
    },

    /** Turning two-step sign-in on starts with a code to the account's email, proving it works. */
    async startOtp(user, lang) { return issue(user, 'enable', lang); },

    async enableOtp(user, input, key = 'any') {
      const c = checkCode(input, 'enable', key);
      if (c.userId !== user.id) throw new AccountError('otp-expired', 400);
      user.otpEmail = true;
      await store.saveUser(user);
      return publicUser(user);
    },

    async disableOtp(user, password) {
      if (!await checkPassword(String(password ?? ''), user.password)) throw new AccountError('wrong-password', 403);
      user.otpEmail = false;
      await store.saveUser(user);
      return publicUser(user);
    },

    /** The signed-in user for a session token, or null. */
    async userFor(token) {
      return (await this.sessionFor(token))?.user ?? null;
    },

    /** The session and its user, so callers can see whether the screen is locked. */
    async sessionFor(token) {
      await ready;
      if (!token) return null;
      const session = sessions.find(x => x.hash === sha256(token) && x.expires > now());
      const user = session && users.find(u => u.id === session.userId);
      return user ? { session, user } : null;
    },

    /** Locks this session: the dashboard stays closed until the password is typed again. */
    async lock(token) {
      const found = await this.sessionFor(token);
      if (!found) throw new AccountError('signed-out', 401);
      found.session.locked = true;
      await store.saveSession(found.session);
    },

    /**
     * Opens a locked session. With a lock-screen PIN set, `method: 'code'` checks the PIN;
     * the account password always works too (like "sign-in options" on Windows).
     */
    async unlock(token, input, key = 'any') {
      const found = await this.sessionFor(token);
      if (!found) throw new AccountError('signed-out', 401);
      limit(key);
      const { user } = found;
      const secret = String(input?.secret ?? input?.password ?? '');
      const usePin = input?.method === 'code' && user.lockCode;
      if (!await checkPassword(secret, usePin ? user.lockCode : user.password)) { fail(key); throw new AccountError(usePin ? 'wrong-code' : 'wrong-password', 403); }
      failures.delete(key);
      found.session.locked = false;
      await store.saveSession(found.session);
    },

    async logout(token) {
      await ready;
      const hash = sha256(token ?? '');
      await store.deleteSession(hash);
      sessions = sessions.filter(s => s.hash !== hash);
    },

    async updateProfile(user, input) {
      Object.assign(user, cleanProfile(input, { requireName: false }));
      await store.saveUser(user);
      return publicUser(user);
    },

    async changePassword(user, input, keepToken) {
      if (!await checkPassword(String(input?.current ?? ''), user.password)) throw new AccountError('wrong-password', 403);
      checkNewPassword(input.next);
      user.password = await hashPassword(input.next);
      await store.saveUser(user);
      await remember(user.id, { sealed: null, by: user.name, self: true });
      // Sign out everywhere else.
      const keep = sha256(keepToken ?? '');
      await store.deleteUserSessions(user.id, keep);
      sessions = sessions.filter(s => s.userId !== user.id || s.hash === keep);
    },

    /** Sets (or with code null, removes) a lock-screen PIN, confirmed by the account password. */
    async setLockCode(user, input) {
      if (!await checkPassword(String(input?.password ?? ''), user.password)) throw new AccountError('wrong-password', 403);
      if (input?.code === null) delete user.lockCode;
      else {
        const code = input?.code;
        if (typeof code !== 'string' || code.length < 4 || code.length > 32) throw new AccountError('weak-code');
        user.lockCode = await hashPassword(code);
      }
      await store.saveUser(user);
      return publicUser(user);
    },

    async setAvatar(user, buf) {
      if (buf.length > MAX_AVATAR) throw new AccountError('too-large', 413);
      const kind = imageType(buf);
      if (!kind) throw new AccountError('bad-image', 415);
      await store.putAvatar(user.id, kind.type, buf);
      user.avatar = { ext: kind.ext, type: kind.type, version: now() };
      await store.saveUser(user);
      return publicUser(user);
    },

    async removeAvatar(user) {
      await store.deleteAvatar(user.id);
      delete user.avatar;
      await store.saveUser(user);
      return publicUser(user);
    },

    async avatar(id) {
      await ready;
      const user = users.find(u => u.id === id);
      if (!user?.avatar) return null;
      return store.getAvatar(user.id);
    },

    async deleteAccount(user, password) {
      if (!await checkPassword(String(password ?? ''), user.password)) throw new AccountError('wrong-password', 403);
      // In PostgreSQL the user's sessions and photo go with it (on delete cascade).
      await store.deleteUser(user.id);
      await remember(user.id, null);
      users = users.filter(u => u.id !== user.id);
      sessions = sessions.filter(s => s.userId !== user.id);
    },
  };
  for (const name of ['acceptInvite', 'login', 'verifyLogin', 'resendCode', 'startOtp', 'enableOtp', 'requestReset', 'resetPassword', 'unlock']) {
    const method = api[name];
    api[name] = async function (...args) {
      await ready;
      try { return await method.apply(this, args); }
      finally { await saveState(); }
    };
  }
  return api;
}

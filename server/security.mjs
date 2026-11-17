import { createHash, randomBytes } from 'node:crypto';
import { securityEmail } from './mailer.mjs';

/**
 * The security log and sign-in notices.
 *
 * Audit log (setting audit_log): who did what and when: sign-ins, failed and blocked
 * sign-ins, sign-ins from a new device, role and user changes, passwords an admin looked
 * at or set, device keys, alert and support settings. Newest first, the last KEEP entries.
 * Only admins can read it. It never holds a password, key or code.
 *
 * Known devices (setting known_devices): each browser gets a random id in an HttpOnly
 * cookie. Only its hash is kept, per user. A sign-in from a browser the account has not
 * used before emails the owner (not on the account's very first sign-in).
 */
export const DEVICE_COOKIE = 'kelvin_device';
export const DEVICE_DAYS = 400;
const KEEP = 400, DEVICES_PER_USER = 12;
const TZ = process.env.KELVIN_TIMEZONE || 'Asia/Kuala_Lumpur';
const sha256 = s => createHash('sha256').update(s).digest('hex');

export const AUDIT_ACTIONS = [
  'login', 'login-failed', 'login-blocked', 'account-locked', 'new-device', 'logout',
  'password-changed', 'password-reset', 'otp-on', 'otp-off', 'account-deleted',
  'invite-sent', 'invite-resent', 'invite-revoked', 'invite-accepted', 'role-changed', 'user-removed',
  'password-viewed', 'password-set',
  'key-created', 'key-rotated', 'key-revoked', 'device-command',
  'alerts-changed', 'support-changed', 'settings-changed',
];

/** A short, readable name for a browser from its User-Agent ("Edge on Windows"). */
export function browserName(ua = '') {
  const b = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /curl|node|python/i.test(ua) ? 'Script' : 'Browser';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${b} · ${os}` : b;
}

export function createSecurity({ store, mailer, now = Date.now, log = console.error }) {
  const actorOf = user => (user ? { id: user.id, name: user.name || user.email, email: user.email } : null);

  /** Adds one entry. Never throws: the log must not break what it records. */
  async function record(action, { actor = null, target = null, ip = '', ua = '', detail = '' } = {}) {
    try {
      const list = (await store.getSetting('audit_log')) ?? [];
      const entry = {
        id: randomBytes(8).toString('hex'), at: now(), action,
        actor: actorOf(actor), target: target ? (typeof target === 'string' ? { name: target } : actorOf(target)) : null,
        ip: String(ip).slice(0, 64), browser: ua ? browserName(ua) : '', detail: String(detail).slice(0, 200),
      };
      await store.setSetting('audit_log', [entry, ...(Array.isArray(list) ? list : [])].slice(0, KEEP));
      return entry;
    } catch (e) { log('[audit]', e.message); return null; }
  }

  async function list({ action, limit = 200 } = {}) {
    const all = (await store.getSetting('audit_log')) ?? [];
    return (Array.isArray(all) ? all : []).filter(e => !action || e.action === action).slice(0, limit);
  }

  async function notify(user, kind, { ip, ua, link }) {
    if (!mailer?.configured || !user?.email) return false;
    const lang = ['ar', 'en', 'ms'].includes(user.prefs?.lang) ? user.prefs.lang : 'ar';
    const when = new Date(now()).toLocaleString(lang === 'ar' ? 'ar-IQ' : lang === 'ms' ? 'ms-MY' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: TZ }) + ` (${TZ})`;
    try {
      await mailer.send({ to: user.email, ...securityEmail({ kind, lang, name: user.name, when, browser: browserName(ua), ip, link }) });
      return true;
    } catch (e) { log('[security email]', e.message); return false; }
  }

  return {
    record, list, notify,

    /**
     * After a successful sign-in. `deviceId` is the browser's cookie value (may be empty).
     * Returns the id to keep in the cookie, and whether this browser was new to the account.
     */
    async signedIn(user, { deviceId, ip, ua, link }) {
      const id = /^[A-Za-z0-9_-]{20,64}$/.test(deviceId ?? '') ? deviceId : randomBytes(24).toString('base64url');
      const hash = sha256(`${user.id}:${id}`);
      let isNew = false;
      try {
        const all = (await store.getSetting('known_devices')) ?? {};
        const mine = Array.isArray(all[user.id]) ? all[user.id] : [];
        const known = mine.find(d => d.hash === hash);
        isNew = !known && mine.length > 0;
        const entry = { hash, at: now(), browser: browserName(ua) };
        all[user.id] = [entry, ...mine.filter(d => d.hash !== hash)].slice(0, DEVICES_PER_USER);
        await store.setSetting('known_devices', all);
      } catch (e) { log('[devices]', e.message); }
      await record('login', { actor: user, ip, ua });
      if (isNew) {
        await record('new-device', { actor: user, ip, ua });
        await notify(user, 'new-device', { ip, ua, link });
      }
      return { deviceId: id, isNew };
    },

    async forget(userId) {
      const all = (await store.getSetting('known_devices')) ?? {};
      if (all[userId]) { delete all[userId]; await store.setSetting('known_devices', all); }
    },
  };
}

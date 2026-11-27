import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

const sha256 = s => createHash('sha256').update(s).digest('hex');
const KEEP_COMMANDS = 30;
const ROTATE_GRACE = 24 * 3600000;
const SEEN_EVERY = 60000; // "key last used" is saved at most once a minute

/**
 * Commands the dashboard can send to the ESP32, and what each accepts.
 * The reading schedule is fixed (every 90 minutes, server/schedule.mjs), so it is not a command.
 * They reach the device in the reply to its next reading; it confirms them in the reading after.
 */
export const COMMANDS = {
  beep: v => Number.isInteger(v) && v >= 1 && v <= 5,
  led: v => ['on', 'off', 'blink'].includes(v),
  // The SSD1306's built-in font has only plain ASCII letters.
  message: v => typeof v === 'string' && /^[\x20-\x7E]{1,40}$/.test(v),
  reboot: v => v === undefined || v === null,
};

export class DeviceError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

/**
 * Device keys and the command queue, kept in the store (settings device_keys,
 * device_commands, device_seen) so every server copy sees the same queue.
 * Keys: once at least one exists, every reading must carry one (header X-Device-Key).
 * A key is shown once when it is made; only its hash is kept.
 */
export function createDevice({ store, now = Date.now }) {
  let keys = [];
  let commands = [];
  let lastSeen = null;

  async function refresh() {
    const [k, c, s] = await Promise.all([store.getSetting('device_keys'), store.getSetting('device_commands'), store.getSetting('device_seen')]);
    keys = Array.isArray(k) ? k : [];
    commands = Array.isArray(c) ? c : [];
    lastSeen = typeof s === 'number' ? s : null;
  }
  const ready = refresh();
  const saveKeys = () => store.setSetting('device_keys', keys);
  const saveCommands = () => store.setSetting('device_commands', commands.slice(-KEEP_COMMANDS));
  const publicKey = ({ hash, ...k }) => k;

  return {
    ready,
    /** Reloads keys and commands from the store (another server copy may have changed them). */
    refresh,

    /** Checks the key a reading came with. With no keys made yet, the device is unprotected. */
    async check(headers) {
      await ready;
      if (!keys.length) { lastSeen = now(); await store.setSetting('device_seen', lastSeen); return { ok: true, protected: false }; }
      const given = String(headers['x-device-key'] ?? (headers.authorization ?? '').replace(/^Bearer\s+/i, '')).trim();
      if (!given) return { ok: false };
      const hash = Buffer.from(sha256(given));
      const t = now();
      // A replaced key keeps working for a day (time to upload the new code), then stops.
      if (keys.some(k => k.retireAt && k.retireAt <= t)) { keys = keys.filter(k => !k.retireAt || k.retireAt > t); await saveKeys(); }
      const key = keys.find(k => timingSafeEqual(Buffer.from(k.hash), hash));
      if (!key) return { ok: false };
      // The first reading with a new key ends the old one at once.
      if (key.replaces && keys.some(k => k.id === key.replaces)) {
        keys = keys.filter(k => k.id !== key.replaces);
        delete key.replaces;
        await saveKeys();
      }
      lastSeen = t;
      await store.setSetting('device_seen', t);
      if (!key.lastUsed || t - key.lastUsed > SEEN_EVERY) { key.lastUsed = t; await saveKeys(); }
      return { ok: true, protected: true, keyId: key.id };
    },

    async createKey(label, by) {
      await ready;
      const key = `kv_${randomBytes(18).toString('base64url')}`;
      const entry = { id: randomUUID(), label: String(label || 'ESP32').slice(0, 40), hash: sha256(key), hint: key.slice(-4), createdAt: now(), by, lastUsed: null };
      keys = [...keys, entry];
      await saveKeys();
      return { key, entry: publicKey(entry) };
    },

    /**
     * Replaces a key: a new key is made now, and the old one keeps working until the device
     * first uses the new one, or for 24 hours at most. The new key is shown once.
     */
    async rotateKey(id, by) {
      await ready;
      const old = keys.find(k => k.id === id);
      if (!old) throw new DeviceError('no-key', 404);
      const key = `kv_${randomBytes(18).toString('base64url')}`;
      const entry = { id: randomUUID(), label: old.label, hash: sha256(key), hint: key.slice(-4), createdAt: now(), by, lastUsed: null, replaces: old.id };
      old.retireAt = now() + ROTATE_GRACE;
      keys = [...keys, entry];
      await saveKeys();
      return { key, entry: publicKey(entry), old: publicKey(old) };
    },

    async revokeKey(id) { await ready; keys = keys.filter(k => k.id !== id); await saveKeys(); },

    async status() {
      await ready;
      return { protected: keys.length > 0, keys: keys.map(publicKey), lastSeen, commands: commands.slice(-KEEP_COMMANDS).reverse() };
    },

    async add(type, value, by) {
      await ready;
      if (!(type in COMMANDS)) throw new DeviceError('bad-command');
      if (!COMMANDS[type](value)) throw new DeviceError('bad-command-value');
      const command = { id: randomUUID().slice(0, 8), type, value: value ?? null, by, createdAt: now(), status: 'pending' };
      commands = [...commands, command].slice(-KEEP_COMMANDS);
      await saveCommands();
      return command;
    },

    /**
     * Commands for the device's next reply. Each goes out once (a restart could never
     * confirm itself, so resending would restart the device forever); the device then
     * confirms it with its next reading.
     */
    async deliver() {
      await ready;
      const out = [];
      for (const c of commands) if (c.status === 'pending') { c.status = 'sent'; c.sentAt = now(); out.push({ id: c.id, type: c.type, value: c.value }); }
      if (out.length) await saveCommands();
      return out;
    },

    /** The device lists the ids it carried out. */
    async acknowledge(ids) {
      if (!Array.isArray(ids) || !ids.length) return;
      await ready;
      let changed = false;
      for (const c of commands) if (ids.includes(c.id) && c.status !== 'done') { c.status = 'done'; c.doneAt = now(); changed = true; }
      if (changed) await saveCommands();
    },

    async cancel(id) {
      await ready;
      const c = commands.find(x => x.id === id && x.status === 'pending');
      if (c) { c.status = 'cancelled'; await saveCommands(); }
    },
  };
}

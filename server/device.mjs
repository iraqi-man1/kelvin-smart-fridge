import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

const sha256 = s => createHash('sha256').update(s).digest('hex');
const ROTATE_GRACE = 24 * 3600000;
const SEEN_EVERY = 60000; // "key last used" is saved at most once a minute

export class DeviceError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

/**
 * Device keys and when the device was last seen, kept in the store (settings device_keys,
 * device_seen) so every server copy sees the same. The dashboard sends the device no commands.
 * Keys: once at least one exists, every reading must carry one (header X-Device-Key).
 * A key is shown once when it is made; only its hash is kept.
 */
export function createDevice({ store, now = Date.now }) {
  let keys = [];
  let lastSeen = null;

  async function refresh() {
    const [k, s] = await Promise.all([store.getSetting('device_keys'), store.getSetting('device_seen')]);
    keys = Array.isArray(k) ? k : [];
    lastSeen = typeof s === 'number' ? s : null;
  }
  const ready = refresh();
  const saveKeys = () => store.setSetting('device_keys', keys);
  const publicKey = ({ hash, ...k }) => k;

  return {
    ready,
    /** Reloads keys from the store (another server copy may have changed them). */
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
      return { protected: keys.length > 0, keys: keys.map(publicKey), lastSeen };
    },

  };
}

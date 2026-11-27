import { networkInterfaces } from 'node:os';
import { normalizeReading } from './readings.mjs';
import { createAlerts } from './alerts.mjs';
import { AccountError, can, createAccounts, SESSION_COOKIE, SESSION_DAYS } from './accounts.mjs';
import { createDevice, DeviceError } from './device.mjs';
import { openStore } from './store.mjs';
import { createMailer } from './mailer.mjs';
import { createSupport, SupportError } from './support.mjs';
import { createActivity } from './activity.mjs';
import { createSecurity, DEVICE_COOKIE, DEVICE_DAYS } from './security.mjs';
import { isDue, nextSlot, READING_EVERY } from './schedule.mjs';

/**
 * Kelvin's API, shared by the local server (server.mjs) and the online functions
 * (server/web.mjs, used by netlify/functions/api.mjs and api/index.mjs on Vercel). `handle(req, res)` answers /api/* and returns false for
 * anything else, so the caller can serve the pages.
 *
 * serverless: true online (Netlify or Vercel), where many short-lived copies may run at once. Nothing is
 * trusted from memory there: each request reloads the state it needs from the database.
 */
export async function createApp({ dataDir, readingsFile, databaseUrl, serverless = false, port = 5173, log = console.log }) {
  const store = await openStore({ dataDir, readingsFile, databaseUrl, serverless, log });
  const storageLabel = store.kind === 'postgres' ? (/supabase\.(co|com)/.test(databaseUrl ?? '') ? 'Supabase (PostgreSQL)' : 'PostgreSQL') : 'JSON files';
  log(`[database] ${storageLabel}`);
  // Locally the latest 2,000 readings stay in memory; on Netlify they are read from the database.
  let readings = serverless ? [] : await store.recentReadings(2000);
  const settingsIO = key => ({ load: () => store.getSetting(key), save: value => store.setSetting(key, value) });
  const alerts = createAlerts({ ...settingsIO('alerts'), loadState: () => store.getSetting('alerts_state'), saveState: s => store.setSetting('alerts_state', s) });
  const mailer = createMailer();
  log(`[email] ${mailer.configured ? 'sending is set up' : 'not set up (two-step sign-in stays off)'}`);
  const security = createSecurity({ store, mailer });
  // Admin-set passwords are sealed with VAULT_KEY. Older entries sealed with the database
  // address (before VAULT_KEY was set) are still read and re-sealed with VAULT_KEY.
  const vaultKey = process.env.VAULT_KEY || databaseUrl || 'kelvin-local';
  const accounts = createAccounts({
    store, mailer, vaultKey, oldVaultKeys: [databaseUrl, 'kelvin-local'],
    onLocked: async user => {
      await security.record('account-locked', { target: user });
      await security.notify(user, 'locked', {});
    },
  });
  const device = createDevice({ store });
  const support = createSupport({ store });
  const activity = createActivity({ store });
  // Badges must never break a request.
  const note = (userId, event) => (event ? activity.record(userId, event) : activity.seen(userId)).catch(e => console.error('[activity]', e.message));

  function json(res, status, data, headers = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', ...headers });
    res.end(JSON.stringify(data));
  }

  class TooLarge extends Error {}
  async function body(req, limit) {
    let size = 0; const chunks = [];
    for await (const chunk of req) { size += chunk.length; if (size > limit) throw new TooLarge(); chunks.push(chunk); }
    return Buffer.concat(chunks);
  }
  const jsonBody = async (req, limit = 8192) => JSON.parse((await body(req, limit)).toString('utf8') || '{}');

  // Browsers send Origin on cross-site writes; a different host means another site is trying.
  function foreignOrigin(req) {
    if (!req.headers.origin) return false;
    try { return new URL(req.headers.origin).host !== req.headers.host; } catch { return true; }
  }
  // Behind Netlify the caller's address is in a header; locally it is the socket's.
  const clientIp = req => req.headers['x-nf-client-connection-ip'] || String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket?.remoteAddress || 'any';
  const https = req => serverless || req.headers['x-forwarded-proto'] === 'https';
  const origin = req => `${https(req) ? 'https' : 'http'}://${req.headers.host}`;

  function cookie(req, name) {
    for (const part of (req.headers.cookie || '').split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k === name) return decodeURIComponent(v.join('='));
    }
    return null;
  }
  const sessionToken = req => cookie(req, SESSION_COOKIE);
  const ua = req => String(req.headers['user-agent'] ?? '').slice(0, 300);
  /** Who did it, from where: added to every audit entry made for a request. */
  const ctx = (req, extra = {}) => ({ ip: clientIp(req), ua: ua(req), ...extra });
  const audit = (action, req, extra) => security.record(action, ctx(req, extra));
  // On HTTPS the cookie is also Secure, so it never travels unencrypted.
  const setSession = (req, token) => ({ 'Set-Cookie': `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${https(req) ? '; Secure' : ''}` });
  // After any sign-in: the session cookie, plus the browser's device id (for new-device notices).
  async function signedIn(req, user, token) {
    const { deviceId } = await security.signedIn(user, { deviceId: cookie(req, DEVICE_COOKIE), ip: clientIp(req), ua: ua(req), link: origin(req) });
    const device = `${DEVICE_COOKIE}=${deviceId}; HttpOnly; SameSite=Lax; Path=/api/; Max-Age=${DEVICE_DAYS * 86400}${https(req) ? '; Secure' : ''}`;
    return { 'Set-Cookie': [setSession(req, token)['Set-Cookie'], device] };
  }
  const clearSession = req => ({ 'Set-Cookie': `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${https(req) ? '; Secure' : ''}` });

  async function handleAccount(req, res, url) {
    const p = url.pathname, m = req.method;
    if (m !== 'GET' && foreignOrigin(req)) return json(res, 403, { error: 'Same-origin requests only.' });
    const token = sessionToken(req);
    const ip = clientIp(req);

    if (p === '/api/auth/signup-info' && m === 'GET') return json(res, 200, await accounts.signupInfo());
    if (p === '/api/auth/invite' && m === 'GET') return json(res, 200, await accounts.previewInvite(url.searchParams.get('code')));
    if (p === '/api/auth/invite' && m === 'POST') {
      const { user, token: t } = await accounts.acceptInvite(await jsonBody(req), ip);
      await note(user.id, 'login');
      await audit('invite-accepted', req, { actor: user });
      return json(res, 201, { user }, await signedIn(req, user, t));
    }
    if (p === '/api/auth/register' && m === 'POST') {
      const { user, token: t } = await accounts.register(await jsonBody(req));
      await note(user.id, 'login');
      return json(res, 201, { user }, await signedIn(req, user, t));
    }
    if (p === '/api/auth/login' && m === 'POST') {
      const input = await jsonBody(req);
      let result;
      try { result = await accounts.login(input, ip); } catch (error) {
        // Failed and blocked sign-ins go in the security log (the email typed, never the password).
        const tried = typeof input?.email === 'string' ? input.email.trim().toLowerCase().slice(0, 120) : '';
        if (error?.code === 'bad-credentials') await audit('login-failed', req, { detail: tried });
        if (error?.code === 'too-many') await audit('login-blocked', req, { detail: tried });
        throw error;
      }
      // Two-step sign-in: no session yet, the browser asks for the emailed code.
      if (result.otp) return json(res, 202, { otp: result.otp });
      await note(result.user.id, 'login');
      return json(res, 200, { user: result.user }, await signedIn(req, result.user, result.token));
    }
    if (p === '/api/auth/otp/verify' && m === 'POST') {
      const { user, token: t } = await accounts.verifyLogin(await jsonBody(req), ip);
      await note(user.id, 'login');
      return json(res, 200, { user }, await signedIn(req, user, t));
    }
    if (p === '/api/auth/reset/request' && m === 'POST') return json(res, 200, { otp: await accounts.requestReset(await jsonBody(req)) });
    if (p === '/api/auth/reset/confirm' && m === 'POST') {
      const { user, token: t } = await accounts.resetPassword(await jsonBody(req), ip);
      await audit('password-reset', req, { actor: user });
      return json(res, 200, { user }, await signedIn(req, user, t));
    }
    if (p === '/api/auth/otp/resend' && m === 'POST') return json(res, 200, { otp: await accounts.resendCode(await jsonBody(req)) });
    if (p === '/api/auth/logout' && m === 'POST') {
      const who = await accounts.sessionFor(token);
      await accounts.logout(token);
      if (who) await audit('logout', req, { actor: who.user });
      return json(res, 200, { ok: true }, clearSession(req));
    }

    const found = await accounts.sessionFor(token);
    if (!found) return json(res, 401, { error: 'signed-out' });
    const { user, session } = found;

    if (p === '/api/me' && m === 'GET') {
      if (!session.locked) await note(user.id);
      return json(res, 200, { user: accounts.viewFor(user), locked: !!session.locked });
    }
    if (p === '/api/auth/lock' && m === 'POST') { await accounts.lock(token); return json(res, 200, { locked: true }); }
    if (p === '/api/auth/unlock' && m === 'POST') { await accounts.unlock(token, await jsonBody(req), ip); return json(res, 200, { locked: false }); }
    // The lock screen shows the photo; nothing else about the account is reachable while locked.
    if (p.startsWith('/api/avatar/') && m === 'GET') {
      const img = await accounts.avatar(p.slice('/api/avatar/'.length));
      if (!img) return json(res, 404, { error: 'Not found.' });
      res.writeHead(200, { 'Content-Type': img.type, 'Cache-Control': 'private, max-age=31536000', 'X-Content-Type-Options': 'nosniff' });
      return res.end(img.data);
    }
    if (session.locked) return json(res, 423, { error: 'locked' });

    if (p === '/api/me' && m === 'PUT') return json(res, 200, { user: await accounts.updateProfile(user, await jsonBody(req)) });
    if (p === '/api/me' && m === 'DELETE') {
      await accounts.deleteAccount(user, (await jsonBody(req)).password);
      await activity.forget(user.id); await security.forget(user.id);
      await audit('account-deleted', req, { actor: user });
      return json(res, 200, { ok: true }, clearSession(req));
    }
    // Badges: usage numbers, and the one event the browser reports itself (an Excel export).
    if (p === '/api/me/activity' && m === 'GET') return json(res, 200, { stats: await activity.stats(user) });
    if (p === '/api/me/activity' && m === 'POST') { if ((await jsonBody(req)).event === 'export') await note(user.id, 'export'); return json(res, 200, { stats: await activity.stats(user) }); }
    if (p === '/api/me/prefs' && m === 'PUT') {
      const patch = await jsonBody(req, 32768);
      const before = JSON.stringify(user.prefs?.settings ?? {});
      const saved = await accounts.savePrefs(user, patch);
      // The admin's thresholds apply to everyone: a real change is worth a line in the log.
      if (patch && typeof patch === 'object' && 'settings' in patch && before !== '{}' && JSON.stringify(saved.prefs?.settings ?? {}) !== before) await audit('settings-changed', req, { actor: user });
      return json(res, 200, { user: saved });
    }
    if (p === '/api/me/otp/start' && m === 'POST') return json(res, 200, { otp: await accounts.startOtp(user, (await jsonBody(req)).lang) });
    if (p === '/api/me/otp/enable' && m === 'POST') { const u = await accounts.enableOtp(user, await jsonBody(req), ip); await audit('otp-on', req, { actor: user }); return json(res, 200, { user: u }); }
    if (p === '/api/me/otp/disable' && m === 'POST') { const u = await accounts.disableOtp(user, (await jsonBody(req)).password); await audit('otp-off', req, { actor: user }); return json(res, 200, { user: u }); }
    if (p === '/api/me/lock-code' && m === 'PUT') return json(res, 200, { user: await accounts.setLockCode(user, await jsonBody(req)) });
    if (p === '/api/me/password' && m === 'PUT') { await accounts.changePassword(user, await jsonBody(req), token); await audit('password-changed', req, { actor: user }); return json(res, 200, { ok: true }); }
    if (p === '/api/me/avatar' && m === 'POST') return json(res, 200, { user: await accounts.setAvatar(user, await body(req, 2 * 1024 * 1024 + 1)) });
    if (p === '/api/me/avatar' && m === 'DELETE') return json(res, 200, { user: await accounts.removeAvatar(user) });
    return null;
  }

  async function handle(req, res) {
    const url = new URL(req.url || '/', 'http://localhost');
    const p = url.pathname;
    if (!p.startsWith('/api/')) return false;
    try {
      // On Netlify another copy may have changed things: start from the database.
      if (serverless) await Promise.all([accounts.refresh(), device.refresh(), alerts.refresh()]);

      if (p.startsWith('/api/auth/') || p === '/api/me' || p.startsWith('/api/me/') || p.startsWith('/api/avatar/')) {
        const handled = await handleAccount(req, res, url);
        if (handled === null) json(res, 404, { error: 'Not found.' });
        return true;
      }

      // The ESP32 posts readings without signing in; everything else needs a session.
      const deviceIngest = p === '/api/readings' && req.method === 'POST';
      let me = null;
      // A reading sent from a browser (it has an Origin) must come from someone allowed to
      // control the device, never from a viewer. The ESP32 sends no Origin.
      if (deviceIngest && req.headers.origin) {
        const found = await accounts.sessionFor(sessionToken(req));
        if (!found || !can(found.user, 'control')) { json(res, 403, { error: 'forbidden' }); return true; }
      }
      if (!deviceIngest) {
        const found = await accounts.sessionFor(sessionToken(req));
        if (!found) { json(res, 401, { error: 'signed-out' }); return true; }
        if (found.session.locked) { json(res, 423, { error: 'locked' }); return true; }
        me = found.user;
        if (req.method !== 'GET' && foreignOrigin(req)) { json(res, 403, { error: 'Same-origin requests only.' }); return true; }
      }
      const allowed = action => can(me, action);
      const forbidden = () => { json(res, 403, { error: 'forbidden' }); return true; };
      const reply = (status, data, headers) => { json(res, status, data, headers); return true; };

      // ----- IT support: everyone can report; the admin links the IT team's bot -----
      if (p === '/api/support' && req.method === 'GET') {
        return reply(200, { config: await support.getPublic(), tickets: await support.list(me, allowed('manage')) });
      }
      if (p === '/api/support' && req.method === 'POST') {
        const ticket = await support.report(me, await jsonBody(req));
        await note(me.id, 'report');
        return reply(201, { ticket });
      }
      if (p === '/api/support/config' && req.method === 'PUT') {
        if (!allowed('manage')) return forbidden();
        const config = await support.update(await jsonBody(req));
        await audit('support-changed', req, { actor: me });
        return reply(200, { config });
      }
      if (p === '/api/support/test' && req.method === 'POST') {
        if (!allowed('manage')) return forbidden();
        await support.test();
        return reply(200, { ok: true });
      }

      // ----- Device: status, keys (admin) -----
      if (p === '/api/device' && req.method === 'GET') return reply(200, await device.status());
      if (p === '/api/device/keys' && req.method === 'POST') {
        if (!allowed('manage')) return forbidden();
        const made = await device.createKey((await jsonBody(req)).label, me.name);
        await audit('key-created', req, { actor: me, detail: `…${made.entry.hint}` });
        return reply(201, made);
      }
      if (/^\/api\/device\/keys\/[^/]+\/rotate$/.test(p) && req.method === 'POST') {
        if (!allowed('manage')) return forbidden();
        const made = await device.rotateKey(p.split('/')[4], me.name);
        await audit('key-rotated', req, { actor: me, detail: `…${made.old.hint} → …${made.entry.hint}` });
        return reply(201, made);
      }
      if (p.startsWith('/api/device/keys/') && req.method === 'DELETE') {
        if (!allowed('manage')) return forbidden();
        const id = p.split('/').pop();
        const gone = (await device.status()).keys.find(k => k.id === id);
        await device.revokeKey(id);
        if (gone) await audit('key-revoked', req, { actor: me, detail: `…${gone.hint}` });
        return reply(200, await device.status());
      }

      // ----- Admin: users, roles, invitations, sign-up mode -----
      if (p.startsWith('/api/admin/')) {
        if (!allowed('manage')) return forbidden();
        const id = p.split('/')[4];
        if (p === '/api/admin/users' && req.method === 'GET') {
          return reply(200, { users: await accounts.listUsers(), invites: await accounts.listInvites() });
        }
        if (p === '/api/admin/audit' && req.method === 'GET') return reply(200, { entries: await security.list({ limit: 400 }) });
        const target = async () => (await accounts.listUsers()).find(u => u.id === id) ?? null;
        if (/^\/api\/admin\/users\/[^/]+\/password$/.test(p) && req.method === 'GET') {
          const out = await accounts.revealPassword(id);
          await audit('password-viewed', req, { actor: me, target: await target() });
          return reply(200, out);
        }
        if (/^\/api\/admin\/users\/[^/]+\/password$/.test(p) && req.method === 'PUT') {
          const out = await accounts.setPassword(me, id, (await jsonBody(req)).password);
          await audit('password-set', req, { actor: me, target: await target() });
          return reply(200, out);
        }
        if (/^\/api\/admin\/invites\/[^/]+\/resend$/.test(p) && req.method === 'POST') {
          const out = await accounts.resendInvite(me, id, (await jsonBody(req)).lang, origin(req));
          await audit('invite-resent', req, { actor: me, target: out.invite?.email ?? '' });
          return reply(200, out);
        }
        if (p.startsWith('/api/admin/users/') && req.method === 'PUT') {
          const role = (await jsonBody(req)).role;
          const user = await accounts.setRole(me, id, role);
          await audit('role-changed', req, { actor: me, target: user, detail: String(role) });
          return reply(200, { user });
        }
        if (p.startsWith('/api/admin/users/') && req.method === 'DELETE') {
          const who = await target();
          await accounts.removeUser(me, id);
          await security.forget(id);
          await audit('user-removed', req, { actor: me, target: who });
          return reply(200, { ok: true });
        }
        if (p === '/api/admin/invites' && req.method === 'POST') {
          const out = await accounts.createInvite(me, await jsonBody(req), origin(req));
          await audit('invite-sent', req, { actor: me, target: out.invite?.email ?? '', detail: out.invite?.role ?? '' });
          return reply(201, out);
        }
        if (p.startsWith('/api/admin/invites/') && req.method === 'DELETE') {
          const inv = (await accounts.listInvites()).find(i => i.id === id);
          await accounts.revokeInvite(id);
          await audit('invite-revoked', req, { actor: me, target: inv?.email ?? '' });
          return reply(200, { ok: true });
        }
        return reply(404, { error: 'Not found.' });
      }

      if (p === '/api/info' && req.method === 'GET') {
        // Online (Netlify or Vercel) the device posts to this site's own HTTPS address.
        const ingestUrl = serverless
          ? `https://${req.headers.host}/api/readings`
          : `http://${Object.values(networkInterfaces()).flat().find(n => n && n.family === 'IPv4' && !n.internal)?.address || 'localhost'}:${port}/api/readings`;
        const d = await device.status();
        await alerts.ready;
        const lastReading = serverless ? (await store.recentReadings(1))[0] : readings.at(-1);
        return reply(200, {
          ingestUrl, sensors: ['DHT11', 'CCS811'], units: { eco2: 'ppm', tvoc: 'ppb' }, hosting: serverless ? (process.env.VERCEL ? 'vercel' : 'netlify') : 'local',
          storage: { kind: store.kind, label: storageLabel, readings: await store.countReadings() },
          schedule: { every: READING_EVERY },
          // For the "How the system works" page: what is connected right now.
          system: {
            deviceProtected: d.protected, deviceLastSeen: d.lastSeen, lastReading: lastReading?.timestamp ?? null,
            telegram: alerts.getPublic().configured && alerts.getPublic().enabled, email: mailer.configured, node: process.version,
            vaultKey: Boolean(process.env.VAULT_KEY),
          },
        });
      }
      if (p === '/api/alerts' || p === '/api/alerts/test') {
        // Telegram holds the bot token and chat: admins only.
        if (!allowed('manage')) return forbidden();
        if (req.method === 'GET' && p === '/api/alerts') { await alerts.ready; return reply(200, alerts.getPublic()); }
        if (req.method !== 'POST' && req.method !== 'PUT') { res.setHeader('Allow', 'GET, POST, PUT'); return reply(405, { error: 'Method not allowed.' }); }
        if (!req.headers.origin || foreignOrigin(req)) return reply(403, { error: 'Same-origin requests only.' });
        try {
          if (p === '/api/alerts/test') { await alerts.test((await jsonBody(req)).channel === 'ntfy' ? 'ntfy' : 'telegram'); return reply(200, { ok: true }); }
          const before = JSON.stringify(alerts.getPublic());
          await alerts.update(await jsonBody(req));
          // The dashboard also syncs limits on its own; only a real change goes in the log.
          if (JSON.stringify(alerts.getPublic()) !== before) await audit('alerts-changed', req, { actor: me });
          return reply(200, alerts.getPublic());
        } catch (error) { return reply(error instanceof TooLarge ? 413 : 400, { error: error instanceof TooLarge ? 'Payload too large.' : error.message }); }
      }
      // An earlier period for comparison: averaged into at most `points` slices.
      if (p === '/api/readings/range' && req.method === 'GET') {
        const from = Number(url.searchParams.get('from')), to = Number(url.searchParams.get('to'));
        const points = Math.min(600, Math.max(10, Number(url.searchParams.get('points')) || 300));
        if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 31 * 86400000) return reply(400, { error: 'bad-range' });
        return reply(200, { readings: await store.readingsBetween(from, to, points) });
      }
      if (p === '/api/readings') {
        if (req.method === 'GET') {
          // ?since=<ms>: only newer readings, so polling stays light.
          const since = Number(url.searchParams.get('since')) || 0;
          if (serverless) return reply(200, { readings: since ? await store.readingsSince(since, 2000) : await store.recentReadings(2000) });
          return reply(200, { readings: since ? readings.filter(r => r.timestamp > since) : readings });
        }
        if (req.method === 'POST') {
          // ESP32 requests have no Origin. Browser requests must come from this host.
          if (foreignOrigin(req)) return reply(403, { error: 'Cross-origin ingest is not allowed.' });
          if (!req.headers['content-type']?.includes('application/json')) return reply(415, { error: 'Use Content-Type: application/json.' });
          // Once a device key exists, a reading without the right key is refused.
          const key = await device.check(req.headers);
          if (!key.ok) return reply(401, { error: 'device-key' });
          try {
            const data = await jsonBody(req);
            const reading = normalizeReading(data);
            // Fixed schedule: only the first reading of each one-minute slot is kept (a device that
            // restarts mid-slot may send a second one; it is not saved). The reply says when the next is due.
            const last = serverless ? (await store.recentReadings(1))[0] : readings.at(-1);
            const saved = isDue(reading.timestamp, last?.timestamp);
            if (saved) {
              await store.insertReading(reading);
              if (!serverless) readings = [...readings, reading].slice(-2000);
              // Finished before replying: on Netlify the function may stop right after the reply.
              await alerts.check(reading);
            }
            const next = nextSlot(reading.timestamp);
            return reply(saved ? 201 : 200, {
              ok: true, saved, ...(saved ? { reading } : {}), nextAt: next, nextIn: Math.ceil((next - reading.timestamp) / 1000),
            });
          } catch (error) {
            if (error instanceof TooLarge) return reply(413, { error: 'Payload too large.' });
            return reply(error.code ? 500 : 400, { error: error.code ? 'Unable to save reading.' : error.message });
          }
        }
        res.setHeader('Allow', 'GET, POST'); return reply(405, { error: 'Method not allowed.' });
      }
      return reply(404, { error: 'Not found.' });
    } catch (error) {
      if (error instanceof AccountError || error instanceof DeviceError || error instanceof SupportError) { json(res, error.status, { error: error.code }); return true; }
      if (error instanceof TooLarge) { json(res, 413, { error: 'too-large' }); return true; }
      if (error instanceof SyntaxError) { json(res, 400, { error: 'Invalid JSON.' }); return true; }
      console.error('[server]', error);
      json(res, 500, { error: 'Server error.' });
      return true;
    }
  }

  return { handle, close: () => store.close(), storageLabel };
}

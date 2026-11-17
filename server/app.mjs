import { networkInterfaces } from 'node:os';
import { normalizeReading } from './readings.mjs';
import { createAlerts } from './alerts.mjs';
import { AccountError, can, createAccounts, SESSION_COOKIE, SESSION_DAYS } from './accounts.mjs';
import { createDevice, DeviceError } from './device.mjs';
import { openStore } from './store.mjs';
import { createMailer } from './mailer.mjs';
import { createSupport, SupportError } from './support.mjs';
import { createActivity } from './activity.mjs';

/**
 * Kelvin's API, shared by the local server (server.mjs) and the Netlify function
 * (netlify/functions/api.mjs). `handle(req, res)` answers /api/* and returns false for
 * anything else, so the caller can serve the pages.
 *
 * serverless: true on Netlify, where many short-lived copies may run at once. Nothing is
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
  const accounts = createAccounts({ store, mailer, vaultKey: process.env.VAULT_KEY || databaseUrl || 'kelvin-local' });
  const device = createDevice({ store });
  const support = createSupport({ store });
  const activity = createActivity({ store });
  // Badges must never break a request.
  const note = (userId, event) => (event ? activity.record(userId, event) : activity.seen(userId)).catch(e => console.error('[activity]', e.message));

  function json(res, status, data, headers = {}) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify(data)); }

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

  function sessionToken(req) {
    for (const part of (req.headers.cookie || '').split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k === SESSION_COOKIE) return decodeURIComponent(v.join('='));
    }
    return null;
  }
  // On HTTPS the cookie is also Secure, so it never travels unencrypted.
  const setSession = (req, token) => ({ 'Set-Cookie': `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${https(req) ? '; Secure' : ''}` });
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
      return json(res, 201, { user }, setSession(req, t));
    }
    if (p === '/api/auth/register' && m === 'POST') {
      const { user, token: t } = await accounts.register(await jsonBody(req));
      await note(user.id, 'login');
      return json(res, 201, { user }, setSession(req, t));
    }
    if (p === '/api/auth/login' && m === 'POST') {
      const result = await accounts.login(await jsonBody(req), ip);
      // Two-step sign-in: no session yet, the browser asks for the emailed code.
      if (result.otp) return json(res, 202, { otp: result.otp });
      await note(result.user.id, 'login');
      return json(res, 200, { user: result.user }, setSession(req, result.token));
    }
    if (p === '/api/auth/otp/verify' && m === 'POST') {
      const { user, token: t } = await accounts.verifyLogin(await jsonBody(req), ip);
      await note(user.id, 'login');
      return json(res, 200, { user }, setSession(req, t));
    }
    if (p === '/api/auth/reset/request' && m === 'POST') return json(res, 200, { otp: await accounts.requestReset(await jsonBody(req)) });
    if (p === '/api/auth/reset/confirm' && m === 'POST') {
      const { user, token: t } = await accounts.resetPassword(await jsonBody(req), ip);
      return json(res, 200, { user }, setSession(req, t));
    }
    if (p === '/api/auth/otp/resend' && m === 'POST') return json(res, 200, { otp: await accounts.resendCode(await jsonBody(req)) });
    if (p === '/api/auth/logout' && m === 'POST') { await accounts.logout(token); return json(res, 200, { ok: true }, clearSession(req)); }

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
    if (p === '/api/me' && m === 'DELETE') { await accounts.deleteAccount(user, (await jsonBody(req)).password); await activity.forget(user.id); return json(res, 200, { ok: true }, clearSession(req)); }
    // Badges: usage numbers, and the one event the browser reports itself (an Excel export).
    if (p === '/api/me/activity' && m === 'GET') return json(res, 200, { stats: await activity.stats(user) });
    if (p === '/api/me/activity' && m === 'POST') { if ((await jsonBody(req)).event === 'export') await note(user.id, 'export'); return json(res, 200, { stats: await activity.stats(user) }); }
    if (p === '/api/me/prefs' && m === 'PUT') return json(res, 200, { user: await accounts.savePrefs(user, await jsonBody(req, 32768)) });
    if (p === '/api/me/otp/start' && m === 'POST') return json(res, 200, { otp: await accounts.startOtp(user, (await jsonBody(req)).lang) });
    if (p === '/api/me/otp/enable' && m === 'POST') return json(res, 200, { user: await accounts.enableOtp(user, await jsonBody(req), ip) });
    if (p === '/api/me/otp/disable' && m === 'POST') return json(res, 200, { user: await accounts.disableOtp(user, (await jsonBody(req)).password) });
    if (p === '/api/me/lock-code' && m === 'PUT') return json(res, 200, { user: await accounts.setLockCode(user, await jsonBody(req)) });
    if (p === '/api/me/password' && m === 'PUT') { await accounts.changePassword(user, await jsonBody(req), token); return json(res, 200, { ok: true }); }
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
        return reply(200, { config: await support.update(await jsonBody(req)) });
      }
      if (p === '/api/support/test' && req.method === 'POST') {
        if (!allowed('manage')) return forbidden();
        await support.test();
        return reply(200, { ok: true });
      }

      // ----- Device: status, commands (admin and member), keys (admin) -----
      if (p === '/api/device' && req.method === 'GET') return reply(200, await device.status());
      if (p === '/api/device/commands' && req.method === 'POST') {
        if (!allowed('control')) return forbidden();
        const { type, value } = await jsonBody(req);
        const command = await device.add(type, value, me.name);
        await note(me.id, 'command');
        return reply(201, { command });
      }
      if (p.startsWith('/api/device/commands/') && req.method === 'DELETE') {
        if (!allowed('control')) return forbidden();
        await device.cancel(p.split('/').pop());
        return reply(200, await device.status());
      }
      if (p === '/api/device/keys' && req.method === 'POST') {
        if (!allowed('manage')) return forbidden();
        return reply(201, await device.createKey((await jsonBody(req)).label, me.name));
      }
      if (p.startsWith('/api/device/keys/') && req.method === 'DELETE') {
        if (!allowed('manage')) return forbidden();
        await device.revokeKey(p.split('/').pop());
        return reply(200, await device.status());
      }

      // ----- Admin: users, roles, invitations, sign-up mode -----
      if (p.startsWith('/api/admin/')) {
        if (!allowed('manage')) return forbidden();
        const id = p.split('/')[4];
        if (p === '/api/admin/users' && req.method === 'GET') {
          return reply(200, { users: await accounts.listUsers(), invites: await accounts.listInvites() });
        }
        if (/^\/api\/admin\/users\/[^/]+\/password$/.test(p) && req.method === 'GET') return reply(200, await accounts.revealPassword(id));
        if (/^\/api\/admin\/users\/[^/]+\/password$/.test(p) && req.method === 'PUT') return reply(200, await accounts.setPassword(me, id, (await jsonBody(req)).password));
        if (/^\/api\/admin\/invites\/[^/]+\/resend$/.test(p) && req.method === 'POST') return reply(200, await accounts.resendInvite(me, id, (await jsonBody(req)).lang, origin(req)));
        if (p.startsWith('/api/admin/users/') && req.method === 'PUT') return reply(200, { user: await accounts.setRole(me, id, (await jsonBody(req)).role) });
        if (p.startsWith('/api/admin/users/') && req.method === 'DELETE') { await accounts.removeUser(me, id); return reply(200, { ok: true }); }
        if (p === '/api/admin/invites' && req.method === 'POST') return reply(201, await accounts.createInvite(me, await jsonBody(req), origin(req)));
        if (p.startsWith('/api/admin/invites/') && req.method === 'DELETE') { await accounts.revokeInvite(id); return reply(200, { ok: true }); }
        return reply(404, { error: 'Not found.' });
      }

      if (p === '/api/info' && req.method === 'GET') {
        // On Netlify the device posts to this site's own HTTPS address.
        const ingestUrl = serverless
          ? `https://${req.headers.host}/api/readings`
          : `http://${Object.values(networkInterfaces()).flat().find(n => n && n.family === 'IPv4' && !n.internal)?.address || 'localhost'}:${port}/api/readings`;
        const d = await device.status();
        await alerts.ready;
        const lastReading = serverless ? (await store.recentReadings(1))[0] : readings.at(-1);
        return reply(200, {
          ingestUrl, sensors: ['DHT11', 'CCS811'], units: { eco2: 'ppm', tvoc: 'ppb' }, hosting: serverless ? 'netlify' : 'local',
          storage: { kind: store.kind, label: storageLabel, readings: await store.countReadings() },
          // For the "How the system works" page: what is connected right now.
          system: {
            deviceProtected: d.protected, deviceLastSeen: d.lastSeen, lastReading: lastReading?.timestamp ?? null,
            telegram: alerts.getPublic().configured && alerts.getPublic().enabled, email: mailer.configured, node: process.version,
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
          await alerts.update(await jsonBody(req));
          return reply(200, alerts.getPublic());
        } catch (error) { return reply(error instanceof TooLarge ? 413 : 400, { error: error instanceof TooLarge ? 'Payload too large.' : error.message }); }
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
            await store.insertReading(reading);
            if (!serverless) readings = [...readings, reading].slice(-2000);
            // Finished before replying: on Netlify the function may stop right after the reply.
            await alerts.check(reading);
            await device.acknowledge(data.acks);
            // Commands from the dashboard ride back on the reply.
            return reply(201, { ok: true, reading, commands: await device.deliver() });
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

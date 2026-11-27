// Runs Kelvin's API (server/app.mjs) behind a web-standard handler: a Request in, a Response
// out. Used by the online hosts (netlify/functions/api.mjs and api/index.mjs for Vercel),
// which hand it the request and get back the reply the local server would have sent.
// Settings come from the host's environment variables: DATABASE_URL (required), VAULT_KEY,
// GMAIL_USER and GMAIL_APP_PASSWORD (email codes), TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.
import { Readable } from 'node:stream';
import { createApp } from './app.mjs';

let app = null;
const start = () => (app ??= createApp({ serverless: true, databaseUrl: process.env.DATABASE_URL, dataDir: '/tmp/kelvin' })
  .catch(error => { app = null; throw error; }));

/** `host` names where to fix DATABASE_URL; `ip` is the caller's address; `url` replaces request.url when the host rewrote it. */
export async function handleWeb(request, { host = 'the host', ip, url: given } = {}) {
  let instance;
  try { instance = await start(); }
  catch (error) {
    console.error('[database]', error.message);
    return Response.json({ error: `The database is not reachable. Check DATABASE_URL in the ${host} settings.` }, { status: 503 });
  }

  const url = new URL(given ?? request.url);
  const body = request.body && !['GET', 'HEAD'].includes(request.method) ? Buffer.from(await request.arrayBuffer()) : null;
  const req = Readable.from(body ? [body] : []);
  req.method = request.method;
  req.url = url.pathname + url.search;
  req.headers = Object.fromEntries([...request.headers].map(([k, v]) => [k.toLowerCase(), v]));
  req.headers.host ??= url.host;
  req.headers['x-forwarded-proto'] = 'https';
  req.socket = { remoteAddress: ip };

  return new Promise((resolve, reject) => {
    let status = 200;
    const headers = new Headers();
    const chunks = [];
    const set = (name, value) => {
      headers.delete(name);
      for (const v of [].concat(value)) headers.append(name, String(v));
    };
    const res = {
      headersSent: false,
      setHeader: set,
      getHeader: name => headers.get(name),
      writeHead(code, extra = {}) { status = code; for (const [k, v] of Object.entries(extra)) set(k, v); this.headersSent = true; return this; },
      write(chunk) { chunks.push(Buffer.from(chunk)); return true; },
      end(chunk) {
        if (chunk) chunks.push(Buffer.from(chunk));
        const data = chunks.length ? Buffer.concat(chunks) : null;
        resolve(new Response([204, 304].includes(status) ? null : data, { status, headers }));
      },
    };
    instance.handle(req, res).then(handled => {
      if (!handled) resolve(Response.json({ error: 'Not found.' }, { status: 404 }));
    }, reject);
  });
}

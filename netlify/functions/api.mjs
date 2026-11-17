// Kelvin's API on Netlify: every /api/* request comes here. It runs the same code as the
// local server (server/app.mjs) by handing it a request and reply shaped like Node's.
// Settings come from the site's environment variables: DATABASE_URL (required),
// GMAIL_USER and GMAIL_APP_PASSWORD (email codes), TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.
import { Readable } from 'node:stream';
import { createApp } from '../../server/app.mjs';

let app = null;
const start = () => (app ??= createApp({ serverless: true, databaseUrl: process.env.DATABASE_URL, dataDir: '/tmp/kelvin' })
  .catch(error => { app = null; throw error; }));

export default async function handler(request, context) {
  let instance;
  try { instance = await start(); }
  catch (error) {
    console.error('[database]', error.message);
    return Response.json({ error: 'The database is not reachable. Check DATABASE_URL in the Netlify site settings.' }, { status: 503 });
  }

  const url = new URL(request.url);
  const body = request.body && !['GET', 'HEAD'].includes(request.method) ? Buffer.from(await request.arrayBuffer()) : null;
  const req = Readable.from(body ? [body] : []);
  req.method = request.method;
  req.url = url.pathname + url.search;
  req.headers = Object.fromEntries([...request.headers].map(([k, v]) => [k.toLowerCase(), v]));
  req.headers.host ??= url.host;
  req.headers['x-forwarded-proto'] = 'https';
  req.socket = { remoteAddress: context?.ip };

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

export const config = { path: '/api/*' };

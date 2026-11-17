// Kelvin on this computer: the API (server/app.mjs) plus the pages (Vite while developing,
// the built dist/ folder with --production). On Netlify, netlify/functions/api.mjs runs the
// same API instead.
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './server/app.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
// DATABASE_URL and friends can live in a .env file next to this one (never committed).
try { process.loadEnvFile(path.join(root, '.env')); } catch {}
const production = process.argv.includes('--production');
const port = Number(process.env.PORT || 5173);
const readingsFile = process.env.DATA_FILE ? path.resolve(process.env.DATA_FILE) : path.join(root, 'data', 'readings.json');

let app;
try { app = await createApp({ dataDir: path.dirname(readingsFile), readingsFile, databaseUrl: process.env.DATABASE_URL, port }); }
catch (error) {
  console.error(`[database] Could not connect to the database: ${error.message}\nCheck DATABASE_URL in .env (Supabase: Connect → Session pooler).`);
  process.exit(1);
}
const vite = production ? null : await (await import('vite')).createServer({ root, server: { middlewareMode: true, hmr: { port: port + 10000 } }, appType: 'spa' });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

const server = createServer(async (req, res) => {
  if (await app.handle(req, res)) return;
  if (vite) { vite.middlewares(req, res); return; }
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    let decoded;
    try { decoded = decodeURIComponent(url.pathname); } catch { res.writeHead(400); res.end('Bad request'); return; }
    const dist = path.join(root, 'dist');
    let requested = path.resolve(dist, '.' + decoded);
    if (requested !== dist && !requested.startsWith(dist + path.sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    if (!path.extname(requested)) requested = path.join(dist, 'index.html');
    const stream = createReadStream(requested);
    stream.on('open', () => { res.writeHead(200, { 'Content-Type': mime[path.extname(requested)] || 'application/octet-stream' }); stream.pipe(res); });
    stream.on('error', () => { if (!res.headersSent) res.writeHead(404); res.end('Not found'); });
  } catch { res.writeHead(500); res.end('Server error'); }
});
server.listen(port, '0.0.0.0', () => console.log(`Kelvin dashboard: http://localhost:${port} (${production ? 'production' : 'development'})`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await vite?.close(); server.close(); await app.close(); process.exit(0); });

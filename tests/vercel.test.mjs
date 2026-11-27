import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as vercel from '../api/index.mjs';

const base = 'https://kelvin.example.vercel.app';

test('Vercel: the rewritten request gets its original /api path and query back', () => {
  assert.equal(vercel.originalUrl(`${base}/api/index?__path=readings`), `${base}/api/readings`);
  assert.equal(vercel.originalUrl(`${base}/api/index?since=5&__path=readings`), `${base}/api/readings?since=5`);
  assert.equal(vercel.originalUrl(`${base}/api/index?__path=device/keys/abc/rotate`), `${base}/api/device/keys/abc/rotate`);
  // Not rewritten: left as it is.
  assert.equal(vercel.originalUrl(`${base}/api/info`), `${base}/api/info`);
});

test('Vercel: every method the dashboard and device use has a handler', () => {
  for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(typeof vercel[m], 'function', m);
});

test('Vercel config: /api goes to the function, everything else to the page, same security headers as Netlify', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.deepEqual(config.rewrites[0], { source: '/api/:path*', destination: '/api/index?__path=:path*' });
  assert.equal(config.outputDirectory, 'dist');
  const netlify = await readFile(new URL('../netlify.toml', import.meta.url), 'utf8');
  const csp = config.headers[0].headers.find(h => h.key === 'Content-Security-Policy').value;
  assert.ok(netlify.includes(`Content-Security-Policy = "${csp}"`), 'the CSP matches netlify.toml');
});

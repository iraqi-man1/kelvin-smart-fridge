// Kelvin's API on Vercel: vercel.json sends every /api/* request here and runs the same
// code as the local server (see server/web.mjs).
import { handleWeb } from '../server/web.mjs';

/** The rewrite in vercel.json passes the original path as ?__path=…; put it back. */
export function originalUrl(raw) {
  const url = new URL(raw);
  const path = url.searchParams.get('__path');
  if (path === null) return url.href;
  url.searchParams.delete('__path');
  url.pathname = `/api/${path.replace(/^\/+/, '')}`;
  return url.href;
}

const handle = request => handleWeb(request, {
  host: 'Vercel project',
  ip: String(request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || undefined,
  url: originalUrl(request.url),
});

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
export const HEAD = handle;

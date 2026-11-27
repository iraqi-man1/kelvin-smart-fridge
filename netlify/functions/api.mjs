// Kelvin's API on Netlify: every /api/* request comes here and runs the same code as the
// local server (see server/web.mjs).
import { handleWeb } from '../../server/web.mjs';

export default (request, context) => handleWeb(request, { host: 'Netlify site', ip: context?.ip });

export const config = { path: '/api/*' };

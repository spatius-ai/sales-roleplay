// Run the Sales role-play on Cloudflare Workers (the "Deploy to Cloudflare" button uses this file).
// The /api routes come from app.mjs, the same code the Node server uses.
// The page files come from the built dist/ folder, served by Cloudflare as static assets.
import { handle } from './app.mjs';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return (await handle(request, env)) || new Response('{"error":"Not found"}', { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    return env.ASSETS.fetch(request);
  },
};

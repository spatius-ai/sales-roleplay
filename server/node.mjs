// Run Sales role-play on your computer: npm start  ->  http://localhost:3000
// Serves the built page from dist/ and the /api routes from app.mjs.
import 'dotenv/config';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle, settings, FACES } from './app.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const PORT = Number(process.env.PORT || 3000);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.pdf': 'application/pdf', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json', '.wasm': 'application/wasm' };
const s = settings(process.env);
const missing = ['SPATIUS_API_KEY', 'SPATIUS_APP_ID'].filter((k) => !process.env[k]);

async function serveFile(path, res) {
  const safe = normalize(path).replace(/^(\.\.[/\\])+/, '');
  let file = join(dist, safe === '/' ? 'index.html' : safe);
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found. Run "npm start" so the page is built first.');
  }
}

const MAX_BODY = 4_000_000; // a recorded question is far smaller

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (!url.pathname.startsWith('/api/')) return await serveFile(url.pathname, res);
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > MAX_BODY) { res.writeHead(413, { 'Content-Type': 'application/json' }); return res.end('{"error":"Too large."}'); }
      chunks.push(c);
    }
    const request = new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
    const response = (await handle(request, process.env)) || new Response('{"error":"Not found"}', { status: 404 });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) for await (const c of response.body) { if (res.destroyed) break; res.write(c); }
    res.end();
  } catch {
    // the rep went away mid-request, or something else failed: answer if we still can, keep running
    if (!res.headersSent && !res.destroyed) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end('{"error":"Something went wrong."}'); }
    else res.destroy();
  }
}).listen(PORT, () => {
  const c = s.choices;
  console.log(`\n  Sales role-play is running: http://localhost:${PORT}\n`);
  console.log(`  Starts with: the ${c.buyer} buyer (${FACES[c.buyer].name}), ${c.difficulty}, in ${c.lang}, ${c.product ? 'your product' : 'the sample product'}`);
  console.log(`  Language and voice: ${s.openai.starter ? 'Spatius starter minutes (no OPENAI_API_KEY set)' : 'your own OpenAI key'}`);
  if (missing.length) console.log(`\n  Missing in .env: ${missing.join(', ')}. The avatar will not start until you add them.`);
  console.log('');
});

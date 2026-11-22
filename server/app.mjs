// Sales role-play server: one request handler, written with standard Request and Response,
// so the same code runs in Node (server/node.mjs) and on Cloudflare Workers (server/worker.mjs).
//
//   GET  /api/config     -> { appId, region, buyers, choices }   the buyers and your starting choices
//   POST /api/session    -> { appId, region, sessionToken }      a short Spatius session for the avatar
//   POST /api/hear       -> recorded audio (x-lang header) -> { text }
//   POST /api/setup      -> { buyer, difficulty, product, lang } -> { company, situation, hidden, opening }
//   POST /api/turn       -> { call, text, interest }             -> { say, interest, why, objection, found, end }
//   POST /api/scorecard  -> { call, found }                      -> { score, questions, objections, best, weakest, summary }
//   POST /api/speak      -> { text, buyer, lang }                -> the voice, PCM16 mono 24 kHz (streamed)
//
// A "call" is { buyer, difficulty, product, lang, setup, history }. The page keeps it between turns.
// OpenAI is reached through OPENAI_BASE_URL. With your own OPENAI_API_KEY it is OpenAI itself.
// Without it, the requests go to the Spatius starter service, signed with your Spatius key.
// The rules of the buyer itself are in brain.mjs.

import { LANGS, BUYERS, DIFFICULTY, SAMPLE_PRODUCT, hearingHint, setupMessages, readSetup, buyerMessages, readBuyer, scorecardMessages, readScorecard, voiceStyle } from './brain.mjs';

// Each buyer has a Spatius avatar and a matching OpenAI voice.
export const FACES = {
  finance: { name: 'Victor', avatarId: '566981dd-1d95-4844-953e-d67e18b2fde8', voice: 'onyx' },
  it: { name: 'Nadia', avatarId: '9078fde3-8e55-4311-a8d6-7740185b5b0d', voice: 'nova' },
  owner: { name: 'Julian', avatarId: 'dbb01388-7c57-47bf-ab59-c492caeb9d90', voice: 'ash' },
};
const STARTER_URL = 'https://starter.spatius.app/v1';
const isStarter = (u) => /starter\.spatius\.app|demotius-starter/.test(u || '');
const pick = (v, list, d) => (list.includes(v) ? v : d);

export function settings(env) {
  const ownKey = !!env.OPENAI_API_KEY;
  // Your own OpenAI key only ever goes to OpenAI (or the OPENAI_BASE_URL you set), never to the starter service.
  const starterUrl = env.SPATIUS_STARTER_URL || STARTER_URL;
  const base = ownKey ? (env.OPENAI_BASE_URL && !isStarter(env.OPENAI_BASE_URL) ? env.OPENAI_BASE_URL : 'https://api.openai.com/v1') : starterUrl;
  return {
    apiKey: env.SPATIUS_API_KEY || '',
    appId: env.SPATIUS_APP_ID || '',
    region: env.SPATIUS_REGION || 'us-west',
    // where the page starts: the choices from the demo, or your own
    choices: {
      buyer: pick(env.ROLEPLAY_BUYER, Object.keys(BUYERS), 'owner'),
      difficulty: pick(env.ROLEPLAY_DIFFICULTY, Object.keys(DIFFICULTY), 'realistic'),
      lang: pick(env.ROLEPLAY_LANG, Object.keys(LANGS), 'en'),
      product: String(env.ROLEPLAY_PRODUCT || '').replace(/\\n/g, '\n').slice(0, 1500),
    },
    openai: {
      base: base.replace(/\/$/, ''),
      key: ownKey ? env.OPENAI_API_KEY : env.SPATIUS_API_KEY,
      starter: !ownKey,
      chat: env.OPENAI_CHAT_MODEL || 'gpt-4.1-mini',
      stt: env.OPENAI_STT_MODEL || 'gpt-4o-mini-transcribe',
      tts: env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
    },
  };
}

const json = (status, body, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra } });
const bad = (message) => Object.assign(new Error(message), { status: 400 });
const readJson = async (request, max) => {
  const text = await request.text();
  if (text.length > max) throw bad('Too large.');
  try { return JSON.parse(text || '{}'); } catch { throw bad('Bad request.'); }
};

// Starter minutes left, passed on from the starter service when it sends them.
function starterHeaders(res) {
  const left = res.headers.get('x-starter-minutes-left');
  return left === null ? {} : { 'X-Starter-Minutes-Left': left };
}

// A clear message for each way OpenAI or the starter service can say no.
async function openaiError(res, s) {
  if (s.openai.starter && res.status === 402)
    return { status: 402, error: 'Your starter minutes are used. Add your own OPENAI_API_KEY to .env to keep going.', starterUsed: true };
  if (s.openai.starter && (res.status === 404 || res.status >= 500 || res.status === 0))
    return { status: 503, error: 'The starter service is not available right now. Try again, or add your own OPENAI_API_KEY to .env.' };
  if (res.status === 401) return { status: 401, error: s.openai.starter ? 'Your Spatius API key was not accepted. Check it at app.spatius.ai.' : 'Your OPENAI_API_KEY was not accepted.' };
  if (res.status === 429) return { status: 429, error: 'Too many requests to the language service. Please wait a moment.' };
  return { status: 502, error: `The language service answered with HTTP ${res.status}.` };
}

async function callOpenAI(s, path, init) {
  try {
    const starter = s.openai.starter ? { 'X-Spatius-Region': s.region } : {};
    return await fetch(`${s.openai.base}${path}`, { ...init, headers: { Authorization: `Bearer ${s.openai.key}`, ...starter, ...(init.headers || {}) } });
  } catch {
    // network failure: a plain object, because a Response cannot have status 0
    return { ok: false, status: 0, body: null, headers: new Headers(), json: async () => ({}), text: async () => '' };
  }
}

// ---------- Spatius session token (reused for 20 minutes) ----------
let tokenCache = { token: '', until: 0, key: '' };
async function sessionToken(s) {
  if (tokenCache.token && tokenCache.key === s.apiKey && Date.now() < tokenCache.until) return tokenCache.token;
  const domain = s.region.startsWith('cn') ? 'spatialwalk.top' : 'spatius.ai';
  const res = await fetch(`https://console.${s.region}.${domain}/v1/console/session-tokens`, {
    method: 'POST',
    headers: { 'X-Api-Key': s.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expireAt: Math.floor(Date.now() / 1000) + 3600 }),
  });
  // a wrong key can still come back as HTTP 200, so check for the token itself
  const body = await res.json().catch(() => ({}));
  if (res.status !== 200 || !body.sessionToken) {
    const refused = res.status === 401 || res.status === 403 || (res.status === 200 && !body.sessionToken);
    const err = new Error(refused ? 'Your Spatius API key was not accepted. Check it at app.spatius.ai.' : `Spatius did not give a session (HTTP ${res.status}).`);
    err.status = refused ? 401 : 502;
    throw err;
  }
  tokenCache = { token: body.sessionToken, until: Date.now() + 20 * 60_000, key: s.apiKey };
  return body.sessionToken;
}

const str = (v, max) => String(v ?? '').slice(0, max);
/** The call as the page sends it back each turn, checked and trimmed. */
function callOf(s, b) {
  const c = b && typeof b.call === 'object' ? b.call : b || {};
  const buyer = pick(c.buyer, Object.keys(BUYERS), s.choices.buyer);
  const st = c.setup && typeof c.setup === 'object' ? c.setup : {};
  return {
    buyer, difficulty: pick(c.difficulty, Object.keys(DIFFICULTY), s.choices.difficulty), lang: pick(c.lang, Object.keys(LANGS), s.choices.lang),
    product: str(c.product || s.choices.product || SAMPLE_PRODUCT, 1500), name: FACES[buyer].name,
    setup: { company: str(st.company, 200), situation: str(st.situation, 600), hidden: { reason: str(st.hidden?.reason, 400), clues: (Array.isArray(st.hidden?.clues) ? st.hidden.clues : []).slice(0, 3).map((x) => str(x, 200)) }, opening: str(st.opening, 300) },
    history: (Array.isArray(c.history) ? c.history : []).slice(-30).map((h) => ({ who: h?.who === 'you' ? 'you' : 'buyer', text: str(h?.text, 800) })),
  };
}
async function chat(s, messages, maxTokens, temperature = 0.6) {
  return callOpenAI(s, '/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: s.openai.chat, temperature, max_tokens: maxTokens, response_format: { type: 'json_object' }, messages }),
  });
}
async function answer(s, res, read) {
  if (!res.ok) { const e = await openaiError(res, s); return json(e.status, e); }
  return json(200, read((await res.json().catch(() => ({}))).choices?.[0]?.message?.content), starterHeaders(res));
}

// ---------- hear: speech to text, told which language to expect ----------
async function hear(s, request) {
  const lang = pick(request.headers.get('x-lang') || '', Object.keys(LANGS), s.choices.lang);
  const audio = await request.arrayBuffer();
  if (audio.byteLength > 3_000_000) return json(413, { error: 'That recording was too long. Try a shorter question.' });
  const type = request.headers.get('content-type') || 'audio/webm';
  const form = new FormData();
  form.append('file', new Blob([audio], { type }), `speech.${type.includes('mp4') ? 'mp4' : 'webm'}`);
  form.append('model', s.openai.stt);
  if (hearingHint(lang)) form.append('prompt', hearingHint(lang));
  const res = await callOpenAI(s, '/audio/transcriptions', { method: 'POST', body: form });
  if (!res.ok) { const e = await openaiError(res, s); return json(e.status, e); }
  const body = await res.json().catch(() => ({}));
  return json(200, { text: String(body.text || '').trim().slice(0, 600) }, starterHeaders(res));
}

// ---------- speak: the buyer's voice ----------
async function speak(s, request) {
  const b = await readJson(request, 20_000);
  const lang = pick(b.lang, Object.keys(LANGS), s.choices.lang);
  const buyer = pick(b.buyer, Object.keys(BUYERS), s.choices.buyer);
  const input = String(b.text || '').replace(/\s+/g, ' ').trim().slice(0, 700);
  if (!input) return json(400, { error: 'Nothing to say.' });
  // response_format "pcm" is raw PCM16 mono at 24 kHz: exactly what the avatar takes, so it is passed on untouched
  const res = await callOpenAI(s, '/audio/speech', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: s.openai.tts, voice: FACES[buyer].voice, input, response_format: 'pcm', instructions: voiceStyle(buyer, lang) }),
  });
  if (!res.ok || !res.body) { const e = await openaiError(res, s); return json(e.status, e); }
  return new Response(res.body, { status: 200, headers: { 'Content-Type': 'audio/pcm;rate=24000', 'Cache-Control': 'no-store', ...starterHeaders(res) } });
}

// A simple limit per visitor, so nobody can spend your keys by calling the API in a loop.
// It is kept in memory: enough for one server; use your host's rate limiting for more.
const hits = new Map();
function tooMany(request) {
  const ip = request.headers.get('cf-connecting-ip') || String(request.headers.get('x-forwarded-for') || '').split(',').pop().trim() || 'local';
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 10_000) hits.clear();
  return list.length > 40;
}

export async function handle(request, env) {
  const url = new URL(request.url);
  const s = settings(env);
  if (url.pathname.startsWith('/api/') && tooMany(request)) return json(429, { error: 'Too many requests. Please wait a minute.' });
  try {
    const p = url.pathname;
    if (p === '/api/config' && request.method === 'GET') {
      return json(200, {
        appId: s.appId, region: s.region, starter: s.openai.starter, choices: s.choices, sampleProduct: SAMPLE_PRODUCT,
        buyers: Object.fromEntries(Object.entries(BUYERS).map(([k, v]) => [k, { title: v.title, name: FACES[k].name, avatarId: FACES[k].avatarId }])),
      });
    }
    if (p === '/api/session' && request.method === 'POST') {
      if (!s.apiKey || !s.appId) return json(500, { error: 'Add SPATIUS_API_KEY and SPATIUS_APP_ID to .env, then restart.' });
      return json(200, { appId: s.appId, region: s.region, sessionToken: await sessionToken(s) });
    }
    if (p === '/api/hear' && request.method === 'POST') return await hear(s, request);
    if (p === '/api/speak' && request.method === 'POST') return await speak(s, request);
    if (request.method !== 'POST' || !['/api/setup', '/api/turn', '/api/scorecard'].includes(p)) return null;
    const b = await readJson(request, 60_000);
    const call = callOf(s, b);
    if (p === '/api/setup') return await answer(s, await chat(s, setupMessages(call), 500, 0.9), readSetup);
    if (!call.setup.hidden.reason) return json(400, { error: 'Start the call first.' });
    if (p === '/api/turn') {
      const text = str(b.text, 800).trim();
      if (!text) return json(400, { error: 'Say or type something first.' });
      const interest = Math.max(0, Math.min(100, Math.round(Number(b.interest)) || 35));
      return await answer(s, await chat(s, buyerMessages(call, { text, interest }), 500), (raw) => readBuyer(raw, interest, text, call.history));
    }
    return await answer(s, await chat(s, scorecardMessages({ ...call, found: b.found === true }), 700, 0.3), readScorecard);
  } catch (err) {
    return json(err.status || 500, { error: err.status === 400 ? err.message : err.message || 'Something went wrong.' });
  }
}

// Sales role-play: a Spatius avatar plays a buyer who pushes back and hides the real reason they might not buy.
import './roleplay.css';
import { canDraw, initSdk, loadSeat, type Seat } from './seat';

type Lang = 'en' | 'es' | 'zh' | 'ar' | 'fr';
type Choices = { buyer: string; difficulty: string; lang: Lang; product?: string };
type Setup = { company: string; situation: string; hidden: { reason: string; clues: string[] }; opening: string };
type Turn = { say: string; interest: number; why: string; objection: string; found: boolean; end: boolean; error?: string };
type Card = { score: number; questions: number; objections: { label: string; handled: boolean }[]; best: { quote: string; why: string }; weakest: { quote: string; better: string }; summary: string; error?: string };
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const $$ = <T extends HTMLElement = HTMLElement>(s: string) => [...document.querySelectorAll(s)] as T[];
const esc = (t: string) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const track = (name: string, props: Record<string, unknown> = {}) => { if (parent !== window) parent.postMessage({ type: 'spatius-event', demo: 'sales-roleplay', name, props }, '*'); };
const CALL_SECONDS = 180;

const st = {
  buyer: 'owner', difficulty: 'realistic', lang: 'en' as Lang, product: '',
  setup: null as Setup | null, history: [] as { who: 'you' | 'buyer'; text: string }[],
  interest: 35, found: false, objections: [] as string[], busy: false, live: false, ends: 0, sessionSeconds: CALL_SECONDS,
};
const stage = $('#stage'), stateEl = $('#state');
let cfg: { appId: string; region: string; buyers: Record<string, { title: string; name: string; avatarId: string }>; choices?: Choices; sampleProduct?: string; sessionSeconds?: number } | null = null;
const buyerInfo = () => cfg?.buyers[st.buyer] || { title: 'Business owner', name: 'Julian', avatarId: '' };
let seat: Seat | null = null, seatLoading: Promise<Seat | null> | null = null, seatFor = '', drawable = true, clockT = 0, plainCtx: AudioContext | null = null;

// ---------- the avatar: seated behind the desk ----------
const FIT = { x: 0, y: 0.13, scale: 0.78 };
function fitAvatar(view: any, tries = 40) { try { view.avatarTransform = FIT; } catch { if (tries > 0) setTimeout(() => fitAvatar(view, tries - 1), 150); } }
function getSeat(): Promise<Seat | null> {
  if (!cfg || !drawable) return Promise.resolve(null);
  if (seatFor !== st.buyer) { seat?.dispose(); seat = null; seatLoading = null; $('#avatarBox').classList.remove('live'); }
  seatFor = st.buyer; const buyer = st.buyer;
  return (seatLoading ??= (async () => {
    $('#load').textContent = `${buyerInfo().name} is joining…`; $('#load').classList.add('on');
    try {
      const r = await fetch('api/session', { method: 'POST' }); const s = await r.json();
      if (!r.ok) throw new Error(s.error || 'No session.');
      await initSdk(s);
      const { start, view } = await loadSeat($('#avatar'), cfg!.buyers[buyer].avatarId, (f) => ($('#load').textContent = `${buyerInfo().name} is joining… ${Math.round(f * 100)}%`));
      if (buyer !== st.buyer) return null;
      (window as any).__pv = view; fitAvatar(view);
      seat = await start(); void seat.connect().catch(() => undefined);
      $('#avatarBox').classList.add('live');
      return seat;
    } catch (e) { console.warn('[roleplay] voice only', e); drawable = false; return null; }
    finally { $('#load').classList.remove('on'); }
  })());
}

// ---------- the voice: PCM16 24 kHz straight from the server to the avatar ----------
async function voice(text: string) {
  const r = await fetch('api/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, lang: st.lang, buyer: st.buyer }) });
  if (!r.ok || !r.body) throw new Error((await r.json().catch(() => ({}))).error || 'The voice did not come through.');
  const reader = r.body.getReader(); let held = new Uint8Array(0); let ended = false;
  return async (): Promise<Int16Array | null> => {
    for (;;) {
      if (held.length >= 9600 || (ended && held.length >= 2)) { const whole = held.length - (held.length % 2); const out = new Int16Array(held.slice(0, whole).buffer); held = held.slice(whole); return out; }
      if (ended) return null;
      const { value, done } = await reader.read();
      if (done) { ended = true; continue; }
      const n = new Uint8Array(held.length + value.length); n.set(held); n.set(value, held.length); held = n;
    }
  };
}
async function playPlain(next: () => Promise<Int16Array | null>) {
  const ctx = new AudioContext({ sampleRate: 24000 }); plainCtx = ctx; let at = ctx.currentTime + 0.05;
  for (let c = await next(); c && ctx.state !== 'closed'; c = await next()) { const buf = ctx.createBuffer(1, c.length, 24000); const ch = buf.getChannelData(0); for (let i = 0; i < c.length; i++) ch[i] = c[i] / 32768; const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination); src.start(at); at += buf.duration; }
  if (ctx.state !== 'closed') await new Promise((r) => setTimeout(r, Math.max(0, (at - ctx.currentTime) * 1000)));
}
function hush() { seat?.interrupt(); if (plainCtx && plainCtx.state !== 'closed') void plainCtx.close(); plainCtx = null; }
const setState = (t: string) => { stateEl.textContent = t; };
async function say(text: string) {
  if (!text) return;
  showSaid(text, true); setState('Speaking');
  try { const next = await voice(text); const s = await getSeat(); if (s) await s.stream(next).done; else await playPlain(next); }
  catch (e) { console.warn(e); }
  finally { if (st.live) setState('Your turn'); }
}
function showSaid(text: string, buyer: boolean) {
  $('#who').textContent = buyer ? `${buyerInfo().name} · ${buyerInfo().title}` : 'You';
  $('#said').textContent = text;
}

// ---------- the panel ----------
function showMeter(value: number, why = '', before = value) {
  $('#num').innerHTML = `${value}<small>/100</small>`; $('#dot').style.left = `${value}%`;
  const d = value - before;
  const g = $('.gauge'); g.classList.remove('up', 'down'); void g.offsetWidth; if (d) g.classList.add(d > 0 ? 'up' : 'down'); // the number flashes when it moves
  if (why) $('#why').innerHTML = `<span class="delta ${d > 0 ? 'up' : d < 0 ? 'down' : 'same'}">${d > 0 ? '+' : ''}${d}</span><span>${esc(why)}</span>`;
}
function showObjections() { $('#objs').innerHTML = st.objections.length ? st.objections.map((o) => `<span>${esc(o)}</span>`).join('') : '<span class="none hp-type-label">None yet</span>'; }
function showSecret(state: 'locked' | 'found' | 'missed') {
  const box = $('#secret'); box.classList.remove('found', 'missed');
  if (state === 'locked') { $('#secretK').textContent = 'Sealed: the hidden objection'; $('#secretText').innerHTML = '<span class="blur">The real reason they might not buy is hidden here</span>'; return; }
  box.classList.add(state);
  $('#secretK').textContent = state === 'found' ? 'Hidden objection found' : 'The hidden objection was';
  $('#secretText').textContent = st.setup?.hidden.reason || '';
}

// ---------- a call ----------
function clock(left: number) { $('#clock').textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`; }
function reset() {
  hush(); st.setup = null; st.history = []; st.interest = 35; st.found = false; st.objections = []; st.live = false; window.clearInterval(clockT);
  stage.classList.remove('oncall'); $('#score').classList.remove('on');
  showMeter(35); $('#why').innerHTML = '<span class="delta same">Start</span><span>It moves with every answer.</span>';
  showObjections(); showSecret('locked'); clock(st.sessionSeconds || CALL_SECONDS); $('#know').textContent = 'Start the call to meet the buyer.';
}
async function startCall() {
  if (st.busy) return;
  reset(); st.busy = true; void getSeat();
  setState('Calling'); showSaid('Calling…', false);
  stage.scrollIntoView({ behavior: 'smooth', block: 'center' });
  try {
    const r = await fetch('api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ buyer: st.buyer, difficulty: st.difficulty, lang: st.lang, product: st.product }) });
    const s = await r.json(); if (!r.ok || s.error) { showSaid(s.error || 'The call did not connect.', false); setState('Ready'); return; }
    st.setup = s; st.live = true; stage.classList.add('oncall');
    $('#know').innerHTML = `<b>${esc(s.company)}</b><br>${esc(s.situation)}`;
    track('call_start', { buyer: st.buyer, difficulty: st.difficulty, lang: st.lang, own: !!st.product });
    if (st.sessionSeconds) { st.ends = Date.now() + st.sessionSeconds * 1000; clockT = window.setInterval(() => { const left = Math.max(0, Math.round((st.ends - Date.now()) / 1000)); clock(left); if (!left) void endCall(); }, 500); }
    st.history.push({ who: 'buyer', text: s.opening });
    await say(s.opening);
    $('#q').focus();
  } finally { st.busy = false; }
}
async function send(text: string) {
  text = text.trim(); if (!text || st.busy) return;
  if (!st.live) { await startCall(); if (!st.live) return; }
  st.busy = true; hush(); showSaid(text, false); setState('Thinking');
  try {
    const r = await fetch('api/turn', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ call: { buyer: st.buyer, difficulty: st.difficulty, lang: st.lang, product: st.product, setup: st.setup, history: st.history }, text, interest: st.interest }) });
    const t: Turn = await r.json(); if (!r.ok || t.error) { showSaid(t.error || 'Something went wrong.', false); return; }
    st.history.push({ who: 'you', text }, { who: 'buyer', text: t.say });
    showMeter(t.interest, t.why, st.interest); st.interest = t.interest;
    if (t.objection && !st.objections.includes(t.objection)) { st.objections.push(t.objection); showObjections(); }
    if (t.found && !st.found) { st.found = true; showSecret('found'); track('hidden_found', { turns: st.history.length / 2 }); }
    track('turn', { interest: t.interest, objection: !!t.objection });
    await say(t.say);
    if (t.end) await endCall();
  } catch (e) { showSaid((e as Error).message, false); }
  finally { st.busy = false; if (st.live && stateEl.textContent === 'Thinking') setState('Your turn'); }
}
async function endCall() {
  if (!st.live) return;
  st.live = false; window.clearInterval(clockT); hush(); stage.classList.remove('oncall'); setState('Call ended');
  if (!st.found) showSecret('missed');
  const words = (who: string) => st.history.filter((h) => h.who === who).reduce((n, h) => n + h.text.split(/\s+/).filter(Boolean).length, 0);
  const you = words('you'), them = words('buyer');
  const talk = you + them ? Math.round((you / (you + them)) * 100) : 0;
  $('#scoreBox').innerHTML = '<p class="wait hp-type-card-copy">Scoring your call…</p>'; $('#score').classList.add('on');
  track('call_end', { turns: st.history.length, found: st.found, interest: st.interest });
  try {
    const r = await fetch('api/scorecard', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ call: { buyer: st.buyer, difficulty: st.difficulty, lang: st.lang, product: st.product, setup: st.setup, history: st.history }, found: st.found }) });
    const c: Card = await r.json(); if (!r.ok || c.error) throw new Error(c.error || 'No scorecard.');
    const handled = c.objections.filter((o) => o.handled).length;
    $('#scoreBox').innerHTML = `
      <div class="head"><div class="ring" style="--v:${c.score}"><span>${c.score}</span></div>
        <div><h3 class="hp-type-card-title" id="scoreTitle">Your scorecard</h3><p class="sum hp-type-card-copy" dir="auto">${esc(c.summary)}</p></div></div>
      <div class="stats">
        <div><b>${talk}%</b><span>you talked (aim for under 50%)</span></div>
        <div><b>${c.questions}</b><span>discovery questions</span></div>
        <div><b>${handled} / ${c.objections.length}</b><span>objections handled</span></div>
        <div><b>${st.found ? 'Found' : 'Missed'}</b><span>hidden objection</span></div>
      </div>
      <div class="secret ${st.found ? 'found' : 'missed'}"><span class="k">${st.found ? 'You found the hidden objection' : 'The hidden objection was'}</span><p>${esc(st.setup?.hidden.reason || '')}</p></div>
      <div class="moments">
        ${c.best.quote ? `<div class="best"><span class="k hp-type-mono">Your strongest line</span><q dir="auto">${esc(c.best.quote)}</q><p dir="auto">${esc(c.best.why)}</p></div>` : ''}
        ${c.weakest.quote ? `<div class="weak"><span class="k hp-type-mono">Your weakest line</span><q dir="auto">${esc(c.weakest.quote)}</q><p class="better" dir="auto">Try: ${esc(c.weakest.better)}</p></div>` : ''}
      </div>
      <div class="row"><button class="btn btn-brand hp-type-action" type="button" id="again">Call again</button><button class="btn btn-secondary hp-type-action" type="button" id="close">Close</button></div>`;
    $('#again').onclick = () => void startCall();
    $('#close').onclick = () => $('#score').classList.remove('on');
    track('scorecard', { score: c.score });
  } catch (e) {
    $('#scoreBox').innerHTML = `<p class="wait hp-type-card-copy">${esc((e as Error).message)}</p><div class="row"><button class="btn btn-secondary hp-type-action" type="button" id="close">Close</button></div>`;
    $('#close').onclick = () => $('#score').classList.remove('on');
  }
}
$('#start').onclick = () => void startCall();
$('#end').onclick = () => (st.live ? void endCall() : undefined);
$('#ask').onsubmit = (e) => { e.preventDefault(); const q = $<HTMLInputElement>('#q'); const v = q.value; q.value = ''; void send(v); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#score').classList.remove('on'); });

// ---------- microphone ----------
let rec: MediaRecorder | null = null;
$('#mic').onclick = async () => {
  const mic = $('#mic');
  if (rec) { rec.stop(); return; }
  if (st.busy) return;
  let stream: MediaStream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch { showSaid('Allow the microphone, or type.', false); return; }
  hush(); void getSeat();
  const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
  const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined); rec = r;
  const parts: Blob[] = []; r.ondataavailable = (e) => e.data.size && parts.push(e.data);
  const ac = new AudioContext(); const an = ac.createAnalyser(); an.fftSize = 1024; ac.createMediaStreamSource(stream).connect(an);
  const buf = new Float32Array(an.fftSize); let heard = false, quiet = performance.now(); const began = performance.now();
  const tick = window.setInterval(() => {
    an.getFloatTimeDomainData(buf); const rms = Math.sqrt(buf.reduce((n, x) => n + x * x, 0) / buf.length);
    if (rms > 0.02) { heard = true; quiet = performance.now(); }
    const now = performance.now();
    if ((heard && now - quiet > 1500) || now - began > 25000 || (!heard && now - began > 7000)) r.stop();
  }, 100);
  r.onstop = async () => {
    window.clearInterval(tick); void ac.close(); stream.getTracks().forEach((t) => t.stop()); rec = null;
    mic.classList.remove('on'); mic.setAttribute('aria-pressed', 'false');
    if (!heard || !parts.length) { setState(st.live ? 'Your turn' : 'Ready'); return; }
    setState('Listening');
    const res = await fetch('api/hear', { method: 'POST', headers: { 'Content-Type': r.mimeType || 'audio/webm', 'x-lang': st.lang }, body: new Blob(parts, { type: r.mimeType || 'audio/webm' }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.text) { showSaid(d.error || "I didn't catch that. Try again, or type it.", false); setState(st.live ? 'Your turn' : 'Ready'); return; }
    void send(d.text);
  };
  r.start(250); mic.classList.add('on'); mic.setAttribute('aria-pressed', 'true'); setState('Listening');
};

// ---------- choices: they apply to the next call ----------
function pickIn(id: string, attr: string, value: string) { $$(`${id} button`).forEach((x) => x.setAttribute('aria-pressed', String(x.dataset[attr] === value))); }
function choose(fn: () => void, event: string, props: Record<string, unknown>) {
  if (st.live) { st.live = false; window.clearInterval(clockT); stage.classList.remove('oncall'); }
  fn(); reset(); setState('Ready'); showSaid('Press Start the call. Ask before you pitch.', true); track(event, props);
}
$('#buyers').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button'); if (!b || b.dataset.buyer === st.buyer) return;
  choose(() => { st.buyer = b.dataset.buyer!; pickIn('#buyers', 'buyer', st.buyer); $<HTMLImageElement>('#still').src = b.querySelector('img')!.src; }, 'buyer_pick', { buyer: b.dataset.buyer });
  if (seat || seatLoading) void getSeat();
});
$('#levels').addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('button'); if (b && b.dataset.difficulty !== st.difficulty) choose(() => { st.difficulty = b.dataset.difficulty!; pickIn('#levels', 'difficulty', st.difficulty); }, 'difficulty_pick', { difficulty: b.dataset.difficulty }); });
$('#langs').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button'); if (!b || b.dataset.lang === st.lang) return;
  choose(() => { st.lang = b.dataset.lang as Lang; pickIn('#langs', 'lang', st.lang); document.querySelector('.subs')!.setAttribute('dir', st.lang === 'ar' ? 'rtl' : 'ltr'); $<HTMLInputElement>('#q').dir = st.lang === 'ar' ? 'rtl' : 'auto'; }, 'lang_pick', { lang: b.dataset.lang });
});
$('#ownBtn').onclick = () => { const own = $('#own'); own.hidden = !own.hidden; if (!own.hidden) $('#ownText').focus(); };
$('#ownText').addEventListener('input', () => {
  st.product = $<HTMLTextAreaElement>('#ownText').value.trim().slice(0, 1500);
  $('#productName').innerHTML = st.product ? `<b>Your product</b> · ${esc(st.product.slice(0, 80))}` : '<b>ShiftPilot</b> · staff scheduling for restaurants (sample)';
});
$$<HTMLButtonElement>('.info-btn').forEach((b) => (b.onclick = () => { const box = document.getElementById(b.getAttribute('aria-controls')!)!; const open = b.getAttribute('aria-expanded') !== 'true'; b.setAttribute('aria-expanded', String(open)); box.hidden = !open; }));

// ---------- build it (only on the demo page): the download starts with the rep's choices ----------
// "Build it" at the top of the demo page: jump to the Build it section (when the demo sits inside another page, that page scrolls)
document.getElementById('goBuild')?.addEventListener('click', () => {
  const el = document.getElementById('build'); if (!el) return;
  if (parent !== window) parent.postMessage({ type: 'spatius-scroll', y: el.getBoundingClientRect().top + window.scrollY }, '*');
  else el.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
$('#download')?.addEventListener('click', (e) => {
  const q = new URLSearchParams({ buyer: st.buyer, difficulty: st.difficulty, lang: st.lang });
  if (st.product) q.set('product', st.product.slice(0, 1500));
  (e.currentTarget as HTMLAnchorElement).href = `api/download?${q}`;
  track('download', { buyer: st.buyer, difficulty: st.difficulty, lang: st.lang });
});
$('#deploy')?.addEventListener('click', () => track('deploy_click'));
$('#github')?.addEventListener('click', () => track('github_click'));

// ---------- start ----------
function useChoices(c: Choices) {
  const press = (sel: string) => { const b = document.querySelector<HTMLButtonElement>(sel); if (b && b.getAttribute('aria-pressed') !== 'true') b.click(); };
  press(`#buyers [data-buyer="${c.buyer}"]`); press(`#levels [data-difficulty="${c.difficulty}"]`); press(`#langs [data-lang="${c.lang}"]`);
  if (c.product) { $<HTMLTextAreaElement>('#ownText').value = c.product; $('#ownText').dispatchEvent(new Event('input')); }
}
// choices in the address (?buyer=it&difficulty=tough, used by embed.js) win over the server's starting choices
const fromUrl = (c: Partial<Choices> = {}) => { const q = new URLSearchParams(location.search); for (const k of ['buyer', 'difficulty', 'lang'] as const) { const v = q.get(k); if (v && /^[a-z]{2,12}$/.test(v)) (c as any)[k] = v; } return c as Choices; };
fetch('api/config').then((r) => r.json()).then(async (c) => {
  cfg = c; st.sessionSeconds = c.sessionSeconds === 0 ? 0 : Number(c.sessionSeconds) || CALL_SECONDS;
  useChoices(fromUrl({ ...(c.choices || {}) })); clock(st.sessionSeconds || CALL_SECONDS); showSaid('Press Start the call. Ask before you pitch.', true);
  drawable = await canDraw();
}).catch(() => { drawable = false; });
const report = () => parent !== window && parent.postMessage({ type: 'spatius-embed-height', demo: 'sales-roleplay', height: document.documentElement.scrollHeight }, '*');
new ResizeObserver(report).observe(document.body);

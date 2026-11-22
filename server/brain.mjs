// The brain of Sales role-play: what makes it a practice buyer, and nothing else.
// Plain functions with no network, no avatar and no web server, so you can copy this file
// into any app or agent (your own backend, a LiveKit or Agora agent) and keep the same behaviour.
//
//   setupMessages(call)        -> messages asking an LLM to invent the buyer's situation and HIDDEN objection (JSON)
//   readSetup(raw)             -> { company, situation, hidden: { reason, clues }, opening }
//   buyerMessages(call, turn)  -> messages for the buyer's next reply, with the interest meter and objections
//   readBuyer(raw, before, repText, history) -> { say, interest, why, objection, found, end }
//   scorecardMessages(call)    -> messages asking for the end-of-call scorecard
//   readScorecard(raw)         -> { score, questions, objections, best, weakest, summary }
//   hearingHint(lang), voiceStyle(buyer, lang)
//
// A "call" is { buyer, difficulty, product, lang, name, setup, history: [{ who: 'you' | 'buyer', text }] }.

export const LANGS = { en: 'English', es: 'Spanish', zh: 'Chinese (Simplified)', ar: 'Arabic', fr: 'French' };
export const BUYERS = {
  finance: { title: 'Finance director', role: 'the finance director of a mid-sized company', style: 'careful and precise; asks about total cost, return on investment, contract length and hidden fees; calm and polite; never buys on enthusiasm alone' },
  it: { title: 'Head of IT', role: 'the head of IT of a fast-growing company', style: 'busy and direct; short answers; cares about security, how it connects to the tools they already use, and how much of the team\'s time it takes; dislikes long pitches' },
  owner: { title: 'Business owner', role: 'the owner of a small business', style: 'friendly and chatty, but worried about price and cash flow; likes simple examples and stories; easily distracted by daily problems' },
};
export const DIFFICULTY = {
  easy: 'open and friendly; shares information easily and gives clear clues about the hidden reason after one good question',
  realistic: 'polite but guarded; shares real information only after one or two good, specific questions; raises normal objections (price, effort, timing) along the way',
  tough: 'sceptical and short; interrupts long pitches; only opens up after several good discovery questions; raises objections early',
};
export const SAMPLE_PRODUCT = 'ShiftPilot: staff scheduling software for restaurants and cafés. Managers build the weekly rota in minutes, staff swap shifts in a phone app, and labour cost is shown against sales every day. $8 per staff member per month, a 14-day free trial, set up in one day.';

const HINTS = {
  en: 'A sales call between a sales rep and a buyer.',
  es: 'Una llamada de ventas entre un vendedor y un comprador.',
  zh: '销售代表和买家之间的销售电话。',
  ar: 'مكالمة مبيعات بين مندوب مبيعات ومشترٍ.',
  fr: 'Un appel commercial entre un vendeur et un acheteur.',
};
export const hearingHint = (lang) => HINTS[lang] || '';
const L = (lang) => LANGS[lang] || 'English';
const parse = (raw) => { try { return typeof raw === 'string' ? JSON.parse(raw || '{}') : raw || {}; } catch { return {}; } };
const buyerOf = (call) => BUYERS[call.buyer] || BUYERS.finance;

/** Before the call: a believable company, what the rep may know, and the one real reason this buyer may not buy. */
export function setupMessages(call) {
  const b = buyerOf(call);
  return [{ role: 'system', content: `Invent a realistic buyer for a sales practice call. The buyer is ${call.name}, ${b.role}. The product being sold:
${call.product}

Return JSON only:
{"company": a made-up company name and one-line description that fits the product (never a real company),
 "situation": 2 short sentences, in ${L(call.lang)}, that a sales rep could know before the call (company size, what they use today),
 "hidden": {"reason": the ONE real, specific reason this buyer may not buy right now, which the buyer will not say unless the rep asks the right questions (for example a contract with a competitor that ends in March, a budget freeze until the next quarter, a bad experience with similar software, a boss who must approve), in English,
            "clues": 2 small hints the buyer might drop when asked good questions, in English},
 "opening": the buyer's first line when the call starts, in ${L(call.lang)}: one short, natural sentence}` }];
}
export function readSetup(raw) {
  const o = parse(raw);
  const clues = (Array.isArray(o.hidden?.clues) ? o.hidden.clues : []).map(String).slice(0, 3);
  return { company: String(o.company || 'A local company'), situation: String(o.situation || ''), hidden: { reason: String(o.hidden?.reason || 'They are not sure the timing is right.'), clues }, opening: String(o.opening || 'Hello, thanks for calling.') };
}

/** The buyer's next reply: stay in character, guard the hidden reason, and move the interest meter honestly. */
export function buyerMessages(call, turn) {
  const b = buyerOf(call);
  const s = call.setup;
  const history = (Array.isArray(call.history) ? call.history : []).slice(-14)
    .map((h) => ({ role: h.who === 'you' ? 'user' : 'assistant', content: String(h.text || '').slice(0, 800) }));
  return [{ role: 'system', content: `You are ${call.name}, ${b.role} at ${s.company}. You are on a sales call; the user is the sales rep. Speak ${L(call.lang)}, out loud, in 1 to 3 short sentences.
Your style: ${b.style}. Difficulty: ${DIFFICULTY[call.difficulty] || DIFFICULTY.realistic}.
What the rep could know: ${s.situation}
What they are selling: ${call.product}
YOUR HIDDEN REASON (a secret; see the rules below): ${s.hidden.reason}
Clues you may drop, ONE at a time, only as the rules allow: ${s.hidden.clues.join('; ')}

How you behave:
- React like a real buyer. Raise objections about price, timing, effort or the tool you use today when it is natural.
- When the rep pitches features or pushes without asking about you, get shorter and less interested; the meter goes down.
- When the rep asks a good, specific question about your situation, answer it honestly and open up a little.
- The hidden reason is a secret. Never mention it, or anything close to it, in reply to a pitch, a price, a feature, a claim or a request to sign. Use only your normal objections then (price, effort, "send me something", "not a priority").
- Drop ONE small clue only when the rep asks an open question about YOUR situation (how you work today, your plans, your timing, your priorities).
- Reveal the hidden reason clearly only when the rep asks directly about obstacles, timing, other tools or plans, or what could stop you, AND has asked at least one good question before.
- If the rep is rude or far off topic, stay polite and end the call.

The interest meter is now ${turn.interest} out of 100.
Return JSON only:
{"check": what the rep's last message did, in English (asked a discovery question? pitched? handled an objection?),
 "say": your reply in ${L(call.lang)},
 "interest": the new interest from 0 to 100. Rules: if the rep's last message did NOT ask you a real question about your situation or needs (a pitch, a price, a claim, a push to sign), interest must go DOWN by 5 to 15. If it asked a good, specific question or answered your objection well, it goes UP by 5 to 15. Otherwise it stays about the same.
 "why": why it moved, in English, at most 8 words, speaking to the rep ("you asked about their busiest day"),
 "objection": a short label in English for a NEW objection you raised in this reply (for example "price", "already use a competitor", "no time to switch"), or "",
 "found": true only if YOUR reply now clearly states the hidden reason because the rep asked the right question, else false,
 "end": true if you end the call now}` }, ...history, { role: 'user', content: String(turn.text || '').slice(0, 800) }];
}
const asks = (t) => /[?？؟]/.test(String(t || ''));
export function readBuyer(raw, before = 35, repText = '', history = []) {
  const o = parse(raw);
  const n = Number(o.interest);
  let interest = Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(Math.max(before - 20, Math.min(before + 20, n))))) : before; // no jumps of more than 20
  // a safety net for the meter: a message that asks nothing (no question mark in any language) cannot raise interest
  if (repText && !/[?？؟]/.test(repText)) interest = Math.min(interest, before);
  // the hidden objection only counts as found once the rep has asked at least two real questions in the call,
  // so a push to sign ("can I send the contract?") that makes the buyer explain does not count as discovery
  const questions = (Array.isArray(history) ? history : []).filter((h) => h.who === 'you' && asks(h.text)).length + (asks(repText) ? 1 : 0);
  return { say: String(o.say || '').trim() || '…', interest, why: String(o.why || '').slice(0, 80), objection: String(o.objection || '').slice(0, 40), found: o.found === true && questions >= 2, end: o.end === true };
}

/** After the call: an honest scorecard from the transcript. */
export function scorecardMessages(call) {
  const transcript = (call.history || []).map((h) => `${h.who === 'you' ? 'REP' : 'BUYER'}: ${String(h.text || '').slice(0, 600)}`).join('\n');
  return [{ role: 'system', content: `You are a sales coach. Score this practice sales call. The buyer's hidden reason was: ${call.setup.hidden.reason}. It was ${call.found ? '' : 'NOT '}uncovered during the call.
Return JSON only, in ${L(call.lang)} except the numbers:
{"score": 0 to 100,
 "questions": how many real discovery questions the rep asked,
 "objections": [{"label": the objection, "handled": true or false}],
 "best": {"quote": the rep's strongest sentence, copied, "why": why it worked, one sentence},
 "weakest": {"quote": the rep's weakest sentence, copied, "better": a better way to say it},
 "summary": 2 sentences of honest, encouraging feedback}

The call:
${transcript || '(the rep said nothing)'}` }];
}
export function readScorecard(raw) {
  const o = parse(raw);
  const n = Number(o.score);
  return {
    score: Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0,
    questions: Math.max(0, Math.round(Number(o.questions) || 0)),
    objections: (Array.isArray(o.objections) ? o.objections : []).slice(0, 6).map((x) => ({ label: String(x?.label || ''), handled: x?.handled === true })).filter((x) => x.label),
    best: { quote: String(o.best?.quote || ''), why: String(o.best?.why || '') },
    weakest: { quote: String(o.weakest?.quote || ''), better: String(o.weakest?.better || '') },
    summary: String(o.summary || ''),
  };
}

const VOICE = { finance: 'measured, calm and slightly reserved', it: 'brisk, direct and a little impatient', owner: 'warm, friendly and talkative' };
/** How the buyer sounds: like a real person on a business call, not like an assistant. */
export const voiceStyle = (buyer, lang) => `Speak ${L(lang)} like a real buyer on a business call: ${VOICE[buyer] || VOICE.finance}. Natural, conversational, never like an assistant.`;

# Sales role-play

## Overview

Sales role-play is a buyer who pushes back, so a sales team can practise before the real call. The rep picks a buyer (a careful finance director, a busy head of IT, or a friendly but price-sensitive business owner), a difficulty, and the product they sell: a sample product, or a few lines about their own. A live Spatius avatar plays the buyer on a video-call style screen, by voice or text, and raises real objections about price, timing and effort.

Its standout feature is **the hidden objection**. Every buyer gets one real, specific reason they might not buy, made up for each call: a budget freeze until next quarter, a contract with a competitor, a new system they just bought. The buyer will not say it if the rep only pitches. A live interest meter rises and falls after every answer, with the reason. Good discovery questions uncover the secret, and the card turns green. If the rep never finds it, it is revealed at the end, with a scorecard.

This repository is a small, complete template. It runs on your computer in a few minutes with only your Spatius API key and App ID. It is for sales teams, enablement and training companies, and for developers who want to see an avatar play a character with a private goal.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/spatius-ai/sales-roleplay)

## Why this matters

Reps usually learn to handle objections on real customers, which costs deals. Role-play with a manager is rare and awkward. A practice buyer who is always available and hides the real objection like a real buyer does teaches the habit that matters most: ask before you pitch.

## User flow

1. The rep picks a buyer, a difficulty (easy, realistic, tough) and a language, and keeps the sample product or pastes their own.
2. They press "Start the call". The buyer joins, introduces their company, and the 3-minute call clock starts. "What you know" shows what a rep could know before the call.
3. They talk or type. The buyer answers out loud, in character, and raises objections; each one is added to the list beside the call.
4. After every answer the interest meter moves, with a short reason ("you asked about their busiest day"). Pitching makes it drop; good questions make it rise.
5. Good questions about the buyer's situation, timing and obstacles uncover the hidden objection; the card turns green.
6. "End the call" (or the clock) opens the scorecard: a score, how much the rep talked, discovery questions asked, objections handled, the hidden objection, the strongest line and a better way to say the weakest one.

## Architecture

```text
sales-roleplay/
  README.md
  LICENSE
  package.json
  vite.config.mjs           builds the web page and copies the avatar engine files
  wrangler.jsonc            Cloudflare Workers settings
  .env.example              settings for running on your computer
  .dev.vars.example         secrets for Cloudflare
  server/
    brain.mjs               the buyer itself: setup with the hidden objection, each reply, the meter, the scorecard
    app.mjs                 the API: session token, hearing, setup, turns, scorecard, voice (uses brain.mjs)
    node.mjs                runs the app on your computer
    worker.mjs              runs the app on Cloudflare Workers
  web/
    index.html              the page: choices, the call, the panel and the scorecard
    src/main.ts             the call: setup, turns, the meter, the hidden objection, the scorecard, the microphone
    src/roleplay.css        the look of the call, the panel and the scorecard
    src/seat.ts             the Spatius avatar: load, connect, speak
    public/embed.js         puts the role-play on any page with one line
    public/assets/          fonts, faces and the office picture
```

The code has three parts, so you can keep the part you need. `server/brain.mjs` is what makes it a practice buyer; `server/app.mjs` connects it to OpenAI and the browser; `web/src/seat.ts` connects the avatar. The same `server/app.mjs` runs in both places.

**How the hidden objection works.** Before the call, `setupMessages()` asks the LLM to invent the buyer's company, what a rep could know, one hidden reason and two small clues. Each turn, `buyerMessages()` gives the buyer strict rules: never mention the hidden reason in reply to a pitch, a price or a push to sign; drop one clue only when the rep asks an open question about the buyer's situation; reveal it only when the rep asks about obstacles, timing or plans. Two safety nets in `readBuyer()` keep the game fair even when the LLM slips: a message with no question cannot raise the meter, and the hidden objection only counts as found once the rep has asked at least two real questions. In our tests, reps who only pitched never found it, and reps who asked good questions found it within four turns.

**Where the secret lives.** For simplicity the page keeps the call, hidden reason included, and sends it back each turn, so a rep could read it in the browser's developer tools. For real training, keep the setup on the server (for example in a short-lived store keyed by a call id) and send the page only the public parts.

## Runtime modes

| Mode | Command |
| --- | --- |
| On your computer | `npm start` |
| Cloudflare Workers, local | `cp .dev.vars.example .dev.vars`, then `npm run dev:cf` |
| Cloudflare Workers, online | `npm run deploy` or the Deploy button |

**Starter minutes or your own OpenAI key.** Hearing, the buyer's replies, the scorecard and the voice use OpenAI. Without `OPENAI_API_KEY`, the role-play uses free Spatius starter minutes (30 minutes per Spatius key), sent through `starter.spatius.app` with your Spatius key. When the minutes are used up, the page says so, and you add your own key. With `OPENAI_API_KEY` set, the role-play calls OpenAI directly and the starter service is not used.

## Protocols and contracts

The browser talks to the server through seven routes. A `call` is `{ buyer, difficulty, product, lang, setup, history }`.

| Route | Request | Response |
| --- | --- | --- |
| `GET /api/config` | none | `appId`, `region`, `buyers`, `choices` (where the page starts), `sampleProduct`, `starter` |
| `POST /api/session` | none | `appId`, `region`, `sessionToken` |
| `POST /api/hear` | Recorded audio as the body, header `x-lang` | `{ text }` |
| `POST /api/setup` | JSON `{ buyer, difficulty, product, lang }` | `{ company, situation, hidden: { reason, clues }, opening }` |
| `POST /api/turn` | JSON `{ call, text, interest }` | `{ say, interest, why, objection, found, end }` |
| `POST /api/scorecard` | JSON `{ call, found }` | `{ score, questions, objections, best, weakest, summary }` |
| `POST /api/speak` | JSON `{ text, buyer, lang }` | The voice as raw PCM16, mono, 24 kHz, streamed |

Errors come back as `{ "error": "..." }` with a matching HTTP status. When starter minutes are used up, the status is 402 and `starterUsed` is `true`.

## Make it yours

- **Your product.** Set `ROLEPLAY_PRODUCT` in `.env`, or change `SAMPLE_PRODUCT` in `server/brain.mjs`.
- **Buyers.** Add or change buyers in `BUYERS` (role and style) in `server/brain.mjs`, with a face and voice in `FACES` in `server/app.mjs` and a button on the page.
- **Difficulty and rules.** The difficulty levels are in `DIFFICULTY`, and how the buyer guards the secret and moves the meter is in `buyerMessages()`.
- **The scorecard.** What the coach scores is in `scorecardMessages()`.
- **Call length.** Calls last 3 minutes (`CALL_SECONDS` in `web/src/main.ts`).

## Use it in your own app

Pick the row that matches what you have.

| You have | Do this |
| --- | --- |
| Any website or web app, and you want the role-play inside it | Deploy this template (Cloudflare button or your own server), then add one line where it should appear: `<script src="https://YOUR-ROLEPLAY-ADDRESS/embed.js" data-buyer="it" data-difficulty="tough" async></script>`. The `data-` choices are optional. Events arrive on your page as `window` event `spatius:event`. |
| Your own backend, in any language | Copy `server/brain.mjs` (or port it: plain functions, no network). Call `setupMessages()` / `readSetup()` before the call, `buyerMessages()` / `readBuyer()` each turn, and `scorecardMessages()` / `readScorecard()` at the end. |
| Your own web page, and you want the avatar | Copy `web/src/seat.ts`. It loads a Spatius avatar into any element and plays 24 kHz PCM16 audio on it with lip sync. |
| A LiveKit or Agora voice agent | Start from Spatius's official example, [livekit-demo](https://github.com/spatius-ai/spatius-integration-demo/tree/main/livekit-demo) or [agora-demo](https://github.com/spatius-ai/spatius-integration-demo/tree/main/agora-demo), then call `buyerMessages()` / `readBuyer()` from your agent's LLM step. The brain is plain functions, so the buyer works the same over LiveKit or Agora. |
| Another LLM, or an OpenAI-compatible gateway | Set `OPENAI_BASE_URL` with your own `OPENAI_API_KEY`. The brain works with any chat model that can return JSON. |

Spatius's official examples show how to connect an avatar (Direct, LiveKit, Agora, iOS, Android, Flutter): [spatius-integration-demo](https://github.com/spatius-ai/spatius-integration-demo), [livekit-plugins-spatius](https://github.com/spatius-ai/livekit-plugins-spatius) and [create-spatius-app](https://github.com/spatius-ai/create-spatius-app). This template shows what to build on top: the use case and its standout feature, in a brain you can plug into any of them.

## Technical stack

- Spatius avatar SDK (`@spatius/avatarkit`) in Direct mode, drawn in the browser
- OpenAI: `gpt-4o-mini-transcribe` (speech to text), `gpt-4.1-mini` (the buyer, the meter and the scorecard, JSON replies), `gpt-4o-mini-tts` (voice); all can be changed in settings
- Vite for the web page, plain Node for the local server, Cloudflare Workers for hosting
- No database and no framework

## Setup and local development

You need Node 20.3 or newer and a Spatius account, for an API key and App ID from [app.spatius.ai](https://app.spatius.ai). You also need a browser with WebGPU or WebGL2, and a microphone if you want to speak.

```sh
git clone https://github.com/spatius-ai/sales-roleplay
cd sales-roleplay
cp .env.example .env      # paste SPATIUS_API_KEY and SPATIUS_APP_ID
npm install
npm start                 # open http://localhost:3000
```

The page calls `/api/...` and loads `/assets/...` on the same address as the page, so the page, the built files and the API must be served from one origin. `server/node.mjs` and Cloudflare both do this.

## Environment configuration

| Setting | Needed | What it does |
| --- | --- | --- |
| `SPATIUS_API_KEY` | Yes | Your Spatius API key |
| `SPATIUS_APP_ID` | Yes | Your Spatius App ID |
| `SPATIUS_REGION` | No | `us-west` (default) or your region |
| `OPENAI_API_KEY` | No | Your OpenAI key; without it, starter minutes are used |
| `OPENAI_BASE_URL` | No | Another OpenAI-compatible address for your own key. Your OpenAI key is never sent to the starter service. |
| `SPATIUS_STARTER_URL` | No | Another starter service address (for testing) |
| `ROLEPLAY_BUYER` | No | Starting buyer: `finance`, `it` or `owner` |
| `ROLEPLAY_DIFFICULTY` | No | `easy`, `realistic` or `tough` |
| `ROLEPLAY_LANG` | No | `en`, `es`, `zh`, `ar` or `fr` |
| `ROLEPLAY_PRODUCT` | No | Your product, instead of the sample; write `\n` for a new line |
| `OPENAI_CHAT_MODEL`, `OPENAI_STT_MODEL`, `OPENAI_TTS_MODEL` | No | Models |
| `PORT` | No | Local port, 3000 by default |

The rep can still change the buyer, difficulty, language and product on the page. On Cloudflare, put the keys in `.dev.vars` (local) or as secrets (online); the other settings are in `wrangler.jsonc` under `vars`.

## Security and deployment guidance

- Keys stay on the server. The browser only receives a short-lived Spatius session token.
- The `/api` routes are open to anyone who can reach your site, and each turn spends your OpenAI key or starter minutes and your Spatius minutes. The server allows 40 API requests per minute per visitor; for a public site, also turn on your host's rate limiting (for example Cloudflare rate limiting rules) and set a monthly limit in your OpenAI account.
- Nothing is stored on the server; the call lives in the rep's browser tab. Recordings are turned into text and not kept.
- The buyers, companies and sample product are made up. If you add real customer names to your product text, they are sent to your LLM provider.
- `.env` and `.dev.vars` are ignored by git. Never commit them.
- The avatar SDK sends basic performance data to Spatius so failures can be found. See the [Spatius Terms of Service](https://www.spatius.ai/terms-of-service/).

## License and use constraints

The code in this repository is under the MIT License (see `LICENSE`). The Spatius avatar SDK (`@spatius/avatarkit`) and the Spatius service are not part of this license; they are covered by the [Spatius Terms of Service](https://www.spatius.ai/terms-of-service/). The fonts in `web/public/assets/fonts/` (Inter, Geist Mono, Space Grotesk) are under the SIL Open Font License; their license texts are in `web/public/assets/licenses/`. The office picture, the sample product and the face photos are examples for this template.

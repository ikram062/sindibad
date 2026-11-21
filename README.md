# Sindibad

Chat-first ticket assistant for Moroccans (football, concerts, festivals, in Morocco and abroad). Hackathon prototype.

## Stack
- `web/`: React + Vite + TypeScript + Tailwind, GSAP + Lenis (landing page), AI SDK UI (`@ai-sdk/react`)
- `server/`: Express + TypeScript, Drizzle ORM + PostgreSQL, AI SDK (`ai`) with Gemini (`@ai-sdk/google`)

## Setup
1. Create a Postgres database named `sindibad` (pgAdmin).
2. `server/.env`: copy from `server/.env.example` and fill in `DATABASE_URL` (real password), `CIN_HASH_SECRET` (the file shows the command) and `GOOGLE_GENERATIVE_AI_API_KEY` (free, https://aistudio.google.com/apikey). Put real values in `.env`, never in `.env.example`.
3. Install, create tables, load the demo catalogue:
   ```
   npm install
   npm install --prefix server
   npm install --prefix web
   npm run db:push
   npm run db:seed --prefix server
   ```
4. Run both apps: `npm run dev` (API on :4001, web on :5173)

## How it works
- **Chat agent** (`server/src/agent`, `routes/chat.ts`): Gemini with tools that only READ or DRAFT. It replies in the user's language (English, French, Arabic, Darija). Default model `gemini-3.5-flash-lite` (override with `GEMINI_MODEL`); the bigger Flash models were slow or overloaded on the free tier.
- **Proposal then confirm**: the agent can never buy or change settings. `draft_purchase` / `draft_rule` create a pending proposal, shown as a card the user confirms. `services/purchases.ts` is the only place money is "spent" and re-checks identity, eligibility and card every time.
- **Rules** (Rules page): standing instructions created in chat ("tell me when X opens", "buy if under Y"). A plain-code engine (`services/rules.ts`, every 30 s) fires them once.
- **Autonomy** (Settings page): "always ask" (default) or "rules may buy by themselves within limits". Only the Settings page can change it, and turning it on needs verified identity, a card and the password.
- **Identity**: sign-in is email + password (httpOnly cookie sessions). Buying needs a CIN verification through a **simulated Mon e-ID** flow (QR + a simulated phone). It is NOT connected to DGSN. The CIN is never stored, only an HMAC fingerprint. Swap `server/src/kyc/` for the real integration when access exists.
- Events are REAL listings from iticket.ma (Morocco only), copied on 2026-11-21 by hand into `server/src/db/catalog.ts` (a snapshot, not a live feed; prices are "from" prices). Payments (`payments/provider.ts`), identity and exchange rates are simulated, and confirming a purchase issues no real ticket: cards link to the real seller page.
- **Languages** (English, French, Arabic with right-to-left): the dropdown is in every header. Texts live in `web/src/locales/{en,fr,ar}.ts`; `en.ts` defines the keys and TypeScript fails the build if French or Arabic miss one. Anything the server composes (cost lines, why a purchase is blocked, notifications, rule outcomes, identity failures) is sent as a code plus parameters and written by the client, so it follows the language you pick. The assistant answers in the language you write, and is told the interface language as a default. To add a language: add a file, register it in `web/src/i18n.tsx`.

## Tests
`npm test --prefix server` runs against whatever `DATABASE_URL` points to, so point it at a throwaway database, never your real one.

## Demo tips
- `npm run db:seed:users --prefix server` creates five demo accounts (password demo1234). The mic button in the chat uses the browser's speech recognition (Chrome/Edge).

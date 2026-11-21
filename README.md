# Sindibad

Chat-first investing assistant for Morocco (Casablanca stocks + IPOs). Hackathon prototype.

## Stack
- `web/`: React + Vite + TypeScript + Tailwind, Vercel AI SDK (`@ai-sdk/react`)
- `server/`: Express + TypeScript, Drizzle ORM + PostgreSQL, Vercel AI SDK (`ai`) with Gemini (`@ai-sdk/google`)

## Setup
1. Create a Postgres database named `sindibad` (pgAdmin).
2. `server/.env`: copy from `server/.env.example`, set the real password in `DATABASE_URL`, set `CIN_HASH_SECRET` (the file shows the command to generate one), and add a free Gemini key from https://aistudio.google.com/apikey
3. Install and create tables:
   ```
   npm install            # root (concurrently)
   npm install --prefix server
   npm install --prefix web
   npm run db:push
   ```
4. Run both apps: `npm run dev` (API on :4001, web on :5173)

## Auth and CIN verification
- Email + password sign-in; the session is an httpOnly cookie backed by the `sessions` table.
- After first sign-up the user is asked to verify their CIN. They may skip, but every purchase route is mounted behind `requireKyc` (`server/src/routes/purchases.ts`) and returns `403 KYC_REQUIRED` until verified.
- The CIN itself is never stored, only an HMAC fingerprint (one CIN = one account). The check itself is a **mock** (`server/src/kyc/provider.ts`): format, expiry and age only. Swap it for a real KYC vendor behind the `KycProvider` interface.
- Tests: `npm test --prefix server` runs against whatever `DATABASE_URL` points to, so point it at a throwaway database, not your real one.

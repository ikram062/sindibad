// Integration tests: need a migrated database (run with DATABASE_URL pointing at a throwaway one).
// They exercise everything except the LLM: identity, the purchase gate, proposals, rules and autonomy limits.
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { after, before, test } from 'node:test';
import { app } from '../src/app';
import { type SessionUser } from '../src/auth/session';
import { seedCatalog } from '../src/db/catalog';
import { db, pool, schema } from '../src/db/client';
import { eq } from 'drizzle-orm';
import { checkEligibility } from '../src/services/eligibility';
import { createPurchaseProposal, createRuleProposal } from '../src/services/proposals';
import { runRules } from '../src/services/rules';

let server: Server;
let base: string;

const DAY = 86_400_000;
const fixture = (
  slug: string,
  title: string,
  country: string,
  currency: string,
  tiers: { name: string; price: number }[],
  saleInDays: number,
): typeof schema.events.$inferInsert => ({
  slug, title, country, currency, tiers,
  category: 'concert', city: 'Testville', venue: 'Test Hall', seller: 'test seller',
  startsAt: new Date(Date.now() + 30 * DAY), saleOpensAt: new Date(Date.now() + saleInDays * DAY), soldOut: false,
});

before(async () => {
  await seedCatalog(); // exchange rates (and the real catalogue, which these tests ignore)
  // Own fixtures: the real catalogue is Morocco-only and all on sale, so it cannot cover these cases.
  for (const f of [
    fixture('test-onsale-mad', 'Test Match', 'MA', 'MAD', [{ name: 'Standard', price: 150 }], -5),
    fixture('test-upcoming', 'Test Upcoming Concert', 'MA', 'MAD', [{ name: 'General', price: 400 }], 2),
    fixture('test-foreign-kr', 'Seoul K-Wave Live', 'KR', 'KRW', [{ name: 'Standard', price: 132000 }], -5),
    fixture('test-eur-upcoming', 'Test Euro Derby', 'ES', 'EUR', [{ name: 'Upper', price: 120 }], 3),
    fixture('test-dakar', 'Dakar Basketball Cup Final', 'SN', 'XOF', [{ name: 'Standard', price: 10000 }], -1),
    fixture('test-blocked-ru', 'Test Symphony Night', 'RU', 'RUB', [{ name: 'Standard', price: 3000 }], -4),
  ]) {
    await db.insert(schema.events).values(f).onConflictDoUpdate({ target: schema.events.slug, set: { saleOpensAt: f.saleOpensAt, tiers: f.tiers, soldOut: false } });
  }
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(async () => {
  server.close();
  await pool.end();
});

/** Tiny client that keeps the session cookie between calls, like a browser would. */
function client() {
  let cookie = '';
  return async (method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0]!.endsWith('=') ? '' : set.split(';')[0]!;
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, setCookie: set };
  };
}
type Api = ReturnType<typeof client>;

const rand = () => Math.random().toString(36).slice(2, 10);
const digits = () => String(Math.floor(100000 + Math.random() * 899999));
const PASSWORD = 'correct horse';
const claims = (cin: string, over: Record<string, unknown> = {}) => ({
  cin,
  fullName: 'Test User',
  dateOfBirth: '1999-05-20',
  expiryDate: '2035-01-01',
  ...over,
});

async function signup(name: string) {
  const api = client();
  const r = await api('POST', '/api/auth/signup', { email: `${name.toLowerCase()}-${rand()}@example.com`, password: PASSWORD, name });
  assert.equal(r.status, 201);
  return api;
}

/** Runs the whole simulated Mon e-ID flow and returns the poll result. */
async function monEid(api: Api, c: ReturnType<typeof claims>) {
  const start = await api('POST', '/api/kyc/mon-eid/start', { consent: true });
  assert.equal(start.status, 201);
  assert.match(start.body.deepLink, /^moneid:\/\//);
  const id = start.body.sessionId;
  assert.equal((await api('GET', `/api/kyc/mon-eid/sessions/${id}`)).body.status, 'pending');
  assert.equal((await api('POST', `/api/kyc/mon-eid/sessions/${id}/approve`, c)).status, 204);
  return (await api('GET', `/api/kyc/mon-eid/sessions/${id}`)).body;
}

async function verifiedUser(name: string) {
  const api = await signup(name);
  const result = await monEid(api, claims('AB' + digits()));
  assert.equal(result.status, 'completed');
  const me = (await api('GET', '/api/auth/me')).body.user as SessionUser;
  return { api, me };
}

const openSale = (slug: string) => db.update(schema.events).set({ saleOpensAt: new Date() }).where(eq(schema.events.slug, slug));
const eventBySlug = async (slug: string) => (await db.select().from(schema.events).where(eq(schema.events.slug, slug)))[0]!;

test('identity: nobody can purchase until signed in AND verified through Mon e-ID', async () => {
  const anon = client();
  assert.equal((await anon('GET', '/api/purchases')).status, 401, 'anonymous is rejected');
  assert.deepEqual((await anon('GET', '/api/auth/me')).body, { user: null });

  const a = await signup('Aya');
  const blocked = await a('GET', '/api/purchases');
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error, 'KYC_REQUIRED');

  assert.equal((await a('POST', '/api/kyc/mon-eid/start', { consent: false })).status, 400, 'consent is required');

  // the phone releases a minor's ID: verification fails, user stays unverified
  const minor = await monEid(a, claims('AB' + digits(), { dateOfBirth: '2015-03-01' }));
  assert.equal(minor.status, 'failed');
  assert.match(minor.reason, /18/);
  assert.equal((await a('GET', '/api/purchases')).status, 403);

  // a user who declines on the phone stays unverified too
  const s = (await a('POST', '/api/kyc/mon-eid/start', { consent: true })).body.sessionId;
  await a('POST', `/api/kyc/mon-eid/sessions/${s}/decline`);
  assert.equal((await a('GET', `/api/kyc/mon-eid/sessions/${s}`)).body.status, 'declined');

  const cin = 'AB' + digits();
  const ok = await monEid(a, claims(cin));
  assert.equal(ok.status, 'completed');
  assert.equal(ok.user.kycStatus, 'verified');
  assert.equal(JSON.stringify(ok).includes(cin), false, 'the CIN is never echoed back');
  assert.equal((await a('GET', '/api/purchases')).status, 200, 'gate is open once verified');

  // the same CIN cannot be linked to a second account
  const b = await signup('Bilal');
  const dup = await monEid(b, claims(cin));
  assert.equal(dup.status, 'failed');
  assert.match(dup.reason, /already linked/);
  assert.equal((await b('GET', '/api/purchases')).status, 403);
});

test('eligibility explains why, and proposals can only act once', async () => {
  const { api, me } = await verifiedUser('Karim');
  const moscow = await eventBySlug('test-blocked-ru');
  const blocked = await checkEligibility(me, moscow, 400);
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.reasons[0]!.code, 'COUNTRY_BLOCKED');

  const rabat = await eventBySlug('test-upcoming'); // sales not open yet
  const early = await checkEligibility(me, rabat, 400);
  assert.deepEqual(early.reasons.map((r) => r.code).sort(), ['NO_CARD', 'SALE_NOT_OPEN']);

  // no card yet: confirming fails, but the proposal stays pending so the user can fix it and retry
  const match = await eventBySlug('test-onsale-mad');
  const p = await createPurchaseProposal(me, { eventId: match.id, quantity: 2 }, 'chat');
  const noCard = await api('POST', `/api/purchases/proposals/${p.id}/confirm`);
  assert.equal(noCard.status, 422);
  assert.equal(noCard.body.error, 'NO_CARD');

  assert.equal((await api('POST', '/api/settings/card', {})).status, 201);
  const bought = await api('POST', `/api/purchases/proposals/${p.id}/confirm`);
  assert.equal(bought.status, 201);
  assert.equal(bought.body.totalMad, 300, '2 × 150 MAD, no conversion');
  assert.equal((await api('POST', `/api/purchases/proposals/${p.id}/confirm`)).status, 409, 'a second tap does nothing');

  // foreign event: conversion spread is shown and charged
  const seoul = await eventBySlug('test-foreign-kr');
  const sp = await createPurchaseProposal(me, { eventId: seoul.id, quantity: 1 }, 'chat');
  const seoulBuy = await api('POST', `/api/purchases/proposals/${sp.id}/confirm`);
  assert.equal(seoulBuy.body.totalMad, 897.67, '132,000 KRW × 0.0067 + 1.5% spread');

  // dismissed proposals cannot be confirmed
  const dp = await createPurchaseProposal(me, { eventId: match.id, quantity: 1 }, 'chat');
  assert.equal((await api('POST', `/api/proposals/${dp.id}/dismiss`)).status, 200);
  assert.equal((await api('POST', `/api/purchases/proposals/${dp.id}/confirm`)).status, 409);
});

test('rules: alerts fire once, "ask" mode proposes, "auto" mode buys only inside the limits', async () => {
  const { api, me } = await verifiedUser('Nadia');
  await api('POST', '/api/settings/card', {});
  const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
  const confirmRule = async (input: Parameters<typeof createRuleProposal>[1]) => {
    const p = await createRuleProposal(me, input);
    const r = await api('POST', `/api/rules/proposals/${p.id}/confirm`);
    assert.equal(r.status, 201);
    return r.body.ruleId as string;
  };
  const rulesById = async () => new Map(((await api('GET', '/api/rules')).body.rules as any[]).map((r) => [r.id, r]));
  const mine = <T extends { ruleId: string }>(fired: T[], ids: string[]) => fired.filter((f) => ids.includes(f.ruleId));

  // an unverified user cannot save a rule that buys, but alerts are fine
  const stranger = await signup('Omar');
  const strangerMe = (await stranger('GET', '/api/auth/me')).body.user as SessionUser;
  const buyProposal = await createRuleProposal(strangerMe, { kind: 'buy', query: 'Dakar', maxPriceMad: 200, quantity: 1, expiresAt: inDays(7) });
  assert.equal((await stranger('POST', `/api/rules/proposals/${buyProposal.id}/confirm`)).body.error, 'KYC_REQUIRED');

  // alert on an event whose sale has not opened
  const rabat = await eventBySlug('test-upcoming');
  const alertId = await confirmRule({ kind: 'alert', eventId: rabat.id, quantity: 1, expiresAt: inDays(7), sourceText: 'tell me when Rabat Open Air opens' });
  assert.equal(mine(await runRules(), [alertId]).length, 0, 'sale not open: nothing happens');
  await openSale('test-upcoming');
  assert.equal(mine(await runRules(), [alertId])[0]?.outcome, 'notified');
  assert.equal(mine(await runRules(), [alertId]).length, 0, 'a rule fires only once');
  const notes = (await api('GET', '/api/notifications')).body;
  assert.ok(notes.notifications.some((n: any) => n.title === 'Tickets are on sale' && n.body.includes('tell me when Rabat Open Air opens')));

  // "ask" mode: a matching buy rule only drafts a purchase and notifies; the human confirms
  const madrid = await eventBySlug('test-eur-upcoming');
  const askId = await confirmRule({ kind: 'buy', eventId: madrid.id, tier: 'Upper', maxPriceMad: 1500, quantity: 1, expiresAt: inDays(7) });
  await openSale('test-eur-upcoming');
  const asked = mine(await runRules(), [askId])[0];
  assert.equal(asked?.outcome, 'proposed');
  const note = ((await api('GET', '/api/notifications')).body.notifications as any[]).find((n) => n.proposalId);
  assert.ok(note, 'the notification carries the proposal to confirm');
  const confirmed = await api('POST', `/api/purchases/proposals/${note.proposalId}/confirm`);
  assert.equal(confirmed.status, 201);
  assert.equal(confirmed.body.totalMad, 1315.44, '120 EUR × 10.8 + 1.5%');

  // autonomy: turning auto-buying on needs the password again
  const settings = (over: object) => api('PUT', '/api/settings', { autonomy: 'auto', maxPerPurchaseMad: 1000, maxPerMonthMad: 10000, ...over });
  assert.equal((await settings({})).body.error, 'PASSWORD_REQUIRED');
  assert.equal((await settings({ password: 'wrong password' })).body.error, 'BAD_PASSWORD');
  assert.equal((await settings({ password: PASSWORD })).status, 200);
  assert.equal((await settings({ maxPerPurchaseMad: 5000 })).body.error, 'PASSWORD_REQUIRED', 'raising a limit needs the password too');

  // auto mode inside the limits: bought without asking (Dakar is already on sale, 10,000 XOF ≈ 165 MAD)
  const autoId = await confirmRule({ kind: 'buy', query: 'Dakar', maxPriceMad: 200, quantity: 1, expiresAt: inDays(7), sourceText: 'buy Dakar final if under 200' });
  assert.equal(mine(await runRules(), [autoId])[0]?.outcome, 'purchased');
  const list = (await api('GET', '/api/purchases')).body.purchases as any[];
  assert.ok(list.some((p) => p.eventTitle.startsWith('Dakar') && p.via === 'auto_rule' && p.status === 'paid'));
  assert.equal((await rulesById()).get(autoId).status, 'fulfilled');

  // auto mode over the per-purchase limit: falls back to asking (lowering limits needs no password)
  assert.equal((await settings({ maxPerPurchaseMad: 500 })).status, 200);
  const overId = await confirmRule({ kind: 'buy', query: 'Seoul', maxPriceMad: 1000, quantity: 1, expiresAt: inDays(7) });
  const over = mine(await runRules(), [overId])[0];
  assert.equal(over?.outcome, 'proposed');
  assert.match(over!.detail, /limits/);

  // pausing stops a rule; removing the card forces "always ask" again
  const pausedId = await confirmRule({ kind: 'alert', query: 'Paris', quantity: 1, expiresAt: inDays(7) });
  assert.equal((await api('POST', `/api/rules/${pausedId}/action`, { action: 'pause' })).status, 200);
  assert.equal(mine(await runRules(), [pausedId]).length, 0);
  assert.equal((await api('DELETE', '/api/settings/card')).body.settings.autonomy, 'ask');
});

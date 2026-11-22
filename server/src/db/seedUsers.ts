import { like, eq } from 'drizzle-orm';
import { hashPassword } from '../auth/password';
import { env } from '../env';
import { fingerprintCin } from '../kyc/provider';
import { executePurchase } from '../services/purchases';
import { createRule } from '../services/rules';
import { seedCatalog } from './catalog';
import { db, pool, schema } from './client';

const { users, paymentMethods, userSettings, userPreferences, rules, notifications, events } = schema;

if (env.NODE_ENV === 'production') throw new Error('Demo users must never be seeded in production.');

const PASSWORD = 'demo1234';
const DAY = 86_400_000;
const inDays = (d: number) => new Date(Date.now() + d * DAY).toISOString();

// Idempotent: only ever touches the demo accounts (cascades to their rules, purchases, cards, notifications).
// Done before the catalogue refresh so old demo events are no longer referenced and can be replaced.
await db.delete(users).where(like(users.email, '%@demo.ma'));
await seedCatalog();

const event = async (slug: string) => (await db.select().from(events).where(eq(events.slug, slug)))[0]!;
const passwordHash = await hashPassword(PASSWORD);

async function addUser(email: string, name: string, o: { verified?: boolean; card?: boolean } = {}) {
  const [u] = await db
    .insert(users)
    .values({
      email,
      name,
      passwordHash,
      ...(o.verified && {
        kycStatus: 'verified' as const,
        kycMethod: 'mon_eid_simulated',
        kycVerifiedAt: new Date(),
        cinHash: fingerprintCin(`DM${100000 + email.length * 7919}`), // fake, unique per demo user
      }),
    })
    .returning();
  if (o.card) await db.insert(paymentMethods).values({ userId: u!.id, brand: 'Visa', last4: '4242' });
  return u!;
}

// 1. Sara: verified, card, asks every time. An alert waiting for a price drop, and one past purchase.
//    (Waits for Tiakola tickets to drop under 260 MAD; the real price is 320.)
const sara = await addUser('sara@demo.ma', 'Sara Alaoui', { verified: true, card: true });
await createRule(sara.id, { kind: 'alert', eventId: (await event('tiakola-casablanca')).id, maxPriceMad: 260, quantity: 2, expiresAt: inDays(14), sourceText: 'Tell me if Tiakola tickets drop under 260 MAD' });
await executePurchase(sara, { eventId: (await event('abba-tribute-casablanca')).id, quantity: 2, via: 'manual' });
await db.insert(userPreferences).values({ userId: sara.id, cities: ['Casablanca', 'Rabat'], categories: ['concert'], maxPriceMad: '400' });

// 2. Youssef: verified, card, lets rules buy automatically within limits. A buy rule waiting, and one automatic purchase already made.
//    (Would buy 2 Hajib tickets by itself if the price fell under 125 MAD; the real price is 150.)
const youssef = await addUser('youssef@demo.ma', 'Youssef Bennani', { verified: true, card: true });
await db.insert(userPreferences).values({ userId: youssef.id, cities: ['Rabat'], categories: [], keywords: 'hajib rnboi' });
await db.insert(userSettings).values({ userId: youssef.id, autonomy: 'auto', maxPerPurchaseMad: '800', maxPerMonthMad: '3000', autoEnabledAt: new Date() });
await createRule(youssef.id, { kind: 'buy', eventId: (await event('hajib-rabat')).id, maxPriceMad: 125, quantity: 2, expiresAt: inDays(30), sourceText: 'Buy 2 tickets for Hajib in Rabat if they drop under 125 MAD each' });
const aissawa = await event('soiree-aissawa-rabat');
const [done] = await db
  .insert(rules)
  .values({ userId: youssef.id, kind: 'buy', eventId: aissawa.id, maxPriceMad: '110', quantity: 1, expiresAt: new Date(Date.now() + 7 * DAY), status: 'fulfilled', outcome: 'purchased', firedAt: new Date(), sourceText: 'Buy a Soirée Aïssawa ticket if under 110 MAD' })
  .returning();
const auto = await executePurchase(youssef, { eventId: aissawa.id, quantity: 1, via: 'auto_rule', ruleId: done!.id });
if (!auto.ok) throw new Error(`Seed purchase failed: ${auto.message}`);
// Quote the real total, so the demo text can never disagree with the purchase.
const detail = `Bought 1 × ${auto.purchase.tier} for ${aissawa.title}: ${Number(auto.purchase.totalMad)} MAD.`;
const data = { event: aissawa.title, rule: 'Buy a Soirée Aïssawa ticket if under 110 MAD', quantity: 1, tier: auto.purchase.tier, total: Number(auto.purchase.totalMad) };
await db.update(rules).set({ outcomeDetail: detail, outcomeData: data }).where(eq(rules.id, done!.id));
await db.insert(notifications).values({ userId: youssef.id, kind: 'purchase', title: 'Tickets bought automatically', body: `Your rule: "${data.rule}". ${detail}`, code: 'RULE_PURCHASED', params: data });

// 3. Nadia: verified, but no card and nothing else (can browse, cannot buy until she adds a card).
await addUser('nadia@demo.ma', 'Nadia El Idrissi', { verified: true });

// 4. Omar: brand new, not verified, nothing at all.
await addUser('omar@demo.ma', 'Omar Tazi');

// 5. Lina: not verified, but an alert is allowed without verification (written in Darija).
const lina = await addUser('lina@demo.ma', 'Lina Chraibi');
await createRule(lina.id, { kind: 'alert', eventId: (await event('stormy-desperado-casablanca')).id, maxPriceMad: 450, quantity: 1, expiresAt: inDays(10), sourceText: '3lemni ila nqes taman dyal Stormy 3la 450 dh' });

console.log(`Demo users ready (password for all: ${PASSWORD})`);
console.table([
  { email: 'sara@demo.ma', identity: 'verified', card: 'yes', mode: 'ask', has: '1 price alert, 1 purchase, preferences' },
  { email: 'youssef@demo.ma', identity: 'verified', card: 'yes', mode: 'auto (800/3000)', has: '1 buy rule, 1 auto purchase, preferences' },
  { email: 'nadia@demo.ma', identity: 'verified', card: 'no', mode: 'ask', has: 'nothing' },
  { email: 'omar@demo.ma', identity: 'NOT verified', card: 'no', mode: 'ask', has: 'nothing' },
  { email: 'lina@demo.ma', identity: 'NOT verified', card: 'no', mode: 'ask', has: '1 price alert' },
]);
await pool.end();

import { and, eq, inArray, lte } from 'drizzle-orm';
import { type SessionUser, userColumns } from '../auth/session';
import { db, schema } from '../db/client';
import { type EventRow, getEventById, saleState, searchEvents, toView } from './events';
import { createPurchaseProposal, RULE_PROPOSAL_TTL_MS } from './proposals';
import { executePurchase } from './purchases';
import { getSettings, monthSpendMad } from './settings';
import { computeTotal } from './totals';

const { rules, users, notifications, events } = schema;

export type RuleInput = {
  kind: 'alert' | 'buy';
  eventId?: string;
  query?: string;
  tier?: string;
  maxPriceMad?: number;
  quantity: number;
  /** ISO date-time. */
  expiresAt: string;
  sourceText?: string;
};

export async function createRule(userId: string, input: RuleInput) {
  const [row] = await db
    .insert(rules)
    .values({
      userId,
      kind: input.kind,
      eventId: input.eventId,
      query: input.query,
      tier: input.tier,
      maxPriceMad: input.maxPriceMad === undefined ? null : String(input.maxPriceMad),
      quantity: input.quantity,
      expiresAt: new Date(input.expiresAt),
      sourceText: input.sourceText,
    })
    .returning();
  return row!;
}

export async function listRules(userId: string) {
  return db
    .select({ rule: rules, eventTitle: events.title })
    .from(rules)
    .leftJoin(events, eq(rules.eventId, events.id))
    .where(eq(rules.userId, userId))
    .orderBy(rules.createdAt);
}

const TRANSITIONS = {
  pause: { from: ['active'], to: 'paused' },
  resume: { from: ['paused'], to: 'active' },
  cancel: { from: ['active', 'paused'], to: 'cancelled' },
} as const;
export type RuleAction = keyof typeof TRANSITIONS;

export async function changeRule(userId: string, id: string, action: RuleAction) {
  const t = TRANSITIONS[action];
  const [row] = await db
    .update(rules)
    .set({ status: t.to })
    .where(and(eq(rules.id, id), eq(rules.userId, userId), inArray(rules.status, [...t.from])))
    .returning();
  return row;
}

type RuleRow = typeof rules.$inferSelect;

/** The first matching event that is on sale and within the rule's price cap. */
async function findMatch(rule: RuleRow): Promise<EventRow | undefined> {
  const candidates: EventRow[] = [];
  if (rule.eventId) {
    const e = await getEventById(rule.eventId);
    if (e) candidates.push(e);
  } else if (rule.query) {
    for (const v of await searchEvents({ query: rule.query })) {
      const e = await getEventById(v.id);
      if (e) candidates.push(e);
    }
  }
  const cap = rule.maxPriceMad === null ? undefined : Number(rule.maxPriceMad);
  for (const e of candidates) {
    if (saleState(e) !== 'on_sale') continue;
    const view = await toView(e);
    const tier = rule.tier ? view.tiers.find((t) => t.name.toLowerCase() === rule.tier!.toLowerCase()) : [...view.tiers].sort((a, b) => a.priceMad - b.priceMad)[0];
    if (tier && (cap === undefined || tier.priceMad <= cap)) return e;
  }
  return undefined;
}

const notify = (userId: string, n: { kind: 'rule' | 'purchase' | 'system'; title: string; body: string; code?: string; params?: Record<string, string | number>; proposalId?: string }) =>
  db.insert(notifications).values({ userId, ...n });

type Outcome = 'notified' | 'proposed' | 'purchased' | 'blocked';

type Data = Record<string, string | number>;

async function fire(rule: RuleRow, user: SessionUser, event: EventRow): Promise<{ outcome: Outcome; detail: string; data: Data }> {
  const view = await toView(event);
  // English `title`/`body` are a fallback; the client writes the text in the user's language from `code` + `params`.
  const words = rule.sourceText ? `Your rule: "${rule.sourceText}". ` : '';
  const base = { event: view.title, rule: rule.sourceText ?? '' };

  if (rule.kind === 'alert') {
    const detail = `${view.title} is on sale from ${view.fromPriceMad} MAD.`;
    const data = { ...base, price: view.fromPriceMad };
    await notify(user.id, { kind: 'rule', title: 'Tickets are on sale', body: `${words}${detail}`, code: 'RULE_ALERT', params: data });
    return { outcome: 'notified', detail, data };
  }

  const total = await computeTotal(event, rule.tier ?? undefined, rule.quantity);
  if (user.kycStatus !== 'verified') {
    const detail = 'Verify your CIN with Mon e-ID so this rule can buy.';
    const data = { ...base, total: total.totalMad };
    await notify(user.id, { kind: 'rule', title: 'Rule matched, identity needed', body: `${words}${view.title} matches (${total.totalMad} MAD). ${detail}`, code: 'RULE_NEEDS_ID', params: data });
    return { outcome: 'blocked', detail, data };
  }

  let whyNotAuto = 'Your settings ask you to confirm every purchase.';
  let why: 'ASK' | 'LIMITS' | 'FAILED' = 'ASK';
  let failMessage = '';
  const settings = await getSettings(user.id);
  if (settings.autonomy === 'auto') {
    const spent = await monthSpendMad(user.id);
    const withinLimits = total.totalMad <= Number(settings.maxPerPurchaseMad) && spent + total.totalMad <= Number(settings.maxPerMonthMad);
    if (!withinLimits) {
      whyNotAuto = 'This purchase is over your automatic-buying limits.';
      why = 'LIMITS';
    } else {
      const bought = await executePurchase(user, { eventId: event.id, tier: rule.tier ?? undefined, quantity: rule.quantity, via: 'auto_rule', ruleId: rule.id });
      if (bought.ok) {
        const paid = Number(bought.purchase.totalMad);
        const detail = `Bought ${rule.quantity} × ${total.tier} for ${view.title}: ${paid} MAD.`;
        const data = { ...base, quantity: rule.quantity, tier: total.tier, total: paid };
        await notify(user.id, { kind: 'purchase', title: 'Tickets bought automatically', body: `${words}${detail}`, code: 'RULE_PURCHASED', params: data });
        return { outcome: 'purchased', detail, data };
      }
      whyNotAuto = `Automatic purchase did not go through: ${bought.message}`;
      why = 'FAILED';
      failMessage = bought.message;
    }
  }

  // Ask mode (or auto mode could not proceed): draft a proposal and let the human decide.
  const proposal = await createPurchaseProposal(user, { eventId: event.id, tier: rule.tier ?? undefined, quantity: rule.quantity }, 'rule', RULE_PROPOSAL_TTL_MS);
  const data: Data = { ...base, total: total.totalMad, why, ...(failMessage ? { message: failMessage } : {}) };
  await notify(user.id, {
    kind: 'rule',
    title: 'Confirm your purchase',
    body: `${words}${view.title} matches: ${total.totalMad} MAD in total. ${whyNotAuto}`,
    code: 'RULE_CONFIRM',
    params: data,
    proposalId: proposal.id,
  });
  return { outcome: 'proposed', detail: whyNotAuto, data };
}

/** One pass of the rule engine. Plain code, no AI: runs every 30 s in server.ts and on demand in the demo. */
export async function runRules(now = new Date()) {
  await db
    .update(rules)
    .set({ status: 'expired' })
    .where(and(inArray(rules.status, ['active', 'paused']), lte(rules.expiresAt, now)));

  const active = await db
    .select({ rule: rules, user: userColumns })
    .from(rules)
    .innerJoin(users, eq(rules.userId, users.id))
    .where(eq(rules.status, 'active'));

  const results: { ruleId: string; outcome: Outcome; detail: string }[] = [];
  for (const { rule, user } of active) {
    try {
      const event = await findMatch(rule);
      if (!event) continue;
      // Claim the rule first so overlapping runs can never fire it twice.
      const [claimed] = await db
        .update(rules)
        .set({ status: 'fulfilled', firedAt: now })
        .where(and(eq(rules.id, rule.id), eq(rules.status, 'active')))
        .returning();
      if (!claimed) continue;
      try {
        const r = await fire(rule, user, event);
        await db.update(rules).set({ outcome: r.outcome, outcomeDetail: r.detail, outcomeData: r.data }).where(eq(rules.id, rule.id));
        results.push({ ruleId: rule.id, outcome: r.outcome, detail: r.detail });
      } catch (e) {
        await db.update(rules).set({ status: 'active', firedAt: null }).where(eq(rules.id, rule.id));
        throw e;
      }
    } catch (e) {
      console.error('rule evaluation failed', rule.id, e);
    }
  }
  return results;
}

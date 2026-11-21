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

const notify = (userId: string, n: { kind: 'rule' | 'purchase' | 'system'; title: string; body: string; proposalId?: string }) =>
  db.insert(notifications).values({ userId, ...n });

type Outcome = 'notified' | 'proposed' | 'purchased' | 'blocked';

async function fire(rule: RuleRow, user: SessionUser, event: EventRow): Promise<{ outcome: Outcome; detail: string }> {
  const view = await toView(event);
  const words = rule.sourceText ? `Your rule: "${rule.sourceText}". ` : '';

  if (rule.kind === 'alert') {
    const detail = `${view.title} is on sale from ${view.fromPriceMad} MAD.`;
    await notify(user.id, { kind: 'rule', title: 'Tickets are on sale', body: `${words}${detail}` });
    return { outcome: 'notified', detail };
  }

  const total = await computeTotal(event, rule.tier ?? undefined, rule.quantity);
  if (user.kycStatus !== 'verified') {
    const detail = 'Verify your CIN with Mon e-ID so this rule can buy.';
    await notify(user.id, { kind: 'rule', title: 'Rule matched, identity needed', body: `${words}${view.title} matches (${total.totalMad} MAD). ${detail}` });
    return { outcome: 'blocked', detail };
  }

  let whyNotAuto = 'Your settings ask you to confirm every purchase.';
  const settings = await getSettings(user.id);
  if (settings.autonomy === 'auto') {
    const spent = await monthSpendMad(user.id);
    const withinLimits = total.totalMad <= Number(settings.maxPerPurchaseMad) && spent + total.totalMad <= Number(settings.maxPerMonthMad);
    if (!withinLimits) {
      whyNotAuto = 'This purchase is over your automatic-buying limits.';
    } else {
      const bought = await executePurchase(user, { eventId: event.id, tier: rule.tier ?? undefined, quantity: rule.quantity, via: 'auto_rule', ruleId: rule.id });
      if (bought.ok) {
        const detail = `Bought ${rule.quantity} × ${total.tier} for ${view.title}: ${total.totalMad} MAD.`;
        await notify(user.id, { kind: 'purchase', title: 'Tickets bought automatically', body: `${words}${detail}` });
        return { outcome: 'purchased', detail };
      }
      whyNotAuto = `Automatic purchase did not go through: ${bought.message}`;
    }
  }

  // Ask mode (or auto mode could not proceed): draft a proposal and let the human decide.
  const proposal = await createPurchaseProposal(user, { eventId: event.id, tier: rule.tier ?? undefined, quantity: rule.quantity }, 'rule', RULE_PROPOSAL_TTL_MS);
  await notify(user.id, {
    kind: 'rule',
    title: 'Confirm your purchase',
    body: `${words}${view.title} matches: ${total.totalMad} MAD in total. ${whyNotAuto}`,
    proposalId: proposal.id,
  });
  return { outcome: 'proposed', detail: whyNotAuto };
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
        await db.update(rules).set({ outcome: r.outcome, outcomeDetail: r.detail }).where(eq(rules.id, rule.id));
        results.push({ ruleId: rule.id, ...r });
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

import { and, eq, gt } from 'drizzle-orm';
import type { SessionUser } from '../auth/session';
import { db, schema } from '../db/client';
import { checkEligibility } from './eligibility';
import { getEventById, toView } from './events';
import { executePurchase } from './purchases';
import { createRule, type RuleInput } from './rules';
import { computeTotal } from './totals';

const { proposals } = schema;

const CHAT_TTL_MS = 30 * 60 * 1000;
export const RULE_PROPOSAL_TTL_MS = 24 * 60 * 60 * 1000;

type ProposalRow = typeof proposals.$inferSelect;
export const proposalView = (p: ProposalRow) => ({
  id: p.id,
  kind: p.kind,
  status: p.status,
  source: p.source,
  expiresAt: p.expiresAt.toISOString(),
  summary: p.summary,
});
export type ProposalView = ReturnType<typeof proposalView>;

export type PurchasePayload = { eventId: string; tier?: string; quantity: number };

/** Draft only: nothing is bought. Throws if the event/tier/quantity is invalid (callers turn that into a message). */
export async function createPurchaseProposal(
  user: SessionUser,
  payload: PurchasePayload,
  source: 'chat' | 'rule',
  ttlMs = CHAT_TTL_MS,
) {
  const event = await getEventById(payload.eventId);
  if (!event) throw new Error('That event does not exist.');
  const total = await computeTotal(event, payload.tier, payload.quantity);
  const eligibility = await checkEligibility(user, event, total.totalMad);
  const [row] = await db
    .insert(proposals)
    .values({
      userId: user.id,
      kind: 'purchase',
      payload: { eventId: event.id, tier: total.tier, quantity: total.quantity },
      summary: { event: await toView(event), total, eligibility },
      source,
      expiresAt: new Date(Date.now() + ttlMs),
    })
    .returning();
  return proposalView(row!);
}

export async function createRuleProposal(user: SessionUser, input: RuleInput) {
  const event = input.eventId ? await getEventById(input.eventId) : undefined;
  if (input.eventId && !event) throw new Error('That event does not exist.');
  const [row] = await db
    .insert(proposals)
    .values({
      userId: user.id,
      kind: 'rule',
      payload: input as unknown as Record<string, unknown>,
      summary: { rule: input, event: event ? await toView(event) : null },
      source: 'chat',
      expiresAt: new Date(Date.now() + CHAT_TTL_MS),
    })
    .returning();
  return proposalView(row!);
}

export async function getProposal(userId: string, id: string) {
  const [row] = await db.select().from(proposals).where(and(eq(proposals.id, id), eq(proposals.userId, userId)));
  if (!row) return undefined;
  // A pending proposal past its time is reported as expired.
  return proposalView(row.status === 'pending' && row.expiresAt <= new Date() ? { ...row, status: 'expired' } : row);
}

export async function dismissProposal(userId: string, id: string) {
  const [row] = await db
    .update(proposals)
    .set({ status: 'dismissed', resolvedAt: new Date() })
    .where(and(eq(proposals.id, id), eq(proposals.userId, userId), eq(proposals.status, 'pending')))
    .returning();
  return row ? proposalView(row) : undefined;
}

export type ConfirmFailure = { ok: false; status: number; code: string; message: string };

/** Atomically claims a pending, unexpired proposal so a double-tap can only ever act once. */
async function claim(userId: string, id: string, kind: 'purchase' | 'rule') {
  const [row] = await db
    .update(proposals)
    .set({ status: 'confirmed', resolvedAt: new Date() })
    .where(
      and(eq(proposals.id, id), eq(proposals.userId, userId), eq(proposals.kind, kind), eq(proposals.status, 'pending'), gt(proposals.expiresAt, new Date())),
    )
    .returning();
  return row;
}
const release = (id: string) =>
  db.update(proposals).set({ status: 'pending', resolvedAt: null }).where(eq(proposals.id, id));

const notPending: ConfirmFailure = {
  ok: false,
  status: 409,
  code: 'NOT_PENDING',
  message: 'This request is no longer waiting for confirmation (already handled or expired).',
};

export async function confirmPurchaseProposal(user: SessionUser, id: string) {
  const row = await claim(user.id, id, 'purchase');
  if (!row) return notPending;
  const p = row.payload as PurchasePayload;
  const outcome = await executePurchase(user, { eventId: p.eventId, tier: p.tier, quantity: p.quantity, via: 'manual', proposalId: id });
  if (!outcome.ok) {
    await release(id); // the user can fix the cause (e.g. add a card) and confirm again
    return { ok: false, status: 422, code: outcome.code, message: outcome.message } satisfies ConfirmFailure;
  }
  return { ok: true as const, purchase: outcome.purchase };
}

export async function confirmRuleProposal(user: SessionUser, id: string) {
  const row = await claim(user.id, id, 'rule');
  if (!row) return notPending;
  const input = row.payload as unknown as RuleInput;
  if (input.kind === 'buy' && user.kycStatus !== 'verified') {
    await release(id);
    return { ok: false, status: 403, code: 'KYC_REQUIRED', message: 'Verify your CIN before creating a rule that buys.' } satisfies ConfirmFailure;
  }
  const rule = await createRule(user.id, input);
  return { ok: true as const, rule };
}

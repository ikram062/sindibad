import type { SessionUser } from '../auth/session';
import { db, schema } from '../db/client';
import { payments } from '../payments/provider';
import { checkEligibility } from './eligibility';
import { getEventById } from './events';
import { getCard } from './settings';
import { computeTotal } from './totals';

const { purchases, auditLog } = schema;

export type PurchaseRequest = {
  eventId: string;
  tier?: string;
  quantity: number;
  via: 'manual' | 'auto_rule';
  ruleId?: string;
  proposalId?: string;
};
export type PurchaseOutcome =
  | { ok: true; purchase: typeof purchases.$inferSelect }
  | { ok: false; code: string; message: string };

/**
 * The ONE place money is "spent". Re-checks everything (identity, eligibility, card) at execution time,
 * so neither the agent, a stale proposal, nor a rule can bypass it.
 */
export async function executePurchase(user: SessionUser, req: PurchaseRequest): Promise<PurchaseOutcome> {
  if (user.kycStatus !== 'verified') return { ok: false, code: 'KYC_REQUIRED', message: 'Verify your CIN before buying anything.' };

  const event = await getEventById(req.eventId);
  if (!event) return { ok: false, code: 'NOT_FOUND', message: 'That event does not exist.' };

  let total;
  try {
    total = await computeTotal(event, req.tier, req.quantity);
  } catch (e) {
    return { ok: false, code: 'INVALID', message: (e as Error).message };
  }

  const eligibility = await checkEligibility(user, event, total.totalMad);
  if (eligibility.status !== 'allowed') {
    const reason = eligibility.reasons[0]!;
    return { ok: false, code: reason.code, message: reason.message };
  }

  const card = (await getCard(user.id))!;
  const charge = await payments.charge({
    userId: user.id,
    amountMad: total.totalMad,
    last4: card.last4,
    description: `${req.quantity} × ${total.tier} · ${event.title}`,
  });

  const [purchase] = await db
    .insert(purchases)
    .values({
      userId: user.id,
      eventId: event.id,
      tier: total.tier,
      quantity: total.quantity,
      unitPriceLocal: String(total.unitPriceLocal),
      currency: total.currency,
      fxMadPerUnit: String(total.fxMadPerUnit),
      ticketsMad: String(total.ticketsMad),
      spreadMad: String(total.spreadMad),
      feeMad: String(total.feeMad),
      totalMad: String(total.totalMad),
      status: charge.ok ? 'paid' : 'failed',
      paymentRef: charge.ok ? charge.reference : null,
      via: req.via,
      ruleId: req.ruleId,
      proposalId: req.proposalId,
    })
    .returning();
  await db.insert(auditLog).values({
    userId: user.id,
    action: charge.ok ? 'purchase.paid' : 'purchase.failed',
    detail: { purchaseId: purchase!.id, via: req.via, totalMad: total.totalMad },
  });

  if (!charge.ok) return { ok: false, code: 'PAYMENT_DECLINED', message: charge.reason };
  return { ok: true, purchase: purchase! };
}

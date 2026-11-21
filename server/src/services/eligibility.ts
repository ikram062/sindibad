import { and, eq, gte, ne, sql } from 'drizzle-orm';
import type { SessionUser } from '../auth/session';
import { db, schema } from '../db/client';
import { type EventRow, saleState } from './events';
import { getCard } from './settings';

const { purchases, events } = schema;

/** Demo list. A real build reads a maintained sanctions / payment-restriction source. */
export const BLOCKED_COUNTRIES = new Set(['RU', 'BY', 'IR', 'KP', 'SY', 'CU']);
/** Demo yearly foreign-currency card allowance. The real figure comes from the user's bank / Office des Changes rules. */
export const FOREIGN_ALLOWANCE_MAD = 20_000;

export type ReasonCode = 'SOLD_OUT' | 'COUNTRY_BLOCKED' | 'ALLOWANCE' | 'SALE_NOT_OPEN' | 'KYC_REQUIRED' | 'NO_CARD';
/** `message` is the English text (used by the assistant); the client translates from `code` + `params`. */
export type Reason = { code: ReasonCode; message: string; fixable: boolean; params?: Record<string, string | number> };

/** Foreign-currency spend this calendar year (paid purchases of events priced outside MAD). */
async function foreignSpentThisYear(userId: string, now = new Date()): Promise<number> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${purchases.totalMad}), 0)` })
    .from(purchases)
    .innerJoin(events, eq(purchases.eventId, events.id))
    .where(and(eq(purchases.userId, userId), eq(purchases.status, 'paid'), ne(events.currency, 'MAD'), gte(purchases.createdAt, start)));
  return Number(row?.total ?? 0);
}

/**
 * Can THIS user buy THIS event right now? Always explains why not.
 * 'blocked' = cannot be fixed by the user; 'needs_action' = the user can fix it; 'allowed' = go.
 */
export async function checkEligibility(user: SessionUser, event: EventRow, totalMad: number) {
  const reasons: Reason[] = [];
  const state = saleState(event);

  if (state === 'sold_out') reasons.push({ code: 'SOLD_OUT', message: 'This event is sold out.', fixable: false });
  if (BLOCKED_COUNTRIES.has(event.country)) {
    reasons.push({
      code: 'COUNTRY_BLOCKED',
      message: 'Payments for events in this country are not possible from Morocco at the moment (payment restrictions).',
      fixable: false,
    });
  }

  const foreign = event.currency !== 'MAD';
  let allowanceRemainingMad: number | null = null;
  if (foreign) {
    allowanceRemainingMad = Math.max(0, FOREIGN_ALLOWANCE_MAD - (await foreignSpentThisYear(user.id)));
    if (totalMad > allowanceRemainingMad) {
      reasons.push({
        code: 'ALLOWANCE',
        message: `Not enough foreign-currency card allowance left this year (${allowanceRemainingMad} MAD left, demo limit).`,
        fixable: false,
        params: { remaining: allowanceRemainingMad },
      });
    }
  }

  if (state === 'upcoming') {
    reasons.push({
      code: 'SALE_NOT_OPEN',
      message: `Sales open on ${event.saleOpensAt.toISOString().slice(0, 16).replace('T', ' ')} UTC. You can set a rule to be told, or to buy automatically.`,
      fixable: true,
      params: { opensAt: event.saleOpensAt.toISOString() },
    });
  }
  if (user.kycStatus !== 'verified') {
    reasons.push({ code: 'KYC_REQUIRED', message: 'Verify your CIN with Mon e-ID before buying.', fixable: true });
  }
  if (!(await getCard(user.id))) {
    reasons.push({ code: 'NO_CARD', message: 'Add a payment card in Settings first.', fixable: true });
  }

  const status = reasons.some((r) => !r.fixable) ? 'blocked' : reasons.length ? 'needs_action' : 'allowed';
  // Unfixable reasons first, so callers that look at reasons[0] report the real blocker.
  reasons.sort((a, b) => Number(a.fixable) - Number(b.fixable));
  return { status: status as 'blocked' | 'needs_action' | 'allowed', reasons, allowanceRemainingMad };
}
export type Eligibility = Awaited<ReturnType<typeof checkEligibility>>;

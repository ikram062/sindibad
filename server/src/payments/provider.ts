import { randomBytes } from 'node:crypto';

export type ChargeInput = { userId: string; amountMad: number; last4: string; description: string };
export type ChargeResult = { ok: true; reference: string } | { ok: false; reason: string };

/** Port: swap the mock for a bank / payment-institution partner (tokenised card, 3-D Secure) without touching callers. */
export interface PaymentProvider {
  charge(input: ChargeInput): Promise<ChargeResult>;
}

/** PROTOTYPE ONLY: no money moves. A card ending 0002 is declined so the failure path can be demoed. */
export const mockPayments: PaymentProvider = {
  async charge({ last4 }) {
    if (last4 === '0002') return { ok: false, reason: 'Card declined (simulated).' };
    return { ok: true, reference: `MOCK-${randomBytes(5).toString('hex').toUpperCase()}` };
  },
};

export const payments: PaymentProvider = mockPayments;

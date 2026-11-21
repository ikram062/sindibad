import { desc, eq } from 'drizzle-orm';
import { Router } from 'express';
import { fail } from '../auth/http';
import { requireKyc } from '../auth/middleware';
import { db, schema } from '../db/client';
import { confirmPurchaseProposal } from '../services/proposals';

const { purchases, events } = schema;

/**
 * The only place purchase routes may live. Everything mounted here needs a signed-in,
 * CIN-verified user. The agent's purchase tools and the rule engine go through
 * services/purchases.ts, which re-checks the same thing.
 */
export const purchasesRouter = Router();
purchasesRouter.use(requireKyc);

purchasesRouter.get('/', async (req, res) => {
  const rows = await db
    .select({ p: purchases, title: events.title, city: events.city })
    .from(purchases)
    .innerJoin(events, eq(purchases.eventId, events.id))
    .where(eq(purchases.userId, req.user!.id))
    .orderBy(desc(purchases.createdAt))
    .limit(50);
  res.json({
    purchases: rows.map(({ p, title, city }) => ({
      id: p.id,
      eventTitle: title,
      city,
      tier: p.tier,
      quantity: p.quantity,
      totalMad: Number(p.totalMad),
      status: p.status,
      via: p.via,
      paymentRef: p.paymentRef,
      createdAt: p.createdAt,
    })),
  });
});

/** The human tap: executes a purchase the agent (or a rule) drafted. */
purchasesRouter.post('/proposals/:id/confirm', async (req, res) => {
  const result = await confirmPurchaseProposal(req.user!, String(req.params.id));
  if (!result.ok) return fail(res, result.status, result.code, result.message);
  const p = result.purchase;
  res.status(201).json({ purchaseId: p.id, totalMad: Number(p.totalMad), paymentRef: p.paymentRef });
});

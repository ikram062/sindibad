import { and, eq, inArray } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { fail, parseBody } from '../auth/http';
import { requireAuth } from '../auth/middleware';
import { db, schema } from '../db/client';
import { getEventById } from '../services/events';
import { changeRule, createRule, listRules } from '../services/rules';
import { confirmRuleProposal } from '../services/proposals';

export const rulesRouter = Router();
rulesRouter.use(requireAuth);

rulesRouter.get('/', async (req, res) => {
  const rows = await listRules(req.user!.id);
  res.json({
    rules: rows.map(({ rule: r, eventTitle }) => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      outcome: r.outcome,
      outcomeDetail: r.outcomeDetail,
      outcomeData: r.outcomeData,
      eventId: r.eventId,
      eventTitle,
      query: r.query,
      tier: r.tier,
      maxPriceMad: r.maxPriceMad === null ? null : Number(r.maxPriceMad),
      quantity: r.quantity,
      expiresAt: r.expiresAt,
      firedAt: r.firedAt,
      sourceText: r.sourceText,
      createdAt: r.createdAt,
    })),
  });
});

const createSchema = z.object({
  kind: z.enum(['alert', 'buy']),
  eventId: z.string().uuid(),
  tier: z.string().max(60).optional(),
  maxPriceMad: z.number().positive().max(100_000).optional(),
  quantity: z.number().int().min(1).max(8).default(1),
  expiresInDays: z.number().int().min(1).max(90).default(30),
});

/**
 * A rule the user sets up themselves (the For-you page). Same limits as the chat: a rule that buys needs a verified
 * identity and a price cap, and whether it buys alone or asks first is still decided by the autonomy setting.
 */
rulesRouter.post('/', async (req, res) => {
  const body = parseBody(createSchema, req, res);
  if (!body) return;
  const user = req.user!;
  if (!(await getEventById(body.eventId))) return fail(res, 404, 'NOT_FOUND', 'That event does not exist.');
  if (body.kind === 'buy') {
    if (user.kycStatus !== 'verified') return fail(res, 403, 'KYC_REQUIRED', 'Verify your CIN before creating a rule that buys.');
    if (body.maxPriceMad === undefined) return fail(res, 400, 'PRICE_CAP_REQUIRED', 'Set the maximum price per ticket for a buying rule.');
  }
  const { rules } = schema;
  const [dup] = await db
    .select({ id: rules.id })
    .from(rules)
    .where(and(eq(rules.userId, user.id), eq(rules.eventId, body.eventId), eq(rules.kind, body.kind), inArray(rules.status, ['active', 'paused'])));
  if (dup) return fail(res, 409, 'DUPLICATE_RULE', 'You already have an active rule like this for this event.');

  const rule = await createRule(user.id, {
    kind: body.kind,
    eventId: body.eventId,
    tier: body.tier,
    maxPriceMad: body.maxPriceMad,
    quantity: body.quantity,
    expiresAt: new Date(Date.now() + body.expiresInDays * 86_400_000).toISOString(),
  });
  res.status(201).json({ ruleId: rule.id, status: rule.status });
});

const actionSchema = z.object({ action: z.enum(['pause', 'resume', 'cancel']) });

rulesRouter.post('/:id/action', async (req, res) => {
  const body = parseBody(actionSchema, req, res);
  if (!body) return;
  const rule = await changeRule(req.user!.id, String(req.params.id), body.action);
  if (!rule) return fail(res, 409, 'NOT_ALLOWED', `This rule cannot be ${body.action}d right now.`);
  res.json({ id: rule.id, status: rule.status });
});

/** Saving a rule the agent drafted. Rules that buy need a verified identity. */
rulesRouter.post('/proposals/:id/confirm', async (req, res) => {
  const result = await confirmRuleProposal(req.user!, String(req.params.id));
  if (!result.ok) return fail(res, result.status, result.code, result.message);
  res.status(201).json({ ruleId: result.rule.id, status: result.rule.status });
});

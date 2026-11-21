import { Router } from 'express';
import { z } from 'zod';
import { fail, parseBody } from '../auth/http';
import { requireAuth } from '../auth/middleware';
import { changeRule, listRules } from '../services/rules';
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

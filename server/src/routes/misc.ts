import { and, desc, eq, isNull } from 'drizzle-orm';
import { Router } from 'express';
import { fail } from '../auth/http';
import { requireAuth } from '../auth/middleware';
import { db, schema } from '../db/client';
import { dismissProposal, getProposal } from '../services/proposals';

const { notifications } = schema;

/** Current state of a proposal, so a confirm card shows the truth after a page reload. */
export const proposalsRouter = Router();
proposalsRouter.use(requireAuth);

proposalsRouter.get('/:id', async (req, res) => {
  const p = await getProposal(req.user!.id, String(req.params.id));
  if (!p) return fail(res, 404, 'NOT_FOUND', 'Unknown request.');
  res.json(p);
});

proposalsRouter.post('/:id/dismiss', async (req, res) => {
  const p = await dismissProposal(req.user!.id, String(req.params.id));
  if (!p) return fail(res, 409, 'NOT_PENDING', 'This request is no longer waiting for confirmation.');
  res.json(p);
});

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get('/', async (req, res) => {
  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, req.user!.id))
    .orderBy(desc(notifications.createdAt))
    .limit(30);
  res.json({ notifications: rows, unread: rows.filter((n) => !n.readAt).length });
});

notificationsRouter.post('/read-all', async (req, res) => {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, req.user!.id), isNull(notifications.readAt)));
  res.status(204).end();
});

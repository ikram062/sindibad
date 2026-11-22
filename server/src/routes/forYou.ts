import { Router } from 'express';
import { z } from 'zod';
import { parseBody } from '../auth/http';
import { requireAuth } from '../auth/middleware';
import { getPrefs, recommend, savePrefs } from '../services/recommendations';

/** The "For you" page: what the user likes, and the events that match it. Mounted at /api. */
export const forYouRouter = Router();

forYouRouter.get('/preferences', requireAuth, async (req, res) => res.json({ prefs: await getPrefs(req.user!.id) }));

const prefsSchema = z.object({
  cities: z.array(z.string().trim().min(1).max(40)).max(12),
  categories: z.array(z.enum(['concert', 'festival', 'football', 'other'])).max(4),
  // 0 or null both mean "no limit"
  maxPriceMad: z.number().min(0).max(100_000).nullable(),
  keywords: z.string().trim().max(100),
});

forYouRouter.put('/preferences', requireAuth, async (req, res) => {
  const body = parseBody(prefsSchema, req, res);
  if (!body) return;
  res.json({ prefs: await savePrefs(req.user!.id, { ...body, maxPriceMad: body.maxPriceMad || null }) });
});

forYouRouter.get('/recommendations', requireAuth, async (req, res) => res.json(await recommend(req.user!.id)));

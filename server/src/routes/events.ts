import { Router } from 'express';
import { requireAuth } from '../auth/middleware';
import { searchEvents } from '../services/events';

/** The catalogue for the browse screen (the chat agent reads the same data through its search tool). */
export const eventsRouter = Router();
eventsRouter.use(requireAuth);

eventsRouter.get('/', async (req, res) => {
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  res.json({ events: await searchEvents({ city: str(req.query.city), category: str(req.query.category), query: str(req.query.q) }) });
});

import { Router } from 'express';
import { requireKyc } from '../auth/middleware';

/**
 * The only place purchase routes may live. Everything mounted here needs a signed-in,
 * CIN-verified user. The agent's purchase tool must check `kycStatus` the same way.
 */
export const purchasesRouter = Router();
purchasesRouter.use(requireKyc);

purchasesRouter.post('/', (_req, res) => {
  res.status(501).json({ error: 'NOT_IMPLEMENTED', message: 'Purchases are not built yet.' });
});

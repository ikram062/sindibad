import { Router } from 'express';
import { z } from 'zod';
import { fail, parseBody } from '../auth/http';
import { requireAuth } from '../auth/middleware';
import { rateLimiter } from '../auth/rateLimit';
import { publicUser } from '../auth/session';
import { env } from '../env';
import { approveOnPhone, declineOnPhone, pollSession, startSession } from '../kyc/monEid';

export const kycRouter = Router();
kycRouter.use(requireAuth);

const startLimit = rateLimiter(8, 60 * 60 * 1000);

const startSchema = z.object({
  consent: z.literal(true, { error: 'Please agree to the processing of your ID data.' }),
});
const claimsSchema = z.object({
  cin: z.string().max(20),
  fullName: z.string().trim().min(2, 'Enter your full name as on your CIN.').max(80),
  dateOfBirth: z.iso.date('Enter your date of birth.'),
  expiryDate: z.iso.date('Enter the expiry date printed on your CIN.'),
});

/** Step 1: the website asks for a Mon e-ID session and shows the QR code / deep link. */
kycRouter.post('/mon-eid/start', async (req, res) => {
  const user = req.user!;
  if (user.kycStatus === 'verified') return res.json({ user: publicUser(user), alreadyVerified: true });
  if (!parseBody(startSchema, req, res)) return;
  if (!startLimit(user.id)) return fail(res, 429, 'RATE_LIMITED', 'Too many attempts. Try again in an hour.');
  res.status(201).json({ ...(await startSession(user.id)), simulator: env.MON_EID_SIMULATOR });
});

/** Step 3: the website polls until the phone has answered. */
kycRouter.get('/mon-eid/sessions/:id', async (req, res) => {
  const result = await pollSession(req.user!, String(req.params.id));
  if (!result) return fail(res, 404, 'NOT_FOUND', 'Unknown verification session.');
  res.json(result);
});

/** Step 2 (SIMULATION ONLY): what the Mon e-ID app on the phone would do. Disabled in production. */
kycRouter.post('/mon-eid/sessions/:id/approve', async (req, res) => {
  if (!env.MON_EID_SIMULATOR) return fail(res, 404, 'NOT_FOUND', 'Not found.');
  const claims = parseBody(claimsSchema, req, res);
  if (!claims) return;
  const ok = await approveOnPhone(req.user!.id, String(req.params.id), claims);
  if (!ok) return fail(res, 409, 'NOT_PENDING', 'This verification is no longer waiting for approval.');
  res.status(204).end();
});

kycRouter.post('/mon-eid/sessions/:id/decline', async (req, res) => {
  if (!env.MON_EID_SIMULATOR) return fail(res, 404, 'NOT_FOUND', 'Not found.');
  await declineOnPhone(req.user!.id, String(req.params.id));
  res.status(204).end();
});

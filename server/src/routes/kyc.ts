import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { fail, isUniqueViolation, parseBody } from '../auth/http';
import { requireAuth } from '../auth/middleware';
import { rateLimiter } from '../auth/rateLimit';
import { publicUser } from '../auth/session';
import { db, schema } from '../db/client';
import { fingerprintCin, kyc, normalizeCin } from '../kyc/provider';

const { users, auditLog } = schema;

export const kycRouter = Router();

const cinSchema = z.object({
  cin: z.string().max(20),
  fullName: z.string().trim().min(2, 'Enter your full name as on your CIN.').max(80),
  dateOfBirth: z.iso.date('Enter your date of birth.'),
  expiryDate: z.iso.date('Enter the expiry date printed on your CIN.'),
  consent: z.literal(true, { error: 'Please agree to the processing of your ID data.' }),
});

const attemptLimit = rateLimiter(5, 60 * 60 * 1000);

kycRouter.post('/cin', requireAuth, async (req, res) => {
  const user = req.user!;
  if (user.kycStatus === 'verified') return res.json({ user: publicUser(user) });

  const body = parseBody(cinSchema, req, res);
  if (!body) return;
  if (!attemptLimit(user.id)) return fail(res, 429, 'RATE_LIMITED', 'Too many attempts. Try again in an hour.');

  const cin = normalizeCin(body.cin);
  const result = await kyc.verify({ cin, fullName: body.fullName, dateOfBirth: body.dateOfBirth, expiryDate: body.expiryDate });
  if (!result.ok) {
    // The audit trail records the outcome, never the CIN or birth date.
    await db.insert(auditLog).values({ userId: user.id, action: 'kyc.rejected', detail: { reason: result.reason } });
    return fail(res, 422, 'KYC_REJECTED', result.reason);
  }

  try {
    const [updated] = await db
      .update(users)
      .set({ kycStatus: 'verified', kycVerifiedAt: new Date(), cinHash: fingerprintCin(cin), name: body.fullName })
      .where(eq(users.id, user.id))
      .returning();
    await db.insert(auditLog).values({ userId: user.id, action: 'kyc.verified', detail: { provider: 'mock' } });
    res.json({ user: publicUser(updated!) });
  } catch (err) {
    if (isUniqueViolation(err)) {
      await db.insert(auditLog).values({ userId: user.id, action: 'kyc.duplicate_cin' });
      return fail(res, 409, 'CIN_IN_USE', 'This CIN is already linked to another account.');
    }
    throw err;
  }
});

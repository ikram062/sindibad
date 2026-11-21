import { and, eq } from 'drizzle-orm';
import { publicUser, type SessionUser } from '../auth/session';
import { db, schema } from '../db/client';
import { fingerprintCin, kyc, normalizeCin } from './provider';
import { isUniqueViolation } from '../auth/http';

const { identitySessions, users, auditLog } = schema;

/**
 * SIMULATED Mon e-ID (DGSN trusted-third-party identity).
 *
 * Real flow this mimics: the website shows a QR code / deep link, the citizen opens the Mon e-ID app on their
 * phone, reads their electronic CIN, and approves sharing a few attributes; the platform then tells us the
 * result. Here the "phone" is a screen inside our own app that calls `approve`. We have NO connection to DGSN
 * and no documentation of its API, so a real integration would replace `approve` with DGSN's callback and keep
 * everything else (`start`, `poll`, the checks, the fingerprint).
 */
const SESSION_TTL_MS = 5 * 60 * 1000;

export async function startSession(userId: string) {
  const [row] = await db
    .insert(identitySessions)
    .values({ userId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) })
    .returning();
  return {
    sessionId: row!.id,
    deepLink: `moneid://sindibad/verify?session=${row!.id}`,
    expiresAt: row!.expiresAt.toISOString(),
  };
}

const owned = (userId: string, id: string) => and(eq(identitySessions.id, id), eq(identitySessions.userId, userId));

/** The simulated phone releases the citizen's attributes. */
export async function approveOnPhone(userId: string, id: string, claims: schema.IdentityClaims) {
  const [row] = await db
    .update(identitySessions)
    .set({ status: 'approved', claims })
    .where(and(owned(userId, id), eq(identitySessions.status, 'pending')))
    .returning();
  return Boolean(row);
}

export async function declineOnPhone(userId: string, id: string) {
  const [row] = await db
    .update(identitySessions)
    .set({ status: 'declined' })
    .where(and(owned(userId, id), eq(identitySessions.status, 'pending')))
    .returning();
  return Boolean(row);
}

export type PollResult =
  | { status: 'pending' | 'declined' }
  | { status: 'failed'; reason: string }
  | { status: 'completed'; user: ReturnType<typeof publicUser> };

const failSession = async (id: string, reason: string): Promise<PollResult> => {
  await db.update(identitySessions).set({ status: 'failed', failureReason: reason, claims: null }).where(eq(identitySessions.id, id));
  return { status: 'failed', reason };
};

/** Called by the website while the QR is on screen. Applies the identity once the phone has approved. */
export async function pollSession(user: SessionUser, id: string): Promise<PollResult | undefined> {
  const [row] = await db.select().from(identitySessions).where(owned(user.id, id));
  if (!row) return undefined;

  if (row.status === 'pending' && row.expiresAt <= new Date()) return failSession(id, 'This verification expired. Start again.');
  if (row.status === 'declined') return { status: 'declined' };
  if (row.status === 'failed') return { status: 'failed', reason: row.failureReason ?? 'Verification failed.' };
  if (row.status === 'completed') {
    const [u] = await db.select().from(users).where(eq(users.id, user.id));
    return { status: 'completed', user: publicUser(u!) };
  }
  if (row.status === 'pending') return { status: 'pending' };

  // approved: claim it so concurrent polls apply it only once
  const [claimed] = await db
    .update(identitySessions)
    .set({ status: 'completed' })
    .where(and(owned(user.id, id), eq(identitySessions.status, 'approved')))
    .returning();
  if (!claimed?.claims) return { status: 'pending' };
  const claims = claimed.claims;
  const cin = normalizeCin(claims.cin);

  const result = await kyc.verify({ cin, fullName: claims.fullName, dateOfBirth: claims.dateOfBirth, expiryDate: claims.expiryDate });
  if (!result.ok) {
    await db.insert(auditLog).values({ userId: user.id, action: 'kyc.rejected', detail: { reason: result.reason, method: 'mon_eid_simulated' } });
    return failSession(id, result.reason);
  }

  try {
    const [updated] = await db
      .update(users)
      .set({ kycStatus: 'verified', kycMethod: 'mon_eid_simulated', kycVerifiedAt: new Date(), cinHash: fingerprintCin(cin), name: claims.fullName })
      .where(eq(users.id, user.id))
      .returning();
    // Attributes are no longer needed once the fingerprint is stored.
    await db.update(identitySessions).set({ claims: null }).where(eq(identitySessions.id, id));
    await db.insert(auditLog).values({ userId: user.id, action: 'kyc.verified', detail: { method: 'mon_eid_simulated' } });
    return { status: 'completed', user: publicUser(updated!) };
  } catch (err) {
    if (isUniqueViolation(err)) {
      await db.insert(auditLog).values({ userId: user.id, action: 'kyc.duplicate_cin' });
      return failSession(id, 'This CIN is already linked to another account.');
    }
    throw err;
  }
}

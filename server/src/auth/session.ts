import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import type { Request, Response } from 'express';
import { db, schema } from '../db/client';
import { env } from '../env';

const { users, sessions } = schema;

const COOKIE = 'sindibad_session';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

const userColumns = {
  id: users.id,
  email: users.email,
  name: users.name,
  language: users.language,
  kycStatus: users.kycStatus,
  kycVerifiedAt: users.kycVerifiedAt,
};

export type SessionUser = Pick<
  typeof users.$inferSelect,
  'id' | 'email' | 'name' | 'language' | 'kycStatus' | 'kycVerifiedAt'
>;

/** What the browser is allowed to see about a user. */
export const publicUser = (u: SessionUser) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  language: u.language,
  kycStatus: u.kycStatus,
  kycVerifiedAt: u.kycVerifiedAt,
});

function readToken(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

export async function startSession(res: Response, userId: string) {
  const token = randomBytes(32).toString('base64url');
  // shortcut: expired sessions are never purged, add a cleanup worker before real traffic
  await db.insert(sessions).values({ tokenHash: sha256(token), userId, expiresAt: new Date(Date.now() + TTL_MS) });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax', // also what blocks cross-site form posts from carrying the cookie (CSRF)
    secure: env.NODE_ENV === 'production',
    maxAge: TTL_MS,
    path: '/',
  });
}

export async function endSession(req: Request, res: Response) {
  const token = readToken(req);
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
  res.clearCookie(COOKIE, { path: '/' });
}

export async function userFromRequest(req: Request): Promise<SessionUser | undefined> {
  const token = readToken(req);
  if (!token) return undefined;
  const [row] = await db
    .select(userColumns)
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())));
  return row;
}

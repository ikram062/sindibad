import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { fail, isUniqueViolation, parseBody } from '../auth/http';
import { hashPassword, verifyPassword } from '../auth/password';
import { rateLimiter } from '../auth/rateLimit';
import { endSession, publicUser, startSession, userFromRequest } from '../auth/session';
import { db, schema } from '../db/client';

const { users } = schema;

export const authRouter = Router();

const signupSchema = z.object({
  email: z.email('Enter a valid email address.').max(254),
  password: z.string().min(8, 'Password must be at least 8 characters.').max(128),
  name: z.string().trim().min(2, 'Enter your name.').max(80),
});
const loginSchema = z.object({ email: z.string().max(254), password: z.string().max(128) });

const signupLimit = rateLimiter(10, 60 * 60 * 1000);
const loginLimit = rateLimiter(10, 15 * 60 * 1000);

// Verified against when the email is unknown, so "no such user" costs the same time as "wrong password".
const DUMMY_HASH = await hashPassword('not-a-real-password');

authRouter.post('/signup', async (req, res) => {
  const body = parseBody(signupSchema, req, res);
  if (!body) return;
  if (!signupLimit(req.ip ?? 'unknown')) return fail(res, 429, 'RATE_LIMITED', 'Too many sign-ups. Try again later.');

  try {
    const [user] = await db
      .insert(users)
      .values({ email: body.email.toLowerCase(), name: body.name, passwordHash: await hashPassword(body.password) })
      .returning();
    await startSession(res, user!.id);
    res.status(201).json({ user: publicUser(user!) });
  } catch (err) {
    if (isUniqueViolation(err)) return fail(res, 409, 'EMAIL_TAKEN', 'An account with this email already exists.');
    throw err;
  }
});

authRouter.post('/login', async (req, res) => {
  const body = parseBody(loginSchema, req, res);
  if (!body) return;
  const email = body.email.toLowerCase();
  if (!loginLimit(`${req.ip}:${email}`)) {
    return fail(res, 429, 'RATE_LIMITED', 'Too many attempts. Try again in a few minutes.');
  }

  const [user] = await db.select().from(users).where(eq(users.email, email));
  const passwordOk = await verifyPassword(body.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !passwordOk) return fail(res, 401, 'BAD_CREDENTIALS', 'Invalid email or password.');

  await startSession(res, user.id);
  res.json({ user: publicUser(user) });
});

authRouter.post('/logout', async (req, res) => {
  await endSession(req, res);
  res.status(204).end();
});

/** 200 with `user: null` when signed out, so the browser can ask on page load without a console error. */
authRouter.get('/me', async (req, res) => {
  const user = await userFromRequest(req);
  res.json({ user: user ? publicUser(user) : null });
});

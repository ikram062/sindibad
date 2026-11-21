import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { fail, parseBody } from '../auth/http';
import { requireAuth } from '../auth/middleware';
import { verifyPassword } from '../auth/password';
import { rateLimiter } from '../auth/rateLimit';
import { db, schema } from '../db/client';
import { getCard, getSettings, monthSpendMad } from '../services/settings';

const { userSettings, paymentMethods, users, auditLog } = schema;

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

const passwordLimit = rateLimiter(5, 15 * 60 * 1000);

const view = async (userId: string) => {
  const s = await getSettings(userId);
  const card = await getCard(userId);
  return {
    settings: {
      autonomy: s.autonomy,
      maxPerPurchaseMad: Number(s.maxPerPurchaseMad),
      maxPerMonthMad: Number(s.maxPerMonthMad),
      autoEnabledAt: s.autoEnabledAt,
    },
    card: card ? { brand: card.brand, last4: card.last4 } : null,
    monthSpendMad: await monthSpendMad(userId),
  };
};

settingsRouter.get('/', async (req, res) => res.json(await view(req.user!.id)));

const updateSchema = z
  .object({
    autonomy: z.enum(['ask', 'auto']),
    maxPerPurchaseMad: z.number().min(1, 'Limit per purchase must be at least 1 MAD.').max(20_000, 'Limit per purchase is capped at 20,000 MAD.'),
    maxPerMonthMad: z.number().min(1).max(100_000, 'Monthly limit is capped at 100,000 MAD.'),
    password: z.string().max(128).optional(),
  })
  .refine((v) => v.maxPerMonthMad >= v.maxPerPurchaseMad, { message: 'The monthly limit cannot be lower than the per-purchase limit.' });

/**
 * Autonomy is changed ONLY here, never by the chat agent (it has no tool for it), so a prompt can't talk its way into
 * spending power. Turning auto-buying on, or raising its limits, needs a verified identity, a card and the password again.
 */
settingsRouter.put('/', async (req, res) => {
  const body = parseBody(updateSchema, req, res);
  if (!body) return;
  const user = req.user!;
  const current = await getSettings(user.id);

  if (body.autonomy === 'auto') {
    if (user.kycStatus !== 'verified') return fail(res, 403, 'KYC_REQUIRED', 'Verify your CIN before allowing automatic purchases.');
    if (!(await getCard(user.id))) return fail(res, 422, 'NO_CARD', 'Add a payment card before allowing automatic purchases.');
    const riskier =
      current.autonomy !== 'auto' || body.maxPerPurchaseMad > Number(current.maxPerPurchaseMad) || body.maxPerMonthMad > Number(current.maxPerMonthMad);
    if (riskier) {
      if (!body.password) return fail(res, 401, 'PASSWORD_REQUIRED', 'Enter your password to allow automatic purchases.');
      if (!passwordLimit(user.id)) return fail(res, 429, 'RATE_LIMITED', 'Too many attempts. Try again in a few minutes.');
      const [row] = await db.select().from(users).where(eq(users.id, user.id));
      if (!row || !(await verifyPassword(body.password, row.passwordHash))) return fail(res, 401, 'BAD_PASSWORD', 'Wrong password.');
    }
  }

  await db
    .update(userSettings)
    .set({
      autonomy: body.autonomy,
      maxPerPurchaseMad: String(body.maxPerPurchaseMad),
      maxPerMonthMad: String(body.maxPerMonthMad),
      autoEnabledAt: body.autonomy === 'auto' ? (current.autonomy === 'auto' ? current.autoEnabledAt : new Date()) : null,
      updatedAt: new Date(),
    })
    .where(eq(userSettings.userId, user.id));
  await db.insert(auditLog).values({
    userId: user.id,
    action: 'settings.autonomy',
    detail: { autonomy: body.autonomy, maxPerPurchaseMad: body.maxPerPurchaseMad, maxPerMonthMad: body.maxPerMonthMad },
  });
  res.json(await view(user.id));
});

/** SIMULATED card: no number is ever entered or stored. `declines` adds one that fails, to demo a declined payment. */
settingsRouter.post('/card', async (req, res) => {
  const declines = req.body?.declines === true;
  await db
    .insert(paymentMethods)
    .values({ userId: req.user!.id, brand: 'Visa', last4: declines ? '0002' : '4242' })
    .onConflictDoUpdate({ target: paymentMethods.userId, set: { brand: 'Visa', last4: declines ? '0002' : '4242' } });
  res.status(201).json(await view(req.user!.id));
});

settingsRouter.delete('/card', async (req, res) => {
  const userId = req.user!.id;
  await db.delete(paymentMethods).where(eq(paymentMethods.userId, userId));
  // No card, no automatic buying.
  await getSettings(userId);
  await db.update(userSettings).set({ autonomy: 'ask', autoEnabledAt: null, updatedAt: new Date() }).where(eq(userSettings.userId, userId));
  res.json(await view(userId));
});

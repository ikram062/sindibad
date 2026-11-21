import { and, eq, gte, sql } from 'drizzle-orm';
import { db, schema } from '../db/client';

const { userSettings, paymentMethods, purchases } = schema;

/** Settings row for the user, created with safe defaults (always ask) on first read. */
export async function getSettings(userId: string) {
  await db.insert(userSettings).values({ userId }).onConflictDoNothing();
  const [row] = await db.select().from(userSettings).where(eq(userSettings.userId, userId));
  return row!;
}

export async function getCard(userId: string) {
  const [row] = await db.select().from(paymentMethods).where(eq(paymentMethods.userId, userId));
  return row;
}

/** Dirhams spent (paid purchases) since the start of the current calendar month. */
export async function monthSpendMad(userId: string, now = new Date()): Promise<number> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${purchases.totalMad}), 0)` })
    .from(purchases)
    .where(and(eq(purchases.userId, userId), eq(purchases.status, 'paid'), gte(purchases.createdAt, start)));
  return Number(row?.total ?? 0);
}

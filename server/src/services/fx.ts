import { eq } from 'drizzle-orm';
import { db, schema } from '../db/client';

/** Dirhams per one unit of `currency`, and when that rate was recorded. */
export async function getRate(currency: string): Promise<{ madPerUnit: number; recordedAt: Date }> {
  if (currency === 'MAD') return { madPerUnit: 1, recordedAt: new Date() };
  const [row] = await db.select().from(schema.fxRates).where(eq(schema.fxRates.currency, currency));
  if (!row) throw new Error(`No exchange rate for ${currency}`);
  return { madPerUnit: Number(row.madPerUnit), recordedAt: row.recordedAt };
}

import { and, eq, ilike, or } from 'drizzle-orm';
import { db, schema } from '../db/client';
import { getRate } from './fx';

const { events } = schema;

export type EventRow = typeof events.$inferSelect;
export type SaleState = 'upcoming' | 'on_sale' | 'sold_out';

export const round2 = (n: number) => Math.round(n * 100) / 100;

export const saleState = (e: EventRow, now = new Date()): SaleState =>
  e.soldOut ? 'sold_out' : e.saleOpensAt > now ? 'upcoming' : 'on_sale';

/** What the agent and the UI see: the event plus every tier priced in dirhams. */
export async function toView(e: EventRow) {
  const { madPerUnit } = await getRate(e.currency);
  const tiers = e.tiers.map((t) => ({ ...t, priceMad: round2(t.price * madPerUnit) }));
  return {
    id: e.id,
    slug: e.slug,
    title: e.title,
    category: e.category,
    city: e.city,
    country: e.country,
    venue: e.venue,
    startsAt: e.startsAt.toISOString(),
    seller: e.seller,
    sellerUrl: e.sellerUrl,
    verifiedAt: e.verifiedAt ? e.verifiedAt.toISOString() : null,
    currency: e.currency,
    saleState: saleState(e),
    saleOpensAt: e.saleOpensAt.toISOString(),
    tiers,
    fromPriceMad: Math.min(...tiers.map((t) => t.priceMad)),
  };
}
export type EventView = Awaited<ReturnType<typeof toView>>;

export async function getEventById(id: string): Promise<EventRow | undefined> {
  const [row] = await db.select().from(events).where(eq(events.id, id));
  return row;
}

export type EventFilter = {
  query?: string;
  city?: string;
  country?: string;
  category?: string;
  maxPriceMad?: number;
};

/** Every query word must match the title, city, venue, country, category or seller. */
export async function searchEvents(f: EventFilter): Promise<EventView[]> {
  const conditions = [];
  for (const word of (f.query ?? '').split(/\s+/).filter(Boolean)) {
    const like = `%${word}%`;
    conditions.push(
      or(
        ilike(events.title, like),
        ilike(events.city, like),
        ilike(events.venue, like),
        ilike(events.country, like),
        ilike(events.category, like),
        ilike(events.seller, like),
      ),
    );
  }
  if (f.city) conditions.push(ilike(events.city, `%${f.city}%`));
  if (f.country) conditions.push(eq(events.country, f.country.toUpperCase()));
  if (f.category) conditions.push(ilike(events.category, f.category));

  const rows = await db.select().from(events).where(and(...conditions)).orderBy(events.startsAt).limit(20);
  // One listing that cannot be priced (e.g. a currency with no exchange rate) must not blank the whole catalogue.
  const priced = await Promise.all(
    rows.map((row) =>
      toView(row).catch((e: Error) => {
        console.error(`skipping event "${row.slug}": ${e.message}`);
        return null;
      }),
    ),
  );
  const views = priced.filter((v): v is EventView => v !== null);
  return f.maxPriceMad === undefined ? views : views.filter((v) => v.fromPriceMad <= f.maxPriceMad!);
}

import { and, notInArray, sql } from 'drizzle-orm';
import { db, schema } from './client';

const { events, fxRates, purchases, rules } = schema;

/**
 * REAL listings, read from the seller's public pages (iticket.ma, event listing pages) on 2026-11-21.
 *  - Prices are the "from" price shown on each listing card, in MAD. Ticket categories were not shown, so each
 *    event has a single "Standard" tier priced at that "from" price.
 *  - The listing pages show dates but not times, so startsAt is noon UTC on the listed date; the UI shows dates only.
 *  - Nothing here is bought through Sindibad: checkout in this prototype is simulated, and sellerUrl points to the
 *    real page where the real ticket is sold.
 *  - This is a snapshot, not a live feed. Prices and availability can change; re-check before relying on them.
 */
const CHECKED = new Date('2026-11-21T12:00:00Z');
const ITICKET = 'https://iticket.ma/en/events';

type Listing = {
  slug: string;
  title: string;
  category: 'concert' | 'festival' | 'other';
  city: string;
  venue: string;
  date: string;
  from: number;
  path: string;
};

const LISTINGS: Listing[] = [
  { slug: 'abba-tribute-casablanca', title: 'ABBA Tribute Live Show', category: 'concert', city: 'Casablanca', venue: "Théâtre l'Hermitage", date: '2026-12-01', from: 300, path: 'concerts/abba-tribute-live-show-casablanca' },
  { slug: 'abba-tribute-rabat', title: 'ABBA Tribute Live Show', category: 'concert', city: 'Rabat', venue: 'National Theatre Mohammed V', date: '2026-12-02', from: 300, path: 'concerts/abba-tribute-live-show-rabat' },
  { slug: 'abba-tribute-tanger', title: 'ABBA Tribute Live Show', category: 'concert', city: 'Tangier', venue: 'Palace of Art and Culture', date: '2026-12-03', from: 300, path: 'concerts/abba-tribute-live-show-tanger' },
  { slug: 'soiree-aissawa-rabat', title: 'Soirée Aïssawa avec Yassine ElJamai', category: 'concert', city: 'Rabat', venue: 'Bahnini Hall', date: '2026-12-04', from: 100, path: 'concerts/soiree-aissawa-avec-yassine-eljamai' },
  { slug: 'hajib-rabat', title: 'Hajib en Concert à Rabat', category: 'concert', city: 'Rabat', venue: 'National Theatre Mohammed V', date: '2026-12-04', from: 150, path: 'concerts/hajib-en-concert-a-rabat' },
  { slug: 'tiakola-casablanca', title: 'Tiakola en concert à Casablanca', category: 'concert', city: 'Casablanca', venue: 'Complexe Mohamed V', date: '2026-12-05', from: 320, path: 'concerts/tiakola-en-concert-a-casablanca' },
  { slug: 'stormy-desperado-casablanca', title: 'Stormy - Desperado', category: 'concert', city: 'Casablanca', venue: 'Complexe Mohamed V', date: '2026-12-11', from: 500, path: 'concerts/stormy-desperado-casablanca-11-12' },
  { slug: 'rnboi-elgrandetoto-rabat', title: 'RNBOI & ElGrandeToto en concert à Rabat', category: 'concert', city: 'Rabat', venue: 'Le grand pavillon Sofitel Rabat', date: '2026-12-13', from: 300, path: 'concerts/rnboi-and-elgrandetoto-en-concert-a-rabat' },
  { slug: 'rush-101-winter-agadir', title: 'RUSH 101 Winter Edition, ElGrandeToto', category: 'concert', city: 'Agadir', venue: 'Théâtre de Verdure', date: '2026-12-19', from: 200, path: 'concerts/rush-101-winter-edition-elgrandetoto-en-concert' },
  { slug: 'zona-adriatique-marrakech', title: 'ZONA presents AA Showcase with Adriatique', category: 'concert', city: 'Marrakech', venue: 'Playa Leone', date: '2026-12-19', from: 850, path: 'concerts/zona-pres-aa-showcase-with-adriatique' },
  { slug: 'nye-2027-agadir', title: "New Year's Eve 2027: Moroccan dinner, fantasia and grand celebration", category: 'festival', city: 'Agadir', venue: 'Chems Ayour', date: '2026-12-31', from: 450, path: 'concerts/reveillon-2027-diner-marocain-fantasia-and-grande-soiree' },
  { slug: 'daft-punk-tribute-marrakech', title: 'Daft Punk Tribute in Marrakech', category: 'concert', city: 'Marrakech', venue: 'Palais des Festivals et des Congrès', date: '2027-01-08', from: 300, path: 'concerts/daft-punk-tribute-a-marrakech' },
  { slug: 'daft-punk-tribute-rabat', title: 'Daft Punk Tribute in Rabat', category: 'concert', city: 'Rabat', venue: 'National Theatre Mohammed V', date: '2027-01-09', from: 300, path: 'concerts/daft-punk-tribute-a-rabat' },
  { slug: 'peter-pan-on-ice-rabat', title: 'Peter Pan on Ice by The International Ice Stars', category: 'other', city: 'Rabat', venue: 'Patinoire de Rabat', date: '2026-11-26', from: 100, path: 'theatre/peter-pan-on-ice-par-the-international-ice-stars' },
  { slug: 'co-mehdi-show-casablanca', title: 'CO-MEHDI SHOW', category: 'other', city: 'Casablanca', venue: "Théâtre l'Hermitage", date: '2026-11-27', from: 80, path: 'comedy/co-mehdi-show-casablanca' },
];

/** Dirhams per unit, kept for the day cross-border events return. Not used by the Morocco-only catalogue. */
const RATES: Record<string, number> = { EUR: 10.8, USD: 9.8, GBP: 12.4, KRW: 0.0067, XOF: 0.0165 };

/** Replaces the catalogue with the real listings above. Safe to run repeatedly. */
export async function seedCatalog(now = new Date()) {
  const rows: (typeof events.$inferInsert)[] = LISTINGS.map((l) => ({
    slug: l.slug,
    title: l.title,
    category: l.category,
    city: l.city,
    country: 'MA',
    venue: l.venue,
    startsAt: new Date(`${l.date}T12:00:00Z`),
    currency: 'MAD',
    tiers: [{ name: 'Standard', price: l.from }],
    seller: 'iticket.ma',
    sellerUrl: `${ITICKET}/${l.path}`,
    saleOpensAt: new Date(CHECKED.getTime() - 86_400_000), // on sale when it was checked
    soldOut: false,
    verifiedAt: CHECKED,
  }));

  for (const e of rows) {
    await db
      .insert(events)
      .values(e)
      .onConflictDoUpdate({
        target: events.slug,
        set: { title: e.title, category: e.category, city: e.city, country: e.country, venue: e.venue, startsAt: e.startsAt, currency: e.currency, tiers: e.tiers, seller: e.seller, sellerUrl: e.sellerUrl, saleOpensAt: e.saleOpensAt, soldOut: false, verifiedAt: e.verifiedAt },
      });
  }

  // Remove old demo events nobody has bought or made a rule for (anything still referenced is kept, never orphaned).
  const keep = rows.map((e) => e.slug);
  await db.delete(events).where(
    and(
      notInArray(events.slug, keep),
      sql`${events.slug} not like 'test-%'`,
      sql`${events.id} not in (select event_id from ${purchases})`,
      sql`${events.id} not in (select event_id from ${rules} where event_id is not null)`,
    ),
  );

  for (const [currency, madPerUnit] of Object.entries(RATES)) {
    await db
      .insert(fxRates)
      .values({ currency, madPerUnit: String(madPerUnit), recordedAt: now })
      .onConflictDoUpdate({ target: fxRates.currency, set: { madPerUnit: String(madPerUnit), recordedAt: now } });
  }
  return { events: rows.length, rates: Object.keys(RATES).length, checked: CHECKED.toISOString().slice(0, 10) };
}

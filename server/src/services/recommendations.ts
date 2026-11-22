import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db/client';
import { type EventView, searchEvents } from './events';

const { userPreferences, rules } = schema;

export type Prefs = { cities: string[]; categories: string[]; maxPriceMad: number | null; keywords: string };
const EMPTY: Prefs = { cities: [], categories: [], maxPriceMad: null, keywords: '' };

export async function getPrefs(userId: string): Promise<Prefs> {
  const [row] = await db.select().from(userPreferences).where(eq(userPreferences.userId, userId));
  if (!row) return EMPTY;
  return {
    cities: row.cities,
    categories: row.categories,
    maxPriceMad: row.maxPriceMad === null ? null : Number(row.maxPriceMad),
    keywords: row.keywords ?? '',
  };
}

export async function savePrefs(userId: string, p: Prefs): Promise<Prefs> {
  const values = { userId, cities: p.cities, categories: p.categories, maxPriceMad: p.maxPriceMad === null ? null : String(p.maxPriceMad), keywords: p.keywords, updatedAt: new Date() };
  await db.insert(userPreferences).values(values).onConflictDoUpdate({ target: userPreferences.userId, set: values });
  return getPrefs(userId);
}

export type MatchReason = 'CITY' | 'CATEGORY' | 'BUDGET' | 'KEYWORD';
const WEIGHT: Record<MatchReason, number> = { CITY: 3, CATEGORY: 2, BUDGET: 2, KEYWORD: 3 };

/**
 * Events that fit what the user told us, best match first. Plain code, no AI: every result says WHY it matched, so
 * the screen can show the reasons and the user can trust (or fix) the list.
 *  - City, type and budget are filters (when set). Interests (keywords) only raise the ranking...
 *  - ...unless they are the only thing the user filled in, in which case they filter too.
 */
export async function recommend(userId: string) {
  const prefs = await getPrefs(userId);
  const events = await searchEvents({});
  const words = prefs.keywords.toLowerCase().split(/[\s,]+/).filter((w) => w.length > 1);
  const hasFilters = prefs.cities.length > 0 || prefs.categories.length > 0 || prefs.maxPriceMad !== null;

  const items: { event: EventView; reasons: MatchReason[]; score: number }[] = [];
  for (const event of events) {
    const reasons: MatchReason[] = [];
    const cityOk = prefs.cities.length === 0 || prefs.cities.includes(event.city);
    const categoryOk = prefs.categories.length === 0 || prefs.categories.includes(event.category);
    const budgetOk = prefs.maxPriceMad === null || event.fromPriceMad <= prefs.maxPriceMad;
    if (prefs.cities.length > 0 && cityOk) reasons.push('CITY');
    if (prefs.categories.length > 0 && categoryOk) reasons.push('CATEGORY');
    if (prefs.maxPriceMad !== null && budgetOk) reasons.push('BUDGET');
    const text = `${event.title} ${event.venue} ${event.city}`.toLowerCase();
    const keywordHit = words.length > 0 && words.some((w) => text.includes(w));
    if (keywordHit) reasons.push('KEYWORD');

    const fits = hasFilters ? cityOk && categoryOk && budgetOk : words.length > 0 ? keywordHit : true;
    if (fits) items.push({ event, reasons, score: reasons.reduce((n, r) => n + WEIGHT[r], 0) });
  }
  items.sort((a, b) => b.score - a.score || a.event.startsAt.localeCompare(b.event.startsAt));

  // Which of these events already have an active rule from this user (so the screen shows "Alert on").
  const ids = items.map((i) => i.event.id);
  const mine = ids.length
    ? await db.select({ eventId: rules.eventId, kind: rules.kind }).from(rules).where(and(eq(rules.userId, userId), eq(rules.status, 'active'), inArray(rules.eventId, ids)))
    : [];

  return {
    prefs,
    hasPreferences: hasFilters || words.length > 0,
    items: items.map(({ event, reasons }) => ({ event, reasons, activeRules: mine.filter((r) => r.eventId === event.id).map((r) => r.kind) })),
  };
}

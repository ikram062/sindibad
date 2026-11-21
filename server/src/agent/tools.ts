import { tool } from 'ai';
import { z } from 'zod';
import type { SessionUser } from '../auth/session';
import { checkEligibility } from '../services/eligibility';
import { getEventById, searchEvents, toView } from '../services/events';
import { createPurchaseProposal, createRuleProposal } from '../services/proposals';
import { changeRule, listRules } from '../services/rules';
import { getCard, getSettings, monthSpendMad } from '../services/settings';
import { computeTotal, MAX_QUANTITY } from '../services/totals';

const err = (code: string, message: string, extra: object = {}) => ({ ok: false as const, code, message, ...extra });

/**
 * The agent's whole vocabulary. Every tool either READS or DRAFTS (writes a pending proposal).
 * There is deliberately no tool that buys, and none that changes settings.
 */
export function buildTools(user: SessionUser, lastUserText: string) {
  const eventId = z.string().describe('The event id returned by search_events');
  const tier = z.string().optional().describe('Ticket type name, e.g. "Standard". Omit for the cheapest.');
  const quantity = z.number().int().min(1).max(MAX_QUANTITY).default(1);

  return {
    search_events: tool({
      description:
        'Search the ticket catalogue. Use short English keywords. Returns events with prices in dirhams and whether sales are open.',
      inputSchema: z.object({
        query: z.string().optional().describe('1-3 short English keywords, e.g. "Morocco Senegal" or "jazz"'),
        city: z.string().optional(),
        country: z.string().length(2).optional().describe('ISO 3166-1 alpha-2 code, e.g. MA, KR, FR'),
        category: z.enum(['football', 'concert', 'festival', 'other']).optional(),
        maxPriceMad: z.number().positive().optional().describe('Maximum price per ticket, in dirhams'),
      }),
      execute: async (input) => {
        const found = await searchEvents(input);
        return { ok: true as const, count: found.length, events: found };
      },
    }),

    get_event: tool({
      description: 'Full details of one event: venue, date, seller, sale status and every ticket type priced in dirhams.',
      inputSchema: z.object({ eventId }),
      execute: async ({ eventId }) => {
        const e = await getEventById(eventId);
        return e ? { ok: true as const, event: await toView(e) } : err('NOT_FOUND', 'That event does not exist.');
      },
    }),

    compute_total: tool({
      description: 'The exact total in dirhams for a number of tickets, line by line (price, currency conversion, fees).',
      inputSchema: z.object({ eventId, tier, quantity }),
      execute: async (i) => {
        const e = await getEventById(i.eventId);
        if (!e) return err('NOT_FOUND', 'That event does not exist.');
        try {
          return { ok: true as const, event: await toView(e), total: await computeTotal(e, i.tier, i.quantity) };
        } catch (x) {
          return err('INVALID', (x as Error).message);
        }
      },
    }),

    check_eligibility: tool({
      description:
        'Can this user buy this event right now? Checks sale status, country restrictions, the foreign-currency allowance, identity verification and the saved card. Always explains why not.',
      inputSchema: z.object({ eventId, tier, quantity }),
      execute: async (i) => {
        const e = await getEventById(i.eventId);
        if (!e) return err('NOT_FOUND', 'That event does not exist.');
        try {
          const total = await computeTotal(e, i.tier, i.quantity);
          return { ok: true as const, event: await toView(e), total, eligibility: await checkEligibility(user, e, total.totalMad) };
        } catch (x) {
          return err('INVALID', (x as Error).message);
        }
      },
    }),

    draft_purchase: tool({
      description:
        'Prepare a purchase for the user to confirm. Nothing is bought until the user taps Confirm. Fails with the reason if the purchase is not possible.',
      inputSchema: z.object({ eventId, tier, quantity }),
      execute: async (i) => {
        if (user.kycStatus !== 'verified') return err('KYC_REQUIRED', 'The user must verify their CIN with Mon e-ID before buying.');
        const e = await getEventById(i.eventId);
        if (!e) return err('NOT_FOUND', 'That event does not exist.');
        try {
          const total = await computeTotal(e, i.tier, i.quantity);
          const eligibility = await checkEligibility(user, e, total.totalMad);
          if (eligibility.status !== 'allowed') {
            return err(eligibility.reasons[0]!.code, eligibility.reasons[0]!.message, { reasons: eligibility.reasons });
          }
          return { ok: true as const, proposal: await createPurchaseProposal(user, i, 'chat') };
        } catch (x) {
          return err('INVALID', (x as Error).message);
        }
      },
    }),

    draft_rule: tool({
      description:
        'Prepare a standing rule for the user to confirm: kind "alert" tells them when matching tickets are on sale; kind "buy" prepares a purchase when they match. Only when the user explicitly asks for it.',
      inputSchema: z.object({
        kind: z.enum(['alert', 'buy']),
        eventId: eventId.optional().describe('A specific event, if the user means one'),
        query: z.string().optional().describe('Otherwise short English keywords describing the events to watch'),
        tier,
        maxPriceMad: z.number().positive().optional().describe('Maximum price per ticket in dirhams. REQUIRED for kind "buy".'),
        quantity,
        expiresInDays: z.number().int().min(1).max(90).default(30),
      }),
      execute: async (i) => {
        if (!i.eventId && !i.query) return err('INVALID', 'A rule needs a specific event or some keywords to watch.');
        if (i.kind === 'buy') {
          if (user.kycStatus !== 'verified') return err('KYC_REQUIRED', 'The user must verify their CIN with Mon e-ID before creating a rule that buys.');
          if (i.maxPriceMad === undefined) return err('PRICE_CAP_REQUIRED', 'Ask the user for the maximum price per ticket before drafting a buy rule.');
        }
        try {
          const proposal = await createRuleProposal(user, {
            kind: i.kind,
            eventId: i.eventId,
            query: i.query,
            tier: i.tier,
            maxPriceMad: i.maxPriceMad,
            quantity: i.quantity,
            expiresAt: new Date(Date.now() + i.expiresInDays * 86_400_000).toISOString(),
            sourceText: lastUserText.slice(0, 300),
          });
          return { ok: true as const, proposal };
        } catch (x) {
          return err('INVALID', (x as Error).message);
        }
      },
    }),

    list_rules: tool({
      description: "The user's rules and what happened to them.",
      inputSchema: z.object({}),
      execute: async () => {
        const rows = await listRules(user.id);
        return {
          ok: true as const,
          rules: rows.map(({ rule: r, eventTitle }) => ({
            id: r.id,
            kind: r.kind,
            status: r.status,
            outcome: r.outcome,
            event: eventTitle ?? r.query,
            maxPriceMad: r.maxPriceMad === null ? null : Number(r.maxPriceMad),
            quantity: r.quantity,
            expiresAt: r.expiresAt,
          })),
        };
      },
    }),

    manage_rule: tool({
      description: 'Pause, resume or cancel one of the user\'s rules, when they ask.',
      inputSchema: z.object({ ruleId: z.string(), action: z.enum(['pause', 'resume', 'cancel']) }),
      execute: async ({ ruleId, action }) => {
        const row = await changeRule(user.id, ruleId, action);
        return row ? { ok: true as const, ruleId: row.id, status: row.status } : err('NOT_ALLOWED', `That rule cannot be ${action}d right now.`);
      },
    }),

    get_settings: tool({
      description: 'Read-only: whether purchases need confirmation or may happen automatically, the limits, and the saved card. Settings can only be changed on the Settings page.',
      inputSchema: z.object({}),
      execute: async () => {
        const s = await getSettings(user.id);
        const card = await getCard(user.id);
        return {
          ok: true as const,
          autonomy: s.autonomy,
          maxPerPurchaseMad: Number(s.maxPerPurchaseMad),
          maxPerMonthMad: Number(s.maxPerMonthMad),
          spentThisMonthMad: await monthSpendMad(user.id),
          card: card ? `${card.brand} ending ${card.last4}` : null,
          identityVerified: user.kycStatus === 'verified',
        };
      },
    }),
  };
}

import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Sindibad schema (tickets).
 *
 * Principles:
 *  - The AI never executes. It writes a `proposals` row; only a user confirmation (or a pre-authorised
 *    rule inside the user's autonomy limits) turns it into a `purchases` row.
 *  - Money is numeric (a string in JS). Totals are computed in services/totals.ts only.
 *  - Nothing sensitive is stored: no CIN (only a fingerprint), no card number (only brand + last 4).
 */

const ts = (name: string) => timestamp(name, { withTimezone: true });

// ───────────────────────── users, sessions, identity ─────────────────────────

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  /** scrypt, formatted as salt:hash (hex). Never the password. */
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  language: text('language', { enum: ['darija', 'fr', 'ar'] })
    .notNull()
    .default('fr'),
  /** Nothing can be purchased until this is 'verified' (enforced by requireKyc). */
  kycStatus: text('kyc_status', { enum: ['unverified', 'verified'] })
    .notNull()
    .default('unverified'),
  /** How the identity was confirmed, e.g. 'mon_eid_simulated'. */
  kycMethod: text('kyc_method'),
  /**
   * Keyed hash (HMAC-SHA256) of the normalized CIN. The CIN itself is never stored;
   * the unique constraint stops one CIN from being linked to two accounts.
   */
  cinHash: text('cin_hash').unique(),
  kycVerifiedAt: ts('kyc_verified_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

/** Server-side login sessions. Only the SHA-256 of the cookie token is stored. */
export const sessions = pgTable(
  'sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: ts('expires_at').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export type IdentityClaims = { cin: string; fullName: string; dateOfBirth: string; expiryDate: string };

/** One Mon e-ID verification attempt (QR shown on the website, approved on the phone). */
export const identitySessions = pgTable('identity_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  status: text('status', { enum: ['pending', 'approved', 'declined', 'completed', 'failed'] })
    .notNull()
    .default('pending'),
  /** What the phone released. Cleared as soon as the session is completed. */
  claims: jsonb('claims').$type<IdentityClaims>(),
  failureReason: text('failure_reason'),
  expiresAt: ts('expires_at').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

// ───────────────────────── catalogue & rates ─────────────────────────

export type Tier = { name: string; price: number };

export const events = pgTable('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  category: text('category', { enum: ['football', 'concert', 'festival', 'other'] }).notNull(),
  city: text('city').notNull(),
  /** ISO 3166-1 alpha-2, e.g. MA, KR, FR. */
  country: text('country').notNull(),
  venue: text('venue').notNull(),
  startsAt: ts('starts_at').notNull(),
  /** Currency the seller charges in (ISO 4217). */
  currency: text('currency').notNull(),
  tiers: jsonb('tiers').$type<Tier[]>().notNull(),
  seller: text('seller').notNull(),
  sellerUrl: text('seller_url'),
  saleOpensAt: ts('sale_opens_at').notNull(),
  soldOut: boolean('sold_out').notNull().default(false),
  /** When a person last checked this listing against the seller's page. null = demo/fixture data. */
  verifiedAt: ts('verified_at'),
});

/** Dirhams per one unit of `currency`. Demo rates; a real build reads a licensed provider. */
export const fxRates = pgTable('fx_rates', {
  currency: text('currency').primaryKey(),
  madPerUnit: numeric('mad_per_unit', { precision: 14, scale: 6 }).notNull(),
  recordedAt: ts('recorded_at').notNull().defaultNow(),
  source: text('source').notNull().default('demo'),
});

// ───────────────────────── user settings & payment ─────────────────────────

/**
 * Saved card, SIMULATED: brand and last four digits only. A real build stores a token
 * from a PCI-compliant payment provider, never a card number.
 */
export const paymentMethods = pgTable('payment_methods', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  brand: text('brand').notNull(),
  last4: text('last4').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

/** 'ask' = every purchase needs the user's tap. 'auto' = a pre-authorised rule may buy within these limits. */
export const userSettings = pgTable('user_settings', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  autonomy: text('autonomy', { enum: ['ask', 'auto'] })
    .notNull()
    .default('ask'),
  maxPerPurchaseMad: numeric('max_per_purchase_mad', { precision: 14, scale: 2 }).notNull().default('1000'),
  maxPerMonthMad: numeric('max_per_month_mad', { precision: 14, scale: 2 }).notNull().default('3000'),
  autoEnabledAt: ts('auto_enabled_at'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/** What the user likes. Drives the For-you page. Empty arrays / null mean no restriction. */
export const userPreferences = pgTable('user_preferences', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  cities: jsonb('cities').$type<string[]>().notNull().default([]),
  categories: jsonb('categories').$type<string[]>().notNull().default([]),
  maxPriceMad: numeric('max_price_mad', { precision: 14, scale: 2 }),
  keywords: text('keywords'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

// ───────────────────────── rules, proposals, purchases ─────────────────────────

/** A standing instruction the user gave in chat, e.g. "buy 2 tickets if this drops under 900 MAD". */
export const rules = pgTable(
  'rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['alert', 'buy'] }).notNull(),
    /** Either a specific event, or a free-text match such as "Morocco football Rabat". */
    eventId: uuid('event_id').references(() => events.id),
    query: text('query'),
    tier: text('tier'),
    /** Per ticket, in dirhams. null = any price. */
    maxPriceMad: numeric('max_price_mad', { precision: 14, scale: 2 }),
    quantity: integer('quantity').notNull().default(1),
    /** Every rule must expire. */
    expiresAt: ts('expires_at').notNull(),
    status: text('status', { enum: ['active', 'paused', 'fulfilled', 'cancelled', 'expired'] })
      .notNull()
      .default('active'),
    outcome: text('outcome', { enum: ['notified', 'proposed', 'purchased', 'blocked'] }),
    outcomeDetail: text('outcome_detail'),
    /** Parameters the client uses to write the outcome in the user's language (event, total, why...). */
    outcomeData: jsonb('outcome_data').$type<Record<string, string | number>>(),
    firedAt: ts('fired_at'),
    /** The user's own words, so the Rules page can show where the rule came from. */
    sourceText: text('source_text'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('rules_user_status_idx').on(t.userId, t.status)],
);

export type ProposalKind = 'purchase' | 'rule';

/**
 * Human-in-the-loop. The agent (or a rule in 'ask' mode) can only DRAFT: it writes a proposal that the
 * UI renders as a confirm card. Nothing happens until the user confirms.
 */
export const proposals = pgTable('proposals', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['purchase', 'rule'] }).notNull(),
  /** Exactly what will be executed on confirm. */
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  /** What the card shows (cost lines, totals, rule summary). */
  summary: jsonb('summary').$type<Record<string, unknown>>().notNull(),
  source: text('source', { enum: ['chat', 'rule', 'ui'] }).notNull().default('chat'),
  status: text('status', { enum: ['pending', 'confirmed', 'dismissed', 'expired'] })
    .notNull()
    .default('pending'),
  expiresAt: ts('expires_at').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  resolvedAt: ts('resolved_at'),
});

export const purchases = pgTable(
  'purchases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    tier: text('tier').notNull(),
    quantity: integer('quantity').notNull(),
    unitPriceLocal: numeric('unit_price_local', { precision: 14, scale: 2 }).notNull(),
    currency: text('currency').notNull(),
    fxMadPerUnit: numeric('fx_mad_per_unit', { precision: 14, scale: 6 }).notNull(),
    ticketsMad: numeric('tickets_mad', { precision: 14, scale: 2 }).notNull(),
    spreadMad: numeric('spread_mad', { precision: 14, scale: 2 }).notNull(),
    feeMad: numeric('fee_mad', { precision: 14, scale: 2 }).notNull(),
    totalMad: numeric('total_mad', { precision: 14, scale: 2 }).notNull(),
    status: text('status', { enum: ['paid', 'failed'] }).notNull(),
    paymentRef: text('payment_ref'),
    via: text('via', { enum: ['manual', 'auto_rule'] }).notNull(),
    ruleId: uuid('rule_id').references(() => rules.id),
    proposalId: uuid('proposal_id').references(() => proposals.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('purchases_user_idx').on(t.userId, t.createdAt)],
);

// ───────────────────────── conversation, notifications, audit ─────────────────────────

/** One running conversation per user. Messages are AI SDK UIMessages (text + tool parts) stored as-is. */
export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  // shortcut: whole history in one jsonb value, split into a messages table when conversations get long
  messages: jsonb('messages').$type<unknown[]>().notNull().default([]),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['rule', 'purchase', 'system'] }).notNull(),
    /** English fallback text. The client translates from `code` + `params` when it knows the code. */
    title: text('title').notNull(),
    body: text('body').notNull(),
    code: text('code'),
    params: jsonb('params').$type<Record<string, string | number>>(),
    /** When set, the notification offers a Confirm button for that proposal. */
    proposalId: uuid('proposal_id').references(() => proposals.id),
    readAt: ts('read_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.createdAt)],
);

export const auditLog = pgTable('audit_log', {
  id: serial('id').primaryKey(),
  userId: uuid('user_id'),
  action: text('action').notNull(),
  detail: jsonb('detail'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

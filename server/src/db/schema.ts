import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Sindibad schema (stocks + IPOs only).
 *
 * Design rules taken from the report:
 *  - Sindibad is NOT the broker. `orders` and `holdings` model what the PARTNER
 *    broker holds. In the prototype a MockBroker owns these tables; with a real
 *    partner they become API calls and these tables become a cache/audit copy.
 *  - The agent never executes anything: it creates a `proposals` row, and only a
 *    user confirmation turns it into a real `rules` / `orders` row.
 *  - Every price carries its recorded time + delay, so alerts can state it.
 *  - Money is numeric (string in JS), never float.
 */

const ts = (name: string) => timestamp(name, { withTimezone: true });

// ───────────────────────── users & limits ─────────────────────────

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
  /**
   * Keyed hash (HMAC-SHA256) of the normalized CIN. The CIN itself is never stored;
   * the unique constraint stops one CIN from being linked to two accounts.
   */
  cinHash: text('cin_hash').unique(),
  kycVerifiedAt: ts('kyc_verified_at'),
  /** Risk warning must be accepted before the first order. */
  riskWarningAcceptedAt: ts('risk_warning_accepted_at'),
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

/**
 * The "envelope": a fixed amount the user sets aside for rules. Rules can only
 * spend from it. Also holds the per-user caps (low defaults, raised after 30 days).
 */
export const envelopes = pgTable('envelopes', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  balanceMad: numeric('balance_mad', { precision: 14, scale: 2 }).notNull().default('0'),
  maxPerOrderMad: numeric('max_per_order_mad', { precision: 14, scale: 2 }).notNull().default('500'),
  maxPerDayMad: numeric('max_per_day_mad', { precision: 14, scale: 2 }).notNull().default('1000'),
  maxPerWeekMad: numeric('max_per_week_mad', { precision: 14, scale: 2 }).notNull().default('2000'),
  maxPerMonthMad: numeric('max_per_month_mad', { precision: 14, scale: 2 }).notNull().default('5000'),
  maxAutoOrdersPerWeek: integer('max_auto_orders_per_week').notNull().default(3),
  limitsRaisedAt: ts('limits_raised_at'),
});

// ───────────────────────── market data ─────────────────────────

export const instruments = pgTable('instruments', {
  ticker: text('ticker').primaryKey(),
  name: text('name').notNull(),
  sector: text('sector'),
  currency: text('currency').notNull().default('MAD'),
});

export const priceTicks = pgTable(
  'price_ticks',
  {
    id: serial('id').primaryKey(),
    ticker: text('ticker')
      .notNull()
      .references(() => instruments.ticker, { onDelete: 'cascade' }),
    priceMad: numeric('price_mad', { precision: 12, scale: 2 }).notNull(),
    /** When the price was recorded. Every alert/answer must state this. */
    recordedAt: ts('recorded_at').notNull().defaultNow(),
    /** Public Bourse prices are delayed by at least 15 minutes. */
    delayMinutes: integer('delay_minutes').notNull().default(15),
    /** Implausible jump: held back, never triggers alerts. */
    flagged: boolean('flagged').notNull().default(false),
    source: text('source').notNull().default('seed'),
  },
  (t) => [index('price_ticks_ticker_time_idx').on(t.ticker, t.recordedAt)],
);

export const ipos = pgTable('ipos', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  ticker: text('ticker'),
  priceMad: numeric('price_mad', { precision: 12, scale: 2 }),
  opensAt: ts('opens_at'),
  closesAt: ts('closes_at'),
  subscribeWhere: text('subscribe_where'),
  sourceUrl: text('source_url'),
  /** Watcher drafts as 'pending'; a teammate confirms before anything goes out. */
  status: text('status', { enum: ['pending', 'published'] }).notNull().default('pending'),
  createdAt: ts('created_at').notNull().defaultNow(),
  confirmedAt: ts('confirmed_at'),
});

// ───────────────────────── alerts, proposals, rules ─────────────────────────

export const alerts = pgTable('alerts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  ticker: text('ticker')
    .notNull()
    .references(() => instruments.ticker),
  direction: text('direction', { enum: ['below', 'above'] }).notNull(),
  thresholdMad: numeric('threshold_mad', { precision: 12, scale: 2 }).notNull(),
  status: text('status', { enum: ['active', 'triggered', 'cancelled', 'expired'] })
    .notNull()
    .default('active'),
  /** One notification per crossing, not one per update. */
  triggeredAt: ts('triggered_at'),
  expiresAt: ts('expires_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

/**
 * Human-in-the-loop. The agent can only DRAFT: it writes a proposal that the UI
 * renders as a confirm card. Nothing is executed until the user confirms.
 */
export const proposals = pgTable('proposals', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['order', 'rule'] }).notNull(),
  /** Exactly what the user will confirm (ticker, amount, limit price, end date…). */
  payload: jsonb('payload').notNull(),
  /** Line-by-line fee breakdown shown on the card. */
  fees: jsonb('fees').notNull(),
  status: text('status', { enum: ['pending', 'confirmed', 'dismissed', 'expired'] })
    .notNull()
    .default('pending'),
  createdAt: ts('created_at').notNull().defaultNow(),
  resolvedAt: ts('resolved_at'),
});

export const rules = pgTable('rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  proposalId: uuid('proposal_id').references(() => proposals.id),
  ticker: text('ticker')
    .notNull()
    .references(() => instruments.ticker),
  /** "buy if the price falls under X": sent to the broker as a limit order. */
  triggerPriceMad: numeric('trigger_price_mad', { precision: 12, scale: 2 }).notNull(),
  amountMad: numeric('amount_mad', { precision: 14, scale: 2 }).notNull(),
  /** Every rule must expire. */
  expiresAt: ts('expires_at').notNull(),
  status: text('status', { enum: ['active', 'filled', 'expired', 'cancelled'] })
    .notNull()
    .default('active'),
  createdAt: ts('created_at').notNull().defaultNow(),
  cancelledAt: ts('cancelled_at'),
});

// ───────────────────────── partner broker side (mocked) ─────────────────────────

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ticker: text('ticker')
      .notNull()
      .references(() => instruments.ticker),
    kind: text('kind', { enum: ['direct', 'rule'] }).notNull(),
    ruleId: uuid('rule_id').references(() => rules.id),
    amountMad: numeric('amount_mad', { precision: 14, scale: 2 }).notNull(),
    /** null = at market. Rules are always limit orders held by the broker. */
    limitPriceMad: numeric('limit_price_mad', { precision: 12, scale: 2 }),
    quantity: numeric('quantity', { precision: 14, scale: 4 }),
    fillPriceMad: numeric('fill_price_mad', { precision: 12, scale: 2 }),
    status: text('status', { enum: ['open', 'filled', 'cancelled', 'rejected'] })
      .notNull()
      .default('open'),
    fees: jsonb('fees'),
    createdAt: ts('created_at').notNull().defaultNow(),
    filledAt: ts('filled_at'),
  },
  (t) => [index('orders_user_idx').on(t.userId, t.createdAt)],
);

/** Held at the broker in the user's name (Maroclear is the central depository). */
export const holdings = pgTable(
  'holdings',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ticker: text('ticker')
      .notNull()
      .references(() => instruments.ticker),
    quantity: numeric('quantity', { precision: 14, scale: 4 }).notNull(),
    avgPriceMad: numeric('avg_price_mad', { precision: 12, scale: 2 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.ticker] })],
);

// ───────────────────────── knowledge base for the assistant (RAG) ─────────────────────────

export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  sourceUrl: text('source_url'),
  language: text('language'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

/**
 * Embeddings stored as float arrays; cosine similarity is computed in the app.
 * Fine for a few hundred chunks and needs no extension. At startup scale, switch
 * this column to pgvector's `vector(768)` with an HNSW index.
 */
export const documentChunks = pgTable(
  'document_chunks',
  {
    id: serial('id').primaryKey(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    content: text('content').notNull(),
    embedding: real('embedding').array(),
  },
  (t) => [index('document_chunks_doc_idx').on(t.documentId, t.position)],
);

// ───────────────────────── conversation, notifications, audit ─────────────────────────

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
    /** AI SDK UIMessage parts (text, tool calls/results) stored as-is. */
    parts: jsonb('parts').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('messages_conv_idx').on(t.conversationId, t.createdAt)],
);

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['alert', 'ipo', 'rule', 'system'] }).notNull(),
  body: text('body').notNull(),
  data: jsonb('data'),
  createdAt: ts('created_at').notNull().defaultNow(),
  readAt: ts('read_at'),
});

export const auditLog = pgTable('audit_log', {
  id: serial('id').primaryKey(),
  userId: uuid('user_id'),
  action: text('action').notNull(),
  detail: jsonb('detail'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

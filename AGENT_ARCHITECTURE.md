# Sindibad: Agent Architecture, A to Z

A beginner-friendly guide to how the Sindibad agent works. No prior knowledge of AI agents is assumed.

> **Scope for now: tickets only** (football matches, concerts, events). Stocks are out. Other assets (albums, art, etc.) and international purchases beyond tickets are *future work*, see the last section.
>
> **Status:** this document describes the **design**. The repo currently has the project skeleton (Express server, React shell, Postgres connection). The database schema in `server/src/db/schema.ts` is still the old stock version and will be rewritten for tickets before the agent is built.

---

## 1. What are we building?

Sindibad is a **chat app** (typed or spoken) that helps a Moroccan user find tickets, understand the real total cost, get told when sales open or prices change, and prepare a purchase. The user talks to it in Darija, French or Arabic. There are no dashboards of buttons; the conversation *is* the interface, and the assistant answers with small interactive cards (an event card, a price breakdown, a confirm card).

One rule defines the whole design: **the user decides, the system executes.** The AI never buys anything by itself. It can only *propose*, and a human tap turns the proposal into a real action.

---

## 2. The ideas you need first

**LLM (large language model).** A program that reads text and writes text. Here we use Google's Gemini through the free AI Studio key. On its own it only talks: it can't look up an event or spend money.

**Tool (function calling).** We give the model a menu of functions we wrote, each with a name, a description and typed inputs (for example `search_events({ query, city })`). When the user asks something that needs data, the model doesn't answer. It replies "please call `search_events` with these arguments". **Our server** runs the function and gives the result back to the model. The model never touches the database directly; it can only *ask*.

**Agent loop.** An "agent" is an LLM that repeats this cycle until done: think, call a tool, read the result, think again, ... then answer. One user message can trigger several tool calls (find the event, check eligibility, compute the total).

**Streaming.** The reply travels to the browser word by word instead of arriving all at once, so the chat feels alive.

**Generative UI.** When a tool returns data, the browser doesn't just print text. It maps the tool name to a React component: `search_events` becomes `<EventCard />`, `compute_total` becomes `<PriceBreakdownCard />`. That's how a chat can show rich, tappable UI.

**Proposal then confirm (human-in-the-loop).** Anything with consequences goes through two steps. The agent *drafts* a proposal (a row in the database). The UI shows it as a confirm card with every cost listed. Only when the user taps **Confirm** does the system act.

**Guardrails.** Safety rules written as **code**, not just instructions to the AI. A prompt can be ignored or tricked; code can't. Example: the amount limit is checked by a server function, so no clever message can bypass it.

**RAG (retrieval-augmented generation).** For questions like "can I use my card abroad?" the assistant first *searches* our own documents and then answers *only from what it found*, citing the source. If nothing relevant is found, it says "I don't know".

**Embeddings.** A way to turn text into numbers so that texts with similar *meaning* get similar numbers. This lets a question in Darija find a matching passage written in French. We store them in Postgres and compare them in the app.

**Ports and adapters (mocks).** Anything outside our control (ticket sellers, banks, currency rates) is hidden behind an interface called a *port*. In the prototype each port has a **mock** implementation with fake but realistic data. Later a real partner replaces the mock without touching the rest of the code.

**Worker.** A background job that runs on a schedule, with no user typing. Example: checking whether a ticket sale has opened.

---

## 3. The big picture

```
┌────────────────────────── BROWSER (React) ──────────────────────────┐
│  Chat window · voice button · cards (event, price, confirm, alert)  │
└───────────────┬───────────────────────────────▲─────────────────────┘
                │ user message (text/voice)     │ streamed reply + cards,
                ▼                               │ live notifications (SSE)
┌─────────────────────────── API (Express) ───────────────────────────┐
│ 1. GUARD LAYER (code)     input checks · advice/abuse filters       │
│ 2. CHAT AGENT (Gemini)    understands, picks tools, explains        │
│ 3. TOOLS                  thin wrappers, one per ability            │
│ 4. DOMAIN SERVICES        deterministic logic, NO AI:               │
│                           cost math · limits · eligibility ·        │
│                           proposal state machine · audit log        │
│ 5. WORKERS (scheduled)    sale-open watcher · price watcher ·       │
│                           alert engine · expiry cleanup             │
│ 6. PORTS → MOCKS          EventSource · FxRates · Payment partner   │
└───────────────────────────────┬─────────────────────────────────────┘
                                ▼
                    PostgreSQL (all state, incl. embeddings)
```

The key idea: **the AI is only layer 2.** Everything that must be correct (money, limits, rules) lives in layers 1, 4 and 5, which are ordinary code you can test.

---

## 4. Life of one message (A to Z)

Example: the user types *"3ndi bghit tickets dyal match dyal lmaghrib f Rabat, ma tfoutouch 300 dh l wahed, 3lemni waqt kaytefte7 lbi3"* (I want tickets for the Morocco match in Rabat, max 300 dh each, tell me when sales open).

1. **Browser sends it.** The chat hook posts the conversation to `POST /api/chat`.
2. **Guard layer (input).** The server checks the message is well-formed, not abusive, and applies rate limits.
3. **Context is assembled.** The server loads the user's profile (language, allowance information, saved alerts) and the conversation history from Postgres, and builds the **system prompt** (the permanent rulebook given to the AI, see section 7).
4. **The agent loop starts.** The message and the tool menu go to Gemini.
5. **Step 1, the model calls `search_events`** with `{ query: "Morocco", city: "Rabat" }`. Our server runs it against the event source and returns matching events.
6. **Step 2, the model calls `get_event`** for the best match to get prices, sale-opening date and the official seller.
7. **Step 3, the model calls `set_alert`** with `{ eventId, type: "sale_opens", maxPrice: 300 }`. This tool is low-risk, so it creates the alert directly and the UI shows the confirmation.
8. **The model writes its final reply** in Darija, summarising what it found. Because of streaming, the user sees text appear live, followed by an event card and an alert card.
9. **Guard layer (output).** Before the text is shown, a check blocks forbidden content (for example promising availability, or "you must buy now" pressure).
10. **Everything is saved:** messages, the alert, and an audit-log entry.
11. **Later, a worker fires.** The sale-opens watcher sees the sale is live, matches it to the alert, writes a notification and pushes it to the browser over SSE (a one-way live connection). The user sees a message in the chat with a **Buy** card.
12. **The user says "yes, buy 2".** The agent calls `check_eligibility`, `compute_total` and `draft_purchase`. This creates a **proposal**, shown as a confirm card with every cost line.
13. **The user taps Confirm.** The browser calls `POST /api/proposals/:id/confirm`. **This is not an AI call.** The server re-validates everything (limits, eligibility, price still valid), then hands the purchase to the payment port and records the result.

---

## 5. The pieces in detail

### 5.1 Frontend (`web/`)
- React + Vite + TypeScript + Tailwind.
- **`useChat`** (from the AI SDK) holds the conversation and receives the streamed reply, including tool calls and results.
- A **card registry** maps a tool name to a component. Adding a new ability = a new tool + a new card.
- **Voice (free):** the browser's built-in speech recognition (microphone to text) and speech synthesis (text to audio). Darija recognition will be imperfect, so the transcript is always shown and editable.
- A live connection (SSE) for notifications that arrive without the user typing.

### 5.2 API (`server/`)
Express + TypeScript. Main routes:
- `POST /api/chat`: runs the agent and streams the reply.
- `POST /api/proposals/:id/confirm` and `/dismiss`: the only way a proposal becomes real.
- `GET /api/events` (SSE): live notifications.
- `GET /api/health`: checks the API and database.

### 5.3 The agent
Built with the **Vercel AI SDK**, a free open-source TypeScript toolkit (it does not require Vercel hosting):
- `ai`: core functions to call the model, stream results, define tools and cap the number of loop steps.
- `@ai-sdk/google`: the Gemini provider. Switching to another model later is a one-line change.
- `@ai-sdk/react`: the `useChat` hook for the browser.

> The installed version is **v7**, newer than much online documentation. Read the installed package's docs before writing agent code, because function names (for example how the step limit is set) have changed between versions.

There is **one agent**, not several. With a handful of small tools, multiple cooperating agents would only add failure modes and use up the free rate limit.

### 5.4 Tools (the agent's abilities)

| Tool | What it does | Result shown as | Risk |
|---|---|---|---|
| `search_events` | Find events by text, city, date, category | Event cards | Read-only |
| `get_event` | Details: venue, date, price tiers, official seller, when sales open | Event detail card | Read-only |
| `check_eligibility` | Can *this* user buy *this* ticket? Checks country, seller rules, sanctions list, the user's allowance and card, name-on-ticket rules | Eligibility card (allowed / needs action / blocked, with reasons) | Read-only |
| `compute_total` | Face price + currency conversion (with its timestamp) + fees + any extras, line by line | Price breakdown card | Read-only |
| `set_alert` / `list_alerts` / `cancel_alert` | Notify when a sale opens or a price drops | Alert card | Low (can be cancelled) |
| `draft_purchase` | Creates a **proposal**; never buys | Confirm card | Needs human confirm |
| `track_purchase` | Status of past purchases | Status card | Read-only |
| `ask_docs` | Answers policy/how-to questions from our documents, with source | Answer + source | Read-only |

Every tool has a **Zod schema** (a typed definition of its inputs). If the model sends malformed arguments, validation rejects them before any logic runs.

### 5.5 Guard layer
Code that surrounds the model:
- **Input:** validation, rate limiting, size limits.
- **Output:** blocks pressure language, availability promises, and anything outside the allowed behaviour.
- **Tool-level:** `draft_purchase` refuses to run if required fields are missing, so the model must *ask the user* instead of inventing values.

### 5.6 Domain services (no AI)
Plain functions, fully testable:
- **Cost engine:** computes totals and shows every line.
- **Eligibility engine:** a rules table (country, category, seller policy, sanctions, allowance). Returns *allowed*, *needs action* or *blocked*, **with the reason**.
- **Limits:** per-purchase, per-day and per-month caps, lower for new accounts and raised after a trial period.
- **Proposal state machine:** `pending → confirmed | dismissed | expired`. A proposal expires, and a price change invalidates it.
- **Audit log:** an append-only record of who did what and when.

### 5.7 Workers (scheduled jobs)
Not AI agents. Scheduled code (for example `node-cron`):
- **Sale-open watcher:** checks event sources for status changes.
- **Price watcher:** detects price drops.
- **Alert engine:** matches changes to users' alerts and sends **one** notification per event, not one per update.
- **Expiry cleanup:** expires old proposals and alerts.
- **Event-ingestion pipeline:** the AI can help here (extracting dates and prices from an announcement into structured data), but the result stays **pending** until a teammate approves it, because a wrong date damages trust.

### 5.8 Ports and mocks (the outside world)

| Port | Prototype (mock) | Real world later |
|---|---|---|
| `EventSource` | Seeded events in Postgres | Official feeds from sellers (e.g. webook.com, Guichet.com, Tadakir.ma) via partnership |
| `FxRatePort` | Fixed or slowly changing demo rates, each with a timestamp | A licensed rates provider |
| `PaymentPort` | Fake payment that always succeeds or fails on demand | A licensed bank or payment institution |
| `NotificationPort` | In-app only | Push / SMS |

This is the honest core of the prototype: **everything behind a port is simulated, and we say so.** The real product needs real partners.

### 5.9 Database (PostgreSQL)
Everything lives in one Postgres database, so there is nothing else to run. Planned data (the schema will be rewritten from the stock version):
- `users`, `user_limits`
- `events`, `ticket_tiers`, `sellers`, `price_history`, `fx_rates`
- `alerts`, `notifications`
- `proposals`, `purchases`
- `documents`, `document_chunks` (with embeddings stored as number arrays; moving to the `pgvector` extension is a future upgrade)
- `conversations`, `messages`, `audit_log`

---

## 6. Rules the system enforces in code

1. **The AI never executes.** It only drafts proposals; confirmation is a separate, non-AI endpoint.
2. **Every cost is shown before confirming**, line by line, with the currency rate and when it was recorded.
3. **No pressure.** No "hurry!" language, no hidden fees, no hidden revenue.
4. **Official sellers only.** No resale marketplace and no automatic buying that violates a seller's terms. (CAN 2025 saw 118 arrests for ticket speculation, and sellers ban bots.)
5. **Limits and expiry** on everything automatic (alerts expire, proposals expire).
6. **"I don't know" is a valid answer** when the documents don't contain it.
7. **Eligibility is explained**, never silently refused: the user always sees *why* something is blocked.
8. **Minimal personal data.** Only what's needed, with recorded consent. During the hackathon, use **fake demo users only**, because the free Gemini tier may use inputs to improve Google's products.

---

## 7. The system prompt (the permanent rulebook)

The system prompt is text sent with every request. It defines the assistant's behaviour. For Sindibad it states, in order of importance:
- Who you are and what you can do (only tickets for now).
- Hard rules: never claim a purchase happened unless a tool confirms it; never invent prices, dates or availability; never hide a cost.
- Always reply in the user's language (Darija, French or Arabic), mirroring them.
- Use tools for facts; if no tool or document supports an answer, say "I don't know".
- Ask when information is missing instead of guessing.

Remember: the prompt is *guidance*. The guard layer and domain services are the *enforcement*.

---

## 8. Free stack and why

| Need | Choice | Cost |
|---|---|---|
| LLM | Gemini via Google AI Studio free tier | Free (rate-limited) |
| Agent framework | Vercel AI SDK | Free, open source |
| Backend | Express + TypeScript | Free |
| Database | PostgreSQL (local, managed with pgAdmin) | Free |
| ORM | Drizzle | Free |
| Frontend | React + Vite + Tailwind | Free |
| Voice | Browser Web Speech API | Free |
| Scheduling | `node-cron` | Free |

Free-tier practicalities: rate limits are tight, so keep to about one model call per turn where possible, rehearse the demo once, and record a backup video.

---

## 9. Planned folder layout

```
sindibad/
├─ web/                    React app
│  └─ src/ chat/ cards/ voice/
└─ server/
   └─ src/
      ├─ server.ts         Express entry
      ├─ env.ts            validated environment
      ├─ db/               schema + client
      ├─ agent/            system prompt, tool registry, guards
      ├─ tools/            one file per tool
      ├─ services/         cost, eligibility, limits, proposals, audit
      ├─ workers/          watchers, alert engine, cleanup
      ├─ ports/            interfaces
      └─ adapters/         mock implementations
```

---

## 10. Prototype vs reality, and honest limits

- **Simulated in the prototype:** event data, currency rates, payments. No seller, bank or payment partner has agreed to anything.
- **Needs a licensed partner in reality:** paying a foreign seller in foreign currency on someone's behalf is a regulated foreign-exchange activity in Morocco. Without a partner, the safe version is *"we find and prepare; you pay the official seller with your own card"*.
- **Verify before claiming on stage:** the user's foreign-currency card allowance rules (Office des Changes), which sellers accept Moroccan cards, and the legal status of the app (lawyer).
- **Language:** Darija quality on the free model must be tested early.
- **Wording on stage:** say "designed" and "prototype", not "ready".

---

## 11. Going multi-agent

Section 5.3 chose **one agent** on purpose. This section explains when and how to split it into a team of agents, so you can answer "is it multi-agent?" honestly and know the upgrade path.

### 11.1 What "multi-agent" means
Instead of one LLM with every tool, you have **several LLM roles**, each with its own instructions, its own small set of tools and sometimes its own model. They pass work to each other through **typed messages**. Think of a travel agency: a receptionist talks to the customer and hands jobs to a researcher, an accountant and a compliance officer.

### 11.2 When it helps, and when it doesn't

| It helps when... | Why |
|---|---|
| One agent has too many tools (roughly 15+) | The model picks the wrong tool or mixes instructions |
| Jobs need very different instructions | A strict reviewer and a friendly guide shouldn't share one prompt |
| Work can run in parallel | Comparing five sellers at once instead of one by one |
| You want a **veto** | A separate reviewer can block a bad answer before the user sees it |
| Tasks are long (trip planning) | Each specialist keeps a short, focused context |

| It hurts when... | Why |
|---|---|
| The free tier is rate-limited (ours is) | Every agent is an extra model call. A turn can go from ~3 calls to ~10 |
| You need a reliable live demo | More moving parts means more ways to fail on stage |
| Mistakes compound | A wrong handoff early poisons every later step |
| Debugging | You must trace which agent said what |

**Rule of thumb:** split only when a measured problem appears (wrong tools, rule violations, slowness), not because it sounds impressive.

### 11.3 The common patterns

1. **Router (triage).** A small first agent reads the message and hands it to the right specialist. Simple and cheap.
2. **Orchestrator with specialists as tools.** One main agent stays in charge. It calls a specialist the same way it calls a normal tool, and gets back a short result. This is the easiest pattern to add to our design.
3. **Pipeline.** A fixed chain, for example Planner, then Researcher, then Verifier, then Writer. Predictable, and technically a *workflow* rather than free-roaming agents.
4. **Parallel fan-out.** Several agents work at once (one per seller) and an aggregator merges the results.
5. **Guardian (critic).** A separate agent or check reviews every outgoing message and proposal and can veto it. Highest value for a payments product.

### 11.4 A proposed Sindibad team

```
                         ┌──────────────────────────┐
   user (text/voice) ──▶ │  CONCIERGE (orchestrator)│ ── talks to the user, owns language,
                         └───────────┬──────────────┘    decides which specialist to call
          ┌───────────┬──────────────┼───────────────┬───────────────┐
          ▼           ▼              ▼               ▼               ▼
   ┌───────────┐ ┌───────────┐ ┌────────────┐ ┌───────────┐ ┌──────────────┐
   │ DISCOVERY │ │ CROSS-    │ │   ALERTS   │ │ PURCHASE  │ │  KNOWLEDGE   │
   │ find +    │ │ BORDER    │ │ parse "tell│ │ drafts    │ │ (RAG) policy │
   │ compare   │ │ eligibility│ │ me when…"  │ │ proposals │ │ & how-to Q&A │
   │ events    │ │ + cost    │ │ → alerts   │ │ only      │ │              │
   └───────────┘ └───────────┘ └────────────┘ └───────────┘ └──────────────┘
          └───────────┴──────────────┬───────────────┴───────────────┘
                                     ▼
                         ┌──────────────────────────┐
                         │ GUARDIAN (reviewer/veto) │ ── checks every reply and proposal
                         └───────────┬──────────────┘    against the rules in section 6
                                     ▼
                                  the user
```

| Agent | Owns these tools | Notes |
|---|---|---|
| **Concierge** | none directly; calls specialists | Only agent that talks to the user. Keeps tone and language. |
| **Discovery** | `search_events`, `get_event` | Can fan out across sellers in parallel. |
| **Cross-border** | `check_eligibility`, `compute_total` | The decisions stay in deterministic services; the agent only explains them. |
| **Alerts** | `set_alert`, `list_alerts`, `cancel_alert` | Turns free text ("when sales open, under 300") into a structured alert. |
| **Purchase** | `draft_purchase`, `track_purchase` | The only agent near money, and it can only *draft*. |
| **Knowledge** | `ask_docs` | Answers only from documents, with sources. |
| **Guardian** | read-only access to the draft reply and tool results | Mostly code checks, plus a small LLM check. Can block or rewrite. |

Background (non-chat) agents also fit later: an **ingestion agent** that extracts event details from seller announcements into `pending` rows for human approval, and a **scam-check agent** for pasted listings.

### 11.5 Rules that do not change
- **Agents never execute.** Purchases still happen only at the confirm endpoint, which is not an AI call.
- **Least privilege.** Each agent receives only its own tools. The Discovery agent cannot draft purchases, even if told to.
- **Typed handoffs.** Agents exchange Zod-validated objects (`{ eventId, maxPrice }`), not loose paragraphs, so a specialist's output can't smuggle in instructions.
- **State lives in Postgres, not in prompts.** Specialists read and write shared tables, so nothing is lost between agents.
- **Audit everything.** Each action records which agent did it.

### 11.6 How to build it with the AI SDK (the easy pattern)
Wrap a specialist as a tool the Concierge can call. This is a sketch of the idea; check the installed v7 API for exact names.

```ts
const discovery = tool({
  description: 'Find and compare events. Use for anything about what exists, dates or prices.',
  inputSchema: z.object({ request: z.string() }),
  execute: async ({ request }) => {
    const out = await generateText({
      model,                              // can be a cheaper/faster model
      system: DISCOVERY_PROMPT,           // its own focused instructions
      prompt: request,
      tools: { search_events, get_event }, // only its own tools
      // plus a step limit, as in the main agent
    });
    // IMPORTANT: pass the structured results up, not just the text,
    // otherwise the UI cannot render the event cards.
    return { summary: out.text, cards: collectCards(out) };
  },
});

// The Concierge simply lists the specialists as its tools:
// tools: { discovery, crossBorder, alerts, purchase, knowledge }
```

The Guardian is a function that runs on the finished reply and on every proposal before they reach the browser. Start with plain code rules; add a small LLM check only for what code cannot judge.

### 11.7 Staying inside the free tier
- Make the **router rule-based first** (keywords and intent patterns), and call an LLM only when unsure.
- Use the **cheapest, fastest model** for specialists, and keep the strongest for the Concierge.
- **Cache** repeated lookups (event details, eligibility rules).
- Keep the **Guardian mostly code**.
- Show a **trace panel** in the demo ("Concierge → Discovery → Cross-border → Guardian") so the jury sees the team at work. It also makes debugging easier.

### 11.8 Recommended path
1. **Now (hackathon):** one agent plus the code guard layer. Most reliable for a live demo.
2. **Next:** add the **Guardian**. It is the cheapest upgrade and the most valuable for a payments app.
3. **When tools exceed ~12:** split out **Discovery** as a specialist-tool.
4. **Later:** add the router and the remaining specialists, and parallel fan-out across sellers.
5. **Before each split:** measure with the evaluation suite (section 12) so the change is justified by numbers.

For the pitch, be accurate: present multi-agent as a **designed roadmap** unless it is actually running.

---

## 12. Future work (ideas worth adding later)

**Product**
- **Real seller integrations.** Official partnerships and feeds with ticket sellers, replacing the mock event source.
- **Real payment partner.** A bank or payment institution for in-app MAD payment and compliant foreign-currency conversion.
- **Allowance tracker.** Shows how much of a user's yearly foreign-currency allowance is left and warns before a purchase would exceed it.
- **Group buying.** Friends pool a purchase; one person's confirmation isn't enough, everyone approves their share.
- **Total trip cost.** For events abroad: ticket + flights + visa + lodging estimate, so users see the real cost of "a K-pop concert in Seoul".
- **Price-drop and sale-opening intelligence.** Predict when a sale is likely to open from past patterns (informational only, never pushed as pressure).
- **Waitlist and queue help.** Notify in advance for high-demand sales and explain the seller's queue rules.
- **Fan-club / verified-fan pre-sale guidance.** Help users register for official pre-sales that require it.
- **More asset types.** Albums and merchandise (shipping and customs estimates), sports passes, museum and experience tickets. Exclude risky categories such as cultural artifacts.

**Agent and AI**
- **Voice-first Darija.** A better speech model than the browser's built-in one, with a Darija-tuned vocabulary.
- **Memory.** Remember preferences (favourite teams, artists, budget) and use them for alerts, never to push purchases.
- **Scam and fake-ticket checker.** Paste a link or listing, the agent explains whether the seller is official and flags red flags.
- **Document understanding.** Read a screenshot of a ticket or a seller's terms and explain refund and transfer rules in plain Darija.
- **Evaluation suite.** A fixed list of test conversations run automatically to measure correctness, language quality and rule compliance on every change.
- **Better retrieval.** Move embeddings to `pgvector` with an index once the document set grows.
- **Model fallback chain.** Automatically fall back across several free or local models (for example a local Ollama model) when one is rate-limited.

**Trust, safety and compliance**
- **Strong sign-in and fraud checks.** Second-factor login, device checks, unusual-purchase detection.
- **Refund and dispute assistant.** Guides the user through the seller's refund process and keeps evidence.
- **Privacy tooling.** Consent records, data export and deletion, and the regulator filings Moroccan data-protection law requires (to be confirmed with a lawyer).
- **Sanctions and AML screening** as a maintained, auditable rule set.

**Business and scale**
- **Revenue.** Transparent service fee only where legally clear, partner referral fees, and an optional premium tier (earlier alerts, trip planning). No hidden revenue.
- **Observability.** Logs, traces and cost tracking for each model call.
- **Scale-out.** Managed Postgres with `pgvector`, a job queue for workers, caching, and moving from free-tier Gemini to production-grade models, which is a one-line change thanks to the AI SDK.
- **Mobile app.** A React Native or installable web app (PWA) with push notifications.
- **Expansion.** Other countries' travellers and other African markets, entering each only when a licensed partner is ready, local rules allow it, and safety metrics at home are met.
- **Merchant side.** A dashboard for sellers: identified buyers, per-person limits and anti-scalping tools, which gives sellers a reason to partner with us.

---

## 13. Mini glossary

| Term | Meaning |
|---|---|
| Multi-agent | Several LLM roles with separate instructions and tools, cooperating through typed handoffs |
| Orchestrator | The main agent that delegates work to specialists |
| Guardian | A reviewer that can veto a reply or proposal before the user sees it |
| Agent | An LLM that loops: think, use a tool, read result, think again |
| Tool | A function the model can ask us to run |
| Proposal | A drafted action waiting for user confirmation |
| Guardrail | A rule enforced in code, not just in the prompt |
| RAG | Search our documents first, then answer only from them |
| Embedding | Numbers that capture the meaning of text |
| Port / mock | An interface to the outside world / its fake version |
| Worker | A scheduled background job |
| SSE | A one-way live connection from server to browser |
| System prompt | The permanent instructions sent with every model request |

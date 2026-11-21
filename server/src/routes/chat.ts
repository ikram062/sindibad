import { google } from '@ai-sdk/google';
import { convertToModelMessages, isStepCount, pipeUIMessageStreamToResponse, streamText, toUIMessageStream, type UIMessage, validateUIMessages } from 'ai';
import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { buildInstructions } from '../agent/prompt';
import { buildTools } from '../agent/tools';
import { fail, parseBody } from '../auth/http';
import { requireAuth } from '../auth/middleware';
import { rateLimiter } from '../auth/rateLimit';
import { db, schema } from '../db/client';
import { env } from '../env';
import { getCard, getSettings } from '../services/settings';

const { conversations } = schema;

export const chatRouter = Router();
chatRouter.use(requireAuth);

const chatLimit = rateLimiter(20, 60 * 1000);

// The browser sends ONLY the new user message. History is loaded from the database, so a client can never
// forge earlier assistant messages or tool results.
const bodySchema = z.object({
  message: z.object({
    id: z.string().max(100),
    role: z.literal('user'),
    parts: z.array(z.object({ type: z.literal('text'), text: z.string().trim().min(1).max(2000) })).length(1),
  }),
});

async function loadMessages(userId: string): Promise<UIMessage[]> {
  const [row] = await db.select().from(conversations).where(eq(conversations.userId, userId));
  return (row?.messages ?? []) as UIMessage[];
}

const saveMessages = (userId: string, messages: UIMessage[]) =>
  db
    .insert(conversations)
    .values({ userId, messages })
    .onConflictDoUpdate({ target: conversations.userId, set: { messages, updatedAt: new Date() } });

chatRouter.get('/', async (req, res) => res.json({ messages: await loadMessages(req.user!.id) }));

chatRouter.delete('/', async (req, res) => {
  await saveMessages(req.user!.id, []);
  res.status(204).end();
});

const friendlyError = (e: unknown) => {
  console.error('agent error:', (e as Error)?.message ?? e);
  const text = String((e as Error)?.message ?? e);
  return /429|quota|rate|exhausted/i.test(text)
    ? 'The assistant is busy right now (free-tier limit). Wait a minute and try again.'
    : 'The assistant hit a problem. Please try again.';
};

chatRouter.post('/', async (req, res) => {
  if (!env.GOOGLE_GENERATIVE_AI_API_KEY) return fail(res, 503, 'NO_AI_KEY', 'The assistant is not configured (missing GOOGLE_GENERATIVE_AI_API_KEY).');
  const body = parseBody(bodySchema, req, res);
  if (!body) return;
  const user = req.user!;
  if (!chatLimit(user.id)) return fail(res, 429, 'RATE_LIMITED', 'Slow down a little, then try again.');

  const message = body.message as UIMessage;
  const tools = buildTools(user, body.message.parts[0]!.text);

  let history = [...(await loadMessages(user.id)), message];
  try {
    history = await validateUIMessages({ messages: history, tools });
  } catch {
    history = [message]; // stored history no longer matches the tools: start fresh rather than fail
  }

  // Small models drift toward the language of earlier turns, so the model (not the stored history) is reminded
  // right next to the user's latest words.
  const modelMessages = await convertToModelMessages(history, { tools });
  const latest = modelMessages.at(-1);
  if (latest?.role === 'user') {
    const reminder = { type: 'text' as const, text: '\n\n[Reply in the language and script of the message above, not of earlier messages.]' };
    latest.content = typeof latest.content === 'string' ? [{ type: 'text', text: latest.content }, reminder] : [...latest.content, reminder];
  }

  const settings = await getSettings(user.id);
  const result = streamText({
    model: google(env.GEMINI_MODEL),
    instructions: buildInstructions({ user, autonomy: settings.autonomy, hasCard: Boolean(await getCard(user.id)), now: new Date() }),
    messages: modelMessages,
    tools,
    stopWhen: isStepCount(6),
    temperature: 0.3,
  });

  await pipeUIMessageStreamToResponse({
    response: res,
    stream: toUIMessageStream({
      stream: result.stream,
      originalMessages: history,
      onError: friendlyError,
      onEnd: ({ messages }) => {
        saveMessages(user.id, messages).catch((e) => console.error('could not save conversation', e));
      },
    }),
  });
});

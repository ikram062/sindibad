import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required (see server/.env.example)'),
  PORT: z.coerce.number().default(4001),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  // Key for the CIN fingerprint. Changing it later makes existing fingerprints unmatchable.
  CIN_HASH_SECRET: z.string().min(32, 'CIN_HASH_SECRET must be at least 32 characters (see server/.env.example)'),
  // Needed from the agent step onwards (free key from https://aistudio.google.com/apikey)
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment:\n', z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;

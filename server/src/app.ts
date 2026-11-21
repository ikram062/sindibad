import cors from 'cors';
import express from 'express';
import { pool } from './db/client';
import { env } from './env';
import { authRouter } from './routes/auth';
import { kycRouter } from './routes/kyc';
import { purchasesRouter } from './routes/purchases';

export const app = express();
app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', async (_req, res) => {
  try {
    const { rows } = await pool.query<{ now: Date }>('select now()');
    res.json({
      ok: true,
      db: true,
      time: rows[0]?.now,
      agentKeyConfigured: Boolean(env.GOOGLE_GENERATIVE_AI_API_KEY),
    });
  } catch (err) {
    res.status(503).json({ ok: false, db: false, error: (err as Error).message });
  }
});

app.use('/api/auth', authRouter);
app.use('/api/kyc', kycRouter);
app.use('/api/purchases', purchasesRouter);

// Next steps: /api/chat (agent), /api/proposals/:id/confirm (mount under purchases), /api/events (SSE)

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'INTERNAL', message: 'Something went wrong.' });
});

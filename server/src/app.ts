import cors from 'cors';
import express from 'express';
import { pool } from './db/client';
import { env } from './env';
import { authRouter } from './routes/auth';
import { chatRouter } from './routes/chat';
import { kycRouter } from './routes/kyc';
import { eventsRouter } from './routes/events';
import { notificationsRouter, proposalsRouter } from './routes/misc';
import { purchasesRouter } from './routes/purchases';
import { rulesRouter } from './routes/rules';
import { settingsRouter } from './routes/settings';

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
app.use('/api/chat', chatRouter);
app.use('/api/events', eventsRouter);
app.use('/api/rules', rulesRouter);
app.use('/api/proposals', proposalsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/purchases', purchasesRouter);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'INTERNAL', message: 'Something went wrong.' });
});

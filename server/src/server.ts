import { app } from './app';
import { pool } from './db/client';
import { env } from './env';
import { runRules } from './services/rules';

const server = app.listen(env.PORT, () => {
  console.log(`Sindibad API listening on http://localhost:${env.PORT}`);
});

// The rule engine: plain code, no AI. Checks every active rule against the catalogue.
// shortcut: a timer inside the API process, move to a separate worker / job queue before running several instances
const ruleTimer = setInterval(() => runRules().catch((e) => console.error('rule engine failed', e)), 30_000);

const shutdown = () => {
  clearInterval(ruleTimer);
  server.close(() => pool.end().finally(() => process.exit(0)));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

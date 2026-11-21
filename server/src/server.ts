import { app } from './app';
import { pool } from './db/client';
import { env } from './env';

const server = app.listen(env.PORT, () => {
  console.log(`Sindibad API listening on http://localhost:${env.PORT}`);
});

const shutdown = () => {
  server.close(() => pool.end().finally(() => process.exit(0)));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

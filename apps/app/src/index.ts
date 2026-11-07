import { serve } from '@hono/node-server';
import { createApp, prepareDatabase, shutdown } from './app';
import { openDatabase } from './db/client';
import { runMigrations } from './db/migrate';
import { parseEnv } from './env';

const env = parseEnv(process.env);

const database = await openDatabase(env.DATABASE_URL);
await runMigrations(database.client, env.MIGRATIONS_DIR);
const app = createApp({ env, db: database.db });
await prepareDatabase(database.db);
let closing = false;

async function stop(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  console.log(`app stopping on ${signal}`);
  await shutdown(database.db);
  database.close();
  process.exit(0);
}

process.on('SIGTERM', () => {
  void stop('SIGTERM');
});
process.on('SIGINT', () => {
  void stop('SIGINT');
});

serve({ fetch: app.fetch, hostname: env.HOST, port: env.PORT }, (info) => {
  console.log(`app listening on ${info.address}:${info.port}`);
});

import { serve } from '@hono/node-server';
import { parseEnv } from './env';
import { createApp } from './server';

const env = parseEnv(process.env);
const app = createApp(env);

serve({ fetch: app.fetch, hostname: env.HOST, port: env.PORT }, (info) => {
  console.log(`runner listening on ${info.address}:${info.port}`);
});

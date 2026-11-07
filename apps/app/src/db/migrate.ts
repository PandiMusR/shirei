import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Client } from '@libsql/client';

export async function runMigrations(client: Client, migrationsDir: string): Promise<void> {
  await client.execute('CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY NOT NULL)');
  const existing = await client.execute("SELECT id FROM schema_migrations WHERE id = '0000_init'");
  if (existing.rows.length > 0) return;
  const sql = readFileSync(path.resolve(migrationsDir, '0000_init.sql'), 'utf8');
  await client.executeMultiple(sql);
  await client.execute("INSERT INTO schema_migrations (id) VALUES ('0000_init')");
}

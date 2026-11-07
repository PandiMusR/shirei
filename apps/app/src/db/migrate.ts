import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Client } from '@libsql/client';

export async function runMigrations(client: Client, migrationsDir: string): Promise<void> {
  await client.execute('CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY NOT NULL)');
  const dir = path.resolve(migrationsDir);
  const files = readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const id = file.slice(0, -'.sql'.length);
    const existing = await client.execute({ sql: 'SELECT id FROM schema_migrations WHERE id = ?', args: [id] });
    if (existing.rows.length > 0) continue;
    const sql = readFileSync(path.join(dir, file), 'utf8');
    await client.executeMultiple(sql);
    await client.execute({ sql: 'INSERT INTO schema_migrations (id) VALUES (?)', args: [id] });
  }
}

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from './schema';

export type Database = LibSQLDatabase<typeof schema>;

export type DbHandle = { client: Client; db: Database; close: () => void };

function localFilePath(url: string): string | null {
  if (!url.startsWith('file:')) return null;
  let rest = url.slice('file:'.length);
  const query = rest.indexOf('?');
  if (query !== -1) rest = rest.slice(0, query);
  if (rest.startsWith('//')) rest = rest.slice(2);
  if (rest === '' || rest.startsWith(':memory:')) return null;
  return rest;
}

export async function openDatabase(url: string): Promise<DbHandle> {
  const file = localFilePath(url);
  if (file !== null) mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const client = createClient({ url });
  if (file !== null) await client.execute('PRAGMA journal_mode = WAL');
  await client.execute('PRAGMA foreign_keys = ON');
  const db = drizzle(client, { schema });
  return { client, db, close: () => client.close() };
}

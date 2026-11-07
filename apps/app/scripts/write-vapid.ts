import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { mergeVapidEnv, vapidStatusLine } from '../src/vapidEnv';

const require = createRequire(import.meta.url);
const webpush = require('web-push') as { generateVAPIDKeys(): { publicKey: string; privateKey: string } };

const file = process.argv[2];
const subject = process.argv[3] ?? 'mailto:shirei@hakanam.my.id';
if (!file) {
  process.stderr.write('usage: write-vapid <env-file> [mailto:...]\n');
  process.exit(1);
}
if (!subject.startsWith('mailto:')) {
  process.stderr.write('subject must start with mailto:\n');
  process.exit(1);
}

const current = readFileSync(file, 'utf8');
const keys = /^VAPID_PUBLIC_KEY=\S/m.test(current) ? { publicKey: '', privateKey: '' } : webpush.generateVAPIDKeys();
const result = mergeVapidEnv(current, keys, subject);
if (result.wrote) writeFileSync(file, result.text, { mode: 0o600 });
process.stdout.write(`${vapidStatusLine(result.publicLength)}\n`);

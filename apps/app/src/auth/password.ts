import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

export type ScryptParams = { N: number; r: number; p: number };

export const SCRYPT_PARAMS: ScryptParams = { N: 2 ** 15, r: 8, p: 1 };
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 256;

const SALT_BYTES = 16;
const KEY_BYTES = 32;
const MAX_N = 2 ** 20;
const MAX_R = 16;
const MAX_P = 4;

function deriveKey(password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  const options: ScryptOptions = { ...params, maxmem: 256 * params.N * params.r };
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, options, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string, params: ScryptParams = SCRYPT_PARAMS): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await deriveKey(password, salt, params);
  return ['scrypt', String(params.N), String(params.r), String(params.p), salt.toString('base64'), key.toString('base64')].join('$');
}

function parseStored(stored: string): { params: ScryptParams; salt: Buffer; key: Buffer } | null {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const nRaw = parts[1];
  const rRaw = parts[2];
  const pRaw = parts[3];
  const saltRaw = parts[4];
  const keyRaw = parts[5];
  if (nRaw === undefined || rRaw === undefined || pRaw === undefined || saltRaw === undefined || keyRaw === undefined) {
    return null;
  }
  if (!/^\d+$/.test(nRaw) || !/^\d+$/.test(rRaw) || !/^\d+$/.test(pRaw)) return null;
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isSafeInteger(N) || !Number.isSafeInteger(r) || !Number.isSafeInteger(p)) return null;
  if (N < 2 || N > MAX_N || (N & (N - 1)) !== 0) return null;
  if (r < 1 || r > MAX_R || p < 1 || p > MAX_P) return null;
  const salt = Buffer.from(saltRaw, 'base64');
  const key = Buffer.from(keyRaw, 'base64');
  if (salt.length !== SALT_BYTES || key.length !== KEY_BYTES) return null;
  return { params: { N, r, p }, salt, key };
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseStored(stored);
  if (parsed === null) return false;
  const derived = await deriveKey(password, parsed.salt, parsed.params);
  if (derived.length !== parsed.key.length) return false;
  return timingSafeEqual(derived, parsed.key);
}

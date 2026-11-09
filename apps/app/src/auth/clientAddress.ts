/** Nginx overwrites X-Real-IP with the client address. A missing header falls back to the socket. */
export function loginAddress(peer: string | null | undefined, realIp: string | undefined): string {
  const real = realIp?.split(',')[0]?.trim();
  if (real) return real;
  const socket = peer?.trim();
  return socket || 'unknown';
}

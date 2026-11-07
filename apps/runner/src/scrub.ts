/** Strip credential-shaped fragments before a string is logged or returned. */
export function scrubSecrets(text: string): string {
  return text
    .replace(/ghp_[A-Za-z0-9]{20,}/g, '[REDACTED]')
    .replace(/github_pat_[A-Za-z0-9_]{20,}/g, '[REDACTED]')
    .replace(/x-access-token:[^@\s]+/gi, 'x-access-token:[REDACTED]')
    .replace(/CURSOR_API_KEY=\S+/g, 'CURSOR_API_KEY=[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._-]{8,}/g, 'Bearer [REDACTED]');
}

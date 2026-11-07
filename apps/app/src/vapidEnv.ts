/** Compose treats `$` in an env file as interpolation. `$$` is one literal dollar. */
export function composeEnvValue(value: string): string {
  return value.replaceAll('$', () => '$$');
}

export function vapidStatusLine(publicLength: number): string {
  return `vapid public key length ${publicLength}`;
}

export function mergeVapidEnv(
  source: string,
  keys: { publicKey: string; privateKey: string },
  subject: string,
): { text: string; wrote: boolean; publicLength: number } {
  const existing = source.match(/^VAPID_PUBLIC_KEY=(\S*)/m);
  if (existing && existing[1]) {
    return { text: source, wrote: false, publicLength: existing[1].replaceAll('$$', () => '$').length };
  }
  const lines = [
    `VAPID_PUBLIC_KEY=${composeEnvValue(keys.publicKey)}`,
    `VAPID_PRIVATE_KEY=${composeEnvValue(keys.privateKey)}`,
    `VAPID_SUBJECT=${composeEnvValue(subject)}`,
  ];
  const suffix = `${lines.join('\n')}\n`;
  const text = source.length === 0 || source.endsWith('\n') ? source + suffix : `${source}\n${suffix}`;
  return { text, wrote: true, publicLength: keys.publicKey.length };
}

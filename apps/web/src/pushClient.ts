export const NOTIFY_INSTALL_HELP =
  'Install Shirei from Chrome, then open it from the home-screen icon. A browser tab stops receiving notifications after it closes.';

export const NOTIFY_DENIED_HELP =
  'Notifications are blocked. Install Shirei from Chrome, then open Settings → Apps → Shirei → Notifications → Allow. Set Battery to Unrestricted, and remove Shirei from Sleeping apps and Deep sleeping apps.';

export const NOTIFY_DENIED_HELP_DESKTOP =
  'Notifications are blocked. Click the lock icon in the address bar → Notifications → Allow.';

export function notifyDeniedHelp(platform: 'android' | 'desktop'): string {
  return platform === 'android' ? NOTIFY_DENIED_HELP : NOTIFY_DENIED_HELP_DESKTOP;
}

export const NOTIFY_ON_HELP = 'This phone is notified when a task finishes.';

export function samePath(clientUrl: string, url: string): boolean {
  try {
    const left = new URL(clientUrl, 'https://shirei.local').pathname;
    const right = new URL(url, 'https://shirei.local').pathname;
    return left === right;
  } catch {
    return false;
  }
}

export function shouldNotify(
  clients: { visibilityState: string; url: string }[],
  url: string,
  test: boolean,
): boolean {
  if (test) return true;
  return !clients.some((client) => client.visibilityState === 'visible' && samePath(client.url, url));
}

export function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function readyWithin<T>(ready: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    ready.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

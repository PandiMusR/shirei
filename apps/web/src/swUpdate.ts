export const UPDATE_LABEL = 'Update available · Reload';

export const pwaRegisterType = 'prompt' as const;

/**
 * Self-contained so Workbox can paste this function into the service worker.
 * Navigations, the shell, and API calls stay on the network.
 */
export function networkOnlyPattern({ url, request }: { url: URL; request: { mode: string } }): boolean {
  const pathname = url.pathname;
  const mode = request.mode;
  if (mode === 'navigate') return true;
  if (pathname === '/healthz' || pathname === '/api' || pathname.startsWith('/api/')) return true;
  if (pathname === '/index.html' || pathname.endsWith('/index.html')) return true;
  return false;
}

export const pwaWorkbox = {
  globPatterns: ['**/*.{js,css,svg,png,ico,webmanifest}'],
  globIgnores: ['**/index.html'],
  navigateFallback: null as null,
  navigateFallbackDenylist: [/^\/api/, /^\/healthz/],
  clientsClaim: true,
  runtimeCaching: [
    {
      urlPattern: networkOnlyPattern,
      handler: 'NetworkOnly' as const,
    },
  ],
};

export function reloadApp(updateSW: (reloadPage?: boolean) => Promise<void>): Promise<void> {
  return updateSW(true);
}

export function bindUpdateChecks(input: {
  update: () => void;
  visible: () => boolean;
  listen: (target: 'window' | 'document', type: 'focus' | 'visibilitychange', handler: () => void) => () => void;
}): () => void {
  const check = () => {
    if (input.visible()) input.update();
  };
  const stopFocus = input.listen('window', 'focus', check);
  const stopVisibility = input.listen('document', 'visibilitychange', check);
  return () => {
    stopFocus();
    stopVisibility();
  };
}

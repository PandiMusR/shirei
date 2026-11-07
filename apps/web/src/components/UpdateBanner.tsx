import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { bindUpdateChecks, reloadApp, UPDATE_LABEL } from '../swUpdate';

export function UpdateBanner() {
  const [updateSW, setUpdateSW] = useState<((reloadPage?: boolean) => Promise<void>) | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!import.meta.env.PROD) return;
    let stop = () => {};
    const update = registerSW({
      onNeedRefresh() {
        setOpen(true);
      },
      onRegisteredSW(_swUrl, registration) {
        if (!registration) return;
        stop = bindUpdateChecks({
          update: () => {
            void registration.update();
          },
          visible: () => document.visibilityState === 'visible',
          listen(target, type, handler) {
            const node = target === 'window' ? window : document;
            node.addEventListener(type, handler);
            return () => node.removeEventListener(type, handler);
          },
        });
      },
    });
    setUpdateSW(() => update);
    return () => stop();
  }, []);

  if (!open || !updateSW) return null;
  return (
    <button type="button" className="update-banner" onClick={() => void reloadApp(updateSW)}>
      {UPDATE_LABEL}
    </button>
  );
}

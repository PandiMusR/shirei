import { useEffect, useState } from 'react';
import { api, explain } from '../api';
import { NOTIFY_INSTALL_HELP, NOTIFY_ON_HELP, notifyDeniedHelp, readyWithin, urlBase64ToUint8Array } from '../pushClient';

const READY_MS = 2000;

function supportedHere(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
}

export function NotifyToggle() {
  const supported = supportedHere();
  const [permission, setPermission] = useState<NotificationPermission>(supported ? Notification.permission : 'default');
  const [subscribed, setSubscribed] = useState(false);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!supported) return;
    let cancel = false;
    void readyWithin(navigator.serviceWorker.ready, READY_MS).then(async (registration) => {
      if (cancel) return;
      setReady(Boolean(registration));
      if (!registration || Notification.permission !== 'granted') return;
      const current = await registration.pushManager.getSubscription();
      if (!cancel) setSubscribed(Boolean(current));
    });
    const onFocus = () => setPermission(Notification.permission);
    window.addEventListener('focus', onFocus);
    return () => {
      cancel = true;
      window.removeEventListener('focus', onFocus);
    };
  }, [supported]);

  async function registration(): Promise<ServiceWorkerRegistration | null> {
    return readyWithin(navigator.serviceWorker.ready, READY_MS);
  }

  async function enable(): Promise<void> {
    setError('');
    setPending(true);
    try {
      const worker = await registration();
      if (!worker) {
        setReady(false);
        return;
      }
      const next = await Notification.requestPermission();
      setPermission(next);
      if (next !== 'granted') return;
      const key = await api.pushKey();
      const subscription = await worker.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key.publicKey),
      });
      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error('incomplete');
      await api.subscribePush({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } });
      setSubscribed(true);
    } catch (err) {
      setError(explain(err));
    } finally {
      setPending(false);
    }
  }

  async function disable(): Promise<void> {
    setError('');
    setPending(true);
    try {
      const worker = await registration();
      const current = worker ? await worker.pushManager.getSubscription() : null;
      if (current) {
        const endpoint = current.endpoint;
        await current.unsubscribe();
        await api.unsubscribePush(endpoint);
      }
      setSubscribed(false);
    } catch (err) {
      setError(explain(err));
    } finally {
      setPending(false);
    }
  }

  async function sendTest(): Promise<void> {
    setError('');
    setPending(true);
    try {
      await api.pushTest();
    } catch (err) {
      setError(explain(err));
    } finally {
      setPending(false);
    }
  }

  const platform = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent) ? 'android' : 'desktop';
  const help = permission === 'denied' ? notifyDeniedHelp(platform) : subscribed && ready ? NOTIFY_ON_HELP : NOTIFY_INSTALL_HELP;

  return (
    <section className="notify">
      <label className="check">
        <input
          type="checkbox"
          role="switch"
          checked={subscribed}
          disabled={!supported || permission === 'denied' || pending || !ready}
          onChange={(event) => void (event.target.checked ? enable() : disable())}
        />
        <span>
          Notify me when tasks finish
          <small>{help}</small>
        </span>
      </label>
      {subscribed ? (
        <button type="button" className="text-btn" disabled={pending} onClick={() => void sendTest()}>
          Send test
        </button>
      ) : null}
      {error ? <p className="form-error">{error}</p> : null}
    </section>
  );
}

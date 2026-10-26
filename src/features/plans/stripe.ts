/**
 * Loads Stripe.js (https://js.stripe.com/v3/) once, on demand, and caches one Stripe instance per
 * publishable key. Card details are entered in Stripe's own iframe (Payment Element) and never touch
 * this app's code, logs or storage.
 */
const SRC = 'https://js.stripe.com/v3/';
let loading: Promise<any> | null = null;
const instances = new Map<string, any>();

function loadScript(): Promise<any> {
  const w = window as any;
  if (w.Stripe) return Promise.resolve(w.Stripe);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    let s = document.querySelector(`script[src="${SRC}"]`) as HTMLScriptElement | null;
    if (!s) {
      s = document.createElement('script');
      s.src = SRC;
      s.async = true;
      document.head.appendChild(s);
    }
    s.addEventListener('load', () => (w.Stripe ? resolve(w.Stripe) : reject(new Error('Stripe failed to load.'))));
    s.addEventListener('error', () => {
      s?.remove();
      reject(new Error('Could not load the secure payment form. Check your connection (or ad blocker) and try again.'));
    });
  });
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

export async function getStripe(publishableKey: string): Promise<any> {
  if (!publishableKey) throw new Error('Payments are temporarily unavailable. Please try again later.');
  const cached = instances.get(publishableKey);
  if (cached) return cached;
  const StripeCtor = await loadScript();
  const inst = StripeCtor(publishableKey);
  instances.set(publishableKey, inst);
  return inst;
}

export function isDarkTheme(): boolean {
  const t = document.documentElement.getAttribute('data-theme');
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

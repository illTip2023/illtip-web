/**
 * Coin top-ups on the web. Same endpoints and payloads as the app:
 *   illtip-mobile/src/services/coins.ts + hooks/useCoinPurchase.ts + providers/CoinRechargeProvider.tsx
 *   illtip-backend/routes/coins.js + controllers/coinController.js
 *
 *   GET  /coins/packages            → [{ id, coins, priceInCents, label, priceInKobo, priceNgn }]
 *   POST /coins/mobile-checkout     { packageId } → { clientSecret, paymentIntentId, publishableKey, amount, currency, packageId, coins }
 *   POST /coins/paystack-checkout   { packageId, email, callbackUrl? } → { authorizationUrl, accessCode, reference, packageId, coins }
 *   GET  /coins/balance             → { coinBalance }
 *   GET  /paystack/verify-paystack-payment-v2?reference_number=  (best-effort, app calls it after Paystack)
 * Coins are credited by the Stripe / Paystack webhooks, so after paying we poll the balance.
 */
import { api, unwrap } from '../../lib/api';
import { invalidate } from '../../lib/query';
import { href } from '../../lib/router';
import { coinStore } from '../home/store';

export type CoinPackage = {
  id: string;
  coins: number;
  /** USD price in dollars, from the backend's priceInCents. */
  priceUsd: number;
  /** Naira price as the backend quotes it for Paystack (priceNgn), when present. */
  priceNgn?: number;
};

export type StripeCoinCheckout = { clientSecret: string; publishableKey?: string; paymentIntentId?: string };
export type PaystackCoinCheckout = { authorizationUrl: string; reference: string };

const rec = (v: unknown): Record<string, any> => (v && typeof v === 'object' ? (v as Record<string, any>) : {});

/** Handles both { success, data } and a doubly nested { data: { data } } envelope (unwrapCoinApiData in the app). */
function payload<T = any>(res: { data: any }): T {
  const d = unwrap<any>(res);
  return (d && typeof d === 'object' && !Array.isArray(d) && 'data' in d && d.data && typeof d.data === 'object' ? d.data : d) as T;
}

function pick(o: Record<string, any>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function normalizePackage(raw: unknown): CoinPackage | null {
  const r = rec(raw);
  const id = String(r.id ?? r.packageId ?? '').trim();
  const coins = Number(r.coins ?? 0);
  if (!id || !Number.isFinite(coins) || coins <= 0) return null;
  const cents = Number(r.priceInCents ?? r.unit_amount ?? r.amountInCents);
  let priceUsd: number;
  if (Number.isFinite(cents)) priceUsd = cents / 100;
  else {
    const v = Number(r.price ?? r.priceUsd ?? r.amount);
    priceUsd = !Number.isFinite(v) ? 0 : v >= 100 ? v / 100 : v;
  }
  const ngn = Number(r.priceNgn);
  return { id, coins, priceUsd, priceNgn: Number.isFinite(ngn) && ngn > 0 ? ngn : undefined };
}

export async function fetchCoinPackages(): Promise<CoinPackage[]> {
  const list = payload<unknown>(await api.get('/coins/packages'));
  return (Array.isArray(list) ? list : []).map(normalizePackage).filter((p): p is CoinPackage => p != null);
}

/** Throws on failure (unlike home/api fetchCoinBalance) so polling can tell "0" from "unknown". */
export async function fetchCoinBalanceStrict(): Promise<number> {
  const { data } = await api.get('/coins/balance');
  const d = rec(rec(data).data);
  const inner = rec(d.data);
  const n = Number(inner.coinBalance ?? inner.balance ?? d.coinBalance ?? d.balance ?? rec(data).coinBalance);
  if (!Number.isFinite(n)) throw new Error('Balance unavailable');
  return n;
}

export async function createStripeCoinCheckout(packageId: string): Promise<StripeCoinCheckout> {
  const p = rec(payload(await api.post('/coins/mobile-checkout', { packageId })));
  const clientSecret = pick(p, 'clientSecret', 'client_secret', 'paymentIntentClientSecret');
  if (!clientSecret) throw new Error('Checkout could not be started. Please try again.');
  return { clientSecret, publishableKey: pick(p, 'publishableKey', 'publishable_key'), paymentIntentId: pick(p, 'paymentIntentId') };
}

export const PAYSTACK_URL_RE = /^https:\/\/([a-z0-9-]+\.)*paystack\.(com|co)\//i;

export function paystackCallbackUrl() {
  return location.origin + href('/coins/paystack-callback');
}
export function stripeCoinReturnUrl() {
  return location.origin + href('/coins/stripe-return');
}

export async function createPaystackCoinCheckout(packageId: string, email: string): Promise<PaystackCoinCheckout> {
  // callbackUrl is only honoured by the backend when it starts with its FRONTEND_URL; otherwise it
  // falls back to FRONTEND_URL + "coins/paystack-callback".
  const p = rec(payload(await api.post('/coins/paystack-checkout', { packageId, email, callbackUrl: paystackCallbackUrl() })));
  const authorizationUrl = pick(p, 'authorizationUrl', 'authorization_url') || '';
  const reference = pick(p, 'reference') || '';
  if (!authorizationUrl || !reference) throw new Error('Checkout could not be started. Please try again.');
  if (!PAYSTACK_URL_RE.test(authorizationUrl)) throw new Error('Payment page could not be opened. Please try again.');
  return { authorizationUrl, reference };
}

/** Best-effort server-side verify (app: verifyPaystackCoinPayment). The webhook is the source of truth. */
export async function verifyPaystackCoinPayment(reference: string): Promise<void> {
  try {
    await api.get('/paystack/verify-paystack-payment-v2', { params: { reference_number: reference } });
  } catch {
    /* ignore: we still poll the balance */
  }
}

/** Pushes a fresh balance everywhere it is shown (tip modal / post cards, wallet tiles). */
export function publishBalance(n: number) {
  coinStore.set(Math.max(0, n));
  invalidate('wallet:coins');
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Polls GET /coins/balance until it rises above `previous` (webhook credited) or ~60s pass. */
export async function pollBalanceUntilAbove(
  previous: number,
  opts: { intervalMs?: number; timeoutMs?: number; isCancelled?: () => boolean } = {}
): Promise<{ credited: boolean; balance: number | null }> {
  const interval = opts.intervalMs ?? 2000;
  const deadline = Date.now() + (opts.timeoutMs ?? 60_000);
  let latest: number | null = null;
  for (;;) {
    if (opts.isCancelled?.()) break;
    try {
      latest = await fetchCoinBalanceStrict();
      publishBalance(latest);
      if (latest > previous) return { credited: true, balance: latest };
    } catch {
      /* transient: keep polling */
    }
    if (Date.now() + interval > deadline) break;
    await sleep(interval);
  }
  return { credited: false, balance: latest };
}

/* ───────────── pending purchase (survives a same-tab redirect) ───────────── */

export type PendingCoinPurchase = {
  provider: 'stripe' | 'paystack';
  packageId: string;
  coins: number;
  previousBalance: number;
  /** In-app path to return to afterwards (e.g. the post being tipped). */
  next?: string;
  reference?: string;
  publishableKey?: string;
  startedAt: number;
};
const PENDING_KEY = 'illtip.coins.pending';
const PENDING_MAX_AGE = 2 * 60 * 60 * 1000;

export function savePendingCoins(p: PendingCoinPurchase) {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: return pages still poll */
  }
}
export function readPendingCoins(provider: PendingCoinPurchase['provider']): PendingCoinPurchase | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PendingCoinPurchase;
    if (p?.provider !== provider || !p.packageId || Date.now() - Number(p.startedAt) > PENDING_MAX_AGE) return null;
    return p;
  } catch {
    return null;
  }
}
export function clearPendingCoins() {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}

/** Only same-app relative paths are allowed as a "continue" target. */
export function safeNext(p?: string | null): string | null {
  if (!p || typeof p !== 'string') return null;
  if (!p.startsWith('/') || p.startsWith('//') || p.includes('\\')) return null;
  if (p.startsWith('/coins/')) return null;
  return p;
}

export function currentAppPath(): string {
  const base = href('/').replace(/\/$/, '');
  let p = location.pathname;
  if (base && p.startsWith(base)) p = p.slice(base.length);
  return (p.startsWith('/') ? p : '/' + p) + location.search;
}

export function formatUsd(n: number) {
  return `$${n.toFixed(2)}`;
}
export function formatNgn(n: number) {
  return `₦${Math.round(n).toLocaleString('en-NG')}`;
}

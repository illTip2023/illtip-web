/**
 * Subscriptions API, mirrored from illtip-mobile/src/services/subscriptions.ts and
 * src/hooks/useSubscriptionPurchase.ts / useSubscriptionStatus.ts.
 *   GET  /subscriptions/plans?catalog=      fetchSubscriptionPlans
 *   GET  /subscriptions/me                  fetchMySubscriptionStatus
 *   POST /subscriptions/mobile-checkout     createMobileSubscriptionCheckout   { planId, email }
 *   POST /subscriptions/upgrade-checkout    createMobileSubscriptionUpgradeCheckout { planId, email }
 * The plan is granted by the backend's Stripe / Paystack webhook; the client only confirms the
 * payment and then polls /subscriptions/me.
 */
import { api, unwrap } from '../../lib/api';
import { invalidate, setQueryData } from '../../lib/query';

export type SubscriptionCatalog = 'career' | 'hire' | 'eliteGold' | 'flat';
export const CATALOGS: SubscriptionCatalog[] = ['career', 'hire', 'eliteGold', 'flat'];

export type SubscriptionUpgrade = { fromPlanId: string; fromCatalog: SubscriptionCatalog; amount: number; currency: string; renewsAt: string };

export type SubscriptionPlan = {
  planId: string;
  catalog: SubscriptionCatalog;
  slug: string;
  name: string;
  billingPeriod: '1_MONTH' | '3_MONTH' | null;
  oneTime?: boolean;
  resolvedRegion: string | null;
  resolvedCurrency: string | null;
  resolvedPrice: number | null;
  resolvedProvider: 'stripe' | 'paystack' | null;
  upgrade?: SubscriptionUpgrade | null;
};

export type UserSubscriptionRecord = {
  userSubscriptionId: string;
  catalog: SubscriptionCatalog;
  planId: string;
  slug: string;
  status: 'ACTIVE' | 'CANCELLED';
  startedAt: string;
  expiresAt: string;
  cancelAtPeriodEnd?: boolean;
};

export type CatalogStatus = { active: boolean; subscription: UserSubscriptionRecord | null };
export type MyStatus = Record<SubscriptionCatalog, CatalogStatus> & { boostPostCredits?: number };

export type StripeCheckout = { provider: 'stripe'; clientSecret: string; publishableKey?: string; subscriptionId?: string; planId: string; catalog: SubscriptionCatalog };
export type PaystackCheckout = { provider: 'paystack'; authorizationUrl: string; reference: string; planId: string; catalog: SubscriptionCatalog };
export type Checkout = StripeCheckout | PaystackCheckout;

export const PLANS_KEY = 'plans:list';
export const STATUS_KEY = 'plans:status';

const EMPTY_STATUS = (): MyStatus => ({
  career: { active: false, subscription: null },
  hire: { active: false, subscription: null },
  eliteGold: { active: false, subscription: null },
  flat: { active: false, subscription: null },
  boostPostCredits: 0,
});

export async function fetchPlans(catalog?: SubscriptionCatalog): Promise<SubscriptionPlan[]> {
  const d = unwrap<unknown>(await api.get('/subscriptions/plans', { params: catalog ? { catalog } : undefined }));
  return Array.isArray(d) ? (d as SubscriptionPlan[]) : [];
}

/** Throws on network/API failure (callers that only gate a UI fall back to "not subscribed"). */
export async function fetchStatusStrict(): Promise<MyStatus> {
  const d = unwrap<any>(await api.get('/subscriptions/me'));
  const base = EMPTY_STATUS();
  if (d && typeof d === 'object') {
    for (const c of CATALOGS) if (d[c] && typeof d[c] === 'object') base[c] = { active: !!d[c].active, subscription: d[c].subscription ?? null };
    base.boostPostCredits = Number(d.boostPostCredits) || 0;
  }
  return base;
}

/** Same non-fatal behaviour as the app: a failed status read shows "not subscribed". */
export async function fetchStatus(): Promise<MyStatus> {
  try {
    return await fetchStatusStrict();
  } catch {
    return EMPTY_STATUS();
  }
}

/** hasEffectiveAccess (useSubscriptionStatus.ts): Elite Gold also unlocks career + hire. */
export function hasEffectiveAccess(s: MyStatus | undefined, catalog: SubscriptionCatalog) {
  if (s?.[catalog]?.active) return true;
  return (catalog === 'career' || catalog === 'hire') && !!s?.eliteGold?.active;
}

/** The plan the user currently holds (PaymentPlansScreen isCurrentPlan): never true for one-time plans. */
export function isCurrentPlan(s: MyStatus | undefined, plan: SubscriptionPlan | undefined) {
  if (!plan || plan.oneTime) return false;
  const c = s?.[plan.catalog];
  return !!c?.active && c.subscription?.planId === plan.planId;
}

/**
 * Would a NEW checkout for this plan collide with an active subscription in the same catalog?
 * (`flat` also holds one-time Boost Post credits; those don't block buying the Verified Badge.)
 */
export function blocksNewCheckout(s: MyStatus | undefined, plan: SubscriptionPlan) {
  if (plan.upgrade || plan.oneTime) return false;
  const c = s?.[plan.catalog];
  if (!c?.active) return false;
  return !(plan.catalog === 'flat' && c.subscription?.planId === 'boost-post');
}

/** Active catalogs for the "my subscription" banner (MySubscriptionBanner in PaymentPlansScreen). */
export function activeCatalogs(s: MyStatus | undefined): SubscriptionCatalog[] {
  if (!s) return [];
  return CATALOGS.filter((c) => s[c]?.active && !(c === 'flat' && s[c]?.subscription?.planId === 'boost-post'));
}

function parseCheckout(d: any, planId: string): Checkout {
  if (d && typeof d.clientSecret === 'string' && d.clientSecret) {
    return {
      provider: 'stripe',
      clientSecret: d.clientSecret,
      publishableKey: typeof d.publishableKey === 'string' && d.publishableKey.trim() ? d.publishableKey.trim() : undefined,
      subscriptionId: typeof d.subscriptionId === 'string' ? d.subscriptionId : undefined,
      planId: String(d.planId ?? planId),
      catalog: d.catalog,
    };
  }
  // Must be a real absolute URL (same check as the app) before we send the browser there.
  if (d && typeof d.authorizationUrl === 'string' && /^https:\/\//i.test(d.authorizationUrl)) {
    return { provider: 'paystack', authorizationUrl: d.authorizationUrl, reference: String(d.reference ?? ''), planId: String(d.planId ?? planId), catalog: d.catalog };
  }
  throw new Error('Checkout could not be started. Please try again.');
}

export async function createCheckout(planId: string, email: string | undefined, upgrade: boolean): Promise<Checkout> {
  const path = upgrade ? '/subscriptions/upgrade-checkout' : '/subscriptions/mobile-checkout';
  const d = unwrap<any>(await api.post(path, { planId, email: email || undefined }));
  return parseCheckout(d, planId);
}

/* ───────────── activation polling ───────────── */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function setStatusCache(s: MyStatus) {
  setQueryData(STATUS_KEY, () => s);
}

/** Refreshes every query that depends on subscription status / plan upgrade offers. */
export function refreshSubscriptionQueries(latest?: MyStatus) {
  if (latest) setQueryData(STATUS_KEY, () => latest);
  invalidate(PLANS_KEY);
  invalidate('hire:subscription-status');
}

/**
 * Polls /subscriptions/me until `catalog` is active on `planId` (the webhook has granted it), every
 * `intervalMs` for up to `timeoutMs`. Matching the planId matters for upgrades inside one catalog,
 * where the OLD plan is still active on the first poll (useSubscriptionPurchase pollStatusUntilActive).
 */
export async function pollUntilActive(
  catalog: SubscriptionCatalog,
  planId: string | undefined,
  opts: { intervalMs?: number; timeoutMs?: number; isCancelled?: () => boolean } = {}
): Promise<{ confirmed: boolean; latest: MyStatus | null }> {
  const interval = opts.intervalMs ?? 2000;
  const deadline = Date.now() + (opts.timeoutMs ?? 60_000);
  let latest: MyStatus | null = null;
  try {
    for (;;) {
      if (opts.isCancelled?.()) return { confirmed: false, latest };
      try {
        latest = await fetchStatusStrict();
        // Boost Post is a one-time credit: an older `flat` grant can still look active after its credit was
        // spent, so wait for the credit itself (useSubscriptionPurchase in the app does the same).
        if (planId === 'boost-post') {
          if ((latest.boostPostCredits ?? 0) >= 1) return { confirmed: true, latest };
        } else {
          const c = latest[catalog];
          if (c?.active && (!planId || c.subscription?.planId === planId)) return { confirmed: true, latest };
        }
      } catch {
        /* transient: keep polling */
      }
      if (Date.now() + interval > deadline) return { confirmed: false, latest };
      await sleep(interval);
    }
  } finally {
    if (!opts.isCancelled?.()) refreshSubscriptionQueries(latest ?? undefined);
  }
}

/* ───────────── pending purchase (survives the Stripe 3DS / Paystack redirects) ───────────── */

export type PendingPurchase = {
  provider: 'stripe' | 'paystack';
  planId: string;
  catalog: SubscriptionCatalog;
  upgrade: boolean;
  next?: string;
  reference?: string;
  /** Stripe publishable key (public) so the return page can read the PaymentIntent status. */
  publishableKey?: string;
  startedAt: number;
};

const PENDING_KEY = 'illtip.pendingPurchase';
const PENDING_MAX_AGE = 2 * 60 * 60 * 1000;

export function savePending(p: PendingPurchase) {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: the return pages still poll without it */
  }
}

export function readPending(provider: PendingPurchase['provider']): PendingPurchase | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PendingPurchase;
    if (p?.provider !== provider || !p.planId || Date.now() - Number(p.startedAt) > PENDING_MAX_AGE) return null;
    return p;
  } catch {
    return null;
  }
}

export function clearPending() {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}

/* ───────────── formatting / links ───────────── */

/** formatResolvedPrice (utils/subscriptionPricing.ts), generalised to any ISO currency. */
export function formatPrice(amount: number | null | undefined, currency: string | null | undefined): string | null {
  if (amount == null || !Number.isFinite(Number(amount)) || !currency) return null;
  const cur = currency.toUpperCase();
  const n = Number(amount);
  if (cur === 'USD') return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (cur === 'NGN') return '₦' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(n);
  } catch {
    return `${cur} ${n.toFixed(2)}`;
  }
}

/** Per-month slice of a multi-month price (formatTogglePerMonthPrice). */
export function perMonth(plan: SubscriptionPlan | undefined, months: number): string | null {
  if (!plan?.resolvedPrice || !plan.resolvedCurrency) return null;
  const cur = plan.resolvedCurrency.toUpperCase();
  const amt = months <= 1 ? plan.resolvedPrice : cur === 'NGN' ? Math.floor(plan.resolvedPrice / months) : Math.floor((plan.resolvedPrice / months) * 100) / 100;
  return formatPrice(amt, cur);
}

export function formatDate(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Only same-app relative paths are allowed as a post-purchase destination. */
export function safeNext(n: string | null | undefined): string | null {
  if (!n || !n.startsWith('/') || n.startsWith('//') || n.startsWith('/\\')) return null;
  return n;
}

/** Link to the plans page, used by paywalls across the app. */
export function plansHref(opts: { catalog?: SubscriptionCatalog; plan?: string; next?: string } = {}) {
  const q = new URLSearchParams();
  if (opts.catalog) q.set('catalog', opts.catalog);
  if (opts.plan) q.set('plan', opts.plan);
  if (opts.next) q.set('next', opts.next);
  const s = q.toString();
  return '/plans' + (s ? '?' + s : '');
}

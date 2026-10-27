/**
 * "Purchase Tip Coins" on the web, mirroring the app's recharge flow
 * (illtip-mobile CoinRechargeBottomSheet → PaymentMethodSheet → Stripe PaymentSheet | Paystack WebView,
 *  orchestrated by providers/CoinRechargeProvider.tsx + hooks/useCoinPurchase.ts):
 *   pick a package → Purchase → choose "Card (Stripe)" or "Paystack" →
 *     Stripe:   POST /coins/mobile-checkout → Payment Element (Stripe iframe) → confirmPayment
 *               (redirect: 'if_required', return_url /coins/stripe-return) → poll /coins/balance
 *     Paystack: POST /coins/paystack-checkout → same-tab redirect to the paystack.co/.com page →
 *               /coins/paystack-callback polls the balance.
 * One checkout at a time (module-wide guard), buttons disabled while in flight.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { ENV_NAME, STRIPE_PUBLISHABLE_KEY } from '../../lib/env';
import { useQuery } from '../../lib/query';
import { Icon, Modal, compactNumber, toast } from '../../ui/kit';
import { getStripe, isDarkTheme } from '../plans/stripe';
import { useCoinBalance } from '../home/store';
import {
  clearPendingCoins,
  createPaystackCoinCheckout,
  createStripeCoinCheckout,
  currentAppPath,
  fetchCoinBalanceStrict,
  fetchCoinPackages,
  formatNgn,
  formatUsd,
  pollBalanceUntilAbove,
  publishBalance,
  savePendingCoins,
  stripeCoinReturnUrl,
  type CoinPackage,
  type StripeCoinCheckout,
} from './api';
import './coins.css';

type Step =
  | { k: 'pick' }
  | { k: 'method'; pkg: CoinPackage }
  | { k: 'starting'; pkg: CoinPackage; method: 'stripe' | 'paystack' }
  | { k: 'redirecting'; pkg: CoinPackage }
  | { k: 'stripe'; pkg: CoinPackage; checkout: StripeCoinCheckout; previous: number }
  | { k: 'confirming'; pkg: CoinPackage; previous: number }
  | { k: 'done'; pkg: CoinPackage; previous: number; credited: boolean; balance: number | null };

/** Module-wide: never two coin checkouts at once, even from two open dialogs. */
let checkoutInFlight = false;
/** Reuse a PaymentIntent if the user backs out and picks the same package again (app: one PI per sheet). */
const piCache = new Map<string, { at: number; checkout: StripeCoinCheckout }>();
const PI_REUSE_MS = 20 * 60 * 1000;

const PACKAGES_KEY = 'coins:packages';

export function stepTitle(k: Step['k']): string {
  if (k === 'method') return 'Choose a payment method';
  if (k === 'stripe') return 'Payment Details';
  if (k === 'confirming') return 'Confirming your payment';
  if (k === 'done') return 'Coins';
  return 'Purchase Tip Coins';
}

export function BuyCoinsFlow({
  onDone,
  onCancel,
  doneLabel = 'Done',
  onBusyChange,
  onStepChange,
  next,
}: {
  /** Called when the user leaves the result screen (credited or not). */
  onDone?: (balance: number | null) => void;
  /** Shown as a "Back" link on the first step when set. */
  onCancel?: () => void;
  doneLabel?: string;
  onBusyChange?: (busy: boolean) => void;
  onStepChange?: (k: Step['k']) => void;
  /** Where the Paystack / Stripe-redirect return pages send the user afterwards. Defaults to the current page. */
  next?: string;
}) {
  const { user } = useAuth();
  const balance = useCoinBalance();
  const pkgs = useQuery(PACKAGES_KEY, fetchCoinPackages, { staleMs: 60_000 });
  const packages = pkgs.data || [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [step, setStep] = useState<Step>({ k: 'pick' });
  const alive = useRef(true);

  const selected = packages.find((p) => p.id === selectedId) || packages[0];
  const busy = step.k === 'starting' || step.k === 'redirecting' || step.k === 'confirming';

  useEffect(() => {
    alive.current = true;
    // Back from Paystack via the browser's Back button can restore this page from bfcache.
    const onShow = (e: any) => {
      if (e?.persisted) {
        checkoutInFlight = false;
        setStep({ k: 'pick' });
      }
    };
    window.addEventListener('pageshow', onShow);
    fetchCoinBalanceStrict().then(publishBalance).catch(() => {});
    return () => {
      alive.current = false;
      window.removeEventListener('pageshow', onShow);
    };
  }, []);

  useEffect(() => onBusyChange?.(busy), [busy]);
  useEffect(() => onStepChange?.(step.k), [step.k]);

  const snapshotBalance = async () => {
    try {
      const b = await fetchCoinBalanceStrict();
      publishBalance(b);
      return b;
    } catch {
      return balance ?? 0; // non-fatal; polling then waits for any increase over what we last saw
    }
  };

  const start = async (pkg: CoinPackage, method: 'stripe' | 'paystack') => {
    if (checkoutInFlight) {
      toast.error('A coin purchase is already in progress.');
      return;
    }
    if (method === 'paystack' && !user?.email) {
      toast.error('We need your email to start checkout. Please update your profile.');
      return;
    }
    checkoutInFlight = true;
    setStep({ k: 'starting', pkg, method });
    let keepLock = false;
    try {
      const previous = await snapshotBalance();
      if (method === 'paystack') {
        const co = await createPaystackCoinCheckout(pkg.id, user!.email);
        savePendingCoins({ provider: 'paystack', packageId: pkg.id, coins: pkg.coins, previousBalance: previous, reference: co.reference, next: next || currentAppPath(), startedAt: Date.now() });
        keepLock = true;
        if (alive.current) setStep({ k: 'redirecting', pkg });
        window.location.href = co.authorizationUrl;
        return;
      }
      const cached = piCache.get(pkg.id);
      const checkout = cached && Date.now() - cached.at < PI_REUSE_MS ? cached.checkout : await createStripeCoinCheckout(pkg.id);
      piCache.set(pkg.id, { at: cached?.at ?? Date.now(), checkout });
      if (alive.current) setStep({ k: 'stripe', pkg, checkout, previous });
      keepLock = true; // released when the payment form closes or completes
    } catch (e: any) {
      toast.error(e?.message || 'Could not start checkout.');
      if (alive.current) setStep({ k: 'method', pkg });
    } finally {
      if (!keepLock) checkoutInFlight = false;
    }
  };

  const confirm = async (pkg: CoinPackage, previous: number) => {
    piCache.delete(pkg.id);
    setStep({ k: 'confirming', pkg, previous });
    const r = await pollBalanceUntilAbove(previous, { isCancelled: () => !alive.current });
    checkoutInFlight = false;
    clearPendingCoins();
    if (!alive.current) return;
    if (r.credited) toast.ok('Coins added to your balance!');
    setStep({ k: 'done', pkg, previous, credited: r.credited, balance: r.balance });
  };

  const closeStripe = (pkg: CoinPackage) => {
    checkoutInFlight = false;
    setStep({ k: 'method', pkg });
  };

  // Unmounting mid-form (dialog closed) must release the lock; polling releases it itself.
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(
    () => () => {
      if (stepRef.current.k === 'stripe') checkoutInFlight = false;
    },
    []
  );

  if (step.k === 'stripe') {
    return <StripeCoinPay pkg={step.pkg} checkout={step.checkout} previous={step.previous} email={user?.email} next={next} onBack={() => closeStripe(step.pkg)} onPaid={() => confirm(step.pkg, step.previous)} />;
  }

  if (step.k === 'confirming') {
    return (
      <div className="cn-result">
        <div className="spinner" aria-hidden />
        <p className="cn-result-msg">Adding {compactNumber(step.pkg.coins)} coins to your balance… This usually takes a few seconds.</p>
        <p className="muted small" style={{ margin: 0 }}>
          Please keep this page open.
        </p>
      </div>
    );
  }

  if (step.k === 'done') {
    return (
      <div className="cn-result">
        <div className={'cn-result-icon' + (step.credited ? ' ok' : ' wait')} aria-hidden>
          {step.credited ? '✓' : '…'}
        </div>
        <div className="cn-result-title">{step.credited ? 'Coins added to your balance!' : 'Payment received'}</div>
        <p className="cn-result-msg">
          {step.credited
            ? `Your balance is now ${compactNumber(step.balance ?? 0)} coins.`
            : "Your payment went through, but the coins haven't shown up yet. They'll be added to your balance shortly."}
        </p>
        <div className="stack" style={{ width: '100%' }}>
          <button className="btn btn-block" onClick={() => onDone?.(step.balance)}>
            {doneLabel}
          </button>
          {!step.credited && (
            <button className="btn btn-ghost btn-block" onClick={() => confirm(step.pkg, step.previous)}>
              Check balance again
            </button>
          )}
        </div>
      </div>
    );
  }

  if (step.k === 'method' || step.k === 'starting' || step.k === 'redirecting') {
    const pkg = step.pkg;
    const pending = step.k !== 'method' ? (step.k === 'redirecting' ? 'paystack' : step.method) : null;
    return (
      <div className="cn-flow">
        <div className="cn-sum">
          <span className="cn-sum-coins">
            <CoinGlyph /> {compactNumber(pkg.coins)} coins
          </span>
          <span className="cn-sum-price">{formatUsd(pkg.priceUsd)}</span>
        </div>
        {ENV_NAME === 'DEV' && <div className="cn-testnote">Test server — use test card 4242 4242 4242 4242</div>}
        <div className="cn-methods" role="list">
          <MethodButton
            label="Card (Stripe)"
            sub="Pay with debit or credit card"
            icon="card"
            pending={pending === 'stripe'}
            disabled={!!pending}
            onClick={() => start(pkg, 'stripe')}
          />
          <MethodButton
            label="Paystack"
            sub={`Card, bank transfer & more${pkg.priceNgn ? ` · ${formatNgn(pkg.priceNgn)}` : ''}`}
            icon="bank"
            pending={pending === 'paystack'}
            disabled={!!pending}
            onClick={() => start(pkg, 'paystack')}
          />
        </div>
        {step.k === 'redirecting' && <p className="muted small center" style={{ margin: 0 }}>Taking you to Paystack…</p>}
        <button className="btn btn-ghost btn-block" disabled={!!pending} onClick={() => setStep({ k: 'pick' })}>
          Back
        </button>
      </div>
    );
  }

  // step.k === 'pick'
  return (
    <div className="cn-flow">
      <div className="cn-balance">
        <span>Current Balance:</span>
        <CoinGlyph />
        <b>{balance === undefined ? '…' : compactNumber(balance)}</b>
      </div>
      {pkgs.loading && !packages.length ? (
        <div className="cn-loading">
          <div className="spinner" aria-hidden />
        </div>
      ) : pkgs.error && !packages.length ? (
        <div className="cn-loading">
          <div className="muted small">Could not load coin packages.</div>
          <button className="btn btn-sm btn-ghost" onClick={() => pkgs.refetch()}>
            Retry
          </button>
        </div>
      ) : !packages.length ? (
        <div className="cn-loading muted small">No coin packages are available right now.</div>
      ) : (
        <div className="cn-grid" role="radiogroup" aria-label="Coin packages">
          {packages.map((p) => {
            const on = p.id === selected?.id;
            return (
              <button key={p.id} role="radio" aria-checked={on} className={'cn-pkg' + (on ? ' on' : '')} onClick={() => setSelectedId(p.id)}>
                <span className="cn-pkg-coins">
                  <CoinGlyph /> {compactNumber(p.coins).toUpperCase()}
                </span>
                <span className="cn-pkg-price">{formatUsd(p.priceUsd)}</span>
              </button>
            );
          })}
        </div>
      )}
      <p className="cn-legal">When selecting and clicking purchase, the user is acknowledging the i'llTip payment clauses.</p>
      <button className="btn btn-block cn-buy-btn" disabled={!selected} onClick={() => selected && setStep({ k: 'method', pkg: selected })}>
        Purchase
      </button>
      {onCancel && (
        <button className="btn btn-ghost btn-block" onClick={onCancel}>
          Back
        </button>
      )}
    </div>
  );
}

function CoinGlyph() {
  return (
    <span className="cn-glyph" aria-hidden>
      $
    </span>
  );
}

function MethodButton({ label, sub, icon, pending, disabled, onClick }: { label: string; sub: string; icon: 'card' | 'bank'; pending: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button className="cn-method" role="listitem" disabled={disabled} onClick={onClick} aria-label={`Pay with ${label}`}>
      <span className={'cn-method-ic ' + icon} aria-hidden>
        {icon === 'card' ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="5" width="20" height="14" rx="2" />
            <path d="M2 10h20" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="6" width="20" height="12" rx="2" />
            <circle cx="12" cy="12" r="2.5" />
            <path d="M6 12h.01M18 12h.01" />
          </svg>
        )}
      </span>
      <span className="grow">
        <span className="cn-method-label">{label}</span>
        <span className="cn-method-sub">{sub}</span>
      </span>
      {pending ? <span className="spinner cn-method-spin" aria-hidden /> : <span className="cn-method-go" aria-hidden>›</span>}
    </button>
  );
}

function StripeCoinPay({
  pkg,
  checkout,
  previous,
  email,
  next,
  onBack,
  onPaid,
}: {
  pkg: CoinPackage;
  checkout: StripeCoinCheckout;
  previous: number;
  email?: string;
  next?: string;
  onBack: () => void;
  onPaid: () => void;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const stripeRef = useRef<any>(null);
  const elementsRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const publishableKey = checkout.publishableKey || STRIPE_PUBLISHABLE_KEY;

  useEffect(() => {
    let cancelled = false;
    let el: any = null;
    (async () => {
      try {
        const stripe = await getStripe(publishableKey);
        if (cancelled || !host.current) return;
        const elements = stripe.elements({
          clientSecret: checkout.clientSecret,
          appearance: {
            theme: isDarkTheme() ? 'night' : 'stripe',
            variables: { colorPrimary: '#3f4ff5', borderRadius: '10px', fontFamily: 'Poppins, -apple-system, Segoe UI, Roboto, sans-serif' },
          },
          fonts: [{ cssSrc: 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&display=swap' }],
        });
        el = elements.create('payment', { layout: 'tabs', defaultValues: email ? { billingDetails: { email } } : undefined });
        el.on('ready', () => !cancelled && setReady(true));
        el.on('loaderror', (e: any) => !cancelled && setLoadError(e?.error?.message || 'The payment form could not be loaded. Please try again.'));
        el.mount(host.current);
        stripeRef.current = stripe;
        elementsRef.current = elements;
      } catch (e: any) {
        if (!cancelled) setLoadError(e?.message || 'The payment form could not be loaded. Please try again.');
      }
    })();
    return () => {
      cancelled = true;
      try {
        el?.destroy();
      } catch {
        /* already gone */
      }
    };
  }, [checkout.clientSecret, publishableKey, email]);

  const pay = async () => {
    if (paying || !ready || !stripeRef.current || !elementsRef.current) return;
    setPaying(true);
    setError(null);
    // If Stripe has to leave the page (3-D Secure / bank app), /coins/stripe-return picks this up.
    savePendingCoins({ provider: 'stripe', packageId: pkg.id, coins: pkg.coins, previousBalance: previous, publishableKey, next: next || currentAppPath(), startedAt: Date.now() });
    try {
      const { error: err, paymentIntent } = await stripeRef.current.confirmPayment({
        elements: elementsRef.current,
        redirect: 'if_required',
        confirmParams: { return_url: stripeCoinReturnUrl() },
      });
      if (err) {
        clearPendingCoins();
        setError(err.message || 'Payment failed. Please try again.');
        setPaying(false);
        return;
      }
      const st = paymentIntent?.status;
      if (st === 'succeeded' || st === 'processing' || st === 'requires_capture') {
        onPaid();
        return;
      }
      clearPendingCoins();
      setError('Payment was not completed. Please try again.');
      setPaying(false);
    } catch (e: any) {
      clearPendingCoins();
      setError(e?.message || 'Payment failed. Please try again.');
      setPaying(false);
    }
  };

  return (
    <div className="cn-flow">
      <div className="cn-sum">
        <span className="cn-sum-coins">
          <CoinGlyph /> {compactNumber(pkg.coins)} coins
        </span>
        <span className="cn-sum-price">{formatUsd(pkg.priceUsd)}</span>
      </div>
      {ENV_NAME === 'DEV' && <div className="cn-testnote">Test server — use test card 4242 4242 4242 4242</div>}
      {loadError ? (
        <div className="card error-box">{loadError}</div>
      ) : (
        <>
          {!ready && <div className="spinner" aria-hidden style={{ margin: '24px auto' }} />}
          <div ref={host} className="cn-pay-element" />
        </>
      )}
      {error && (
        <div className="cn-pay-error" role="alert">
          {error}
        </div>
      )}
      <button className="btn btn-block cn-buy-btn" disabled={!ready || paying || !!loadError} onClick={pay}>
        {paying ? 'Processing…' : `Pay ${formatUsd(pkg.priceUsd)}`}
      </button>
      <button className="btn btn-ghost btn-block" disabled={paying} onClick={onBack}>
        Back
      </button>
      <div className="muted tiny center">Payments are processed securely by Stripe. i'llTip never sees or stores your card details.</div>
    </div>
  );
}

/** Stand-alone dialog (wallet page etc.). */
export function BuyCoinsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [k, setK] = useState<Step['k']>('pick');
  if (!open) return null;
  return (
    <Modal open onClose={() => !busy && onClose()} title={stepTitle(k)}>
      <BuyCoinsFlow onDone={onClose} onBusyChange={setBusy} onStepChange={setK} />
    </Modal>
  );
}

/** Compact "need coins?" card with a button that opens the purchase flow. */
export function BuyCoinsPrompt({ onBuy, compact, title, sub }: { onBuy: () => void; compact?: boolean; title?: string; sub?: string }) {
  return (
    <div className={'cn-prompt' + (compact ? ' compact' : '')}>
      <span className="cn-prompt-ic" aria-hidden>
        <Icon name="coin" size={compact ? 18 : 22} />
      </span>
      <div className="grow">
        <div className="cn-prompt-title">{title || (compact ? 'Need more coins?' : 'Buy coins to keep tipping')}</div>
        {!compact && <div className="muted small">{sub || 'Top up your balance here with a card or Paystack. Coins work on the web and in the app.'}</div>}
      </div>
      <button className="btn btn-sm" onClick={onBuy}>
        Buy coins
      </button>
    </div>
  );
}

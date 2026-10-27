/**
 * Web version of useSubscriptionPurchase + useSubscriptionUpgradeFlow (illtip-mobile/src/hooks):
 *   start(plan, upgrade) → POST mobile-checkout | upgrade-checkout →
 *     Stripe:   Payment Element in a modal → stripe.confirmPayment → poll /subscriptions/me
 *     Paystack: remember the purchase in sessionStorage → same-tab redirect to authorizationUrl
 *               (the backend's callback_url lands on /subscriptions/paystack-callback)
 * Safety: one checkout at a time, no new checkout over an active plan in the same catalog, the
 * Stripe client secret is reused if the user closes and reopens the form for the same plan.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { ENV_NAME, STRIPE_PUBLISHABLE_KEY } from '../../lib/env';
import { href, navigate } from '../../lib/router';
import { Modal, toast } from '../../ui/kit';
import {
  blocksNewCheckout,
  clearPending,
  createCheckout,
  fetchStatusStrict,
  formatDate,
  formatPrice,
  pollUntilActive,
  refreshSubscriptionQueries,
  savePending,
  type StripeCheckout,
  type SubscriptionPlan,
} from './api';
import { CATALOG_LABELS, planTitle } from './catalog';
import { getStripe, isDarkTheme } from './stripe';

/** What the user pays now: the upgrade difference, or the plan's resolved price. */
export function chargeLabel(plan: SubscriptionPlan | undefined, upgrade: boolean): string | null {
  if (!plan) return null;
  if (upgrade) return plan.upgrade ? formatPrice(plan.upgrade.amount, plan.upgrade.currency) : null;
  return formatPrice(plan.resolvedPrice, plan.resolvedCurrency);
}

export function stripeReturnUrl() {
  return location.origin + href('/subscriptions/stripe-return');
}

type Phase =
  | { k: 'idle' }
  | { k: 'starting' }
  | { k: 'redirecting' }
  | { k: 'stripe'; plan: SubscriptionPlan; upgrade: boolean; checkout: StripeCheckout }
  | { k: 'confirming'; plan: SubscriptionPlan; upgrade: boolean }
  | { k: 'done'; plan: SubscriptionPlan; upgrade: boolean; confirmed: boolean };

const CHECKOUT_REUSE_MS = 20 * 60 * 1000;

/** `onPaid`: the caller confirms the purchase itself (Boost Post) instead of the generic "Subscription active" dialog. */
export function useCheckoutFlow({ next, onPaid }: { next?: string | null; onPaid?: (plan: SubscriptionPlan) => void } = {}) {
  const { user } = useAuth();
  const [phase, setPhase] = useState<Phase>({ k: 'idle' });
  const inFlight = useRef(false);
  const alive = useRef(true);
  const reuse = useRef(new Map<string, { at: number; checkout: StripeCheckout }>());

  useEffect(() => {
    alive.current = true;
    // Coming back from Paystack with the browser's Back button can restore this page from bfcache.
    const onShow = (e: any) => {
      if (e?.persisted) {
        inFlight.current = false;
        setPhase({ k: 'idle' });
      }
    };
    window.addEventListener('pageshow', onShow);
    return () => {
      alive.current = false;
      window.removeEventListener('pageshow', onShow);
    };
  }, []);

  const start = async (plan: SubscriptionPlan, upgrade: boolean) => {
    if (inFlight.current) return;
    if (upgrade ? !plan.upgrade : plan.resolvedPrice == null || !plan.resolvedCurrency) {
      toast.error(upgrade ? 'This plan is not available as an upgrade.' : 'This plan is no longer available.');
      return;
    }
    inFlight.current = true;
    setPhase({ k: 'starting' });
    let redirecting = false;
    try {
      if (!upgrade) {
        // Fresh read (not the cached one) so a plan bought a moment ago in another tab or the app counts.
        const status = await fetchStatusStrict().catch(() => null);
        if (status && blocksNewCheckout(status, plan)) {
          refreshSubscriptionQueries(status);
          const until = formatDate(status[plan.catalog]?.subscription?.expiresAt);
          toast.error(`You already have an active ${CATALOG_LABELS[plan.catalog]} plan${until ? ` (until ${until})` : ''}.`);
          setPhase({ k: 'idle' });
          return;
        }
      }
      const key = plan.planId + (upgrade ? ':upgrade' : '');
      const cached = reuse.current.get(key);
      const checkout = cached && Date.now() - cached.at < CHECKOUT_REUSE_MS ? cached.checkout : await createCheckout(plan.planId, user?.email, upgrade);
      if (checkout.provider === 'paystack') {
        if (!/^https:\/\/([a-z0-9-]+\.)*paystack\.(com|co)\//i.test(checkout.authorizationUrl || '')) throw new Error('Payment page could not be opened. Please try again.');
        savePending({ provider: 'paystack', planId: plan.planId, catalog: plan.catalog, upgrade, next: next || undefined, reference: checkout.reference, startedAt: Date.now() });
        redirecting = true;
        setPhase({ k: 'redirecting' });
        window.location.href = checkout.authorizationUrl;
        return;
      }
      reuse.current.set(key, { at: cached?.at ?? Date.now(), checkout });
      if (alive.current) setPhase({ k: 'stripe', plan, upgrade, checkout });
    } catch (e: any) {
      toast.error(e?.message || 'Payment failed. Please try again.');
      if (alive.current) setPhase({ k: 'idle' });
    } finally {
      if (!redirecting) inFlight.current = false;
    }
  };

  const confirm = async (plan: SubscriptionPlan, upgrade: boolean) => {
    reuse.current.delete(plan.planId + (upgrade ? ':upgrade' : ''));
    if (onPaid) {
      setPhase({ k: 'idle' });
      onPaid(plan);
      return;
    }
    setPhase({ k: 'confirming', plan, upgrade });
    inFlight.current = true;
    const r = await pollUntilActive(plan.catalog, plan.planId, { isCancelled: () => !alive.current });
    inFlight.current = false;
    clearPending();
    if (alive.current) setPhase({ k: 'done', plan, upgrade, confirmed: r.confirmed });
  };

  const close = () => setPhase({ k: 'idle' });

  const elements = (
    <>
      {phase.k === 'stripe' && (
        <StripePayModal
          key={phase.checkout.clientSecret}
          plan={phase.plan}
          upgrade={phase.upgrade}
          checkout={phase.checkout}
          email={user?.email}
          next={next}
          onClose={close}
          onPaid={() => confirm(phase.plan, phase.upgrade)}
        />
      )}
      <Modal open={phase.k === 'confirming'} onClose={() => {}} title="Confirming your payment">
        <ConfirmingBody />
      </Modal>
      {phase.k === 'done' && (
        <Modal open onClose={close} title={phase.confirmed ? (phase.upgrade ? 'Plan upgraded' : 'Subscription active') : 'Payment received'}>
          <ResultBody
            confirmed={phase.confirmed}
            upgrade={phase.upgrade}
            title={planTitle(phase.plan.planId, phase.plan.name)}
            next={next}
            onRecheck={() => confirm(phase.plan, phase.upgrade)}
            onClose={close}
          />
        </Modal>
      )}
    </>
  );

  return { start, busy: phase.k !== 'idle' && phase.k !== 'done', phase: phase.k, elements };
}

export function ConfirmingBody() {
  return (
    <div className="pl-result">
      <div className="spinner" aria-hidden />
      <p className="pl-result-msg">Confirming your payment… This usually takes a few seconds.</p>
      <p className="muted small" style={{ margin: 0 }}>
        Please keep this page open.
      </p>
    </div>
  );
}

export function ResultBody({
  confirmed,
  upgrade,
  title,
  next,
  onRecheck,
  onClose,
}: {
  confirmed: boolean;
  upgrade?: boolean;
  title?: string;
  next?: string | null;
  onRecheck?: () => void;
  onClose?: () => void;
}) {
  const go = (to: string) => {
    onClose?.();
    navigate(to);
  };
  return (
    <div className="pl-result">
      <div className={'pl-result-icon' + (confirmed ? ' ok' : ' wait')} aria-hidden>
        {confirmed ? '✓' : '…'}
      </div>
      {confirmed ? (
        <>
          <div className="pl-result-title">{upgrade ? 'Your plan has been upgraded!' : 'Subscription activated successfully!'}</div>
          <p className="pl-result-msg">{title ? `${title} is now active on your account.` : 'Your plan is now active on your account.'}</p>
        </>
      ) : (
        <>
          <div className="pl-result-title">Still processing</div>
          <p className="pl-result-msg">
            {upgrade
              ? 'Payment was completed, but the upgrade is still being confirmed. It will show here shortly.'
              : "Payment was completed, but activation is still being confirmed. It'll show on your account shortly."}
          </p>
        </>
      )}
      <div className="stack" style={{ width: '100%' }}>
        {next ? (
          <button className="btn btn-block" onClick={() => go(next)}>
            Continue
          </button>
        ) : confirmed && onClose ? (
          <button className="btn btn-block" onClick={onClose}>
            Done
          </button>
        ) : (
          <button className="btn btn-block" onClick={() => go('/plans')}>
            Back to plans
          </button>
        )}
        {!confirmed && onRecheck && (
          <button className="btn btn-ghost btn-block" onClick={onRecheck}>
            Check activation
          </button>
        )}
      </div>
    </div>
  );
}

function StripePayModal({
  plan,
  upgrade,
  checkout,
  email,
  next,
  onClose,
  onPaid,
}: {
  plan: SubscriptionPlan;
  upgrade: boolean;
  checkout: StripeCheckout;
  email?: string;
  next?: string | null;
  onClose: () => void;
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
  const amount = chargeLabel(plan, upgrade);

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
    // If Stripe has to redirect (3-D Secure, bank apps), /subscriptions/stripe-return picks this up.
    savePending({ provider: 'stripe', planId: plan.planId, catalog: plan.catalog, upgrade, next: next || undefined, publishableKey, startedAt: Date.now() });
    try {
      const { error: err, paymentIntent } = await stripeRef.current.confirmPayment({
        elements: elementsRef.current,
        redirect: 'if_required',
        confirmParams: { return_url: stripeReturnUrl() },
      });
      if (err) {
        clearPending();
        setError(err.message || 'Payment failed. Please try again.');
        setPaying(false);
        return;
      }
      const st = paymentIntent?.status;
      if (st === 'succeeded' || st === 'processing' || st === 'requires_capture') {
        onPaid();
        return;
      }
      clearPending();
      setError('Payment was not completed. Please try again.');
      setPaying(false);
    } catch (e: any) {
      clearPending();
      setError(e?.message || 'Payment failed. Please try again.');
      setPaying(false);
    }
  };

  return (
    <Modal open onClose={() => !paying && onClose()} title={upgrade ? `Upgrade to ${planTitle(plan.planId, plan.name)}` : 'Payment Details'}>
      <div className="pl-pay">
        <div className="pl-pay-sum">
          <div className="grow">
            <div className="pl-pay-plan">{planTitle(plan.planId, plan.name)}</div>
            {upgrade && plan.upgrade && <div className="muted small">Price difference charged today. Your plan renews on {formatDate(plan.upgrade.renewsAt)}.</div>}
          </div>
          <div className="pl-pay-amt">{amount}</div>
        </div>
        {ENV_NAME === 'DEV' && <div className="pl-testnote">Test server — use test card 4242 4242 4242 4242</div>}
        {loadError ? (
          <div className="card error-box">{loadError}</div>
        ) : (
          <>
            {!ready && <div className="spinner" aria-hidden style={{ margin: '24px auto' }} />}
            <div ref={host} className="pl-pay-element" />
          </>
        )}
        {error && (
          <div className="pl-pay-error" role="alert">
            {error}
          </div>
        )}
        <button className="btn btn-block pl-pay-btn" disabled={!ready || paying || !!loadError} onClick={pay}>
          {paying ? 'Processing…' : amount ? `Pay ${amount}` : 'Pay Now'}
        </button>
        <div className="muted tiny center">Payments are processed securely by Stripe. i'llTip never sees or stores your card details.</div>
      </div>
    </Modal>
  );
}

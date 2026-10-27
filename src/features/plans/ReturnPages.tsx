/**
 * Landing pages after a payment provider sends the browser back to the app:
 *   /subscriptions/stripe-return       Stripe return_url (3-D Secure / bank redirects).
 *                                      Query: payment_intent, payment_intent_client_secret, redirect_status
 *   /subscriptions/paystack-callback   the backend's Paystack callback_url (FRONTEND_URL + this path).
 *                                      Query: reference, trxref
 * Both confirm with /subscriptions/me (the webhook grants the plan), like PendingPurchaseRecovery.
 */
import React, { useEffect, useRef, useState } from 'react';
import { STRIPE_PUBLISHABLE_KEY } from '../../lib/env';
import { navigate } from '../../lib/router';
import { PageHeader } from '../../ui/kit';
import { clearPending, fetchStatus, pollUntilActive, readPending, refreshSubscriptionQueries, safeNext, type PendingPurchase } from './api';
import { planTitle } from './catalog';
import { ConfirmingBody, ResultBody } from './checkout';
import { getStripe } from './stripe';
import { BOOST_PLAN_ID, clearBoostDraft, finishBoostDraft, takeBoostDraft, type BoostOutcome } from './boost';

type State = { k: 'checking' } | { k: 'failed'; message: string } | { k: 'done'; confirmed: boolean; boost?: BoostOutcome | 'no-draft' };

/** Reads the query once, then drops it from the address bar (it can carry the PaymentIntent client secret). */
function useOneShotQuery(cleanPath: string) {
  const [q] = useState(() => new URLSearchParams(location.search));
  useEffect(() => {
    navigate(cleanPath, { replace: true });
  }, [cleanPath]);
  return q;
}

function useConfirm(run: (isCancelled: () => boolean) => Promise<State>) {
  const [state, setState] = useState<State>({ k: 'checking' });
  const started = useRef(false);
  const cancelled = useRef(false);
  const go = () => {
    setState({ k: 'checking' });
    run(() => cancelled.current)
      .then((s) => !cancelled.current && setState(s))
      .catch(() => !cancelled.current && setState({ k: 'done', confirmed: false }));
  };
  useEffect(() => {
    cancelled.current = false;
    if (!started.current) {
      started.current = true;
      go();
    }
    return () => {
      cancelled.current = true;
    };
  }, []);
  return { state, retry: go };
}

async function confirmPending(pending: PendingPurchase | null, isCancelled: () => boolean): Promise<State> {
  if (pending) {
    const r = await pollUntilActive(pending.catalog, pending.planId, { isCancelled });
    if (r.confirmed) clearPending();
    // Boost Post bought from the composer / a post's menu: publish or boost it now that the credit is there.
    if (r.confirmed && pending.planId === BOOST_PLAN_ID) {
      const draft = takeBoostDraft();
      return { k: 'done', confirmed: true, boost: draft ? await finishBoostDraft(draft) : 'no-draft' };
    }
    return { k: 'done', confirmed: r.confirmed };
  }
  // No record of what was bought (e.g. a different browser tab): one fresh status read, then a neutral message.
  const s = await fetchStatus();
  refreshSubscriptionQueries(s);
  return { k: 'done', confirmed: false };
}

function BoostResult({ outcome, next }: { outcome: BoostOutcome | 'no-draft'; next: string }) {
  const ok = outcome !== 'no-draft' && outcome.ok;
  const title =
    outcome === 'no-draft'
      ? 'Boost credit added'
      : !outcome.ok
        ? 'Payment received'
        : outcome.kind === 'new'
          ? outcome.boosted
            ? 'Post boosted and published!'
            : 'Post published'
          : 'Post boosted for 3 days!';
  const msg =
    outcome === 'no-draft'
      ? 'Your boost credit is ready. Create a post and tap Boost to use it.'
      : !outcome.ok
        ? `${outcome.message} Your boost credit is saved on your account. Tap Boost on your post to use it.`
        : outcome.kind === 'new' && !outcome.boosted
          ? 'Your post is live, but the boost has not applied yet. Tap Boost post in the post menu to apply it.'
          : 'Your post is now shown higher in the home feed to many more people.';
  return (
    <div className="pl-result">
      <div className={'pl-result-icon' + (ok ? ' ok' : ' wait')} aria-hidden>
        {ok ? '🚀' : '✓'}
      </div>
      <div className="pl-result-title">{title}</div>
      <p className="pl-result-msg">{msg}</p>
      <button className="btn btn-block" onClick={() => navigate(next)}>
        Continue
      </button>
    </div>
  );
}

function ReturnView({ state, pending, onRetry }: { state: State; pending: PendingPurchase | null; onRetry: () => void }) {
  const next = safeNext(pending?.next);
  const isBoost = pending?.planId === BOOST_PLAN_ID;
  return (
    <div className="pl-page">
      <PageHeader title="Payment" />
      <div className="card pl-return">
        {state.k === 'checking' ? (
          <ConfirmingBody />
        ) : state.k === 'failed' ? (
          <div className="pl-result">
            <div className="pl-result-icon err" aria-hidden>
              !
            </div>
            <div className="pl-result-title">Payment not completed</div>
            <p className="pl-result-msg">{state.message}</p>
            <button className="btn btn-block" onClick={() => navigate(isBoost ? next || '/' : pending ? `/plans/checkout?plan=${encodeURIComponent(pending.planId)}${next ? `&next=${encodeURIComponent(next)}` : ''}` : '/plans')}>
              {isBoost ? 'Back' : 'Try again'}
            </button>
            {next && !isBoost && (
              <button className="btn btn-ghost btn-block" onClick={() => navigate(next)}>
                Not now
              </button>
            )}
          </div>
        ) : state.boost ? (
          <BoostResult outcome={state.boost} next={next || '/'} />
        ) : (
          <ResultBody confirmed={state.confirmed} upgrade={pending?.upgrade} title={pending ? planTitle(pending.planId) : undefined} next={next} onRecheck={onRetry} />
        )}
      </div>
    </div>
  );
}

export function StripeReturnPage() {
  const q = useOneShotQuery('/subscriptions/stripe-return');
  const [pending] = useState(() => readPending('stripe'));
  const { state, retry } = useConfirm(async (isCancelled) => {
    const redirectStatus = q.get('redirect_status');
    const clientSecret = q.get('payment_intent_client_secret');
    if (redirectStatus === 'failed') {
      clearPending();
      if (pending?.planId === BOOST_PLAN_ID) clearBoostDraft();
      return { k: 'failed', message: 'Your bank or card provider declined the payment. You have not been charged.' };
    }
    if (clientSecret) {
      try {
        const stripe = await getStripe(pending?.publishableKey || STRIPE_PUBLISHABLE_KEY);
        const { paymentIntent } = await stripe.retrievePaymentIntent(clientSecret);
        const st = paymentIntent?.status;
        if (st === 'requires_payment_method' || st === 'canceled') {
          clearPending();
          if (pending?.planId === BOOST_PLAN_ID) clearBoostDraft();
          return { k: 'failed', message: 'The payment was not completed. Please try again with another payment method.' };
        }
      } catch {
        /* Stripe.js unavailable: fall through to polling, the webhook is the source of truth anyway */
      }
    }
    return confirmPending(pending, isCancelled);
  });
  return <ReturnView state={state} pending={pending} onRetry={retry} />;
}

export function PaystackCallbackPage() {
  useOneShotQuery('/subscriptions/paystack-callback');
  const [pending] = useState(() => readPending('paystack'));
  const { state, retry } = useConfirm((isCancelled) => confirmPending(pending, isCancelled));
  return <ReturnView state={state} pending={pending} onRetry={retry} />;
}


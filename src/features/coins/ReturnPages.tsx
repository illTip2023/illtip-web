/**
 * Where payment providers send the browser back after a coin top-up:
 *   /coins/paystack-callback  the backend's Paystack callback_url (coinController.createPaystackCoinCheckout:
 *                             our callbackUrl if it starts with FRONTEND_URL, else FRONTEND_URL + "coins/paystack-callback").
 *                             Query: reference, trxref
 *   /coins/stripe-return      Stripe return_url (3-D Secure / bank redirects).
 *                             Query: payment_intent, payment_intent_client_secret, redirect_status
 * Both poll GET /coins/balance until the webhook credits the coins, then offer to go back to where the
 * user was (e.g. the post they were tipping).
 */
import React, { useEffect, useRef, useState } from 'react';
import { STRIPE_PUBLISHABLE_KEY } from '../../lib/env';
import { navigate } from '../../lib/router';
import { PageHeader, compactNumber } from '../../ui/kit';
import { getStripe } from '../plans/stripe';
import {
  clearPendingCoins,
  fetchCoinBalanceStrict,
  pollBalanceUntilAbove,
  publishBalance,
  readPendingCoins,
  safeNext,
  verifyPaystackCoinPayment,
  type PendingCoinPurchase,
} from './api';
import './coins.css';

type State = { k: 'checking' } | { k: 'failed'; message: string } | { k: 'done'; credited: boolean; balance: number | null };

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
      .catch(() => !cancelled.current && setState({ k: 'done', credited: false, balance: null }));
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

async function confirmPending(pending: PendingCoinPurchase | null, isCancelled: () => boolean): Promise<State> {
  if (pending) {
    const r = await pollBalanceUntilAbove(pending.previousBalance, { isCancelled });
    if (r.credited) clearPendingCoins();
    return { k: 'done', credited: r.credited, balance: r.balance };
  }
  // No record of the purchase (another tab / browser): one fresh read, neutral message.
  const b = await fetchCoinBalanceStrict().catch(() => null);
  if (b != null) publishBalance(b);
  return { k: 'done', credited: false, balance: b };
}

function ReturnView({ state, pending, onRetry }: { state: State; pending: PendingCoinPurchase | null; onRetry: () => void }) {
  const next = safeNext(pending?.next);
  const leave = () => {
    clearPendingCoins();
    navigate(next || '/');
  };
  return (
    <div className="cn-return">
      <PageHeader title="Buy coins" />
      <div className="card">
        {state.k === 'checking' ? (
          <div className="cn-result">
            <div className="spinner" aria-hidden />
            <p className="cn-result-msg">Confirming your payment… This usually takes a few seconds.</p>
            <p className="muted small" style={{ margin: 0 }}>
              Please keep this page open.
            </p>
          </div>
        ) : state.k === 'failed' ? (
          <div className="cn-result">
            <div className="cn-result-icon err" aria-hidden>
              !
            </div>
            <div className="cn-result-title">Payment not completed</div>
            <p className="cn-result-msg">{state.message}</p>
            <button className="btn btn-block" onClick={leave}>
              {next ? 'Go back' : 'Continue'}
            </button>
          </div>
        ) : (
          <div className="cn-result">
            <div className={'cn-result-icon' + (state.credited ? ' ok' : ' wait')} aria-hidden>
              {state.credited ? '✓' : '…'}
            </div>
            <div className="cn-result-title">{state.credited ? 'Coins added to your balance!' : pending ? 'Still processing' : 'Payment'}</div>
            <p className="cn-result-msg">
              {state.credited
                ? `Your balance is now ${compactNumber(state.balance ?? 0)} coins.`
                : pending
                  ? "If your payment went through, the coins will be added to your balance shortly."
                  : `Your current balance is ${state.balance == null ? '—' : compactNumber(state.balance)} coins.`}
            </p>
            <div className="stack" style={{ width: '100%' }}>
              <button className="btn btn-block" onClick={leave}>
                {next ? 'Continue tipping' : 'Continue'}
              </button>
              {!state.credited && pending && (
                <button className="btn btn-ghost btn-block" onClick={onRetry}>
                  Check balance again
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function CoinsPaystackCallbackPage() {
  const q = useOneShotQuery('/coins/paystack-callback');
  const [pending] = useState(() => readPendingCoins('paystack'));
  const { state, retry } = useConfirm(async (isCancelled) => {
    const reference = q.get('reference') || q.get('trxref') || pending?.reference;
    if (reference) await verifyPaystackCoinPayment(reference);
    return confirmPending(pending, isCancelled);
  });
  return <ReturnView state={state} pending={pending} onRetry={retry} />;
}

export function CoinsStripeReturnPage() {
  const q = useOneShotQuery('/coins/stripe-return');
  const [pending] = useState(() => readPendingCoins('stripe'));
  const { state, retry } = useConfirm(async (isCancelled) => {
    const redirectStatus = q.get('redirect_status');
    const clientSecret = q.get('payment_intent_client_secret');
    if (redirectStatus === 'failed') {
      return { k: 'failed', message: 'Your bank or card provider declined the payment. You have not been charged.' };
    }
    if (clientSecret) {
      try {
        const stripe = await getStripe(pending?.publishableKey || STRIPE_PUBLISHABLE_KEY);
        const { paymentIntent } = await stripe.retrievePaymentIntent(clientSecret);
        const st = paymentIntent?.status;
        if (st === 'requires_payment_method' || st === 'canceled') {
          return { k: 'failed', message: 'The payment was not completed. Please try again with another payment method.' };
        }
      } catch {
        /* Stripe.js unavailable: poll anyway, the webhook is the source of truth */
      }
    }
    return confirmPending(pending, isCancelled);
  });
  return <ReturnView state={state} pending={pending} onRetry={retry} />;
}

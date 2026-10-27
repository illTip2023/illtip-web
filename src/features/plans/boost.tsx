/**
 * Boost Post, like the app (HomeScreen.handleBoostPost + PaymentPlansScreen 'boost-post' + SubscriptionCheckoutScreen):
 *   - The user has a boost credit (GET /subscriptions/me → boostPostCredits ≥ 1): publish with `boostPost: true`
 *     (POST /post spends one credit and sets boostedUntil, 3 days), or boost a published post (POST /post/boost-existing).
 *   - No credit: buy the one-time 'boost-post' plan (same /subscriptions/mobile-checkout as every plan). Only once the
 *     credit has landed is the post published boosted. Nothing is published before payment.
 * The draft (caption, already-uploaded media, mentions, poll) is kept in sessionStorage so it survives the Paystack /
 * Stripe 3-D Secure redirects; the return pages finish it. It is removed before the post is created, so a reload can
 * never publish it twice.
 */
import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, unwrap } from '../../lib/api';
import { useQuery } from '../../lib/query';
import { Modal } from '../../ui/kit';
import { clearPending, fetchPlans, fetchStatusStrict, formatPrice, PLANS_KEY, pollUntilActive, setStatusCache, type SubscriptionPlan } from './api';
import { ConfirmingBody, useCheckoutFlow } from './checkout';

export const BOOST_PLAN_ID = 'boost-post';

/** PAYMENT_PLANS 'boost-post' features (illtip-mobile/src/constants/paymentPlans.ts), duration filled in. */
export const BOOST_FEATURES = [
  'Boost Post (3 Days Visibility)',
  'Higher Ranking in Home Feed',
  'Reach Many More Users',
  'Boost Engagement & Exposure',
  'Increase Business, Service & Opportunity Visibility',
  'Perfect for Promoting Jobs, Services, Business & Brands',
  'Unlock Recommendations',
];

export type BoostPostBody = {
  caption: string;
  imageArr: any[];
  mentions?: any[];
  poll?: { question: string; options: string[]; durationHours: 24 | 48 | 72 };
};

export type BoostDraft = { kind: 'new'; body: BoostPostBody; startedAt: number } | { kind: 'existing'; statusPostId: number; startedAt: number };

const DRAFT_KEY = 'illtip.pendingBoost';
const DRAFT_MAX_AGE = 2 * 60 * 60 * 1000;

export function saveBoostDraft(d: BoostDraft) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {
    /* storage unavailable: the in-page (Stripe) path still works from memory */
  }
}

/** Reads AND removes the draft (so it can only ever be published once). */
export function takeBoostDraft(): BoostDraft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    sessionStorage.removeItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as BoostDraft;
    if (!d || Date.now() - Number(d.startedAt) > DRAFT_MAX_AGE) return null;
    if (d.kind === 'new' && d.body && typeof d.body.caption === 'string' && Array.isArray(d.body.imageArr)) return d;
    if (d.kind === 'existing' && Number(d.statusPostId) > 0) return d;
    return null;
  } catch {
    return null;
  }
}

export function clearBoostDraft() {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

/** Fresh boost-credit count (throws if the status can't be read; callers treat that as 0). */
export async function fetchBoostCredits(): Promise<number> {
  const s = await fetchStatusStrict();
  setStatusCache(s);
  return Number(s.boostPostCredits) || 0;
}

/** POST /post with boostPost: true. `boosted` is false when the server had no credit (the post is still published). */
export async function createBoostedPost(body: BoostPostBody): Promise<{ id: number | null; boosted: boolean }> {
  const res = await api.post('/post', { mentions: [], ...body, boostPost: true });
  const d = unwrap<any>(res);
  const id = Number(d?.statusPostId ?? d?.value?.statusPostId ?? res.data?.statusPostId);
  return { id: Number.isFinite(id) && id > 0 ? id : null, boosted: d?.boosted === true || res.data?.boosted === true };
}

export function isNoBoostCreditError(e: any) {
  return e?.status === 402 || e?.data?.data?.code === 'NO_BOOST_CREDIT' || e?.data?.code === 'NO_BOOST_CREDIT';
}

/** POST /post/boost-existing: boosts (or boosts again) a published post with one credit. Returns boostedUntil (epoch s). */
export async function boostExistingPost(statusPostId: number): Promise<number | null> {
  const d = unwrap<any>(await api.post('/post/boost-existing', { statusPostId }));
  const until = Number(d?.boostedUntil);
  return Number.isFinite(until) && until > 0 ? until : null;
}

export type BoostOutcome =
  | { kind: 'new'; ok: true; id: number | null; boosted: boolean }
  | { kind: 'existing'; ok: true; id: number; boostedUntil: number | null }
  | { kind: 'new' | 'existing'; ok: false; message: string };

/** Publishes / boosts a draft after the credit is confirmed. Never throws. */
export async function finishBoostDraft(d: BoostDraft): Promise<BoostOutcome> {
  try {
    if (d.kind === 'new') {
      const r = await createBoostedPost(d.body);
      return { kind: 'new', ok: true, ...r };
    }
    const until = await boostExistingPost(d.statusPostId);
    return { kind: 'existing', ok: true, id: d.statusPostId, boostedUntil: until };
  } catch (e: any) {
    const m = typeof e?.message === 'string' && e.message && !/^Request failed/.test(e.message) ? e.message : '';
    return { kind: d.kind, ok: false, message: m || (d.kind === 'new' ? 'Could not publish your post.' : 'Could not boost this post.') };
  }
}

type Stage = { k: 'summary' } | { k: 'preparing' } | { k: 'confirming' } | { k: 'pending' };

/**
 * The app's Boost Post plan card + checkout, as one dialog. `prepare` saves the draft (uploading media first) and
 * returns false to stop; `onConfirmed` runs once the bought credit is on the account (in-page Stripe payments).
 * Rendered in a portal above the Create post sheet.
 */
export function BoostCheckoutModal({
  open,
  onClose,
  prepare,
  onConfirmed,
  next,
}: {
  open: boolean;
  onClose: () => void;
  prepare: () => Promise<boolean>;
  onConfirmed: () => void;
  next: string;
}) {
  const plans = useQuery(open ? PLANS_KEY : null, () => fetchPlans(), { staleMs: 60_000 });
  const [stage, setStage] = useState<Stage>({ k: 'summary' });
  const alive = useRef(true);
  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  React.useEffect(() => {
    if (open) setStage({ k: 'summary' });
  }, [open]);

  const waitForCredit = async () => {
    setStage({ k: 'confirming' });
    const r = await pollUntilActive('flat', BOOST_PLAN_ID, { isCancelled: () => !alive.current });
    if (!alive.current) return;
    if (r.confirmed) {
      clearPending();
      setStage({ k: 'summary' });
      onConfirmed();
    } else setStage({ k: 'pending' });
  };

  const checkout = useCheckoutFlow({ next, onPaid: () => void waitForCredit() });
  const plan: SubscriptionPlan | undefined = plans.data?.find((p) => p.planId === BOOST_PLAN_ID);
  const price = plan ? formatPrice(plan.resolvedPrice, plan.resolvedCurrency) : null;
  const busy = stage.k !== 'summary' || checkout.busy;

  const pay = async () => {
    if (!plan || !price || busy) return;
    setStage({ k: 'preparing' });
    let ok = false;
    try {
      ok = await prepare();
    } catch {
      ok = false;
    }
    if (!alive.current) return;
    setStage({ k: 'summary' });
    if (ok) await checkout.start(plan, false);
  };

  if (!open) return null;
  const close = () => {
    if (stage.k === 'preparing' || stage.k === 'confirming' || checkout.phase === 'starting' || checkout.phase === 'redirecting') return;
    onClose();
  };

  return createPortal(
    <div className="bst-layer">
      <Modal open onClose={close} title="Boost Post">
        {stage.k === 'confirming' ? (
          <ConfirmingBody />
        ) : stage.k === 'pending' ? (
          <div className="pl-result">
            <div className="pl-result-icon wait" aria-hidden>
              …
            </div>
            <div className="pl-result-title">Still processing</div>
            <p className="pl-result-msg">Payment was completed, but your boost is still being confirmed. Tap Check again in a moment and your post will be published boosted.</p>
            <button className="btn btn-block" onClick={() => void waitForCredit()}>
              Check again
            </button>
          </div>
        ) : (
          <div className="bst">
            <div className="bst-hero" aria-hidden>
              🚀
            </div>
            <div className="bst-title">Boost your post</div>
            <div className="muted small center">One time purchase · 3 days of extra visibility</div>
            {plans.loading && !plans.data ? (
              <div className="spinner" aria-hidden style={{ margin: '16px auto' }} />
            ) : !plan || !price ? (
              <div className="card error-box">Boost isn't available right now. Please try again later.</div>
            ) : (
              <div className="bst-price">{price}</div>
            )}
            <ul className="pl-pfeats">
              {BOOST_FEATURES.map((f) => (
                <li key={f}>
                  <span className="pl-check" aria-hidden>
                    ✓
                  </span>
                  {f}
                </li>
              ))}
            </ul>
            {plan?.resolvedProvider === 'paystack' && <div className="muted small">You'll be taken to Paystack to pay securely, then brought back here. Your post goes live boosted once payment is confirmed.</div>}
            <button className="btn btn-block bst-pay" disabled={!plan || !price || busy} onClick={() => void pay()}>
              {stage.k === 'preparing' ? 'Preparing your post…' : checkout.phase === 'starting' ? 'Starting checkout…' : checkout.phase === 'redirecting' ? 'Redirecting to Paystack…' : price ? `Pay ${price} & boost` : 'Pay & boost'}
            </button>
            <button className="btn btn-ghost btn-block" disabled={busy} onClick={close}>
              Not now
            </button>
            <div className="muted tiny center">Nothing is published until your payment is confirmed.</div>
          </div>
        )}
      </Modal>
      {checkout.elements}
    </div>,
    document.body
  );
}

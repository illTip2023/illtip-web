/**
 * /plans — ChooseYourPlanScreen (?catalog=career|hire) and PaymentPlansScreen (no catalog, or
 * ?catalog=eliteGold|flat) from illtip-mobile. Optional ?plan=<backend planId> pre-selects a plan,
 * ?next=<path> is where the user goes after a successful purchase.
 * Prices come only from the backend (resolvedPrice/resolvedCurrency, or upgrade.amount/currency).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { APP_LINKS } from '../../lib/env';
import { navigate, useQueryParams } from '../../lib/router';
import { useQuery } from '../../lib/query';
import { ErrorBox, Modal, PageHeader, Spinner, toast } from '../../ui/kit';
import {
  activeCatalogs,
  CATALOGS,
  fetchPlans,
  fetchStatus,
  formatDate,
  formatPrice,
  hasEffectiveAccess,
  isCurrentPlan,
  perMonth,
  PLANS_KEY,
  safeNext,
  STATUS_KEY,
  type MyStatus,
  type SubscriptionCatalog,
  type SubscriptionPlan,
} from './api';
import { CATALOG_LABELS, CHOOSE_FLOWS, ELITE_GOLD, PAYMENT_PLANS, planTitle, TRUST, type ChooseFlow, type ChoosePlan, type Feature } from './catalog';
import { useCheckoutFlow } from './checkout';

export function checkoutHref(planId: string, next?: string | null) {
  return `/plans/checkout?plan=${encodeURIComponent(planId)}` + (next ? `&next=${encodeURIComponent(next)}` : '');
}

export function PlansPage() {
  const q = useQueryParams();
  const catalogParam = q.get('catalog') as SubscriptionCatalog | null;
  const planParam = q.get('plan');
  const next = safeNext(q.get('next'));
  const flow: ChooseFlow | null = catalogParam === 'career' || catalogParam === 'hire' ? catalogParam : null;
  const listCatalog = catalogParam && CATALOGS.includes(catalogParam) && !flow ? catalogParam : null;

  // staleMs 0: which plans offer "Upgrade" changes with every purchase, so always refresh on open (app: refetchOnMount 'always').
  const plans = useQuery(PLANS_KEY, () => fetchPlans(), { staleMs: 0 });
  const status = useQuery(STATUS_KEY, fetchStatus, { staleMs: 30_000 });
  const checkout = useCheckoutFlow({ next });
  const [confirmUpgrade, setConfirmUpgrade] = useState<SubscriptionPlan | null>(null);

  /** completeWithPlan / handleGetStarted from the app. */
  const choose = (planId: string) => {
    const bp = plans.data?.find((p) => p.planId === planId);
    if (!bp || bp.resolvedPrice == null || !bp.resolvedCurrency) {
      toast.error('This plan is no longer available.');
      return;
    }
    if (isCurrentPlan(status.data, bp) || checkout.busy) return;
    if (bp.upgrade) {
      setConfirmUpgrade(bp);
      return;
    }
    navigate(checkoutHref(bp.planId, next));
  };

  const title = flow ? 'Choose Your Plan' : 'Payment Plans';
  return (
    <div className="pl-page">
      <PageHeader title={title} back={next || '/settings'} />
      <MySubscriptionBanner status={status.data} />
      {plans.loading && !plans.data ? (
        <Spinner />
      ) : plans.error && !plans.data ? (
        <ErrorBox error={plans.error} onRetry={plans.refetch} />
      ) : flow ? (
        <ChooseView flow={flow} plans={plans.data || []} status={status.data} initialPlanId={planParam} onChoose={choose} busy={checkout.busy} />
      ) : (
        <PaymentPlansView plans={plans.data || []} status={status.data} catalog={listCatalog} highlight={planParam} onChoose={choose} busy={checkout.busy} />
      )}

      <div className="pl-trust">
        {TRUST.map((t) => (
          <div key={t.title} className="pl-trust-item">
            <div className="pl-trust-title">{t.title}</div>
            <div className="muted tiny">{t.subtitle}</div>
          </div>
        ))}
      </div>
      <div className="pl-apps muted small">
        Prefer the app?{' '}
        <a href={APP_LINKS.ios} target="_blank" rel="noreferrer">
          App Store
        </a>{' '}
        ·{' '}
        <a href={APP_LINKS.android} target="_blank" rel="noreferrer">
          Google Play
        </a>
      </div>

      <Modal open={!!confirmUpgrade} onClose={() => setConfirmUpgrade(null)} title={confirmUpgrade ? `Upgrade to ${planTitle(confirmUpgrade.planId, confirmUpgrade.name)}?` : ''}>
        {confirmUpgrade?.upgrade && (
          <div className="stack">
            <p style={{ margin: 0 }}>
              We will charge the difference ({formatPrice(confirmUpgrade.upgrade.amount, confirmUpgrade.upgrade.currency)}) today. Your plan renews on{' '}
              {formatDate(confirmUpgrade.upgrade.renewsAt)} at the new plan's regular price.
            </p>
            <button
              className="btn btn-block"
              disabled={checkout.busy}
              onClick={() => {
                const p = confirmUpgrade;
                setConfirmUpgrade(null);
                checkout.start(p, true);
              }}
            >
              Upgrade
            </button>
            <button className="btn btn-ghost btn-block" onClick={() => setConfirmUpgrade(null)}>
              Not now
            </button>
          </div>
        )}
      </Modal>
      {checkout.phase === 'starting' || checkout.phase === 'redirecting' ? (
        <div className="pl-busy" aria-live="polite">
          <div className="spinner" aria-hidden />
          <div>{checkout.phase === 'redirecting' ? 'Taking you to secure checkout…' : 'Starting checkout…'}</div>
        </div>
      ) : null}
      {checkout.elements}
    </div>
  );
}

/* ───────────── "my subscription" banner (PaymentPlansScreen MySubscriptionBanner, read-only) ───────────── */

export function MySubscriptionBanner({ status }: { status?: MyStatus }) {
  const cats = activeCatalogs(status);
  if (!cats.length) return null;
  return (
    <div className="pl-mine">
      {cats.map((c) => {
        const sub = status?.[c]?.subscription;
        const name = sub ? planTitle(sub.planId, CATALOG_LABELS[c]) : CATALOG_LABELS[c];
        const date = formatDate(sub?.expiresAt);
        const cancelled = !!sub?.cancelAtPeriodEnd;
        return (
          <div key={c} className="pl-mine-row">
            <div className="grow">
              <div className="pl-mine-name">{name}</div>
              {date && <div className="muted small">{cancelled ? `Ends ${date}` : `Renews ${date}`}</div>}
            </div>
            <span className={'tag ' + (cancelled ? 'tag-warn' : 'tag-ok')}>{cancelled ? 'Cancelled' : 'Active'}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ───────────── Choose Your Plan (career / hire) ───────────── */

function ChooseView({
  flow,
  plans,
  status,
  initialPlanId,
  onChoose,
  busy,
}: {
  flow: ChooseFlow;
  plans: SubscriptionPlan[];
  status?: MyStatus;
  initialPlanId: string | null;
  onChoose: (planId: string) => void;
  busy: boolean;
}) {
  const cfg = CHOOSE_FLOWS[flow];
  const initialIdx = Math.max(0, cfg.plans.findIndex((p) => p.backendPlanId === initialPlanId));
  const [idx, setIdx] = useState(initialPlanId && cfg.plans.some((p) => p.backendPlanId === initialPlanId) ? initialIdx : 1);
  const bp = (p: ChoosePlan) => plans.find((x) => x.planId === p.backendPlanId);
  const toggles = [
    { label: 'Monthly', icon: '', sub: (p?: string | null) => (p ? `Pay ${p}/month` : '') },
    { label: '3 Months', icon: '★', sub: (p?: string | null) => (p ? `Just ${p}/month` : '') },
    { label: 'Elite Gold', icon: '♛', sub: (p?: string | null) => (p ? `Just ${p}/month` : '') },
  ];
  const coveredByElite = status?.eliteGold?.active && !status?.[flow]?.active;

  return (
    <div className={'pl-stage pl-theme-' + cfg.theme}>
      <p className="pl-sub">{cfg.subtitle}</p>
      {coveredByElite && <div className="pl-note">Your Elite Gold plan already includes {flow === 'career' ? 'Career' : 'Hiring'} access.</div>}
      {!coveredByElite && hasEffectiveAccess(status, flow) && status?.[flow]?.active && (
        <div className="pl-note">You have an active {CATALOG_LABELS[flow]} plan. Upgrades show below when available.</div>
      )}
      <div className="pl-toggle" role="tablist">
        {cfg.plans.map((p, i) => (
          <button key={p.id} role="tab" aria-selected={i === idx} className={i === idx ? 'active' : ''} onClick={() => setIdx(i)}>
            <span className="pl-toggle-title">
              {toggles[i].icon && <span aria-hidden>{toggles[i].icon} </span>}
              {toggles[i].label}
            </span>
            <span className="pl-toggle-sub">{toggles[i].sub(perMonth(bp(p), p.months))}</span>
          </button>
        ))}
      </div>
      <div className="pl-saveline">
        Save <b>{cfg.savePercent}</b> with 3 months plan!
      </div>

      <div className="pl-cards">
        {cfg.plans.map((p, i) => (
          <div key={p.id} className={'pl-slot' + (i === idx ? ' shown' : '')}>
            {p.billing === 'elite' ? (
              <EliteGoldCard plan={bp(p)} status={status} onChoose={() => onChoose(p.backendPlanId)} busy={busy} />
            ) : (
              <ChoosePlanCard plan={p} backend={bp(p)} status={status} onChoose={() => onChoose(p.backendPlanId)} busy={busy} />
            )}
          </div>
        ))}
      </div>
      <div className="pl-dots" aria-hidden>
        {cfg.plans.map((p, i) => (
          <span key={p.id} className={i === idx ? 'active' : ''} />
        ))}
      </div>
    </div>
  );
}

function FeatureRow({ f, premium }: { f: Feature; premium: boolean }) {
  const excluded = f.included === false;
  const noPrefix = excluded && f.label.startsWith('NO ');
  return (
    <li className={'pl-feat' + (excluded ? ' excluded' : '')}>
      <span className={'pl-check' + (excluded ? ' x' : premium ? ' gold' : '')} aria-hidden>
        {excluded ? '✕' : '✓'}
      </span>
      <span className="grow">
        {f.isNew && <span className="pl-new">(NEW) </span>}
        {noPrefix ? (
          <>
            <b className="pl-no">NO </b>
            <s>{f.label.slice(3)}</s>
          </>
        ) : (
          f.label
        )}
      </span>
      {f.badge && <span className={'pl-badge ' + (f.tone || 'green')}>{f.badge}</span>}
    </li>
  );
}

function ctaFor(backend: SubscriptionPlan | undefined, status: MyStatus | undefined, label: string) {
  const current = isCurrentPlan(status, backend);
  const upgrade = !current && backend?.upgrade ? backend.upgrade : null;
  const unavailable = !backend || backend.resolvedPrice == null || !backend.resolvedCurrency;
  return { current, upgrade, unavailable, label: current ? 'Current Plan' : upgrade ? `Upgrade · pay ${formatPrice(upgrade.amount, upgrade.currency)} today` : label };
}

function UpgradeNote({ upgrade }: { upgrade: SubscriptionPlan['upgrade'] }) {
  if (!upgrade) return null;
  return (
    <p className="pl-upgrade-note">
      You already have a plan, so you only pay the difference ({formatPrice(upgrade.amount, upgrade.currency)}) today, not the full price. Your plan renews on {formatDate(upgrade.renewsAt)}.
    </p>
  );
}

function ChoosePlanCard({ plan, backend, status, onChoose, busy }: { plan: ChoosePlan; backend?: SubscriptionPlan; status?: MyStatus; onChoose: () => void; busy: boolean }) {
  const premium = !!plan.isPopular;
  const price = formatPrice(backend?.resolvedPrice, backend?.resolvedCurrency);
  const pm = plan.months > 1 ? perMonth(backend, plan.months) : null;
  const cta = ctaFor(backend, status, plan.ctaLabel);
  return (
    <div className={'pl-card' + (premium ? ' premium' : '')}>
      {premium && <div className="pl-popular">🔥 MOST POPULAR</div>}
      <div className="pl-card-head">
        <div className="pl-card-title">{plan.title}</div>
        <div className="pl-card-subtitle">{plan.subtitle}</div>
      </div>
      <div className="pl-price-row">
        {price ? (
          <>
            <span className="pl-price">{price}</span>
            {plan.priceSuffix && <span className="pl-suffix">{plan.priceSuffix}</span>}
          </>
        ) : (
          <span className="pl-suffix">Price unavailable</span>
        )}
      </div>
      {pm && <div className="pl-pm">= Just {pm}/month</div>}
      <ul className="pl-feats">
        {plan.features.map((f) => (
          <FeatureRow key={f.label} f={f} premium={premium} />
        ))}
      </ul>
      {premium && plan.offerBox && (
        <div className="pl-offer">
          <b>{plan.offerBox.title}</b>
          <div className="small">{plan.offerBox.subtitle}</div>
        </div>
      )}
      <UpgradeNote upgrade={cta.upgrade} />
      <button className={'btn btn-block pl-cta' + (premium ? ' premium' : '')} disabled={cta.current || cta.unavailable || busy} onClick={onChoose}>
        {cta.label}
        {premium && !cta.current && <span aria-hidden> ♛</span>}
      </button>
      {!premium && plan.footerNote && <div className="pl-foot">🛡 {plan.footerNote}</div>}
      {premium && plan.socialProofText && (
        <div className="pl-foot">
          <span className="pl-stars">★★★★★</span> {plan.socialProofText}
        </div>
      )}
    </div>
  );
}

function EliteGoldCard({ plan, status, onChoose, busy }: { plan?: SubscriptionPlan; status?: MyStatus; onChoose: () => void; busy: boolean }) {
  const price = formatPrice(plan?.resolvedPrice, plan?.resolvedCurrency);
  const cta = ctaFor(plan, status, 'Get Started');
  return (
    <div className="pl-card pl-elite">
      <div className="pl-elite-head">
        <div>
          <div className="pl-elite-brand">{ELITE_GOLD.brandLabel}</div>
          <div className="pl-elite-title">{ELITE_GOLD.title}</div>
          <div className="pl-card-subtitle">{ELITE_GOLD.durationLabel}</div>
        </div>
        <div className="pl-elite-price">
          <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
            <span className="pl-elite-all">{ELITE_GOLD.allAccessLabel}</span>
            <span className="pl-elite-limited">{ELITE_GOLD.limitedOfferLabel}</span>
          </div>
          <div className="pl-price">{price || <span className="pl-suffix">Price unavailable</span>}</div>
        </div>
      </div>
      {ELITE_GOLD.sections.map((s) => (
        <div key={s.title} className="pl-elite-sec">
          <div className="pl-elite-sec-title">
            <span aria-hidden>{s.emoji}</span> {s.title}
          </div>
          {s.features.map((f) => {
            const i = f.subtitle.indexOf(':');
            return (
              <div key={f.title} className="pl-elite-feat">
                <div className="pl-elite-feat-title">{f.title}</div>
                <div className="small">
                  {i > 0 ? (
                    <>
                      <b className="pl-elite-gold">{f.subtitle.slice(0, i + 1)}</b>
                      {f.subtitle.slice(i + 1)}
                    </>
                  ) : (
                    f.subtitle
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
      <UpgradeNote upgrade={cta.upgrade} />
      <button className="btn btn-block pl-cta premium" disabled={cta.current || cta.unavailable || busy} onClick={onChoose}>
        {cta.label}
      </button>
    </div>
  );
}

/* ───────────── Payment Plans list ───────────── */

function PaymentPlansView({
  plans,
  status,
  catalog,
  highlight,
  onChoose,
  busy,
}: {
  plans: SubscriptionPlan[];
  status?: MyStatus;
  catalog: SubscriptionCatalog | null;
  highlight: string | null;
  onChoose: (planId: string) => void;
  busy: boolean;
}) {
  const list = useMemo(
    () =>
      PAYMENT_PLANS.filter((p) => {
        const bp = plans.find((x) => x.planId === p.backendPlanId);
        return !!bp && (!catalog || bp.catalog === catalog);
      }),
    [plans, catalog]
  );
  const hl = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    hl.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [highlight, list.length]);

  if (!list.length) return <div className="card muted center">No plans are available right now. Please try again later.</div>;
  return (
    <div className="pl-list">
      {list.map((p) => {
        const bp = plans.find((x) => x.planId === p.backendPlanId)!;
        const price = formatPrice(bp.resolvedPrice, bp.resolvedCurrency);
        const cta = ctaFor(bp, status, 'Get Started');
        const isHl = highlight === p.backendPlanId;
        return (
          <div key={p.backendPlanId} ref={isHl ? hl : undefined} className={'card pl-pcard' + (isHl ? ' highlight' : '') + (bp.catalog === 'eliteGold' ? ' gold' : '')}>
            <div className="row between" style={{ alignItems: 'flex-start' }}>
              <div className="grow">
                <div className="pl-pcard-title">{p.title}</div>
                <div className="muted small">{p.durationLabel}</div>
              </div>
              <div className="pl-pcard-price">{price || <span className="muted small">Price unavailable</span>}</div>
            </div>
            <div className="muted small" style={{ margin: '10px 0 6px', fontWeight: 600 }}>
              This Plan includes:
            </div>
            <ul className="pl-pfeats">
              {p.features.map((f) => (
                <li key={f}>
                  <span className="pl-check" aria-hidden>
                    ✓
                  </span>
                  {f}
                </li>
              ))}
            </ul>
            <UpgradeNote upgrade={cta.upgrade} />
            <button className={'btn btn-block' + (cta.current ? ' btn-ghost' : '')} disabled={cta.current || cta.unavailable || busy} onClick={() => onChoose(p.backendPlanId)}>
              {cta.label}
            </button>
          </div>
        );
      })}
    </div>
  );
}


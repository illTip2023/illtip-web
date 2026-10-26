/**
 * /plans/checkout?plan=<backend planId>&next=<path> — SubscriptionCheckoutScreen from illtip-mobile:
 * order summary (plan, name, email, total) and "Pay". When the backend offers this plan as an
 * upgrade of the user's current one, it charges only the difference (upgrade-checkout).
 */
import React from 'react';
import { useAuth } from '../../lib/auth';
import { Link, useQueryParams } from '../../lib/router';
import { useQuery } from '../../lib/query';
import { ErrorBox, PageHeader, Spinner } from '../../ui/kit';
import { blocksNewCheckout, fetchPlans, fetchStatus, formatDate, isCurrentPlan, PLANS_KEY, plansHref, safeNext, STATUS_KEY } from './api';
import { CATALOG_LABELS, PAYMENT_PLANS, planTitle, TRUST } from './catalog';
import { chargeLabel, useCheckoutFlow } from './checkout';

const CHOOSE_CATALOGS = ['career', 'hire'];

export function CheckoutPage() {
  const q = useQueryParams();
  const planId = q.get('plan') || '';
  const next = safeNext(q.get('next'));
  const { user } = useAuth();
  const plans = useQuery(PLANS_KEY, () => fetchPlans(), { staleMs: 0 });
  const status = useQuery(STATUS_KEY, fetchStatus, { staleMs: 0 });
  const checkout = useCheckoutFlow({ next });

  const plan = plans.data?.find((p) => p.planId === planId);
  const back = plansHref({ catalog: plan && CHOOSE_CATALOGS.includes(plan.catalog) ? plan.catalog : undefined, next: next || undefined });

  if (plans.loading && !plans.data) return <Spinner />;
  if (plans.error && !plans.data) return <ErrorBox error={plans.error} onRetry={plans.refetch} />;

  const header = <PageHeader title="Checkout" back={back} />;
  if (!plan || plan.resolvedPrice == null || !plan.resolvedCurrency) {
    return (
      <div className="pl-page">
        {header}
        <div className="card center stack">
          <div>This plan is no longer available.</div>
          <Link className="btn btn-ghost" to={back}>
            Back to plans
          </Link>
        </div>
      </div>
    );
  }

  const title = planTitle(plan.planId, plan.name);
  const local = PAYMENT_PLANS.find((p) => p.backendPlanId === plan.planId);
  const upgrade = !!plan.upgrade;
  const current = isCurrentPlan(status.data, plan);
  const blocked = !current && blocksNewCheckout(status.data, plan);
  const total = chargeLabel(plan, upgrade);
  const activeSub = status.data?.[plan.catalog]?.subscription;
  const renew =
    plan.oneTime || !plan.billingPeriod
      ? 'One-time purchase.'
      : `Renews automatically every ${plan.billingPeriod === '3_MONTH' ? '3 months' : 'month'} until you cancel. Cancel anytime.`;

  return (
    <div className="pl-page">
      {header}
      <div className="card pl-co">
        <div className="pl-co-plan">
          <span aria-hidden>🛒</span> {upgrade ? `Upgrade to ${title}` : title}
        </div>
        {local && <div className="muted small">{local.durationLabel}</div>}
        <div className="pl-co-info">
          <div>{user?.name}</div>
          <div>{user?.email || <span className="muted">No email on your account</span>}</div>
          {user?.phone && <div>{user.phone}</div>}
        </div>
        <div className="divider" />
        {upgrade && plan.upgrade ? (
          <div className="pl-co-line">
            <span>Price difference due today</span>
            <span>{total}</span>
          </div>
        ) : (
          <div className="pl-co-line">
            <span>Subtotal:</span>
            <span>{total}</span>
          </div>
        )}
        <div className="pl-co-line total">
          <span>Total:</span>
          <span>{total}</span>
        </div>
        <div className="muted small">
          {upgrade && plan.upgrade
            ? `Your plan renews on ${formatDate(plan.upgrade.renewsAt)} at the new plan's regular price.`
            : renew}
        </div>
        {plan.resolvedProvider === 'paystack' && <div className="muted small">You'll be taken to Paystack to pay securely, then brought back here.</div>}

        {current ? (
          <div className="pl-note">This is your current plan.</div>
        ) : blocked ? (
          <div className="pl-note">
            You already have an active {CATALOG_LABELS[plan.catalog]} plan
            {activeSub ? ` (${planTitle(activeSub.planId, CATALOG_LABELS[plan.catalog])}${activeSub.expiresAt ? `, until ${formatDate(activeSub.expiresAt)}` : ''})` : ''}.
          </div>
        ) : null}

        <button className="btn btn-block pl-co-pay" disabled={current || blocked || checkout.busy || !total} onClick={() => checkout.start(plan, upgrade)}>
          {checkout.phase === 'starting' ? 'Starting checkout…' : checkout.phase === 'redirecting' ? 'Redirecting to Paystack…' : `Pay ${total}`}
        </button>
        <Link className="btn btn-ghost btn-block" to={back}>
          Back to plans
        </Link>
      </div>

      {local && (
        <div className="card">
          <div style={{ fontWeight: 700, marginBottom: 6 }}>This Plan includes:</div>
          <ul className="pl-pfeats">
            {local.features.map((f) => (
              <li key={f}>
                <span className="pl-check" aria-hidden>
                  ✓
                </span>
                {f}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="pl-trust">
        {TRUST.map((t) => (
          <div key={t.title} className="pl-trust-item">
            <div className="pl-trust-title">{t.title}</div>
            <div className="muted tiny">{t.subtitle}</div>
          </div>
        ))}
      </div>
      {checkout.elements}
    </div>
  );
}

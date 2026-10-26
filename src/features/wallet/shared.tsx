import React from 'react';
import { useAuth } from '../../lib/auth';
import { APP_LINKS } from '../../lib/env';
import { useQuery } from '../../lib/query';
import { Link } from '../../lib/router';
import { Icon } from '../../ui/kit';
import { fetchCoinBalance, fetchReferralDashboard, fetchWalletBalance, fetchWalletProfile } from './walletApi';
import './wallet.css';

/** Query keys are per user so switching accounts never shows the previous person's balances. */
export function useWalletQueries() {
  const { user } = useAuth();
  const uid = user?.id || '';
  const balance = useQuery(uid ? `wallet:balance:${uid}` : null, fetchWalletBalance);
  const coins = useQuery(uid ? `wallet:coins:${uid}` : null, fetchCoinBalance);
  const profile = useQuery(uid ? `wallet:profile:${uid}` : null, () => fetchWalletProfile(uid));
  return { uid, balance, coins, profile };
}
export function useReferralDashboard() {
  const { user } = useAuth();
  return useQuery(user?.id ? `referral:me:${user.id}` : null, fetchReferralDashboard);
}

export function StoreButtons({ light }: { light?: boolean }) {
  return (
    <div className="wl-stores">
      <a className={'wl-store' + (light ? ' light' : '')} href={APP_LINKS.ios} target="_blank" rel="noreferrer">
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden fill="currentColor"><path d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.3-.9-1.7 0-3.3 1-4.2 2.5-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9 0 0-2.8-1.1-2.8-4zM13.9 5c.7-.9 1.2-2 1-3.2-1 0-2.3.7-3 1.6-.7.8-1.2 2-1.1 3.1 1.2.1 2.3-.6 3.1-1.5z" /></svg>
        App Store
      </a>
      <a className={'wl-store' + (light ? ' light' : '')} href={APP_LINKS.android} target="_blank" rel="noreferrer">
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden fill="currentColor"><path d="M4 3.3v17.4c0 .5.5.8 1 .6l10.2-9.3L5 2.7c-.5-.2-1 .1-1 .6zm12.6 7.4L6.9 2.1l11.9 6.9-2.2 1.7zm0 2.6l2.2 1.7-11.9 6.9 9.7-8.6zm4.1-2.4-2.6-1.5-2.4 2.1 2.4 2.1 2.6-1.5c.8-.5.8-.8 0-1.2z" /></svg>
        Google Play
      </a>
    </div>
  );
}

/** Coin purchases and subscriptions are paid in the native app (Stripe / Paystack sheets). */
export function AppPaymentsCard({ compact }: { compact?: boolean }) {
  return (
    <div className={'wl-appcard' + (compact ? ' compact' : '')}>
      <div className="wl-appcard-ic">
        <Icon name="coin" size={26} />
      </div>
      <div className="grow">
        <div className="wl-appcard-title">Buy coins / upgrade in the i'llTip app</div>
        <div className="wl-appcard-sub">Coin top-ups and subscriptions are handled securely in the mobile app. Your balance shows up here right after.</div>
        <StoreButtons light />
      </div>
    </div>
  );
}

export function StatTile({ label, value, sub, icon, tone = 'blue', to, loading }: { label: string; value: React.ReactNode; sub?: React.ReactNode; icon: string; tone?: 'blue' | 'green' | 'gold' | 'violet' | 'slate'; to?: string; loading?: boolean }) {
  const body = (
    <>
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <span className={'wl-tile-ic tone-' + tone}>
          <Icon name={icon} size={20} />
        </span>
        {to && <span className="wl-tile-go" aria-hidden>›</span>}
      </div>
      <div className="wl-tile-label">{label}</div>
      <div className="wl-tile-value">{loading ? <span className="wl-skel" /> : value}</div>
      {sub && <div className="wl-tile-sub">{sub}</div>}
    </>
  );
  return to ? (
    <Link to={to} className="wl-tile wl-tile-link">
      {body}
    </Link>
  ) : (
    <div className="wl-tile">{body}</div>
  );
}

const STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: 'Pending', cls: 'warn' },
  PROCESSING: { label: 'Processing', cls: 'info' },
  PROVIDER_ACCEPTED: { label: 'Processing', cls: 'info' },
  COMPLETED: { label: 'Completed', cls: 'ok' },
  SUCCESS: { label: 'Completed', cls: 'ok' },
  FAILED: { label: 'Failed', cls: 'err' },
  REVERSED: { label: 'Returned', cls: 'muted' },
};
export function StatusPill({ status, paidLabel }: { status?: string; paidLabel?: string }) {
  if (!status) return null;
  const s = STATUS[status.toUpperCase()] || { label: status.charAt(0) + status.slice(1).toLowerCase(), cls: 'muted' };
  return <span className={'wl-pill ' + s.cls}>{status.toUpperCase() === 'COMPLETED' && paidLabel ? paidLabel : s.label}</span>;
}

export function fmtDate(v?: string | number) {
  if (!v) return '—';
  const t = typeof v === 'number' ? v : new Date(v).getTime();
  if (!t) return '—';
  return new Date(t).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

export function SubNav({ active }: { active: 'wallet' | 'transactions' | 'withdraw' | 'referral' | 'earnings' | 'history' }) {
  const items = [
    { id: 'wallet', to: '/wallet', label: 'Overview' },
    { id: 'transactions', to: '/wallet/transactions', label: 'Transactions' },
    { id: 'withdraw', to: '/wallet/withdraw', label: 'Withdraw' },
    { id: 'referral', to: '/referral', label: 'Refer & earn' },
    { id: 'earnings', to: '/referral/earnings', label: 'Referral earnings' },
    { id: 'history', to: '/referral/history', label: 'Referral history' },
  ];
  return (
    <nav className="wl-subnav chips" aria-label="Wallet sections">
      {items.map((i) => (
        <Link key={i.id} to={i.to} className={'chip' + (active === i.id ? ' active' : '')}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

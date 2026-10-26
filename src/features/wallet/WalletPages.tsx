/** /wallet (MyWalletScreen + FinanceScreen + RewardWalletScreen) and /wallet/transactions (TransactionHistoryScreen). */
import React, { useMemo, useState } from 'react';
import { Link } from '../../lib/router';
import { invalidate, useInfinite, useOnVisible } from '../../lib/query';
import { Empty, ErrorBox, Icon, PageHeader, Spinner } from '../../ui/kit';
import { AppPaymentsCard, fmtDate, StatTile, StatusPill, SubNav, useReferralDashboard, useWalletQueries } from './shared';
import { bankDisplay, CoinTx, fetchCoinHistory, fetchWalletTransactions, money, usd, WalletTx } from './walletApi';
import walletHero from './assets/wallet-hero.png';

export function WalletPage() {
  const { balance, coins, profile } = useWalletQueries();
  const ref = useReferralDashboard();
  const loading = (balance.loading && !balance.data) || (coins.loading && !coins.data);
  const earned = balance.data?.earnedUSD ?? 0;
  const coinValue = coins.data?.valueUSD ?? 0;
  const available = Math.round((earned + coinValue) * 100) / 100;
  const pendingCount = balance.data?.pendingWithdrawalsCount ?? 0;
  const bank = bankDisplay(profile.data?.bankDetails);
  const rw = ref.data?.wallet;

  return (
    <div className="wl-page">
      <PageHeader
        title="My Wallet"
        sub="Earnings, coins and referral rewards in one place"
        right={
          <button
            className="icon-btn"
            title="Refresh"
            aria-label="Refresh balances"
            onClick={() => {
              invalidate('wallet:');
              invalidate('referral:');
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" /></svg>
          </button>
        }
      />
      <SubNav active="wallet" />

      <section className="wl-hero">
        <div className="wl-hero-main">
          <div className="wl-hero-label">Available Balance</div>
          <div className="wl-hero-amount">{loading ? <span className="wl-skel light" /> : usd(available)}</div>
          <div className="wl-hero-meta">
            Earned {usd(earned)} · Coins {usd(coinValue)}
          </div>
          <div className="wl-hero-actions">
            <Link to="/wallet/withdraw" className="btn wl-btn-white">
              Withdraw
            </Link>
            <Link to="/wallet/transactions" className="btn wl-btn-glass">
              Transactions
            </Link>
          </div>
        </div>
        <img className="wl-hero-img" src={walletHero} alt="" />
      </section>

      <ErrorBox error={balance.error || coins.error} onRetry={() => { balance.refetch(); coins.refetch(); }} />

      <div className="wl-grid">
        <StatTile icon="jobs" tone="green" label="Earned Balance" loading={loading} value={usd(earned)} sub={`Earnings from completed jobs · lifetime ${usd(balance.data?.totalEarningsUSD ?? 0)}`} to="/wallet/withdraw?type=earned" />
        <StatTile icon="coin" tone="gold" label="Coin Balance" loading={loading} value={`${(coins.data?.coins ?? 0).toLocaleString()} coins`} sub={`≈ ${usd(coinValue)} (1 coin = $0.01)`} to="/wallet/withdraw?type=coins" />
        <StatTile
          icon="star"
          tone="violet"
          label="Referral Wallet"
          loading={ref.loading && !ref.data}
          value={rw ? money(rw.availableBalance, rw.currency) : ref.error ? '—' : money(0)}
          sub={rw ? `Lifetime earned ${money(rw.lifetimeEarned, rw.currency)}` : 'Earn when people you refer subscribe'}
          to="/referral/earnings"
        />
        <StatTile icon="heart" tone="blue" label="Reward Wallet" loading={profile.loading && !profile.data} value={usd(profile.data?.reward ?? 0)} sub="Your reward balance is displayed here" />
      </div>

      <div className="wl-cols">
        <div className="card wl-list-card">
          <Link to="/wallet/withdraw?section=pending" className="wl-row">
            <span className="wl-row-ic tone-gold"><Icon name="send" size={18} /></span>
            <span className="grow">
              <b>Pending Withdrawals</b>
              <span className="muted small block">You currently have {pendingCount} pending withdrawal(s){balance.data?.pendingWithdrawalsUSD ? ` · ${usd(balance.data.pendingWithdrawalsUSD)}` : ''}</span>
            </span>
            <span className="wl-chev">›</span>
          </Link>
          <Link to="/wallet/transactions" className="wl-row">
            <span className="wl-row-ic tone-blue"><Icon name="filter" size={18} /></span>
            <span className="grow">
              <b>Transaction History</b>
              <span className="muted small block">View your full transaction history</span>
            </span>
            <span className="wl-chev">›</span>
          </Link>
          <Link to="/wallet/withdraw?type=bank" className="wl-row">
            <span className="wl-row-ic tone-green"><Icon name="wallet" size={18} /></span>
            <span className="grow">
              <b>Bank Information</b>
              <span className="muted small block">{bank ? `${bank.bankName} ${bank.mask}` : 'Find out more about your bank information'}</span>
            </span>
            <span className="wl-chev">›</span>
          </Link>
          <Link to="/referral" className="wl-row">
            <span className="wl-row-ic tone-violet"><Icon name="share" size={18} /></span>
            <span className="grow">
              <b>Refer &amp; earn</b>
              <span className="muted small block">
                {ref.data ? `Earn ${money(ref.data.rewardPerReferral.amount, ref.data.rewardPerReferral.currency)} when someone you refer subscribes` : 'Share your referral link'}
              </span>
            </span>
            <span className="wl-chev">›</span>
          </Link>
        </div>
        <AppPaymentsCard />
      </div>
    </div>
  );
}

// ---------------- Transactions ----------------
type Kind = 'job_payment' | 'earned_withdrawal' | 'coin_purchase' | 'coin_withdrawal' | 'coin_earned' | 'coin_spend';
type Row = { id: string; kind: Kind; amountUSD: number; sign: '+' | '-'; coins?: number; status?: string; date: number };
const KIND: Record<Kind, { label: string; icon: string; tone: string }> = {
  job_payment: { label: 'Job Payment', icon: 'jobs', tone: 'green' },
  earned_withdrawal: { label: 'Withdrawal', icon: 'send', tone: 'red' },
  coin_purchase: { label: 'Coins Purchased', icon: 'coin', tone: 'blue' },
  coin_withdrawal: { label: 'Coin Withdrawal', icon: 'coin', tone: 'red' },
  coin_earned: { label: 'Coins Earned', icon: 'star', tone: 'gold' },
  coin_spend: { label: 'Coins Sent', icon: 'coin', tone: 'red' },
};
function fromWallet(t: WalletTx, i: number): Row {
  const credit = t.transactionType === 'CREDIT';
  return { id: 'w' + (t.transactionId ?? i), kind: credit ? 'job_payment' : 'earned_withdrawal', amountUSD: t.amount?.usdEquivalent ?? 0, sign: credit ? '+' : '-', status: t.status, date: Number(t.createdAt) || 0 };
}
function fromCoin(t: CoinTx, i: number): Row {
  const kind: Kind = t.type === 'withdrawal' ? 'coin_withdrawal' : t.type === 'earned' ? 'coin_earned' : t.type === 'spend' ? 'coin_spend' : 'coin_purchase';
  const n = Math.abs(t.coins ?? 0);
  return {
    id: 'c' + (t.requestId ?? '') + ':' + i + ':' + t.createdTime,
    kind,
    coins: n,
    amountUSD: t.type === 'withdrawal' ? t.payoutUSD ?? n * 0.01 : n * 0.01,
    sign: t.type === 'withdrawal' || t.type === 'spend' ? '-' : '+',
    status: t.status,
    date: (Number(t.createdTime) || 0) * 1000, // unix seconds
  };
}

export function TransactionsPage() {
  const { uid } = useWalletQueries();
  const [tab, setTab] = useState<'all' | 'earnings' | 'coins'>('all');
  const w = useInfinite<WalletTx>(uid ? `wallet:tx:${uid}` : null, async (p) => {
    const r = await fetchWalletTransactions(p);
    return { items: r.items, hasMore: p * 20 < r.total };
  });
  const c = useInfinite<CoinTx>(uid ? `wallet:coinhist:${uid}` : null, async (p) => {
    const r = await fetchCoinHistory(p);
    return { items: r.items, hasMore: p * 20 < r.total };
  });
  const rows = useMemo(() => {
    const a = tab === 'coins' ? [] : w.items.map(fromWallet);
    const b = tab === 'earnings' ? [] : c.items.map(fromCoin);
    return [...a, ...b].sort((x, y) => y.date - x.date);
  }, [w.items, c.items, tab]);
  const loading = (tab !== 'coins' && w.loading) || (tab !== 'earnings' && c.loading);
  const hasMore = (tab !== 'coins' && w.hasMore) || (tab !== 'earnings' && c.hasMore);
  const sentinel = useOnVisible(() => {
    if (tab !== 'coins' && w.hasMore && !w.loading) w.loadMore();
    if (tab !== 'earnings' && c.hasMore && !c.loading) c.loadMore();
  });
  const error = (tab !== 'coins' && w.error) || (tab !== 'earnings' && c.error);

  return (
    <div className="wl-page">
      <PageHeader title="Transaction History" back="/wallet" />
      <SubNav active="transactions" />
      <div className="tabs" role="tablist">
        {(['all', 'earnings', 'coins'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t === 'all' ? 'All' : t === 'earnings' ? 'Earnings' : 'Coins'}
          </button>
        ))}
      </div>
      <ErrorBox error={error} onRetry={() => { w.reload(); c.reload(); }} />
      {rows.length === 0 && !loading && !error ? (
        <div className="card">
          <Empty title="No Transactions Yet">Your earnings and coin activity will appear here.</Empty>
        </div>
      ) : (
        <div className="card wl-tx-list">
          {rows.map((r) => {
            const k = KIND[r.kind];
            return (
              <div key={r.id} className="wl-tx">
                <span className={'wl-row-ic tone-' + k.tone}>
                  <Icon name={k.icon} size={18} />
                </span>
                <div className="grow">
                  <div className="wl-tx-title">{k.label}</div>
                  <div className="tiny muted">
                    {fmtDate(r.date)}
                    {r.coins ? ` · ${r.coins.toLocaleString()} ${r.coins === 1 ? 'coin' : 'coins'}` : ''}
                  </div>
                </div>
                <div className="wl-tx-right">
                  <div className={'wl-tx-amt ' + (r.sign === '+' ? 'pos' : 'neg')}>
                    {r.sign}
                    {usd(r.amountUSD)}
                  </div>
                  <StatusPill status={r.status} />
                </div>
              </div>
            );
          })}
          {loading && <Spinner />}
        </div>
      )}
      {hasMore && <div ref={sentinel} style={{ height: 1 }} />}
      {hasMore && !loading && rows.length > 0 && (
        <div className="center" style={{ marginTop: 12 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => { if (tab !== 'coins') w.loadMore(); if (tab !== 'earnings') c.loadMore(); }}>Load more</button>
        </div>
      )}
    </div>
  );
}

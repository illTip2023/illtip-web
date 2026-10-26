/** /referral (ReferralEarningsScreen share block + ReferralCodeScreen), /referral/earnings, /referral/history. */
import React, { useState } from 'react';
import { Link, navigate } from '../../lib/router';
import { invalidate, useInfinite, useOnVisible } from '../../lib/query';
import { useAuth } from '../../lib/auth';
import { Empty, ErrorBox, Icon, PageHeader, Spinner, toast } from '../../ui/kit';
import { fmtDate, StatTile, StatusPill, SubNav, useReferralDashboard } from './shared';
import { applyReferralCode, fetchReferralTransactions, money, ReferralTx } from './walletApi';
import heroImg from './assets/referral-earnings-hero.png';

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function ShareBlock({ code, url }: { code: string; url: string }) {
  const [copied, setCopied] = useState<'' | 'link' | 'code'>('');
  async function copy(what: 'link' | 'code') {
    if (await copyText(what === 'link' ? url : code)) {
      setCopied(what);
      toast.ok(what === 'link' ? 'Referral link copied' : 'Referral code copied');
      setTimeout(() => setCopied(''), 2000);
    } else toast.error('Could not copy. Select the text and copy it manually.');
  }
  async function share() {
    const text = `Join i'llTip using my referral link: ${url}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Join me on i'llTip", text, url });
      } catch {
        /* cancelled */
      }
    } else copy('link');
  }
  const enc = encodeURIComponent(`Join i'llTip using my referral link: ${url}`);
  return (
    <div className="wl-share">
      <div className="wl-code-label">Your referral code</div>
      <button type="button" className="wl-code" onClick={() => copy('code')} title="Copy code">
        <span>{code}</span>
        <span className="wl-code-copy">{copied === 'code' ? 'Copied' : 'Copy'}</span>
      </button>
      <div className="wl-link">
        <input className="input" readOnly value={url} aria-label="Referral link" onFocus={(e) => e.target.select()} />
        <button type="button" className="btn" onClick={() => copy('link')}>
          {copied === 'link' ? <><Icon name="check" size={18} /> Copied</> : 'Copy Link'}
        </button>
      </div>
      <div className="wl-share-row">
        <button type="button" className="btn btn-dark btn-sm" onClick={share}>
          <Icon name="share" size={16} /> Share Link
        </button>
        <a className="btn btn-ghost btn-sm" href={`https://wa.me/?text=${enc}`} target="_blank" rel="noreferrer">WhatsApp</a>
        <a className="btn btn-ghost btn-sm" href={`https://twitter.com/intent/tweet?text=${enc}`} target="_blank" rel="noreferrer">X</a>
        <a className="btn btn-ghost btn-sm" href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`} target="_blank" rel="noreferrer">Facebook</a>
        <a className="btn btn-ghost btn-sm" href={`mailto:?subject=${encodeURIComponent("Join me on i'llTip")}&body=${enc}`}>Email</a>
      </div>
    </div>
  );
}

function ApplyCodeCard() {
  const q = useReferralDashboard();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const a = q.data?.attribution;
  if (!q.data) return null;
  if (a?.hasReferrer) {
    return (
      <div className="card wl-apply">
        <div className="row">
          <span className="wl-row-ic tone-green"><Icon name="check" size={18} /></span>
          <div className="grow">
            <b>Referral code applied</b>
            <div className="small muted">This account is permanently linked to a referrer.{a.referralCodeUsed ? ` Code: ${a.referralCodeUsed}` : ''}</div>
          </div>
        </div>
      </div>
    );
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    const c = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{8,16}$/.test(c)) return setErr('Enter a valid 8–16 character referral code.');
    setBusy(true);
    try {
      await applyReferralCode(c);
      toast.ok('Referral code applied');
      setCode('');
      invalidate('referral:');
    } catch (e: any) {
      setErr(e?.message || 'Could not apply referral code');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="card wl-apply" onSubmit={submit}>
      <b>Have a referral code?</b>
      <div className="small muted" style={{ margin: '4px 0 10px' }}>
        Enter it before purchasing your first eligible subscription. It cannot be changed afterward.
      </div>
      <div className="wl-link">
        <input className="input wl-mono" placeholder="Enter referral code" maxLength={16} value={code} onChange={(e) => setCode(e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase())} />
        <button className="btn btn-dark" disabled={busy || code.length < 8}>{busy ? 'Applying…' : 'Apply Code'}</button>
      </div>
      {err && <div className="small" style={{ color: 'var(--err)', marginTop: 8 }}>{err}</div>}
    </form>
  );
}

export function ReferralPage() {
  const q = useReferralDashboard();
  const d = q.data;
  const reward = d ? money(d.rewardPerReferral.amount, d.rewardPerReferral.currency) : '';
  return (
    <div className="wl-page">
      <PageHeader title="Refer & earn" sub="Grow together with us!" />
      <SubNav active="referral" />
      <section className="wl-ref-hero">
        <div className="wl-ref-hero-text">
          <h2>Grow together with us!</h2>
          <p>Share your link. You earn a reward when a referred user activates an eligible subscription.</p>
          {d && (
            <div className="wl-ref-badge">
              <Icon name="star" size={16} /> Reward per completed referral: <b>{reward}</b>
            </div>
          )}
        </div>
        <div className="wl-ref-hero-img">
          <img src={heroImg} alt="" />
        </div>
      </section>

      {q.loading && !d ? (
        <div className="card"><Spinner /></div>
      ) : q.error && !d ? (
        <ErrorBox error={new Error('Could not load your referral earnings.')} onRetry={q.refetch} />
      ) : d ? (
        <div className="card">
          <ShareBlock code={d.referralCode} url={d.referralUrl} />
        </div>
      ) : null}

      <h3 className="wl-h3">How it works</h3>
      <ol className="wl-steps">
        <li>
          <span className="wl-step-n">1</span>
          <div>
            <b>Share your link or code</b>
            <p className="small muted">Send your referral link to friends, clients and pros. They can also type your code when they sign up.</p>
          </div>
        </li>
        <li>
          <span className="wl-step-n">2</span>
          <div>
            <b>They join i'llTip</b>
            <p className="small muted">Their referral shows as <i>Pending</i>, and <i>In Progress</i> once they start an eligible subscription.</p>
          </div>
        </li>
        <li>
          <span className="wl-step-n">3</span>
          <div>
            <b>You earn when they subscribe</b>
            <p className="small muted">
              When a referred user activates an eligible subscription, the referral is <i>Completed</i> and {reward ? <b>{reward}</b> : 'your reward'} lands in your referral wallet.
            </p>
          </div>
        </li>
        <li>
          <span className="wl-step-n">4</span>
          <div>
            <b>Withdraw your rewards</b>
            <p className="small muted">Only completed referral rewards can be withdrawn{d ? ` (a ${d.withdrawalFeePercent}% withdrawal fee applies)` : ''}.</p>
          </div>
        </li>
      </ol>

      {d && (
        <div className="wl-grid three">
          <StatTile icon="user" tone="slate" label="Pending" value={d.statuses.pending} />
          <StatTile icon="play" tone="blue" label="In Progress" value={d.statuses.inProgress} />
          <StatTile icon="check" tone="green" label="Completed" value={d.statuses.completed} to="/referral/earnings" />
        </div>
      )}
      <ApplyCodeCard />
    </div>
  );
}

export function ReferralEarningsPage() {
  const q = useReferralDashboard();
  const d = q.data;
  const cur = d?.wallet.currency ?? 'USD';
  const available = d?.wallet.availableBalance ?? 0;
  return (
    <div className="wl-page">
      <PageHeader
        title="Referral Earnings"
        back="/wallet"
        right={
          <Link to="/referral/history" className="btn btn-ghost btn-sm">
            History
          </Link>
        }
      />
      <SubNav active="earnings" />
      {q.loading && !d ? (
        <div className="card"><Spinner /></div>
      ) : q.error && !d ? (
        <ErrorBox error={new Error('Could not load your referral earnings.')} onRetry={q.refetch} />
      ) : d ? (
        <>
          <section className="wl-hero violet">
            <div className="wl-hero-main">
              <div className="wl-hero-label">Available Balance</div>
              <div className="wl-hero-amount">{money(available, cur)}</div>
              <div className="wl-hero-meta">Only completed referral rewards can be withdrawn.</div>
              {d.wallet.pendingWithdrawalBalance > 0 && <div className="wl-hero-meta">Pending withdrawals: {money(d.wallet.pendingWithdrawalBalance, cur)}</div>}
              <div className="wl-hero-actions">
                <button className="btn wl-btn-white" disabled={available <= 0} onClick={() => navigate('/wallet/withdraw?type=referral')}>
                  {available > 0 ? 'Withdraw Rewards' : 'No Balance to Withdraw'}
                </button>
                <Link to="/referral" className="btn wl-btn-glass">Share Link</Link>
              </div>
            </div>
            <img className="wl-hero-img" src={heroImg} alt="" />
          </section>

          <h3 className="wl-h3">Referral Progress</h3>
          <p className="small muted" style={{ marginTop: -6, marginBottom: 10 }}>Track the progress of people who used your referral code.</p>
          <div className="wl-grid three">
            <StatTile icon="user" tone="slate" label="Pending" value={d.statuses.pending} />
            <StatTile icon="play" tone="blue" label="In Progress" value={d.statuses.inProgress} />
            <StatTile icon="check" tone="green" label="Completed" value={d.statuses.completed} />
          </div>
          <div className="wl-grid" style={{ marginTop: 12 }}>
            <StatTile icon="star" tone="gold" label="Reward per completed referral" value={money(d.rewardPerReferral.amount, d.rewardPerReferral.currency)} />
            <StatTile icon="wallet" tone="violet" label="Lifetime earned" value={money(d.wallet.lifetimeEarned, cur)} sub={`Withdrawn ${money(d.wallet.lifetimeWithdrawn, cur)}`} to="/referral/history" />
          </div>
        </>
      ) : null}
    </div>
  );
}

function txTitle(t: ReferralTx) {
  if (t.kind === 'REWARD') return t.counterpartyName ? `Reward — ${t.counterpartyName} subscribed` : 'Referral reward';
  if (t.kind === 'REVERSAL') return 'Returned to balance';
  return 'Withdrawal';
}

export function ReferralHistoryPage() {
  const { user } = useAuth();
  const list = useInfinite<ReferralTx>(user ? `referral:tx:${user.id}` : null, async (p) => {
    const r = await fetchReferralTransactions(p);
    return { items: r.items, hasMore: p * 20 < r.total };
  });
  const sentinel = useOnVisible(() => list.loadMore());
  return (
    <div className="wl-page">
      <PageHeader title="Referral History" back="/referral/earnings" />
      <SubNav active="history" />
      {list.error && list.items.length === 0 ? (
        <ErrorBox error={new Error("Couldn't load your referral history")} onRetry={list.reload} />
      ) : list.items.length === 0 && !list.loading ? (
        <div className="card">
          <Empty title="No referral activity yet">Rewards you earn and withdrawals you make will show up here.</Empty>
        </div>
      ) : (
        <div className="card wl-tx-list">
          {list.items.map((t, i) => {
            const credit = t.kind !== 'WITHDRAWAL';
            return (
              <div key={t.id || i} className="wl-tx">
                <span className={'wl-row-ic tone-' + (t.kind === 'REWARD' ? 'green' : t.kind === 'REVERSAL' ? 'blue' : 'violet')}>
                  <Icon name={t.kind === 'REWARD' ? 'star' : t.kind === 'REVERSAL' ? 'back' : 'send'} size={18} />
                </span>
                <div className="grow">
                  <div className="wl-tx-title">{txTitle(t)}</div>
                  <div className="tiny muted">
                    {fmtDate(t.createdAt)}
                    {t.kind === 'WITHDRAWAL' && t.fee ? ` · Fee ${money(t.fee, t.currency)}` : ''}
                    {t.kind === 'WITHDRAWAL' && t.payoutAmount && t.status === 'COMPLETED' ? ` · You received ${money(t.payoutAmount, t.currency)}` : ''}
                  </div>
                  {t.failureMessage && <div className="tiny" style={{ color: 'var(--err)' }}>{t.failureMessage}</div>}
                </div>
                <div className="wl-tx-right">
                  <div className={'wl-tx-amt ' + (credit ? 'pos' : 'neg')}>
                    {credit ? '+' : '-'}
                    {money(t.amount, t.currency)}
                  </div>
                  {t.kind === 'WITHDRAWAL' && <StatusPill status={t.status} paidLabel="Paid" />}
                </div>
              </div>
            );
          })}
          {list.loading && <Spinner />}
        </div>
      )}
      {list.hasMore && <div ref={sentinel} style={{ height: 1 }} />}
      {list.hasMore && !list.loading && list.items.length > 0 && (
        <div className="center" style={{ marginTop: 12 }}>
          <button className="btn btn-ghost btn-sm" onClick={list.loadMore}>Load more</button>
        </div>
      )}
    </div>
  );
}

/**
 * /wallet/withdraw — ConfirmWithdrawalScreen (earned / coins), ReferralWithdrawalScreen (referral),
 * BankInformationScreen (Paystack bank for Nigeria) and PendingWithdrawalsScreen in one page.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, navigate, useQueryParams } from '../../lib/router';
import { invalidate, useQuery } from '../../lib/query';
import { useAuth } from '../../lib/auth';
import { ErrorBox, Icon, PageHeader, Spinner, toast } from '../../ui/kit';
import { centerActive, fmtDate, StatusPill, StoreButtons, SubNav, useReferralDashboard, useWalletQueries } from './shared';
import {
  bankDisplay,
  bankRegion,
  BankPayload,
  fetchPaystackBanks,
  fetchReferralWithdrawals,
  fetchWithdrawalRequests,
  money,
  newReferralRequestId,
  PAYOUT_SETUP_CODES,
  ReferralRequestError,
  referralBreakdown,
  savePaystackAccount,
  submitCoinWithdrawal,
  submitEarnedWithdrawal,
  submitReferralWithdrawal,
  usd,
  verifyPaystackAccount,
} from './walletApi';

type Tab = 'earned' | 'coins' | 'referral' | 'bank';
const TABS: { id: Tab; label: string }[] = [
  { id: 'earned', label: 'Earned Balance' },
  { id: 'coins', label: 'Coin Balance' },
  { id: 'referral', label: 'Referral Rewards' },
  { id: 'bank', label: 'Bank Information' },
];
const COIN_FEE = 0.3; // Platform Fee (30%), as in the app
const COIN_MIN_USD = 3;

const cleanAmount = (v: string) => v.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1').replace(/^(\d*\.\d{0,2}).*$/, '$1').slice(0, 10);

function FeeRow({ label, value, tone, strong }: { label: string; value: string; tone?: 'neg' | 'pos'; strong?: boolean }) {
  return (
    <div className={'wl-fee-row' + (strong ? ' strong' : '')}>
      <span>{label}</span>
      <span className={tone ? 'wl-tx-amt ' + tone : ''}>{value}</span>
    </div>
  );
}

export function WithdrawPage() {
  const qp = useQueryParams();
  const initial = (qp.get('type') as Tab) || 'earned';
  const [tab, setTab] = useState<Tab>(TABS.some((t) => t.id === initial) ? initial : 'earned');
  const pendingRef = useRef<HTMLDivElement | null>(null);
  const segRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => centerActive(segRef.current), [tab]);
  useEffect(() => {
    const t = qp.get('type') as Tab;
    if (t && TABS.some((x) => x.id === t)) setTab(t);
    if (qp.get('section') === 'pending') setTimeout(() => pendingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
  }, [qp]);
  function pick(t: Tab) {
    setTab(t);
    navigate('/wallet/withdraw?type=' + t, { replace: true });
  }
  return (
    <div className="wl-page">
      <PageHeader title="Withdraw" back="/wallet" sub="Cash out your earnings, coins and referral rewards" />
      <SubNav active="withdraw" />
      <div ref={segRef} className="wl-seg" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : ''} onClick={() => pick(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="wl-cols">
        <div>
          {tab === 'earned' || tab === 'coins' ? <WalletWithdraw type={tab} onBank={() => pick('bank')} /> : tab === 'referral' ? <ReferralWithdraw onBank={() => pick('bank')} /> : <BankInfo />}
        </div>
        <div ref={pendingRef}>
          <PendingWithdrawals />
        </div>
      </div>
    </div>
  );
}

function PayoutAccount({ onBank }: { onBank: () => void }) {
  const { profile } = useWalletQueries();
  const bank = bankDisplay(profile.data?.bankDetails);
  return (
    <div className="wl-payout">
      <div className="wl-sub-h">Payout Account</div>
      {profile.loading && !profile.data ? (
        <div className="small muted">Loading…</div>
      ) : bank ? (
        <div className="row">
          <span className="wl-row-ic tone-green"><Icon name="wallet" size={18} /></span>
          <div className="grow">
            <b>{bank.bankName}</b>
            <div className="small muted">
              {bank.mask}
              {bank.holder ? ` · ${bank.holder}` : ''}
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onBank}>Change</button>
        </div>
      ) : (
        <button type="button" className="btn btn-ghost btn-block" onClick={onBank}>
          <Icon name="plus" size={18} /> Add Bank Account
        </button>
      )}
    </div>
  );
}

function WalletWithdraw({ type, onBank }: { type: 'earned' | 'coins'; onBank: () => void }) {
  const { uid, balance, coins, profile } = useWalletQueries();
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setAmount(''), [type]);
  const earned = balance.data?.earnedUSD ?? 0;
  const coinValue = coins.data?.valueUSD ?? 0;
  const coinCount = coins.data?.coins ?? 0;
  const max = type === 'earned' ? earned : coinValue;
  const a = parseFloat(amount) || 0;
  const fee = Math.round(a * COIN_FEE * 100) / 100;
  const payout = Math.round((a - fee) * 100) / 100;
  const coinsNeeded = Math.floor(a * 100 + 1e-6);
  const bank = bankDisplay(profile.data?.bankDetails);
  const method = bankRegion(profile.data?.address) === 'nigeria' ? 'PAYSTACK' : 'STRIPE';
  const aboveMin = type === 'coins' ? a >= COIN_MIN_USD : a > 0;
  const withinMax = a > 0 && a <= max + 1e-9;
  const can = aboveMin && withinMax && !!bank && !busy;
  const loading = (balance.loading && !balance.data) || (coins.loading && !coins.data);

  async function submit() {
    if (!can) return;
    setBusy(true);
    try {
      if (type === 'earned') await submitEarnedWithdrawal({ amount: a, withdrawalMethod: method });
      else await submitCoinWithdrawal({ coins: coinsNeeded, withdrawalMethod: method });
      toast.ok('Your withdrawal is being processed.');
      setAmount('');
      invalidate('wallet:');
    } catch (e: any) {
      toast.error(e?.message || 'Withdrawal Failed');
    } finally {
      setBusy(false);
    }
  }

  if (!uid) return null;
  return (
    <div className="card wl-form">
      <div className="wl-avail">
        <span className="small muted">{type === 'earned' ? 'Available earned balance' : 'Available coin balance'}</span>
        <span className="wl-avail-amt">{loading ? <span className="wl-skel" /> : type === 'earned' ? usd(earned) : `${coinCount.toLocaleString()} coins`}</span>
        {type === 'coins' && !loading && <span className="small muted">≈ {usd(coinValue)}</span>}
      </div>
      <label className="label" htmlFor="wd-amt">Withdrawal Amount (USD)</label>
      <div className="wl-amount">
        <span>$</span>
        <input id="wd-amt" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(cleanAmount(e.target.value))} />
        <button type="button" className="wl-max" onClick={() => setAmount(String(Math.floor(max * 100) / 100))} disabled={max <= 0}>MAX</button>
      </div>
      {a > 0 && !aboveMin && <div className="wl-warn">Minimum withdrawal is $3.00</div>}
      {a > max && max >= 0 && <div className="wl-warn">Amount exceeds available balance</div>}
      {type === 'coins' && a >= COIN_MIN_USD && a <= max && (
        <div className="wl-fees">
          <div className="wl-sub-h">Fee Breakdown</div>
          <FeeRow label="Gross" value={usd(a)} />
          <FeeRow label="Platform Fee (30%)" value={'-' + usd(fee)} tone="neg" />
          <FeeRow label="You Receive" value={usd(payout)} tone="pos" strong />
          <div className="tiny muted" style={{ marginTop: 6 }}>{coinsNeeded.toLocaleString()} coins will be withdrawn.</div>
        </div>
      )}
      <PayoutAccount onBank={onBank} />
      <button className="btn btn-block btn-dark wl-submit" disabled={!can} onClick={submit}>
        {busy ? 'Processing…' : 'Confirm Withdrawal'}
      </button>
      {!bank && !profile.loading && <div className="tiny muted center" style={{ marginTop: 8 }}>Add a payout account to withdraw.</div>}
    </div>
  );
}

function ReferralWithdraw({ onBank }: { onBank: () => void }) {
  const q = useReferralDashboard();
  const d = q.data;
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [setupMsg, setSetupMsg] = useState('');
  const reqId = useRef<string | null>(null);
  const currency = d?.wallet.currency ?? 'USD';
  const available = d?.wallet.availableBalance ?? 0;
  const a = Number(amount) || 0;
  const feePercent = d?.withdrawalFeePercent ?? 10;
  const { fee, payoutAmount } = referralBreakdown(a, feePercent);
  const provider = d?.payout.provider ?? (currency === 'NGN' ? 'PAYSTACK' : 'STRIPE');
  const ready = d?.payout.ready !== false && !setupMsg;
  const tooSmall = a > 0 && payoutAmount <= 0;
  const can = a > 0 && a <= available && ready && !tooSmall && !busy;

  async function submit() {
    if (!can) return;
    const id = reqId.current ?? newReferralRequestId();
    reqId.current = id;
    setBusy(true);
    try {
      const r = await submitReferralWithdrawal({ amount: a, clientRequestId: id });
      reqId.current = null;
      toast.ok(r.status === 'COMPLETED' ? 'Withdrawal sent to your account' : "Withdrawal is processing. We'll update it once your bank confirms.");
      setAmount('');
      invalidate('referral:');
    } catch (e: any) {
      // Server answered with a code → request finished, next tap is a new request. No code (network) → keep id so a retry can't pay twice.
      if (e instanceof ReferralRequestError && e.code) {
        reqId.current = null;
        invalidate('referral:');
        if (PAYOUT_SETUP_CODES.includes(e.code)) {
          setSetupMsg(e.message);
          return;
        }
      }
      toast.error(e?.message || 'Referral withdrawal failed');
    } finally {
      setBusy(false);
    }
  }

  if (q.loading && !d) return <div className="card"><Spinner /></div>;
  if (q.error && !d) return <ErrorBox error={new Error('Could not load your referral earnings.')} onRetry={q.refetch} />;
  return (
    <div className="card wl-form">
      <div className="wl-avail">
        <span className="small muted">Available referral balance</span>
        <span className="wl-avail-amt">{money(available, currency)}</span>
        {d && d.wallet.pendingWithdrawalBalance > 0 && <span className="small muted">Pending withdrawals: {money(d.wallet.pendingWithdrawalBalance, currency)}</span>}
      </div>
      <label className="label" htmlFor="rw-amt">Amount to withdraw</label>
      <div className="wl-amount">
        <span>{currency === 'NGN' ? '₦' : '$'}</span>
        <input id="rw-amt" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => { setAmount(cleanAmount(e.target.value)); reqId.current = null; }} />
        <button type="button" className="wl-max" disabled={available <= 0} onClick={() => { setAmount(String(Math.floor(available * 100) / 100)); reqId.current = null; }}>MAX</button>
      </div>
      {a > available ? <div className="wl-warn">The amount exceeds your available balance.</div> : tooSmall ? <div className="wl-warn">This amount is too small after the withdrawal fee.</div> : null}
      <div className="wl-fees">
        <FeeRow label={`Withdrawal fee (${feePercent}%)`} value={'-' + money(fee, currency)} tone="neg" />
        <FeeRow label="You receive" value={money(payoutAmount, currency)} tone="pos" strong />
        <div className="tiny muted" style={{ marginTop: 6 }}>
          {provider === 'PAYSTACK'
            ? `A ${feePercent}% fee is deducted from every withdrawal you make. The rest is sent to your verified bank account through Paystack.`
            : `A ${feePercent}% fee is deducted from every withdrawal you make. The rest is sent to your connected Stripe account.`}
        </div>
      </div>
      {!ready && (
        <div className="wl-setup">
          <b>{provider === 'PAYSTACK' ? 'Add your bank account to withdraw' : 'Set up payouts to withdraw'}</b>
          <div className="small muted" style={{ margin: '4px 0 10px' }}>
            {setupMsg ||
              (provider === 'PAYSTACK'
                ? "Referral earnings are paid into a verified Nigerian bank account. Add yours once and you're ready."
                : "Referral earnings are paid to your connected Stripe account. Set it up once and you're ready.")}
          </div>
          {provider === 'PAYSTACK' ? (
            <button className="btn btn-sm" onClick={() => { setSetupMsg(''); onBank(); }}>Set up payout account</button>
          ) : (
            <>
              <div className="small muted" style={{ marginBottom: 8 }}>Stripe payout setup is done in the i'llTip app.</div>
              <StoreButtons />
            </>
          )}
        </div>
      )}
      <button className="btn btn-block btn-dark wl-submit" disabled={!can} onClick={submit}>
        {busy ? 'Processing…' : 'Confirm Withdrawal'}
      </button>
      <div className="center small" style={{ marginTop: 10 }}>
        <Link to="/referral/history">Referral history</Link>
      </div>
    </div>
  );
}

function BankInfo() {
  const { uid, profile } = useWalletQueries();
  const region = bankRegion(profile.data?.address);
  const hasAddress = !!profile.data?.address?.trim();
  const saved = profile.data?.bankDetails?.bank_account;
  const banks = useQuery(region === 'nigeria' && uid ? 'wallet:paystack-banks' : null, fetchPaystackBanks, { staleMs: 3600_000 });
  const [bankCode, setBankCode] = useState('');
  const [acct, setAcct] = useState('');
  const [name, setName] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('');
  const failedKey = useRef<string | null>(null);
  const verifiedKey = useRef<string | null>(null);
  const prefilled = useRef(false);

  useEffect(() => {
    if (prefilled.current || region !== 'nigeria' || !saved?.bank_code || !saved.account_number) return;
    prefilled.current = true;
    setBankCode(String(saved.bank_code));
    setAcct(String(saved.account_number));
    if (saved.account_name) {
      setName(saved.account_name);
      verifiedKey.current = `${saved.bank_code}:${saved.account_number}`;
    }
  }, [region, saved]);

  const bankName = useMemo(() => banks.data?.find((b) => b.code === bankCode)?.name ?? '', [banks.data, bankCode]);
  const payload: BankPayload | null = bankCode && acct.length === 10 && bankName ? { currency: 'NGN', type: 'nuban', name: bankName, account_number: acct, bank_code: bankCode } : null;

  // Auto-verify the account name 1s after the bank + 10-digit number are entered (same as the app).
  useEffect(() => {
    if (region !== 'nigeria') return;
    const key = `${bankCode}:${acct}`;
    if (!payload) {
      setName('');
      verifiedKey.current = null;
      return;
    }
    if (verifiedKey.current === key || failedKey.current === key) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setVerifying(true);
      try {
        const n = await verifyPaystackAccount(payload);
        if (cancelled) return;
        setName(n);
        if (n) {
          verifiedKey.current = key;
          failedKey.current = null;
        } else failedKey.current = key;
      } catch {
        if (cancelled) return;
        setName('');
        failedKey.current = key;
        toast.error('Could not verify this account. Check your bank and account number.');
      } finally {
        if (!cancelled) setVerifying(false);
      }
    }, 1000);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankCode, acct, bankName, region]);

  async function save() {
    if (!payload || !name) return toast.error('Select a bank, enter a valid account number, and wait for verification.');
    setSaving(true);
    try {
      await savePaystackAccount(payload);
      toast.ok('Bank account saved successfully');
      invalidate('wallet:profile');
    } catch {
      toast.error('Could not save bank account. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (profile.loading && !profile.data) return <div className="card"><Spinner /></div>;
  if (profile.error) return <ErrorBox error={profile.error} onRetry={profile.refetch} />;

  const current = bankDisplay(profile.data?.bankDetails);
  const shownBanks = (banks.data || []).filter((b) => !filter.trim() || b.name.toLowerCase().includes(filter.trim().toLowerCase()) || b.code === bankCode);

  return (
    <div className="card wl-form">
      <div className="wl-sub-h" style={{ fontSize: 16 }}>Add your bank information</div>
      <p className="small muted" style={{ marginTop: 2 }}>Your bank information is securely stored with us!</p>
      {current && (
        <div className="wl-current-bank">
          <span className="wl-row-ic tone-green"><Icon name="check" size={18} /></span>
          <div className="grow">
            <b>{current.bankName}</b>
            <div className="small muted">{current.mask}{current.holder ? ` · ${current.holder}` : ''}</div>
          </div>
          <span className="wl-pill ok">On file</span>
        </div>
      )}
      {!hasAddress ? (
        <div className="wl-setup">
          <b>Address required</b>
          <div className="small muted" style={{ margin: '4px 0 10px' }}>
            Please update your profile with a full address (including your country) so we can show the right bank setup form.
          </div>
          <Link to="/profile" className="btn btn-sm">Update Profile</Link>
        </div>
      ) : region === 'nigeria' ? (
        <>
          <div className="field">
            <label className="label" htmlFor="bk-bank">Bank</label>
            {banks.loading && !banks.data ? (
              <div className="input muted">Loading banks…</div>
            ) : banks.error ? (
              <ErrorBox error={new Error('Failed to load banks')} onRetry={banks.refetch} />
            ) : (
              <>
                {(banks.data?.length || 0) > 12 && <input className="input" style={{ marginBottom: 8 }} placeholder="Search banks…" value={filter} onChange={(e) => setFilter(e.target.value)} />}
                <select id="bk-bank" className="select" value={bankCode} onChange={(e) => { setBankCode(e.target.value); setName(''); }}>
                  <option value="">Select your bank</option>
                  {shownBanks.map((b) => (
                    <option key={b.code} value={b.code}>{b.name}</option>
                  ))}
                </select>
              </>
            )}
          </div>
          <div className="field">
            <label className="label" htmlFor="bk-acct">Account Number</label>
            <input id="bk-acct" className="input wl-mono" inputMode="numeric" maxLength={10} placeholder="Enter 10-digit account number" value={acct} onChange={(e) => { setAcct(e.target.value.replace(/\D/g, '').slice(0, 10)); setName(''); }} />
          </div>
          <div className="field">
            <span className="label">Account Name</span>
            <div className={'input wl-acct-name' + (name ? ' ok' : '')}>
              {verifying ? 'Verifying…' : name || <span className="muted">Appears after we verify the account</span>}
            </div>
          </div>
          <button className="btn btn-block btn-dark wl-submit" disabled={saving || verifying || !payload || !name} onClick={save}>
            {saving ? 'Saving…' : 'Confirm'}
          </button>
        </>
      ) : (
        <div className="wl-setup">
          <b>{current ? 'Change your US payout account in the app' : 'Set up US bank payouts in the app'}</b>
          <div className="small muted" style={{ margin: '4px 0 10px' }}>
            Direct-deposit setup (bank, identity and Stripe verification) is completed in the i'llTip app. Once it's done, your payout account shows here and you can withdraw from the web.
          </div>
          <StoreButtons />
        </div>
      )}
    </div>
  );
}

function PendingWithdrawals() {
  const { user } = useAuth();
  const uid = user?.id || '';
  const w = useQuery(uid ? `wallet:withdrawals:${uid}` : null, () => fetchWithdrawalRequests(1));
  const r = useQuery(uid ? `referral:withdrawals:${uid}` : null, () => fetchReferralWithdrawals(1));
  const rows = useMemo(() => {
    const a = (w.data?.items || [])
      .filter((x) => x.status === 'PENDING' || x.status === 'PROCESSING')
      .map((x) => ({
        id: 'w' + x.requestId,
        title: x.coins ? 'Coin Withdrawal' : 'Earned Withdrawal',
        amount: usd(x.payoutUSD ?? x.amount?.USD ?? 0),
        method: x.withdrawalMethod,
        date: Number(x.requestedAt) || 0,
        status: x.status,
      }));
    const b = (r.data?.items || [])
      .filter((x) => ['PENDING', 'PROCESSING', 'PROVIDER_ACCEPTED'].includes(x.status))
      .map((x) => ({ id: 'r' + x.requestId, title: 'Referral Withdrawal', amount: money(x.payoutAmount || x.amount, x.currency), method: x.provider, date: new Date(x.createdAt).getTime() || 0, status: x.status }));
    return [...a, ...b].sort((x, y) => y.date - x.date);
  }, [w.data, r.data]);
  const loading = (w.loading && !w.data) || (r.loading && !r.data);
  return (
    <div className="card">
      <div className="row between">
        <div className="wl-sub-h" style={{ margin: 0 }}>Pending Withdrawals</div>
        {rows.length > 0 && <span className="wl-pill warn">{rows.length}</span>}
      </div>
      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <div className="wl-empty-mini">
          <Icon name="check" size={22} />
          <div>
            <b>No Pending Withdrawals</b>
            <div className="small muted">Withdrawals you submit will appear here while they are being processed.</div>
          </div>
        </div>
      ) : (
        <div className="wl-tx-list" style={{ marginTop: 8 }}>
          {rows.map((x) => (
            <div key={x.id} className="wl-tx">
              <div className="grow">
                <div className="wl-tx-title">{x.title}</div>
                <div className="tiny muted">
                  {x.method ? `${x.method} · ` : ''}Requested {fmtDate(x.date)}
                </div>
              </div>
              <div className="wl-tx-right">
                <div className="wl-tx-amt">{x.amount}</div>
                <StatusPill status={x.status} />
              </div>
            </div>
          ))}
        </div>
      )}
      {(w.error || r.error) && !loading && <div className="tiny muted" style={{ marginTop: 8 }}>Some withdrawals couldn't be loaded.</div>}
    </div>
  );
}

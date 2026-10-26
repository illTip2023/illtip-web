/**
 * Wallet, coins, referral and bank endpoints, mirroring illtip-mobile:
 * src/services/walletApi.ts, coins.ts, referralApi.ts, bankApi.ts, src/hooks/useProfileQuery.ts (fetchProfile).
 */
import { api, ApiError } from '../../lib/api';

const isRec = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : 0);

export type Currency = 'NGN' | 'USD';
export function money(amount: number, currency: Currency = 'USD') {
  if (currency === 'NGN') return `₦${Math.round(amount).toLocaleString('en-NG')}`;
  return `$${(Number(amount) || 0).toFixed(2)}`;
}
export const usd = (n: number) => money(n, 'USD');

// ---------------- wallet / coins ----------------
export type WalletBalance = { earnedUSD: number; totalEarningsUSD: number; pendingWithdrawalsUSD: number; pendingWithdrawalsCount: number };
export async function fetchWalletBalance(): Promise<WalletBalance> {
  const { data } = await api.get('/wallet/balance');
  const d = isRec(data) && data.success === true && isRec(data.data) ? data.data : {};
  return {
    earnedUSD: num(d.balance?.USD),
    totalEarningsUSD: num(d.totalEarnings?.USD),
    pendingWithdrawalsUSD: num(d.pendingWithdrawals?.USD),
    pendingWithdrawalsCount: num(d.pendingWithdrawals?.requests),
  };
}

export type CoinBalance = { coins: number; valueUSD: number };
export async function fetchCoinBalance(): Promise<CoinBalance> {
  const { data } = await api.get('/coins/balance');
  const d = isRec(data?.data) ? (isRec(data.data.data) ? data.data.data : data.data) : data;
  const coins = num(d?.coinBalance ?? d?.balance);
  return { coins, valueUSD: Math.round(coins) / 100 };
}

export type WithdrawalRequest = {
  requestId: string;
  amount?: { USD?: number };
  withdrawalMethod: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | string;
  requestedAt: number;
  coins?: number;
  grossUSD?: number;
  payoutUSD?: number;
  platformFeeUSD?: number;
};
export async function fetchWithdrawalRequests(page = 1): Promise<{ items: WithdrawalRequest[]; total: number }> {
  const { data } = await api.get('/wallet/withdrawals', { params: { page, limit: 20 } });
  if (!isRec(data) || data.success !== true) return { items: [], total: 0 };
  const list = Array.isArray(data.data) ? data.data : [];
  return { items: list, total: num(data.pagination?.total) || list.length };
}

export type WalletTx = { transactionId?: string; transactionType: 'CREDIT' | 'DEBIT'; amount?: { usdEquivalent?: number }; status?: string; createdAt?: number };
export async function fetchWalletTransactions(page = 1): Promise<{ items: WalletTx[]; total: number }> {
  const { data } = await api.get('/wallet/transactions', { params: { page, limit: 20 } });
  if (!isRec(data) || data.success !== true) return { items: [], total: 0 };
  const list = Array.isArray(data.data) ? data.data : [];
  return { items: list, total: num(data.pagination?.total) || list.length };
}

export type CoinTx = { type: 'purchase' | 'withdrawal' | 'earned' | 'spend'; coins: number; payoutUSD?: number; status?: string; createdTime: number; requestId?: string };
export async function fetchCoinHistory(pageIndex = 1): Promise<{ items: CoinTx[]; total: number }> {
  const { data } = await api.get('/coins/history', { params: { pageIndex, pageSize: 20 } });
  if (!isRec(data) || data.success !== true) return { items: [], total: 0 };
  const d = isRec(data.data) ? data.data : {};
  const list = Array.isArray(d.transactions) ? d.transactions : [];
  return { items: list, total: num(d.totalCount) || list.length };
}

function envelopeError(data: any, fallback: string) {
  return isRec(data) && typeof data.message === 'string' && data.message ? data.message : fallback;
}

export async function submitEarnedWithdrawal(p: { amount: number; withdrawalMethod: 'STRIPE' | 'PAYSTACK' }) {
  const { data } = await api.post('/wallet/withdraw', { ...p, accountDetails: {} });
  if (!isRec(data) || data.success !== true) throw new Error(envelopeError(data, 'Withdrawal failed'));
}
export async function submitCoinWithdrawal(p: { coins: number; withdrawalMethod: 'STRIPE' | 'PAYSTACK' }) {
  const { data } = await api.post('/coins/withdraw', { ...p, accountDetails: {} });
  if (!isRec(data) || data.success !== true) throw new Error(envelopeError(data, 'Coin withdrawal failed'));
  const d = isRec(data.data) ? data.data : {};
  return { grossUSD: num(d.grossUSD), platformFeeUSD: num(d.platformFeeUSD), payoutUSD: num(d.payoutUSD) };
}

// ---------------- profile (reward balance, address, bank details) ----------------
export type PaystackBankDetails = { bank_account?: { account_number?: string; account_name?: string; bank_code?: string; bank_name?: string } };
export type StripeBankDetails = { bank_account?: { last4?: string; name?: string; account_holder_name?: string } };
export type WalletProfile = { reward: number; address: string; bankDetails?: PaystackBankDetails & StripeBankDetails };
export async function fetchWalletProfile(userId: string): Promise<WalletProfile> {
  const { data } = await api.get('/user/profile', { params: { userId } });
  const u = isRec(data) && data.success === true && isRec(data.data) ? data.data : {};
  return { reward: num(u.reward), address: typeof u.address === 'string' ? u.address : '', bankDetails: isRec(u.bankDetails) ? u.bankDetails : undefined };
}
/** src/utils/bankCountry.ts: Nigeria → Paystack, everything else → Stripe. */
export const bankRegion = (address?: string) => (address && address.toLowerCase().includes('nigeria') ? 'nigeria' : 'stripe');
export function bankDisplay(b?: WalletProfile['bankDetails']): { bankName: string; mask: string; holder?: string } | null {
  const a = b?.bank_account;
  if (!a) return null;
  if ('account_number' in a && (a.bank_name || a.account_number)) return { bankName: a.bank_name || 'Bank', mask: '**** ' + (a.account_number?.slice(-4) || '****'), holder: a.account_name };
  if (a.name || a.last4) return { bankName: a.name || 'Bank', mask: '**** ' + (a.last4 || '****'), holder: a.account_holder_name };
  return null;
}

// ---------------- Paystack bank (BankInformationScreen, Nigeria) ----------------
export type PaystackBank = { name: string; code: string };
export async function fetchPaystackBanks(): Promise<PaystackBank[]> {
  const { data } = await api.get('/paystack/bank-list', { params: { currency: 'NGN' } });
  if (!isRec(data) || data.success !== true) throw new Error('Failed to load banks');
  const seen = new Set<string>();
  return (Array.isArray(data.result) ? data.result : [])
    .filter((b: any) => isRec(b) && typeof b.name === 'string' && (typeof b.code === 'string' || typeof b.code === 'number'))
    .map((b: any) => ({ name: b.name, code: String(b.code) }))
    .filter((b: PaystackBank) => (seen.has(b.code) ? false : (seen.add(b.code), true)));
}
export type BankPayload = { currency: 'NGN'; type: 'nuban'; name: string; account_number: string; bank_code: string };
export async function verifyPaystackAccount(p: BankPayload): Promise<string> {
  const { data } = await api.post('/paystack/paystack-bank-info', p);
  if (!isRec(data) || data.success !== true || !isRec(data.result)) throw new Error(envelopeError(data, 'Bank account verification failed'));
  return String(data.result.bank_account?.account_name ?? '');
}
export async function savePaystackAccount(p: BankPayload) {
  const { data } = await api.post('/paystack/add-bank-account', p);
  if (!isRec(data) || data.success !== true) throw new Error(envelopeError(data, 'Failed to save bank account'));
}

// ---------------- referrals ----------------
export type ReferralDashboard = {
  referralCode: string;
  referralUrl: string;
  attribution: { hasReferrer: boolean; referralCodeUsed?: string; status?: string };
  statuses: { pending: number; inProgress: number; completed: number };
  rewardPerReferral: { amount: number; currency: Currency };
  withdrawalFeePercent: number;
  payout: { provider: 'PAYSTACK' | 'STRIPE'; ready: boolean };
  wallet: { currency: Currency; availableBalance: number; pendingWithdrawalBalance: number; lifetimeEarned: number; lifetimeWithdrawn: number };
};
export const DEFAULT_REFERRAL_FEE_PERCENT = 10;
export const PAYOUT_SETUP_CODES = ['PAYSTACK_BANK_DETAILS_REQUIRED', 'STRIPE_ACCOUNT_REQUIRED', 'STRIPE_ACCOUNT_NOT_FOUND', 'STRIPE_PAYOUTS_NOT_ENABLED'];
const cur = (v: unknown): Currency => (v === 'NGN' ? 'NGN' : 'USD');

export async function fetchReferralDashboard(): Promise<ReferralDashboard> {
  const { data: env } = await api.get('/referrals/me');
  if (!env?.success || !isRec(env.data)) throw new Error(envelopeError(env, 'Could not load your referral earnings.'));
  const d = env.data;
  if (!d.referralCode || !d.referralUrl) throw new Error('Referral link is unavailable');
  const w = isRec(d.wallet) ? d.wallet : {};
  const fee = Number(d.withdrawalFeePercent);
  const wc = cur(w.currency);
  return {
    referralCode: String(d.referralCode),
    referralUrl: String(d.referralUrl),
    attribution: {
      hasReferrer: d.attribution?.hasReferrer === true,
      referralCodeUsed: typeof d.attribution?.referralCodeUsed === 'string' ? d.attribution.referralCodeUsed : undefined,
      status: typeof d.attribution?.status === 'string' ? d.attribution.status : undefined,
    },
    statuses: { pending: num(d.statuses?.pending), inProgress: num(d.statuses?.inProgress), completed: num(d.statuses?.completed) },
    rewardPerReferral: { amount: num(d.rewardPerReferral?.amount), currency: cur(d.rewardPerReferral?.currency) },
    withdrawalFeePercent: Number.isFinite(fee) && fee >= 0 && fee < 100 ? fee : DEFAULT_REFERRAL_FEE_PERCENT,
    payout: isRec(d.payout)
      ? { provider: d.payout.provider === 'PAYSTACK' || d.payout.provider === 'STRIPE' ? d.payout.provider : wc === 'NGN' ? 'PAYSTACK' : 'STRIPE', ready: d.payout.ready !== false }
      : { provider: wc === 'NGN' ? 'PAYSTACK' : 'STRIPE', ready: true },
    wallet: {
      currency: wc,
      availableBalance: num(w.availableBalance),
      pendingWithdrawalBalance: num(w.pendingWithdrawalBalance),
      lifetimeEarned: num(w.lifetimeEarned),
      lifetimeWithdrawn: num(w.lifetimeWithdrawn),
    },
  };
}

export async function applyReferralCode(code: string) {
  const { data: env } = await api.post('/referrals/apply-code', { referralCode: code.trim().toUpperCase() });
  if (!env?.success) throw new Error(envelopeError(env, 'Could not apply referral code'));
  return env.data;
}

export type ReferralWithdrawal = {
  requestId: string;
  amount: number;
  currency: Currency;
  fee: number;
  payoutAmount: number;
  provider: 'PAYSTACK' | 'STRIPE';
  status: 'PENDING' | 'PROCESSING' | 'PROVIDER_ACCEPTED' | 'COMPLETED' | 'FAILED' | 'REVERSED';
  createdAt: string;
  failureMessage?: string;
};
export type ReferralTx = {
  id: string;
  kind: 'REWARD' | 'WITHDRAWAL' | 'REVERSAL';
  amount: number;
  currency: Currency;
  createdAt: string;
  status?: ReferralWithdrawal['status'];
  fee?: number;
  payoutAmount?: number;
  failureMessage?: string;
  counterpartyName?: string;
};

export async function fetchReferralWithdrawals(page = 1): Promise<{ items: ReferralWithdrawal[]; total: number }> {
  const { data: env } = await api.get('/referrals/withdrawals', { params: { page, limit: 20 } });
  if (!env?.success) throw new Error(envelopeError(env, 'Could not load referral withdrawals'));
  const list = Array.isArray(env.data) ? env.data : [];
  return { items: list, total: num(env.pagination?.total) || list.length };
}

/** GET /referrals/transactions (as the app). Falls back to the withdrawals list on servers that don't have it yet. */
export async function fetchReferralTransactions(page = 1): Promise<{ items: ReferralTx[]; total: number }> {
  try {
    const { data: env } = await api.get('/referrals/transactions', { params: { page, limit: 20 } });
    if (!env?.success) throw new Error(envelopeError(env, "Couldn't load your referral history"));
    const list = Array.isArray(env.data) ? env.data : [];
    return { items: list, total: num(env.pagination?.total) || list.length };
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      const w = await fetchReferralWithdrawals(page);
      return {
        total: w.total,
        items: w.items.map((x) => ({ id: x.requestId, kind: 'WITHDRAWAL', amount: x.amount, currency: x.currency, createdAt: x.createdAt, status: x.status, fee: x.fee, payoutAmount: x.payoutAmount, failureMessage: x.failureMessage })),
      };
    }
    throw e;
  }
}

export class ReferralRequestError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}
export async function submitReferralWithdrawal(p: { amount: number; clientRequestId: string }): Promise<ReferralWithdrawal> {
  let env: any;
  try {
    env = (await api.post('/referrals/withdraw', p)).data;
  } catch (e) {
    if (e instanceof ApiError && e.data) throw new ReferralRequestError(envelopeError(e.data, 'Referral withdrawal failed'), e.data?.data?.code ?? 'HTTP_' + e.status);
    throw e;
  }
  if (!env?.success || !env.data) throw new ReferralRequestError(envelopeError(env, 'Referral withdrawal failed'), env?.data?.code);
  if (env.data.status === 'FAILED') throw new ReferralRequestError(env.data.failureMessage || 'Referral withdrawal failed', 'REFERRAL_PAYOUT_FAILED');
  return env.data;
}
export const newReferralRequestId = () => `referral_${Date.now()}_` + Math.random().toString(36).slice(2, 12);
export function referralBreakdown(amount: number, feePercent: number) {
  const a = Number.isFinite(amount) && amount > 0 ? amount : 0;
  const fee = Math.round(((a * feePercent) / 100) * 100) / 100;
  return { fee, payoutAmount: Math.round((a - fee) * 100) / 100 };
}

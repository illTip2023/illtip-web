import type { RouteDef } from '../../lib/router';
import { TransactionsPage, WalletPage } from './WalletPages';
import { WithdrawPage } from './WithdrawPage';
import { ReferralEarningsPage, ReferralHistoryPage, ReferralPage } from './ReferralPages';

/** Routes owned by the wallet feature (all require login and render inside the app shell). */
export const routes: RouteDef[] = [
  { path: '/wallet', element: WalletPage, auth: true },
  { path: '/wallet/transactions', element: TransactionsPage, auth: true },
  { path: '/wallet/withdraw', element: WithdrawPage, auth: true },
  { path: '/referral', element: ReferralPage, auth: true },
  { path: '/referral/earnings', element: ReferralEarningsPage, auth: true },
  { path: '/referral/history', element: ReferralHistoryPage, auth: true },
];

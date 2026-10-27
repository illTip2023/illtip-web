import type { RouteDef } from '../../lib/router';
import './coins.css';
import { CoinsPaystackCallbackPage, CoinsStripeReturnPage } from './ReturnPages';

/**
 * Coin top-up return pages. /coins/paystack-callback must stay as-is: it is the backend's default
 * Paystack callback_url for coins (FRONTEND_URL + "coins/paystack-callback", coinController.js).
 */
export const routes: RouteDef[] = [
  { path: '/coins/paystack-callback', element: CoinsPaystackCallbackPage, auth: true },
  { path: '/coins/stripe-return', element: CoinsStripeReturnPage, auth: true },
];

import type { RouteDef } from '../../lib/router';
import './plans.css';
import { PlansPage } from './PlansPage';
import { CheckoutPage } from './CheckoutPage';
import { PaystackCallbackPage, StripeReturnPage } from './ReturnPages';

/**
 * Subscription plans + checkout (ChooseYourPlan / PaymentPlans / SubscriptionCheckout in the app).
 * The two /subscriptions/* paths are where Stripe (return_url) and Paystack (backend callback_url =
 * FRONTEND_URL + "subscriptions/paystack-callback") send the browser back, so they must stay as-is.
 */
export const routes: RouteDef[] = [
  { path: '/plans', element: PlansPage, auth: true },
  { path: '/plans/checkout', element: CheckoutPage, auth: true },
  { path: '/subscriptions/stripe-return', element: StripeReturnPage, auth: true },
  { path: '/subscriptions/paystack-callback', element: PaystackCallbackPage, auth: true },
];

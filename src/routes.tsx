/** All app routes. Each feature owns src/features/<name>/routes.tsx; order matters (first match wins). */
import type { RouteDef } from './lib/router';
import { href } from './lib/router';

import { InformationPage, ReferralPage as ReferralLandingPage } from './features/legacy/LegacyPages';
import { ReferralPage as WalletReferralPage } from './features/wallet/ReferralPages';
import { Shell } from './ui/Shell';
import { useAuth } from './lib/auth';
import { navigate, useLocation } from './lib/router';
import React, { useEffect } from 'react';

/** /referral?code=X is the public invite page (old site); plain /referral is the signed-in user's "Refer & earn" page. */
function ReferralRoute() {
  const { session } = useAuth();
  const { full } = useLocation();
  const hasCode = new URLSearchParams(location.search).has('code');
  useEffect(() => {
    if (!hasCode && !session) navigate('/login?next=' + encodeURIComponent(full), { replace: true });
  }, [hasCode, session, full]);
  if (hasCode) return <ReferralLandingPage />;
  if (!session) return null;
  return (
    <Shell>
      <WalletReferralPage />
    </Shell>
  );
}
import { routes as auth } from './features/auth/routes';
import { routes as home } from './features/home/routes';
import { routes as jobs } from './features/jobs/routes';
import { routes as hirepros } from './features/hirepros/routes';
import { routes as chat } from './features/chat/routes';
import { routes as profile } from './features/profile/routes';
import { routes as notifications } from './features/notifications/routes';
import { routes as wallet } from './features/wallet/routes';
import { routes as settings } from './features/settings/routes';
import { routes as plans } from './features/plans/routes';
import { routes as coins } from './features/coins/routes';

export const ROUTES: RouteDef[] = [{ path: '/information', element: InformationPage, auth: false, chrome: false }, { path: '/referral', element: ReferralRoute, auth: false, chrome: false }, ...auth, ...jobs, ...hirepros, ...chat, ...profile, ...notifications, ...wallet, ...settings, ...plans, ...coins, ...home];

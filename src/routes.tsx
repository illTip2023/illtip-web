/** All app routes. Each feature owns src/features/<name>/routes.tsx; order matters (first match wins). */
import type { RouteDef } from './lib/router';
import { href } from './lib/router';

import { InformationPage, ReferralPage } from './features/legacy/LegacyPages';
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

export const ROUTES: RouteDef[] = [{ path: '/information', element: InformationPage, auth: false, chrome: false }, { path: '/referral', element: ReferralPage, auth: false, chrome: false }, ...auth, ...jobs, ...hirepros, ...chat, ...profile, ...notifications, ...wallet, ...settings, ...plans, ...home];

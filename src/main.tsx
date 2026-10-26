import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { AuthProvider, useAuth } from './lib/auth';
import { installLinkInterceptor, navigate, resolveRoute, RouteView, useLocation } from './lib/router';
import { ROUTES } from './routes';
import { Shell } from './ui/Shell';
import { Empty, Toaster } from './ui/kit';

function NotFound() {
  return (
    <Empty title="Page not found">
      <a href="#/">Go to the home page</a>
    </Empty>
  );
}

/** Old www.illtip.com links (shared from the app and around the web) → new routes. */
function legacyRedirect(pathname: string, search: string): string | null {
  const q = new URLSearchParams(search);
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p === '/job-detail' && q.get('serviceRequestId')) return '/jobs/' + encodeURIComponent(q.get('serviceRequestId')!);
  if ((p === '/home-detail' || p === '/postAction') && q.get('postId')) return '/post/' + encodeURIComponent(q.get('postId')!);
  if ((p === '/profile-detail' || p === '/friendsProfile') && q.get('userId')) return '/u/' + encodeURIComponent(q.get('userId')!);
  if (p === '/referral' && q.get('code')) return '/register?ref=' + encodeURIComponent(q.get('code')!);
  if (p === '/serviceRequest' && q.get('id')) return '/jobs/' + encodeURIComponent(q.get('id')!);
  if (p.startsWith('/serviceRequest/')) return '/jobs/' + p.split('/')[2];
  const map: Record<string, string> = {
    '/splash': '/', '/home': '/', '/signup': '/register', '/signUp': '/register', '/loginWithPass': '/login', '/otp': '/verify-email',
    '/recover': '/forgot-password', '/recovery-update': '/forgot-password', '/privacyPolicy': '/settings/privacy', '/faq': '/settings/faq',
    '/help': '/settings/help', '/contactus': '/settings/help', '/notification': '/notifications', '/chat': '/chat', '/profile': '/profile',
    '/updateProfile': '/profile/edit', '/myWallet': '/wallet', '/contractor-wallet': '/wallet', '/rewardHistory': '/referral/history',
    '/withdrawal-request': '/wallet/withdraw', '/requestService': '/hire/request', '/serviceType': '/hire', '/employer': '/hire',
    '/myFriends': '/profile/network', '/search': '/search', '/serviceRequestApplyed': '/jobs', '/subscription-plans': '/settings',
  };
  if (map[p] && map[p] !== p) return map[p];
  if (p.startsWith('/search/')) return '/search?q=' + encodeURIComponent(decodeURIComponent(p.slice(8)));
  return null;
}

function App() {
  const { pathname, search, full } = useLocation();
  const legacy = legacyRedirect(pathname, search);
  useEffect(() => {
    if (legacy) navigate(legacy, { replace: true });
  }, [legacy]);
  const { session } = useAuth();
  const hit = resolveRoute(ROUTES, pathname);
  const needsAuth = hit ? hit.route.auth !== false && hit.route.chrome !== false : true;

  useEffect(() => {
    if (!legacy && needsAuth && !session) navigate('/login?next=' + encodeURIComponent(full), { replace: true });
  }, [legacy, needsAuth, session, full]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  if (legacy) return null;
  if (needsAuth && !session) return null;
  if (!hit) return <Shell><NotFound /></Shell>;
  if (hit.route.chrome === false) return <RouteView route={hit.route} params={hit.params} />;
  return (
    <Shell>
      <RouteView route={hit.route} params={hit.params} />
    </Shell>
  );
}

installLinkInterceptor();
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
      <Toaster />
    </AuthProvider>
  </React.StrictMode>
);

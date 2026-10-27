import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { AuthProvider, useAuth } from './lib/auth';
import { installLinkInterceptor, navigate, resolveRoute, RouteView, useLocation } from './lib/router';
import { ROUTES } from './routes';
import { Shell } from './ui/Shell';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { AppBanner } from './ui/AppBanner';
import { Empty, Toaster } from './ui/kit';
import { applyTheme, getThemePref } from './features/settings/theme';
import { oldSharedLinkRedirect } from './features/legacy/LegacyPages';
import { BASE } from './lib/router';
import SEO_PAGES from './seo-pages.json';

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
  if (p === '/privacyPolicy' && /trems|terms/i.test(q.get('privacyPolicy') || '')) return '/settings/terms';
  if (p === '/job-detail' && q.get('serviceRequestId')) return '/jobs/' + encodeURIComponent(q.get('serviceRequestId')!);
  if ((p === '/home-detail' || p === '/postAction') && q.get('postId')) return '/post/' + encodeURIComponent(q.get('postId')!);
  if ((p === '/profile-detail' || p === '/friendsProfile') && q.get('userId')) return '/u/' + encodeURIComponent(q.get('userId')!);
  // Normalise "start a chat with X" links from other features to the chat feature's /chat/new?u=&n=.
  if (p === '/chat' && q.get('to')) return '/chat/new?u=' + encodeURIComponent(q.get('to')!) + (q.get('name') ? '&n=' + encodeURIComponent(q.get('name')!) : '');
  if (p === '/chat/new' && q.get('userId') && !q.get('u')) return '/chat/new?u=' + encodeURIComponent(q.get('userId')!) + (q.get('name') ? '&n=' + encodeURIComponent(q.get('name')!) : '');
  if (p === '/serviceRequest' && q.get('id')) return '/jobs/' + encodeURIComponent(q.get('id')!);
  if (p.startsWith('/serviceRequest/')) return '/jobs/' + p.split('/')[2];
  const map: Record<string, string> = {
    '/splash': '/register', '/home': '/', '/signup': '/register', '/signUp': '/register', '/loginWithPass': '/login', '/otp': '/verify-email',
    '/recover': '/forgot-password', '/recovery-update': '/forgot-password', '/privacyPolicy': '/settings/privacy', '/faq': '/settings/faq',
    '/help': '/settings/help', '/contactus': '/settings/help', '/notification': '/notifications', '/chat': '/chat', '/profile': '/profile',
    '/updateProfile': '/profile/edit', '/myWallet': '/wallet', '/contractor-wallet': '/wallet', '/rewardHistory': '/referral/history',
    '/withdrawal-request': '/wallet/withdraw', '/requestService': '/hire/request', '/serviceType': '/hire', '/employer': '/hire',
    '/myFriends': '/profile/network', '/search': '/search', '/serviceRequestApplyed': '/jobs', '/subscription-plans': '/plans',
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
  const needsAuth = hit ? hit.route.auth === true || (hit.route.auth !== false && hit.route.chrome !== false) : true;

  useEffect(() => {
    if (!legacy && needsAuth && !session) navigate('/login?next=' + encodeURIComponent(full), { replace: true });
  }, [legacy, needsAuth, session, full]);

  useEffect(() => {
    window.scrollTo(0, 0);
    const seo = (SEO_PAGES as { path: string; title: string }[]).find((x) => x.path === (pathname.replace(/\/+$/, '') || '/'));
    document.title = seo ? seo.title : "i'llTip – Find work, hire pros, get tipped";
  }, [pathname]);

  const onboarding = session && needsAuth ? (session.user.emailVerified === false ? '/verify-email?email=' + encodeURIComponent(session.user.email) : session.user.roleSelected === false ? '/role' : null) : null;
  useEffect(() => {
    if (onboarding) navigate(onboarding, { replace: true });
  }, [onboarding]);

  if (legacy) return null;
  if (needsAuth && !session) return null;
  if (onboarding) return null;
  if (!hit) return <Shell><NotFound /></Shell>;
  const view = (
    <ErrorBoundary resetKey={full}>
      <RouteView route={hit.route} params={hit.params} />
    </ErrorBoundary>
  );
  if (hit.route.chrome === false) return view;
  return <Shell>{view}</Shell>;
}

const redirected = oldSharedLinkRedirect(location.pathname.slice(BASE.length) || '/', location.search);
applyTheme(getThemePref());
installLinkInterceptor();
if (!redirected) createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <AppBanner />
      <App />
      <Toaster />
    </AuthProvider>
  </React.StrictMode>
);

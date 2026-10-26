import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { AuthProvider, useAuth } from './lib/auth';
import { navigate, resolveRoute, RouteView, useLocation } from './lib/router';
import { ROUTES } from './routes';
import { Shell } from './ui/Shell';
import { Empty, Toaster } from './ui/kit';

function NotFound() {
  return (
    <Empty title="Page not found">
      <a href="#/">Go home</a>
    </Empty>
  );
}

function App() {
  const { pathname, full } = useLocation();
  const { session } = useAuth();
  const hit = resolveRoute(ROUTES, pathname);
  const needsAuth = hit ? hit.route.auth !== false && hit.route.chrome !== false : true;

  useEffect(() => {
    if (needsAuth && !session) navigate('/login?next=' + encodeURIComponent(full), { replace: true });
  }, [needsAuth, session, full]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  if (needsAuth && !session) return null;
  if (!hit) return <Shell><NotFound /></Shell>;
  if (hit.route.chrome === false) return <RouteView route={hit.route} params={hit.params} />;
  return (
    <Shell>
      <RouteView route={hit.route} params={hit.params} />
    </Shell>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
      <Toaster />
    </AuthProvider>
  </React.StrictMode>
);

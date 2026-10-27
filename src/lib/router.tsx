/**
 * Tiny path router (History API). Works at the site root (www.illtip.com/...) and under a sub-path
 * (jobs.illtip.com/app/...) via <base href>. Old "#/path" links are converted on load.
 * Routes are patterns like "/jobs/:id". Use <Link to="/jobs/1">, navigate('/x'), useParams(), useQueryParams().
 */
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

/** Base path from <base href="/app/"> (no trailing slash), '' at the site root. */
export const BASE = (() => {
  try {
    const p = new URL(document.baseURI).pathname.replace(/\/+$/, '');
    return p === '/' ? '' : p;
  } catch {
    return '';
  }
})();

export const href = (to: string) => BASE + (to.startsWith('/') ? to : '/' + to);

export function currentPath() {
  let p = location.pathname;
  if (BASE && p.startsWith(BASE)) p = p.slice(BASE.length);
  if (!p.startsWith('/')) p = '/' + p;
  return p + location.search;
}

// Convert legacy hash URLs (#/jobs/1) to real paths once at startup.
if (typeof location !== 'undefined' && location.hash.startsWith('#/')) {
  history.replaceState(null, '', href(location.hash.slice(1)));
}

// Preview host (GitHub Pages) sends deep links through its 404 page, which stores the path here.
try {
  const r = sessionStorage.getItem('illtip.redirect');
  if (r) {
    sessionStorage.removeItem('illtip.redirect');
    history.replaceState(null, '', href(r));
  }
} catch {
  /* storage unavailable */
}

const EVT = 'illtip:navigate';

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (to.startsWith('#/')) to = to.slice(1);
  const url = href(to);
  if (opts.replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
  window.dispatchEvent(new Event(EVT));
}

export function goBack(fallback = '/') {
  if (history.length > 1) history.back();
  else navigate(fallback, { replace: true });
}

export function useLocation() {
  const [path, setPath] = useState(currentPath());
  useEffect(() => {
    const on = () => setPath(currentPath());
    window.addEventListener(EVT, on);
    window.addEventListener('popstate', on);
    return () => {
      window.removeEventListener(EVT, on);
      window.removeEventListener('popstate', on);
    };
  }, []);
  const [pathname, search = ''] = path.split('?');
  return { pathname, search, full: path };
}

export type RouteDef = { path: string; element: React.ComponentType<any>; auth?: boolean; chrome?: boolean };

function match(pattern: string, pathname: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean);
  const a = pathname.split('/').filter(Boolean);
  if (p.length !== a.length && !pattern.endsWith('*')) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i] === '*') return params;
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(a[i] ?? '');
    else if (p[i] !== a[i]) return null;
  }
  return params;
}

const ParamsCtx = createContext<Record<string, string>>({});
export const useParams = <T extends Record<string, string>>() => useContext(ParamsCtx) as T;

export function useQueryParams() {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search), [search]);
}

export function resolveRoute(routes: RouteDef[], pathname: string) {
  for (const r of routes) {
    const params = match(r.path, pathname);
    if (params) return { route: r, params };
  }
  return null;
}

export function RouteView({ route, params }: { route: RouteDef; params: Record<string, string> }) {
  const El = route.element;
  return (
    <ParamsCtx.Provider value={params}>
      <El />
    </ParamsCtx.Provider>
  );
}

export function Link({ to, children, className, onClick, title, style }: { to: string; children: React.ReactNode; className?: string; onClick?: (e?: any) => void; title?: string; style?: any }) {
  const target = to.startsWith('#/') ? to.slice(1) : to;
  return (
    <a
      href={href(target)}
      className={className}
      title={title}
      style={style}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(target);
      }}
    >
      {children}
    </a>
  );
}

/** Intercept plain in-app <a href="#/x"> or same-origin <a href="/x"> clicks anywhere so they route without reloads. */
export function installLinkInterceptor() {
  document.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement)?.closest?.('a') as HTMLAnchorElement | null;
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || a.target === '_blank' || a.hasAttribute('download')) return;
    const raw = a.getAttribute('href') || '';
    if (raw.startsWith('#/')) {
      e.preventDefault();
      navigate(raw.slice(1));
      return;
    }
    if (a.origin === location.origin && a.pathname.startsWith(BASE + '/') && !/\.[a-z0-9]{2,5}$/i.test(a.pathname)) {
      e.preventDefault();
      navigate(a.pathname.slice(BASE.length) + a.search);
    }
  });
}

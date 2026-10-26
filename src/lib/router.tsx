/**
 * Tiny hash router (works on any static host and under a sub-path such as jobs.illtip.com/app/).
 * Routes are patterns like "/jobs/:id". Use <Link to="/jobs/1">, navigate('/x'), useParams(), useQueryParams().
 */
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

function currentPath() {
  const h = location.hash.replace(/^#/, '') || '/';
  return h.startsWith('/') ? h : '/' + h;
}

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  const url = '#' + (to.startsWith('/') ? to : '/' + to);
  if (opts.replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function goBack(fallback = '/') {
  if (history.length > 1) history.back();
  else navigate(fallback, { replace: true });
}

export function useLocation() {
  const [path, setPath] = useState(currentPath());
  useEffect(() => {
    const on = () => setPath(currentPath());
    window.addEventListener('hashchange', on);
    window.addEventListener('popstate', on);
    return () => {
      window.removeEventListener('hashchange', on);
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

export function Link({ to, children, className, onClick, title }: { to: string; children: React.ReactNode; className?: string; onClick?: () => void; title?: string }) {
  return (
    <a
      href={'#' + to}
      className={className}
      title={title}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        onClick?.();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

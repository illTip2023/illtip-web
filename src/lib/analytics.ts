/**
 * Mixpanel analytics for www.illtip.com (same project/token the old Angular site used,
 * illtip-frontend/src/environments/environment.prod.ts → mixpanelToken).
 *
 * Rules:
 *  - Only the LIVE build sends anything: `node build.mjs --prod --base=/` defines
 *    globalThis.__ILLTIP_ANALYTICS__ = true (see build.mjs). Dev builds, preview builds under a
 *    sub-path (--base=/web/) and anything not talking to the PROD backend never load Mixpanel,
 *    and every function below is a no-op there.
 *  - Mixpanel is loaded with the official async snippet (stub that queues calls + async <script>
 *    from cdn.mxpnl.com), injected after the page has loaded / when the browser is idle, so it never
 *    competes with the app bundle. If the CDN is blocked (ad blockers) calls just queue up silently.
 *  - Nothing here can throw into the app: every call is wrapped in try/catch.
 *  - Never send phone numbers, tokens or passwords. Event URLs are reduced to origin + path (the
 *    query can carry emails or Stripe client secrets).
 *
 * API: track(name, props), identify(userId), setUserProperties(props), reset(), plus
 * initAnalytics() (main.tsx), trackPageView(path) (router), identifyUser(user) (auth).
 * Event names are Title Case and shared with the mobile app; every event gets platform: 'web'.
 */
import { api } from './api';
import { ENV_NAME } from './env';

const TOKEN = '986e2882076f76834427787a264096f4';
const LIB_URL = 'https://cdn.mxpnl.com/libs/mixpanel-2-latest.min.js';

/** True only in the live build (build.mjs --prod with base '/') talking to the PROD backend. */
export const ANALYTICS_ENABLED: boolean = (() => {
  try {
    if ((globalThis as any).__ILLTIP_ANALYTICS__ !== true || ENV_NAME !== 'PROD') return false;
    // Internal opt-out for team testing on the live site: localStorage['illtip.analytics'] = 'off'.
    return localStorage.getItem('illtip.analytics') !== 'off';
  } catch {
    return (globalThis as any).__ILLTIP_ANALYTICS__ === true && ENV_NAME === 'PROD';
  }
})();

type Props = Record<string, unknown>;
type MixpanelLike = {
  init: (token: string, config: Props, name?: string) => void;
  track: (name: string, props?: Props) => void;
  identify: (id: string) => void;
  reset: () => void;
  register: (props: Props) => void;
  people: { set: (props: Props) => void };
};

let initialised = false;

function mp(): MixpanelLike | null {
  if (!ANALYTICS_ENABLED || !initialised) return null;
  const m = (window as any).mixpanel;
  return m && typeof m.track === 'function' ? (m as MixpanelLike) : null;
}

/**
 * Port of Mixpanel's official async loader snippet (mixpanel-2-latest): creates window.mixpanel as a
 * stub that records calls, then the real library (loaded async) replays them.
 */
function installSnippet(): void {
  const w = window as any;
  const b: any = w.mixpanel || [];
  if (b.__SV) return;
  w.mixpanel = b;
  b._i = [];
  b.init = function (token: string, config: Props, name?: string) {
    let target: any = b;
    if (typeof name !== 'undefined') target = b[name] = [];
    else name = 'mixpanel';
    target.people = target.people || [];
    target.toString = function (noStub?: number) {
      let s = 'mixpanel';
      if (name !== 'mixpanel') s += '.' + name;
      if (!noStub) s += ' (stub)';
      return s;
    };
    target.people.toString = function () {
      return target.toString(1) + '.people (stub)';
    };
    const stub = (obj: any, method: string) => {
      const parts = method.split('.');
      if (parts.length === 2) {
        obj = obj[parts[0]];
        method = parts[1];
      }
      obj[method] = function () {
        obj.push([method].concat(Array.prototype.slice.call(arguments, 0)));
      };
    };
    const methods =
      'disable time_event track track_pageview track_links track_forms track_with_groups add_group set_group remove_group register register_once alias unregister identify name_tag set_config reset opt_in_tracking opt_out_tracking has_opted_in_tracking has_opted_out_tracking clear_opt_in_out_tracking start_batch_senders people.set people.set_once people.unset people.increment people.append people.union people.track_charge people.clear_charges people.delete_user people.remove'.split(
        ' '
      );
    for (const m of methods) stub(target, m);
    const groupMethods = 'set set_once union unset remove delete'.split(' ');
    target.get_group = function () {
      const call: any[] = ['get_group'].concat(Array.prototype.slice.call(arguments, 0));
      const group: any = {};
      for (const gm of groupMethods) {
        group[gm] = function () {
          target.push([call, [gm].concat(Array.prototype.slice.call(arguments, 0))]);
        };
      }
      return group;
    };
    b._i.push([token, config, name]);
  };
  b.__SV = 1.2;
}

function loadLibrary(): void {
  const inject = () => {
    try {
      if (document.querySelector(`script[src="${LIB_URL}"]`)) return;
      const s = document.createElement('script');
      s.type = 'text/javascript';
      s.async = true;
      s.src = LIB_URL;
      s.onerror = () => {
        /* blocked or offline: calls stay queued in the stub, the site is unaffected */
      };
      (document.head || document.documentElement).appendChild(s);
    } catch {
      /* ignore */
    }
  };
  // After the page has finished loading, and when the main thread is idle.
  const idle = () => {
    const ric = (window as any).requestIdleCallback as undefined | ((cb: () => void, o?: { timeout: number }) => void);
    if (ric) ric(inject, { timeout: 3000 });
    else setTimeout(inject, 1);
  };
  if (document.readyState === 'complete') idle();
  else window.addEventListener('load', idle, { once: true });
}

/** Call once at startup (main.tsx). No-op unless this is the live build. */
export function initAnalytics(): void {
  if (!ANALYTICS_ENABLED || initialised) return;
  try {
    installSnippet();
    (window as any).mixpanel.init(TOKEN, {
      api_host: 'https://api-js.mixpanel.com',
      persistence: 'localStorage',
      cross_site_cookie: false,
      batch_requests: true,
      track_pageview: false, // we send our own "Page View" from the router
      debug: false,
    });
    initialised = true;
    loadLibrary();
    installStoreLinkTracking();
  } catch {
    initialised = false;
  }
}

/** origin + path only (drops ?query and #hash, which can hold emails or payment secrets). */
function cleanUrl(): string {
  try {
    return location.origin + location.pathname;
  } catch {
    return '';
  }
}

export function track(name: string, props: Props = {}): void {
  const m = mp();
  if (!m) return;
  try {
    m.track(name, { ...props, platform: 'web', $current_url: cleanUrl() });
  } catch {
    /* never break the app */
  }
}

export function identify(userId: string): void {
  const m = mp();
  if (!m || !userId) return;
  try {
    m.identify(String(userId));
  } catch {
    /* ignore */
  }
}

export function setUserProperties(props: Props): void {
  const m = mp();
  if (!m) return;
  try {
    const clean: Props = {};
    for (const [k, v] of Object.entries(props)) if (v !== undefined && v !== null && v !== '') clean[k] = v;
    if (Object.keys(clean).length) m.people.set(clean);
  } catch {
    /* ignore */
  }
}

export function reset(): void {
  identified = '';
  const m = mp();
  if (!m) return;
  try {
    m.reset();
  } catch {
    /* ignore */
  }
}

/* ───────────── page views (called by lib/router on every route change) ───────────── */

let lastPath = '';
let pendingPath = '';
let pvTimer: ReturnType<typeof setTimeout> | null = null;

/** The path of the last tracked Page View ('' before the first one). */
export function previousPath(): string {
  return lastPath;
}

/**
 * Debounced so redirects that happen right after a navigation (legacy URLs, login guard,
 * onboarding) count as one view of the page the user actually lands on.
 */
export function trackPageView(pathname: string): void {
  if (!ANALYTICS_ENABLED) return;
  pendingPath = pathname;
  if (pvTimer) clearTimeout(pvTimer);
  pvTimer = setTimeout(() => {
    pvTimer = null;
    const path = pendingPath;
    if (!path || path === lastPath) return;
    track('Page View', { path, previous_path: lastPath || null, page_title: document.title });
    lastPath = path;
  }, 300);
}

/* ───────────── user identity (called by lib/auth when the session changes) ───────────── */

let identified = '';
const PROFILE_SYNC_KEY = 'illtip.mp.profileSync';
const PROFILE_SYNC_MS = 24 * 60 * 60 * 1000;

/** identify + $name/$email now; country / profession / userRole from GET /user/profile at most once a day, when idle. */
export function identifyUser(user: { id: string; name?: string; email?: string } | null | undefined): void {
  if (!ANALYTICS_ENABLED || !user?.id) return;
  try {
    if (identified !== user.id) {
      identified = user.id;
      identify(user.id);
    }
    setUserProperties({ $name: user.name && user.name !== user.email ? user.name : undefined, $email: user.email || undefined });
    syncProfileProps(user.id);
  } catch {
    /* ignore */
  }
}

let syncingFor = '';

function syncProfileProps(userId: string): void {
  if (syncingFor === userId) return;
  try {
    const last = JSON.parse(localStorage.getItem(PROFILE_SYNC_KEY) || 'null');
    if (last && last.id === userId && Date.now() - Number(last.at) < PROFILE_SYNC_MS) return;
  } catch {
    /* storage unavailable: sync anyway */
  }
  syncingFor = userId;
  setTimeout(async () => {
    try {
      // Same endpoint the app's useProfileQuery uses (and the web profile page).
      const { data } = await api.get('/user/profile');
      const u = data && data.success === true ? data.data : null;
      if (!u || typeof u !== 'object' || identified !== userId) return;
      const country = typeof u.country === 'string' ? u.country : u.country && typeof u.country === 'object' ? u.country.country_name : undefined;
      const profession = (typeof u.profession === 'string' && u.profession.trim()) || u.serviceDetails?.service || undefined;
      const userRole = u.userRole === 'freelancer' || u.userRole === 'customer' ? u.userRole : undefined;
      setUserProperties({ country, profession, userRole });
      try {
        localStorage.setItem(PROFILE_SYNC_KEY, JSON.stringify({ id: userId, at: Date.now() }));
      } catch {
        /* ignore */
      }
    } catch {
      /* offline / API error: try again next session */
    } finally {
      if (syncingFor === userId) syncingFor = '';
    }
  }, 4000);
}

/* ───────────── "Get The App" store-link clicks (APP_LINKS anchors anywhere, incl. AppBanner) ───────────── */

function installStoreLinkTracking(): void {
  document.addEventListener(
    'click',
    (e) => {
      try {
        const a = (e.target as HTMLElement | null)?.closest?.('a') as HTMLAnchorElement | null;
        if (!a || !a.href) return;
        const host = a.hostname;
        const store = host === 'apps.apple.com' ? 'ios' : host === 'play.google.com' ? 'android' : null;
        if (!store) return;
        const placement = a.closest('.app-banner') ? 'app_banner' : a.closest('.store-btns') ? 'store_buttons' : 'inline';
        track('Get The App Clicked', { store, placement, path: location.pathname });
      } catch {
        /* ignore */
      }
    },
    true
  );
}

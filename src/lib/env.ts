/**
 * Backend environments (same servers the mobile app uses).
 * The web app defaults to DEV until Bosun approves going live; switch with ?env=prod / ?env=dev
 * (remembered in localStorage) or by setting window.__ILLTIP_ENV__ before the bundle loads.
 */
export type EnvName = 'DEV' | 'PROD';

// stripePk: Stripe *publishable* keys (public by design, same values the mobile app ships in
// illtip-mobile/src/config/env/{dev,prod}/index.ts). Used only when the backend's checkout
// response has no publishableKey.
const ENVS: Record<EnvName, { apiBaseUrl: string; chatUrl: string; stripePk: string }> = {
  DEV: {
    apiBaseUrl: 'https://dev.illtipadmins.com',
    chatUrl: 'https://dev.illtipadmins.com:8080',
    stripePk: 'pk_test_51OOasgKZANn8RiKaU2KKtI8m1z5IbjHV5gIrsAVtYkhlcvwjdY2yLX8OmGQfnHZVUNjuDexsk3TglxaeJcbcEnTe00VD42DIrO',
  },
  PROD: {
    apiBaseUrl: 'https://illtipadmins.com',
    chatUrl: 'https://illtipadmins.com:8080',
    stripePk: 'pk_live_51OOasgKZANn8RiKaJBvV0xoOFX0pXHzRpzapzcVfjjGJHy5Fh7gpY58B6K5CJfeZccKzsaVyQ4BU0YTbFUKqyoWk00WdpFYD2P',
  },
};

export const DEFAULT_ENV: EnvName = ((globalThis as any).__ILLTIP_DEFAULT_ENV__ as EnvName) || 'DEV';

function pickEnv(): EnvName {
  // The live build always uses the live server (no ?env= switching on www.illtip.com).
  if (DEFAULT_ENV === 'PROD') return 'PROD';
  try {
    const q = new URLSearchParams(location.search).get('env');
    if (q) {
      const v = q.toUpperCase() === 'PROD' ? 'PROD' : 'DEV';
      localStorage.setItem('illtip.env', v);
      return v;
    }
    const s = localStorage.getItem('illtip.env');
    if (s === 'PROD' || s === 'DEV') return s;
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_ENV;
}

export const ENV_NAME: EnvName = pickEnv();
export const API_BASE_URL = ENVS[ENV_NAME].apiBaseUrl;
export const CHAT_URL = ENVS[ENV_NAME].chatUrl;
/** Fallback Stripe publishable key for the selected backend (prefer the checkout response's publishableKey). */
export const STRIPE_PUBLISHABLE_KEY = ENVS[ENV_NAME].stripePk;

export const APP_LINKS = {
  android: 'https://play.google.com/store/apps/details?id=com.illtip.app.ios&hl=en_US',
  ios: 'https://apps.apple.com/us/app/illtip-network-hire-pros/id1626990574',
  site: 'https://www.illtip.com/',
  jobs: 'https://jobs.illtip.com/',
};

/**
 * Backend environments (same servers the mobile app uses).
 * The web app defaults to DEV until Bosun approves going live; switch with ?env=prod / ?env=dev
 * (remembered in localStorage) or by setting window.__ILLTIP_ENV__ before the bundle loads.
 */
export type EnvName = 'DEV' | 'PROD';

const ENVS: Record<EnvName, { apiBaseUrl: string; chatUrl: string }> = {
  DEV: { apiBaseUrl: 'https://dev.illtipadmins.com', chatUrl: 'https://dev.illtipadmins.com:8080' },
  PROD: { apiBaseUrl: 'https://illtipadmins.com', chatUrl: 'https://illtipadmins.com:8080' },
};

export const DEFAULT_ENV: EnvName = ((globalThis as any).__ILLTIP_DEFAULT_ENV__ as EnvName) || 'DEV';

function pickEnv(): EnvName {
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

export const APP_LINKS = {
  android: 'https://play.google.com/store/apps/details?id=com.illtip.app.ios&hl=en_US',
  ios: 'https://apps.apple.com/us/app/illtip-network-hire-pros/id1626990574',
  site: 'https://www.illtip.com/',
  jobs: 'https://jobs.illtip.com/',
};

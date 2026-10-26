/** Light / dark / system theme (CustomizationScreen in the app). Stored per browser. */
export type ThemePref = 'light' | 'dark' | 'system';
const KEY = 'illtip.theme';

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* storage blocked */
  }
  return 'system';
}

export function applyTheme(pref: ThemePref) {
  const el = document.documentElement;
  if (pref === 'system') delete el.dataset.theme;
  else el.dataset.theme = pref;
}

export function setThemePref(pref: ThemePref) {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    /* storage blocked: still applies for this visit */
  }
  applyTheme(pref);
}

// Apply the saved choice as soon as the app loads (this module is imported by the route table at startup).
if (typeof document !== 'undefined') applyTheme(getThemePref());

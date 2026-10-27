/**
 * On-screen keyboard support for phones (iOS Safari, Android Chrome).
 *
 * Mobile browsers don't shrink the page when the keyboard opens: only the *visual* viewport shrinks
 * (and iOS also pans it to reveal the focused field). Anything sized/pinned to the layout viewport
 * (position: fixed; bottom: 0, 100vh, 100dvh) ends up hidden behind the keyboard or floating mid-screen.
 *
 * While at least one component uses this hook, it keeps these on <html>:
 *   --vvh    visual viewport height (px)
 *   --vvtop  visual viewport offset from the top of the layout viewport (px), for position: fixed
 *   .kb-open while a text field is focused and the keyboard is up
 * A fixed element with `top: var(--vvtop); height: var(--vvh)` then sits exactly between the top of
 * the screen and the top of the keyboard.
 */
import { useEffect, useSyncExternalStore } from 'react';

export type VVState = { height: number; offsetTop: number; keyboardOpen: boolean };

const KB_MIN = 120; // px of lost height that means "keyboard", not a toolbar collapsing
let state: VVState = { height: 0, offsetTop: 0, keyboardOpen: false };
const subs = new Set<() => void>();
let users = 0;
let raf = 0;
let detach: (() => void) | null = null;
// Tallest visual viewport seen per width (≈ height without keyboard; orientation changes reset it via width).
const tallest = new Map<number, number>();

function editableFocused() {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA') return !(el as HTMLTextAreaElement).readOnly;
  if (el.tagName === 'INPUT') {
    const t = ((el as HTMLInputElement).type || 'text').toLowerCase();
    return !['button', 'checkbox', 'radio', 'range', 'file', 'submit', 'reset', 'image', 'color', 'hidden'].includes(t) && !(el as HTMLInputElement).readOnly;
  }
  return false;
}

function measure() {
  raf = 0;
  const vv = window.visualViewport;
  const height = vv ? vv.height : window.innerHeight;
  const offsetTop = vv ? Math.max(0, vv.offsetTop) : 0;
  const scale = vv?.scale || 1;
  const w = Math.round(window.innerWidth);
  const full = Math.max(tallest.get(w) || 0, document.documentElement.clientHeight);
  if (scale <= 1.01 && height > (tallest.get(w) || 0)) tallest.set(w, height);
  const keyboardOpen = editableFocused() && full - height * scale > KB_MIN;

  const root = document.documentElement;
  root.style.setProperty('--vvh', Math.round(height) + 'px');
  root.style.setProperty('--vvtop', Math.round(offsetTop) + 'px');
  root.classList.toggle('kb-open', keyboardOpen);

  if (height !== state.height || offsetTop !== state.offsetTop || keyboardOpen !== state.keyboardOpen) {
    state = { height, offsetTop, keyboardOpen };
    subs.forEach((f) => f());
  }
}

function schedule() {
  if (!raf) raf = requestAnimationFrame(measure);
}

function attach() {
  const vv = window.visualViewport;
  // Focus changes happen before the keyboard animates; re-measure a few times while it settles.
  const onFocus = () => {
    schedule();
    setTimeout(schedule, 120);
    setTimeout(schedule, 350);
    setTimeout(schedule, 700);
  };
  vv?.addEventListener('resize', schedule);
  vv?.addEventListener('scroll', schedule);
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', onFocus);
  document.addEventListener('focusin', onFocus);
  document.addEventListener('focusout', onFocus);
  measure();
  return () => {
    vv?.removeEventListener('resize', schedule);
    vv?.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('orientationchange', onFocus);
    document.removeEventListener('focusin', onFocus);
    document.removeEventListener('focusout', onFocus);
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    const root = document.documentElement;
    root.style.removeProperty('--vvh');
    root.style.removeProperty('--vvtop');
    root.classList.remove('kb-open');
    state = { height: 0, offsetTop: 0, keyboardOpen: false };
  };
}

function subscribe(f: () => void) {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
}

/** Tracks the visual viewport / keyboard (see file comment). Pass `false` to opt out without breaking hook order. */
export function useVisualViewport(enabled = true): VVState {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    if (users++ === 0) detach = attach();
    else schedule();
    return () => {
      if (--users === 0 && detach) {
        detach();
        detach = null;
      }
    };
  }, [enabled]);
  return useSyncExternalStore(subscribe, () => state, () => state);
}

/**
 * Web version of the app's CoinBurstProvider (illtip-mobile/src/providers/CoinBurstProvider.tsx):
 * gold "$" coins with a short ghost trail fall from the top of the screen, drifting sideways and
 * spinning (rotateY) as they go. The app drops one coin per coin spent (staggered, capped); here a
 * single call rains clamp(coins, 6, 24) coins within ~2.5s. No libraries: Web Animations API on a
 * fixed, pointer-events:none overlay that removes itself. prefers-reduced-motion → a short "+N" fade.
 */
import './coins.css';

const LANES = [0.08, 0.2, 0.32, 0.44, 0.56, 0.68, 0.8, 0.92];
const MIN_COINS = 10;
const MAX_COINS = 24;
const GHOSTS = 2;

let overlay: HTMLDivElement | null = null;
let live = 0;

function getOverlay(): HTMLDivElement {
  if (overlay && overlay.isConnected) return overlay;
  overlay = document.createElement('div');
  overlay.className = 'cn-rain';
  overlay.setAttribute('aria-hidden', 'true');
  document.body.appendChild(overlay);
  return overlay;
}

function release() {
  live -= 1;
  if (live <= 0 && overlay) {
    overlay.remove();
    overlay = null;
    live = 0;
  }
}

function reducedMotion(): boolean {
  try {
    return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function coinEl(ghost: boolean, size: number): HTMLDivElement {
  const c = document.createElement('div');
  c.className = 'cn-coin' + (ghost ? ' ghost' : '');
  c.style.width = c.style.height = `${size}px`;
  c.style.fontSize = `${Math.round(size * 0.45)}px`;
  c.textContent = '$';
  return c;
}

function fade(coins: number) {
  const root = getOverlay();
  const el = document.createElement('div');
  el.className = 'cn-rain-pop';
  const c = coinEl(false, 40);
  c.style.position = 'static';
  el.appendChild(c);
  el.appendChild(document.createTextNode(`+${coins}`));
  root.appendChild(el);
  live += 1;
  const done = () => {
    el.remove();
    release();
  };
  if (typeof el.animate !== 'function') {
    setTimeout(done, 900);
    return;
  }
  el.animate([{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], { duration: 900, easing: 'ease-out' }).onfinish = done;
}

/** Rain coins over the whole viewport. Safe to call repeatedly; never blocks clicks. */
export function rainCoins(coins = 1) {
  if (typeof document === 'undefined') return;
  const n = Math.max(1, Math.floor(coins) || 1);
  if (reducedMotion()) return fade(n);
  const root = getOverlay();
  if (typeof root.animate !== 'function') return fade(n);

  const count = Math.min(MAX_COINS, Math.max(MIN_COINS, n));
  const w = window.innerWidth;
  const h = window.innerHeight;
  const size = w < 520 ? 34 : 44;
  const lanes = [...LANES].sort(() => Math.random() - 0.5);

  for (let i = 0; i < count; i++) {
    const lane = lanes[i % lanes.length] + (Math.random() - 0.5) * 0.08;
    const left = Math.min(w - size, Math.max(0, lane * w - size / 2));
    const delay = Math.round((i / count) * 500 + Math.random() * 120);
    const duration = 1400 + Math.round(Math.random() * 500);
    const drift = (Math.random() < 0.5 ? -1 : 1) * (20 + Math.random() * 30);
    const spin = Math.random() < 0.5 ? 720 : -720;

    for (let g = 0; g <= GHOSTS; g++) {
      const ghost = g > 0;
      const el = coinEl(ghost, size);
      el.style.left = `${left}px`;
      root.appendChild(el);
      live += 1;
      const scale = ghost ? Math.max(0.55, 1 - g * 0.15) : 1;
      const peak = ghost ? Math.max(0.12, 0.35 - g * 0.1) : 1;
      const y0 = -size * 2;
      const y1 = h + size * 2;
      const anim = el.animate(
        [
          { transform: `translate3d(${-drift}px, ${y0}px, 0) scale(${0.7 * scale}) perspective(800px) rotateY(0deg)`, opacity: 0 },
          { transform: `translate3d(${-drift * 0.6}px, ${y0 + (y1 - y0) * 0.08}px, 0) scale(${scale}) perspective(800px) rotateY(${spin * 0.08}deg)`, opacity: peak, offset: 0.08 },
          { transform: `translate3d(${drift * 0.75}px, ${y0 + (y1 - y0) * 0.5}px, 0) scale(${scale}) perspective(800px) rotateY(${spin * 0.5}deg)`, opacity: peak, offset: 0.5 },
          { transform: `translate3d(${drift * 1.2}px, ${y0 + (y1 - y0) * 0.8}px, 0) scale(${scale}) perspective(800px) rotateY(${spin * 0.8}deg)`, opacity: peak, offset: 0.8 },
          { transform: `translate3d(${drift * 1.5}px, ${y1}px, 0) scale(${scale}) perspective(800px) rotateY(${spin}deg)`, opacity: 0 },
        ],
        { duration, delay: delay + g * 55, easing: 'cubic-bezier(0.45, 0, 0.55, 1)', fill: 'both' }
      );
      const done = () => {
        el.remove();
        release();
      };
      anim.onfinish = done;
      anim.oncancel = done;
    }
  }
}

/* ------------------------------------------------------------------------------------------------
 * Per-tap burst mode: a 1:1 port of the app's CoinBurstProvider.dropCoin (combo tipping).
 * Each burst = one lead coin + 5 fading "ghost" copies (the trail), dropped down one of 5 lanes over
 * 3800ms with an in-out-quad curve, drifting -40 → 30 → 60px sideways and spinning rotateY 0 → 720°.
 * At most 18 bursts live at once (the oldest is evicted); multi-coin drops (gift tips) stagger one
 * burst per coin every 240ms, exactly like the app.
 * ---------------------------------------------------------------------------------------------- */

const BURST_SHADOWS = 6;
const BURST_COIN_SIZE = 44;
const MAX_ACTIVE_BURSTS = 18;
const BURST_LANES = [0.15, 0.35, 0.5, 0.65, 0.85];
const BURST_STAGGER_MS = 240;
const BURST_DURATION_MS = 3800;

type Burst = { els: HTMLElement[]; anims: Animation[]; done: boolean };
const bursts: Burst[] = [];

/** RN `interpolate(..., { extrapolate: 'clamp' })` for a numeric range. */
function interp(p: number, inR: number[], outR: number[]): number {
  if (p <= inR[0]) return outR[0];
  for (let i = 1; i < inR.length; i++) {
    if (p <= inR[i]) {
      const span = inR[i] - inR[i - 1] || 1;
      return outR[i - 1] + ((p - inR[i - 1]) / span) * (outR[i] - outR[i - 1]);
    }
  }
  return outR[outR.length - 1];
}

function endBurst(b: Burst) {
  if (b.done) return;
  b.done = true;
  b.anims.forEach((a) => {
    a.onfinish = null;
    a.oncancel = null;
    try {
      a.cancel();
    } catch {
      /* ignore */
    }
  });
  b.els.forEach((el) => el.remove());
  const i = bursts.indexOf(b);
  if (i >= 0) bursts.splice(i, 1);
  release();
}

function spawnBurst() {
  const root = getOverlay();
  const w = window.innerWidth;
  const h = window.innerHeight;
  const lane = BURST_LANES[Math.floor(Math.random() * BURST_LANES.length)];
  const left = lane * w - BURST_COIN_SIZE / 2;
  const b: Burst = { els: [], anims: [], done: false };
  live += 1; // one overlay reference per burst
  bursts.push(b);
  while (bursts.length > MAX_ACTIVE_BURSTS) endBurst(bursts[0]);

  // Ghosts first so the lead coin paints on top.
  for (let i = BURST_SHADOWS - 1; i >= 0; i--) {
    const isLead = i === 0;
    const peak = isLead ? 1 : Math.max(0.06, 0.35 - i * 0.06);
    const s = Math.min(i * 0.04, 0.15);
    const coinScale = isLead ? 1 : Math.max(0.5, 1 - i * 0.1);
    const el = coinEl(!isLead, BURST_COIN_SIZE);
    el.classList.add('cn-burst');
    el.style.left = `${left}px`;
    root.appendChild(el);
    b.els.push(el);
    // Sample the app's interpolations at every breakpoint; WAAPI tweens linearly between them on
    // the same eased timeline, which reproduces the RN result.
    const stops = Array.from(new Set([0, s, s + 0.06, s + 0.1, 0.5, 0.75, 1])).sort((a, c) => a - c);
    const frames = stops.map((p) => {
      const ty = interp(p, [s, 1], [-BURST_COIN_SIZE * 2, h + BURST_COIN_SIZE * 2]);
      const tx = interp(p, [s, 0.5, 1], [-40, 30, 60]);
      const op = interp(p, [s, s + 0.06, 0.75, 1], [0, peak, peak, 0]);
      const sc = interp(p, [s, s + 0.1, 1], [0.7, coinScale, coinScale]);
      const ry = interp(p, [s, 1], [0, 720]);
      return {
        offset: p,
        opacity: op,
        transform: `translateY(${ty}px) translateX(${tx}px) scale(${sc}) perspective(800px) rotateY(${ry}deg)`,
      };
    });
    const anim = el.animate(frames, { duration: BURST_DURATION_MS, easing: 'cubic-bezier(0.45, 0, 0.55, 1)', fill: 'both' });
    b.anims.push(anim);
    if (isLead) anim.onfinish = () => endBurst(b);
  }
}

const staggerTimers = new Set<ReturnType<typeof setTimeout>>();

/**
 * Drop `count` coins (default 1) — the app's `dropCoin`. One call per combo tap; gift tips pass
 * their coin value (one falling coin per coin spent, staggered). Never blocks clicks.
 */
export function dropCoin(count = 1) {
  if (typeof document === 'undefined') return;
  const total = Math.max(1, Math.floor(count) || 1);
  if (reducedMotion() || typeof document.body.animate !== 'function') return fade(total);
  spawnBurst();
  for (let i = 1; i < total; i++) {
    const t = setTimeout(() => {
      staggerTimers.delete(t);
      spawnBurst();
    }, i * BURST_STAGGER_MS);
    staggerTimers.add(t);
  }
}

/** Number of coin bursts currently on screen (for tests / debugging). */
export function activeCoinBursts() {
  return bursts.length;
}

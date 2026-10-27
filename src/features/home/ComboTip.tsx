/**
 * Tap-to-tip with a TikTok-style combo — the web port of the app's tip button.
 *
 * Mirrors illtip-mobile:
 *  - src/ui/atoms/ComboTipButton.tsx  (coin pill / rail icon, combo button + countdown ring,
 *    "X2 … Good! (5) … Great! (10) … Superb! (15)" badge, 3s combo window, long-press gift popup)
 *  - src/ui/atoms/giftOptions.ts      (Paper 5 / Pen 10 / Suitcase 100)
 *  - src/hooks/usePostEngagement.ts   (handleTipPress / handleGiftPress / mutateCoin: 1 coin per tap,
 *    one POST /post/coin per tap, optimistic count, effective balance = balance - in-flight spend,
 *    recharge prompt debounced to once per 1.5s, rollback + toast on failure, own post can't tip)
 *  - src/providers/CoinBurstProvider.tsx (one falling coin trail per tap → dropCoin in ../coins/CoinRain)
 *  - src/providers/CoinRechargeProvider.tsx (out of coins → the coin purchase sheet → BuyCoinsModal)
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, ApiError } from '../../lib/api';
import { compactNumber, toast } from '../../ui/kit';
import { BuyCoinsModal } from '../coins/BuyCoins';
import { dropCoin } from '../coins/CoinRain';
import { coinTotal, fetchCoinBalance, isSponsored, type Post } from './api';
import { coinStore, patchPost, usePostPatch } from './store';
import './ComboTip.css';

const COMBO_TIMEOUT_MS = 3000;
const LONG_PRESS_MS = 350;
const RECHARGE_DEBOUNCE_MS = 1500;
const BUTTON_SIZE = 66;
const STROKE_WIDTH = 3;
const RADIUS = (BUTTON_SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export type GiftOption = { id: 'paper' | 'pen' | 'suitcase'; label: string; emoji: string; coins: number };
export const GIFT_OPTIONS: GiftOption[] = [
  { id: 'paper', label: 'Paper', emoji: '📄', coins: 5 },
  { id: 'pen', label: 'Pen', emoji: '🖊️', coins: 10 },
  { id: 'suitcase', label: 'Suitcase', emoji: '💼', coins: 100 },
];

/** Milestone labels only AT the exact mark; numbers get an "X" prefix (app: getComboLabel). */
export function getComboLabel(count: number): string {
  if (count === 15) return 'Superb!';
  if (count === 10) return 'Great!';
  if (count === 5) return 'Good!';
  return `X${count}`;
}

/* ---------------- balance + API (app: services/coins.ts, services/post.ts coinPost) ---------------- */

let balanceLoading: Promise<void> | null = null;
/** Warm the shared balance once (app: useCoinBalanceController().ensureLoaded, deduped by key). */
export function ensureBalanceLoaded(force = false): Promise<void> {
  if (!force && coinStore.get() !== undefined) return Promise.resolve();
  if (balanceLoading) return balanceLoading;
  balanceLoading = fetchCoinBalance()
    .then((b) => coinStore.set(Math.max(0, b)))
    .catch(() => {})
    .finally(() => {
      balanceLoading = null;
    });
  return balanceLoading;
}

/** app: unwrapCoinApiData — `{data:{data:x}}` → x, `{data:x}` → x. */
function unwrapCoin(payload: any): any {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    const nested = payload.data;
    if (nested && typeof nested === 'object' && 'data' in nested) return nested.data;
    return nested;
  }
  return payload;
}
export function balanceFrom(payload: any): number | undefined {
  const d = unwrapCoin(payload);
  const n = Number(d?.coinBalance ?? d?.balance);
  return d != null && Number.isFinite(n) ? n : undefined;
}
/** app: isInsufficientCoinBalanceError. */
export function isInsufficient(e: any): boolean {
  const payload = unwrapCoin(e?.data);
  const message = String(e?.data?.message ?? payload?.message ?? e?.message ?? '').toLowerCase();
  const balance = Number(payload?.coinBalance ?? payload?.balance);
  const required = Number(payload?.required ?? payload?.coinsRequired ?? payload?.coins ?? 1);
  if (Number.isFinite(balance) && Number.isFinite(required) && balance < required) return true;
  if (e?.status === 402) return true;
  return message.includes('insufficient') || message.includes('not enough') || message.includes('low balance') || (message.includes('balance') && message.includes('coin'));
}

/**
 * POST /post/coin with the app's exact payload ({ statusPostId, coins, sponsored }).
 * The backend refuses with 200 + success:false ("Insufficient coin balance", data {coinBalance, required}),
 * so that is treated as a failure here (rolled back), not a success.
 */
async function sendCoins(post: Post, coins: number) {
  const { data } = await api.post('/post/coin', { statusPostId: Number(post.statusPostId), coins, sponsored: isSponsored(post) });
  if (data && typeof data === 'object' && data.success === false) throw new ApiError(data.message || 'Could not send tip', 200, data);
  return data;
}

/* ---------------- engagement hook (app: usePostEngagement tip parts) ---------------- */

export function useComboTip(post: Post) {
  const id = Number(post.statusPostId);
  const patch = usePostPatch(id);
  const coinCount = patch.coins ?? coinTotal(post);
  const pendingSpend = useRef(0);
  const lastPrompt = useRef(0);
  const [rechargeOpen, setRechargeOpen] = useState(false);

  useEffect(() => {
    void ensureBalanceLoaded();
  }, []);

  const promptRecharge = useCallback((message?: string) => {
    const now = Date.now();
    if (now - lastPrompt.current < RECHARGE_DEBOUNCE_MS) return;
    lastPrompt.current = now;
    void ensureBalanceLoaded(true);
    setRechargeOpen(true);
    if (message) toast.error(message);
  }, []);

  const mutateCoin = useCallback(
    (coins: number) => {
      // onMutate: optimistic count (shared store, so feed + viewer + details all update).
      patchPost(id, (old) => ({ coins: (old.coins ?? coinTotal(post)) + coins }));
      sendCoins(post, coins)
        .then((res) => {
          const b = balanceFrom(res);
          if (b != null) coinStore.set(Math.max(0, b));
          else coinStore.set((v) => Math.max(0, (v ?? 0) - coins));
        })
        .catch((e) => {
          patchPost(id, (old) => ({ coins: Math.max(0, (old.coins ?? coinTotal(post)) - coins) }));
          const b = balanceFrom(e?.data);
          if (b != null) coinStore.set(Math.max(0, b));
          if (isInsufficient(e)) {
            promptRecharge('Not enough coins. Recharge to continue tipping.');
            return;
          }
          toast.error('Could not send tip. Please try again.');
        })
        .finally(() => {
          pendingSpend.current = Math.max(0, pendingSpend.current - coins);
        });
    },
    [id, post, promptRecharge]
  );

  /** app: handleTipPress. Returns whether the tip was accepted (gates the combo animation). */
  const tip = useCallback((): boolean => {
    const balance = coinStore.get();
    if (balance == null) {
      void ensureBalanceLoaded(true);
      return false;
    }
    if (balance - pendingSpend.current <= 0) {
      promptRecharge();
      return false;
    }
    pendingSpend.current += 1;
    dropCoin();
    mutateCoin(1);
    return true;
  }, [mutateCoin, promptRecharge]);

  /** app: handleGiftPress — the whole gift must fit the effective balance up front. */
  const gift = useCallback(
    (g: { coins: number }): boolean => {
      const balance = coinStore.get();
      if (balance == null) {
        void ensureBalanceLoaded(true);
        return false;
      }
      if (balance - pendingSpend.current < g.coins) {
        promptRecharge('Not enough coins for this gift. Recharge to continue.');
        return false;
      }
      pendingSpend.current += g.coins;
      dropCoin(g.coins);
      mutateCoin(g.coins);
      return true;
    },
    [mutateCoin, promptRecharge]
  );

  return { coinCount, tip, gift, rechargeOpen, closeRecharge: () => setRechargeOpen(false) };
}

/* ---------------- UI (app: ComboTipButton) ---------------- */

/** FontAwesome5 "coins" stand-in (stack of coins), the app's tip glyph. */
function CoinsGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden fill="currentColor">
      <ellipse cx="9" cy="6" rx="7" ry="3" />
      <path d="M2 8.6V10c0 1.7 3.1 3 7 3s7-1.3 7-3V8.6C14.4 9.8 11.8 10.4 9 10.4S3.6 9.8 2 8.6z" />
      <path d="M2 12.6V14c0 1.7 3.1 3 7 3 .6 0 1.2 0 1.7-.1a6.9 6.9 0 0 1 1.5-3.1c-1 .2-2.1.3-3.2.3-2.8 0-5.4-.6-7-1.5z" />
      <path d="M2 16.6V18c0 1.7 3.1 3 7 3 .9 0 1.7-.1 2.5-.2a7 7 0 0 1-.8-2.6c-.6.1-1.1.1-1.7.1-2.8 0-5.4-.6-7-1.7z" />
      <circle cx="17.5" cy="16" r="5.5" />
    </svg>
  );
}

/** Stops React synthetic events in portals from bubbling to the card / viewer slide handlers. */
const stop = (e: { stopPropagation(): void }) => e.stopPropagation();

export function ComboTipButton({
  post,
  variant = 'pill',
  hideTipIcon = false,
}: {
  post: Post;
  /** 'rail' = 44px circle with the count below (viewer side rail). Default 'pill' is the feed look. */
  variant?: 'pill' | 'rail';
  /** Own post: hide only the coin icon so you can't tip yourself; the count stays. */
  hideTipIcon?: boolean;
}) {
  const { coinCount, tip, gift, rechargeOpen, closeRecharge } = useComboTip(post);
  const isRail = variant === 'rail';
  const [comboCount, setComboCount] = useState(0);
  const [comboActive, setComboActive] = useState(false);
  const [pop, setPop] = useState(0);
  const [giftAnchor, setGiftAnchor] = useState<DOMRect | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  const iconRef = useRef<HTMLButtonElement>(null);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const endCombo = useCallback(() => {
    setComboActive(false);
    setComboCount(0);
  }, []);

  const handlePress = useCallback(() => {
    // Bail before any animation if the tip was rejected (no coins). An active combo is left to
    // expire on its own timer rather than being extended.
    if (!tip()) return;
    clearTimer();
    setComboCount((n) => n + 1);
    setComboActive(true);
    setPop((n) => n + 1); // restarts the pop + countdown-ring CSS animations
    timer.current = setTimeout(endCombo, COMBO_TIMEOUT_MS);
  }, [tip, endCombo]);

  useEffect(
    () => () => {
      clearTimer();
      if (pressTimer.current) clearTimeout(pressTimer.current);
    },
    []
  );

  const openGift = () => {
    const r = iconRef.current?.getBoundingClientRect();
    if (r) setGiftAnchor(r);
  };
  const cancelPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };
  const onPointerDown = (e: { button: number }) => {
    if (e.button !== 0) return;
    longPressed.current = false;
    cancelPress();
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      openGift();
    }, LONG_PRESS_MS);
  };
  const onIconClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    cancelPress();
    if (longPressed.current) {
      longPressed.current = false;
      return;
    }
    handlePress();
  };

  const onGiftSelect = (g: GiftOption) => {
    // Close either way: on success the coin burst celebrates; on rejection the recharge sheet takes over.
    setGiftAnchor(null);
    gift(g);
  };

  const label = getComboLabel(comboCount);

  return (
    <div className={'ct-anchor' + (isRail ? ' rail' : '')} onClick={stop}>
      <div className={'ct-pill' + (isRail ? ' rail' : '') + (comboActive ? ' hidden' : '')} aria-hidden={comboActive || undefined}>
        {!hideTipIcon && (
          <button
            ref={iconRef}
            type="button"
            className="ct-icon"
            aria-label="Send a tip"
            title="Tap to tip 1 coin · long-press for gifts"
            disabled={comboActive}
            onClick={onIconClick}
            onPointerDown={onPointerDown}
            onPointerUp={cancelPress}
            onPointerLeave={cancelPress}
            onPointerCancel={cancelPress}
            onContextMenu={(e) => {
              // Touch long-press fires contextmenu too; desktop right-click opens the gifts directly.
              e.preventDefault();
              cancelPress();
              if (!giftAnchor) {
                longPressed.current = true;
                openGift();
              }
            }}
          >
            <CoinsGlyph size={isRail ? 22 : 14} />
          </button>
        )}
        <span className="ct-count" title={hideTipIcon ? 'Tips on your post' : undefined}>
          {compactNumber(coinCount)}
        </span>
      </div>

      {comboActive && (
        <div className="ct-combo">
          <div key={`b${pop}`} className="ct-badge" aria-live="polite">
            {label}
          </div>
          <div className="ct-btn-wrap">
            <svg className="ct-ring" width={BUTTON_SIZE} height={BUTTON_SIZE} aria-hidden>
              <circle cx={BUTTON_SIZE / 2} cy={BUTTON_SIZE / 2} r={RADIUS} stroke="rgba(27, 42, 74, 0.2)" strokeWidth={STROKE_WIDTH} fill="none" />
              <circle
                key={`r${pop}`}
                className="ct-ring-arc"
                cx={BUTTON_SIZE / 2}
                cy={BUTTON_SIZE / 2}
                r={RADIUS}
                strokeWidth={STROKE_WIDTH}
                fill="none"
                strokeDasharray={CIRCUMFERENCE}
                strokeLinecap="round"
                style={{ ['--ct-c' as any]: `${CIRCUMFERENCE}`, animationDuration: `${COMBO_TIMEOUT_MS}ms` }}
              />
            </svg>
            <button key={`c${pop}`} type="button" className="ct-btn" onClick={handlePress} aria-label={`Combo x${comboCount}`}>
              Combo
            </button>
          </div>
        </div>
      )}

      {giftAnchor && createPortal(<GiftPopup anchor={giftAnchor} onSelect={onGiftSelect} onClose={() => setGiftAnchor(null)} />, document.body)}
      {rechargeOpen &&
        createPortal(
          <div onClick={stop} onMouseDown={stop} onPointerDown={stop} onKeyDown={stop}>
            <BuyCoinsModal open onClose={closeRecharge} />
          </div>,
          document.body
        )}
    </div>
  );
}

const GIFT_PANEL_WIDTH = 248;
const GIFT_PANEL_GAP = 10;
const GIFT_PANEL_HEIGHT = 96;

/** TikTok-style gift panel anchored above the tip icon; backdrop tap / Esc dismisses. */
function GiftPopup({ anchor, onSelect, onClose }: { anchor: DOMRect; onSelect: (g: GiftOption) => void; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [onClose]);
  const sw = window.innerWidth;
  const left = Math.min(Math.max(8, anchor.right - GIFT_PANEL_WIDTH), sw - GIFT_PANEL_WIDTH - 8);
  const top = Math.max(8, anchor.top - GIFT_PANEL_HEIGHT - GIFT_PANEL_GAP);
  return (
    <div
      className="ct-gift-backdrop"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      onPointerDown={stop}
      onContextMenu={(e) => e.preventDefault()}
      aria-label="Close gift options"
    >
      <div className="ct-gift-panel" style={{ left, top }} role="dialog" aria-label="Gift options" onClick={stop}>
        {GIFT_OPTIONS.map((g) => (
          <button key={g.id} type="button" className="ct-gift" onClick={() => onSelect(g)} aria-label={`Send ${g.label}, ${g.coins} coins`}>
            <span className="ct-gift-emoji">{g.emoji}</span>
            <span className="ct-gift-label">{g.label}</span>
            <span className="ct-gift-cost">
              <CoinsGlyph size={9} />
              {g.coins}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

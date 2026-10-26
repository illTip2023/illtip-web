/**
 * "Get the app" banner for phones: iPhone/iPad → App Store, Android → Google Play.
 * Shown on every page on mobile until dismissed (hidden for 7 days after closing). Hidden on desktop.
 */
import React, { useState } from 'react';
import { APP_LINKS } from '../lib/env';

export type Platform = 'ios' | 'android' | 'other';

export function detectPlatform(): Platform {
  const ua = navigator.userAgent || '';
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  return 'other';
}

export function storeLink(p: Platform = detectPlatform()) {
  return p === 'ios' ? APP_LINKS.ios : APP_LINKS.android;
}

const KEY = 'illtip.appBannerClosedAt';

export function AppBanner() {
  const platform = detectPlatform();
  const [closed, setClosed] = useState(() => {
    try {
      const t = Number(localStorage.getItem(KEY) || 0);
      return Date.now() - t < 7 * 864e5;
    } catch {
      return false;
    }
  });
  // The referral page has its own store buttons (they carry the referral code), and /information is full-screen.
  if (platform === 'other' || closed || /\/(referral|information)\/?$/.test(location.pathname)) return null;
  const close = () => {
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    setClosed(true);
  };
  return (
    <div className="app-banner" role="region" aria-label="Get the i'llTip app">
      <button className="app-banner-x" aria-label="Close" onClick={close}>
        ×
      </button>
      <img src="logo.png" alt="" />
      <div className="grow">
        <div className="app-banner-title">i'llTip for {platform === 'ios' ? 'iPhone' : 'Android'}</div>
        <div className="app-banner-sub">Job alerts, chat and tips are faster in the app</div>
      </div>
      <a className="app-banner-btn" href={storeLink(platform)} target="_blank" rel="noreferrer">
        {platform === 'ios' ? 'Get' : 'Install'}
      </a>
    </div>
  );
}

/** Desktop/sidebar "Get the app" buttons (both stores). */
export function StoreButtons({ compact }: { compact?: boolean }) {
  return (
    <div className={'store-btns' + (compact ? ' compact' : '')}>
      <a href={APP_LINKS.ios} target="_blank" rel="noreferrer" className="store-btn">
        <span className="store-btn-top">Download on the</span>
        <span className="store-btn-big">App Store</span>
      </a>
      <a href={APP_LINKS.android} target="_blank" rel="noreferrer" className="store-btn">
        <span className="store-btn-top">Get it on</span>
        <span className="store-btn-big">Google Play</span>
      </a>
    </div>
  );
}

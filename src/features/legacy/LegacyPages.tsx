/**
 * Pages kept exactly as the old www.illtip.com behaved, so nothing people already share breaks:
 *  - /information: the investor/landing page, shown full-screen in a frame (URL stays /information), no chatbot.
 *  - /referral?code=: the referral landing page (copy code, open the app, Play Store with install referrer).
 *  - Shared app links (/job-detail, /home-detail, /profile-detail) on phones go to the App Store / Google Play,
 *    as before (if the app is installed, the phone opens the app before the site loads). See main.tsx.
 */
import React, { useState } from 'react';
import { href, Link } from '../../lib/router';
import { APP_LINKS } from '../../lib/env';
import { detectPlatform } from '../../ui/AppBanner';

export function InformationPage() {
  return (
    <>
    <a href="https://jobs.illtip.com/" className="info-jobs-link">Browse jobs</a>
    <iframe
      title="i'llTip"
      src={href('/assets/landing-page-html/landing-page-html.html')}
      style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', border: 0, background: '#fff' }}
    />
    </>
  );
}

const CODE_RE = /^[A-Z0-9]{8,16}$/;

export function ReferralPage() {
  return <ReferralLanding />;
}

function ReferralLanding() {
  const raw = (new URLSearchParams(location.search).get('code') || '').trim().toUpperCase();
  const code = CODE_RE.test(raw) ? raw : null;
  const platform = detectPlatform();
  const [msg, setMsg] = useState('');

  const copy = async () => {
    if (!code) return false;
    try {
      await navigator.clipboard.writeText(code);
      setMsg('Referral code copied');
      return true;
    } catch {
      setMsg('Select and copy the code above');
      return false;
    }
  };
  const openApp = () => code && (location.href = `illtip://referral/${encodeURIComponent(code)}`);
  const play = () => code && (location.href = `${APP_LINKS.android}&referrer=${encodeURIComponent(`referral_code=${code}`)}`);
  const appStore = async () => {
    await copy();
    location.href = APP_LINKS.ios;
  };

  return (
    <main className="ref-landing">
      <section className="card ref-landing-card">
        <img src={href('/logo.png')} alt="i'llTip" width={56} height={56} />
        {code ? (
          <>
            <h1>You've been invited to join i'llTip</h1>
            <p className="muted">Use this referral code when creating your account:</p>
            <button className="ref-landing-code" onClick={copy} aria-label="Copy referral code">
              {code}
            </button>
            <p className="muted" aria-live="polite" style={{ minHeight: 20 }}>{msg}</p>
            {platform !== 'other' && (
              <button className="btn btn-block" onClick={openApp}>Open i'llTip</button>
            )}
            {platform === 'android' && <button className="btn btn-block btn-ghost" onClick={play}>Get it on Google Play</button>}
            {platform === 'ios' && <button className="btn btn-block btn-ghost" onClick={appStore}>Copy Code &amp; Download on the App Store</button>}
            {platform === 'other' && (
              <>
                <Link to={`/register?ref=${encodeURIComponent(code)}`} className="btn btn-block">Sign up on the web</Link>
                <div className="row" style={{ gap: 8, marginTop: 8 }}>
                  <button className="btn btn-ghost grow" onClick={play}>Google Play</button>
                  <button className="btn btn-ghost grow" onClick={appStore}>Apple App Store</button>
                </div>
              </>
            )}
            <p className="muted small" style={{ marginTop: 14 }}>
              {platform === 'android'
                ? "After installation, open i'llTip. Your referral code will be added to signup automatically."
                : platform === 'ios'
                  ? 'Your code will be copied before the App Store opens. After installing, paste it into the optional Referral Code field during signup.'
                  : `Sign up here, or install i'llTip on your phone and enter ${code} during signup.`}
            </p>
          </>
        ) : (
          <>
            <h1>Invalid referral link</h1>
            <p className="muted">This referral link is missing a valid code. Ask the person who invited you to share their link again.</p>
            <Link to="/" className="btn btn-block">Go to i'llTip</Link>
          </>
        )}
      </section>
    </main>
  );
}

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Old shared links on phones → app stores, exactly like the old site. Returns true if it redirected
 * (call before rendering). Invalid ids go to /information like before.
 */
export function oldSharedLinkRedirect(pathname: string, search: string): boolean {
  const p = pathname.replace(/\/+$/, '');
  const q = new URLSearchParams(search);
  const param = p === '/job-detail' ? 'serviceRequestId' : p === '/profile-detail' ? 'userId' : p === '/home-detail' ? 'postId' : null;
  if (!param) return false;
  const id = (q.get(param) || '').trim();
  if (p !== '/home-detail' && !ID_RE.test(id)) {
    location.replace(href('/information'));
    return true;
  }
  const platform = detectPlatform();
  if (platform === 'other') return false;
  location.replace(platform === 'ios' ? APP_LINKS.ios : APP_LINKS.android);
  return true;
}

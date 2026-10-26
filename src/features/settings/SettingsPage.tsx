import React, { useState } from 'react';
import { Avatar, Icon, Modal, PageHeader } from '../../ui/kit';
import { Link, navigate } from '../../lib/router';
import { useAuth } from '../../lib/auth';
import { APP_LINKS, ENV_NAME } from '../../lib/env';
import { useQuery } from '../../lib/query';
import { fetchProfile, profileShareUrl } from '../profile/api';
import { ShareModal } from '../profile/components';
import { getThemePref, setThemePref, type ThemePref } from './theme';

type RowProps = { icon: React.ReactNode; title: string; sub?: string; to?: string; onClick?: () => void; right?: React.ReactNode; danger?: boolean; external?: string };

function Row({ icon, title, sub, to, onClick, right, danger, external }: RowProps) {
  const inner = (
    <>
      <span className={'st-ico' + (danger ? ' st-ico-danger' : '')}>{icon}</span>
      <span className="grow st-row-text">
        <span className={'st-row-title' + (danger ? ' st-danger' : '')}>{title}</span>
        {sub && <span className="st-row-sub">{sub}</span>}
      </span>
      {right ?? (to || onClick || external ? <Chevron /> : null)}
    </>
  );
  if (to)
    return (
      <Link to={to} className="st-row">
        {inner}
      </Link>
    );
  if (external)
    return (
      <a href={external} className="st-row" target="_blank" rel="noreferrer">
        {inner}
      </a>
    );
  if (onClick)
    return (
      <button type="button" className="st-row" onClick={onClick}>
        {inner}
      </button>
    );
  return <div className="st-row st-row-static">{inner}</div>;
}

export function Chevron() {
  return (
    <svg className="st-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}

/** Small outline icons for the settings rows. */
export function Glyph({ d, size = 19 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

const G = {
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  share: 'M4 12v7h16v-7M12 3v12M7 8l5-5 5 5',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z',
  award: 'M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM8.5 14L7 22l5-3 5 3-1.5-8',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm8 1a3 3 0 1 0 0-6M2 21c0-3.9 3.1-7 7-7s7 3.1 7 7M17 14c2.8 0 5 2.2 5 5',
  bell: 'M12 3a6 6 0 0 1 6 6v4l2 3H4l2-3V9a6 6 0 0 1 6-6zm-2 15h4a2 2 0 0 1-4 0z',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z',
  wallet: 'M3 7a2 2 0 0 1 2-2h13v4h1a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM16 14h.01',
  crown: 'M3 8l4 4 5-7 5 7 4-4-2 11H5z',
  help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01',
  faq: 'M4 5h16v11H9l-5 4zM9 9h6M9 12h4',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5h.01',
  doc: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5',
  shield: 'M12 2l8 3v6c0 5-3.4 9.4-8 11-4.6-1.6-8-6-8-11V5z',
  file: 'M6 3h12v18H6zM9 8h6M9 12h6M9 16h4',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  phone: 'M7 2h10v20H7zM11 18h2',
};

function AppStoreButtons() {
  return (
    <div className="row-wrap">
      <a className="btn btn-dark" href={APP_LINKS.ios} target="_blank" rel="noreferrer">
        Download on the App Store
      </a>
      <a className="btn btn-dark" href={APP_LINKS.android} target="_blank" rel="noreferrer">
        Get it on Google Play
      </a>
    </div>
  );
}

function ThemeSwitch() {
  const [pref, setPref] = useState<ThemePref>(getThemePref);
  const opts: { id: ThemePref; label: string }[] = [
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
    { id: 'system', label: 'System' },
  ];
  return (
    <div className="st-theme" role="radiogroup" aria-label="App Theme">
      {opts.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={pref === o.id}
          className={pref === o.id ? 'active' : ''}
          onClick={() => {
            setPref(o.id);
            setThemePref(o.id);
          }}
        >
          <span className={'st-theme-swatch st-theme-' + o.id} aria-hidden />
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SettingsPage() {
  const { user, logout } = useAuth();
  const prof = useQuery(user?.id ? `profile:${user.id}` : null, () => fetchProfile());
  const p = prof.data;
  const name = p?.name || user?.name || 'User';
  const email = p?.email || user?.email || '';
  const [share, setShare] = useState(false);
  const [appOnly, setAppOnly] = useState<null | 'delete' | 'language'>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);

  const doLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="st">
      <PageHeader title="Settings" />

      <section className="st-account">
        <Avatar src={p?.avatar || user?.imageUrl} name={name} size={64} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="st-account-name ellipsis">{name}</div>
          {email && <div className="st-account-email ellipsis">{email}</div>}
          {p?.profession && <div className="st-account-email ellipsis">{p.profession}</div>}
        </div>
        <div className="st-account-actions">
          <Link to="/profile" className="btn btn-ghost btn-sm">
            View profile
          </Link>
          <Link to="/profile/edit" className="btn btn-sm">
            Edit Profile
          </Link>
        </div>
      </section>

      <div className="st-grid">
        <div>
          <h2 className="st-h">Profile</h2>
          <div className="card st-group">
            <Row icon={<Glyph d={G.edit} />} title="Edit Profile" sub="Name, photo, profession, skills and bio" to="/profile/edit" />
            <Row icon={<Glyph d={G.share} />} title="Share Profile" sub="Let people find you on i'llTip" onClick={() => setShare(true)} />
            <Row icon={<Glyph d={G.eye} />} title="Profile Viewers" sub="See who looked at your profile" to="/profile/viewers" />
            <Row icon={<Glyph d={G.users} />} title="Network" sub="People you network with" to="/profile/network" />
            <Row icon={<Glyph d={G.star} />} title="Your rating" sub="Creator rating and visibility" to="/profile/rating" />
            <Row icon={<Glyph d={G.award} />} title="Recommendations" sub="View recommendations you received and gave" to="/profile?tab=recommendations" />
          </div>

          <h2 className="st-h">Preferences</h2>
          <div className="card st-group">
            <div className="st-row st-row-static st-row-stack">
              <span className="st-ico">
                <Glyph d={G.sun} />
              </span>
              <span className="grow st-row-text">
                <span className="st-row-title">App Theme</span>
                <span className="st-row-sub">Choose light, dark, or match your device settings.</span>
                <ThemeSwitch />
              </span>
            </div>
            <Row icon={<Glyph d={G.bell} />} title="Notifications" sub="Choose what you get notified about" to="/notifications/settings" />
            <Row icon={<Glyph d={G.globe} />} title="Language" sub="English" onClick={() => setAppOnly('language')} />
          </div>

          <h2 className="st-h">Finance</h2>
          <div className="card st-group">
            <Row icon={<Glyph d={G.wallet} />} title="Wallet & Referrals" sub="Rewards, earnings, withdrawals and referral code" to="/wallet" />
            <Row icon={<Glyph d={G.crown} />} title="Subscription" sub="View, upgrade, or change your current plan" to="/plans" />
          </div>
        </div>

        <div>
          <h2 className="st-h">Support</h2>
          <div className="card st-group">
            <Row icon={<Glyph d={G.help} />} title="Help" sub="Find answers, get support, or contact our team" to="/settings/help" />
            <Row icon={<Glyph d={G.faq} />} title="FAQ" sub="Frequently Asked Questions" to="/settings/faq" />
            <Row icon={<Glyph d={G.info} />} title="About" sub="Learn more about the app and legal information" to="/settings/about" />
          </div>

          <h2 className="st-h">Legal</h2>
          <div className="card st-group">
            <Row icon={<Glyph d={G.doc} />} title="Terms & Conditions" to="/settings/terms" />
            <Row icon={<Glyph d={G.shield} />} title="Privacy Policy" to="/settings/privacy" />
            <Row icon={<Glyph d={G.file} />} title="EULA" to="/settings/eula" />
          </div>

          <h2 className="st-h">Account</h2>
          <div className="card st-group">
            <Row icon={<Glyph d={G.logout} />} title="Log Out" sub="Securely sign out of your account" onClick={() => setConfirmLogout(true)} />
            <Row icon={<Glyph d={G.trash} />} title="Delete Account" sub="Permanently deactivate your account" danger onClick={() => setAppOnly('delete')} />
          </div>

          <div className="st-getapp card">
            <span className="st-ico">
              <Glyph d={G.phone} />
            </span>
            <div className="grow">
              <div style={{ fontWeight: 700 }}>Get the i'llTip app</div>
              <div className="muted small">Coin purchases, video posts and push notifications live in the app.</div>
            </div>
            <div className="row-wrap">
              <a className="btn btn-ghost btn-sm" href={APP_LINKS.ios} target="_blank" rel="noreferrer">
                iPhone
              </a>
              <a className="btn btn-ghost btn-sm" href={APP_LINKS.android} target="_blank" rel="noreferrer">
                Android
              </a>
            </div>
          </div>
        </div>
      </div>

      <p className="st-foot">
        i'llTip for web{ENV_NAME !== 'PROD' ? ` · ${ENV_NAME} server` : ''} · <a href={APP_LINKS.site} target="_blank" rel="noreferrer">illtip.com</a>
      </p>

      {user?.id && <ShareModal open={share} onClose={() => setShare(false)} url={profileShareUrl(user.id)} name={name} />}

      <Modal open={confirmLogout} onClose={() => setConfirmLogout(false)} title="Log Out">
        <div className="stack">
          <div className="muted">You'll need your email and password to sign back in on this browser.</div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => setConfirmLogout(false)}>
              Cancel
            </button>
            <button className="btn" onClick={doLogout}>
              <Icon name="logout" size={18} /> Log Out
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={appOnly !== null}
        onClose={() => setAppOnly(null)}
        title={appOnly === 'delete' ? 'Delete Account' : 'Language'}
      >
        {appOnly === 'delete' && (
          <div className="stack">
            <p style={{ margin: 0 }}>
              Deleting your account permanently deactivates it. <b>This can't be undone.</b> You'll be logged out and won't be able to sign back in with this account.
            </p>
            <div className="st-steps">
              <div className="st-steps-title">Do this in the i'llTip app</div>
              <ol>
                <li>Open the i'llTip app and sign in as {email || 'this account'}.</li>
                <li>Go to Profile, then tap ⋯ to open Settings.</li>
                <li>Tap Delete Account and confirm with your password.</li>
              </ol>
            </div>
            <p className="muted small" style={{ margin: 0 }}>
              We keep this in the app so we can confirm it's really you. Can't use the app? Email{' '}
              <a href="mailto:info@illtip.com?subject=Delete%20my%20i'llTip%20account">info@illtip.com</a> from your account email.
            </p>
            <AppStoreButtons />
          </div>
        )}
        {appOnly === 'language' && (
          <div className="stack">
            <p style={{ margin: 0 }}>i'llTip on the web is in English for now. The app is available in English, Spanish and French: change it in the app under Settings → Language.</p>
            <AppStoreButtons />
          </div>
        )}
      </Modal>
    </div>
  );
}

import React from 'react';
import { Link, useLocation } from '../lib/router';
import { Avatar, Icon } from './kit';
import { StoreButtons, detectPlatform, storeLink } from './AppBanner';
import { APP_LINKS, ENV_NAME } from '../lib/env';
import { useAuth } from '../lib/auth';
import { useQuery } from '../lib/query';
import { api } from '../lib/api';
import { acquireInboxSocket } from '../features/chat/socket';
import { useEffect } from 'react';

const TABS = [
  { to: '/', label: 'Home', icon: 'home', match: (p: string) => p === '/' || p.startsWith('/post') || p.startsWith('/search') },
  { to: '/jobs', label: 'Jobs', icon: 'jobs', match: (p: string) => p.startsWith('/jobs') },
  { to: '/chat', label: 'Chat', icon: 'chat', match: (p: string) => p.startsWith('/chat') },
  { to: '/hire', label: 'Hire Pros', icon: 'search', match: (p: string) => p.startsWith('/hire') },
  { to: '/profile', label: 'Profile', icon: 'user', match: (p: string) => p.startsWith('/profile') || p.startsWith('/u/') },
];

function useNotifCount(enabled: boolean) {
  const q = useQuery(enabled ? 'notif:count' : null, async () => {
    const { data } = await api.get('/notification/v2/overlook');
    const d = data?.data;
    return Number((Array.isArray(d) ? d[0]?.count : d?.count) ?? data?.count ?? 0) || 0;
  }, { staleMs: 60_000 });
  return q.data || 0;
}

export function Shell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const notif = useNotifCount(!!user);
  useEffect(() => (user?.id ? acquireInboxSocket(user.id) : undefined), [user?.id]);
  const brand = (
    <Link to="/" className="brand">
      <img src="logo.png" alt="" />
      <span>i'llTip</span>
    </Link>
  );
  return (
    <div className="shell">
      <aside className="sidebar">
        {brand}
        <nav className="nav">
          {TABS.map((t) => (
            <Link key={t.to} to={t.to} className={t.match(pathname) ? 'active' : ''}>
              <Icon name={t.icon} /> {t.label}
            </Link>
          ))}
          <Link to="/notifications" className={pathname.startsWith('/notifications') ? 'active' : ''}>
            <Icon name="bell" /> Notifications {notif > 0 && <span className="badge">{notif > 99 ? '99+' : notif}</span>}
          </Link>
          <Link to="/wallet" className={pathname.startsWith('/wallet') || pathname.startsWith('/referral') ? 'active' : ''}>
            <Icon name="wallet" /> Wallet & Referrals
          </Link>
          <Link to="/settings" className={pathname.startsWith('/settings') ? 'active' : ''}>
            <Icon name="settings" /> Settings
          </Link>
          <a href="https://jobs.illtip.com/" title="All open jobs on jobs.illtip.com">
            <Icon name="jobs" /> Job board ↗
          </a>
        </nav>
        <div className="spacer" />
        <div className="get-app">
          <div className="get-app-title">Get the i'llTip app</div>
          <StoreButtons compact />
        </div>
      </aside>
      <header className="topbar">
        {brand}
        <div className="grow" />
        {detectPlatform() !== 'other' && (
          <a className="topbar-getapp" href={storeLink()} target="_blank" rel="noreferrer">
            Get app
          </a>
        )}
        <Link to="/notifications" className="icon-btn" title="Notifications">
          <Icon name="bell" />
          {notif > 0 && <span className="badge">{notif > 99 ? '99+' : notif}</span>}
        </Link>
        <Link to="/settings" className="icon-btn" title="Settings">
          <Icon name="settings" />
        </Link>
      </header>
      <main className="main">
        <div className={'content' + (wide ? ' wide' : '')}>{children}</div>
      </main>
      <nav className="tabbar">
        {TABS.map((t) => (
          <Link key={t.to} to={t.to} className={t.match(pathname) ? 'active' : ''}>
            <span className="tab-pill">
              {t.icon === 'user' && user?.imageUrl ? <span className="tab-avatar"><Avatar src={user.imageUrl} name={user.name} size={24} /></span> : <Icon name={t.icon} />}
            </span>
            <span className="tab-label">{t.label}</span>
          </Link>
        ))}
      </nav>
      {ENV_NAME !== 'PROD' && <div className="env-pill">TEST SERVER ({ENV_NAME})</div>}
    </div>
  );
}

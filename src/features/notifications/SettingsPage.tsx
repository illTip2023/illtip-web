/**
 * Mirrors illtip-mobile NotificationSettingsScreen. The app keeps these toggles locally (there is no
 * backend endpoint for them), so the web keeps them in this browser too.
 */
import React, { useState } from 'react';
import { useAuth } from '../../lib/auth';
import { APP_LINKS } from '../../lib/env';
import { PageHeader } from '../../ui/kit';

type Key = 'likes' | 'comments' | 'bookmarks' | 'transactions' | 'serviceRequests' | 'jobOfferings' | 'appUpdates';
const GROUPS: { title: string; items: { key: Key; label: string }[] }[] = [
  {
    title: 'Activity',
    items: [
      { key: 'likes', label: 'Likes' },
      { key: 'comments', label: 'Comments' },
      { key: 'bookmarks', label: 'Bookmarks' },
      { key: 'transactions', label: 'Transactions' },
    ],
  },
  {
    title: 'Work and updates',
    items: [
      { key: 'serviceRequests', label: 'Service Requests' },
      { key: 'jobOfferings', label: 'Job Offerings' },
      { key: 'appUpdates', label: 'App Updates' },
    ],
  },
];
const DEFAULTS: Record<Key, boolean> = {
  likes: true,
  comments: false,
  bookmarks: true,
  transactions: true,
  serviceRequests: true,
  jobOfferings: false,
  appUpdates: true,
};

const keyFor = (u: string) => `illtip.notifPrefs.${u}`;
function load(u: string): Record<Key, boolean> {
  try {
    const raw = localStorage.getItem(keyFor(u));
    return { ...DEFAULTS, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function NotificationSettingsPage() {
  const { user } = useAuth();
  const uid = user?.id || 'anon';
  const [prefs, setPrefs] = useState<Record<Key, boolean>>(() => load(uid));

  const toggle = (k: Key) =>
    setPrefs((p) => {
      const next = { ...p, [k]: !p[k] };
      try {
        localStorage.setItem(keyFor(uid), JSON.stringify(next));
      } catch {
        /* storage blocked: keep in memory */
      }
      return next;
    });

  return (
    <div className="notif-page">
      <PageHeader title="Notification settings" back="/notifications" />
      {GROUPS.map((g) => (
        <div key={g.title} className="notif-section">
          <div className="notif-section-title">{g.title}</div>
          <div className="notif-card">
            {g.items.map((it) => (
              <label key={it.key} className="pref-row">
                <span>{it.label}</span>
                <button type="button" role="switch" aria-checked={prefs[it.key]} aria-label={`${it.label} notifications`} className={'pref-toggle' + (prefs[it.key] ? ' on' : '')} onClick={() => toggle(it.key)}>
                  <span />
                </button>
              </label>
            ))}
          </div>
        </div>
      ))}
      <p className="muted small notif-note">
        These preferences are saved in this browser. Push notifications to your phone are managed in the i'llTip app (
        <a href={APP_LINKS.ios} target="_blank" rel="noreferrer">
          iPhone
        </a>{' '}
        ·{' '}
        <a href={APP_LINKS.android} target="_blank" rel="noreferrer">
          Android
        </a>
        ).
      </p>
    </div>
  );
}

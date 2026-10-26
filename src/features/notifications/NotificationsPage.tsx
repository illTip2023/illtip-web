import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { invalidate, useInfinite, useOnVisible } from '../../lib/query';
import { Link, navigate } from '../../lib/router';
import { Avatar, Empty, ErrorBox, Icon, PageHeader, Spinner, toast } from '../../ui/kit';
import { onChatEvent, useChatSocketStatus } from '../chat/socket';
import {
  ACTION_TEXT,
  daySection,
  deleteNotifications,
  fetchNotifications,
  isTransaction,
  markAllOverlooked,
  NotificationDoc,
  notificationRoute,
  resolveType,
  setFav,
  setSeen,
  toDate,
} from './api';

type Tab = 'all' | 'tx' | 'fav';
const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'All Notifications' },
  { id: 'tx', label: 'Transactions' },
  { id: 'fav', label: 'Starred' },
];

const TYPE_ICON: Record<string, string> = {
  like: 'heart',
  comment: 'comment',
  mention: 'comment',
  chat: 'chat',
  profile: 'user',
  coin: 'coin',
  hire: 'jobs',
  service_request: 'jobs',
  job: 'jobs',
  save: 'bookmark',
  post: 'image',
};

const MARKUP = /(\*\*[^*]+\*\*)|(\[\[[^\]]+\]\])|(\$\d+(?:\.\d{1,2})?)|(@\w+)/g;
function Markup({ text }: { text: string }) {
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  MARKUP.lastIndex = 0;
  while ((m = MARKUP.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('**')) out.push(<strong key={m.index}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith('[[')) out.push(<span key={m.index} className="notif-link">{t.slice(2, -2)}</span>);
    else if (t.startsWith('$')) out.push(<span key={m.index} className="notif-amount">{t}</span>);
    else out.push(<strong key={m.index}>{t}</strong>);
    last = MARKUP.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

export function NotificationsPage() {
  const { user } = useAuth();
  const me = user?.id || '';
  const socket = useChatSocketStatus(me);
  const [tab, setTab] = useState<Tab>('all');
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const list = useInfinite<NotificationDoc>(me ? 'notif:list:' + me : null, (p) => fetchNotifications(p));
  const sentinel = useOnVisible(() => list.loadMore());
  const { setItems } = list;

  // Opening the screen clears the badge (app: markAllOverlooked on mount).
  useEffect(() => {
    markAllOverlooked()
      .then(() => invalidate('notif:count'))
      .catch(() => {});
  }, []);

  const prepend = useCallback(
    (docs: NotificationDoc[]) => {
      if (!docs.length) return;
      setItems((old) => {
        const have = new Set(old.map((n) => n.requestId));
        const fresh = docs.filter((d) => d && d.requestId && !have.has(d.requestId));
        return fresh.length ? [...fresh, ...old] : old;
      });
    },
    [setItems],
  );

  // Live: socket `notification` event (app: onInboxChatSocketEvent('notification')), plus polling fallback.
  useEffect(() => onChatEvent('notification', (doc: any) => doc && typeof doc === 'object' && prepend([doc])), [prepend]);
  useEffect(() => {
    const every = socket === 'connected' ? 120_000 : 30_000;
    const t = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      fetchNotifications(1)
        .then((r) => prepend(r.items))
        .catch(() => {});
    }, every);
    return () => clearInterval(t);
  }, [socket, prepend]);

  useEffect(() => {
    if (!menuFor) return;
    const on = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.notif-menu, .notif-more')) setMenuFor(null);
    };
    document.addEventListener('mousedown', on);
    return () => document.removeEventListener('mousedown', on);
  }, [menuFor]);

  const patch = (requestId: string, p: Partial<NotificationDoc>) => setItems((old) => old.map((n) => (n.requestId === requestId ? { ...n, ...p } : n)));

  const toggleSeen = async (n: NotificationDoc, isSeen = !n.isSeen) => {
    patch(n.requestId, { isSeen });
    try {
      await setSeen(n.requestId, isSeen);
    } catch {
      patch(n.requestId, { isSeen: n.isSeen });
      toast.error('Could not update notification');
    }
  };
  const toggleFav = async (n: NotificationDoc) => {
    const isFav = !n.isFav;
    patch(n.requestId, { isFav });
    try {
      await setFav(n.requestId, isFav);
    } catch {
      patch(n.requestId, { isFav: n.isFav });
      toast.error('Could not update notification');
    }
  };
  const remove = async (n: NotificationDoc) => {
    setMenuFor(null);
    const before = list.items;
    setItems((old) => old.filter((x) => x.requestId !== n.requestId));
    try {
      await deleteNotifications([n.requestId]);
      toast.ok('Notification deleted');
    } catch {
      setItems(before);
      toast.error('Could not delete notification');
    }
  };
  const markAllRead = async () => {
    const unseen = list.items.filter((n) => !n.isSeen);
    if (!unseen.length) return;
    setItems((old) => old.map((n) => ({ ...n, isSeen: true })));
    await Promise.allSettled(unseen.map((n) => setSeen(n.requestId, true)));
  };

  const open = (n: NotificationDoc) => {
    if (!n.isSeen) toggleSeen(n, true);
    const to = notificationRoute(n);
    if (to) navigate(to);
  };

  const filtered = useMemo(() => list.items.filter((n) => (tab === 'all' ? true : tab === 'tx' ? isTransaction(n) : n.isFav)), [list.items, tab]);
  const sections = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, NotificationDoc[]>();
    for (const n of filtered) {
      const s = daySection(n.createdTimeUnix);
      if (!map.has(s)) {
        map.set(s, []);
        order.push(s);
      }
      map.get(s)!.push(n);
    }
    return order.map((s) => ({ title: s, items: map.get(s)! }));
  }, [filtered]);
  const unseenCount = list.items.filter((n) => !n.isSeen).length;

  return (
    <div className="notif-page">
      <PageHeader
        title="Notifications"
        right={
          <div className="row" style={{ gap: 4 }}>
            {unseenCount > 0 && (
              <button className="btn btn-ghost btn-sm" onClick={markAllRead}>
                <Icon name="check" size={16} /> <span className="notif-hide-xs">Mark all as read</span>
              </button>
            )}
            <Link to="/notifications/settings" className="icon-btn" title="Notification settings">
              <Icon name="settings" />
            </Link>
          </div>
        }
      />
      <div className="notif-segment" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {list.error && !list.items.length && <ErrorBox error={list.error} onRetry={list.reload} />}

      {sections.map((sec) => (
        <div key={sec.title} className="notif-section">
          <div className="notif-section-title">{sec.title}</div>
          <div className="notif-card">
            {sec.items.map((n) => {
              const rt = resolveType(n);
              const route = notificationRoute(n);
              const action = rt ? ACTION_TEXT[rt] : undefined;
              const time = toDate(n.createdTimeUnix);
              const avatar = typeof n.base64Details === 'string' && /^(https?:|data:)/.test(n.base64Details) ? n.base64Details : undefined;
              const body = n.body && n.body.trim() && n.body.trim() !== n.subject?.trim() ? n.body.trim() : '';
              return (
                <div key={n.requestId} className={'notif-row' + (n.isSeen ? '' : ' unseen') + (route ? ' clickable' : '')}>
                  <button className="notif-main" onClick={() => open(n)} aria-label={n.subject}>
                    <div className="notif-avatar">
                      {avatar ? (
                        <Avatar src={avatar} name={n.username || n.title || "i'llTip"} size={46} />
                      ) : (
                        <div className={'notif-type-icon t-' + (rt || 'generic')}>
                          <Icon name={TYPE_ICON[rt || ''] || 'bell'} size={20} />
                        </div>
                      )}
                      {avatar && rt && (
                        <span className={'notif-type-badge t-' + rt}>
                          <Icon name={TYPE_ICON[rt] || 'bell'} size={11} />
                        </span>
                      )}
                    </div>
                    <div className="notif-text">
                      <div className="notif-subject">
                        <Markup text={n.subject || n.title || 'Notification'} />
                      </div>
                      {body && <div className="notif-body">{body}</div>}
                      <div className="notif-meta">
                        <span title={isNaN(time.getTime()) ? '' : time.toLocaleString()}>
                          {isNaN(time.getTime()) || time.getTime() === 0 ? '' : time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {action && route && <span className="notif-action">{action}</span>}
                      </div>
                    </div>
                    {!n.isSeen && <span className="notif-dot" aria-label="Unread" />}
                  </button>
                  <div className="notif-side">
                    <button className={'icon-btn notif-star' + (n.isFav ? ' on' : '')} aria-label={n.isFav ? 'Unstar' : 'Star'} title={n.isFav ? 'Unstar' : 'Star'} onClick={() => toggleFav(n)}>
                      <Icon name="star" size={18} fill={n.isFav} />
                    </button>
                    <div className="notif-more-wrap">
                      <button className="icon-btn notif-more" aria-label="More actions" onClick={() => setMenuFor(menuFor === n.requestId ? null : n.requestId)}>
                        <Icon name="more" size={18} />
                      </button>
                      {menuFor === n.requestId && (
                        <div className="notif-menu" role="menu">
                          <button
                            role="menuitem"
                            onClick={() => {
                              setMenuFor(null);
                              toggleSeen(n);
                            }}
                          >
                            <Icon name="check" size={16} /> {n.isSeen ? 'Mark as unread' : 'Mark as read'}
                          </button>
                          <button role="menuitem" className="danger" onClick={() => remove(n)}>
                            <Icon name="close" size={16} /> Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {list.loading && <Spinner />}
      {!list.loading && !list.error && filtered.length === 0 && (
        <Empty title={tab === 'fav' ? 'No starred notifications' : tab === 'tx' ? 'No transactions yet' : 'No notifications yet'}>
          {tab === 'fav' ? 'Star a notification to keep it here.' : "We'll let you know when something happens."}
        </Empty>
      )}
      <div ref={sentinel} className="notif-more-sentinel">
        {list.hasMore && !list.loading && list.items.length > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={() => list.loadMore()}>
            Load more
          </button>
        )}
      </div>
    </div>
  );
}

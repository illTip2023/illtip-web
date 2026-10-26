import React, { useMemo, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { useOnVisible } from '../../lib/query';
import { Link, navigate } from '../../lib/router';
import { Avatar, ErrorBox, Icon, Spinner } from '../../ui/kit';
import { listTime, peerOfRow, rowPreview } from './api';
import { loadMoreInbox, refreshInbox, rememberPeer, unreadTotal, useInbox } from './inbox';
import { BotAvatar, Ico } from './shared';
import type { SocketStatus } from './socket';

export function ChatList({ activeRoomId, mode, socket }: { activeRoomId?: string; mode: string; socket: SocketStatus }) {
  const { user } = useAuth();
  const me = user?.id || '';
  const inbox = useInbox();
  const [q, setQ] = useState('');
  const sentinel = useOnVisible(() => loadMoreInbox(me));

  const rows = useMemo(() => {
    const list = inbox.rows.map((r) => ({ row: r, peer: peerOfRow(r, me), preview: rowPreview(r, me) }));
    const s = q.trim().toLowerCase();
    return s ? list.filter((x) => x.peer.name.toLowerCase().includes(s) || x.preview.text.toLowerCase().includes(s)) : list;
  }, [inbox.rows, me, q]);
  const unread = unreadTotal(inbox.rows);

  return (
    <section className="chat-list" aria-label="Conversations">
      <div className="chat-list-head">
        <div className="row between">
          <h1>
            Chats {unread > 0 && <span className="badge chat-head-badge">{unread}</span>}
          </h1>
          <div className="row" style={{ gap: 4 }}>
            <span className={'chat-live ' + (socket === 'connected' ? 'on' : '')} title={socket === 'connected' ? 'Live updates on' : 'Live updates unavailable; refreshing automatically'} />
            <button className="icon-btn" title="New chat" aria-label="New chat" onClick={() => navigate('/chat/new' + (q.trim() ? '?q=' + encodeURIComponent(q.trim()) : ''))}>
              <Ico name="pen" size={20} />
            </button>
          </div>
        </div>
        <div className="chat-search">
          <Icon name="search" size={18} />
          <input
            className="chat-search-input"
            placeholder="Search chats"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && q.trim() && rows.length === 0) navigate('/chat/new?q=' + encodeURIComponent(q.trim()));
            }}
            aria-label="Search chats"
          />
          {q && (
            <button className="icon-btn" aria-label="Clear search" onClick={() => setQ('')}>
              <Icon name="close" size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="chat-list-scroll">
        <Link to="/chat/ai" className={'chat-row chat-row-ai' + (mode === 'ai' ? ' active' : '')}>
          <div className="chat-avatar-wrap">
            <BotAvatar size={48} />
            <span className="chat-online-dot" />
          </div>
          <div className="chat-row-main">
            <div className="chat-row-top">
              <span className="chat-row-name">AI Chatbot</span>
            </div>
            <div className="chat-row-preview">
              <span className="chat-green-dot" /> Online — Ask me anything
            </div>
          </div>
        </Link>

        {inbox.error && !inbox.loaded && <ErrorBox error={inbox.error} onRetry={() => refreshInbox(me)} />}
        {!inbox.loaded && inbox.loading && <Spinner />}

        {rows.map(({ row, peer, preview }) => {
          const unreadN = Number(row.unseenCount) || 0;
          return (
            <Link
              key={row.roomId}
              to={'/chat/' + encodeURIComponent(row.roomId)}
              onClick={() => rememberPeer(row.roomId, peer)}
              className={'chat-row' + (activeRoomId === row.roomId ? ' active' : '') + (unreadN > 0 ? ' unread' : '')}
            >
              <Avatar src={peer.avatar} name={peer.name} size={48} />
              <div className="chat-row-main">
                <div className="chat-row-top">
                  <span className="chat-row-name ellipsis">{peer.name}</span>
                  <span className="chat-row-time">{listTime(row.sentTime)}</span>
                </div>
                <div className="chat-row-bottom">
                  <span className={'chat-row-preview ellipsis' + (preview.text.includes('deleted') && row.isDeleted ? ' italic' : '')}>
                    {preview.out && <Ico name={row.seen ? 'ticks' : 'tick'} size={14} className={'chat-tick' + (row.seen ? ' seen' : '')} />}
                    {preview.out && !row.isDeleted ? 'You: ' : ''}
                    {preview.text}
                  </span>
                  {unreadN > 0 && <span className="chat-unread">{unreadN > 99 ? '99+' : unreadN}</span>}
                </div>
              </div>
            </Link>
          );
        })}

        {inbox.loaded && rows.length === 0 && (
          <div className="chat-empty-list">
            {q ? (
              <>
                <div className="muted">No chats match “{q}”.</div>
                <button className="btn btn-sm" onClick={() => navigate('/chat/new?q=' + encodeURIComponent(q.trim()))}>
                  Search people
                </button>
              </>
            ) : (
              <>
                <div className="empty-title">No conversations yet</div>
                <div className="muted small">Start a chat with a pro or a client.</div>
                <button className="btn btn-sm" onClick={() => navigate('/chat/new')}>
                  <Icon name="plus" size={16} /> New chat
                </button>
              </>
            )}
          </div>
        )}
        <div ref={sentinel} className="chat-more">
          {inbox.loaded && inbox.hasMore && !q && (inbox.loading ? <div className="spinner" /> : <button className="btn btn-ghost btn-sm" onClick={() => loadMoreInbox(me)}>Load more</button>)}
        </div>
      </div>
    </section>
  );
}

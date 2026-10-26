import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { useInfinite, useOnVisible } from '../../lib/query';
import { navigate, useQueryParams } from '../../lib/router';
import { Avatar, ErrorBox, Icon, Spinner, toast } from '../../ui/kit';
import { fetchRoomId, peerOfRow, PersonRow, sameUser, searchPeople } from './api';
import { rememberPeer, rowForPeer } from './inbox';

function roomUrl(roomId: string, p: { userId: string; name?: string }) {
  const q = new URLSearchParams({ u: p.userId });
  if (p.name) q.set('n', p.name);
  return `/chat/${encodeURIComponent(roomId)}?${q}`;
}

/** Opens (or creates) the 1:1 room with a user, like ChatUserSearchScreen → ChatScreen. */
export async function openChatWith(me: string, p: { userId: string; name?: string; avatar?: string }, replace = false) {
  const row = rowForPeer(p.userId, me);
  let roomId = row?.roomId;
  if (!roomId) roomId = await fetchRoomId(me, p.userId);
  if (!roomId) throw new Error('Could not start this chat. Please try again.');
  const peer = row ? peerOfRow(row, me) : undefined;
  rememberPeer(roomId, { peerId: p.userId, name: peer?.name !== 'User' ? peer?.name || p.name : p.name, avatar: peer?.avatar || p.avatar });
  navigate(roomUrl(roomId, { userId: p.userId, name: p.name || peer?.name }), { replace });
}

export function ChatNew({ wide }: { wide: boolean }) {
  const { user } = useAuth();
  const me = user?.id || '';
  const qp = useQueryParams();
  const directPeer = qp.get('u');
  const [q, setQ] = useState(qp.get('q') || '');
  const [debounced, setDebounced] = useState(q.trim());
  const [opening, setOpening] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    if (!directPeer) inputRef.current?.focus();
  }, [directPeer]);

  // /chat/new?u=<userId>&n=<name> opens that conversation straight away (used by notifications/profiles).
  const [directError, setDirectError] = useState<any>();
  useEffect(() => {
    if (!directPeer || !me) return;
    if (sameUser(directPeer, me)) {
      navigate('/chat', { replace: true });
      return;
    }
    openChatWith(me, { userId: directPeer, name: qp.get('n') || undefined }, true).catch(setDirectError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directPeer, me]);

  const list = useInfinite<PersonRow>(directPeer ? null : 'chat:people:' + debounced, (page) => searchPeople(debounced, page));
  const sentinel = useOnVisible(() => list.loadMore());

  const people = list.items.filter((p, i, a) => !sameUser(p.userId, me) && a.findIndex((x) => sameUser(x.userId, p.userId)) === i);
  const shown = debounced ? people.filter((p) => p.name.toLowerCase().includes(debounced.toLowerCase())) : people;

  const pick = async (p: PersonRow) => {
    setOpening(p.userId);
    try {
      await openChatWith(me, p, !wide);
    } catch (e: any) {
      toast.error(e?.message || 'Could not start chat');
    } finally {
      setOpening(null);
    }
  };

  if (directPeer) {
    return (
      <section className="thread">
        {directError ? (
          <div style={{ padding: 16 }}>
            <ErrorBox error={directError} onRetry={() => location.reload()} />
          </div>
        ) : (
          <Spinner label="Opening chat…" />
        )}
      </section>
    );
  }

  return (
    <section className="thread chat-new" aria-label="New chat">
      <div className="thread-head">
        <button className="icon-btn" aria-label="Back to chats" onClick={() => navigate('/chat')}>
          <Icon name={wide ? 'close' : 'back'} />
        </button>
        <div className="thread-peer-name">New chat</div>
      </div>
      <div className="chat-new-search">
        <div className="chat-search">
          <Icon name="search" size={18} />
          <input ref={inputRef} className="chat-search-input" placeholder="Search people by name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people" />
          {q && (
            <button className="icon-btn" aria-label="Clear search" onClick={() => setQ('')}>
              <Icon name="close" size={16} />
            </button>
          )}
        </div>
      </div>
      <div className="thread-scroll chat-new-list">
        {list.error && <ErrorBox error={list.error} onRetry={list.reload} />}
        {shown.map((p) => (
          <button key={p.userId} className="chat-row person-row" onClick={() => pick(p)} disabled={!!opening}>
            <Avatar src={p.avatar} name={p.name} size={46} />
            <div className="chat-row-main">
              <div className="chat-row-name ellipsis">{p.name}</div>
              {p.service && <div className="chat-row-preview ellipsis">{p.service}</div>}
            </div>
            {opening === p.userId ? <div className="spinner small-spinner" /> : <Icon name="chat" size={18} />}
          </button>
        ))}
        {list.loading && <Spinner />}
        {!list.loading && !list.error && shown.length === 0 && <div className="chat-empty-list muted">{debounced ? 'No users match your search.' : 'No people to show yet.'}</div>}
        <div ref={sentinel} className="chat-more">
          {list.hasMore && !list.loading && shown.length > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={() => list.loadMore()}>
              Show more people
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

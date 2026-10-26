import React, { useCallback, useEffect } from 'react';
import type { RouteDef } from '../../lib/router';
import { navigate, useLocation, useParams } from '../../lib/router';
import { useAuth } from '../../lib/auth';
import { invalidate } from '../../lib/query';
import { Icon } from '../../ui/kit';
import { AIChat } from './AIChat';
import { toChatMsg } from './api';
import { ChatList } from './ChatList';
import { ChatNew } from './ChatNew';
import { ChatThread } from './ChatThread';
import { applyMessageToInbox, refreshInbox } from './inbox';
import { BotAvatar, useFillHeight, useMediaQuery } from './shared';
import { CHAT_SOCKET_EVENTS, onChatEvent, useChatSocketStatus } from './socket';
import './chat.css';

function EmptyPane() {
  return (
    <section className="thread chat-placeholder">
      <div className="chat-placeholder-inner">
        <div className="chat-placeholder-icon">
          <Icon name="chat" size={34} />
        </div>
        <h2>Your messages</h2>
        <p className="muted">Pick a conversation on the left, start a new one, or ask the AI Chatbot about jobs and your career.</p>
        <div className="row" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => navigate('/chat/new')}>
            <Icon name="plus" size={18} /> New chat
          </button>
          <button className="btn btn-ghost" onClick={() => navigate('/chat/ai')}>
            <BotAvatar size={22} /> AI Chatbot
          </button>
        </div>
      </div>
    </section>
  );
}

/** One component for /chat, /chat/new, /chat/ai and /chat/:roomId so the list keeps its state. */
function ChatPage() {
  const { pathname } = useLocation();
  const { roomId } = useParams<{ roomId?: string }>();
  const { user } = useAuth();
  const me = user?.id || '';
  const wide = useMediaQuery('(min-width: 1000px)');
  const fillRef = useFillHeight<HTMLDivElement>(wide ? 16 : 0);
  const socket = useChatSocketStatus(me);

  const mode = pathname === '/chat/new' ? 'new' : pathname === '/chat/ai' ? 'ai' : roomId ? 'room' : 'list';
  const openRoom = mode === 'room' ? roomId : undefined;

  // Inbox: load now, then poll (fast when the socket is down), refresh on focus.
  useEffect(() => {
    if (!me) return;
    refreshInbox(me);
    const every = socket === 'connected' ? 60_000 : 20_000;
    const t = setInterval(() => document.visibilityState === 'visible' && refreshInbox(me), every);
    const onFocus = () => refreshInbox(me);
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', onFocus);
    };
  }, [me, socket]);

  // Live messages for any room update the list (unknown room → refetch the list).
  const onMessage = useCallback(
    (p: any) => {
      if (!p || typeof p !== 'object' || !me) return;
      const m = toChatMsg(p);
      if (!applyMessageToInbox(m, me, { openRoomId: openRoom })) refreshInbox(me);
    },
    [me, openRoom],
  );
  useEffect(() => {
    const offs = [
      onChatEvent(CHAT_SOCKET_EVENTS.message, onMessage),
      onChatEvent(CHAT_SOCKET_EVENTS.notification, () => invalidate('notif:')),
      onChatEvent(CHAT_SOCKET_EVENTS.chatNotification, () => me && refreshInbox(me)),
    ];
    return () => offs.forEach((f) => f());
  }, [onMessage, me]);

  const showList = wide || mode === 'list';
  const showPane = wide || mode !== 'list';

  return (
    <div className={'chat-layout ' + (wide ? 'two-pane' : 'one-pane')} ref={fillRef}>
      {showList && <ChatList activeRoomId={openRoom} mode={mode} socket={socket} />}
      {showPane && (
        <div className="chat-pane">
          {mode === 'room' && roomId ? (
            <ChatThread key={roomId} roomId={roomId} socket={socket} wide={wide} />
          ) : mode === 'new' ? (
            <ChatNew wide={wide} />
          ) : mode === 'ai' ? (
            <AIChat wide={wide} />
          ) : (
            <EmptyPane />
          )}
        </div>
      )}
    </div>
  );
}

/** Routes owned by the chat feature. Specific paths first (first match wins). */
export const routes: RouteDef[] = [
  { path: '/chat', element: ChatPage, auth: true },
  { path: '/chat/new', element: ChatPage, auth: true },
  { path: '/chat/ai', element: ChatPage, auth: true },
  { path: '/chat/:roomId', element: ChatPage, auth: true },
];

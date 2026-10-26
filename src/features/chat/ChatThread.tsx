import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { Link, navigate, useQueryParams } from '../../lib/router';
import { Avatar, ErrorBox, Icon, Modal, Spinner, toast } from '../../ui/kit';
import {
  attachmentKind,
  buildReply,
  ChatMsg,
  compareMsgs,
  dayLabel,
  decodeName,
  deleteChatMessage,
  DELETE_FOR_EVERYONE_WINDOW_MS,
  editChatMessage,
  EDIT_WINDOW_MS,
  fetchRoomMessages,
  inferFileType,
  isAttachment,
  markRoomSeen,
  msgSortMs,
  parseReply,
  previewLine,
  sameUser,
  sendChatMessage,
  toChatMsg,
  uploadChatFile,
} from './api';
import { applyMessageToInbox, clearUnread, peerForRoom, rememberPeer, useInbox } from './inbox';
import { Attachment, Ico, Linkified, useMediaQuery } from './shared';
import { CHAT_SOCKET_EVENTS, emitChatEvent, onChatEvent, SocketStatus } from './socket';

const PAGE = 30;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
type MsgMap = Record<string, ChatMsg>;

function mergeInto(prev: MsgMap, rows: ChatMsg[]): MsgMap {
  const next = { ...prev };
  for (const r of rows) {
    if (!r.msgId) continue;
    if (r.clientSentAtMs) {
      for (const [k, v] of Object.entries(next)) if (v.temp && !v.failed && v.clientSentAtMs === r.clientSentAtMs) delete next[k];
    }
    const old = next[r.msgId];
    next[r.msgId] = old ? { ...old, ...r, localUrl: old.localUrl, seen: r.seen || old.seen } : r;
  }
  return next;
}

export function ChatThread({ roomId, socket, wide }: { roomId: string; socket: SocketStatus; wide: boolean }) {
  const { user } = useAuth();
  const me = user?.id || '';
  const qp = useQueryParams();
  useInbox(); // re-render when list info (peer name/avatar) arrives
  const touch = useMediaQuery('(hover: none)');

  const [msgs, setMsgs] = useState<MsgMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<any>();
  const [reloadKey, setReloadKey] = useState(0);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const pageRef = useRef(1);

  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMsg | null>(null);
  const [editing, setEditing] = useState<ChatMsg | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ChatMsg | null>(null);
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(null);
  const [dragging, setDragging] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const atBottom = useRef(true);
  const forceBottom = useRef(true);
  const restore = useRef<{ h: number; top: number } | null>(null);

  const sorted = useMemo(() => Object.values(msgs).sort(compareMsgs), [msgs]);

  // ── peer ──
  const known = peerForRoom(roomId, me);
  const fromMsgs = useMemo(() => {
    const m = sorted.find((x) => x.senderId && x.recipientId);
    return m ? (sameUser(m.senderId, me) ? m.recipientId : m.senderId) : '';
  }, [sorted, me]);
  const peerId = qp.get('u') || known?.peerId || fromMsgs;
  const peerName = (known?.name && known.name !== 'User' ? known.name : '') || qp.get('n') || known?.name || 'User';
  const peerAvatar = known?.avatar || qp.get('a') || undefined;
  const peer = useMemo(() => ({ peerId, name: peerName, avatar: peerAvatar }), [peerId, peerName, peerAvatar]);
  useEffect(() => {
    if (peerId) rememberPeer(roomId, peer);
  }, [roomId, peer, peerId]);

  // ── read receipts (mirror app: POST /chat/markseen { roomId } + `seen` emit) ──
  const seenBusy = useRef(false);
  const markSeen = useCallback(
    (list?: ChatMsg[]) => {
      clearUnread(roomId);
      if (document.visibilityState !== 'visible' || seenBusy.current) return;
      const pending = (list || []).filter((m) => !m.seen && !m.temp && !sameUser(m.senderId, me));
      if (list && pending.length === 0) return;
      seenBusy.current = true;
      const last = pending[pending.length - 1];
      if (last) emitChatEvent(CHAT_SOCKET_EVENTS.seen, { roomId, msgId: last.msgId, senderId: last.senderId, recipientId: me, msg: last.msg, sentTime: last.sentTime, seen: false });
      markRoomSeen(roomId)
        .then(() => setMsgs((prev) => {
          const next = { ...prev };
          for (const m of pending) if (next[m.msgId]) next[m.msgId] = { ...next[m.msgId], seen: true };
          return next;
        }))
        .catch(() => {})
        .finally(() => (seenBusy.current = false));
    },
    [roomId, me],
  );

  // ── initial load ──
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(undefined);
    fetchRoomMessages(roomId, 1, PAGE)
      .then((rows) => {
        if (!alive) return;
        forceBottom.current = true;
        setMsgs((p) => mergeInto(p, rows));
        setHasOlder(rows.length >= PAGE);
        pageRef.current = 1;
        setLoading(false);
        markSeen(rows);
        clearUnread(roomId);
      })
      .catch((e) => {
        if (!alive) return;
        setError(e);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [roomId, markSeen, reloadKey]);

  // ── polling fallback (fast when the socket is down) ──
  const poll = useCallback(async () => {
    try {
      const rows = await fetchRoomMessages(roomId, 1, PAGE);
      setMsgs((p) => mergeInto(p, rows));
      markSeen(rows);
    } catch {
      /* keep quiet; next tick retries */
    }
  }, [roomId, markSeen]);
  useEffect(() => {
    const every = socket === 'connected' ? 15_000 : 5_000;
    const t = setInterval(() => document.visibilityState === 'visible' && poll(), every);
    const onVis = () => document.visibilityState === 'visible' && poll();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
    };
  }, [socket, poll]);

  // ── live socket events ──
  useEffect(() => {
    const belongs = (m: { roomId?: string; senderId?: string; recipientId?: string }) =>
      (m.roomId && String(m.roomId) === roomId) ||
      (!!peerId && ((sameUser(m.senderId, peerId) && sameUser(m.recipientId, me)) || (sameUser(m.senderId, me) && sameUser(m.recipientId, peerId))));
    const patch = (p: any, fields: (old: ChatMsg) => Partial<ChatMsg>) => {
      const id = String(p?.msgId ?? '');
      if (!id) return;
      setMsgs((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], ...fields(prev[id]) } } : prev));
    };
    const offs = [
      onChatEvent(CHAT_SOCKET_EVENTS.message, (p: any) => {
        if (!p || typeof p !== 'object' || !belongs(p)) return;
        const m = toChatMsg(p);
        if (!m.msgId) return;
        setMsgs((prev) => mergeInto(prev, [m]));
        if (!sameUser(m.senderId, me)) markSeen([m]);
      }),
      onChatEvent(CHAT_SOCKET_EVENTS.seen, (p: any) => p && belongs(p) && patch(p, () => ({ seen: true }))),
      onChatEvent(CHAT_SOCKET_EVENTS.delete, (p: any) => p && patch(p, () => ({ isDeleted: true }))),
      onChatEvent(CHAT_SOCKET_EVENTS.edit, (p: any) => p && typeof p.msg === 'string' && patch(p, () => ({ msg: p.msg, isEdited: true }))),
    ];
    return () => offs.forEach((f) => f());
  }, [roomId, peerId, me, markSeen]);

  // ── scrolling ──
  const lastKey = sorted.length ? sorted[sorted.length - 1].msgId + ':' + sorted.length : '';
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (restore.current) {
      el.scrollTop = el.scrollHeight - restore.current.h + restore.current.top;
      restore.current = null;
      return;
    }
    if (forceBottom.current || atBottom.current) {
      el.scrollTop = el.scrollHeight;
      forceBottom.current = false;
    }
  }, [lastKey, loading]);

  const loadOlder = useCallback(async () => {
    if (loadingOlder || !hasOlder) return;
    const el = scrollRef.current;
    setLoadingOlder(true);
    try {
      const next = pageRef.current + 1;
      const rows = await fetchRoomMessages(roomId, next, PAGE);
      pageRef.current = next;
      if (el) restore.current = { h: el.scrollHeight, top: el.scrollTop };
      setMsgs((p) => mergeInto(p, rows));
      setHasOlder(rows.length >= PAGE);
    } catch {
      toast.error('Could not load older messages');
    } finally {
      setLoadingOlder(false);
    }
  }, [roomId, hasOlder, loadingOlder]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    if (el.scrollTop < 120 && hasOlder && !loadingOlder) loadOlder();
  };

  // close menus on outside click
  useEffect(() => {
    if (!menuFor) return;
    const on = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.msg-menu, .msg-more')) setMenuFor(null);
    };
    document.addEventListener('mousedown', on);
    return () => document.removeEventListener('mousedown', on);
  }, [menuFor]);

  // ── sending ──
  const putMsg = (m: ChatMsg) => setMsgs((p) => ({ ...p, [m.msgId]: m }));
  const dropMsg = (id: string) =>
    setMsgs((p) => {
      const n = { ...p };
      delete n[id];
      return n;
    });

  const deliver = async (temp: ChatMsg) => {
    try {
      let extra: Partial<ChatMsg> = {};
      let body = temp.msg;
      if (temp.localFile) {
        const up = await uploadChatFile(temp.localFile);
        const mimetype = up.mimetype || temp.mimetype || 'application/octet-stream';
        const originalName = decodeName(up.originalname || temp.originalName);
        extra = { fileType: inferFileType(mimetype, originalName), originalName, fileSize: up.size ?? temp.fileSize, mimetype };
        body = `${up.filename}.file`;
      }
      const saved = await sendChatMessage({ recipientId: peerId, msg: body, roomId, clientSentAtMs: temp.clientSentAtMs, ...extra });
      setMsgs((p) => {
        const n = { ...p };
        delete n[temp.msgId];
        const old = n[saved.msgId];
        n[saved.msgId] = { ...old, ...saved, localUrl: temp.localUrl, seen: saved.seen || old?.seen };
        return n;
      });
      applyMessageToInbox({ ...saved, roomId: saved.roomId || roomId }, me, { openRoomId: roomId, peer });
    } catch (e: any) {
      putMsg({ ...temp, failed: true });
      toast.error(e?.message && !/^Request failed/.test(e.message) ? e.message : 'Message not sent. Check your connection and try again.');
    }
  };

  const newTemp = (fields: Partial<ChatMsg>): ChatMsg => {
    const now = Math.max(Date.now(), (sorted.length ? msgSortMs(sorted[sorted.length - 1]) : 0) + 1);
    return { msgId: 'temp-' + now + '-' + Math.random().toString(36).slice(2, 6), roomId, senderId: me, recipientId: peerId, msg: '', sentTime: Math.floor(now / 1000), clientSentAtMs: now, temp: true, ...fields };
  };

  const submit = async () => {
    const t = text.trim();
    if (!t || !peerId) return;
    if (editing) {
      const target = editing;
      setEditing(null);
      setText('');
      if (t === target.msg) return;
      putMsg({ ...target, msg: t, isEdited: true });
      try {
        await editChatMessage(target.msgId, t, roomId);
        emitChatEvent(CHAT_SOCKET_EVENTS.edit, { msgId: target.msgId, msg: t, roomId, senderId: me, recipientId: peerId, isEdited: true });
      } catch (e: any) {
        putMsg(target);
        toast.error(e?.message || 'Could not edit message');
      }
      return;
    }
    const body = replyTo ? buildReply(parseReply(replyTo.msg).body || replyTo.msg, t, sameUser(replyTo.senderId, me), replyTo.msgId) : t;
    setText('');
    setReplyTo(null);
    const temp = newTemp({ msg: body });
    forceBottom.current = true;
    putMsg(temp);
    inputRef.current?.focus();
    await deliver(temp);
  };

  const sendFiles = async (files: FileList | File[]) => {
    if (!peerId) return;
    for (const file of Array.from(files)) {
      const mime = file.type || 'application/octet-stream';
      const kind = inferFileType(mime, file.name);
      if (kind === 'video') {
        toast.error('Videos can be sent from the i\'llTip app.');
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        toast.error(`${file.name} is larger than 25 MB.`);
        continue;
      }
      const temp = newTemp({
        msg: file.name,
        originalName: file.name,
        mimetype: mime,
        fileType: kind,
        fileSize: file.size,
        localFile: file,
        localUrl: kind === 'image' ? URL.createObjectURL(file) : undefined,
      });
      forceBottom.current = true;
      putMsg(temp);
      await deliver(temp);
    }
  };

  const retry = (m: ChatMsg) => {
    dropMsg(m.msgId);
    const temp = newTemp({ msg: m.msg, originalName: m.originalName, mimetype: m.mimetype, fileType: m.fileType, fileSize: m.fileSize, localFile: m.localFile, localUrl: m.localUrl });
    forceBottom.current = true;
    putMsg(temp);
    deliver(temp);
  };

  const doDelete = async (m: ChatMsg, forEveryone: boolean) => {
    setDeleting(null);
    if (m.temp) {
      dropMsg(m.msgId);
      return;
    }
    const before = msgs[m.msgId];
    if (forEveryone) putMsg({ ...m, isDeleted: true });
    else dropMsg(m.msgId);
    try {
      await deleteChatMessage(m.msgId, roomId, forEveryone);
      if (forEveryone) emitChatEvent(CHAT_SOCKET_EVENTS.delete, { msgId: m.msgId, roomId, senderId: me, recipientId: peerId, isDeleted: true });
    } catch (e: any) {
      if (before) putMsg(before);
      toast.error(e?.message || 'Could not delete message');
    }
  };

  const copy = async (m: ChatMsg) => {
    try {
      await navigator.clipboard.writeText(parseReply(m.msg).body || m.msg);
      toast.ok('Copied');
    } catch {
      toast.error('Could not copy');
    }
  };

  // autosize composer
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(160, el.scrollHeight) + 'px';
  }, [text]);

  // ── render ──
  const header = (
    <div className="thread-head">
      {!wide && (
        <button className="icon-btn" aria-label="Back to chats" onClick={() => navigate('/chat')}>
          <Icon name="back" />
        </button>
      )}
      {peerId ? (
        <Link to={'/u/' + encodeURIComponent(peerId)} className="thread-peer" title="View profile">
          <Avatar src={peerAvatar} name={peerName} size={40} />
          <div className="thread-peer-text">
            <div className="thread-peer-name ellipsis">{peerName}</div>
            <div className="thread-peer-sub">View profile</div>
          </div>
        </Link>
      ) : (
        <div className="thread-peer">
          <Avatar name={peerName} size={40} />
          <div className="thread-peer-name">{peerName}</div>
        </div>
      )}
    </div>
  );

  let lastDay = '';
  const items: React.ReactNode[] = [];
  sorted.forEach((m, i) => {
    const ms = msgSortMs(m);
    const day = dayLabel(ms);
    if (day !== lastDay) {
      items.push(
        <div key={'d' + day + i} className="day-sep">
          <span>{day}</span>
        </div>,
      );
      lastDay = day;
    }
    const prev = sorted[i - 1];
    const grouped = !!prev && sameUser(prev.senderId, m.senderId) && ms - msgSortMs(prev) < 5 * 60_000 && dayLabel(msgSortMs(prev)) === day;
    items.push(
      <Bubble
        key={m.msgId}
        m={m}
        out={sameUser(m.senderId, me)}
        grouped={grouped}
        peerName={peerName}
        menuOpen={menuFor === m.msgId}
        touch={touch}
        onMenu={() => setMenuFor(menuFor === m.msgId ? null : m.msgId)}
        onReply={() => {
          setMenuFor(null);
          setEditing(null);
          setReplyTo(m);
          inputRef.current?.focus();
        }}
        onEdit={() => {
          setMenuFor(null);
          setReplyTo(null);
          setEditing(m);
          setText(m.msg);
          inputRef.current?.focus();
        }}
        onDelete={() => {
          setMenuFor(null);
          setDeleting(m);
        }}
        onCopy={() => {
          setMenuFor(null);
          copy(m);
        }}
        onRetry={() => retry(m)}
        onOpenImage={(url, name) => setLightbox({ url, name })}
      />,
    );
  });

  const canEveryone = deleting && sameUser(deleting.senderId, me) && !deleting.isDeleted && Date.now() - msgSortMs(deleting) < DELETE_FOR_EVERYONE_WINDOW_MS;

  return (
    <section
      className="thread"
      aria-label={'Chat with ' + peerName}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragging(false);
        sendFiles(e.dataTransfer.files);
      }}
    >
      {header}
      <div className="thread-scroll" ref={scrollRef} onScroll={onScroll}>
        {loading ? (
          <Spinner />
        ) : error ? (
          <div style={{ padding: 16 }}>
            <ErrorBox error={error} onRetry={() => setReloadKey((k) => k + 1)} />
          </div>
        ) : (
          <>
            {hasOlder && (
              <div className="chat-more">
                {loadingOlder ? <div className="spinner" /> : <button className="btn btn-ghost btn-sm" onClick={loadOlder}>Load earlier messages</button>}
              </div>
            )}
            {sorted.length === 0 && (
              <div className="thread-empty">
                <Avatar src={peerAvatar} name={peerName} size={72} />
                <div className="empty-title">{peerName}</div>
                <div className="muted small">{peerId ? 'No messages yet. Say hello!' : "We couldn't open this conversation."}</div>
                {!peerId && (
                  <Link to="/chat" className="btn btn-sm">
                    Back to chats
                  </Link>
                )}
              </div>
            )}
            {items}
          </>
        )}
      </div>
      {dragging && <div className="thread-drop">Drop files to send</div>}

      <div className="composer-wrap">
        {(replyTo || editing) && (
          <div className="composer-context">
            <div className="composer-context-text">
              <div className="composer-context-title">{editing ? 'Edit message' : 'Replying to ' + (sameUser(replyTo!.senderId, me) ? 'yourself' : peerName)}</div>
              <div className="ellipsis small muted">{previewLine(parseReply((editing || replyTo)!.msg).body || '')}</div>
            </div>
            <button
              className="icon-btn"
              aria-label="Cancel"
              onClick={() => {
                if (editing) setText('');
                setEditing(null);
                setReplyTo(null);
              }}
            >
              <Icon name="close" size={18} />
            </button>
          </div>
        )}
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <button type="button" className="composer-btn" aria-label="Attach a photo or file" title="Attach a photo or file" disabled={!peerId || !!editing} onClick={() => fileRef.current?.click()}>
            <Ico name="clip" size={20} />
          </button>
          <input
            ref={fileRef}
            type="file"
            hidden
            multiple
            accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
            onChange={(e) => {
              if (e.target.files) sendFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <textarea
            ref={inputRef}
            className="composer-input"
            rows={1}
            placeholder={peerId ? 'Type a message…' : 'Loading…'}
            value={text}
            disabled={!peerId}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files || []) as File[];
              if (files.length) {
                e.preventDefault();
                sendFiles(files);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !touch && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              } else if (e.key === 'Escape' && (editing || replyTo)) {
                if (editing) setText('');
                setEditing(null);
                setReplyTo(null);
              }
            }}
            aria-label="Message"
          />
          <button type="submit" className="composer-send" aria-label={editing ? 'Save edit' : 'Send'} disabled={!text.trim() || !peerId}>
            {editing ? <Icon name="check" size={20} /> : <Icon name="send" size={20} />}
          </button>
        </form>
      </div>

      <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Delete message?">
        <div className="stack">
          {canEveryone && (
            <button className="btn btn-danger btn-block" onClick={() => deleting && doDelete(deleting, true)}>
              Delete for everyone
            </button>
          )}
          <button className={'btn btn-block ' + (canEveryone ? 'btn-ghost' : 'btn-danger')} onClick={() => deleting && doDelete(deleting, false)}>
            Delete for me
          </button>
          <button className="btn btn-ghost btn-block" onClick={() => setDeleting(null)}>
            Cancel
          </button>
        </div>
      </Modal>
      <Modal open={!!lightbox} onClose={() => setLightbox(null)} title={lightbox?.name} wide>
        {lightbox && (
          <div className="lightbox">
            <img src={lightbox.url} alt={lightbox.name} />
            <a className="btn btn-ghost btn-sm" href={lightbox.url} target="_blank" rel="noreferrer noopener" download={lightbox.name}>
              Open original
            </a>
          </div>
        )}
      </Modal>
    </section>
  );
}

function Bubble(props: {
  m: ChatMsg;
  out: boolean;
  grouped: boolean;
  peerName: string;
  menuOpen: boolean;
  touch: boolean;
  onMenu: () => void;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onCopy: () => void;
  onRetry: () => void;
  onOpenImage: (url: string, name: string) => void;
}) {
  const { m, out } = props;
  const time = new Date(msgSortMs(m)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const attach = !m.isDeleted && (isAttachment(m) || !!m.localFile);
  const parsed = attach || m.isDeleted ? { body: '' } : parseReply(m.msg);
  const media = attach && ['image', 'video'].includes(attachmentKind(m));
  const canEdit = out && !attach && !m.isDeleted && !m.temp && Date.now() - msgSortMs(m) < EDIT_WINDOW_MS;
  const quoteAuthor = (parsed as any).quotedOwn === undefined ? props.peerName : (parsed as any).quotedOwn === out ? 'You' : props.peerName;

  return (
    <div className={'msg-row ' + (out ? 'out' : 'in') + (props.grouped ? ' grouped' : '')}>
      <div className={'msg' + (media ? ' media' : '') + (m.isDeleted ? ' deleted' : '') + (m.failed ? ' failed' : '')} onClick={props.touch && !m.isDeleted && !m.temp ? props.onMenu : undefined}>
        {m.isDeleted ? (
          <div className="msg-text italic">{out ? 'You deleted this message' : 'This message was deleted'}</div>
        ) : attach ? (
          <Attachment m={m} onOpenImage={props.onOpenImage} />
        ) : (
          <>
            {'quote' in parsed && parsed.quote && (
              <div className="msg-quote">
                <div className="msg-quote-author">{quoteAuthor}</div>
                <div className="msg-quote-text">{parsed.quote}</div>
              </div>
            )}
            <div className="msg-text pre">
              <Linkified text={parsed.body} />
            </div>
          </>
        )}
        <div className="msg-meta">
          {m.isEdited && !m.isDeleted && <span>edited</span>}
          <span>{time}</span>
          {out && !m.isDeleted && (m.failed ? <Ico name="alert" size={13} /> : m.temp ? <Ico name="clock" size={13} /> : <Ico name={m.seen ? 'ticks' : 'tick'} size={14} className={m.seen ? 'seen' : ''} />)}
        </div>
      </div>
      {m.failed ? (
        <button className="msg-retry" onClick={props.onRetry}>
          Not sent · Retry
        </button>
      ) : (
        !m.isDeleted &&
        !m.temp && (
          <div className="msg-actions">
            {!props.touch && (
              <button className="msg-more" aria-label="Message actions" onClick={props.onMenu}>
                <Ico name="dots" size={16} />
              </button>
            )}
            {props.menuOpen && (
              <div className="msg-menu" role="menu">
                <button role="menuitem" onClick={props.onReply}>
                  <Ico name="reply" size={16} /> Reply
                </button>
                {!attach && (
                  <button role="menuitem" onClick={props.onCopy}>
                    <Ico name="copy" size={16} /> Copy
                  </button>
                )}
                {canEdit && (
                  <button role="menuitem" onClick={props.onEdit}>
                    <Ico name="edit" size={16} /> Edit
                  </button>
                )}
                <button role="menuitem" className="danger" onClick={props.onDelete}>
                  <Ico name="trash" size={16} /> Delete
                </button>
              </div>
            )}
          </div>
        )
      )}
      {m.failed && (
        <button className="msg-retry ghost" onClick={props.onDelete}>
          Remove
        </button>
      )}
    </div>
  );
}

/**
 * Conversation list store (module level so list + thread share it and it survives route changes).
 * Page 1 is re-fetched by polling / socket events and merged into what is already loaded.
 */
import { useEffect, useState } from 'react';
import { CHAT_LIST_PAGE_SIZE, ChatMsg, ChatRow, fetchChatList, normId, peerOfRow, sameUser } from './api';

type State = { owner: string; rows: ChatRow[]; loaded: boolean; loading: boolean; error?: any; hasMore: boolean; page: number };

let state: State = { owner: '', rows: [], loaded: false, loading: false, hasMore: true, page: 1 };
const subs = new Set<() => void>();
const set = (p: Partial<State>) => {
  state = { ...state, ...p };
  subs.forEach((f) => f());
};

/** Extra peer info we learnt elsewhere (people search, notification, URL) keyed by roomId. */
export type PeerInfo = { peerId: string; name?: string; avatar?: string };
const peers = new Map<string, PeerInfo>();
export function rememberPeer(roomId: string, info: PeerInfo) {
  const old = peers.get(roomId);
  peers.set(roomId, { ...old, ...Object.fromEntries(Object.entries(info).filter(([, v]) => v)) } as PeerInfo);
}
export function peerForRoom(roomId: string, me: string): PeerInfo | undefined {
  const row = state.rows.find((r) => r.roomId === roomId);
  const cached = peers.get(roomId);
  if (row) {
    const p = peerOfRow(row, me);
    return { peerId: p.peerId || cached?.peerId || '', name: p.name !== 'User' ? p.name : cached?.name || p.name, avatar: p.avatar || cached?.avatar };
  }
  return cached;
}
export function rowForPeer(peerId: string, me: string) {
  return state.rows.find((r) => sameUser(peerOfRow(r, me).peerId, peerId));
}

export function useInbox(): State {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  }, []);
  return state;
}

function sortDedupe(rows: ChatRow[], me: string) {
  const sorted = [...rows].sort((a, b) => (Number(b.sentTime) || 0) - (Number(a.sentTime) || 0));
  const seenRoom = new Set<string>();
  const seenPeer = new Set<string>();
  return sorted.filter((r) => {
    const peer = normId(peerOfRow(r, me).peerId);
    if (seenRoom.has(r.roomId) || (peer && seenPeer.has(peer))) return false;
    seenRoom.add(r.roomId);
    if (peer) seenPeer.add(peer);
    return true;
  });
}

function ensureOwner(me: string) {
  if (state.owner !== me) {
    peers.clear();
    state = { owner: me, rows: [], loaded: false, loading: false, hasMore: true, page: 1 };
  }
}

let inflight: Promise<void> | null = null;
export function refreshInbox(me: string): Promise<void> {
  ensureOwner(me);
  if (inflight) return inflight;
  if (!state.loaded) set({ loading: true, error: undefined });
  inflight = (async () => {
    try {
      const first = await fetchChatList(1);
      if (state.owner !== me) return;
      const fresh = new Set(first.map((r) => r.roomId));
      const rest = state.rows.filter((r) => !fresh.has(r.roomId));
      // keep local "read" state for a room we just opened if the server lags behind
      const merged = first.map((r) => (zeroed.has(r.roomId) && Date.now() - (zeroed.get(r.roomId) || 0) < 15_000 ? { ...r, unseenCount: 0 } : r));
      set({
        rows: sortDedupe([...merged, ...rest], me),
        loaded: true,
        loading: false,
        error: undefined,
        hasMore: state.loaded ? state.hasMore : first.length >= CHAT_LIST_PAGE_SIZE,
        page: state.loaded ? state.page : 1,
      });
    } catch (e) {
      set({ loading: false, error: state.loaded ? undefined : e });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

let moreBusy = false;
export async function loadMoreInbox(me: string) {
  if (moreBusy || !state.hasMore || !state.loaded || state.owner !== me) return;
  moreBusy = true;
  set({ loading: true });
  try {
    const next = state.page + 1;
    const rows = await fetchChatList(next);
    const known = new Set(state.rows.map((r) => r.roomId));
    const added = rows.filter((r) => !known.has(r.roomId));
    set({
      rows: sortDedupe([...state.rows, ...added], me),
      page: next,
      hasMore: rows.length >= CHAT_LIST_PAGE_SIZE && added.length > 0,
      loading: false,
    });
  } catch {
    set({ loading: false });
  } finally {
    moreBusy = false;
  }
}

const zeroed = new Map<string, number>();
export function clearUnread(roomId: string) {
  zeroed.set(roomId, Date.now());
  if (!state.rows.some((r) => r.roomId === roomId && (r.unseenCount || 0) > 0)) return;
  set({ rows: state.rows.map((r) => (r.roomId === roomId ? { ...r, unseenCount: 0 } : r)) });
}

/** Apply a sent/received message to the list. Returns false when the room is unknown (caller refreshes). */
export function applyMessageToInbox(m: ChatMsg, me: string, opts: { openRoomId?: string; peer?: PeerInfo } = {}): boolean {
  ensureOwner(me);
  const incoming = !sameUser(m.senderId, me);
  const peerId = incoming ? m.senderId : m.recipientId;
  let row = state.rows.find((r) => (m.roomId && r.roomId === m.roomId) || sameUser(peerOfRow(r, me).peerId, peerId));
  const isOpen = !!opts.openRoomId && (row?.roomId === opts.openRoomId || m.roomId === opts.openRoomId);
  if (!row) {
    if (!opts.peer || !m.roomId) return false;
    row = {
      roomId: m.roomId,
      senderId: m.senderId,
      recipientId: m.recipientId,
      [incoming ? 'senderDetails' : 'recipientDetails']: { userId: opts.peer.peerId, userName: opts.peer.name, imageDetails: opts.peer.avatar ? { imgLink: opts.peer.avatar } : undefined },
    } as ChatRow;
  }
  const details = row.senderDetails || row.recipientDetails;
  const next: ChatRow = {
    ...row,
    msg: m.msg,
    senderId: m.senderId,
    recipientId: m.recipientId,
    sentTime: m.sentTime,
    msgId: m.msgId,
    isDeleted: m.isDeleted,
    mimetype: m.mimetype,
    originalName: m.originalName,
    fileType: m.fileType,
    seen: m.seen,
    senderDetails: incoming ? details : undefined,
    recipientDetails: incoming ? undefined : details,
    unseenCount: incoming && !isOpen ? (row.unseenCount || 0) + 1 : isOpen ? 0 : row.unseenCount,
  };
  set({ rows: sortDedupe([next, ...state.rows.filter((r) => r.roomId !== row!.roomId)], me) });
  return true;
}

export function unreadTotal(rows: ChatRow[]) {
  return rows.reduce((n, r) => n + (Number(r.unseenCount) > 0 ? 1 : 0), 0);
}

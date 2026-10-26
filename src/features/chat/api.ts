/**
 * Chat REST calls + message helpers. Endpoints are the ones illtip-mobile uses:
 *   services/chatApi.ts, services/chatFileApi.ts, hooks/usePeopleSearchInfiniteQuery.ts
 */
import { api, loadSession } from '../../lib/api';
import { API_BASE_URL } from '../../lib/env';
import { normalizeImageDetails, pickDisplayableImageUri } from '../../lib/images';

export type PeerDetails = { userName?: string; userId?: string; imageDetails?: any };

export type ChatRow = {
  roomId: string;
  msg?: string;
  senderId?: string;
  recipientId?: string;
  sentTime?: number;
  msgId?: number | string;
  unseenCount?: number;
  seen?: boolean;
  isDeleted?: boolean;
  mimetype?: string;
  originalName?: string;
  fileType?: string;
  senderDetails?: PeerDetails;
  recipientDetails?: PeerDetails;
};

export type ChatMsg = {
  msgId: string;
  roomId?: string;
  senderId: string;
  recipientId: string;
  msg: string;
  sentTime: number; // epoch seconds
  clientSentAtMs?: number;
  seen?: boolean;
  isDeleted?: boolean;
  isEdited?: boolean;
  fileType?: string;
  originalName?: string;
  fileSize?: number;
  mimetype?: string;
  imgLink?: string;
  // client-only
  temp?: boolean;
  failed?: boolean;
  localUrl?: string;
  localFile?: File;
};

export const normId = (id: unknown) => String(id ?? '').trim().toLowerCase();
export const sameUser = (a: unknown, b: unknown) => !!normId(a) && normId(a) === normId(b);

function arr(data: any, keys: string[]): any[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    for (const k of keys) if (Array.isArray(data[k])) return data[k];
  }
  return [];
}

export const CHAT_LIST_PAGE_SIZE = 20;

/** GET /chat?pageSize=&pageIndex= */
export async function fetchChatList(pageIndex: number, pageSize = CHAT_LIST_PAGE_SIZE): Promise<ChatRow[]> {
  const { data } = await api.get('/chat', { params: { pageSize, pageIndex } });
  return arr(data?.data ?? data, ['data', 'chats', 'conversations', 'items', 'results']).filter((r) => r && r.roomId);
}

export function toChatMsg(r: any): ChatMsg {
  return {
    ...r,
    msgId: String(r.msgId ?? r.id ?? r._id ?? ''),
    roomId: r.roomId != null ? String(r.roomId) : undefined,
    senderId: String(r.senderId ?? ''),
    recipientId: String(r.recipientId ?? ''),
    msg: String(r.msg ?? ''),
    sentTime: Number(r.sentTime) || Math.floor(Date.now() / 1000),
    clientSentAtMs: Number(r.clientSentAtMs) || undefined,
    fileSize: r.fileSize != null ? Number(r.fileSize) || undefined : undefined,
  };
}

/** GET /chat/roomsms?roomId=&pageSize=&pageIndex= (newest first) */
export async function fetchRoomMessages(roomId: string, pageIndex: number, pageSize: number): Promise<ChatMsg[]> {
  const { data } = await api.get('/chat/roomsms', { params: { roomId, pageSize, pageIndex } });
  return arr(data?.data ?? data, ['data', 'messages', 'items', 'results'])
    .slice(0, pageSize)
    .map(toChatMsg)
    .filter((m) => m.msgId);
}

function extractRoomId(raw: any): string | undefined {
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (Array.isArray(raw)) {
    for (const r of raw) {
      const id = extractRoomId(r);
      if (id) return id;
    }
    return undefined;
  }
  if (raw && typeof raw === 'object') {
    const id = raw.roomId ?? raw.id ?? raw._id ?? raw.chatId;
    if (id != null && String(id).trim()) return String(id).trim();
  }
  return undefined;
}

/** GET /chat/getroomid?senderId=&recipientId= (creates the room if needed) */
export async function fetchRoomId(senderId: string, recipientId: string): Promise<string | undefined> {
  const { data } = await api.get('/chat/getroomid', { params: { senderId, recipientId } });
  return extractRoomId(data?.data ?? data);
}

export type SendBody = {
  recipientId: string;
  msg: string;
  roomId?: string;
  clientSentAtMs?: number;
  fileType?: string;
  originalName?: string;
  fileSize?: number;
  mimetype?: string;
};

/** POST /chat/sendmessage (the backend persists + relays over the socket + pushes). */
export async function sendChatMessage(body: SendBody): Promise<ChatMsg> {
  const { data } = await api.post('/chat/sendmessage', body);
  if (data && data.success === false) throw new Error(data.message || 'Message could not be sent');
  const raw = data?.data ?? data;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid chat send response');
  return toChatMsg(raw);
}

/** POST /chat/markseen { roomId, msgId? } */
export async function markRoomSeen(roomId: string, msgId?: string | number) {
  await api.post('/chat/markseen', msgId != null ? { roomId, msgId } : { roomId });
}

/** POST /chat/deletemessage { msgId, roomId?, forEveryone } */
export async function deleteChatMessage(msgId: string, roomId: string | undefined, forEveryone: boolean) {
  const n = Number(msgId);
  const id = Number.isFinite(n) && String(n) === msgId.trim() ? n : msgId;
  const { data } = await api.post('/chat/deletemessage', { msgId: id, ...(roomId ? { roomId } : {}), forEveryone });
  if (data && data.success === false) throw new Error(data.message || 'Delete failed');
}

/** POST /chat/editmessage { msgId, msg, roomId } */
export async function editChatMessage(msgId: string, msg: string, roomId?: string) {
  const n = Number(msgId);
  const { data } = await api.post('/chat/editmessage', { msgId: Number.isFinite(n) ? n : msgId, msg, roomId });
  if (data && data.success === false) throw new Error(data.message || 'Edit failed');
}

export type UploadResult = { filename: string; originalname: string; mimetype: string; size: number };

/** POST /chat/uploadfile (multipart field "file") */
export async function uploadChatFile(file: File): Promise<UploadResult> {
  const fd = new FormData();
  fd.append('file', file, file.name);
  const { data } = await api.post('/chat/uploadfile', fd);
  const row = Array.isArray(data?.data) ? data.data[0] : data?.data;
  if (!row || typeof row !== 'object' || !row.filename) throw new Error('Upload failed');
  return row as UploadResult;
}

export type PersonRow = { userId: string; name: string; avatar?: string; service?: string };

function pickName(o: any) {
  for (const c of [o.fullName, o.userName, o.name]) {
    if (typeof c !== 'string') continue;
    const t = c.trim();
    if (!t || /^(undefined|null|nan)$/i.test(t)) continue;
    if (/^\+?[\d\s().-]+$/.test(t) && t.replace(/\D/g, '').length >= 8) continue;
    return t;
  }
  return 'User';
}

export const PEOPLE_PAGE_SIZE = 10;
/** GET /user/people?pageSize=10&pageIndex=&user= (server returns up to pageSize*10 rows) */
export async function searchPeople(q: string, pageIndex: number): Promise<{ items: PersonRow[]; hasMore: boolean }> {
  const { data } = await api.get('/user/people', { params: { pageSize: PEOPLE_PAGE_SIZE, pageIndex, user: q || undefined } });
  const rows = arr(data, ['data', 'users', 'people']);
  const items = rows
    .map((o: any) => ({
      userId: String(o.userId ?? o.id ?? o._id ?? '').trim(),
      name: pickName(o),
      avatar: pickDisplayableImageUri(normalizeImageDetails(o.imageDetails)),
      service: (typeof o.profession === 'string' && o.profession.trim()) || o.serviceDetails?.service || undefined,
    }))
    .filter((p) => p.userId);
  return { items, hasMore: rows.length >= PEOPLE_PAGE_SIZE * 10 };
}

// ── Message helpers ────────────────────────────────────────────────────────────

export function peerOfRow(row: ChatRow, me: string) {
  const peerId = sameUser(row.senderId, me) ? row.recipientId : row.senderId;
  const d = row.senderDetails || row.recipientDetails;
  const name = (d?.userName && String(d.userName).trim()) || 'User';
  const avatar = pickDisplayableImageUri(normalizeImageDetails(d?.imageDetails));
  return { peerId: String(peerId || d?.userId || ''), name, avatar };
}

export function msgSortMs(m: { clientSentAtMs?: number; sentTime?: number }) {
  return m.clientSentAtMs || (Number(m.sentTime) || 0) * 1000;
}

export function compareMsgs(a: ChatMsg, b: ChatMsg) {
  const d = msgSortMs(a) - msgSortMs(b);
  if (d) return d;
  const na = Number(a.msgId) || 0;
  const nb = Number(b.msgId) || 0;
  if (na && nb) return na - nb;
  return String(a.msgId).localeCompare(String(b.msgId));
}

const FILE_SUFFIX = /\.file$/i;
const HEX_ID = /^[a-f0-9]{24,32}(\.file)?$/i;

export function isAttachment(m: { msg?: string; mimetype?: string; originalName?: string; fileType?: string; imgLink?: string }) {
  const msg = String(m.msg ?? '').trim();
  if (!msg) return false;
  if (FILE_SUFFIX.test(msg) || HEX_ID.test(msg)) return true;
  const hasMeta = !!(m.mimetype || m.originalName || m.fileType || m.imgLink);
  if (!hasMeta) return false;
  if (m.originalName && msg === m.originalName) return true;
  return /\.(jpe?g|png|gif|webp|heic|bmp|mp4|mov|m4v|webm|mkv|avi|3gp|pdf|docx?|xlsx?|pptx?|txt|csv|zip|rar)$/i.test(msg);
}

export type AttachKind = 'image' | 'video' | 'audio' | 'document';

export function attachmentKind(m: { msg?: string; mimetype?: string; originalName?: string; fileType?: string; imgLink?: string }): AttachKind {
  const mime = String(m.mimetype ?? '').toLowerCase();
  const ft = String(m.fileType ?? '').toLowerCase();
  const name = String(m.originalName ?? '');
  if (mime.startsWith('video/') || ft === 'video' || /\.(mp4|mov|m4v|webm|mkv|avi|3gp)$/i.test(name)) return 'video';
  if (mime.startsWith('audio/') || ft === 'voice' || ft === 'audio') return 'audio';
  if (mime.startsWith('image/') || ft === 'image' || /\.(jpe?g|png|gif|webp|heic|bmp)$/i.test(name)) return 'image';
  return 'document';
}

export function inferFileType(mimetype: string, name: string) {
  const mime = mimetype.toLowerCase();
  if (mime.startsWith('image/') || /\.(jpe?g|png|gif|webp|heic|bmp)$/i.test(name)) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('application/') || mime.startsWith('text/') || /\.(pdf|docx?|xlsx?|pptx?|txt|csv|zip|rar)$/i.test(name)) return 'document';
  return 'other';
}

export function attachmentBaseName(msg?: string) {
  const s = String(msg ?? '').trim();
  if (FILE_SUFFIX.test(s)) return s.replace(FILE_SUFFIX, '').trim();
  if (/^[a-f0-9]{24,32}$/i.test(s)) return s;
  return '';
}

/** `${API}/post/file/<base>` needs the Bearer header, so we fetch it as a blob. */
export function chatFileUrl(base: string) {
  return `${API_BASE_URL}/post/file/${encodeURIComponent(base)}`;
}

export function needsAuth(url: string) {
  if (url.includes('cloudfront.net') || url.includes('amazonaws.com')) return false;
  return url.includes('/post/file/') || url.startsWith(API_BASE_URL);
}

const blobCache = new Map<string, Promise<string>>();
export function fetchAuthedBlobUrl(url: string): Promise<string> {
  let p = blobCache.get(url);
  if (!p) {
    p = (async () => {
      const token = loadSession()?.accessToken;
      const r = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!r.ok) throw new Error('File not available');
      return URL.createObjectURL(await r.blob());
    })();
    p.catch(() => blobCache.delete(url));
    blobCache.set(url, p);
  }
  return p;
}

export function decodeName(name?: string) {
  const t = String(name ?? '').trim();
  try {
    return decodeURIComponent(t.replace(/\+/g, ' '));
  } catch {
    return t;
  }
}

// Reply quotes: "> self|<msgId>: quoted text\nreply" (utils/chatReplyQuote.ts)
export function parseReply(text: string): { quote?: string; body: string; quotedOwn?: boolean } {
  if (!text.startsWith('> ')) return { body: text };
  const nl = text.indexOf('\n');
  const header = (nl < 0 ? text.slice(2) : text.slice(2, nl)).trim();
  if (!header) return { body: text };
  const tagged = header.match(/^(self|peer)(?:\|([^:]+))?:\s*(.*)$/i);
  if (nl < 0) return tagged ? { quote: tagged[3]?.trim() || header, body: tagged[3]?.trim() || header, quotedOwn: tagged[1].toLowerCase() === 'self' } : { body: text };
  const body = text.slice(nl + 1);
  if (tagged) return { quote: tagged[3]?.trim() || header, body, quotedOwn: tagged[1].toLowerCase() === 'self' };
  return { quote: header, body };
}

export function previewLine(text: string) {
  const t = text.trim();
  if (!t) return 'Message';
  const first = t.split('\n').find((l) => l.trim()) ?? t;
  return first.length > 140 ? first.slice(0, 140) + '…' : first;
}

export function buildReply(quotedText: string, replyText: string, quotedOwn: boolean, quotedId?: string) {
  const quote = previewLine(quotedText).replace(/\n/g, ' ');
  const who = quotedOwn ? 'self' : 'peer';
  const id = String(quotedId ?? '').trim();
  return `> ${id ? `${who}|${id}` : who}: ${quote}\n${replyText}`;
}

/** Inbox preview line, like services/chatListPreview.ts */
export function rowPreview(row: { msg?: string; senderId?: string; isDeleted?: boolean; mimetype?: string; originalName?: string; fileType?: string; imgLink?: string }, me: string) {
  const out = sameUser(row.senderId, me);
  if (row.isDeleted) return { out, text: out ? 'You deleted this message' : 'This message was deleted' };
  const msg = String(row.msg ?? '').trim();
  if (isAttachment(row)) {
    const k = attachmentKind(row);
    return { out, text: k === 'video' ? 'Video' : k === 'image' ? 'Photo' : k === 'audio' ? 'Voice message' : 'Attachment' };
  }
  if (!msg) return { out: false, text: 'No messages yet' };
  const parsed = parseReply(msg);
  return { out, text: previewLine(parsed.body || msg) };
}

export const EDIT_WINDOW_MS = 30 * 60 * 1000;
export const DELETE_FOR_EVERYONE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function formatBytes(n?: number) {
  const v = Number(n || 0);
  if (!v) return '';
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(0)} KB`;
  return `${(v / 1024 / 1024).toFixed(1)} MB`;
}

/** List time: 14:05 today, "Yesterday", weekday within a week, else a short date. */
export function listTime(sec?: number) {
  if (!sec) return '';
  const d = new Date(sec * 1000);
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff <= 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() ? { year: '2-digit' } : {}) });
}

export function dayLabel(ms: number) {
  const d = new Date(ms);
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}

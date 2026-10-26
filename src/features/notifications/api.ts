/**
 * Notification REST calls (illtip-mobile src/config/api.ts NOTIFICATION_API + services/notifications.ts)
 * and the type/route helpers from ui/molecules/notifications/notificationHelpers.ts +
 * services/notificationNavigation.ts, mapped to web routes.
 */
import { api } from '../../lib/api';

export type NotificationType =
  | 'like' | 'comment' | 'mention' | 'coin' | 'hire' | 'service_request' | 'save' | 'post' | 'job' | 'chat'
  | 'finance' | 'wallet' | 'payment' | 'profile' | 'generic';

export interface NotificationDoc {
  _id?: string;
  requestId: string;
  userId?: string;
  relativeUserId?: string;
  serviceRequestId?: string | number;
  statusPostId?: string | number;
  postId?: string | number;
  relativePostId?: string | number;
  commentId?: string | number;
  conversationId?: string;
  chatId?: string;
  peerUserId?: string;
  senderId?: string;
  username?: string;
  profileUserId?: string;
  subject: string;
  body?: string;
  title?: string;
  type?: NotificationType;
  transactionKind?: string;
  openCoinersModal?: boolean | string;
  base64Details?: string | null;
  isSeen: boolean;
  isClear?: boolean;
  isFav: boolean;
  isOverLook?: boolean;
  createdTimeUnix: number | string;
}

export const PAGE_SIZE = 20;

/** GET /notification/v2/?pageIndex=&pageSize= → { data, pageIndex, hasMore, total } */
export async function fetchNotifications(pageIndex: number, pageSize = PAGE_SIZE): Promise<{ items: NotificationDoc[]; hasMore: boolean }> {
  const { data } = await api.get('/notification/v2/', { params: { pageIndex, pageSize } });
  if (data && data.success === false) throw new Error(data.message || 'Could not load notifications');
  const payload = data?.data || {};
  const items = (Array.isArray(payload.data) ? payload.data : Array.isArray(payload) ? payload : []).filter((n: any) => n && n.requestId);
  return { items, hasMore: Boolean(payload.hasMore) };
}

/** POST /notification/v2/seen { requestId, isSeen } */
export const setSeen = (requestId: string, isSeen: boolean) => api.post('/notification/v2/seen', { requestId, isSeen });
/** POST /notification/v2/ { requestId, isFav } */
export const setFav = (requestId: string, isFav: boolean) => api.post('/notification/v2/', { requestId, isFav });
/** POST /notification/v2/overlook (clears the badge) */
export const markAllOverlooked = () => api.post('/notification/v2/overlook');
/** POST /notification/v2/deletenotification { requestIds } */
export const deleteNotifications = (requestIds: string[]) => api.post('/notification/v2/deletenotification', { requestIds });

// ── type helpers ──
const SUBJECT_TYPE_RULES: Array<{ pattern: RegExp; type: NotificationType }> = [
  { pattern: /tagged you|mentioned you/i, type: 'mention' },
  { pattern: /sent you \d+ coin|coin/i, type: 'coin' },
  { pattern: /sent you a message|new message/i, type: 'chat' },
  { pattern: /connected with you|started following you|joined your network/i, type: 'profile' },
  { pattern: /commented/i, type: 'comment' },
  { pattern: /liked your/i, type: 'like' },
  { pattern: /saved your|bookmarked/i, type: 'save' },
  { pattern: /hired you|has hired/i, type: 'hire' },
  { pattern: /requested for a|new job opportunity|service request/i, type: 'service_request' },
  { pattern: /accepted your.*service/i, type: 'service_request' },
];

export function resolveType(n: NotificationDoc): NotificationType | undefined {
  if (n.type) return n.type;
  for (const r of SUBJECT_TYPE_RULES) if (r.pattern.test(n.subject || '')) return r.type;
  return undefined;
}

const TX_KINDS = ['reward', 'coin_purchase', 'client_payment'];
export function isTransaction(n: NotificationDoc) {
  if (resolveType(n) !== 'coin') return false;
  if (!n.transactionKind) return true;
  return TX_KINDS.includes(n.transactionKind);
}
export function isPurchaseOrClientPayment(n: NotificationDoc) {
  if (n.transactionKind === 'coin_purchase' || n.transactionKind === 'client_payment') return true;
  return /purchased \d+ coin|topped up/i.test(n.subject || '');
}

export const ACTION_TEXT: Partial<Record<NotificationType, string>> = {
  like: 'Click to view post',
  comment: 'Click to view post',
  mention: 'Click to view post',
  save: 'Click to view post',
  service_request: 'Click to respond',
};

export function toDate(ts: any): Date {
  if (ts === null || ts === undefined) return new Date(0);
  let v = ts;
  if (typeof v === 'string' && /^[0-9]+$/.test(v)) v = parseInt(v, 10);
  if (typeof v === 'number' && v < 10_000_000_000) return new Date(v * 1000);
  return new Date(v);
}

export function daySection(ts: any) {
  const d = toDate(ts);
  if (isNaN(d.getTime()) || d.getTime() === 0) return 'Earlier';
  const a = new Date();
  a.setHours(0, 0, 0, 0);
  const b = new Date(d);
  b.setHours(0, 0, 0, 0);
  const diff = Math.round((a.getTime() - b.getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

const val = (v: unknown) => {
  const s = v == null ? '' : String(v).trim();
  return s && s !== 'system' && s !== 'undefined' && s !== 'null' ? s : '';
};

/** Web route for a notification tap (mirrors NotificationsScreen.handlePress). null = nothing to open. */
export function notificationRoute(n: NotificationDoc): string | null {
  const rt = resolveType(n);
  if (!rt) return null;
  if (rt === 'profile') {
    const id = val(n.profileUserId) || val(n.relativeUserId) || val(n.senderId);
    return id ? `/u/${encodeURIComponent(id)}` : null;
  }
  if (rt === 'chat') {
    const peer = val(n.peerUserId) || val(n.relativeUserId) || val(n.senderId);
    const room = val(n.chatId) || val(n.conversationId);
    const q = new URLSearchParams();
    if (peer) q.set('u', peer);
    if (val(n.username)) q.set('n', val(n.username));
    if (room) return `/chat/${encodeURIComponent(room)}${peer ? '?' + q : ''}`;
    if (peer) return `/chat/new?${q}`;
    return '/chat';
  }
  const postId = val(n.statusPostId) || val(n.postId) || val(n.relativePostId);
  const jobId = val(n.serviceRequestId);
  if (rt === 'coin') {
    if (!isPurchaseOrClientPayment(n) && val(n.statusPostId)) return `/post/${encodeURIComponent(val(n.statusPostId))}`;
    return '/wallet';
  }
  if (rt === 'hire' || rt === 'service_request' || rt === 'job') {
    if (jobId) return `/jobs/${encodeURIComponent(jobId)}`;
    if (/new job opportunity/i.test(n.subject || '')) return '/jobs';
    return null;
  }
  if (rt === 'like' || rt === 'comment' || rt === 'mention' || rt === 'save' || rt === 'post') {
    return postId ? `/post/${encodeURIComponent(postId)}` : null;
  }
  if (rt === 'finance' || rt === 'wallet' || rt === 'payment') return '/wallet';
  return null;
}

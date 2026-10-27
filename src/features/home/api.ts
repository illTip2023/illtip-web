/**
 * Home feed data layer. Endpoints and shapes mirror illtip-mobile:
 * src/services/post.ts, postViews.ts, coins.ts, feedBoostPin.ts, hooks/usePeopleSearchInfiniteQuery.ts.
 */
import { api, ApiError, unwrap } from '../../lib/api';
import { normalizeImageDetails, pickDisplayableImageUri } from '../../lib/images';

export const PAGE_SIZE = 10;
export const MAX_ATTACHMENTS = 5;

export type Mention = { userId: string; displayName: string; start: number; length: number };

export type MediaItem = {
  src?: string;
  imgLink?: string;
  filename?: string;
  mimetype?: string;
  thumbnailDetails?: { src?: string; imgLink?: string; mimetype?: string };
};

export type PostUser = {
  userId: string;
  userName?: string;
  fullName?: string;
  imageDetails?: any;
  hasVerifiedBadge?: boolean;
  profession?: string;
  serviceDetails?: { service?: string };
};

export type Poll = {
  question: string;
  options: { optionId: string; text: string }[];
  durationHours: 24 | 48 | 72;
  createdAt: number;
  expiresAt: number;
};

export type PollResult = {
  statusPostId: number;
  question: string;
  expiresAt: number;
  isExpired: boolean;
  resultsVisible: boolean;
  hasVoted: boolean;
  selectedOptionId: string | null;
  totalVotes: number | null;
  options: { optionId: string; text: string; voteCount: number | null; percentage: number | null }[];
};

export type Post = {
  statusPostId: number;
  caption: string;
  createdBy: string;
  createdTime: number;
  imageArr?: MediaItem[];
  likedArr?: any[];
  commentArr?: any[];
  coinArr?: { coinedBy: any; coins: number; coinTime: number }[];
  totalCoins?: number;
  userDetails?: PostUser[];
  amILiked?: boolean;
  sponsored?: boolean;
  postType?: string;
  boostedUntil?: number;
  mentions?: Mention[];
  poll?: Poll;
  viewCount?: number;
  isSaved?: boolean;
};

export type Comment = {
  commentId: number;
  comment: string;
  commentTime?: number;
  commentedBy?: string;
  parentCommentId?: number | null;
  replies?: Comment[];
  replyCount?: number;
  likedArr?: { likedBy: string; likeTime: number }[];
  /** Tips on this comment (newer backends): coinedBy is a plain userId string. */
  coinArr?: { coinedBy: string; coins: number; coinTime: number }[];
  totalCoins?: number;
  likeCount?: number;
  amILiked?: boolean;
  mentions?: Mention[];
  commentUserDetails?: PostUser[];
  commenterDetails?: Partial<PostUser>;
};

/* ---------- helpers ---------- */

export function epochMs(t?: number | string) {
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 1e12 ? n : n * 1000;
}

export function isSponsored(p: Post) {
  return p.sponsored === true || p.postType === 'SPONSORED_POSTS';
}

export function isBoosted(p: Post) {
  if (isSponsored(p)) return true;
  const raw = Number(p.boostedUntil);
  if (!Number.isFinite(raw) || raw <= 0) return false;
  return epochMs(raw) > Date.now();
}

export function displayName(u?: Partial<PostUser> | null, fallback = 'User') {
  const bad = (s?: string) => !s || !s.trim() || ['undefined', 'null'].includes(s.trim().toLowerCase());
  if (u && !bad(u.userName)) return u.userName!.trim();
  if (u && !bad(u.fullName)) return u.fullName!.trim();
  return fallback;
}

export function avatarOf(u?: Partial<PostUser> | null) {
  return pickDisplayableImageUri(normalizeImageDetails(u?.imageDetails)) || undefined;
}

export function authorOf(p: Post) {
  const u = p.userDetails?.[0];
  return {
    userId: String(u?.userId || p.createdBy || ''),
    name: displayName(u, p.createdBy || 'User'),
    avatar: avatarOf(u),
    verified: u?.hasVerifiedBadge === true,
  };
}

export function coinTotal(p: Post) {
  if (Array.isArray(p.coinArr)) return p.coinArr.reduce((s, c) => s + (Number(c?.coins) || 0), 0);
  return Number(p.totalCoins) || 0;
}

const VIDEO_EXT = /\.(mp4|mov|m4v|webm|m3u8|avi|mkv)(\?|$)/i;
export function isVideo(m: MediaItem) {
  const mime = (m.mimetype || '').toLowerCase();
  if (mime.startsWith('image')) return false;
  if (mime.includes('video')) return true;
  return VIDEO_EXT.test(`${m.imgLink || ''} ${m.src || ''}`);
}

export type Media = { key: string; kind: 'image' | 'video'; url: string; poster?: string };

export function mediaOf(p: Post): Media[] {
  const out: Media[] = [];
  (p.imageArr || []).forEach((m, i) => {
    if (!m) return;
    const url = (m.imgLink || m.src || '').trim();
    const poster = (m.thumbnailDetails?.imgLink || m.thumbnailDetails?.src || '').trim() || undefined;
    if (!url && !poster) return;
    if (isVideo(m)) out.push({ key: `${i}-${url}`, kind: 'video', url, poster });
    else out.push({ key: `${i}-${url}`, kind: 'image', url: url || poster! });
  });
  return out;
}

/** Card 1 organic, first live boost at card 2 (mobile placeLiveBoostAtSecondCard). */
export function placeBoostSecond(posts: Post[]) {
  if (posts.length < 2) return posts;
  const firstOrganic = posts.findIndex((p) => !isBoosted(p));
  const firstBoost = posts.findIndex(isBoosted);
  if (firstOrganic < 0 || firstBoost < 0) return posts;
  const next = [...posts];
  if (firstOrganic !== 0) next.unshift(...next.splice(firstOrganic, 1));
  const b = next.findIndex(isBoosted);
  if (b > 1) next.splice(1, 0, ...next.splice(b, 1));
  return next;
}

export function shareUrl(id: number | string) {
  return `https://www.illtip.com/home-detail?postId=${encodeURIComponent(String(id))}`;
}

export function errMsg(e: any, fallback: string) {
  const m = e?.message;
  return typeof m === 'string' && m && !/^Request failed/.test(m) ? m : fallback;
}

/* ---------- endpoints ---------- */

const arr = (x: any) => (Array.isArray(x) ? x : []);

/** GET /post (HomeScreen.tsx via feedBoostPin.buildHomeFeedParams). */
export async function fetchFeed(pageIndex: number, feedSeed: string, pinOwnPostId?: number): Promise<Post[]> {
  const { data } = await api.get('/post', {
    params: { pageIndex, pageSize: PAGE_SIZE, feedSeed, ranked: 1, ...(pinOwnPostId && pageIndex === 1 ? { pinOwnPostId } : {}) },
  });
  return arr(data?.data);
}

/** GET /post unranked browse (HomeSearchScreen.tsx Posts tab with empty query). */
export async function fetchBrowse(pageIndex: number): Promise<Post[]> {
  const { data } = await api.get('/post', { params: { pageIndex, pageSize: PAGE_SIZE } });
  return arr(data?.data);
}

export async function searchPosts(q: string, pageIndex: number): Promise<Post[]> {
  const { data } = await api.get('/post/search', { params: { q, pageIndex, pageSize: PAGE_SIZE } });
  return arr(data?.data);
}

export async function getPost(id: number | string): Promise<Post> {
  const res = await api.get('/post/single', { params: { statusPostId: id } });
  const p = unwrap<Post>(res);
  if (!p || !p.statusPostId) throw new Error('This post is no longer available.');
  return p;
}

export async function fetchRelated(statusPostId: number, seed: string): Promise<Post[]> {
  const { data } = await api.get('/post/related', { params: { statusPostId, pageIndex: 1, pageSize: 12, seed } });
  return arr(data?.data);
}

export async function fetchSaved(): Promise<Post[]> {
  const { data } = await api.get('/post/saved');
  return arr(data?.data?.posts);
}

export async function likePost(p: Post, like: boolean) {
  return unwrap(await api.post('/post/like', { statusPostId: Number(p.statusPostId), likeAction: like ? 'ADD' : 'REMOVE', ...(isSponsored(p) ? { sponsored: true } : {}) }));
}

export async function bookmarkPost(statusPostId: number, save: boolean) {
  return unwrap(await api.post('/post/bookmark', { statusPostId: Number(statusPostId), action: save ? 'SAVE' : 'UNSAVE' }));
}

export async function deletePost(statusPostId: number) {
  return unwrap(await api.get('/post/deletePost', { params: { statusPostId } }));
}

export async function flagPost(statusPostId: number) {
  return unwrap(await api.post('/post/flag', { statusPostId, flagAction: 'ADD' }));
}

/** Re-finds each existing @mention in the edited caption so its position stays right (the app does the same). */
export function remapMentions(caption: string, mentions: Mention[] | undefined): Mention[] {
  const out: Mention[] = [];
  let from = 0;
  for (const m of [...(mentions || [])].sort((a, b) => a.start - b.start)) {
    const needle = '@' + m.displayName;
    const at = caption.indexOf(needle, from);
    if (at < 0) continue;
    out.push({ ...m, start: at, length: needle.length });
    from = at + needle.length;
  }
  return out;
}

export async function editPost(statusPostId: number, caption: string, mentions?: Mention[]) {
  return unwrap(await api.post('/post/edit', { statusPostId, caption, mentions: remapMentions(caption, mentions) }));
}

export async function fetchComments(p: Post): Promise<Comment[]> {
  const { data } = await api.get('/post/comment', { params: { statusPostId: p.statusPostId, ...(isSponsored(p) ? { sponsored: true } : {}) } });
  const payload = data?.data;
  if (Array.isArray(payload) && payload.length && payload[0]?.comment !== undefined) return payload;
  if (Array.isArray(payload)) return payload.flatMap((w: any) => (Array.isArray(w?.commentArr) ? w.commentArr : w?.commentArr ? [w.commentArr] : []));
  if (Array.isArray(payload?.commentArr)) return payload.commentArr;
  return [];
}

export async function commentPost(p: Post, body: { comment: string; commentAction: 'ADD' | 'EDIT' | 'REMOVE'; commentId?: number; parentCommentId?: number }) {
  return unwrap(await api.post('/post/comment', { statusPostId: Number(p.statusPostId), mentions: [], ...body, ...(isSponsored(p) ? { sponsored: true } : {}) }));
}

export async function likeComment(p: Post, commentId: number, like: boolean) {
  return unwrap(await api.post('/post/comment/like', { statusPostId: Number(p.statusPostId), commentId, likeAction: like ? 'ADD' : 'REMOVE', ...(isSponsored(p) ? { sponsored: true } : {}) }));
}

/**
 * POST /post/comment/coin { statusPostId, commentId, coins, sponsored? } (app services/post.ts coinComment).
 * The backend answers 200 + success:false for refusals (insufficient balance, own comment, comment gone).
 */
export async function tipComment(p: Post, commentId: number, coins: number): Promise<any> {
  const { data } = await api.post('/post/comment/coin', { statusPostId: Number(p.statusPostId), commentId, coins, ...(isSponsored(p) ? { sponsored: true } : {}) });
  if (data && data.success === false) throw new ApiError(data.message || 'Could not send tip', 200, data);
  return data;
}

/** POST /post/coin. Backend answers 200 + success:false for refusals (e.g. insufficient balance). */
export async function tipPost(p: Post, coins: number): Promise<{ coinBalance?: number }> {
  const { data } = await api.post('/post/coin', { statusPostId: Number(p.statusPostId), coins, ...(isSponsored(p) ? { sponsored: true } : {}) });
  if (data && data.success === false) throw new ApiError(data.message || 'Could not send tip', 200, data);
  return data?.data || {};
}

export async function fetchCoinBalance(): Promise<number> {
  const { data } = await api.get('/coins/balance');
  const d = data?.data?.data ?? data?.data ?? data;
  const n = Number(d?.coinBalance ?? d?.balance);
  return Number.isFinite(n) ? n : 0;
}

export async function fetchPoll(statusPostId: number): Promise<PollResult> {
  const { data } = await api.get('/post/poll', { params: { statusPostId } });
  if (data?.success !== true || !data?.data) throw new Error(data?.message || 'Could not load poll');
  return data.data;
}

export async function votePoll(statusPostId: number, optionId: string): Promise<PollResult> {
  const { data } = await api.post('/post/poll/vote', { statusPostId, optionId });
  if (data?.success !== true || !data?.data) throw new Error(data?.message || 'Could not record your vote');
  return data.data;
}

export async function uploadImage(file: File): Promise<any[]> {
  const fd = new FormData();
  fd.append('image', file, file.name);
  const { data } = await api.post('/post/uploadStatusImage', fd);
  const payload = data?.data;
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') return [payload];
  throw new Error('Image upload failed');
}

export type NewPost = { caption: string; imageArr: any[]; mentions?: Mention[]; poll?: { question: string; options: string[]; durationHours: 24 | 48 | 72 } };

export async function createPost(body: NewPost): Promise<number | null> {
  const res = await api.post('/post', { mentions: [], ...body });
  const d = unwrap<any>(res);
  const id = Number(d?.statusPostId ?? d?.value?.statusPostId ?? res.data?.statusPostId);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/** GET /user/people (people search used by HomeSearchScreen). Server pages are up to 100 rows. */
export async function searchPeople(q: string, pageIndex: number): Promise<any[]> {
  const { data } = await api.get('/user/people', { params: { pageSize: 10, pageIndex, ...(q ? { user: q } : {}) } });
  if (Array.isArray(data)) return data;
  const inner = data?.data ?? data?.users ?? data?.people;
  return Array.isArray(inner) ? inner : [];
}

/** The exact name the backend checks a tag against (lib/userLookup resolvePosterDisplayName: userName ?? fullName). */
export function mentionNameOf(raw: any): string {
  const first = [raw?.firstName, raw?.lastName].map((x) => String(x ?? '').trim()).filter(Boolean).join(' ');
  return String(raw?.userName ?? raw?.fullName ?? first ?? '').trim();
}

export function personFromRaw(raw: any) {
  const userId = String(raw?.userId ?? raw?.id ?? raw?._id ?? '');
  const prof =
    (typeof raw?.profession === 'string' && raw.profession.trim()) ||
    (typeof raw?.serviceDetails?.service === 'string' && raw.serviceDetails.service.trim()) ||
    undefined;
  const name = [raw?.fullName, raw?.userName, raw?.name]
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .find((s) => s && !['undefined', 'null'].includes(s.toLowerCase()) && !/^\+?[\d\s().-]{8,}$/.test(s));
  return { userId, name: name || 'User', profession: prof as string | undefined, avatar: avatarOf(raw), verified: raw?.hasVerifiedBadge === true };
}

/** POST /post/view: batch impressions (LocalPostViewProvider). Best-effort, deduped per session, flushed every 10s. */
const reported = new Set<number>();
const pending = new Set<number>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let failures = 0;

async function flushViews() {
  flushTimer = null;
  if (!pending.size) return;
  const ids = [...pending];
  pending.clear();
  try {
    await api.post('/post/view', { statusPostIds: ids });
    failures = 0;
  } catch {
    failures += 1;
    if (failures >= 4) return;
    ids.forEach((id) => pending.add(id));
    flushTimer = setTimeout(flushViews, 30_000 * 2 ** (failures - 1));
  }
}

export function recordView(statusPostId: number) {
  const id = Number(statusPostId);
  if (!Number.isFinite(id) || id <= 0 || reported.has(id)) return;
  reported.add(id);
  pending.add(id);
  if (!flushTimer) flushTimer = setTimeout(flushViews, 10_000);
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && pending.size) {
      if (flushTimer) clearTimeout(flushTimer);
      void flushViews();
    }
  });
}

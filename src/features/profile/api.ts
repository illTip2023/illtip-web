/**
 * Profile data layer. Endpoints mirror illtip-mobile:
 *  - services/userProfile.ts, hooks/useProfileQuery.ts (GET /user/profile, POST /user/updateprofile, POST /user/profileimage)
 *  - services/network.ts (/network/state, /network/follow, /network/unfollow, /network/followers, /network/following)
 *  - services/profileViews.ts (/profile-views/view, /profile-views/viewers)
 *  - services/creatorRating.ts (GET /rating/me)
 *  - services/recommendations.ts (/recommendations, /recommendations/counts, /recommendations/has-given, PATCH /recommendations/:id[/status])
 *  - services/review.ts (GET /review?userId=)
 *  - services/post.ts (GET /post/profile-feed, GET /post/otherpost)
 *  - api/masterDataServices.ts (GET /masterdata/services)
 */
import { api, unwrap } from '../../lib/api';
import { normalizeImageDetails, pickDisplayableImageUri } from '../../lib/images';
import { APP_LINKS } from '../../lib/env';

const isRec = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/* ------------------------------------------------------------------ profile */

export type Profile = {
  userId: string;
  name: string;
  userName: string;
  email: string;
  profession: string;
  serviceDetails?: { serviceId?: number; service?: string };
  skillDetails: number[];
  bio: string;
  weblink: string;
  address: string;
  country: string;
  userRole?: 'freelancer' | 'customer';
  hasVerifiedBadge: boolean;
  rankingBoostTier?: number;
  creatorStars?: number;
  avatar?: string;
  updatedTime?: number;
  createdTime?: number;
};

const BAD_NAMES = new Set(['', 'user', 'users', 'undefined', 'null', 'unknown']);
export function displayName(...vals: Array<string | undefined | null>) {
  for (const v of vals) {
    const t = String(v ?? '').trim();
    if (!BAD_NAMES.has(t.toLowerCase())) return t;
  }
  return '';
}

export function normalizeProfile(u: Record<string, any>): Profile {
  let serviceDetails: Profile['serviceDetails'];
  if (isRec(u.serviceDetails)) {
    const id = Number(u.serviceDetails.serviceId);
    serviceDetails = { serviceId: Number.isFinite(id) ? id : undefined, service: str(u.serviceDetails.service) || undefined };
  }
  const stars = Number(u.creatorStars);
  const country = typeof u.country === 'string' ? u.country : isRec(u.country) ? str(u.country.country_name) : '';
  return {
    userId: String(u.userId ?? ''),
    name: displayName(u.fullName, u.userName, u.firstName),
    userName: str(u.userName),
    email: str(u.email),
    profession: str(u.profession) || serviceDetails?.service || '',
    serviceDetails,
    skillDetails: Array.isArray(u.skillDetails) ? u.skillDetails.map(Number).filter((n: number) => Number.isFinite(n)) : [],
    bio: u.about != null ? String(u.about).trim() : '',
    weblink: str(u.weblink),
    address: str(u.address),
    country,
    userRole: u.userRole === 'freelancer' || u.userRole === 'customer' ? u.userRole : undefined,
    hasVerifiedBadge: u.hasVerifiedBadge === true,
    rankingBoostTier: typeof u.rankingBoostTier === 'number' ? u.rankingBoostTier : undefined,
    creatorStars: Number.isFinite(stars) && u.creatorStars != null ? Math.min(5, Math.max(1, stars)) : undefined,
    avatar: pickDisplayableImageUri(normalizeImageDetails(u.imageDetails ?? (u.Location || u.base64Details ? { Location: u.Location, base64Details: u.base64Details } : undefined))),
    updatedTime: typeof u.updatedTime === 'number' ? u.updatedTime : undefined,
    createdTime: typeof u.createdTime === 'number' ? u.createdTime : undefined,
  };
}

/** GET /user/profile[?userId=] (useProfileQuery.ts fetchProfile). */
export async function fetchProfile(userId?: string): Promise<Profile | null> {
  const { data } = await api.get('/user/profile', { params: userId ? { userId } : undefined });
  if (!isRec(data) || data.success !== true || !isRec(data.data)) return null;
  return normalizeProfile(data.data);
}

export type UpdateProfilePayload = {
  fullName: string;
  userName: string;
  email: string;
  about: string;
  profession?: string;
  serviceDetails?: { serviceId?: number; service?: string };
  skillDetails?: number[];
  weblink?: string;
  address?: string;
};

/** POST /user/updateprofile (services/userProfile.ts). */
export async function updateProfile(payload: UpdateProfilePayload) {
  const res = await api.post('/user/updateprofile', payload);
  return unwrap(res);
}

/** POST /user/profileimage multipart field "image" (services/userProfile.ts). */
export async function uploadProfileImage(file: Blob, name: string) {
  const fd = new FormData();
  fd.append('image', file, name);
  const res = await api.post('/user/profileimage', fd);
  return unwrap(res);
}

/* ---------------------------------------------------------- service catalog */

export type ServiceRow = { serviceId: number; service: string; skillArr: { skillId: number; skill: string }[] };

/** GET /masterdata/services (api/masterDataServices.ts → services/serviceCatalog.ts). */
export async function fetchServiceCatalog(): Promise<ServiceRow[]> {
  const { data } = await api.get('/masterdata/services');
  const rows: any[] = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
  return rows
    .map((r) => {
      const serviceId = Number(r?.serviceId);
      const service = str(r?.service);
      if (!Number.isFinite(serviceId) || !service) return null;
      const skillArr = (Array.isArray(r.skillArr) ? r.skillArr : [])
        .map((s: any) => ({ skillId: Number(s?.skillId), skill: str(s?.skill) }))
        .filter((s: any) => Number.isFinite(s.skillId) && s.skill);
      return { serviceId, service, skillArr };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => a.serviceId - b.serviceId) as ServiceRow[];
}

/* ------------------------------------------------------------------ network */

export type NetworkState = { isSelf: boolean; isFollowing: boolean; followerCount: number; followingCount: number };
export type UserRow = {
  userId: string;
  userName?: string;
  hasVerifiedBadge?: boolean;
  rankingBoostTier?: number;
  imageDetails?: any;
  profession?: string;
  serviceDetails?: { service?: string };
  isFollowing?: boolean;
};

export async function fetchNetworkState(userId: string): Promise<NetworkState> {
  const { data } = await api.get('/network/state', { params: { userId } });
  const r = isRec(data?.data) ? data.data : {};
  return {
    isSelf: r.isSelf === true,
    isFollowing: r.isFollowing === true,
    followerCount: Number(r.followerCount) || 0,
    followingCount: Number(r.followingCount) || 0,
  };
}

export const followUser = (targetUserId: string) => api.post('/network/follow', { targetUserId });
export const unfollowUser = (targetUserId: string) => api.post('/network/unfollow', { targetUserId });

export const PAGE_SIZE = 20;

async function pagedUsers(path: string, params: Record<string, any>) {
  const { data } = await api.get(path, { params });
  const items: UserRow[] = Array.isArray(data?.data) ? data.data : [];
  const total = Number(data?.totalCount);
  return { items, totalCount: Number.isFinite(total) ? total : items.length };
}

/** "Network" = people who network with this user (followers). */
export const fetchFollowersPage = (userId: string, pageIndex: number) => pagedUsers('/network/followers', { userId, pageIndex, pageSize: PAGE_SIZE });
/** "Networking" = people this user networks with (following). */
export const fetchFollowingPage = (userId: string, pageIndex: number) => pagedUsers('/network/following', { userId, pageIndex, pageSize: PAGE_SIZE });

/* ------------------------------------------------------------ profile views */

export async function recordProfileView(profileUserId: string) {
  try {
    await api.post('/profile-views/view', { profileUserId });
  } catch {
    /* non-fatal, same as the app */
  }
}
export const fetchViewersPage = (userId: string, pageIndex: number) => pagedUsers('/profile-views/viewers', { userId, pageIndex, pageSize: PAGE_SIZE });

export async function fetchViewersCount(userId: string) {
  const { data } = await api.get('/profile-views/viewers', { params: { userId, pageIndex: 1, pageSize: 1 } });
  return Number(data?.totalCount) || 0;
}

/* ----------------------------------------------------------- creator rating */

export type RatingLevel = 'low' | 'medium' | 'high';
export type RatingComponent = {
  key: 'tipping' | 'content' | 'engagement' | 'recommendations' | 'community' | 'trust';
  label: string;
  weight: number;
  score: number;
  level: RatingLevel;
  stats: Record<string, number>;
  qualities?: { informative: number; entertaining: number; engaging: number; creative: number };
  clean?: boolean;
  issues?: { key: string; label: string; points: number }[];
  tip: string;
};
export type MyRating = {
  stars: number;
  score: number;
  isNew?: boolean;
  trust: number;
  cappedByTrust: boolean;
  visibility: number;
  visibilityLabel: string;
  visibilityBoostPct: number;
  updatedAt: number;
  change7d?: number;
  slipping?: boolean;
  components: RatingComponent[];
};
export async function fetchMyRating(refresh = false): Promise<MyRating> {
  const { data } = await api.get('/rating/me', { params: refresh ? { refresh: 1 } : undefined });
  return data?.data as MyRating;
}

/* ---------------------------------------------------------- recommendations */

export type RecStatus = 'pending' | 'approved' | 'declined';
export type RecRow = {
  recommendationId: number;
  givenUserId: string;
  recipientUserId: string;
  relationship: string;
  relationshipOtherDetail?: string;
  whereWorked?: string;
  body: string;
  status: RecStatus;
  createdTime: number;
  updatedTime: number;
  otherUser?: { userId: string; userName?: string; imageDetails?: any };
  canEdit?: boolean;
  canApprove?: boolean;
  canDecline?: boolean;
};

export const REC_PAGE_SIZE = 10;

export async function fetchRecommendations(p: { direction: 'received' | 'given'; pageIndex?: number; pageSize?: number; userId?: string; status?: RecStatus }) {
  const { data } = await api.get('/recommendations', {
    params: { direction: p.direction, pageIndex: p.pageIndex ?? 1, pageSize: p.pageSize ?? REC_PAGE_SIZE, userId: p.userId, status: p.status },
  });
  if (!isRec(data) || data.success !== true) return { items: [] as RecRow[], totalCount: 0 };
  return { items: (Array.isArray(data.data) ? data.data : []) as RecRow[], totalCount: Number(data.totalCount) || 0 };
}

export async function fetchRecommendationCounts() {
  const { data } = await api.get('/recommendations/counts');
  const r = isRec(data?.data) ? data.data : {};
  return { received: Number(r.received) || 0, given: Number(r.given) || 0, receivedPending: Number(r.receivedPending) || 0 };
}

export async function fetchHasGiven(recipientUserId: string) {
  const { data } = await api.get('/recommendations/has-given', { params: { recipientUserId } });
  const r = isRec(data?.data) ? data.data : {};
  return { hasGiven: r.hasGiven === true, recommendationId: typeof r.recommendationId === 'number' ? r.recommendationId : null, status: (r.status as RecStatus) ?? null };
}

export async function createRecommendation(payload: { recipientUserId: string; relationship: string; relationshipOtherDetail?: string; whereWorked?: string; body: string }) {
  const { data } = await api.post('/recommendations', payload);
  if (!isRec(data) || data.success !== true) throw new Error(str(data?.message) || 'Could not save your recommendation. Please try again.');
  return data.data;
}

export async function updateRecommendation(id: number | string, payload: { relationship?: string; relationshipOtherDetail?: string; whereWorked?: string; body?: string }) {
  const { data } = await api.patch(`/recommendations/${id}`, payload);
  if (!isRec(data) || data.success !== true) throw new Error(str(data?.message) || 'Could not save your recommendation. Please try again.');
  return { status: (data.data?.status as RecStatus) || 'pending', pendingReapproval: data.data?.pendingReapproval === true };
}

export async function updateRecommendationStatus(id: number | string, status: 'approved' | 'declined') {
  const { data } = await api.patch(`/recommendations/${id}/status`, { status });
  if (!isRec(data) || data.success !== true) throw new Error(str(data?.message) || 'Could not update recommendation status. Please try again.');
}

export const RELATIONSHIPS: { value: string; label: string }[] = [
  { value: 'client', label: 'Client' },
  { value: 'employer', label: 'Employer' },
  { value: 'recruiter', label: 'Recruiter' },
  { value: 'coworker', label: 'Coworker' },
  { value: 'freelancer', label: 'Freelancer' },
  { value: 'contractor', label: 'Contractor' },
  { value: 'service_provider', label: 'Service Provider' },
  { value: 'business_partner', label: 'Business Partner' },
  { value: 'team_member', label: 'Team Member' },
  { value: 'manager', label: 'Manager/Supervisor' },
  { value: 'mentor_coach', label: 'Mentor/Coach' },
  { value: 'colleague', label: 'Colleague' },
  { value: 'vendor_supplier', label: 'Vendor/Supplier' },
  { value: 'student', label: 'Student' },
  { value: 'other', label: 'Other' },
];
export const relationshipLabel = (v?: string, other?: string) =>
  v === 'other' ? other?.trim() || 'Other' : RELATIONSHIPS.find((r) => r.value === v)?.label || '';

/* ------------------------------------------------------------------ reviews */

export type ReviewRow = { rating?: number; review?: string; givenUserId?: string; serviceRequestId?: number; createdTime?: number; result?: { userName?: string } };
export async function fetchReviews(userId: string): Promise<ReviewRow[]> {
  const { data } = await api.get('/review', { params: { userId } });
  if (!isRec(data) || data.success !== true || !Array.isArray(data.data)) return [];
  return data.data;
}

/* -------------------------------------------------------------------- posts */

export type Attachment = { src?: string; imgLink?: string; filename?: string; mimetype?: string; thumbnailDetails?: { src?: string; imgLink?: string } };
export type Post = {
  statusPostId: number;
  caption?: string;
  createdBy: string;
  createdTime: number;
  imageArr?: Attachment[];
  likedArr?: unknown[];
  commentArr?: unknown[];
  totalCoins?: number;
  viewCount?: number;
  poll?: { question?: string };
  boostedUntil?: number;
};

export async function fetchPostsPage(viewedUserId: string, isOwn: boolean, page: number) {
  const { data } = isOwn
    ? await api.get('/post/profile-feed', { params: { pageIndex: page, pageSize: PAGE_SIZE } })
    : await api.get('/post/otherpost', { params: { userId: viewedUserId, offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE } });
  const raw: Post[] = Array.isArray(data?.data) ? data.data : [];
  return { items: raw, hasMore: raw.length >= PAGE_SIZE };
}

const looksImage = (v: string) => /\.(jpg|jpeg|png|gif|webp|heic|heif)(\?|#|$)/i.test(v);
const looksVideo = (v: string) => !looksImage(v) && (/\.m3u8|_converted/i.test(v) || /\.(mp4|mov|webm|m4v)(\?|$)/i.test(v));

export function isVideo(a: Attachment) {
  const m = (a.mimetype || '').toLowerCase();
  if (m.startsWith('image/') || m === 'image') return false;
  if (m.includes('video')) return true;
  return looksVideo(`${a.src || ''} ${a.imgLink || ''}`);
}
export function isImage(a: Attachment) {
  if (isVideo(a)) return false;
  const m = (a.mimetype || '').toLowerCase();
  if (m.startsWith('image')) return true;
  return Boolean(str(a.imgLink) || str(a.src));
}
/** Poster/thumbnail for a grid tile (mirrors profileMediaAttachment.pickPosterUri). */
export function posterUri(a: Attachment): string {
  const thumb = str(a.thumbnailDetails?.imgLink) || str(a.thumbnailDetails?.src);
  if (thumb && !looksVideo(thumb)) return thumb;
  const src = str(a.src);
  const link = str(a.imgLink);
  if (!isVideo(a)) return link || src;
  if (link && !looksVideo(link)) return link;
  if (src && !looksVideo(src)) return src;
  return '';
}
export function videoUri(a: Attachment): string {
  const c = [str(a.imgLink), str(a.src)].filter(Boolean);
  return c.find((u) => /\.(mp4|mov|m4v|webm)(\?|$)/i.test(u)) || c[0] || '';
}
export function mediaOf(p: Post) {
  return (p.imageArr || []).filter((a) => a && (isVideo(a) || isImage(a)));
}

/* ------------------------------------------------------------------ helpers */

/** Seconds or milliseconds → Date. */
export function toDate(t?: number) {
  if (!t || !Number.isFinite(t)) return null;
  return new Date(t < 1e12 ? t * 1000 : t);
}
export function fmtDate(t?: number, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) {
  const d = toDate(t);
  return d ? d.toLocaleDateString(undefined, opts) : '';
}

export const badgeColor = (tier?: number) => (tier === 4 ? '#D4AF37' : '#5A99F4');

export function profileShareUrl(userId: string) {
  return `${APP_LINKS.site.replace(/\/+$/, '')}/profile-detail?userId=${encodeURIComponent(userId)}`;
}

export function rowName(r: { userName?: string }) {
  return displayName(r.userName) || 'User';
}
export function rowSkill(r: UserRow) {
  return str(r.profession) || str(r.serviceDetails?.service);
}
export function rowAvatar(r: { imageDetails?: any }) {
  return pickDisplayableImageUri(normalizeImageDetails(r.imageDetails));
}

export function errMsg(e: any, fallback: string) {
  const m = String(e?.message || '');
  if (/failed to fetch|networkerror|load failed/i.test(m)) return 'Connection problem. Check your network and try again.';
  return m && !/^Request failed/.test(m) ? m : fallback;
}

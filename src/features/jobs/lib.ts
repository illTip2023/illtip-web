/**
 * Jobs + Hire Pros data layer. Mirrors illtip-mobile:
 *  - src/api/fetchOtherServiceRequests.ts, src/api/masterDataServices.ts
 *  - src/services/savedJobsApi.ts
 *  - src/utils/serviceRequestJobItem.ts, jobFeedVisibility.ts, jobApplicationStatus.ts, parseDescription.ts
 *  - src/ui/molecules/jobDetails/jobDetailsHelpers.ts
 *  - src/config/store/slices/serviceSlice.ts (AI resume / AI description / validation / submit / history / hire)
 */
import { useEffect, useState } from 'react';
import { api, ApiError, unwrap } from '../../lib/api';
import { normalizeImageDetails, pickDisplayableImageUri } from '../../lib/images';
import { useQuery } from '../../lib/query';
import { toast } from '../../ui/kit';

type Row = Record<string, any>;

/* ───────────────────────── generic helpers ───────────────────────── */

export function str(v: unknown, fallback = ''): string {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return fallback;
}

/** Backend epoch values are seconds (getEpochTime) or ms; normalize to ms. */
export function toMs(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (Number.isFinite(n) && n > 0) return n < 1_000_000_000_000 ? n * 1000 : n;
  const d = new Date(String(raw)).getTime();
  return Number.isFinite(d) && d > 0 ? d : null;
}

export function formatDate(ms: number | null | undefined, withTime = false): string {
  if (!ms) return '';
  const d = new Date(ms);
  if (isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return withTime ? `${date}, ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}` : date;
}

export function errMsg(e: any, fallback = 'Something went wrong. Please try again.'): string {
  const m = String(e?.message ?? '').trim();
  return m || fallback;
}

/** Backend gate codes (403 message) used by the app to route to ChooseYourPlan. */
export function gateCode(e: any): string | null {
  const m = String(e?.data?.message ?? e?.message ?? '').trim();
  return ['SUBSCRIPTION_REQUIRED', 'MONTHLY_LIMIT_REACHED', 'FREE_LIMIT_REACHED'].includes(m) ? m : null;
}

/* ───────────────────────── text / description ───────────────────────── */

export function stripHtmlToPlainText(input: string): string {
  if (!input) return '';
  const withBreaks = input
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|h[1-6]|li|tr)\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '');
  const decoded = withBreaks
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (m, c) => (Number.isFinite(Number(c)) ? String.fromCharCode(Number(c)) : m))
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => (Number.isFinite(parseInt(h, 16)) ? String.fromCharCode(parseInt(h, 16)) : m));
  return decoded.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
}

function implicitAboutText(text: string): string {
  const m = /requirements?:|responsibilities?:/i.exec(text);
  if (!m) return text.trim();
  let cut = m.index;
  const lineStart = text.lastIndexOf('\n', cut - 1) + 1;
  const leadIn = text.slice(lineStart, cut);
  if (leadIn.length <= 40 && !/[.!?]/.test(leadIn)) cut = lineStart;
  return text.slice(0, cut).trim();
}

export type ParsedDescription = { about: string; requirements: string[]; responsibilities: string[]; isStructured: boolean };

export function parseDescription(raw: string): ParsedDescription {
  const text = stripHtmlToPlainText(String(raw ?? '').trim());
  if (!text || text === 'No description provided.') return { about: text, requirements: [], responsibilities: [], isStructured: false };
  const hasAbout = /about:/i.test(text);
  const hasReq = /requirements?:/i.test(text);
  const hasResp = /responsibilities?:/i.test(text);
  if (!hasAbout && !hasReq && !hasResp) return { about: text, requirements: [], responsibilities: [], isStructured: false };
  const aboutM = text.match(/about:\s*([\s\S]*?)(?=requirements?:|responsibilities?:|$)/i);
  const reqM = text.match(/requirements?:\s*([\s\S]*?)(?=responsibilities?:|about:|$)/i);
  const respM = text.match(/responsibilities?:\s*([\s\S]*?)(?=requirements?:|about:|$)/i);
  const bullets = (t: string) =>
    t
      .split('\n')
      .map((s) => s.replace(/^[•\-*]\s*/, '').trim())
      .filter((s) => s.length > 3);
  return {
    about: (hasAbout ? aboutM?.[1]?.trim() : implicitAboutText(text)) || '',
    requirements: reqM ? bullets(reqM[1]) : [],
    responsibilities: respM ? bullets(respM[1]) : [],
    isStructured: true,
  };
}

/* ───────────────────────── master data ───────────────────────── */

export type Skill = { skillId: number; skill: string; imageUrl?: string };
export type MasterService = { serviceId: number; service: string; imageUrl?: string; skills: Skill[] };

function isPlaceholderUrl(url: string) {
  const l = url.toLowerCase();
  return l.includes('default-placeholder') || l.includes('default_placeholder') || l.includes('/placeholder.') || l.endsWith('placeholder.png');
}

function httpUrl(v: unknown): string | undefined {
  const s = str(v).trim();
  return /^https?:\/\//i.test(s) && !isPlaceholderUrl(s) ? s : undefined;
}

/** GET /masterdata/services (public). Mobile: src/api/masterDataServices.ts */
export async function fetchMasterServices(): Promise<MasterService[]> {
  const { data } = await api.get('/masterdata/services');
  const rows: Row[] = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
  return rows
    .filter((r) => r && typeof r === 'object' && r.active !== false)
    .map((r) => ({
      serviceId: Number(r.serviceId),
      service: str(r.service).trim(),
      imageUrl: httpUrl(r.imageUrl) || httpUrl(r.iconPng),
      skills: (Array.isArray(r.skillArr) ? r.skillArr : [])
        .filter((s: any) => s && typeof s === 'object' && s.active !== false)
        .map((s: any) => ({ skillId: Number(s.skillId), skill: str(s.skill).trim(), imageUrl: httpUrl(s.imageUrl) }))
        .filter((s: Skill) => Number.isFinite(s.skillId) && s.skill),
    }))
    .filter((r) => Number.isFinite(r.serviceId) && r.service);
}

export function useMasterServices() {
  return useQuery('jobs:masterdata:services', fetchMasterServices, { staleMs: 6 * 60 * 60 * 1000 });
}

function fallbackImage(services: MasterService[] | undefined, serviceId: number | null, skillId: number | null, serviceName: string, skillName: string): string | undefined {
  if (!services?.length) return undefined;
  const svc =
    (serviceId != null ? services.find((s) => s.serviceId === serviceId) : undefined) ||
    services.find((s) => s.service.toLowerCase() === serviceName.toLowerCase());
  if (svc) {
    const byId = skillId != null ? svc.skills.find((k) => k.skillId === skillId)?.imageUrl : undefined;
    if (byId) return byId;
    const lower = skillName.toLowerCase();
    const byName = lower ? svc.skills.find((k) => k.skill.toLowerCase() === lower)?.imageUrl : undefined;
    if (byName) return byName;
    if (svc.imageUrl) return svc.imageUrl;
  }
  if (skillName) {
    const lower = skillName.toLowerCase();
    for (const s of services) for (const k of s.skills) if (k.imageUrl && k.skill.toLowerCase() === lower) return k.imageUrl;
  }
  return undefined;
}

/* ───────────────────────── job mapping ───────────────────────── */

export type AppStatus = 'pending' | 'accepted' | 'declined' | 'billGenerated';

export function appStatusLabel(s: AppStatus): string {
  return { pending: 'Applied', accepted: 'Hired', declined: 'Request declined', billGenerated: 'Bill generated' }[s];
}

export type Question = { questionId: string; text: string; required?: boolean };

export type Job = {
  id: string;
  numericId: number | null;
  title: string;
  category: string;
  skill: string;
  serviceId: number | null;
  skillId: number | null;
  posterId: string;
  posterName: string;
  posterAvatar?: string;
  posterVerified: boolean;
  location: string;
  currency: string;
  payMin: string;
  payMax: string;
  neededBy: string;
  postedAt: number | null;
  workMode: string;
  urgent: boolean;
  certified: boolean;
  image?: string;
  hashtags: string[];
  description: string;
  link: string;
  shareUrl?: string;
  questions: Question[];
  jobStatus: string;
  appStatus: AppStatus | null;
  viewCount: number | null;
  raw: Row;
};

export function buildLocation(item: Row): string {
  const addr = str(item.address ?? item.location).trim();
  if (addr && addr !== 'No address') return addr;
  const country = typeof item.country === 'string' ? item.country.trim() : str(item.country?.country_name).trim();
  const parts = [str(item.city).trim(), str(item.state).trim(), country].filter(Boolean);
  return parts.length ? parts.join(', ') : 'Unknown location';
}

export function currencySymbolFor(location: string, currency?: { symbol?: unknown; code?: unknown } | null, text = '', maxAmount = 0): string {
  const loc = location.toLowerCase();
  const code = typeof currency?.code === 'string' ? currency.code.toUpperCase() : '';
  if (code === 'NGN') return '₦';
  // Naira is often saved under USD by the CRM (big numbers like 250,000 for a Lagos role, or "Salary: NGN1,000,000").
  // Small amounts on Nigerian jobs are real dollar figures typed in the app, so only large ones count as naira.
  const nigerian = /\bnigeria\b/.test(loc) || /\bNGN\b|₦|\bnaira\b/i.test(text);
  if (nigerian && maxAmount >= 5000) return '₦';
  if (/\bunited kingdom\b/.test(loc) || /\bengland\b/.test(loc) || /\blondon\b/.test(loc) || /\b uk\b/.test(loc)) return '£';
  const sym = typeof currency?.symbol === 'string' ? currency.symbol.trim() : '';
  return sym || '$';
}

function extractPay(item: Row): { min: string; max: string } {
  const clean = (v: unknown) => str(v).replace(/[^\d,.]/g, '');
  const wa = Array.isArray(item.workAmount) ? item.workAmount : Array.isArray(item.payment) ? item.payment : null;
  if (wa && wa.length) {
    const min = clean(wa[0]);
    const max = clean(wa.length > 1 ? wa[1] : wa[0]);
    return { min, max };
  }
  return { min: clean(item.payRangeMin ?? item.minBudget ?? item.minAmount), max: clean(item.payRangeMax ?? item.maxBudget ?? item.maxAmount) };
}

/** USD→NGN rate: same live source as the backend (wallet.service.js), cached for the session; backend fallback 1496.96. */
let NGN_PER_USD = 1496.96;
(async () => {
  try {
    const c = sessionStorage.getItem('illtip.ngnRate');
    if (c) NGN_PER_USD = Number(c) || NGN_PER_USD;
    const r = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    const d = await r.json();
    const v = Number(d?.rates?.NGN);
    if (v > 100) {
      NGN_PER_USD = v;
      sessionStorage.setItem('illtip.ngnRate', String(v));
    }
  } catch {
    /* keep fallback */
  }
})();

const num = (v: string) => Number(String(v).replace(/,/g, ''));
const usd = (n: number) => '$' + (n >= 100 ? Math.round(n / 10) * 10 : Math.round(n)).toLocaleString('en-US');

/**
 * Pay text. Naira amounts are shown in US dollars (Bosun, 26 Oct: "we want most of the jobs to show in $"),
 * converted at today's rate; other currencies as the API gives them. '' if none.
 */
export function payRangeText(job: Pick<Job, 'currency' | 'payMin' | 'payMax'>): string {
  const ok = (v: string) => v && v !== '0' && num(v) > 0;
  const lo = ok(job.payMin) ? num(job.payMin) : 0;
  const hi = ok(job.payMax) ? num(job.payMax) : 0;
  if (!lo && !hi) return '';
  if (job.currency === '₦') {
    const a = lo && usd(lo / NGN_PER_USD);
    const b = hi && usd(hi / NGN_PER_USD);
    if (a && b && a !== b) return `${a} - ${b}`;
    return (a || b) as string;
  }
  const sym = job.currency;
  const fmt = (n: number) => n.toLocaleString('en-US');
  if (lo && hi && lo !== hi) return `${sym}${fmt(lo)} - ${sym}${fmt(hi)}`;
  return `${sym}${fmt(lo || hi)}`;
}

/** For naira jobs: the original amount, shown as a note next to the converted dollars. */
export function nairaNote(job: Pick<Job, 'currency' | 'payMin' | 'payMax'>): string {
  if (job.currency !== '₦') return '';
  const lo = num(job.payMin) || 0;
  const hi = num(job.payMax) || 0;
  if (!lo && !hi) return '';
  const f = (n: number) => '₦' + n.toLocaleString('en-US');
  return `Converted from ${lo && hi && lo !== hi ? `${f(lo)} - ${f(hi)}` : f(lo || hi)} at today's rate`;
}

function normalizeHashtags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const el of raw) {
    let s = typeof el === 'string' ? el : str((el as any)?.tag ?? (el as any)?.name);
    s = s.trim().replace(/^#+/, '').trim();
    if (s) out.push('#' + s);
  }
  return [...new Set(out)];
}

function normalizeListingImage(v: unknown): string | undefined {
  const s = str(v).trim();
  if (!s) return undefined;
  if (/^https?:\/\//i.test(s)) return isPlaceholderUrl(s) ? undefined : s;
  if (/^data:image\//i.test(s)) return s;
  if (/^[a-z0-9+/=\r\n]+$/i.test(s) && s.length > 200) return `data:image/jpeg;base64,${s.replace(/\s+/g, '')}`;
  return undefined;
}

function actionEntries(row: Row): Row[] {
  return Array.isArray(row.action) ? row.action.filter((a: any) => a && typeof a === 'object') : [];
}

export function myAction(row: Row, userId?: string | null): Row | undefined {
  const uid = String(userId ?? '').trim().toLowerCase();
  if (!uid) return undefined;
  return actionEntries(row).find((a) => String(a.actionedBy ?? '').trim().toLowerCase() === uid);
}

/** Mobile: utils/jobApplicationStatus.ts resolveJobApplicationStatus */
export function resolveAppStatus(row: Row, userId?: string | null): AppStatus | null {
  const a = myAction(row, userId);
  if (!a) return null;
  const name = String(a.actionName ?? '').trim().toLowerCase();
  const status = String(a.actionStatus ?? '').trim().toLowerCase();
  if (name === 'declined') return 'declined';
  if (name === 'accepted' && status === 'resolved') return row?.billDetails?.customerBillView ? 'billGenerated' : 'accepted';
  if (name === 'accepted') return 'pending';
  return null;
}

/** Like the app (JobDetailsScreen): a website saved without http(s):// still works as a link. */
export function withScheme(raw: string): string {
  const t = raw.trim();
  if (!t || /\s/.test(t) || !/\.[a-z]{2,}/i.test(t)) return '';
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

/** Mobile: utils/jobFeedVisibility.ts — hired internal jobs drop out of the feed 24h after hire (except for applicants). */
function hideFromFeed(row: Row, userId?: string | null): boolean {
  if (withScheme(str(row.link))) return false;
  const hired = actionEntries(row).filter((a) => String(a.actionName ?? '').toLowerCase() === 'accepted' && String(a.actionStatus ?? '').toLowerCase() === 'resolved');
  if (!hired.length) return false;
  const uid = String(userId ?? '').trim().toLowerCase();
  if (uid && actionEntries(row).some((a) => String(a.actionedBy ?? '').trim().toLowerCase() === uid && String(a.actionName ?? '').toLowerCase() === 'accepted')) return false;
  let at: number | null = null;
  for (const a of hired) {
    const t = toMs(a.updatedTime ?? a.resolvedTime ?? a.modifiedTime ?? a.createdTime);
    if (t != null) at = at == null ? t : Math.max(at, t);
  }
  at = at ?? toMs(row.updatedTime ?? row.modifiedTime);
  return at != null && Date.now() >= at + 24 * 60 * 60 * 1000;
}

function pickPoster(row: Row): { id: string; name: string; avatar?: string; verified: boolean } {
  const rd = row.recruiterDetails;
  if (rd && typeof rd === 'object') {
    let name = str(rd.name).trim() || 'Job poster';
    if (name === 'Unknown User') name = str(row.posterContactSnapshot?.name).trim() || name;
    let avatar: string | undefined;
    if (typeof rd.image === 'string') avatar = normalizeListingImage(rd.image);
    else if (rd.image && typeof rd.image === 'object') avatar = pickDisplayableImageUri(normalizeImageDetails(rd.image));
    return { id: str(rd.userId ?? row.userId).trim(), name, avatar, verified: rd.hasVerifiedBadge === true };
  }
  const u = Array.isArray(row.userDetails) ? row.userDetails[0] : null;
  if (u && typeof u === 'object') {
    const name = (u.userName && String(u.userName) !== 'undefined' ? str(u.userName).trim() : '') || str(u.fullName).trim() || 'Job poster';
    return { id: str(u.userId).trim(), name, avatar: pickDisplayableImageUri(normalizeImageDetails(u.imageDetails)), verified: u.hasVerifiedBadge === true };
  }
  const snap = str(row.posterContactSnapshot?.name).trim();
  return { id: str(row.userId).trim(), name: snap || str(row.userName ?? row.createdBy).trim() || 'Job poster', verified: false };
}

export function mapJob(row: Row, userId?: string | null, services?: MasterService[]): Job {
  const id = str(row.serviceRequestId ?? row._id ?? row.id);
  const numericId = Number.isFinite(Number(row.serviceRequestId)) ? Number(row.serviceRequestId) : Number.isFinite(Number(id)) ? Number(id) : null;
  const skill = str(row.skillTypeDetails?.skill).trim();
  const service = str(row.serviceDetails?.service ?? row.category).trim();
  const serviceName = str(row.serviceName).trim();
  const sid = Number(row.serviceDetails?.serviceId);
  const kid = Number(row.skillTypeDetails?.skillId);
  const serviceId = Number.isFinite(sid) ? sid : null;
  const skillId = Number.isFinite(kid) && kid > 0 ? kid : null;
  const location = buildLocation(row);
  const { min, max } = extractPay(row);
  const img0 = Array.isArray(row.imageDetails) ? row.imageDetails[0] : undefined;
  const listing = [row.skillImageUrl, img0?.imgLink, img0?.base64Details, img0?.url, img0?.Location, img0?.filename, row.base64Img, row.imageUrl]
    .map(normalizeListingImage)
    .find(Boolean);
  const poster = pickPoster(row);
  const view = Number(row.viewCount);
  return {
    id,
    numericId,
    title: serviceName || skill || service || 'Service Request',
    category: service || skill,
    skill,
    serviceId,
    skillId,
    posterId: poster.id,
    posterName: poster.name,
    posterAvatar: poster.avatar,
    posterVerified: poster.verified,
    location,
    currency: currencySymbolFor(location, row.currency, `${str(row.serviceName)} ${str(row.workDec ?? row.description)}`, Math.max(Number(String(min).replace(/,/g, '')) || 0, Number(String(max).replace(/,/g, '')) || 0)),
    payMin: min,
    payMax: max,
    neededBy: formatDate(toMs(row.workTime ?? row.date)),
    postedAt: toMs(row.createdTime ?? row.createdAt),
    workMode: str(row.workMode).trim().toLowerCase(),
    urgent: row.priorityDetails?.urgency === true || row.priorityDetails?.priority === true,
    certified: row.isCertified === true,
    image: listing || fallbackImage(services, serviceId, skillId, service, skill || serviceName),
    hashtags: normalizeHashtags(row.hashtags),
    description: str(row.workDec ?? row.description ?? row.modelDec ?? row.workDescription),
    link: withScheme(str(row.link)),
    shareUrl: str(row.shareUrl).trim() || undefined,
    questions: Array.isArray(row.questions)
      ? row.questions
          .filter((q: any) => q && typeof q === 'object' && str(q.text).trim())
          .map((q: any, i: number) => ({ questionId: str(q.questionId) || String(i), text: str(q.text).trim(), required: q.required !== false }))
      : [],
    jobStatus: str(row.status).trim().toLowerCase(),
    appStatus: resolveAppStatus(row, userId),
    viewCount: Number.isFinite(view) && view >= 0 ? Math.floor(view) : null,
    raw: row,
  };
}

export function workModeLabel(m: string): string {
  return m === 'remote' ? 'Remote' : m === 'onsite' ? 'On-site' : m === 'hybrid' ? 'Hybrid' : '';
}

/** Rows seen in lists, so a details page can render instantly while it refreshes. */
export const jobRowCache = new Map<string, Row>();

/* ───────────────────────── job feed ───────────────────────── */

export type JobFilters = {
  q: string;
  serviceId: number | null;
  status: 'all' | 'open' | 'applied';
  workMode: 'all' | 'remote' | 'onsite' | 'hybrid';
  datePosted: 'allJobs' | 'last24Hours' | 'last3days' | 'last7days' | 'last14days';
  address: string;
  near: { latitude: number; longitude: number } | null;
};

export const JOBS_PAGE_SIZE = 10;

/** GET /service/v2/fetchOtherServiceRequestList — mobile src/api/fetchOtherServiceRequests.ts */
export async function fetchJobsPage(f: JobFilters, page: number, userId: string | undefined, services: MasterService[] | undefined) {
  const q = f.q.trim();
  const params: Record<string, any> = { pageIndex: page, pageSize: JOBS_PAGE_SIZE };
  // Category chip is visual-only while searching (mobile: apiListFilterServiceId)
  if (!q && f.serviceId != null) params.serviceId = f.serviceId;
  if (q) params.search = q;
  if (f.near) {
    params.latitude = f.near.latitude;
    params.longitude = f.near.longitude;
    params.radiusMiles = 30;
  } else if (f.address.trim()) params.address = f.address.trim();
  if (f.status === 'open') params.status = 'open';
  if (f.status === 'applied') params.status = 'pending';
  if (f.datePosted !== 'allJobs') params.createdTime = f.datePosted;
  if (f.workMode !== 'all') params.workMode = f.workMode;
  const { data } = await api.get('/service/v2/fetchOtherServiceRequestList', { params });
  if (data && data.success === false) throw new Error(data.message || 'Could not load jobs. Please try again.');
  const inner = data?.data;
  const rows: Row[] = Array.isArray(inner) ? inner : Array.isArray(inner?.data) ? inner.data : Array.isArray(data) ? data : [];
  const total = typeof inner?.totalItems === 'number' ? inner.totalItems : null;
  const visible = rows.filter((r) => r && typeof r === 'object' && !hideFromFeed(r, userId));
  visible.forEach((r) => jobRowCache.set(str(r.serviceRequestId ?? r._id), r));
  return {
    items: visible.map((r) => mapJob(r, userId, services)),
    hasMore: total != null ? page * JOBS_PAGE_SIZE < total : rows.length === JOBS_PAGE_SIZE,
  };
}

/** GET /service/v2/serviceRequest/:id — mobile JobDetailsScreen refetchServiceRequest */
export async function fetchJobById(id: string): Promise<Row> {
  const res = await api.get(`/service/v2/serviceRequest/${encodeURIComponent(id)}`);
  const row = unwrap<Row>(res);
  if (!row || typeof row !== 'object') throw new Error('Job not found');
  jobRowCache.set(id, row);
  return row;
}

/** POST /service/v2/recordJobView — returns the updated view count when known. */
export async function recordJobView(serviceRequestId: number): Promise<number | null> {
  try {
    const { data } = await api.post('/service/v2/recordJobView', { serviceRequestId });
    if (data?.success !== true) return null;
    const n = Number(data?.data?.viewCount);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
  } catch {
    return null;
  }
}

export function viewsLabel(n: number): string {
  if (n <= 0) return 'No one else has viewed this job';
  if (n === 1) return '1 other person has viewed this job';
  return `${n} other people have viewed this job`;
}

/* ───────────────────────── saved jobs ───────────────────────── */

let savedIds: Set<string> | null = null;
let savedLoading: Promise<void> | null = null;
const savedSubs = new Set<() => void>();
const emitSaved = () => savedSubs.forEach((f) => f());

async function loadSavedIds(force = false) {
  if (savedIds && !force) return;
  if (savedLoading) return savedLoading;
  savedLoading = (async () => {
    try {
      const { data } = await api.get('/service/v2/savedJobIds');
      const ids: unknown[] = data?.data?.serviceRequestIds ?? [];
      savedIds = new Set(ids.map((x) => String(x)));
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 401) savedIds = new Set();
      else savedIds = savedIds ?? new Set();
    } finally {
      savedLoading = null;
      emitSaved();
    }
  })();
  return savedLoading;
}

export function replaceSavedIds(ids: string[]) {
  savedIds = new Set(ids);
  emitSaved();
}

export function useSavedJobIds() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const f = () => setTick((t) => t + 1);
    savedSubs.add(f);
    loadSavedIds();
    return () => {
      savedSubs.delete(f);
    };
  }, []);
  const ids = savedIds ?? new Set<string>();
  const toggle = async (job: { id: string; numericId: number | null }) => {
    const id = job.id;
    const num = job.numericId ?? Number(id);
    if (!Number.isFinite(num) || num <= 0) return;
    const was = ids.has(id);
    const next = new Set(ids);
    if (was) next.delete(id);
    else next.add(id);
    savedIds = next;
    emitSaved();
    try {
      await api.post('/service/v2/bookmarkJob', { serviceRequestId: num, action: was ? 'UNSAVE' : 'SAVE' });
      toast.ok(was ? 'Removed from saved jobs' : 'Job saved');
    } catch {
      const back = new Set(savedIds ?? []);
      if (was) back.add(id);
      else back.delete(id);
      savedIds = back;
      emitSaved();
      toast.error('Could not update saved job. Please try again.');
    }
  };
  return { ids, has: (id: string) => ids.has(id), toggle };
}

/** GET /service/v2/savedJobs — mobile services/savedJobsApi.ts fetchSavedJobs */
export async function fetchSavedJobs(userId: string | undefined, services: MasterService[] | undefined): Promise<Job[]> {
  const { data } = await api.get('/service/v2/savedJobs', { params: { pageIndex: 1, pageSize: 100 } });
  const rows: Row[] = (data?.data?.data ?? []).filter((r: any) => r && typeof r === 'object');
  rows.forEach((r) => jobRowCache.set(str(r.serviceRequestId ?? r._id), r));
  const jobs = rows.map((r) => mapJob(r, userId, services));
  // Badge count follows the list — /savedJobIds can include stale ids for deleted jobs.
  replaceSavedIds(jobs.map((j) => j.id));
  return jobs;
}

/* ───────────────────────── share ───────────────────────── */

export async function shareJob(job: { id: string; numericId: number | null; title: string; shareUrl?: string }) {
  let url = job.shareUrl || '';
  if (!url && job.numericId) {
    try {
      const { data } = await api.get('/service/v2/jobShareUrl', { params: { serviceRequestId: job.numericId } });
      url = str(data?.data?.shareUrl).trim();
    } catch {
      /* fall back below */
    }
  }
  if (!url) url = `${location.origin}${location.pathname}#/jobs/${encodeURIComponent(job.id)}`;
  const nav: any = navigator;
  if (typeof nav.share === 'function') {
    try {
      await nav.share({ title: job.title, text: `${job.title} on i'llTip`, url });
      return;
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast.ok('Job link copied');
  } catch {
    window.prompt('Copy this job link', url);
  }
}

/* ───────────────────────── subscriptions (read only) ───────────────────────── */

type SubStatus = Record<string, { active?: boolean } | undefined>;

/** GET /subscriptions/me — mobile services/subscriptions.ts fetchMySubscriptionStatus. Failure = not subscribed (same as app). */
export async function fetchSubscriptionStatus(): Promise<SubStatus> {
  try {
    const { data } = await api.get('/subscriptions/me');
    const d = data && typeof data === 'object' && 'data' in data ? data.data : data;
    return (d && typeof d === 'object' ? d : {}) as SubStatus;
  } catch {
    return {};
  }
}

/** Mirrors hasEffectiveAccess (useSubscriptionStatus): Elite Gold also unlocks career + hire. */
export function hasAccess(s: SubStatus | undefined, catalog: 'career' | 'hire'): boolean {
  return Boolean(s?.[catalog]?.active || s?.eliteGold?.active);
}

/* ───────────────────────── profile ───────────────────────── */

export async function fetchProfile(userId: string): Promise<Row | null> {
  try {
    const { data } = await api.get('/user/profile', { params: { userId } });
    if (data?.success !== true || !data?.data || typeof data.data !== 'object') return null;
    return data.data as Row;
  } catch {
    return null;
  }
}

/* ───────────────────────── AI resume ───────────────────────── */

export type AiSuggestion = { about: string; requirements: string[]; responsibilities: string[]; softSkills?: string[]; projects?: string[] };

function flattenSuggestionObject(o: Row): string[] {
  const lines: string[] = [];
  const title = str(o.title ?? o.role).trim();
  const company = str(o.company ?? o.organization).trim();
  const dates = str(o.dates ?? o.dateRange).trim();
  const loc = str(o.location).trim();
  if (title && company) lines.push(`${title} | ${company}`);
  else if (title) lines.push(title);
  if (loc || dates) lines.push([loc, dates].filter(Boolean).join(' | '));
  for (const src of [o.bullets, o.achievements, o.responsibilities, o.details]) lines.push(...normList(src));
  for (const k of ['description', 'detail', 'text', 'content']) if (typeof o[k] === 'string' && o[k].trim()) lines.push(o[k].trim());
  return lines;
}

function normList(v: unknown): string[] {
  if (v == null) return [];
  if (typeof v === 'string') return v.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const it of v) {
    if (typeof it === 'string') {
      if (it.trim()) out.push(it.trim());
    } else if (it && typeof it === 'object') out.push(...flattenSuggestionObject(it as Row));
  }
  return out;
}

function pickList(o: Row, keys: string[]): string[] {
  for (const k of keys) {
    const l = normList(o[k]);
    if (l.length) return l;
  }
  return [];
}

function suggestionsArray(raw: any): any[] | null {
  for (const c of [raw?.suggetions, raw?.suggestions, raw?.data?.suggetions, raw?.data?.suggestions]) if (Array.isArray(c) && c.length) return c;
  return null;
}

function scoreSuggestion(s: AiSuggestion) {
  return (s.about ? 1 : 0) + (s.responsibilities.length ? 10 : 0) + (s.requirements.length ? 5 : 0) + ((s.softSkills ?? []).length ? 2 : 0) + ((s.projects ?? []).length ? 3 : 0);
}

export type AiResumeArgs = {
  category: string;
  skillName: string;
  description: string;
  applicantAbout: string;
  applicantName: string;
  applicantEmail: string;
  applicantPhone: string;
  applicantProfession: string;
};

/** POST /ai-service/v2/ai-resume — serviceSlice fetchAiResumeSuggestion. Throws Error('SUBSCRIPTION_REQUIRED' | 'MONTHLY_LIMIT_REACHED') on the paywall. */
export async function fetchAiResume(a: AiResumeArgs): Promise<{ suggestions: AiSuggestion[]; usage: { remaining: number; limit: number; notify: boolean } | null }> {
  let raw: any;
  try {
    const res = await api.post('/ai-service/v2/ai-resume', {
      jobCategory: a.category || 'General',
      subCategory: a.skillName || 'General',
      job_post_content: a.description || '',
      language: 'en',
      applicant_about: a.applicantAbout || '',
      applicant_name: a.applicantName || '',
      applicant_email: a.applicantEmail || '',
      applicant_phone: a.applicantPhone || '',
      applicant_profession: a.applicantProfession || '',
      optionsCount: 1,
    });
    raw = res.data;
  } catch (e: any) {
    const code = gateCode(e);
    if (e instanceof ApiError && e.status === 403 && code) throw new Error(code);
    throw new Error('Could not generate a resume. Please try again.');
  }
  const arr = suggestionsArray(raw);
  if (!arr) throw new Error('Could not generate a resume. Please try again.');
  const mapped: AiSuggestion[] = [];
  for (const it of arr) {
    if (!it || typeof it !== 'object') continue;
    const o = it as Row;
    const about = str(o.about || o.summary || o.professionalSummary || o.professional_summary).trim();
    if (!about) continue;
    const resp = pickList(o, ['responsibilities', 'experience', 'relevantExperience', 'workExperience', 'work_experience']);
    const projects = pickList(o, ['projects', 'featuredProjects']);
    mapped.push({
      about,
      requirements: pickList(o, ['requirements', 'skills', 'qualifications', 'technicalSkills', 'skills_and_qualifications']),
      responsibilities: resp.length ? resp : projects,
      softSkills: pickList(o, ['softSkills', 'soft_skills']),
      projects,
    });
  }
  mapped.sort((x, y) => scoreSuggestion(y) - scoreSuggestion(x));
  const donor = mapped.find((s) => s.responsibilities.length || (s.projects ?? []).length);
  if (!donor) throw new Error('Could not generate a resume. Please try again.');
  const filled = mapped.map((s) => (s.responsibilities.length || (s.projects ?? []).length ? s : { ...s, responsibilities: [...donor.responsibilities] }));
  const u = raw?.usage;
  const usage = u && u.unlimited === false ? { remaining: Number(u.remaining) || 0, limit: Number(u.limit) || 0, notify: Boolean(u.shouldNotifyRemaining) } : null;
  return { suggestions: filled.slice(0, 3), usage };
}

const bullet = (items: string[]) => items.map((i) => i.trim()).filter(Boolean).map((i) => (/^[•\-–]\s/.test(i) || i.includes('|') ? i : `• ${i}`)).join('\n');

/** Mobile jobDetailsHelpers.formatAiResumeText */
export function formatAiResumeText(s: AiSuggestion, role: string, c: { name?: string; email?: string; phone?: string; location?: string }): string {
  const lines: string[] = [];
  if (c.name?.trim()) lines.push(c.name.trim());
  if (role.trim()) lines.push(role.trim());
  if (c.phone?.trim()) lines.push(c.phone.trim());
  if (c.email?.trim()) lines.push(c.email.trim());
  if (c.location?.trim()) lines.push(c.location.trim());
  if (lines.length) lines.push('');
  const exp = s.responsibilities.length ? s.responsibilities : s.projects ?? [];
  const skills = [...s.requirements, ...(s.softSkills ?? [])].filter(Boolean);
  lines.push('PROFESSIONAL SUMMARY', s.about.trim() || 'Describe your professional background and strengths for this role.', '');
  lines.push('EXPERIENCE', exp.length ? bullet(exp) : '• Add your relevant work experience for this role.', '');
  lines.push('SKILLS', skills.length ? bullet(skills) : '• Add your key skills for this role.');
  return lines.join('\n').trim();
}

/* ───────────────────────── apply ───────────────────────── */

export type ResumeDetails = {
  type: 'ai' | 'file';
  originalName?: string | null;
  mimeType?: string | null;
  filename?: string | null;
  fileUrl?: string | null;
  Location?: string | null;
  aiText?: string | null;
};

/** POST /service/v2/resume (multipart "file") — useJobDetailsApplyFlow.uploadApplicantResumeFile */
export async function uploadResumeFile(file: File): Promise<ResumeDetails> {
  const fd = new FormData();
  fd.append('file', file, file.name || `resume_${Date.now()}.pdf`);
  const { data } = await api.post('/service/v2/resume', fd);
  const up = data?.data;
  if (data?.success === false || !up?.filename) throw new Error('We could not upload your resume. Please try again.');
  return {
    type: 'file',
    originalName: str(up.originalName) || file.name,
    mimeType: str(up.mimeType) || file.type || null,
    filename: str(up.filename),
    Location: str(up.Location) || undefined,
    ...(str(up.fileUrl).trim() ? { fileUrl: str(up.fileUrl).trim() } : {}),
  };
}

/** POST /service/v2/particularservicerequestaction — useJobDetailsApplyFlow.submitApplication */
export async function applyToJob(args: {
  serviceRequestId: number;
  userId: string;
  resumeDetails: ResumeDetails | null;
  screeningAnswers?: { questionId: string; question: string; answer: string }[];
  appliedVia?: string;
}): Promise<{ contact: string }> {
  const res = await api.post('/service/v2/particularservicerequestaction', {
    serviceRequestId: args.serviceRequestId,
    actionedBy: args.userId,
    actionId: Date.now() + Math.floor(Math.random() * 1000),
    actionName: 'Accepted',
    actionStatus: 'pending',
    ...(args.resumeDetails ? { resumeDetails: args.resumeDetails } : {}),
    ...(args.screeningAnswers?.length ? { screeningAnswers: args.screeningAnswers } : {}),
    ...(args.appliedVia ? { appliedVia: args.appliedVia } : {}),
  });
  const d = unwrap<Row>(res);
  const contact = d && typeof d === 'object' && !Array.isArray(d) ? str(d.contactInfo ?? d.email ?? d.phone).trim() : '';
  return { contact };
}

/** Contact already present on the job (after apply) — useJobDetailsContact */
export function contactFromRow(row: Row, userId?: string | null): string {
  const act = myAction(row, userId);
  const snap = act?.posterContactSnapshot;
  const fromSnap = (s: any) => (s && typeof s === 'object' ? str(s.contactInfo ?? s.email ?? s.phone).trim() : '');
  return (
    fromSnap(snap) ||
    str(row.isEmail).trim() ||
    str(row.contactInfo).trim() ||
    fromSnap(row.posterContactSnapshot) ||
    fromSnap(row.recruiterDetails)
  );
}

/** GET /service/v2/applicant-job-contact, falling back to the poster's profile (same as the app). */
export async function fetchApplicantContact(serviceRequestId: number, posterId: string): Promise<{ contact: string; locked: boolean }> {
  try {
    const { data } = await api.get('/service/v2/applicant-job-contact', { params: { serviceRequestId } });
    const d = data?.data;
    if (data?.success !== false && d && typeof d === 'object') {
      if (d.employerDetailsLocked === true) return { contact: '', locked: true };
      const c = str(d.contactInfo || d.email || d.phone).trim();
      if (c) return { contact: c, locked: false };
    }
  } catch {
    /* fall through */
  }
  if (posterId) {
    const p = await fetchProfile(posterId);
    const c = str(p?.email ?? p?.emailId).trim() || str(p?.mobileNo ?? p?.phone).trim();
    if (c) return { contact: c, locked: false };
  }
  return { contact: '', locked: false };
}

/** GET /service/v2/resume/signed-url when the resume has no usable URL yet. */
export async function resolveResumeUrl(r: ResumeDetails): Promise<string | null> {
  const existing = str(r.fileUrl).trim();
  if (existing && /[?&](Signature=|X-Amz-Signature=)/i.test(existing)) return existing;
  if (r.filename) {
    try {
      const { data } = await api.get('/service/v2/resume/signed-url', {
        params: { filename: r.filename, mimeType: r.mimeType || undefined, originalName: r.originalName || undefined },
      });
      const u = str(data?.data?.fileUrl).trim();
      if (u) return u;
    } catch {
      /* ignore */
    }
  }
  const loc = str(r.Location).trim();
  if (loc && /[?&](Signature=|X-Amz-Signature=)/i.test(loc)) return loc;
  return existing || null;
}

export function normalizeResume(raw: unknown): ResumeDetails | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Row;
  const aiText = str(e.aiText).trim() || null;
  const filename = str(e.filename).trim() || null;
  const loc = str(e.Location ?? e.location).trim() || null;
  const type = e.type === 'ai' || e.type === 'file' ? e.type : aiText ? 'ai' : filename || loc ? 'file' : null;
  if (!type) return null;
  if (type === 'ai' && !aiText) return null;
  const fileUrl = str(e.fileUrl).trim() || null;
  if (type === 'file' && !filename && !fileUrl && !loc) return null;
  return { type, aiText, filename, fileUrl, Location: loc, originalName: str(e.originalName).trim() || null, mimeType: str(e.mimeType).trim() || null };
}

/* ───────────────────────── poster side: history + applicants ───────────────────────── */

export type MyJob = {
  id: string;
  title: string;
  category: string;
  skill: string;
  image?: string;
  payText: string;
  location: string;
  neededBy: string;
  postedAt: number | null;
  workMode: string;
  status: 'open' | 'work_in_progress' | 'closed' | 'bill_generated' | string;
  applicantCount: number;
  hiredCount: number;
  urgent: boolean;
  raw: Row;
};

export function mapMyJob(row: Row, services?: MasterService[]): MyJob {
  const j = mapJob(row, null, services);
  const actions = actionEntries(row);
  const hired = actions.filter((a) => String(a.actionName ?? '').toLowerCase() === 'accepted' && String(a.actionStatus ?? '').toLowerCase() === 'resolved').length;
  const status = row?.billDetails?.customerBillView ? 'bill_generated' : str(row.status).toLowerCase() === 'closed' ? 'closed' : hired > 0 ? 'work_in_progress' : str(row.status) || 'open';
  return {
    id: j.id,
    title: j.title,
    category: j.category,
    skill: j.skill,
    image: j.image,
    payText: payRangeText(j),
    location: j.location,
    neededBy: j.neededBy,
    postedAt: j.postedAt,
    workMode: j.workMode,
    status,
    applicantCount: actions.length,
    hiredCount: hired,
    urgent: j.urgent,
    raw: row,
  };
}

export const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  work_in_progress: 'Work in Progress',
  closed: 'Closed',
  bill_generated: 'Bill Generated',
};

/** GET /service/v2/fetchServiceRequestList — serviceSlice fetchServiceHistory */
export async function fetchMyJobsPage(page: number, services?: MasterService[]) {
  const { data } = await api.get('/service/v2/fetchServiceRequestList', { params: { pageIndex: page, pageSize: 10 } });
  if (data && data.success === false) throw new Error(data.message || 'Could not load your jobs.');
  const inner = data?.data;
  const rows: Row[] = Array.isArray(inner?.data) ? inner.data : Array.isArray(inner) ? inner : [];
  const items = rows.filter((r) => r && r.status !== 'deleted' && r.status !== 'delete').map((r) => mapMyJob(r, services));
  return { items, hasMore: typeof inner?.hasMore === 'boolean' ? inner.hasMore : rows.length === 10 };
}

export type Applicant = {
  actionedBy: string;
  actionName: string;
  actionStatus: string;
  createdTime: number | null;
  userName: string;
  profileImage: string | null;
  service: string;
  resumeDetails: ResumeDetails | null;
  screeningAnswers: { questionId?: string; question: string; answer: string }[];
  fitSummary: string | null;
};

/** GET /service/v2/fetchApplicants — hooks/useApplicantsQuery.ts */
export async function fetchApplicants(serviceRequestId: string): Promise<Applicant[]> {
  const { data } = await api.get('/service/v2/fetchApplicants', { params: { serviceRequestId } });
  if (data?.success === false) throw new Error(data.message || 'Failed to fetch applicants');
  const list: Row[] = Array.isArray(data?.data) ? data.data : [];
  return list.map((a) => ({
    actionedBy: str(a.actionedBy),
    actionName: str(a.actionName || 'Accepted'),
    actionStatus: str(a.actionStatus || 'pending'),
    createdTime: toMs(a.createdTime),
    userName: str(a.userName).trim() || 'User',
    profileImage: str(a.profileImage).trim() || null,
    service: str(a.service).trim(),
    resumeDetails: normalizeResume(a.resumeDetails),
    screeningAnswers: Array.isArray(a.screeningAnswers) ? a.screeningAnswers : [],
    fitSummary: typeof a.fitSummary === 'string' && a.fitSummary.trim() ? a.fitSummary.trim() : null,
  }));
}

/** POST /service/v2/hireApplicant — serviceSlice hireApplicant */
export async function hireApplicant(serviceRequestId: number, actionedBy: string): Promise<void> {
  const res = await api.post('/service/v2/hireApplicant', { serviceRequestId, actionedBy });
  unwrap(res);
}

/** POST /service/deleteServices — serviceSlice deleteServiceFromBackend */
export async function deleteJob(id: string): Promise<void> {
  const res = await api.post('/service/deleteServices', [id, Number(id)]);
  unwrap(res);
}

/** POST /service/v2/fetchJobStatusDeltas — hooks/useJobStatusPolling.ts */
export async function fetchJobStatusDeltas(ids: string[]): Promise<{ serviceId: string; status: string; applicantCount: number; hiredCount: number }[]> {
  if (!ids.length) return [];
  const { data } = await api.post('/service/v2/fetchJobStatusDeltas', { serviceRequestIds: ids });
  return Array.isArray(data?.data) ? data.data : [];
}

/* ───────────────────────── location ───────────────────────── */

export type Place = { fullText: string; latitude?: number; longitude?: number; city?: string; state?: string; country?: string };

/** Google Places through the backend proxy (SERVICE config GOOGLE_MAPS_API_PROXY_URL in mobile src/config/api.ts). */
export async function placeAutocomplete(input: string): Promise<{ description: string; placeId: string }[]> {
  const { data } = await api.get('/user/google-maps-api/place/autocomplete/json', { params: { input, language: 'en' } });
  const preds: Row[] = Array.isArray(data?.predictions) ? data.predictions : [];
  return preds.map((p) => ({ description: str(p.description), placeId: str(p.place_id) })).filter((p) => p.description && p.placeId);
}

export async function placeDetails(placeId: string, description: string): Promise<Place> {
  const { data } = await api.get('/user/google-maps-api/place/details/json', { params: { place_id: placeId, fields: 'geometry,address_components', language: 'en' } });
  const r = data?.result ?? {};
  const comps: Row[] = Array.isArray(r.address_components) ? r.address_components : [];
  const find = (t: string) => comps.find((c) => Array.isArray(c.types) && c.types.includes(t))?.long_name as string | undefined;
  return {
    fullText: description,
    latitude: Number.isFinite(Number(r.geometry?.location?.lat)) ? Number(r.geometry.location.lat) : undefined,
    longitude: Number.isFinite(Number(r.geometry?.location?.lng)) ? Number(r.geometry.location.lng) : undefined,
    city: find('locality'),
    state: find('administrative_area_level_1'),
    country: find('country'),
  };
}

/** GET /user/reversegeocode — mobile src/api/reverseGeocodeLocation.ts */
export async function reverseGeocode(latitude: number, longitude: number): Promise<string> {
  try {
    const { data } = await api.get('/user/reversegeocode', { params: { latitude, longitude } });
    if (data?.success !== true) return '';
    return str(data.data?.label).trim() || str(data.data?.formatted_address).trim();
  } catch {
    return '';
  }
}

export function getDeviceLocation(): Promise<{ latitude: number; longitude: number }> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('Location is not available in this browser.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
      () => reject(new Error('Allow location access to see jobs near you.')),
      { enableHighAccuracy: false, timeout: 12_000, maximumAge: 5 * 60_000 },
    );
  });
}

/* ───────────────────────── post a job (Hire Pros) ───────────────────────── */

/** POST /ai-service/v2/ai-suggestions — serviceSlice fetchAiDescriptionSuggestion */
export async function fetchAiDescription(a: { category: string; skillName: string; description: string }): Promise<AiSuggestion> {
  let raw: any;
  try {
    const res = await api.post('/ai-service/v2/ai-suggestions', {
      jobCategory: a.category || 'General',
      subCategory: a.skillName || 'General',
      job_post_content: a.description || '',
      language: 'en',
    });
    raw = res.data;
  } catch {
    throw new Error('Could not generate a suggestion. Please try again.');
  }
  const arr = suggestionsArray(raw);
  if (!arr) throw new Error('Could not generate a suggestion. Please try again.');
  const picked = arr[Math.floor(Math.random() * arr.length)] as Row;
  const about = str(picked?.about || picked?.description).trim();
  if (!about) throw new Error('Could not generate a suggestion. Please try again.');
  return { about, requirements: normList(picked.requirements), responsibilities: normList(picked.responsibilities) };
}

/** POST /ai-service/v2/validate-description — serviceSlice validateJobDescription (fails open, like the app). */
export async function validateDescription(a: { description: string; jobCategory: string; subCategory: string }): Promise<boolean> {
  try {
    const { data } = await api.post('/ai-service/v2/validate-description', {
      job_post_content: a.description,
      jobCategory: a.jobCategory,
      subCategory: a.subCategory,
      language: 'en',
    });
    return data?.valid === true;
  } catch {
    return true;
  }
}

/** GET /service/v2/checkLimit — serviceSlice checkServiceRequestFreeLimit. Returns the gate code or null. */
export async function checkPostLimit(): Promise<string | null> {
  try {
    await api.get('/service/v2/checkLimit');
    return null;
  } catch (e: any) {
    if (e instanceof ApiError && e.status === 403 && gateCode(e) === 'FREE_LIMIT_REACHED') return 'FREE_LIMIT_REACHED';
    return null; // pre-check failure never blocks; save endpoint is authoritative
  }
}

/** POST /service/image (multipart "image") → S3 filename, or null (post continues without a custom photo). */
export async function uploadJobImage(file: File): Promise<string | null> {
  try {
    const fd = new FormData();
    fd.append('image', file, file.name || `job_image_${Date.now()}.jpg`);
    const { data } = await api.post('/service/image', fd);
    return data?.success && Array.isArray(data?.data) && data.data[0]?.filename ? String(data.data[0].filename) : null;
  } catch {
    return null;
  }
}

export type NewJob = {
  serviceName: string;
  category: string;
  categoryServiceId: number | null;
  skillId: number | null;
  skillName: string;
  skillImageUrl: string | null;
  description: string;
  workMode: string;
  place: Place;
  urgency: boolean;
  date: Date;
  payment: number[];
  currency: { symbol: string; code: string };
  link: string;
  contact: string;
  hashtags: string[];
  questions: { text: string; required: boolean }[];
  isCertified: boolean;
  isLimitedRadius: boolean;
  imageFilename: string | null;
};

/** POST /service/v2/saveServiceRequest — serviceSlice submitServiceRequest payload. Throws Error(gate code) on 403 limits. */
export async function saveServiceRequest(d: NewJob): Promise<string | null> {
  const p = d.place;
  const payload = {
    serviceName: d.serviceName,
    category: d.category || 'General',
    workDec: d.description,
    description: d.description,
    workMode: d.workMode,
    serviceDetails: { serviceId: d.categoryServiceId ?? 999, service: d.category || 'General' },
    skillTypeDetails: { skillId: d.skillId || 0, skill: d.skillName || '' },
    address: p.fullText,
    country: p.country || '',
    state: p.state || '',
    city: p.city || '',
    latitude: p.latitude,
    longitude: p.longitude,
    coordinate: p.latitude != null && p.longitude != null ? { type: 'Point', coordinates: [p.longitude, p.latitude] } : null,
    priorityDetails: { urgency: d.urgency, priority: d.urgency },
    workTime: d.date.getTime(),
    workAmount: d.payment,
    currency: d.currency,
    status: 'open',
    link: d.link || '',
    contactInfo: d.contact || '',
    hashtags: d.hashtags,
    questions: d.questions,
    imageDetails: d.imageFilename ? [{ filename: d.imageFilename }] : [],
    skillImageUrl: d.skillImageUrl || null,
    isCertified: d.isCertified,
    isInRadius: d.isLimitedRadius,
  };
  try {
    const { data } = await api.post('/service/v2/saveServiceRequest', payload);
    if (data?.message === 'FREE_LIMIT_REACHED') throw new Error('FREE_LIMIT_REACHED');
    if (data?.success === false) throw new Error(data.message || 'Could not post your job.');
    const doc = data?.data ?? data;
    const id = doc?.serviceRequestId ?? doc?.data?.serviceRequestId ?? doc?._id ?? doc?.id;
    return id != null ? String(id) : null;
  } catch (e: any) {
    const code = gateCode(e);
    if (code) throw new Error(code);
    throw e;
  }
}

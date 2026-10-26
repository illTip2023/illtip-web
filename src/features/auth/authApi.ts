/**
 * Auth onboarding API + validation, mirroring illtip-mobile:
 * - src/hooks/authApi.ts (endpoints + payload normalisation)
 * - src/utils/validation.ts, src/config/phoneCountryCodes.ts, src/services/referralCodePrefs.ts
 * - src/utils/buildRoleOnboardingProfilePayload.ts, src/config/store/slices/serviceSlice.ts (AI suggestion)
 */
import { api, ApiError } from '../../lib/api';

export type ApiResult<T = any> = { success: boolean; message: string; data?: T; code?: string };

/** Calls a v2 auth endpoint and always resolves to { success, message, data } (never throws). */
async function call<T = any>(path: string, body: Record<string, unknown>): Promise<ApiResult<T>> {
  try {
    const { data, status } = await api.post(path, body);
    const ok = data && typeof data === 'object' && 'success' in data ? data.success !== false : status < 400;
    return { success: !!ok, message: String(data?.message ?? (ok ? 'OK' : 'Request failed')), data: data?.data };
  } catch (e: any) {
    if (e instanceof ApiError) return { success: false, message: e.message, data: e.data?.data, code: e.data?.data?.code };
    return { success: false, message: 'Network error. Please try again.' };
  }
}

// ---------- validation (src/utils/validation.ts) ----------
export const AUTH_FULL_NAME_MAX_LEN = 200;
const AUTH_PASSWORD_MAX_LEN = 128;
const PHONE_MAX_CHARS = 15;

const single = (s: string, max: number) => {
  const v = String(s ?? '').trim().replace(/\s+/g, ' ');
  return max > 0 && v.length > max ? v.slice(0, max) : v;
};
export const normalizeEmail = (s: string) => single(s, 320).toLowerCase();
export const normalizePassword = (s: string) => String(s ?? '').trim().slice(0, AUTH_PASSWORD_MAX_LEN);
export const normalizeFullName = (s: string) => single(s, AUTH_FULL_NAME_MAX_LEN);
export const isValidEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s).trim());
export const isValidFullName = (s: string) => normalizeFullName(s).length >= 2;
export const isValidPassword = (s: string) => {
  const p = normalizePassword(s);
  return p.length >= 8 && p.length <= AUTH_PASSWORD_MAX_LEN;
};

export type PhoneCountry = { id: string; name: string; shortLabel: string; dialCode: string; localMinDigits: number; localMaxDigits: number; stripLeadingZero?: boolean };

export const PHONE_COUNTRIES: PhoneCountry[] = [
  { id: 'CM', name: 'Cameroon', shortLabel: 'CM', dialCode: '237', localMinDigits: 9, localMaxDigits: 9 },
  { id: 'CA', name: 'Canada', shortLabel: 'CA', dialCode: '1', localMinDigits: 10, localMaxDigits: 10 },
  { id: 'GH', name: 'Ghana', shortLabel: 'GH', dialCode: '233', localMinDigits: 9, localMaxDigits: 10, stripLeadingZero: true },
  { id: 'IN', name: 'India', shortLabel: 'IN', dialCode: '91', localMinDigits: 10, localMaxDigits: 10 },
  { id: 'KE', name: 'Kenya', shortLabel: 'KE', dialCode: '254', localMinDigits: 9, localMaxDigits: 10, stripLeadingZero: true },
  { id: 'MX', name: 'Mexico', shortLabel: 'MX', dialCode: '52', localMinDigits: 10, localMaxDigits: 10 },
  { id: 'NG', name: 'Nigeria', shortLabel: 'NG', dialCode: '234', localMinDigits: 10, localMaxDigits: 11, stripLeadingZero: true },
  { id: 'PH', name: 'Philippines', shortLabel: 'PH', dialCode: '63', localMinDigits: 10, localMaxDigits: 10 },
  { id: 'SL', name: 'Sierra Leone', shortLabel: 'SL', dialCode: '232', localMinDigits: 8, localMaxDigits: 8 },
  { id: 'ZA', name: 'South Africa', shortLabel: 'ZA', dialCode: '27', localMinDigits: 9, localMaxDigits: 10, stripLeadingZero: true },
  { id: 'TG', name: 'Togo', shortLabel: 'TG', dialCode: '228', localMinDigits: 8, localMaxDigits: 8 },
  { id: 'UG', name: 'Uganda', shortLabel: 'UG', dialCode: '256', localMinDigits: 9, localMaxDigits: 10, stripLeadingZero: true },
  { id: 'AE', name: 'United Arab Emirates', shortLabel: 'UAE', dialCode: '971', localMinDigits: 9, localMaxDigits: 9 },
  { id: 'UK', name: 'United Kingdom', shortLabel: 'UK', dialCode: '44', localMinDigits: 10, localMaxDigits: 11, stripLeadingZero: true },
  { id: 'US', name: 'United States', shortLabel: 'USA', dialCode: '1', localMinDigits: 10, localMaxDigits: 10 },
];
export const DEFAULT_PHONE_COUNTRY = 'US';
export const findCountry = (id: string) => PHONE_COUNTRIES.find((c) => c.id === id) ?? PHONE_COUNTRIES.find((c) => c.id === DEFAULT_PHONE_COUNTRY)!;

export const formatLocalDigits = (input: string, c: PhoneCountry) => String(input ?? '').replace(/\D/g, '').slice(0, c.localMaxDigits);
const nationalDigits = (local: string, c: PhoneCountry) => {
  let d = String(local ?? '').replace(/\D/g, '');
  if (c.stripLeadingZero && d.startsWith('0')) d = d.slice(1);
  return d;
};
/** Same check as the app: national number length must match the country's length. */
export const isValidLocalPhone = (local: string, c: PhoneCountry) => {
  const n = nationalDigits(local, c).length;
  return n >= c.localMinDigits && n <= c.localMinDigits;
};
export function composePhone(local: string, c: PhoneCountry) {
  const national = nationalDigits(formatLocalDigits(local, c), c);
  if (!national) return '';
  return ('+' + c.dialCode + national).slice(0, PHONE_MAX_CHARS);
}
export function isValidSignupPhone(stored: string) {
  if (!stored || stored === '+') return false;
  const digits = stored.replace(/\D/g, '');
  return stored.startsWith('+') ? digits.length >= 10 && digits.length <= PHONE_MAX_CHARS - 1 : digits.length >= 10 && digits.length <= PHONE_MAX_CHARS;
}

// ---------- referral code (src/services/referralCodePrefs.ts) ----------
const PENDING_REF_KEY = 'illtip.pendingReferralCode';
export const sanitizeReferralInput = (v: string) => v.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 16);
export function normalizeReferralCode(v?: string | null): string | null {
  const s = String(v ?? '').trim().toUpperCase();
  return /^[A-Z0-9]{8,16}$/.test(s) ? s : null;
}
export function savePendingReferral(code: string) {
  const c = normalizeReferralCode(code);
  try {
    if (c) localStorage.setItem(PENDING_REF_KEY, c);
  } catch {
    /* ignore */
  }
}
export function getPendingReferral(): string | null {
  try {
    return normalizeReferralCode(localStorage.getItem(PENDING_REF_KEY));
  } catch {
    return null;
  }
}
export function clearPendingReferral() {
  try {
    localStorage.removeItem(PENDING_REF_KEY);
  } catch {
    /* ignore */
  }
}

// Signup contact cache (src/services/signupContactCache.ts): keeps name/phone until the OTP step returns the user.
const CONTACT_KEY = 'illtip.signupContact';
export function saveSignupContact(c: { email: string; name: string; phone: string }) {
  try {
    sessionStorage.setItem(CONTACT_KEY, JSON.stringify(c));
  } catch {
    /* ignore */
  }
}
export function getSignupContact(email: string): { email: string; name: string; phone: string } | null {
  try {
    const c = JSON.parse(sessionStorage.getItem(CONTACT_KEY) || 'null');
    return c && c.email === email ? c : null;
  } catch {
    return null;
  }
}

// ---------- endpoints (src/hooks/authApi.ts) ----------
export function registerV2(p: { email: string; password: string; fullName: string; phoneNumber: string; referralCode?: string | null }) {
  const referralCode = p.referralCode?.trim().toUpperCase();
  return call('/auth/v2/register', {
    email: normalizeEmail(p.email),
    password: normalizePassword(p.password),
    fullName: normalizeFullName(p.fullName),
    phoneNumber: p.phoneNumber,
    ...(referralCode ? { referralCode } : {}),
  });
}
export const generateOTP = (email: string, purpose: 'login' | 'verification' | 'recovery' = 'login') => call('/auth/generateOTP', { email: normalizeEmail(email), purpose });
export const validateOTP = (email: string, code: string) => call<{ accessToken: string; refreshToken: string; data: any }>('/auth/validateOTP', { email: normalizeEmail(email), code: code.trim() });
export const forgotPasswordV2 = (email: string) => call('/auth/v2/forgot-password', { email: normalizeEmail(email) });
export const verifyPasswordResetCodeV2 = (email: string, code: string) => call('/auth/v2/verify-password-reset-code', { email: normalizeEmail(email), code: code.trim() });
export const resetPasswordV2 = (email: string, code: string, newPassword: string) =>
  call('/auth/v2/reset-password', { email: normalizeEmail(email), code: code.trim(), newPassword: normalizePassword(newPassword) });

export type RoleProfile = {
  about?: string;
  profession?: string;
  serviceDetails?: { serviceId: number; service: string };
  skillDetails?: number[];
  skill?: string;
  details?: string;
  radius30mi?: boolean;
  website?: string;
  contact?: string;
};
export const completeRoleV2 = (role: 'freelancer' | 'customer', profile?: RoleProfile | null) =>
  call('/auth/v2/complete-role', { role, ...(profile ? { profile } : {}) });

// ---------- master data + AI (RoleFinalStep) ----------
export type MasterService = { serviceId: number; service: string; imageUrl?: string | null; iconPng?: string | null; skillArr?: any[] };
export type PickerItem = { id: number; label: string; icon: string | null };

export async function fetchMasterServices(): Promise<MasterService[]> {
  const { data } = await api.get('/masterdata/services');
  const list = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
  return list as MasterService[];
}
const iconOf = (...c: unknown[]) => {
  for (const v of c) if (typeof v === 'string' && /^https?:\/\//.test(v)) return v;
  return null;
};
export function servicesToItems(rows: MasterService[] | undefined): PickerItem[] {
  return (rows || [])
    .filter((s) => s?.service && String(s.service).trim())
    .map((s) => ({ id: Number(s.serviceId), label: String(s.service).trim(), icon: iconOf(s.imageUrl, s.iconPng) }))
    .filter((i) => Number.isFinite(i.id) && i.id > 0)
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
}
export function skillsToItems(row: MasterService | undefined): PickerItem[] {
  if (!row || !Array.isArray(row.skillArr)) return [];
  const out: PickerItem[] = [];
  for (const o of row.skillArr) {
    if (!o || typeof o !== 'object') continue;
    const id = Number(o.skillId);
    const label = (typeof o.skill === 'string' && o.skill.trim()) || (typeof o.skillName === 'string' && o.skillName.trim()) || '';
    if (!Number.isFinite(id) || id <= 0 || !label) continue;
    out.push({ id, label, icon: iconOf(o.imageUrl, o.iconPng) });
  }
  return out;
}

/** POST /ai-service/v2/ai-suggestions (same body as serviceSlice.fetchAiDescriptionSuggestion). Returns the suggested text. */
export async function fetchAiSuggestion(category: string, skillName: string, description: string): Promise<string> {
  const { data } = await api.post('/ai-service/v2/ai-suggestions', {
    jobCategory: category.trim() || 'General',
    subCategory: skillName.trim() || 'General',
    job_post_content: description.trim(),
    language: 'en',
  });
  const d = data?.data && typeof data.data === 'object' ? data.data : null;
  const arr = [data?.suggetions, data?.suggestions, d?.suggetions, d?.suggestions].find((x) => Array.isArray(x) && x.length);
  if (!arr) throw new Error('No suggestions returned.');
  const picked = arr[Math.floor(Math.random() * arr.length)] || {};
  const about = (typeof picked.about === 'string' && picked.about.trim()) || (typeof picked.description === 'string' && picked.description.trim()) || '';
  if (!about) throw new Error('Invalid suggestion format.');
  const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean) : []);
  const req = list(picked.requirements);
  const resp = list(picked.responsibilities);
  let text = about;
  if (resp.length) text += '\n\nResponsibilities:\n' + resp.map((r) => '• ' + r).join('\n');
  if (req.length) text += '\n\nRequirements:\n' + req.map((r) => '• ' + r).join('\n');
  return text;
}

// contact field (validation.ts isValidOptionalContact / normalizeContactField / normalizeOptionalUrlLike)
const looksLikeEmail = (v: string) => v.includes('@') || /[a-zA-Z]/.test(v);
export function isValidOptionalContact(c: string) {
  const v = c.trim();
  if (!v) return true;
  if (looksLikeEmail(v)) return isValidEmail(v);
  const plus = v.startsWith('+');
  const digits = v.replace(/\D/g, '').slice(0, plus ? 14 : 11);
  return plus ? digits.length >= 10 && digits.length <= 14 : digits.length >= 10 && digits.length <= 11;
}
export function normalizeContact(c: string) {
  const v = c.trim();
  if (!v) return '';
  if (looksLikeEmail(v)) return single(v, 240).toLowerCase();
  const plus = v.startsWith('+');
  const d = v.replace(/\D/g, '').slice(0, plus ? 14 : 11);
  return d ? (plus ? '+' : '') + d : '';
}
export function normalizeUrlLike(s: string) {
  return single(s, 500).toLowerCase();
}

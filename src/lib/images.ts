/**
 * Backend `downloadImageBase64Function` (post controller) emits PNG base64 from sharp.
 * Older mobile code assumed JPEG and built `data:image/jpeg;base64,...`, which breaks decoding.
 */

export type DisplayableImageDetails = {
  base64Details?: string;
  imgLink?: string;
  src?: string;
  Location?: string;
  filename?: string;
};

/** Flatten API/Mongo shapes (`imageDetails` array, nested objects) for avatar URLs. */
export function normalizeImageDetails(
  raw?: unknown,
): (DisplayableImageDetails & { filename?: string }) | undefined {
  if (raw == null) return undefined;
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const normalized = normalizeImageDetails(entry);
      if (normalized) return normalized;
    }
    return undefined;
  }
  if (typeof raw !== 'object') return undefined;

  const o = raw as Record<string, unknown>;
  if (o.imageDetails != null && o.imageDetails !== raw) {
    const nested = normalizeImageDetails(o.imageDetails);
    if (nested) {
      return {
        ...nested,
        filename:
          nested.filename ??
          (typeof o.filename === 'string' ? o.filename : undefined),
      };
    }
  }

  const filename = typeof o.filename === 'string' ? o.filename.trim() : undefined;
  const imgLink = typeof o.imgLink === 'string' ? o.imgLink.trim() : undefined;
  const src = typeof o.src === 'string' ? o.src.trim() : undefined;
  const base64Details =
    typeof o.base64Details === 'string' ? o.base64Details.trim() : undefined;
  const Location = typeof o.Location === 'string' ? o.Location.trim() : undefined;

  if (!filename && !imgLink && !src && !base64Details && !Location) return undefined;

  return { filename, imgLink, src, base64Details, Location };
}

function sniffBase64DataUriMime(b64: string): string {
  const s = b64.trim();
  if (s.startsWith('iVBORw0KGgo')) return 'image/png';
  if (s.startsWith('/9j/')) return 'image/jpeg';
  if (s.startsWith('R0lGOD')) return 'image/gif';
  if (s.startsWith('UklGR')) return 'image/webp';
  return 'image/jpeg';
}

export function dataUriFromBase64Payload(base64: string): string {
  const trimmed = base64.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('data:')) return trimmed;
  const mime = sniffBase64DataUriMime(trimmed);
  return `data:${mime};base64,${trimmed}`;
}

function pickHttpImageUrl(details: DisplayableImageDetails): string | undefined {
  const legacyHttpUrl =
    typeof details.base64Details === 'string' && /^https?:\/\//i.test(details.base64Details.trim())
      ? details.base64Details.trim()
      : undefined;
  const url =
    (typeof details.imgLink === 'string' && details.imgLink.trim()) ||
    (typeof details.src === 'string' && details.src.trim()) ||
    legacyHttpUrl;
  if (url && /^https?:\/\//i.test(url)) return url;
  return undefined;
}

export function pickDisplayableImageUri(
  details?: DisplayableImageDetails | null,
): string | undefined {
  const normalized = normalizeImageDetails(details ?? undefined);
  if (!normalized) return undefined;

  const http = pickHttpImageUrl(normalized);
  if (http) return http;

  const b64 =
    typeof normalized.base64Details === 'string' ? normalized.base64Details.trim() : '';
  if (b64 && !/^https?:\/\//i.test(b64)) return dataUriFromBase64Payload(b64);

  const location =
    typeof normalized.Location === 'string' ? normalized.Location.trim() : undefined;
  if (location && /^https?:\/\//i.test(location)) return location;
  return undefined;
}

/**
 * Like {@link pickDisplayableImageUri} but uses only the signed CloudFront URLs
 * (`imgLink`, then `src`). The raw S3 `Location` is on a private bucket and
 * 403s, and inline base64 is skipped on purpose: in lists a URL can be
 * disk-cached, whereas a base64 data URI is decoded on every render and held
 * in memory per row.
 */
export function pickRemoteImageUri(
  details?: DisplayableImageDetails | null,
): string | undefined {
  const normalized = normalizeImageDetails(details ?? undefined);
  if (!normalized) return undefined;
  return pickHttpImageUrl(normalized);
}

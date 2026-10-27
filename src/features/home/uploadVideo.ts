/**
 * Video upload for web posts, mirroring illtip-mobile src/services/post.ts uploadStatusVideo():
 *   POST /post/uploadStatusVideo, multipart field 'video'. The backend (illtip-backend routes/post.js →
 *   controllers/post.js uploadPostVideo → convertPostVideo) stores the file in S3, runs the MediaConvert job
 *   to MP4, then answers { success, message, data: { showPost, originalname, src, filename, size, mimetype,
 *   thumbnailDetails } }. That data object goes into the post's imageArr as-is (same as the app).
 *
 * Uses XMLHttpRequest (not fetch) so we get upload progress. Auth mirrors src/lib/api.ts: Bearer access token;
 * the backend uploads to S3 *before* checking the token, so we make sure the token is fresh first (a cheap
 * authenticated GET through api.ts triggers its refresh-on-401) and retry once on 401.
 */
import { api, ApiError, loadSession } from '../../lib/api';
import { API_BASE_URL } from '../../lib/env';

/** Same as the app's CreatePostModal MAX_VIDEO_DURATION_SECONDS (3 minutes). */
export const MAX_VIDEO_SECONDS = 180;
/** The app compresses on the phone first (720p, ≤2.5 Mbps ≈ 56 MB for 3 min); the web can't, so we cap the raw file. */
export const MAX_VIDEO_MB = 200;
/** Same as the app's VIDEO_UPLOAD_TIMEOUT_MS (15 min). */
const TIMEOUT_MS = 900_000;

function tokenExpiresSoon(token?: string) {
  if (!token) return false;
  try {
    const part = token.split('.')[1];
    if (!part) return false;
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    const exp = Number(json?.exp);
    return Number.isFinite(exp) && exp * 1000 - Date.now() < 90_000;
  } catch {
    return false;
  }
}

/** Any authenticated GET; api.ts refreshes the token on 401 and retries. */
async function ensureFreshToken() {
  try {
    await api.get('/coins/balance');
  } catch {
    /* a failure here is reported by the upload itself */
  }
}

/** Reads a picked video's duration (seconds); null when the browser can't decode it (e.g. HEVC .mov on some desktops). */
export function videoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    let done = false;
    const finish = (d: number | null) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      v.removeAttribute('src');
      resolve(d);
    };
    v.preload = 'metadata';
    v.muted = true;
    v.onloadedmetadata = () => finish(Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null);
    v.onerror = () => finish(null);
    setTimeout(() => finish(null), 8000);
    v.src = url;
  });
}

type Phase = (p: { phase: 'upload' | 'processing'; fraction: number }) => void;

function send(file: File, onProgress?: Phase): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE_URL}/post/uploadStatusVideo`);
    xhr.timeout = TIMEOUT_MS;
    xhr.setRequestHeader('Accept', 'application/json, text/plain, */*');
    const at = loadSession()?.accessToken;
    if (at) xhr.setRequestHeader('Authorization', `Bearer ${at}`);
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable || !e.total) return;
      const f = e.loaded / e.total;
      onProgress?.({ phase: f >= 1 ? 'processing' : 'upload', fraction: f });
    };
    xhr.upload.onload = () => onProgress?.({ phase: 'processing', fraction: 1 });
    xhr.onload = () => {
      let data: any = xhr.responseText;
      try {
        data = data ? JSON.parse(data) : null;
      } catch {
        /* plain text */
      }
      resolve({ status: xhr.status, data });
    };
    xhr.onerror = () => reject(new ApiError('Network error while uploading the video. Check your connection and try again.', 0, null));
    xhr.ontimeout = () => reject(new ApiError('The video upload timed out. Try a shorter video or a better connection.', 0, null));
    const fd = new FormData();
    fd.append('video', file, file.name || 'video.mp4');
    xhr.send(fd);
  });
}

export async function uploadVideo(file: File, onProgress?: Phase): Promise<any[]> {
  if (tokenExpiresSoon(loadSession()?.accessToken)) await ensureFreshToken();
  let res = await send(file, onProgress);
  if (res.status === 401) {
    await ensureFreshToken();
    if (!loadSession()) throw new ApiError('Your session has expired. Please sign in again.', 401, res.data);
    onProgress?.({ phase: 'upload', fraction: 0 });
    res = await send(file, onProgress);
  }
  const d = res.data;
  if (res.status < 200 || res.status >= 300) {
    const msg = (d && typeof d === 'object' && (d.message || d.error)) || (res.status === 413 ? 'That video is too large to upload.' : `Video upload failed (${res.status}).`);
    throw new ApiError(String(msg), res.status, d);
  }
  if (d && typeof d === 'object' && d.success === false) throw new ApiError(d.message || 'Video upload failed', res.status, d);
  const payload = d?.data;
  if (Array.isArray(payload) && payload.length) return payload;
  if (payload && typeof payload === 'object') return [payload];
  throw new ApiError('Video upload failed. Please try again.', res.status, d);
}

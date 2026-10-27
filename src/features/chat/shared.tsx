import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { href, navigate } from '../../lib/router';
import { attachmentBaseName, attachmentKind, chatFileUrl, ChatMsg, decodeName, fetchAuthedBlobUrl, formatBytes, needsAuth } from './api';

export function useMediaQuery(q: string) {
  const get = () => (typeof matchMedia !== 'undefined' ? matchMedia(q).matches : false);
  const [m, setM] = useState(get);
  useEffect(() => {
    const mq = matchMedia(q);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}

/** Sizes the element to fill the viewport below its top edge (minus the phone tab bar). */
export function useFillHeight<T extends HTMLElement>(bottomGap = 0, enabled = true) {
  const ref = useRef<T | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!enabled) {
      // Sized by CSS instead (phone conversation pinned to the visual viewport).
      el.style.height = '';
      return;
    }
    const calc = () => {
      const vh = window.visualViewport?.height ?? window.innerHeight;
      const top = el.getBoundingClientRect().top + window.scrollY;
      const tab = document.querySelector('.tabbar') as HTMLElement | null;
      const tabH = tab && getComputedStyle(tab).display !== 'none' ? tab.offsetHeight : 0;
      el.style.height = Math.max(360, Math.floor(vh - top - tabH - bottomGap)) + 'px';
    };
    calc();
    const t = setTimeout(calc, 50);
    window.addEventListener('resize', calc);
    window.visualViewport?.addEventListener('resize', calc);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', calc);
      window.visualViewport?.removeEventListener('resize', calc);
    };
  }, [bottomGap, enabled]);
  return ref;
}

/**
 * Keeps a message list anchored to its newest message when it gets shorter (keyboard opening,
 * composer growing): if you were at (or typing near) the bottom you stay at the bottom; otherwise
 * the bottom edge stays put, so the messages you were reading don't slide under the keyboard.
 */
export function useStickToBottomOnResize(ref: { readonly current: HTMLElement | null }) {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let prevH = el.clientHeight;
    const ro = new ResizeObserver(() => {
      const h = el.clientHeight;
      const d = prevH - h;
      if (d > 0) {
        const wasAtBottom = el.scrollHeight - el.scrollTop - prevH < 140;
        const typing = !!document.activeElement?.closest?.('.composer');
        if (wasAtBottom || typing) el.scrollTop = el.scrollHeight;
        else el.scrollTop += d;
      }
      prevH = h;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
}

const EXTRA: Record<string, string> = {
  clip: 'M21 11.5l-8.5 8.5a5 5 0 0 1-7-7L14 4.5a3.5 3.5 0 0 1 5 5L10.5 18a2 2 0 0 1-3-3L15 7.5',
  tick: 'M4 12.5l4.5 4.5L20 6',
  ticks: 'M1.5 12.5 6 17 16.5 6.5M9.5 15.5 11 17 21.5 6.5',
  clock: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm0 4v5l3 2',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  reply: 'M10 8 4 13l6 5M4 13h11a5 5 0 0 1 5 5v1',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  redo: 'M20 5v5h-5M20 10a8 8 0 1 0 1.7 5',
  file: 'M6 3h8l5 5v13H6zM14 3v5h5',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  pen: 'M15 4l5 5-11 11H4v-5z',
  dots: 'M12 5h.01M12 12h.01M12 19h.01',
  alert: 'M12 3l10 18H2zM12 10v5M12 18h.01',
  starO: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z',
  bot: 'M12 3v3M7 8h10a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3zM9 13h.01M15 13h.01M9.5 17h5',
};

export function Ico({ name, size = 18, className }: { name: keyof typeof EXTRA | string; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d={EXTRA[name] || EXTRA.dots} />
    </svg>
  );
}

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)"'\]])/g;

/** Plain text with clickable links; i'llTip job links open the in-app job page when possible. */
export function Linkified({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  return (
    <>
      {parts.map((p, i) => {
        if (i % 2 === 1) {
          const sr = p.match(/serviceRequest\/(\d+)/i) || p.match(/serviceRequestId=(\d+)/i);
          if (sr) {
            return (
              <a key={i} href={href('/jobs/' + sr[1])} onClick={(e) => (e.preventDefault(), navigate('/jobs/' + sr[1]))}>
                {p}
              </a>
            );
          }
          return (
            <a key={i} href={p} target="_blank" rel="noreferrer noopener">
              {p}
            </a>
          );
        }
        return <React.Fragment key={i}>{p}</React.Fragment>;
      })}
    </>
  );
}

/** Resolves a displayable URL for an attachment (signed CDN link, local preview, or authed blob). */
function useAttachmentUrl(m: ChatMsg, enabled: boolean) {
  const base = attachmentBaseName(m.msg);
  const direct = m.localUrl || (m.imgLink && !needsAuth(m.imgLink) ? m.imgLink : '');
  const [url, setUrl] = useState<string | undefined>(direct || undefined);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (direct) {
      setUrl(direct);
      return;
    }
    if (!enabled) return;
    const target = m.imgLink || (base ? chatFileUrl(base) : '');
    if (!target) {
      setFailed(true);
      return;
    }
    let alive = true;
    fetchAuthedBlobUrl(target)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [direct, enabled, base, m.imgLink]);
  return { url, failed, fallback: () => (base ? fetchAuthedBlobUrl(chatFileUrl(base)) : Promise.reject(new Error('no file'))) };
}

export function Attachment({ m, onOpenImage }: { m: ChatMsg; onOpenImage: (url: string, name: string) => void }) {
  const kind = attachmentKind(m);
  const name = decodeName(m.originalName) || (kind === 'image' ? 'Photo' : kind === 'video' ? 'Video' : 'Attachment');
  const media = kind === 'image' || kind === 'video' || kind === 'audio';
  const { url, failed, fallback } = useAttachmentUrl(m, media);
  const [alt, setAlt] = useState<string>();
  const src = alt || url;

  if (kind === 'image') {
    if (failed && !src) return <div className="chat-media-missing">Photo unavailable</div>;
    return (
      <button type="button" className="chat-img-btn" onClick={() => src && onOpenImage(src, name)} aria-label={'Open ' + name}>
        {src ? (
          <img
            className="chat-img"
            src={src}
            alt={name}
            loading="lazy"
            onError={() => {
              if (!alt) fallback().then(setAlt, () => {});
            }}
          />
        ) : (
          <div className="chat-img chat-img-loading" />
        )}
      </button>
    );
  }
  if (kind === 'video') {
    return src ? <video className="chat-video" src={src} controls preload="metadata" /> : <div className="chat-media-missing">{failed ? 'Video unavailable' : 'Loading video…'}</div>;
  }
  if (kind === 'audio') {
    return src ? <audio className="chat-audio" src={src} controls preload="none" /> : <div className="chat-media-missing">{failed ? 'Voice message unavailable' : 'Loading…'}</div>;
  }

  const open = async () => {
    try {
      const target = m.localUrl || (m.imgLink && !needsAuth(m.imgLink) ? m.imgLink : await fallback());
      const a = document.createElement('a');
      a.href = target;
      a.target = '_blank';
      a.rel = 'noreferrer noopener';
      if (target.startsWith('blob:')) a.download = name;
      a.click();
    } catch {
      alert('This file is not available any more.');
    }
  };
  return (
    <button type="button" className="chat-file" onClick={open} title={'Open ' + name}>
      <span className="chat-file-icon">
        <Ico name="file" size={20} />
      </span>
      <span className="chat-file-text">
        <span className="chat-file-name">{name}</span>
        <span className="chat-file-meta">{[(name.split('.').pop() || '').toUpperCase(), formatBytes(m.fileSize)].filter(Boolean).join(' · ') || 'Document'}</span>
      </span>
      <Ico name="download" size={18} />
    </button>
  );
}

/** The app's AI chatbot avatar (simple gradient bot mark). */
export function BotAvatar({ size = 44 }: { size?: number }) {
  return (
    <div className="bot-avatar" style={{ width: size, height: size }}>
      <Ico name="bot" size={Math.round(size * 0.55)} />
    </div>
  );
}

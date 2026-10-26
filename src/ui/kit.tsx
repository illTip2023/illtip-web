/** Shared UI building blocks. Keep feature code using these so the look stays consistent with the app. */
import React, { useEffect, useState } from 'react';
import { goBack } from '../lib/router';

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="center muted" style={{ padding: 32 }}>
      <div className="spinner" aria-hidden />
      {label && <div style={{ marginTop: 8 }}>{label}</div>}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: any; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div className="card error-box">
      <div>{String(error?.message || error)}</div>
      {onRetry && (
        <button className="btn btn-ghost" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      {children && <div className="muted">{children}</div>}
    </div>
  );
}

export function Avatar({ src, name, size = 40 }: { src?: string; name?: string; size?: number }) {
  const [bad, setBad] = useState(false);
  const initials = (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
  return src && !bad ? (
    <img className="avatar" src={src} alt={name || ''} width={size} height={size} style={{ width: size, height: size }} onError={() => setBad(true)} />
  ) : (
    <div className="avatar avatar-fallback" style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {initials}
    </div>
  );
}

export function PageHeader({ title, back, right, sub }: { title: string; back?: boolean | string; right?: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="page-header">
      {back && (
        <button className="icon-btn" aria-label="Back" onClick={() => goBack(typeof back === 'string' ? back : '/')}>
          <Icon name="back" />
        </button>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <h1>{title}</h1>
        {sub && <div className="muted small">{sub}</div>}
      </div>
      {right}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title?: string; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (wide ? ' modal-wide' : '')} role="dialog" aria-modal>
        <div className="modal-head">
          <div className="modal-title">{title}</div>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

let toastFn: (msg: string, kind?: 'ok' | 'err') => void = () => {};
export const toast = { ok: (m: string) => toastFn(m, 'ok'), error: (m: string) => toastFn(m, 'err') };

export function Toaster() {
  const [items, setItems] = useState<{ id: number; msg: string; kind: string }[]>([]);
  useEffect(() => {
    toastFn = (msg, kind = 'ok') => {
      const id = Date.now() + Math.random();
      setItems((x) => [...x, { id, msg, kind }]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 3500);
    };
  }, []);
  return (
    <div className="toaster">
      {items.map((t) => (
        <div key={t.id} className={'toast toast-' + t.kind}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}

const PATHS: Record<string, string> = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  jobs: 'M9 4h6a2 2 0 0 1 2 2v1h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h3V6a2 2 0 0 1 2-2zm0 3h6V6H9z',
  chat: 'M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9l-5 4v-4H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z',
  search: 'M10.5 3a7.5 7.5 0 0 1 5.9 12.1l4.3 4.3-1.4 1.4-4.3-4.3A7.5 7.5 0 1 1 10.5 3zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z',
  user: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 4a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm0 15c2.6 0 4.9-1.2 6.4-3.2C17 16 14.7 15 12 15s-5 1-6.4 2.8A8 8 0 0 0 12 21z',
  bell: 'M12 3a6 6 0 0 1 6 6v4l2 3H4l2-3V9a6 6 0 0 1 6-6zm-2 15h4a2 2 0 0 1-4 0z',
  back: 'M15 5 8 12l7 7',
  close: 'M6 6l12 12M18 6 6 18',
  heart: 'M12 20s-7-4.4-9.2-8.6C1.4 8.6 3 5 6.5 5c2 0 3.4 1.2 5.5 3 2.1-1.8 3.5-3 5.5-3C21 5 22.6 8.6 21.2 11.4 19 15.6 12 20 12 20z',
  comment: 'M4 5h16v11H9l-5 4z',
  share: 'M4 12v7h16v-7M12 3v12M7 8l5-5 5 5',
  bookmark: 'M6 3h12v18l-6-4-6 4z',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  coin: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm0 4v10M9 9.5c0-1 1.3-1.7 3-1.7s3 .7 3 1.7-1.3 1.6-3 1.8-3 .8-3 1.8 1.3 1.8 3 1.8 3-.7 3-1.7',
  plus: 'M12 5v14M5 12h14',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm8.5 4a8.5 8.5 0 0 0-.1-1.3l2-1.6-2-3.4-2.4 1a8 8 0 0 0-2.2-1.3L15.4 3h-4l-.4 2.4a8 8 0 0 0-2.2 1.3l-2.4-1-2 3.4 2 1.6a8.6 8.6 0 0 0 0 2.6l-2 1.6 2 3.4 2.4-1a8 8 0 0 0 2.2 1.3l.4 2.4h4l.4-2.4a8 8 0 0 0 2.2-1.3l2.4 1 2-3.4-2-1.6c.1-.4.1-.9.1-1.3z',
  wallet: 'M3 7a2 2 0 0 1 2-2h13v4h1a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zm13 6a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z',
  send: 'M3 20l18-8L3 4v6l12 2-12 2z',
  location: 'M12 2a7 7 0 0 1 7 7c0 5-7 13-7 13S5 14 5 9a7 7 0 0 1 7-7zm0 4.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
  star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z',
  ai: 'M12 2l1.8 4.7L18.5 8.5l-4.7 1.8L12 15l-1.8-4.7L5.5 8.5l4.7-1.8zM18 14l.9 2.1L21 17l-2.1.9L18 20l-.9-2.1L15 17l2.1-.9z',
  filter: 'M3 5h18l-7 8v6l-4 2v-8z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  check: 'M5 12l5 5 9-10',
  play: 'M8 5v14l11-7z',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 8.5h.01',
};

export function Icon({ name, size = 22, fill }: { name: keyof typeof PATHS | string; size?: number; fill?: boolean }) {
  const d = PATHS[name] || PATHS.more;
  const filled = fill ?? ['home', 'jobs', 'chat', 'user', 'bell', 'wallet', 'location', 'star', 'ai', 'play'].includes(name);
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

export function timeAgo(input?: string | number | Date) {
  if (!input) return '';
  const t = new Date(input).getTime();
  if (!t) return '';
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.round(d / 7);
  if (d < 31) return `${w}w ago`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function compactNumber(n?: number) {
  const v = Number(n || 0);
  if (v >= 1e6) return (v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(v >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'K';
  return String(v);
}

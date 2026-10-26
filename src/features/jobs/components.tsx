/** Shared UI for the Jobs and Hire Pros features. */
import React, { useEffect, useRef, useState } from 'react';
import { APP_LINKS } from '../../lib/env';
import { Link } from '../../lib/router';
import { Avatar, Icon, Modal, Spinner, timeAgo } from '../../ui/kit';
import {
  appStatusLabel,
  Job,
  payRangeText,
  Place,
  placeAutocomplete,
  placeDetails,
  resolveResumeUrl,
  ResumeDetails,
  shareJob,
  workModeLabel,
} from './lib';

/* ───────────────────────── icons ───────────────────────── */

const EXTRA: Record<string, string> = {
  briefcase: 'M9 6V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1M4 7h16a1 1 0 0 1 1 1v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a1 1 0 0 1 1-1zM3 12h18',
  pin: 'M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21zM12 7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
  money: 'M3 7h18v10H3zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM6 10v4M18 10v4',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  bookmark: 'M6 3h12v18l-6-4-6 4z',
  share: 'M4 12v7h16v-7M12 3v12M7 8l5-5 5 5',
  upload: 'M12 16V4M7 9l5-5 5 5M4 16v4h16v-4',
  file: 'M6 2h8l5 5v15H6zM14 2v5h5M9 13h7M9 17h7',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21c0-3.9 3.1-7 7-7s7 3.1 7 7M17 3.5a4 4 0 0 1 0 7.5M22 21c0-3-1.8-5.5-4.5-6.5',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z',
  mail: 'M3 5h18v14H3zM3 6l9 7 9-7',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  chevron: 'M9 6l6 6-6 6',
  shield: 'M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  sparkle: 'M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM18.5 15l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z',
};

export function JIcon({ name, size = 18, fill }: { name: string; size?: number; fill?: boolean }) {
  const d = EXTRA[name];
  if (!d) return <Icon name={name} size={size} fill={fill} />;
  const filled = fill ?? (name === 'sparkle' || name === 'bolt');
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

/* ───────────────────────── section nav ───────────────────────── */

export function JobsNav({ active, savedCount }: { active: 'browse' | 'saved' | 'mine'; savedCount?: number }) {
  const items: { key: typeof active; to: string; label: string }[] = [
    { key: 'browse', to: '/jobs', label: 'Find jobs' },
    { key: 'saved', to: '/jobs/saved', label: 'Saved jobs' },
    { key: 'mine', to: '/jobs/mine', label: 'My posted jobs' },
  ];
  return (
    <nav className="jb-seg" aria-label="Jobs sections">
      {items.map((i) => (
        <Link key={i.key} to={i.to} className={'jb-seg-item' + (active === i.key ? ' active' : '')}>
          {i.label}
          {i.key === 'saved' && savedCount ? <span className="jb-seg-count">{savedCount > 99 ? '99+' : savedCount}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

/* ───────────────────────── thumbnails ───────────────────────── */

const TINTS = ['#3f4ff5', '#5a99f4', '#2c4364', '#0e9f6e', '#c2410c', '#7c3aed', '#be185d', '#0f766e'];

export function JobThumb({ src, title, size = 64 }: { src?: string; title: string; size?: number }) {
  const [bad, setBad] = useState(false);
  useEffect(() => setBad(false), [src]);
  if (src && !bad) return <img className="jb-thumb" src={src} alt="" width={size} height={size} style={{ width: size, height: size }} loading="lazy" onError={() => setBad(true)} />;
  const t = (title || '?').trim();
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  const bg = TINTS[h % TINTS.length];
  return (
    <div className="jb-thumb jb-thumb-fallback" style={{ width: size, height: size, background: `linear-gradient(140deg, ${bg}, ${bg}cc)` }} aria-hidden>
      <JIcon name="briefcase" size={Math.round(size * 0.42)} />
    </div>
  );
}

/* ───────────────────────── job card ───────────────────────── */

export function StatusPill({ status }: { status: Job['appStatus'] }) {
  if (!status) return null;
  const cls = status === 'declined' ? 'jb-pill-bad' : status === 'pending' ? 'jb-pill-info' : 'jb-pill-ok';
  return <span className={'jb-pill ' + cls}>{appStatusLabel(status)}</span>;
}

export function JobCard({ job, saved, onToggleSave, active }: { job: Job; saved: boolean; onToggleSave: () => void; active?: boolean }) {
  const pay = payRangeText(job);
  const mode = workModeLabel(job.workMode);
  return (
    <article className={'jb-card' + (active ? ' active' : '')}>
      <Link to={`/jobs/${encodeURIComponent(job.id)}`} className="jb-card-link" title={job.title}>
        <JobThumb src={job.image} title={job.title} />
        <div className="jb-card-body">
          <div className="jb-card-top">
            <h3 className="jb-card-title">{job.title}</h3>
            {job.urgent && <span className="jb-pill jb-pill-warn">Urgent</span>}
          </div>
          <div className="jb-card-poster">
            <span className="ellipsis">{job.posterName}</span>
            {job.posterVerified && <VerifiedBadge />}
            {job.category && job.category !== job.title && <span className="jb-dot ellipsis">{job.category}</span>}
          </div>
          <div className="jb-meta">
            <span className="jb-meta-item">
              <JIcon name="pin" size={15} />
              <span className="ellipsis">{job.location}</span>
            </span>
            {pay && (
              <span className="jb-meta-item jb-pay">
                <JIcon name="money" size={15} />
                {pay}
                <span className="muted"> pay range</span>
              </span>
            )}
            {job.neededBy && (
              <span className="jb-meta-item">
                <JIcon name="calendar" size={15} />
                Needed by {job.neededBy}
              </span>
            )}
          </div>
        </div>
      </Link>
      <div className="jb-card-foot">
        <div className="jb-tags">
          {mode && <span className="jb-tag">{mode}</span>}
          <StatusPill status={job.appStatus} />
          {job.hashtags.slice(0, 3).map((t) => (
            <span key={t} className="jb-tag jb-tag-soft">
              {t}
            </span>
          ))}
        </div>
        <div className="jb-card-actions">
          {job.postedAt && <span className="tiny muted jb-posted">{timeAgo(job.postedAt)}</span>}
          <button className="jb-icon-btn" aria-label="Share job" title="Share" onClick={() => shareJob(job)}>
            <JIcon name="share" size={18} />
          </button>
          <button className={'jb-icon-btn' + (saved ? ' saved' : '')} aria-label={saved ? 'Remove from saved jobs' : 'Save job'} aria-pressed={saved} title={saved ? 'Saved' : 'Save'} onClick={onToggleSave}>
            <JIcon name="bookmark" size={18} fill={saved} />
          </button>
        </div>
      </div>
    </article>
  );
}

export function VerifiedBadge() {
  return (
    <span className="jb-verified" title="Verified" aria-label="Verified">
      <svg viewBox="0 0 24 24" width="10" height="10" aria-hidden>
        <path d="M5 12l5 5 9-10" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

export function CardSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="jb-list" aria-busy>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="jb-card jb-skel">
          <div className="jb-card-link">
            <div className="jb-thumb jb-shimmer" style={{ width: 64, height: 64 }} />
            <div className="jb-card-body">
              <div className="jb-shimmer" style={{ height: 16, width: '60%', borderRadius: 6 }} />
              <div className="jb-shimmer" style={{ height: 12, width: '35%', borderRadius: 6, marginTop: 10 }} />
              <div className="jb-shimmer" style={{ height: 12, width: '80%', borderRadius: 6, marginTop: 10 }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ───────────────────────── upgrade gate (no web payments) ───────────────────────── */

export function StoreButtons() {
  return (
    <div className="jb-stores">
      <a className="btn btn-dark" href={APP_LINKS.ios} target="_blank" rel="noreferrer">
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden fill="currentColor">
          <path d="M16.4 12.6c0-2.4 2-3.6 2.1-3.7-1.2-1.7-3-1.9-3.6-2-1.5-.2-3 .9-3.8.9-.8 0-2-.9-3.3-.8-1.7 0-3.3 1-4.2 2.5-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8s2 .8 3.3.8c1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9 0 0-2.8-1.1-2.8-4.3zM14 5.3c.7-.8 1.2-2 1-3.1-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.2-.6 2.9-1.4z" />
        </svg>
        App Store
      </a>
      <a className="btn btn-dark" href={APP_LINKS.android} target="_blank" rel="noreferrer">
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden fill="currentColor">
          <path d="M3.6 2.3c-.3.3-.4.7-.4 1.2v17c0 .5.1.9.4 1.2l9.5-9.7zM14.4 13.3l2.7 2.8-11.2 6.4 8.5-9.2zM17.9 9.1l-3.5 3.6 3.5 3.6 3.4-2c1-.6 1-2.6 0-3.2zM5.9 1.5l11.2 6.4-2.7 2.8z" />
        </svg>
        Google Play
      </a>
    </div>
  );
}

export function UpgradeModal({ open, onClose, title, message }: { open: boolean; onClose: () => void; title: string; message: string }) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="jb-upgrade">
        <div className="jb-upgrade-icon">
          <JIcon name="bolt" size={26} />
        </div>
        <p className="jb-upgrade-msg">{message}</p>
        <div className="jb-upgrade-cta">Upgrade in the i'llTip app</div>
        <p className="small muted" style={{ margin: '0 0 14px' }}>
          Plans and upgrades are managed in the i'llTip mobile app. Once you upgrade there, come back here and try again.
        </p>
        <StoreButtons />
        <button className="btn btn-ghost btn-block" style={{ marginTop: 10 }} onClick={onClose}>
          Not now
        </button>
      </div>
    </Modal>
  );
}

/* ───────────────────────── confirm dialog ───────────────────────── */

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <div className="jb-confirm-msg">{message}</div>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
        <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </button>
        <button className={'btn' + (danger ? ' btn-danger' : '')} onClick={onConfirm} disabled={busy}>
          {busy ? 'Please wait…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/* ───────────────────────── switch ───────────────────────── */

export function Switch({ checked, onChange, label, id }: { checked: boolean; onChange: (v: boolean) => void; label: React.ReactNode; id?: string }) {
  return (
    <label className="jb-switch-row" htmlFor={id}>
      <span className="jb-switch-label">{label}</span>
      <input id={id} type="checkbox" className="jb-switch-input" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="jb-switch" aria-hidden />
    </label>
  );
}

/* ───────────────────────── place autocomplete ───────────────────────── */

export function PlaceInput({
  value,
  onText,
  onPlace,
  placeholder,
  id,
  invalid,
}: {
  value: string;
  onText: (t: string) => void;
  onPlace: (p: Place) => void;
  placeholder?: string;
  id?: string;
  invalid?: boolean;
}) {
  const [preds, setPreds] = useState<{ description: string; placeId: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const disabled = useRef(false);
  const timer = useRef<any>();
  const lastPicked = useRef('');

  useEffect(() => {
    clearTimeout(timer.current);
    const q = value.trim();
    if (disabled.current || q.length < 2 || q === lastPicked.current) {
      setPreds([]);
      return;
    }
    timer.current = setTimeout(async () => {
      try {
        const p = await placeAutocomplete(q);
        setPreds(p.slice(0, 6));
        setHi(-1);
      } catch {
        // Proxy unavailable: keep plain text entry working.
        disabled.current = true;
        setPreds([]);
      }
    }, 300);
    return () => clearTimeout(timer.current);
  }, [value]);

  const pick = async (p: { description: string; placeId: string }) => {
    lastPicked.current = p.description;
    onText(p.description);
    setOpen(false);
    setPreds([]);
    try {
      onPlace(await placeDetails(p.placeId, p.description));
    } catch {
      onPlace({ fullText: p.description });
    }
  };

  return (
    <div className="jb-place">
      <span className="jb-input-icon">
        <JIcon name="pin" size={17} />
      </span>
      <input
        id={id}
        className={'input jb-input-with-icon' + (invalid ? ' jb-invalid' : '')}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open && preds.length > 0}
        aria-autocomplete="list"
        onChange={(e) => {
          onText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!open || !preds.length) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHi((h) => Math.min(preds.length - 1, h + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHi((h) => Math.max(0, h - 1));
          } else if (e.key === 'Enter' && hi >= 0) {
            e.preventDefault();
            pick(preds[hi]);
          } else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && preds.length > 0 && (
        <ul className="jb-place-list" role="listbox">
          {preds.map((p, i) => (
            <li key={p.placeId} role="option" aria-selected={i === hi} className={i === hi ? 'hi' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(p)}>
              <JIcon name="pin" size={15} />
              <span>{p.description}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ───────────────────────── resume viewer ───────────────────────── */

function isImage(r: ResumeDetails) {
  if (r.mimeType?.toLowerCase().startsWith('image/')) return true;
  const ext = String(r.originalName ?? r.filename ?? '').split('.').pop()?.toLowerCase();
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif'].includes(ext ?? '');
}

export function ResumeDoc({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <div className="jb-resume-doc">
      {lines.map((l, i) => {
        const t = l.trim();
        if (!t) return <div key={i} style={{ height: 8 }} />;
        if (/^(PROFESSIONAL SUMMARY|SUMMARY|SKILLS|EXPERIENCE|EDUCATION|PROJECTS|FEATURED PROJECTS|Professional Summary:|Skills & Qualifications:|Relevant Experience:)$/i.test(t))
          return (
            <div key={i} className="jb-resume-h">
              {t.replace(/:$/, '')}
            </div>
          );
        if (/^[•\-–]\s/.test(t))
          return (
            <div key={i} className="jb-resume-li">
              {t.replace(/^[•\-–]\s*/, '')}
            </div>
          );
        return (
          <div key={i} className={i === 0 ? 'jb-resume-name' : ''}>
            {t}
          </div>
        );
      })}
    </div>
  );
}

export function ResumeViewer({ open, onClose, name, resume }: { open: boolean; onClose: () => void; name: string; resume: ResumeDetails | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let off = false;
    setUrl(null);
    if (!open || !resume || resume.type !== 'file') return;
    setLoading(true);
    resolveResumeUrl(resume)
      .then((u) => !off && setUrl(u))
      .finally(() => !off && setLoading(false));
    return () => {
      off = true;
    };
  }, [open, resume]);

  const downloadAi = () => {
    if (!resume?.aiText) return;
    const blob = new Blob([resume.aiText], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(name || 'Resume').replace(/[^\w\- ]+/g, '').trim() || 'Resume'} - AI Resume.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <Modal open={open} onClose={onClose} title={`${name ? name + ' · ' : ''}${resume?.type === 'ai' ? 'Updated Resume' : 'Uploaded Resume'}`} wide>
      {!resume ? null : resume.type === 'ai' ? (
        <>
          <ResumeDoc text={resume.aiText || 'No resume text available.'} />
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn btn-ghost" onClick={downloadAi}>
              <JIcon name="upload" size={16} /> Download
            </button>
          </div>
        </>
      ) : loading ? (
        <Spinner label="Loading resume…" />
      ) : url ? (
        <div className="stack">
          {isImage(resume) ? (
            <img src={url} alt="Resume" className="jb-resume-img" />
          ) : /pdf/i.test(resume.mimeType || '') || /\.pdf$/i.test(resume.originalName || '') ? (
            <iframe title="Resume" src={url} className="jb-resume-frame" />
          ) : (
            <div className="jb-file-box">
              <JIcon name="file" size={28} />
              <div className="grow ellipsis">{resume.originalName || 'Resume file'}</div>
            </div>
          )}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <a className="btn" href={url} target="_blank" rel="noreferrer">
              <JIcon name="external" size={16} /> Open resume
            </a>
          </div>
        </div>
      ) : (
        <div className="muted">This resume file could not be opened.</div>
      )}
    </Modal>
  );
}

/* ───────────────────────── poster avatar ───────────────────────── */

export function PosterLine({ job }: { job: Job }) {
  return (
    <div className="row" style={{ gap: 10 }}>
      <Avatar src={job.posterAvatar} name={job.posterName} size={36} />
      <div style={{ minWidth: 0 }}>
        <div className="row" style={{ gap: 6 }}>
          {job.posterId ? (
            <Link to={`/u/${encodeURIComponent(job.posterId)}`} className="jb-poster-name ellipsis">
              {job.posterName}
            </Link>
          ) : (
            <span className="jb-poster-name ellipsis">{job.posterName}</span>
          )}
          {job.posterVerified && <VerifiedBadge />}
        </div>
        <div className="tiny muted">{job.postedAt ? `Posted ${timeAgo(job.postedAt)}` : 'Job poster'}</div>
      </div>
    </div>
  );
}

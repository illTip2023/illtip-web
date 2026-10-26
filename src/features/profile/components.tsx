import React, { useState } from 'react';
import { Avatar, Icon, Modal, toast } from '../../ui/kit';
import { Link } from '../../lib/router';
import { badgeColor, rowAvatar, rowName, rowSkill, type UserRow } from './api';

export function VerifiedBadge({ tier, size = 16 }: { tier?: number; size?: number }) {
  return (
    <span className="pf-badge" style={{ background: badgeColor(tier), width: size, height: size }} title="Subscriber badge" aria-label="Subscriber badge">
      <svg viewBox="0 0 24 24" width={size * 0.62} height={size * 0.62} fill="none" stroke="#fff" strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
    </span>
  );
}

/** Five stars, filled to the nearest half. */
export function Stars({ value, size = 16, dim = 'var(--line)' }: { value: number; size?: number; dim?: string }) {
  const r = Math.round(value * 2) / 2;
  return (
    <span className="pf-stars" aria-label={`${value.toFixed(1)} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => {
        const fill = r >= i ? 1 : r >= i - 0.5 ? 0.5 : 0;
        const id = `half-${i}-${size}`;
        return (
          <svg key={i} width={size} height={size} viewBox="0 0 24 24" aria-hidden>
            <defs>
              <linearGradient id={id}>
                <stop offset="50%" stopColor="#FBBF24" />
                <stop offset="50%" stopColor={dim} />
              </linearGradient>
            </defs>
            <path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z" fill={fill === 1 ? '#FBBF24' : fill === 0.5 ? `url(#${id})` : dim} />
          </svg>
        );
      })}
    </span>
  );
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="stack">
        <div className="muted">{message}</div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className={'btn' + (danger ? ' btn-danger' : '')}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function ShareModal({ open, onClose, url, name }: { open: boolean; onClose: () => void; url: string; name: string }) {
  const [copied, setCopied] = useState(false);
  const message = `Check out ${name} on i'llTip`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.ok('Profile link copied');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy. Select the link and copy it manually.');
    }
  };
  const canShare = typeof navigator !== 'undefined' && typeof (navigator as any).share === 'function';
  return (
    <Modal open={open} onClose={onClose} title="Share Profile">
      <div className="stack">
        <div className="muted small">Let people find you on i'llTip</div>
        <div className="pf-share-box">
          <input className="input" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
          <button className="btn" onClick={copy}>
            {copied ? <Icon name="check" size={18} /> : null}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <div className="row-wrap">
          {canShare && (
            <button className="btn btn-ghost btn-sm" onClick={() => (navigator as any).share({ title: name, text: message, url }).catch(() => {})}>
              <Icon name="share" size={16} /> More options
            </button>
          )}
          <a className="btn btn-ghost btn-sm" href={`https://wa.me/?text=${encodeURIComponent(`${message} ${url}`)}`} target="_blank" rel="noreferrer">
            WhatsApp
          </a>
          <a className="btn btn-ghost btn-sm" href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`} target="_blank" rel="noreferrer">
            LinkedIn
          </a>
          <a className="btn btn-ghost btn-sm" href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(message)}&url=${encodeURIComponent(url)}`} target="_blank" rel="noreferrer">
            X
          </a>
          <a className="btn btn-ghost btn-sm" href={`mailto:?subject=${encodeURIComponent(message)}&body=${encodeURIComponent(url)}`}>
            Email
          </a>
        </div>
      </div>
    </Modal>
  );
}

export function UserListRow({ row, action }: { row: UserRow; action?: React.ReactNode }) {
  const name = rowName(row);
  const skill = rowSkill(row);
  return (
    <div className="pf-user-row">
      <Link to={`/u/${encodeURIComponent(row.userId)}`} className="pf-user-hit" title={`View ${name}'s profile`}>
        <Avatar src={rowAvatar(row)} name={name} size={46} />
        <div className="grow">
          <div className="row" style={{ gap: 6 }}>
            <span className="pf-user-name ellipsis">{name}</span>
            {row.hasVerifiedBadge && <VerifiedBadge tier={row.rankingBoostTier} size={14} />}
          </div>
          {skill && <div className="muted small ellipsis">{skill}</div>}
        </div>
      </Link>
      {action}
    </div>
  );
}

export function SkeletonRows({ n = 5 }: { n?: number }) {
  return (
    <div className="pf-skel-list">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="pf-skel-row">
          <div className="pf-skel pf-skel-circle" />
          <div className="grow">
            <div className="pf-skel" style={{ width: '45%', height: 12 }} />
            <div className="pf-skel" style={{ width: '30%', height: 10, marginTop: 8 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

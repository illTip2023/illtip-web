import React, { useEffect, useRef, useState } from 'react';
import { Composer } from './Composer';
import type { Post } from './api';

/**
 * The app's CreatePostModal: a full-screen sheet on phones (a centred dialog on desktop) holding the composer.
 * It stays mounted while closed so a half-written draft is still there when you reopen it (like the app's Modal).
 */
export function CreatePostSheet({
  open,
  onClose,
  onCreated,
  pick,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (p: Post) => void;
  pick: { files: File[]; n: number } | null;
}) {
  const [busy, setBusy] = useState(false);
  const [openCount, setOpenCount] = useState(0);
  const busyRef = useRef(false);
  busyRef.current = busy;

  useEffect(() => {
    if (!open) return;
    setOpenCount((n) => n + 1);
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = 'hidden';
    html.classList.add('hp-sheet-open');
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busyRef.current) onClose();
    };
    window.addEventListener('keydown', k);
    return () => {
      html.style.overflow = prev;
      html.classList.remove('hp-sheet-open');
      window.removeEventListener('keydown', k);
    };
  }, [open, onClose]);

  return (
    <div
      className={'hp-sheet-backdrop' + (open ? ' open' : '')}
      aria-hidden={!open}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="hp-sheet" role="dialog" aria-modal="true" aria-label="Create post">
        <Composer onCreated={onCreated} sheet={{ onClose, onBusyChange: setBusy }} pick={pick} autoFocusKey={open && !pick ? openCount : 0} />
      </div>
    </div>
  );
}

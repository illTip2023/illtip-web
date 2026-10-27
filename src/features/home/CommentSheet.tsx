/**
 * App-style comments bottom sheet (illtip-mobile src/ui/organisms/PostCommentSheet.tsx), shared by the feed
 * post card and the full-screen viewer. Grabber + "Comments" title, comment rows with like/tip rail and
 * reply threads, quick-react emojis, composer with "What do you think of this?" + Post.
 *
 * Behaviour: slides up over the page (portal to <body>), dim backdrop closes it, drag the grabber down to
 * close or up to expand, Escape / browser back closes it (it owns one history entry while open), page scroll
 * is locked, and it sits right on top of the on-screen keyboard (useVisualViewport). Centred dialog on desktop.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, navigate } from '../../lib/router';
import { Avatar, ErrorBox } from '../../ui/kit';
import { useVisualViewport } from '../../ui/useVisualViewport';
import { authorOf, epochMs, isBoosted, type Post } from './api';
import { CommentComposer, CommentList, CommentRecharge, distanceToNow, useCommentThread } from './comments';
import { RichText } from './PostCard';
import { usePostPatch } from './store';

const CLOSE_MS = 200;
let seq = 0;

export function CommentSheet({ post, onClose, showCaption = false }: { post: Post; onClose: () => void; showCaption?: boolean }) {
  const thread = useCommentThread(post);
  const vv = useVisualViewport();
  const [closing, setClosing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [drag, setDrag] = useState(0);
  const dragRef = useRef<{ y0: number; id: number; moved: boolean } | null>(null);
  const token = useRef(`cs${++seq}-${Date.now()}`);
  const closingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const finish = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    (document.activeElement as HTMLElement | null)?.blur?.();
    setClosing(true);
    setTimeout(() => onCloseRef.current(), CLOSE_MS);
  }, []);

  // Own a history entry so the phone's back gesture / browser Back closes the sheet instead of leaving the page.
  useEffect(() => {
    const t = token.current;
    try {
      history.pushState({ ...(history.state || {}), csheet: t }, '');
    } catch {
      /* ignore */
    }
    const onPop = () => {
      if (history.state?.csheet !== t) finish();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (history.state?.csheet === t) history.back();
    };
  }, [finish]);

  // Escape closes (capture phase so the full-screen viewer doesn't also treat it as "go back").
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.modal-backdrop')) return;
      e.stopPropagation();
      e.preventDefault();
      finish();
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [finish]);

  // Lock the page behind the sheet.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prev = [html.style.overflow, body.style.overflow, html.style.overscrollBehavior];
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    html.style.overscrollBehavior = 'none';
    html.classList.add('cs-open');
    return () => {
      html.style.overflow = prev[0];
      body.style.overflow = prev[1];
      html.style.overscrollBehavior = prev[2];
      html.classList.remove('cs-open');
    };
  }, []);

  // Opening a profile from the sheet replaces the sheet's history entry, so Back returns to the feed.
  const onProfile = useCallback((uid: string) => {
    const ours = history.state?.csheet === token.current;
    closingRef.current = true;
    navigate(`/u/${encodeURIComponent(uid)}`, { replace: ours });
    onCloseRef.current();
  }, []);

  /* grabber drag: down closes, up expands */
  const onPointerDown = (e: any) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.cs-close')) return;
    dragRef.current = { y0: e.clientY, id: e.pointerId, moved: false };
  };
  const onPointerMove = (e: any) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    const dy = e.clientY - d.y0;
    if (!d.moved && Math.abs(dy) > 4) {
      d.moved = true;
      // Capture only once it is a drag, so plain taps still click the grabber / close button.
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    }
    if (!d.moved) return;
    setDrag(Math.max(-60, dy));
  };
  const onPointerUp = (e: any) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    dragRef.current = null;
    const dy = e.clientY - d.y0;
    setDrag(0);
    if (!d.moved) {
      // Tap on the header: dismiss the keyboard like the app.
      (document.activeElement as HTMLElement | null)?.blur?.();
      return;
    }
    if (dy > 110) {
      if (expanded) setExpanded(false);
      else finish();
    } else if (dy > 60 && expanded) setExpanded(false);
    else if (dy < -30) setExpanded(true);
  };

  // Sit on the keyboard: same height as usual (capped to the space above the keyboard), bottom on its top edge.
  let style: React.CSSProperties | undefined;
  if (vv.keyboardOpen && vv.height > 0) {
    const base = window.innerHeight * (expanded ? 0.92 : 0.62);
    const h = Math.round(Math.min(vv.height * 0.94, Math.max(base, vv.height * 0.7)));
    style = { top: Math.round(vv.offsetTop + vv.height - h), height: h, bottom: 'auto', maxHeight: 'none', animation: 'none' };
  }
  if (drag) style = { ...(style || {}), translate: `0 ${drag}px`, transition: 'none' };

  const stop = (e: any) => e.stopPropagation();
  const { q, comments } = thread;
  const patch = usePostPatch(Number(post.statusPostId));
  const author = authorOf(post);
  const caption = showCaption ? (patch.caption ?? post.caption ?? '').trim() : '';

  const captionHeader = caption ? (
    <div className="cs-caption">
      <Link
        to={`/u/${encodeURIComponent(author.userId)}`}
        className="cs-caption-author"
        onClick={(e: any) => {
          e.preventDefault();
          onProfile(author.userId);
        }}
      >
        <Avatar src={author.avatar} name={author.name} size={34} />
        <span className="cs-meta">
          <span className="cs-name">{author.name}</span>
          <span className="cs-time">{distanceToNow(epochMs(post.createdTime))}</span>
        </span>
      </Link>
      <div className="cs-caption-text">
        <RichText text={caption} mentions={patch.mentions ?? post.mentions} links={isBoosted(post)} />
      </div>
    </div>
  ) : null;

  return createPortal(
    // Stop React events bubbling (through the portal) into the card / viewer slide that rendered us.
    <div className="cs-root" onClick={stop} onPointerDown={stop} onMouseDown={stop} onTouchStart={stop} onKeyDown={stop} onWheel={stop}>
      <div className={'cs-backdrop' + (closing ? ' closing' : '')} onClick={finish} aria-hidden />
      <section className={'cs-sheet' + (expanded ? ' expanded' : '') + (closing ? ' closing' : '') + (vv.keyboardOpen ? ' kb' : '')} style={style} role="dialog" aria-modal="true" aria-label="Comments">
        <header className="cs-head" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
          <button
            type="button"
            className="cs-grab"
            aria-label={expanded ? 'Collapse comments' : 'Expand comments'}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((x) => !x);
            }}
          />
          <h2 className="cs-title">Comments</h2>
          <button type="button" className="cs-close" aria-label="Close comments" onClick={finish}>
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>
        <div className="cs-scroll">
          {captionHeader}
          {q.loading && !q.data && (
            <div className="cs-loading">
              <div className="spinner" />
            </div>
          )}
          {q.error && !q.data && <ErrorBox error={q.error} onRetry={q.refetch} />}
          {q.data && !comments.length &&
            (caption ? (
              <div className="cs-empty-small">No comments yet. Start the conversation.</div>
            ) : (
              <div className="cs-empty">
                <div className="cs-empty-title">No comments yet</div>
                <div className="cs-empty-body">Start the conversation.</div>
              </div>
            ))}
          <CommentList thread={thread} onProfile={onProfile} />
        </div>
        <CommentComposer thread={thread} />
      </section>
      <CommentRecharge thread={thread} />
    </div>,
    document.body,
  );
}

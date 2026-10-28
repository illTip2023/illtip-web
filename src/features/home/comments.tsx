/**
 * Shared comment engine + rows, mirroring illtip-mobile:
 *  - hooks/usePostEngagement.ts (comment add / reply / edit / delete, comment like, comment tip, reply target, threads)
 *  - ui/organisms/PostCommentSheet.tsx (CommentRow: avatar, bold name + "about 19 hours", text, Reply/Edit/Delete,
 *    heart with count under it and the gold tip coin on the right; "View N more replies" threads; quick-react emojis)
 * Used by CommentSheet (feed card + full-screen viewer) and the inline list on /post/:id.
 *
 * Endpoints (all from the app): GET/POST /post/comment, POST /post/comment/like, POST /post/comment/coin.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from '../../lib/router';
import { useAuth } from '../../lib/auth';
import { track } from '../../lib/analytics';
import { setQueryData, useQuery } from '../../lib/query';
import { Avatar, Icon, compactNumber, toast } from '../../ui/kit';
import { BuyCoinsModal } from '../coins/BuyCoins';
import { dropCoin } from '../coins/CoinRain';
import {
  avatarOf,
  commentPost,
  displayName,
  epochMs,
  errMsg,
  fetchComments,
  likeComment,
  remapMentions,
  tipComment,
  type Comment,
  type Mention,
  type Post,
} from './api';
import { balanceFrom, ensureBalanceLoaded, isInsufficient } from './ComboTip';
import { RichText } from './PostCard';
import { coinStore, patchPost } from './store';
import { useMentionPicker } from './useMentionPicker';
import './comment-sheet.css';

export const QUICK_REACT_EMOJIS = ['💯', '🙌', '🔥', '👏', '😢', '😍', '😮', '😂'];

export const commentsKey = (id: number) => `home:comments:${id}`;

/* ---------------- helpers (app services/post.ts) ---------------- */

function commenter(c: Comment) {
  const u = c.commentUserDetails?.[0] || c.commenterDetails || (c as any).userDetails?.[0];
  return { uid: String(c.commentedBy || u?.userId || ''), name: displayName(u), avatar: avatarOf(u) };
}
export function commentLikeCount(c: Comment) {
  if (Array.isArray(c.likedArr)) return c.likedArr.length;
  const n = Number(c.likeCount ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
export function commentLikedByMe(c: Comment, me?: string) {
  if (me && Array.isArray(c.likedArr)) return c.likedArr.some((x) => String(x.likedBy) === String(me));
  return c.amILiked === true;
}
export function commentCoinCount(c: Comment) {
  if (Array.isArray(c.coinArr)) return c.coinArr.reduce((s, x) => s + (Number(x?.coins) || 0), 0);
  const n = Number(c.totalCoins ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** date-fns formatDistanceToNow(…, { addSuffix: false }) — the app's "about 19 hours". */
export function distanceToNow(ms: number) {
  if (!ms) return '';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  const m = Math.round(s / 60);
  if (s < 30) return 'less than a minute';
  if (m < 2) return '1 minute';
  if (m < 45) return `${m} minutes`;
  if (m < 90) return 'about 1 hour';
  const h = Math.round(m / 60);
  if (m < 1440) return `about ${h} hours`;
  if (m < 2520) return '1 day';
  const d = Math.round(m / 1440);
  if (m < 43200) return `${d} days`;
  if (m < 64800) return 'about 1 month';
  if (m < 86400) return 'about 2 months';
  const mo = Math.round(m / 43200);
  if (mo < 12) return `${mo} months`;
  const y = Math.floor(mo / 12);
  const rem = mo % 12;
  if (rem < 3) return `about ${y} year${y === 1 ? '' : 's'}`;
  if (rem < 9) return `over ${y} year${y === 1 ? '' : 's'}`;
  return `almost ${y + 1} years`;
}

/** Apply fn to the comment with this id, top-level or reply. */
function patchComment(list: Comment[] | undefined, commentId: number, fn: (c: Comment) => Comment): Comment[] | undefined {
  if (!list) return list;
  return list.map((top) => {
    const t = Number(top.commentId) === commentId ? fn(top) : top;
    if (Array.isArray(t.replies) && t.replies.length) return { ...t, replies: t.replies.map((r) => (Number(r.commentId) === commentId ? fn(r) : r)) };
    return t;
  });
}

/* ---------------- engine (app usePostEngagement, comment parts) ---------------- */

export type CommentThread = ReturnType<typeof useCommentThread>;

export function useCommentThread(post: Post) {
  const { user } = useAuth();
  const me = user?.id ? String(user.id) : '';
  const id = Number(post.statusPostId);
  const key = commentsKey(id);
  const q = useQuery<Comment[]>(key, () => fetchComments(post), { staleMs: 5_000 });
  const comments = q.data || [];
  const [text, setTextState] = useState('');
  const [busy, setBusy] = useState(false);
  const [replyTo, setReplyTo] = useState<{ commentId: number; name: string } | null>(null);
  const [openThreads, setOpenThreads] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState<number | null>(null);
  const [editing, setEditing] = useState<{ commentId: number; text: string } | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [popped, setPopped] = useState<{ id: number; n: number } | null>(null);
  const pendingSpend = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mention = useMentionPicker({ text, setText: (v) => setTextState(v), taRef: inputRef, selfId: me });

  // The card's count follows the loaded list (top-level comments, like the app's localCommentCount).
  useEffect(() => {
    if (q.data) patchPost(id, { comments: q.data.length });
  }, [q.data, id]);

  /** Refetch and broadcast to every view of this post's comments (sheet + details page). */
  const refresh = useCallback(async () => {
    try {
      const data = await fetchComments(post);
      setQueryData(key, () => data);
    } catch {
      /* keep what we have */
    }
  }, [key, post]);

  const setText = (v: string) => setTextState(v);

  const submit = async () => {
    const c = text.trim();
    if (!c || busy) return;
    setBusy(true);
    const parent = replyTo?.commentId;
    try {
      // POST /post/comment { statusPostId, comment, commentAction:'ADD', mentions, parentCommentId? }
      const body: Parameters<typeof commentPost>[1] & { mentions: Mention[] } = {
        comment: c,
        commentAction: 'ADD',
        mentions: remapMentions(c, mention.tagged),
        ...(parent ? { parentCommentId: parent } : {}),
      };
      await commentPost(post, body);
      setTextState('');
      mention.clear();
      setReplyTo(null);
      if (parent) {
        // A reply reveals its thread; replies don't change the post's comment count.
        setOpenThreads((s) => new Set(s).add(parent));
        toast.ok('Reply added.');
      } else {
        patchPost(id, (old) => ({ comments: (old.comments ?? (q.data?.length ?? post.commentArr?.length ?? 0)) + 1 }));
        toast.ok('Comment added.');
      }
      await refresh();
    } catch (e) {
      toast.error(errMsg(e, parent ? 'Could not add reply. Please try again.' : 'Could not add comment. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c: Comment, isReply: boolean) => {
    if (deleting) return;
    if (!window.confirm(isReply ? 'Delete this reply?' : 'Delete this comment? Its replies will be deleted too.')) return;
    setDeleting(c.commentId);
    try {
      await commentPost(post, { comment: (c.comment || '').trim() || 'deleted', commentAction: 'REMOVE', commentId: c.commentId });
      if (!isReply) patchPost(id, (old) => ({ comments: Math.max(0, (old.comments ?? (q.data?.length ?? 0)) - 1) }));
      toast.ok(isReply ? 'Reply deleted.' : 'Comment deleted.');
      await refresh();
    } catch (e) {
      toast.error(errMsg(e, 'Could not delete comment. Please try again.'));
    } finally {
      setDeleting(null);
    }
  };

  const saveEdit = async () => {
    if (!editing || editBusy) return;
    const t = editing.text.trim();
    if (!t) return;
    setEditBusy(true);
    try {
      await commentPost(post, { comment: t, commentAction: 'EDIT', commentId: editing.commentId });
      setQueryData(key, (old: Comment[] | undefined) => patchComment(old, editing.commentId, (c) => ({ ...c, comment: t })));
      setEditing(null);
      toast.ok('Comment updated.');
      void refresh();
    } catch {
      toast.error('Could not edit comment. Please try again.');
    } finally {
      setEditBusy(false);
    }
  };

  // Optimistic like on likedArr (the count derives from it), then reconcile with the server.
  const toggleLike = async (c: Comment) => {
    const cid = Number(c.commentId);
    if (!(cid > 0)) return;
    const was = commentLikedByMe(c, me);
    const before = q.data;
    setQueryData(key, (old: Comment[] | undefined) =>
      patchComment(old, cid, (x) => {
        const arr = Array.isArray(x.likedArr) ? x.likedArr : [];
        const next = was ? arr.filter((l) => String(l.likedBy) !== me) : arr.some((l) => String(l.likedBy) === me) ? arr : [...arr, { likedBy: me, likeTime: Math.floor(Date.now() / 1000) }];
        return { ...x, likedArr: next, amILiked: !was, likeCount: next.length };
      }),
    );
    try {
      await likeComment(post, cid, !was);
      void refresh();
    } catch {
      if (before) setQueryData(key, () => before);
      toast.error('Could not like comment. Please try again.');
    }
  };

  const patchCoins = (cid: number, coins: number) =>
    setQueryData(key, (old: Comment[] | undefined) =>
      patchComment(old, cid, (x) => {
        const arr = Array.isArray(x.coinArr) ? x.coinArr : [];
        let next = arr;
        if (coins > 0) next = [...arr, { coinedBy: me, coins, coinTime: Math.floor(Date.now() / 1000) }];
        else {
          const i = arr.map((e) => String(e.coinedBy) === me && Number(e.coins) === -coins).lastIndexOf(true);
          if (i >= 0) next = [...arr.slice(0, i), ...arr.slice(i + 1)];
        }
        return { ...x, coinArr: next, totalCoins: Math.max(0, (Number(x.totalCoins) || 0) + coins) };
      }),
    );

  /** Tip 1 coin to a comment's author (app handleCommentTipPress). */
  const tip = async (c: Comment) => {
    const cid = Number(c.commentId);
    const owner = commenter(c).uid;
    if (!(cid > 0) || !owner || owner === me) return;
    if (coinStore.get() === undefined) await ensureBalanceLoaded();
    const balance = coinStore.get();
    if (balance === undefined) {
      toast.error('Could not load your coin balance. Please try again.');
      return;
    }
    if (balance - pendingSpend.current <= 0) {
      setRechargeOpen(true);
      return;
    }
    pendingSpend.current += 1;
    setPopped((p) => ({ id: cid, n: (p?.n || 0) + 1 }));
    dropCoin();
    patchCoins(cid, 1);
    try {
      const res = await tipComment(post, cid, 1);
      track('Tip Sent', { target: 'comment', postId: Number(post.statusPostId), commentId: cid, coins: 1, source: 'comment' });
      const b = balanceFrom(res);
      if (b != null) coinStore.set(Math.max(0, b));
      else coinStore.set((v) => Math.max(0, (v ?? 1) - 1));
    } catch (e: any) {
      patchCoins(cid, -1);
      const b = balanceFrom(e?.data);
      if (b != null) coinStore.set(Math.max(0, b));
      if (isInsufficient(e)) setRechargeOpen(true);
      else if (e?.status === 404) toast.error('Tipping comments is coming soon.');
      else toast.error(e?.status === 200 && e?.message ? e.message : 'Could not send tip. Please try again.');
    } finally {
      pendingSpend.current = Math.max(0, pendingSpend.current - 1);
    }
  };

  // Replies always target the top-level comment (backend keeps threads one level deep); prefill "@name " like the app.
  const startReply = (c: Comment, topId: number) => {
    if (!(topId > 0)) return;
    const name = commenter(c).name;
    setReplyTo({ commentId: topId, name });
    setTextState((t) => (t.trim() ? t : `@${name} `));
    setTimeout(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      const end = el.value.length;
      el.setSelectionRange(end, end);
    }, 0);
  };

  const cancelReply = () => {
    setReplyTo(null);
    setTextState((t) => (t.trim().startsWith('@') ? '' : t));
  };

  const toggleThread = (cid: number) =>
    setOpenThreads((s) => {
      const n = new Set(s);
      if (n.has(cid)) n.delete(cid);
      else n.add(cid);
      return n;
    });

  const addEmoji = (e: string) => setTextState((t) => t + e);

  return {
    me,
    user,
    post,
    q,
    comments,
    text,
    setText,
    busy,
    submit,
    replyTo,
    startReply,
    cancelReply,
    openThreads,
    toggleThread,
    deleting,
    remove,
    editing,
    setEditing,
    editBusy,
    saveEdit,
    toggleLike,
    tip,
    popped,
    rechargeOpen,
    closeRecharge: () => setRechargeOpen(false),
    inputRef,
    mention,
    addEmoji,
  };
}

/* ---------------- icons ---------------- */

/** FontAwesome "coins", always gold like the post tip coin. */
export function CoinsIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden fill="#F5B400">
      <path d="M512 80c0 18-14.3 34.6-38.4 48c-29.1 16.1-72.5 27.5-122.3 30.9c-3.7-1.8-7.4-3.5-11.3-5C300.6 137.4 248.2 128 192 128c-8.3 0-16.4 .2-24.5 .6l-1.1-.6C142.3 114.6 128 98 128 80c0-44.2 86-80 192-80S512 35.8 512 80zM160.7 161.1c10.2-.7 20.7-1.1 31.3-1.1c62.2 0 117.4 12.3 152.5 31.4C369.3 204.9 384 221.7 384 240c0 4-.7 7.9-2.1 11.7c-4.6 13.2-17 25.3-35 35.5c0 0 0 0 0 0c-.1 .1-.3 .1-.4 .2l0 0 0 0c-.3 .2-.6 .3-.9 .5c-35 19.4-90.8 32-153.6 32c-59.6 0-112.9-11.3-148.2-29.1c-1.9-.9-3.7-1.9-5.5-2.9C14.3 274.6 0 258 0 240c0-34.8 53.4-64.5 128-75.4c10.5-1.5 21.4-2.7 32.7-3.5zM416 240c0-21.9-10.6-39.9-24.1-53.4c28.3-4.4 54.2-11.4 76.2-20.5c16.3-6.8 31.5-15.2 43.9-25.5V176c0 19.3-16.5 37.1-43.8 50.9c-14.6 7.4-32.4 13.7-52.4 18.5c.1-1.8 .2-3.5 .2-5.3zm-32 96c0 18-14.3 34.6-38.4 48c-1.8 1-3.6 1.9-5.5 2.9C304.9 404.7 251.6 416 192 416c-62.8 0-118.6-12.6-153.6-32C14.3 370.6 0 354 0 336V300.6c12.5 10.3 27.6 18.7 43.9 25.5C83.4 342.6 135.8 352 192 352s108.6-9.4 148.1-25.9c7.8-3.2 15.3-6.9 22.4-10.9c6.1-3.4 11.8-7.2 17.2-11.2c1.5-1.1 2.9-2.3 4.3-3.4V304v5.7V336zm32 0V304 278.1c19-4.2 36.5-9.5 52.1-16c16.3-6.8 31.5-15.2 43.9-25.5V272c0 10.5-5 21-14.9 30.9c-16.3 16.3-45 29.7-81.3 38.4c.1-1.7 .2-3.5 .2-5.3zM192 448c56.2 0 108.6-9.4 148.1-25.9c16.3-6.8 31.5-15.2 43.9-25.5V432c0 44.2-86 80-192 80S0 476.2 0 432V396.6c12.5 10.3 27.6 18.7 43.9 25.5C83.4 438.6 135.8 448 192 448z" />
    </svg>
  );
}

/* ---------------- rows ---------------- */

type RowProps = {
  thread: CommentThread;
  c: Comment;
  topId: number;
  reply?: boolean;
  /** Opening a profile from a sheet replaces the sheet's history entry (see CommentSheet). */
  onProfile?: (uid: string) => void;
};

function ProfileLink({ uid, onProfile, className, children, label }: { uid: string; onProfile?: (uid: string) => void; className?: string; children: React.ReactNode; label?: string }) {
  const to = `/u/${encodeURIComponent(uid)}`;
  if (!uid) return <span className={className}>{children}</span>;
  return (
    <Link
      to={to}
      className={className}
      title={label}
      onClick={(e: any) => {
        if (!onProfile || e?.metaKey || e?.ctrlKey || e?.shiftKey) return;
        e.preventDefault();
        onProfile(uid);
      }}
    >
      {children}
    </Link>
  );
}

export function CommentRow({ thread, c, topId, reply = false, onProfile }: RowProps) {
  const { me, editing, setEditing, editBusy, saveEdit, deleting, remove, toggleLike, tip, startReply, popped } = thread;
  const who = commenter(c);
  const cid = Number(c.commentId) || 0;
  const mine = !!me && !!who.uid && who.uid === me;
  const liked = commentLikedByMe(c, me);
  const likes = commentLikeCount(c);
  const coins = commentCoinCount(c);
  const canTip = cid > 0 && !!who.uid && !mine;
  const when = epochMs(c.commentTime);
  const isEditing = cid > 0 && editing?.commentId === cid;
  const text = String(c.comment ?? '').trim();
  return (
    <div className={'cs-row' + (reply ? ' cs-reply' : '')}>
      <ProfileLink uid={who.uid} onProfile={onProfile} className="cs-av" label={who.name}>
        <Avatar src={who.avatar} name={who.name} size={reply ? 26 : 34} />
      </ProfileLink>
      <div className="cs-body">
        <div className="cs-meta">
          <ProfileLink uid={who.uid} onProfile={onProfile} className="cs-name">
            {who.name}
          </ProfileLink>
          {when > 0 && (
            <time className="cs-time" dateTime={new Date(when).toISOString()} title={new Date(when).toLocaleString()}>
              {distanceToNow(when)}
            </time>
          )}
        </div>
        {isEditing ? (
          <div className="cs-edit">
            <input
              className="cs-edit-input"
              value={editing!.text}
              autoFocus
              placeholder="Edit comment..."
              aria-label="Edit comment"
              disabled={editBusy}
              onChange={(e) => setEditing({ commentId: cid, text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  saveEdit();
                } else if (e.key === 'Escape') {
                  e.stopPropagation();
                  setEditing(null);
                }
              }}
            />
            <button type="button" className="cs-edit-save" disabled={!editing!.text.trim() || editBusy} onClick={saveEdit}>
              Save
            </button>
            <button type="button" className="cs-edit-cancel" disabled={editBusy} onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        ) : (
          <div className="cs-text">
            <RichText text={text} mentions={c.mentions} />
          </div>
        )}
        <div className="cs-actions">
          {cid > 0 && (
            <button type="button" onClick={() => startReply(c, topId)}>
              Reply
            </button>
          )}
          {mine && cid > 0 && (
            <>
              <button type="button" disabled={editBusy || deleting === cid} onClick={() => setEditing({ commentId: cid, text })}>
                Edit
              </button>
              <button type="button" className="cs-del" disabled={deleting === cid || editBusy} onClick={() => remove(c, reply)}>
                {deleting === cid ? 'Deleting…' : 'Delete'}
              </button>
            </>
          )}
        </div>
      </div>
      {cid > 0 && (
        <div className="cs-side">
          <button
            type="button"
            className={'cs-side-btn cs-like' + (liked ? ' liked' : '')}
            aria-pressed={liked}
            aria-label={`${liked ? 'Unlike' : 'Like'} comment, ${likes} likes`}
            onClick={() => toggleLike(c)}
          >
            <Icon name="heart" size={reply ? 14 : 15} fill={liked} />
            {likes > 0 && <span className="cs-count">{compactNumber(likes)}</span>}
          </button>
          {(canTip || coins > 0) && (
            <button
              type="button"
              className="cs-side-btn cs-coin"
              disabled={!canTip}
              aria-label={canTip ? `Tip ${who.name} 1 coin, ${coins} coins so far` : `${coins} coins tipped on your comment`}
              onClick={() => tip(c)}
            >
              <span key={popped?.id === cid ? popped.n : 0} className={popped?.id === cid ? 'cs-pop' : undefined}>
                <CoinsIcon size={reply ? 14 : 15} />
              </span>
              {coins > 0 && <span className="cs-count">{compactNumber(coins)}</span>}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Top-level comments with their "View N more replies" threads (app PostCommentSheet renderItem). */
export function CommentList({ thread, onProfile }: { thread: CommentThread; onProfile?: (uid: string) => void }) {
  const { comments, openThreads, toggleThread } = thread;
  return (
    <div className="cs-list">
      {comments.map((top, i) => {
        const topId = Number(top.commentId) || 0;
        const replies = (top.replies || []).filter((r) => String(r.comment ?? '').trim());
        const replyCount = top.replyCount ?? replies.length;
        const people = new Set([top, ...replies].map((c) => String(c.commentedBy ?? '')).filter(Boolean)).size;
        const open = openThreads.has(topId);
        return (
          <div className="cs-item" key={topId || `i${i}`}>
            <CommentRow thread={thread} c={top} topId={topId} onProfile={onProfile} />
            {replyCount > 0 && (
              <button type="button" className="cs-thread" aria-expanded={open} onClick={() => toggleThread(topId)}>
                <span className="cs-thread-line" aria-hidden />
                {open ? 'Hide replies' : `View ${replyCount} more ${replyCount === 1 ? 'reply' : 'replies'}${people > 2 ? ` · ${people} people` : ''}`}
              </button>
            )}
            {open && replies.length > 0 && (
              <div className="cs-replies">
                {replies.map((r) => (
                  <CommentRow key={r.commentId} thread={thread} c={r} topId={topId} reply onProfile={onProfile} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Quick reacts + reply banner + @mention list + composer (avatar, "What do you think of this?", Post). */
export function CommentComposer({ thread, autoGrowMax = 110 }: { thread: CommentThread; autoGrowMax?: number }) {
  const { user, text, setText, busy, submit, replyTo, cancelReply, inputRef, mention, addEmoji } = thread;
  const canSend = !!text.trim() && !busy;

  useEffect(() => {
    const ta = inputRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(autoGrowMax, ta.scrollHeight) + 'px';
  }, [text, inputRef, autoGrowMax]);

  return (
    <div className="cs-compose-wrap">
      <div className="cs-emojis" role="group" aria-label="Quick reactions">
        {QUICK_REACT_EMOJIS.map((e) => (
          <button key={e} type="button" className="cs-emoji" aria-label={`Add ${e}`} onMouseDown={(ev) => ev.preventDefault()} onClick={() => addEmoji(e)}>
            {e}
          </button>
        ))}
      </div>
      {replyTo && (
        <div className="cs-replying">
          <span className="ellipsis">
            Replying to <b>@{replyTo.name}</b>
          </span>
          <button type="button" className="cs-x" aria-label="Cancel reply" onClick={cancelReply}>
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
      {mention.list}
      <div className="cs-compose">
        <Avatar src={(user as any)?.imageUrl} name={user?.name} size={34} />
        <textarea
          ref={inputRef}
          className="cs-input"
          rows={1}
          placeholder={replyTo ? `Reply to @${replyTo.name}...` : 'What do you think of this?'}
          aria-label={replyTo ? 'Write a reply' : 'Add a comment'}
          value={text}
          disabled={busy}
          onChange={(e) => {
            setText(e.target.value);
            mention.detect(e.target.value, e.target.selectionStart ?? e.target.value.length);
          }}
          onBlur={() => setTimeout(mention.close, 200)}
          onKeyDown={(e) => {
            // Enter sends with a keyboard + mouse; on phones Return adds a line and the button sends.
            if (e.key === 'Enter' && !e.shiftKey && !(e.nativeEvent as any).isComposing && window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button type="button" className="cs-post" disabled={!canSend} onMouseDown={(e) => e.preventDefault()} onClick={submit} aria-label={replyTo ? 'Send reply' : 'Send comment'}>
          {busy ? <span className="cs-spin" /> : replyTo ? 'Reply' : 'Post'}
        </button>
      </div>
    </div>
  );
}

/** The coin purchase sheet when a comment tip runs out of coins (app promptRechargeFromComments). */
export function CommentRecharge({ thread }: { thread: CommentThread }) {
  if (!thread.rechargeOpen) return null;
  const stop = (e: any) => e.stopPropagation();
  return createPortal(
    <div onClick={stop} onMouseDown={stop} onPointerDown={stop} onKeyDown={stop}>
      <BuyCoinsModal open onClose={thread.closeRecharge} />
    </div>,
    document.body,
  );
}

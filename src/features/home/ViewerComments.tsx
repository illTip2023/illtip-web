/**
 * Bottom-sheet comments for the full-screen viewer (mobile PostCommentSheet with showCaption):
 * the post's caption on top, then comments with replies, comment likes, delete-own, and a composer.
 * Endpoints come from api.ts (GET/POST /post/comment, POST /post/comment/like).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Link } from '../../lib/router';
import { useAuth } from '../../lib/auth';
import { useQuery } from '../../lib/query';
import { Avatar, ErrorBox, Icon, compactNumber, timeAgo, toast } from '../../ui/kit';
import { I } from './icons';
import { authorOf, avatarOf, commentPost, displayName, epochMs, errMsg, fetchComments, isBoosted, likeComment, type Comment, type Post } from './api';
import { RichText } from './PostCard';
import { patchPost, usePostPatch } from './store';

export function ViewerComments({ post, onClose }: { post: Post; onClose: () => void }) {
  const { user } = useAuth();
  const id = Number(post.statusPostId);
  const patch = usePostPatch(id);
  // Same cache key as the post details page, so both stay in step.
  const q = useQuery(`home:comments:${id}`, () => fetchComments(post), { staleMs: 5_000 });
  const comments = q.data || [];
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [replyTo, setReplyTo] = useState<{ commentId: number; name: string } | null>(null);
  const [openThreads, setOpenThreads] = useState<Set<number>>(new Set());
  const [likes, setLikes] = useState<Record<number, { liked: boolean; count: number }>>({});
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const author = authorOf(post);
  const caption = (patch.caption ?? post.caption ?? '').trim();
  const mentions = patch.mentions ?? post.mentions;

  useEffect(() => {
    if (q.data) patchPost(id, { comments: q.data.length });
  }, [q.data, id]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [onClose]);

  const submit = async () => {
    const c = text.trim();
    if (!c || busy) return;
    setBusy(true);
    try {
      await commentPost(post, { comment: c, commentAction: 'ADD', ...(replyTo ? { parentCommentId: replyTo.commentId } : {}) });
      setText('');
      if (replyTo) setOpenThreads((s) => new Set(s).add(replyTo.commentId));
      setReplyTo(null);
      await q.refetch();
    } catch (e) {
      toast.error(errMsg(e, replyTo ? 'Could not add reply. Please try again.' : 'Could not add comment. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c: Comment) => {
    if (!window.confirm('Delete this comment?')) return;
    try {
      await commentPost(post, { comment: c.comment, commentAction: 'REMOVE', commentId: c.commentId });
      toast.ok('Comment deleted.');
      await q.refetch();
    } catch (e) {
      toast.error(errMsg(e, 'Could not delete comment.'));
    }
  };

  const likeState = (c: Comment) => likes[c.commentId] ?? { liked: !!user && !!c.likedArr?.some((l) => String(l.likedBy) === String(user.id)), count: c.likedArr?.length || 0 };

  const toggleLike = async (c: Comment) => {
    const cur = likeState(c);
    const next = { liked: !cur.liked, count: Math.max(0, cur.count + (cur.liked ? -1 : 1)) };
    setLikes((s) => ({ ...s, [c.commentId]: next }));
    try {
      await likeComment(post, c.commentId, next.liked);
    } catch {
      setLikes((s) => ({ ...s, [c.commentId]: cur }));
      toast.error('Could not update like.');
    }
  };

  const startReply = (c: Comment) => {
    const name = displayName(c.commentUserDetails?.[0]);
    setReplyTo({ commentId: Number(c.parentCommentId || c.commentId), name });
    setText((t) => (t.startsWith(`@${name}`) ? t : `@${name} ${t}`));
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const row = (c: Comment, reply = false) => {
    const u = c.commentUserDetails?.[0];
    const uid = String(u?.userId || c.commentedBy || '');
    const name = displayName(u);
    const l = likeState(c);
    const mine = !!user && uid === String(user.id);
    const replies = c.replies || [];
    const open = openThreads.has(c.commentId);
    return (
      <div className={'hp-comment' + (reply ? ' reply' : '')} key={c.commentId}>
        <Link to={`/u/${encodeURIComponent(uid)}`}>
          <Avatar src={avatarOf(u)} name={name} size={reply ? 28 : 34} />
        </Link>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="hp-bubble">
            <div className="row" style={{ gap: 8 }}>
              <Link to={`/u/${encodeURIComponent(uid)}`} className="hp-name small ellipsis">
                {name}
              </Link>
              <span className="tiny muted">{timeAgo(epochMs(c.commentTime))}</span>
            </div>
            <div className="pre hp-comment-text">
              <RichText text={c.comment || ''} mentions={c.mentions} />
            </div>
          </div>
          <div className="hp-comment-actions">
            <button className={l.liked ? 'liked' : ''} onClick={() => toggleLike(c)}>
              <Icon name="heart" size={14} fill={l.liked} /> {l.count > 0 ? compactNumber(l.count) : 'Like'}
            </button>
            <button onClick={() => startReply(c)}>
              <I name="reply" size={14} /> Reply
            </button>
            {mine && (
              <button onClick={() => remove(c)}>
                <I name="trash" size={14} /> Delete
              </button>
            )}
          </div>
          {!reply && replies.length > 0 && (
            <>
              <button
                className="hp-thread-toggle"
                onClick={() =>
                  setOpenThreads((s) => {
                    const n = new Set(s);
                    if (n.has(c.commentId)) n.delete(c.commentId);
                    else n.add(c.commentId);
                    return n;
                  })
                }
              >
                {open ? 'Hide replies' : `View ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`}
              </button>
              {open && <div className="hp-replies">{replies.map((r) => row(r, true))}</div>}
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="vw-sheet-backdrop" onClick={onClose} />
      <section className="vw-sheet" role="dialog" aria-modal aria-label="Comments">
        <div className="vw-sheet-grab" aria-hidden />
        <header className="vw-sheet-head">
          <div className="vw-sheet-title">
            Comments {comments.length > 0 && <span className="muted">({comments.length})</span>}
          </div>
          <button className="icon-btn" aria-label="Close comments" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        <div className="vw-sheet-body">
          {caption && (
            <div className="vw-sheet-caption">
              <Link to={`/u/${encodeURIComponent(author.userId)}`}>
                <Avatar src={author.avatar} name={author.name} size={34} />
              </Link>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: 8 }}>
                  <Link to={`/u/${encodeURIComponent(author.userId)}`} className="hp-name small ellipsis">
                    {author.name}
                  </Link>
                  <span className="tiny muted">{timeAgo(epochMs(post.createdTime))}</span>
                </div>
                <div className="pre hp-comment-text">
                  <RichText text={caption} mentions={mentions} links={isBoosted(post)} />
                </div>
              </div>
            </div>
          )}
          {q.loading && !q.data && (
            <div style={{ padding: 20 }}>
              <div className="spinner" />
            </div>
          )}
          {q.error && !q.data && <ErrorBox error={q.error} onRetry={q.refetch} />}
          {q.data && !comments.length && <div className="muted small vw-sheet-empty">No comments yet. Start the conversation.</div>}
          <div className="hp-comment-list">{comments.map((c) => row(c))}</div>
        </div>
        <footer className="vw-sheet-foot">
          {replyTo && (
            <div className="hp-replying tiny" style={{ marginLeft: 0 }}>
              Replying to <b>{replyTo.name}</b>
              <button
                className="icon-btn"
                aria-label="Cancel reply"
                onClick={() => {
                  setReplyTo(null);
                  setText((t) => t.replace(new RegExp(`^@${replyTo.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s?`), ''));
                }}
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          )}
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <textarea
              ref={inputRef}
              className="textarea hp-comment-input"
              rows={1}
              placeholder={replyTo ? 'Write a reply…' : 'Add a comment…'}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            <button className="btn hp-send" disabled={!text.trim() || busy} onClick={submit} aria-label="Send comment">
              <Icon name="send" size={18} />
            </button>
          </div>
        </footer>
      </section>
    </>
  );
}

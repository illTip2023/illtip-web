import React, { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { goBack, Link, useParams, useQueryParams } from '../../lib/router';
import { useAuth } from '../../lib/auth';
import { useQuery } from '../../lib/query';
import { Avatar, ErrorBox, Icon, PageHeader, compactNumber, timeAgo, toast } from '../../ui/kit';
import { I } from './icons';
import { avatarOf, commentPost, displayName, epochMs, errMsg, fetchComments, fetchRelated, getPost, likeComment, type Comment, type Post } from './api';
import { PostCard, PostSkeleton, RichText } from './PostCard';
import { PostTile } from './PostTile';
import { loadSaved, patchPost } from './store';

const relatedSeed = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function PostDetails() {
  const { id } = useParams<{ id: string }>();
  const qp = useQueryParams();
  const q = useQuery(`home:post:${id}`, () => getPost(id));
  const post = q.data;
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void loadSaved();
  }, []);

  const focusComment = () => {
    const el = inputRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => el.focus({ preventScroll: true }), 250);
  };

  return (
    <div className="hp-page">
      <PageHeader title="Post" back="/" />
      {q.loading && !post && <PostSkeleton />}
      {q.error && !post && <ErrorBox error={q.error} onRetry={q.refetch} />}
      {post && (
        <>
          <PostCard post={post} detail onDeleted={() => goBack('/')} onCommentClick={focusComment} />
          <Comments key={post.statusPostId} post={post} inputRef={inputRef} autoFocus={qp.get('comment') === '1'} />
          <Related post={post} />
        </>
      )}
    </div>
  );
}

function Comments({ post, inputRef, autoFocus }: { post: Post; inputRef: RefObject<HTMLTextAreaElement>; autoFocus: boolean }) {
  const { user } = useAuth();
  const id = Number(post.statusPostId);
  const q = useQuery(`home:comments:${id}`, () => fetchComments(post), { staleMs: 5_000 });
  const comments = q.data || [];
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [replyTo, setReplyTo] = useState<{ commentId: number; name: string } | null>(null);
  const [openThreads, setOpenThreads] = useState<Set<number>>(new Set());
  const [likes, setLikes] = useState<Record<number, { liked: boolean; count: number }>>({});

  useEffect(() => {
    if (!autoFocus) return;
    const t = setTimeout(() => {
      inputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      inputRef.current?.focus({ preventScroll: true });
    }, 400);
    return () => clearTimeout(t);
  }, [autoFocus, inputRef]);

  // keep the card's comment count in step with the loaded list
  useEffect(() => {
    if (q.data) patchPost(id, { comments: q.data.length });
  }, [q.data, id]);

  const submit = async () => {
    const c = text.trim();
    if (!c || busy) return;
    setBusy(true);
    try {
      await commentPost(post, { comment: c, commentAction: 'ADD', ...(replyTo ? { parentCommentId: replyTo.commentId } : {}) });
      setText('');
      if (replyTo) {
        setOpenThreads((s) => new Set(s).add(replyTo.commentId));
        toast.ok('Reply added.');
      } else toast.ok('Comment added.');
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

  const toggleLike = async (c: Comment) => {
    const cur = likes[c.commentId] ?? { liked: !!user && !!c.likedArr?.some((l) => String(l.likedBy) === String(user.id)), count: c.likedArr?.length || 0 };
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
    const l = likes[c.commentId] ?? { liked: !!user && !!c.likedArr?.some((x) => String(x.likedBy) === String(user.id)), count: c.likedArr?.length || 0 };
    const mine = !!user && uid === String(user.id);
    const replies = c.replies || [];
    const open = openThreads.has(c.commentId);
    return (
      <div className={'hp-comment' + (reply ? ' reply' : '')} key={c.commentId}>
        <Link to={`/u/${encodeURIComponent(uid)}`}>
          <Avatar src={avatarOf(u)} name={name} size={reply ? 30 : 36} />
        </Link>
        <div className="grow">
          <div className="hp-bubble">
            <div className="row" style={{ gap: 8 }}>
              <Link to={`/u/${encodeURIComponent(uid)}`} className="hp-name small">
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
              <button className="hp-thread-toggle" onClick={() => setOpenThreads((s) => (s.has(c.commentId) ? (s.delete(c.commentId), new Set(s)) : new Set(s).add(c.commentId)))}>
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
    <section className="hp-card hp-comments" id="comments">
      <h2>
        Comments <span className="muted">{comments.length ? `(${comments.length})` : ''}</span>
      </h2>
      {q.loading && !q.data && (
        <div className="center" style={{ padding: 16 }}>
          <div className="spinner" />
        </div>
      )}
      {q.error && <ErrorBox error={q.error} onRetry={q.refetch} />}
      {q.data && !comments.length && <div className="muted small" style={{ padding: '6px 0 12px' }}>No comments yet. Start the conversation.</div>}
      <div className="hp-comment-list">{comments.map((c) => row(c))}</div>

      <div className="hp-comment-box">
        {replyTo && (
          <div className="hp-replying tiny">
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
          <Avatar src={user?.imageUrl} name={user?.name} size={34} />
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
      </div>
    </section>
  );
}

function Related({ post }: { post: Post }) {
  const id = Number(post.statusPostId);
  const q = useQuery(`home:related:${id}`, () => fetchRelated(id, relatedSeed), { staleMs: 5 * 60_000 });
  const items = useMemo(() => (q.data || []).filter((p) => Number(p.statusPostId) !== id).slice(0, 9), [q.data, id]);
  if (!items.length) return null;
  return (
    <section className="hp-related">
      <h2>More posts</h2>
      <div className="hp-grid">
        {items.map((p) => (
          <PostTile key={p.statusPostId} post={p} />
        ))}
      </div>
    </section>
  );
}

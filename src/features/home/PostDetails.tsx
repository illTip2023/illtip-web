import React, { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { goBack, Link, useParams, useQueryParams } from '../../lib/router';
import { useAuth } from '../../lib/auth';
import { useQuery } from '../../lib/query';
import { Avatar, ErrorBox, Icon, PageHeader, compactNumber, timeAgo, toast } from '../../ui/kit';
import { avatarOf, commentPost, displayName, epochMs, errMsg, fetchComments, fetchRelated, getPost, likeComment, remapMentions, type Comment, type Mention, type Post } from './api';
import { useMentionPicker } from './useMentionPicker';
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
  const [deleting, setDeleting] = useState<number | null>(null);
  const [replyTo, setReplyTo] = useState<{ commentId: number; name: string } | null>(null);
  const [openThreads, setOpenThreads] = useState<Set<number>>(new Set());
  const [likes, setLikes] = useState<Record<number, { liked: boolean; count: number }>>({});
  const mention = useMentionPicker({ text, setText, taRef: inputRef, selfId: user?.id });

  useEffect(() => {
    if (!autoFocus) return;
    const t = setTimeout(() => {
      inputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      inputRef.current?.focus({ preventScroll: true });
    }, 400);
    return () => clearTimeout(t);
  }, [autoFocus, inputRef]);

  // keep the card's comment count in step with the loaded list (top-level comments only, like the app)
  useEffect(() => {
    if (q.data) patchPost(id, { comments: q.data.length });
  }, [q.data, id]);

  // auto-grow the comment box
  useEffect(() => {
    const ta = inputRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(160, ta.scrollHeight) + 'px';
  }, [text, inputRef]);

  const submit = async () => {
    const c = text.trim();
    if (!c || busy) return;
    setBusy(true);
    try {
      // POST /post/comment { statusPostId, comment, commentAction:'ADD', mentions, parentCommentId? } (app usePostEngagement)
      const body: Parameters<typeof commentPost>[1] & { mentions: Mention[] } = {
        comment: c,
        commentAction: 'ADD',
        mentions: remapMentions(c, mention.tagged),
        ...(replyTo ? { parentCommentId: replyTo.commentId } : {}),
      };
      await commentPost(post, body);
      setText('');
      mention.clear();
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

  const remove = async (c: Comment, isReply: boolean) => {
    if (deleting) return;
    if (!window.confirm(isReply ? 'Delete this reply?' : 'Delete this comment? Its replies will be deleted too.')) return;
    setDeleting(c.commentId);
    try {
      await commentPost(post, { comment: (c.comment || '').trim() || 'deleted', commentAction: 'REMOVE', commentId: c.commentId });
      toast.ok(isReply ? 'Reply deleted.' : 'Comment deleted.');
      await q.refetch();
    } catch (e) {
      toast.error(errMsg(e, 'Could not delete comment. Please try again.'));
    } finally {
      setDeleting(null);
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

  // Replies always target the top-level comment (the backend keeps threads one level deep); prefill "@name " like the app.
  const startReply = (c: Comment, topId: number) => {
    const name = displayName(c.commentUserDetails?.[0]);
    setReplyTo({ commentId: topId, name });
    setText((t) => (t.trim() ? t : `@${name} `));
    setTimeout(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      const end = el.value.length;
      el.setSelectionRange(end, end);
    }, 0);
  };

  const cancelReply = () => {
    if (!replyTo) return;
    setReplyTo(null);
    setText((t) => t.replace(new RegExp(`^@${replyTo.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s?`), ''));
  };

  const row = (c: Comment, topId: number, reply = false) => {
    const u = c.commentUserDetails?.[0];
    const uid = String(c.commentedBy || u?.userId || '');
    const name = displayName(u);
    const l = likes[c.commentId] ?? { liked: !!user && !!c.likedArr?.some((x) => String(x.likedBy) === String(user.id)), count: c.likedArr?.length || 0 };
    const mine = !!user && !!uid && uid === String(user.id);
    const replies = c.replies || [];
    const open = openThreads.has(c.commentId);
    const when = epochMs(c.commentTime);
    return (
      <div className={'hp-cm' + (reply ? ' hp-cm-reply' : '')} key={c.commentId}>
        <Link to={`/u/${encodeURIComponent(uid)}`} className="hp-cm-av">
          <Avatar src={avatarOf(u)} name={name} size={reply ? 28 : 36} />
        </Link>
        <div className="hp-cm-body">
          <div className="hp-cm-meta">
            <Link to={`/u/${encodeURIComponent(uid)}`} className="hp-cm-name">
              {name}
            </Link>
            {when > 0 && (
              <time className="hp-cm-time" dateTime={new Date(when).toISOString()} title={new Date(when).toLocaleString()}>
                {timeAgo(when)}
              </time>
            )}
          </div>
          <div className="hp-cm-text">
            <RichText text={c.comment || ''} mentions={c.mentions} />
          </div>
          <div className="hp-cm-actions">
            <button type="button" onClick={() => startReply(c, topId)}>
              Reply
            </button>
            {mine && (
              <button type="button" className="hp-cm-del" disabled={deleting === c.commentId} onClick={() => remove(c, reply)}>
                {deleting === c.commentId ? 'Deleting…' : 'Delete'}
              </button>
            )}
          </div>
          {!reply && replies.length > 0 && (
            <>
              <button
                type="button"
                className="hp-cm-thread"
                aria-expanded={open}
                onClick={() => setOpenThreads((s) => (s.has(c.commentId) ? (s.delete(c.commentId), new Set(s)) : new Set(s).add(c.commentId)))}
              >
                <span className="hp-cm-thread-line" aria-hidden="true" />
                {open ? 'Hide replies' : `View ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`}
              </button>
              {open && <div className="hp-cm-replies">{replies.map((r) => row(r, topId, true))}</div>}
            </>
          )}
        </div>
        <button type="button" className={'hp-cm-like' + (l.liked ? ' liked' : '')} aria-pressed={l.liked} aria-label={`${l.liked ? 'Unlike' : 'Like'} comment, ${l.count} likes`} onClick={() => toggleLike(c)}>
          <Icon name="heart" size={reply ? 13 : 15} fill={l.liked} />
          {l.count > 0 && <span>{compactNumber(l.count)}</span>}
        </button>
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
      <div className="hp-cm-list">{comments.map((c) => row(c, Number(c.commentId)))}</div>

      <div className="hp-comment-box hp-cm-box">
        {replyTo && (
          <div className="hp-cm-replying">
            <span className="ellipsis">
              Replying to <b>@{replyTo.name}</b>
            </span>
            <button type="button" className="icon-btn" aria-label="Cancel reply" onClick={cancelReply}>
              <Icon name="close" size={14} />
            </button>
          </div>
        )}
        {mention.list}
        <div className="hp-cm-compose">
          <Avatar src={user?.imageUrl} name={user?.name} size={34} />
          <textarea
            ref={inputRef}
            className="textarea hp-comment-input hp-cm-input"
            rows={1}
            placeholder={replyTo ? `Reply to @${replyTo.name}…` : 'Add a comment…'}
            aria-label={replyTo ? 'Write a reply' : 'Add a comment'}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              mention.detect(e.target.value, e.target.selectionStart ?? e.target.value.length);
            }}
            onBlur={() => setTimeout(mention.close, 200)}
            onKeyDown={(e) => {
              // Enter sends on a keyboard+mouse computer; on phones Return adds a new line and the button sends.
              if (e.key === 'Enter' && !e.shiftKey && !(e.nativeEvent as any).isComposing && window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <button type="button" className="btn hp-send" disabled={!text.trim() || busy} onClick={submit} aria-label={replyTo ? 'Send reply' : 'Send comment'}>
            {busy ? <span className="hp-cm-spin" /> : <Icon name="send" size={18} />}
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

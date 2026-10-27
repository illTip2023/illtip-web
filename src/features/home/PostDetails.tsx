import React, { useEffect, useMemo, useRef } from 'react';
import { goBack, Link, useParams, useQueryParams } from '../../lib/router';
import { useQuery } from '../../lib/query';
import { ErrorBox, PageHeader } from '../../ui/kit';
import { fetchRelated, getPost, type Post } from './api';
import { CommentComposer, CommentList, CommentRecharge, useCommentThread } from './comments';
import { useVisualViewport } from '../../ui/useVisualViewport';
import { PostCard, PostSkeleton } from './PostCard';
import { PostTile } from './PostTile';
import { loadSaved } from './store';

const relatedSeed = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function PostDetails() {
  const { id } = useParams<{ id: string }>();
  const qp = useQueryParams();
  const q = useQuery(`home:post:${id}`, () => getPost(id));
  const post = q.data;
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

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

function Comments({ post, inputRef, autoFocus }: { post: Post; inputRef: { current: HTMLTextAreaElement | null }; autoFocus: boolean }) {
  useVisualViewport(); // html.kb-open hides the tab bar / env pill over the keyboard
  // Same engine + rows as the comments sheet (app PostCommentSheet / usePostEngagement).
  const thread = useCommentThread(post);
  const { q, comments } = thread;

  // Hand the composer's textarea to the page so the card's comment button can focus it.
  useEffect(() => {
    inputRef.current = thread.inputRef.current;
  });

  useEffect(() => {
    if (!autoFocus) return;
    const t = setTimeout(() => {
      const el = thread.inputRef.current;
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.focus({ preventScroll: true });
    }, 400);
    return () => clearTimeout(t);
  }, [autoFocus]); // eslint-disable-line react-hooks/exhaustive-deps

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
      <CommentList thread={thread} />
      <CommentComposer thread={thread} autoGrowMax={160} />
      <CommentRecharge thread={thread} />
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

import React, { useEffect } from 'react';
import { Link } from '../../lib/router';
import { useQuery } from '../../lib/query';
import { Empty, ErrorBox, PageHeader } from '../../ui/kit';
import { fetchSaved } from './api';
import { PostCard, PostSkeleton } from './PostCard';
import { loadSaved, useSavedIds } from './store';

/** Saved posts (GET /post/saved, like SavedPostsScreen.tsx). Unsaving hides the card right away. */
export function SavedScreen() {
  const q = useQuery('home:saved', fetchSaved, { staleMs: 0 });
  const saved = useSavedIds();

  useEffect(() => {
    void loadSaved(true);
  }, []);

  const posts = (q.data || []).filter((p) => !saved.loaded || saved.ids.has(Number(p.statusPostId)));

  return (
    <div className="hp-page">
      <PageHeader title="Saved posts" back="/" />
      {q.loading && !q.data && [0, 1].map((i) => <PostSkeleton key={i} />)}
      {q.error && <ErrorBox error={q.error} onRetry={q.refetch} />}
      {q.data && !posts.length && (
        <Empty title="No saved posts yet">
          Tap the bookmark on any post to save it here. <Link to="/">Browse the feed</Link>
        </Empty>
      )}
      <div className="hp-list">
        {posts.map((p) => (
          <PostCard key={p.statusPostId} post={{ ...p, isSaved: true }} />
        ))}
      </div>
    </div>
  );
}

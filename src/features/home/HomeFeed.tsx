import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from '../../lib/router';
import { useOnVisible } from '../../lib/query';
import { ErrorBox, Empty, Icon } from '../../ui/kit';
import { I } from './icons';
import { fetchFeed, PAGE_SIZE, placeBoostSecond, type Post } from './api';
import { PostCard, PostSkeleton } from './PostCard';
import { Composer } from './Composer';
import { loadSaved } from './store';

/**
 * Ranked home feed (GET /post with feedSeed + ranked=1, like HomeScreen.tsx).
 * Kept in a module cache so going to a post and back restores the list and scroll
 * position instead of reloading. A new seed (refresh, or 10+ minutes away) reshuffles.
 */
type FeedCache = { seed: string; startedAt: number; items: Post[]; page: number; hasMore: boolean; scrollY: number };
const newSeed = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
let cache: FeedCache = { seed: newSeed(), startedAt: Date.now(), items: [], page: 0, hasMore: true, scrollY: 0 };
const SIT_WINDOW_MS = 10 * 60 * 1000;

function dedupe(list: Post[], seen: Set<number>) {
  return list.filter((p) => {
    const id = Number(p?.statusPostId);
    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function HomeFeed() {
  if (Date.now() - cache.startedAt > SIT_WINDOW_MS) cache = { seed: newSeed(), startedAt: Date.now(), items: [], page: 0, hasMore: true, scrollY: 0 };
  const [items, setItems] = useState<Post[]>(cache.items);
  const [page, setPage] = useState(cache.page);
  const [hasMore, setHasMore] = useState(cache.hasMore);
  const [seed, setSeed] = useState(cache.seed);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<any>();
  const busy = useRef(false);
  const gen = useRef(0);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    cache = { ...cache, items, page, hasMore, seed };
  }, [items, page, hasMore, seed]);

  const load = useCallback(async (p: number, s: string, reset = false) => {
    if (busy.current && !reset) return;
    busy.current = true;
    const g = reset ? ++gen.current : gen.current;
    setLoading(true);
    setError(undefined);
    try {
      const raw = await fetchFeed(p, s);
      if (g !== gen.current) return;
      const old = reset ? [] : itemsRef.current;
      let fresh = dedupe(raw, new Set(old.map((x) => Number(x.statusPostId))));
      if (p === 1) fresh = placeBoostSecond(fresh);
      const next = [...old, ...fresh];
      itemsRef.current = next;
      setItems(next);
      setHasMore(raw.length >= PAGE_SIZE && fresh.length > 0);
      setPage(p);
    } catch (e) {
      if (g === gen.current) setError(e);
    } finally {
      if (g === gen.current) {
        setLoading(false);
        busy.current = false;
      }
    }
  }, []);

  // first load, or restore scroll position from the cache
  useEffect(() => {
    void loadSaved();
    if (!cache.items.length || cache.page === 0) load(1, cache.seed, true);
    else {
      const y = cache.scrollY;
      const t = setTimeout(() => window.scrollTo(0, y), 0);
      return () => clearTimeout(t);
    }
  }, [load]);

  useEffect(() => {
    const onScroll = () => (cache.scrollY = window.scrollY);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const loadMore = () => {
    if (hasMore && !loading && !error && page > 0) load(page + 1, seed);
  };
  const sentinel = useOnVisible(loadMore);

  const refresh = () => {
    const s = newSeed();
    cache.startedAt = Date.now();
    setSeed(s);
    setHasMore(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    load(1, s, true);
  };

  const onCreated = (p: Post) => {
    setItems((old) => [p, ...old.filter((x) => Number(x.statusPostId) !== Number(p.statusPostId))]);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const initial = loading && !items.length;

  return (
    <div className="hp-page">
      <div className="hp-topbar">
        <h1>Home</h1>
        <div className="row" style={{ gap: 4 }}>
          <Link to="/search" className="icon-btn" title="Search">
            <Icon name="search" />
          </Link>
          <Link to="/saved" className="icon-btn" title="Saved posts">
            <Icon name="bookmark" />
          </Link>
          <button className={'icon-btn' + (loading && page <= 1 ? ' hp-spin' : '')} title="Refresh feed" onClick={refresh} disabled={loading && page <= 1}>
            <I name="refresh" />
          </button>
        </div>
      </div>

      <Composer onCreated={onCreated} />

      <div className="hp-list">
        {initial && [0, 1, 2].map((i) => <PostSkeleton key={i} />)}
        {items.map((p) => (
          <PostCard key={p.statusPostId} post={p} />
        ))}
      </div>

      {error && <ErrorBox error={error} onRetry={() => (items.length ? load(page + 1, seed) : load(1, seed, true))} />}
      {!loading && !error && !items.length && page > 0 && <Empty title="No posts yet">Be the first to share something with your network.</Empty>}

      <div ref={sentinel} style={{ height: 1 }} />
      {loading && items.length > 0 && (
        <div className="center" style={{ padding: 20 }}>
          <div className="spinner" />
        </div>
      )}
      {!loading && !error && hasMore && items.length > 0 && (
        <div className="center" style={{ padding: 16 }}>
          <button className="btn btn-ghost" onClick={loadMore}>
            Load more
          </button>
        </div>
      )}
      {!hasMore && items.length > 0 && <div className="hp-end muted small">You're all caught up</div>}
    </div>
  );
}

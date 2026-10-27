import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from '../../lib/router';
import { useOnVisible } from '../../lib/query';
import { useAuth } from '../../lib/auth';
import { Avatar, ErrorBox, Empty } from '../../ui/kit';
import { useNotifCount } from '../../ui/Shell';
import { detectPlatform, storeLink } from '../../ui/AppBanner';
import { fetchFeed, PAGE_SIZE, placeBoostSecond, type Post } from './api';
import { PostCard, PostSkeleton } from './PostCard';
import { CreatePostSheet } from './CreatePostSheet';
import { loadSaved, useSavedIds } from './store';

/* Header glyphs drawn like the app's HeaderUI (Search.tsx svg, FontAwesome bookmark regular, NotificationIcon). */
function HeadIcon({ name }: { name: 'search' | 'bookmark' | 'bell' | 'image' }) {
  if (name === 'search')
    return (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <circle cx="11" cy="11" r="7.5" />
        <path d="M16.6 16.6 21 21" />
      </svg>
    );
  if (name === 'bookmark')
    return (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
        <path d="M6 3h12v18l-6-4.2L6 21z" />
      </svg>
    );
  if (name === 'bell')
    return (
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M6 9.5a6 6 0 0 1 12 0c0 4.5 1.6 6.3 2.4 7H3.6c.8-.7 2.4-2.5 2.4-7z" />
        <path d="M10 19.5a2 2 0 0 0 4 0" />
      </svg>
    );
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path fillRule="evenodd" d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 2v9.6l4.3-4.3a1 1 0 0 1 1.4 0L14 15.6l1.8-1.8a1 1 0 0 1 1.4 0l2.8 2.8V6H4zm12 1.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4z" />
    </svg>
  );
}

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

  const { user } = useAuth();
  const notif = useNotifCount(!!user);
  const savedIds = useSavedIds();
  const savedCount = savedIds.loaded ? savedIds.ids.size : 0;
  const platform = detectPlatform();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pick, setPick] = useState<{ files: File[]; n: number } | null>(null);
  const pickN = useRef(0);
  const closeSheet = useCallback(() => setSheetOpen(false), []);
  const openComposer = () => {
    setPick(null);
    setSheetOpen(true);
  };
  const onPickPhotos = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files: File[] = e.target.files ? (Array.from(e.target.files) as File[]) : [];
    e.target.value = '';
    if (!files.length) return;
    setPick({ files, n: ++pickN.current });
    setSheetOpen(true);
  };

  const onCreated = (p: Post) => {
    setItems((old) => [p, ...old.filter((x) => Number(x.statusPostId) !== Number(p.statusPostId))]);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const initial = loading && !items.length;

  /* Like the app (HomeScreen onScroll + HeaderUI): the header (logo · i'llTip · search / saved / bell) and the
     "Write something here..." pill slide away when you scroll down and come back as soon as you scroll up. */
  const headRef = useRef<HTMLDivElement | null>(null);
  const [headHidden, setHeadHidden] = useState(false);
  const [headTop, setHeadTop] = useState(0);
  useEffect(() => {
    const measure = () => {
      const bar = document.querySelector('.topbar') as HTMLElement | null;
      setHeadTop(bar && getComputedStyle(bar).display !== 'none' ? bar.offsetHeight : 0);
    };
    measure();
    window.addEventListener('resize', measure);
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const dy = y - lastY;
      lastY = y;
      const head = headRef.current;
      const h = head ? head.offsetHeight : 0;
      if (y <= h + 48) return setHeadHidden(false);
      if (dy < -4) setHeadHidden(false);
      else if (dy > 6) setHeadHidden(true);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  const savedLabel = savedCount > 99 ? '99+' : String(savedCount);
  return (
    <div className="hp-page">
      <div ref={headRef} className={'hp-feedhead' + (headHidden ? ' hidden' : '')} style={{ top: headTop }}>
        <header className="hp-appbar">
          <div className="hp-appbar-side">
            <button type="button" className={'hp-logo' + (loading && page <= 1 ? ' hp-spin' : '')} title="Refresh feed" aria-label="Refresh feed" onClick={refresh}>
              <img src="logo.png" alt="" />
            </button>
            {platform !== 'other' && (
              <a className="hp-getapp" href={storeLink(platform)} target="_blank" rel="noreferrer">
                Get app
              </a>
            )}
          </div>
          <button type="button" className="hp-appbar-title" onClick={refresh} aria-label="i'llTip, refresh feed">
            i'llTip
          </button>
          <div className="hp-appbar-side right">
            <Link to="/search" className="hp-hbtn" title="Search">
              <HeadIcon name="search" />
              <span className="hp-sr">Search</span>
            </Link>
            <Link to="/saved" className="hp-hbtn" title="Saved posts">
              <HeadIcon name="bookmark" />
              <span className="hp-sr">Saved posts</span>
              {savedCount > 0 && <span className="hp-saved-badge" aria-label={`${savedLabel} saved`}>{savedLabel}</span>}
            </Link>
            <Link to="/notifications" className="hp-hbtn hp-bell" title="Notifications">
              <HeadIcon name="bell" />
              <span className="hp-sr">{notif ? `Notifications, ${notif} new` : 'Notifications'}</span>
              {notif > 0 && <span className="hp-bell-dot" />}
            </Link>
          </div>
        </header>

        <div className="hp-write">
          <button type="button" className="hp-write-pill" onClick={openComposer} aria-label="Write something here">
            <Avatar src={user?.imageUrl} name={user?.name} size={44} />
            <span className="hp-write-ph">Write something here...</span>
          </button>
          <label className="hp-write-img" title="Add photos" aria-label="Add photos to a new post">
            <input className="hp-file" type="file" accept="image/*" multiple onChange={onPickPhotos} aria-label="Add photos to a new post" />
            <HeadIcon name="image" />
          </label>
        </div>
      </div>
      <CreatePostSheet open={sheetOpen} onClose={closeSheet} onCreated={onCreated} pick={pick} />

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

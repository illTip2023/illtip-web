/**
 * Full-screen post viewer (/watch/:id), the web version of the app's Home viewer
 * (illtip-mobile ProfileGridPostViewerScreen.tsx opened with homeFeedContext from HomeScreen.openHomeFeedViewer):
 * the tapped post first, then posts ranked for it (GET /post/related, videos first), one per screen,
 * vertical paging. If /post/related fails, it continues with the home feed (GET /post) like the app.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { goBack, Link, navigate, useParams } from '../../lib/router';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/api';
import { invalidate, useQuery } from '../../lib/query';
import { Avatar, Icon, compactNumber, timeAgo, toast } from '../../ui/kit';
import {
  authorOf,
  bookmarkPost,
  coinTotal,
  epochMs,
  fetchFeed,
  getPost,
  isBoosted,
  likePost,
  mediaOf,
  PAGE_SIZE,
  placeBoostSecond,
  recordView,
  shareUrl,
  type Media,
  type Post,
} from './api';
import { PollCard, RichText, TipModal, copyText } from './PostCard';
import { loadSaved, patchPost, setSaved, usePostPatch, useSavedIds } from './store';
import { ViewerComments } from './ViewerComments';
import { takeWatchFeedSeed } from './ViewerOpen';
import './viewer.css';

const RELATED_PAGE_SIZE = 10; // ProfileGridPostViewerScreen RELATED_PAGE_SIZE
const SOUND_KEY = 'illtip.viewer.sound';
const LIST_TTL_MS = 10 * 60 * 1000;
const MOUNT_RADIUS = 2;

/** GET /post/related (illtip-mobile services/post.ts fetchRelatedPosts). */
async function fetchRelatedPage(statusPostId: number, pageIndex: number, seed: string): Promise<Post[]> {
  const { data } = await api.get('/post/related', { params: { statusPostId, pageIndex, pageSize: RELATED_PAGE_SIZE, seed } });
  return Array.isArray(data?.data) ? data.data : [];
}

const newSeed = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/* ---------- sound preference (remembered) ---------- */

function readSound() {
  try {
    return localStorage.getItem(SOUND_KEY) === '1';
  } catch {
    return false;
  }
}
function writeSound(on: boolean) {
  try {
    localStorage.setItem(SOUND_KEY, on ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
}

/* ---------- list state, kept per opened post so Back from a profile restores the position ---------- */

type ListState = { rest: Post[]; source: 'related' | 'feed'; page: number; hasMore: boolean; seed: string; feedSeed: string; active: number; at: number };
const lists = new Map<string, ListState>();

/* ---------- small icons not in the kit ---------- */

const VP: Record<string, string> = {
  pause: 'M7 5h3v14H7zM14 5h3v14h-3z',
  volOn: 'M4 9h4l5-4v14l-5-4H4zM16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11',
  volOff: 'M4 9h4l5-4v14l-5-4H4zM16 9l5 6M21 9l-5 6',
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
};
function VI({ name, size = 20, fill }: { name: keyof typeof VP; size?: number; fill?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d={VP[name]} />
    </svg>
  );
}

/** Fill the frame (crop a little) only when the media is portrait and close to the frame's shape, like the app's fillPortrait. */
function fitFor(w: number, h: number, box: HTMLElement | null): 'cover' | 'contain' {
  if (!box || !w || !h || h <= w) return 'contain';
  const ar = w / h;
  const car = box.clientWidth / Math.max(1, box.clientHeight);
  return car < 1 && Math.abs(ar - car) / car < 0.22 ? 'cover' : 'contain';
}

/* =============================== screen =============================== */

export function WatchScreen() {
  const { id } = useParams<{ id: string }>();
  const { session } = useAuth();
  // chrome:false routes are not auth-gated by the shell, so gate here (same rules as main.tsx).
  const redirect = !session
    ? '/login?next=' + encodeURIComponent(`/watch/${id}`)
    : session.user.emailVerified === false
      ? '/verify-email?email=' + encodeURIComponent(session.user.email)
      : session.user.roleSelected === false
        ? '/role'
        : null;
  useEffect(() => {
    if (redirect) navigate(redirect, { replace: true });
  }, [redirect]);
  useEffect(() => {
    document.documentElement.classList.add('vw-lock');
    return () => document.documentElement.classList.remove('vw-lock');
  }, []);
  if (redirect) return null;
  return <Watch key={id} id={id} />;
}

function Watch({ id }: { id: string }) {
  const startId = Number(id);
  const q = useQuery(`home:post:${id}`, () => getPost(id), { staleMs: 60_000 });
  const start = q.data;

  const [list, setList] = useState<ListState>(() => {
    const c = lists.get(id);
    if (c && Date.now() - c.at < LIST_TTL_MS) return c;
    return { rest: [], source: 'related', page: 0, hasMore: true, seed: newSeed(), feedSeed: takeWatchFeedSeed() || newSeed(), active: 0, at: Date.now() };
  });
  const listRef = useRef(list);
  listRef.current = list;
  useEffect(() => {
    lists.set(id, list);
  }, [id, list]);

  const items = useMemo(() => (start ? [start, ...list.rest.filter((p) => Number(p.statusPostId) !== startId)] : []), [start, list.rest, startId]);
  const [active, setActive] = useState(list.active);
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    setList((l) => (l.active === active ? l : { ...l, active }));
  }, [active]);

  const [soundOn, setSoundOn] = useState(readSound);
  const [hidden, setHidden] = useState(typeof document !== 'undefined' && document.hidden);
  const [commentsFor, setCommentsFor] = useState<Post | null>(null);
  const [tipFor, setTipFor] = useState<Post | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const pagerRef = useRef<HTMLDivElement>(null);
  const togglers = useRef(new Map<number, () => void>());
  const pendingTarget = useRef<number | null>(null);

  useEffect(() => {
    void loadSaved();
    const v = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', v);
    return () => document.removeEventListener('visibilitychange', v);
  }, []);

  /* ----- paging data: related first, home feed as fallback ----- */
  const busy = useRef(false);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  const loadMore = useCallback(async () => {
    if (busy.current || !listRef.current.hasMore) return;
    busy.current = true;
    setLoadingMore(true);
    setLoadFailed(false);
    let s = listRef.current;
    let failed = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      const page = s.page + 1;
      try {
        let got: Post[];
        let more: boolean;
        if (s.source === 'related') {
          got = await fetchRelatedPage(startId, page, s.seed);
          more = got.length >= RELATED_PAGE_SIZE;
          // Nothing related at all: continue with the home feed so the viewer never ends on one post.
          if (page === 1 && !got.length) {
            s = { ...s, source: 'feed', page: 0, hasMore: true };
            continue;
          }
        } else {
          got = await fetchFeed(page, s.feedSeed);
          if (page === 1) got = placeBoostSecond(got);
          more = got.length >= PAGE_SIZE;
        }
        const known = new Set([startId, ...s.rest.map((p) => Number(p.statusPostId))]);
        const fresh = got.filter((p) => {
          const pid = Number(p?.statusPostId);
          if (!Number.isFinite(pid) || pid <= 0 || known.has(pid)) return false;
          known.add(pid);
          return true;
        });
        s = { ...s, page, rest: [...s.rest, ...fresh], hasMore: more, at: Date.now() };
        if (fresh.length || !more) break;
      } catch {
        if (s.source === 'related' && s.page === 0) {
          // Related posts unavailable (e.g. an older server): same fallback as the app.
          s = { ...s, source: 'feed', page: 0, hasMore: true };
          continue;
        }
        failed = true;
        break;
      }
    }
    busy.current = false;
    if (!alive.current) return;
    setList((cur) => ({ ...s, active: cur.active }));
    setLoadingMore(false);
    setLoadFailed(failed);
  }, [startId]);

  useEffect(() => {
    if (loadFailed || !list.hasMore) return;
    if (active >= items.length - 3) void loadMore();
  }, [active, items.length, list.hasMore, loadFailed, loadMore]);

  /* ----- views (POST /post/view, batched in api.ts) ----- */
  const activeId = items[active] ? Number(items[active].statusPostId) : 0;
  useEffect(() => {
    if (activeId) recordView(activeId);
  }, [activeId]);

  /* ----- scroll position <-> active slide ----- */
  const restored = useRef(list.active === 0);
  useLayoutEffect(() => {
    const el = pagerRef.current;
    if (restored.current || !el || items.length <= list.active) return;
    restored.current = true;
    el.scrollTop = list.active * el.clientHeight;
  });

  const onScroll = useCallback(() => {
    const el = pagerRef.current;
    if (!el) return;
    const h = Math.max(1, el.clientHeight);
    const idx = Math.max(0, Math.min(Math.round(el.scrollTop / h), Math.max(0, items.length - 1)));
    if (pendingTarget.current === idx) pendingTarget.current = null;
    if (idx !== activeRef.current) setActive(idx);
  }, [items.length]);

  // Keep the current slide aligned when the viewport changes size (rotation, mobile URL bar).
  useEffect(() => {
    const el = pagerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let h = el.clientHeight;
    const ro = new ResizeObserver(() => {
      if (el.clientHeight === h) return;
      h = el.clientHeight;
      el.scrollTop = activeRef.current * h;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [!!start]);

  const goTo = useCallback(
    (i: number) => {
      const el = pagerRef.current;
      if (!el) return;
      const n = Math.max(0, Math.min(i, items.length - 1));
      pendingTarget.current = n;
      el.scrollTo({ top: n * el.clientHeight, behavior: 'smooth' });
    },
    [items.length],
  );
  const step = useCallback((dir: 1 | -1) => goTo((pendingTarget.current ?? activeRef.current) + dir), [goTo]);

  // Desktop wheel / trackpad: one post per gesture (trackpad inertia would otherwise skip several).
  useEffect(() => {
    const el = pagerRef.current;
    if (!el) return;
    let locked = false;
    let lockedAt = 0;
    let last = 0;
    let acc = 0;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return;
      const t = e.target as HTMLElement;
      const sc = t?.closest?.('.vw-scroll') as HTMLElement | null;
      if (sc && sc.scrollHeight > sc.clientHeight + 1) {
        const down = e.deltaY > 0;
        if ((down && sc.scrollTop + sc.clientHeight < sc.scrollHeight - 1) || (!down && sc.scrollTop > 0)) return;
      }
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      const now = performance.now();
      if (locked) {
        if (now - last > 180 && now - lockedAt > 420) locked = false;
        else {
          last = now;
          return;
        }
      }
      if (now - last > 250) acc = 0;
      last = now;
      acc += e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1);
      if (Math.abs(acc) >= 24) {
        step(acc > 0 ? 1 : -1);
        locked = true;
        lockedAt = now;
        acc = 0;
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [step, !!start]);

  const toggleSound = useCallback(() => {
    setSoundOn((on) => {
      const next = !on;
      writeSound(next);
      // Apply synchronously inside the tap so iOS keeps playing with sound.
      pagerRef.current?.querySelectorAll('video').forEach((v) => (v.muted = !next));
      return next;
    });
  }, []);
  // Autoplay with sound was refused by the browser: continue muted (not remembered).
  const onAutoplayBlocked = useCallback(() => setSoundOn(false), []);

  const back = useCallback(() => goBack('/'), []);

  // Keyboard: arrows/PageUp/PageDown/j/k page, space toggles play, m mutes, Esc goes back.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (commentsFor || tipFor || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === 'j') {
        e.preventDefault();
        step(1);
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'k') {
        e.preventDefault();
        step(-1);
      } else if (e.key === ' ' || e.key === 'Spacebar') {
        if (t && (t.tagName === 'BUTTON' || t.tagName === 'A')) return;
        e.preventDefault();
        togglers.current.get(activeRef.current)?.();
      } else if (e.key === 'm' || e.key === 'M') {
        toggleSound();
      } else if (e.key === 'Escape') {
        back();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const c = pagerRef.current?.querySelector(`[data-vw-index="${activeRef.current}"] .vw-carousel`) as HTMLElement | null;
        if (c) {
          e.preventDefault();
          c.scrollBy({ left: (e.key === 'ArrowRight' ? 1 : -1) * c.clientWidth, behavior: 'smooth' });
        }
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [commentsFor, tipFor, step, toggleSound, back]);

  const registerToggle = useCallback((i: number, fn: (() => void) | null) => {
    if (fn) togglers.current.set(i, fn);
    else togglers.current.delete(i);
  }, []);

  // Which video slides get a source: the active one, the next video ahead (preloaded) and the one just behind.
  const nextVideoIdx = useMemo(() => {
    for (let i = active + 1; i < Math.min(items.length, active + 6); i++) if (mediaOf(items[i]).some((m) => m.kind === 'video')) return i;
    return -1;
  }, [active, items]);

  return (
    <div className="vw">
      <div className="vw-stage">
        <div className="vw-col">
          {!start ? (
            <div className="vw-state">
              {q.error ? (
                <div className="vw-state-box">
                  <div style={{ fontWeight: 600 }}>{/no longer available/i.test(String(q.error?.message)) ? 'This post is no longer available.' : 'Could not load this post.'}</div>
                  <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
                    <button className="btn btn-sm" onClick={() => q.refetch()}>
                      Try again
                    </button>
                  </div>
                </div>
              ) : (
                <div className="vw-spin" aria-label="Loading" />
              )}
            </div>
          ) : (
            <div className="vw-pager" ref={pagerRef} onScroll={onScroll}>
              {items.map((p, i) => {
                const near = Math.abs(i - active) <= MOUNT_RADIUS || i === nextVideoIdx;
                const load: VideoLoad = i === active ? 'play' : i === nextVideoIdx ? 'preload' : Math.abs(i - active) === 1 ? 'keep' : 'none';
                return (
                  <section className="vw-slide-wrap" data-vw-index={i} key={p.statusPostId} aria-label={`Post ${i + 1}`}>
                    {near ? (
                      <Slide
                        post={p}
                        index={i}
                        active={i === active && !hidden}
                        isCurrent={i === active}
                        load={load}
                        muted={!soundOn}
                        onToggleSound={toggleSound}
                        onAutoplayBlocked={onAutoplayBlocked}
                        onComments={() => setCommentsFor(p)}
                        onTip={() => setTipFor(p)}
                        registerToggle={registerToggle}
                      />
                    ) : (
                      <SlidePlaceholder post={p} />
                    )}
                  </section>
                );
              })}
            </div>
          )}

          <button className="vw-back" onClick={back} aria-label="Go back">
            <Icon name="back" size={20} />
          </button>

          {start && active >= items.length - 1 && (loadingMore || loadFailed) && (
            <div className="vw-more">
              {loadFailed ? (
                <button className="vw-more-pill" onClick={() => void loadMore()}>
                  Couldn't load more. Tap to retry
                </button>
              ) : (
                <span className="vw-more-pill" aria-label="Loading more">
                  <span className="vw-spin sm" />
                </span>
              )}
            </div>
          )}

          {commentsFor && <ViewerComments post={commentsFor} onClose={() => setCommentsFor(null)} />}
        </div>

        {start && (
          <div className="vw-desk-nav" aria-hidden={false}>
            <button className="vw-nav-btn" onClick={() => step(-1)} disabled={active <= 0} aria-label="Previous post">
              <VI name="up" size={22} />
            </button>
            <button className="vw-nav-btn" onClick={() => step(1)} disabled={active >= items.length - 1} aria-label="Next post">
              <VI name="down" size={22} />
            </button>
          </div>
        )}
      </div>
      {tipFor && <TipModal post={tipFor} open onClose={() => setTipFor(null)} />}
    </div>
  );
}

/* =============================== slide =============================== */

type VideoLoad = 'play' | 'preload' | 'keep' | 'none';

function SlidePlaceholder({ post }: { post: Post }) {
  const m = mediaOf(post)[0];
  const thumb = m ? (m.kind === 'video' ? m.poster : m.url) : undefined;
  return <div className={'vw-slide' + (m ? '' : ' text')}>{thumb && <img className="vw-img" src={thumb} alt="" loading="lazy" decoding="async" />}</div>;
}

function Slide({
  post,
  index,
  active,
  isCurrent,
  load,
  muted,
  onToggleSound,
  onAutoplayBlocked,
  onComments,
  onTip,
  registerToggle,
}: {
  post: Post;
  index: number;
  /** Current slide and nothing on top of it: may play. */
  active: boolean;
  isCurrent: boolean;
  load: VideoLoad;
  muted: boolean;
  onToggleSound: () => void;
  onAutoplayBlocked: () => void;
  onComments: () => void;
  onTip: () => void;
  registerToggle: (i: number, fn: (() => void) | null) => void;
}) {
  const { user } = useAuth();
  const id = Number(post.statusPostId);
  const patch = usePostPatch(id);
  const saved = useSavedIds();
  const author = authorOf(post);
  const media = useMemo(() => mediaOf(post), [post]);
  const isText = media.length === 0;
  const isOwn = !!user && (String(post.createdBy) === String(user.id) || author.userId === String(user.id));
  const liked = patch.liked ?? !!post.amILiked;
  const likeCount = patch.likeCount ?? (post.likedArr?.length || 0);
  const coins = patch.coins ?? coinTotal(post);
  const comments = patch.comments ?? (post.commentArr?.length || 0);
  const caption = (patch.caption ?? post.caption ?? '').trim();
  const mentions = patch.mentions ?? post.mentions;
  const isSaved = saved.loaded ? saved.ids.has(id) : !!post.isSaved;
  const [likeBusy, setLikeBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [slider, setSlider] = useState(0);
  const [userPaused, setUserPaused] = useState(false);
  const [flash, setFlash] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = media[Math.min(slider, media.length - 1)];
  const currentIsVideo = current?.kind === 'video';

  // Each time the slide becomes current it plays (app: setIsPlaying(isActive)).
  useEffect(() => {
    if (isCurrent) setUserPaused(false);
  }, [isCurrent, slider]);
  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  const togglePlay = useCallback(() => {
    if (!currentIsVideo) return;
    const v = rootRef.current?.querySelector('video[data-current="1"]') as HTMLVideoElement | null;
    setUserPaused((p) => {
      const next = !p;
      // Act inside the tap so mobile browsers accept play().
      if (v) {
        if (next) v.pause();
        else v.play().catch(() => {});
      }
      return next;
    });
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setFlash(true);
    flashTimer.current = setTimeout(() => setFlash(false), 700);
  }, [currentIsVideo]);

  useEffect(() => {
    registerToggle(index, togglePlay);
    return () => registerToggle(index, null);
  }, [index, togglePlay, registerToggle]);

  const toggleLike = async () => {
    if (likeBusy) return;
    const next = !liked;
    setLikeBusy(true);
    patchPost(id, { liked: next, likeCount: Math.max(0, likeCount + (next ? 1 : -1)) });
    try {
      await likePost(post, next);
    } catch {
      patchPost(id, { liked: !next, likeCount });
      toast.error('Could not update like. Please try again.');
    } finally {
      setLikeBusy(false);
    }
  };

  const toggleSave = async () => {
    if (saveBusy) return;
    const next = !isSaved;
    setSaveBusy(true);
    setSaved(id, next);
    try {
      await bookmarkPost(id, next);
      toast.ok(next ? 'Post saved.' : 'Removed from saved.');
      invalidate('home:saved');
    } catch {
      setSaved(id, !next);
      toast.error('Could not update saved posts.');
    } finally {
      setSaveBusy(false);
    }
  };

  const share = async () => {
    const url = shareUrl(id);
    const nav = navigator as Navigator & { share?: (d: { url?: string; title?: string; text?: string }) => Promise<void> };
    if (typeof nav.share === 'function') {
      try {
        await nav.share({ url, title: `${author.name} on i'llTip` });
        return;
      } catch (e: any) {
        if (e?.name === 'AbortError') return;
      }
    }
    (await copyText(url)) ? toast.ok('Link copied to clipboard.') : toast.error('Could not copy link.');
  };

  const onSlideClick = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('a,button,input,textarea,.vw-rail,.vw-caption,.vw-text,.hp-poll')) return;
    togglePlay();
  };

  const shouldPlay = active && !userPaused;
  const paused = isCurrent && currentIsVideo && userPaused;

  return (
    <div className={'vw-slide' + (isText ? ' text' : '')} ref={rootRef} onClick={onSlideClick}>
      {media.length > 1 ? (
        <Carousel media={media} slider={slider} setSlider={setSlider} shouldPlay={shouldPlay} isCurrent={isCurrent} load={load} muted={muted} onAutoplayBlocked={onAutoplayBlocked} />
      ) : media.length === 1 ? (
        <MediaLayer m={media[0]} shouldPlay={shouldPlay} isCurrent={isCurrent} load={load} muted={muted} onAutoplayBlocked={onAutoplayBlocked} current />
      ) : (
        <div className="vw-text vw-scroll">
          {caption && (
            <div className="vw-text-body pre">
              <RichText text={caption} mentions={mentions} links={isBoosted(post)} />
            </div>
          )}
          <PollCard post={post} />
        </div>
      )}

      {currentIsVideo && (paused || (flash && isCurrent)) && (
        <span className="vw-bigplay" aria-hidden>
          {paused ? <Icon name="play" size={28} /> : <VI name="pause" size={28} fill />}
        </span>
      )}

      {media.length > 1 && (
        <div className="vw-dots" aria-hidden>
          {media.map((m, i) => (
            <span key={m.key} className={i === slider ? 'on' : ''} />
          ))}
        </div>
      )}

      {!isText && <div className="vw-topscrim" aria-hidden />}

      <div className="vw-bottom">
        <div className="vw-left">
          <Link to={`/u/${encodeURIComponent(author.userId)}`} className="vw-author">
            <Avatar src={author.avatar} name={author.name} size={32} />
            <span className="vw-author-name ellipsis">{author.name}</span>
            {author.verified && (
              <span className="hp-verified" title="Subscriber badge">
                <Icon name="check" size={10} />
              </span>
            )}
            <span className="vw-time">{timeAgo(epochMs(post.createdTime))}</span>
          </Link>
          {!isText && caption && <Caption key={id} text={caption} post={post} mentions={mentions} />}
        </div>

        <div className="vw-rail">
          <RailBtn label={liked ? 'Unlike' : 'Like'} count={compactNumber(likeCount)} onClick={toggleLike} className={liked ? 'liked' : ''} pressed={liked}>
            <Icon name="heart" size={26} fill={liked} />
          </RailBtn>
          <RailBtn label="Comments" count={compactNumber(comments)} onClick={onComments}>
            <Icon name="comment" size={26} />
          </RailBtn>
          <RailBtn label={isSaved ? 'Unsave post' : 'Save post'} count={isSaved ? 'Saved' : 'Save'} onClick={toggleSave} className={isSaved ? 'saved' : ''} pressed={isSaved}>
            <Icon name="bookmark" size={24} fill={isSaved} />
          </RailBtn>
          <RailBtn label="Share post" count="Share" onClick={share}>
            <Icon name="share" size={24} />
          </RailBtn>
          {isOwn ? (
            <div className="vw-rail-item" title="Tips on your post">
              <span className="vw-rail-ico static">
                <Icon name="coin" size={24} />
              </span>
              <span className="vw-rail-count">{compactNumber(coins)}</span>
            </div>
          ) : (
            <RailBtn label="Send a tip" count={coins > 0 ? compactNumber(coins) : 'Tip'} onClick={onTip} className="tip">
              <Icon name="coin" size={24} />
            </RailBtn>
          )}
          {currentIsVideo && isCurrent && (
            <>
              <button className="vw-mini" onClick={togglePlay} aria-label={userPaused ? 'Play video' : 'Pause video'}>
                {userPaused ? <Icon name="play" size={14} /> : <VI name="pause" size={14} fill />}
              </button>
              <button className="vw-mini" onClick={onToggleSound} aria-label={muted ? 'Unmute video' : 'Mute video'} aria-pressed={!muted}>
                <VI name={muted ? 'volOff' : 'volOn'} size={16} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function RailBtn({ label, count, onClick, children, className, pressed }: { label: string; count?: string; onClick: () => void; children: React.ReactNode; className?: string; pressed?: boolean }) {
  return (
    <button className={'vw-rail-item ' + (className || '')} onClick={onClick} aria-label={label} aria-pressed={pressed}>
      <span className="vw-rail-ico">{children}</span>
      {count != null && <span className="vw-rail-count">{count}</span>}
    </button>
  );
}

/* ---------- caption: two lines, "more" expands in place ---------- */

function Caption({ text, post, mentions }: { text: string; post: Post; mentions?: Post['mentions'] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const check = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    check();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, open]);
  return (
    <div className={'vw-caption' + (open ? ' open vw-scroll' : '')}>
      <div ref={ref} className={'vw-caption-text pre' + (open ? '' : ' clamp')} onClick={() => overflows && !open && setOpen(true)}>
        <RichText text={text} mentions={mentions} links={isBoosted(post)} />
      </div>
      {overflows && !open && (
        <button className="vw-caption-more" onClick={() => setOpen(true)} aria-label="Show full caption">
          more
        </button>
      )}
      {open && (
        <button className="vw-caption-more" onClick={() => setOpen(false)}>
          Show less
        </button>
      )}
    </div>
  );
}

/* ---------- media ---------- */

function Carousel({
  media,
  slider,
  setSlider,
  shouldPlay,
  isCurrent,
  load,
  muted,
  onAutoplayBlocked,
}: {
  media: Media[];
  slider: number;
  setSlider: (n: number) => void;
  shouldPlay: boolean;
  isCurrent: boolean;
  load: VideoLoad;
  muted: boolean;
  onAutoplayBlocked: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const go = (i: number) => {
    const el = ref.current;
    if (el) el.scrollTo({ left: Math.max(0, Math.min(media.length - 1, i)) * el.clientWidth, behavior: 'smooth' });
  };
  return (
    <>
      <div
        className="vw-carousel"
        ref={ref}
        onScroll={(e) => {
          const el = e.currentTarget;
          const n = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
          if (n !== slider) setSlider(Math.max(0, Math.min(media.length - 1, n)));
        }}
      >
        {media.map((m, i) => (
          <div className="vw-cslide" key={m.key}>
            <MediaLayer
              m={m}
              current={i === slider}
              shouldPlay={shouldPlay && i === slider}
              isCurrent={isCurrent && i === slider}
              load={i === slider ? load : load === 'play' && Math.abs(i - slider) === 1 ? 'keep' : 'none'}
              muted={muted}
              onAutoplayBlocked={onAutoplayBlocked}
            />
          </div>
        ))}
      </div>
      {slider > 0 && (
        <button className="vw-cnav prev" aria-label="Previous photo" onClick={() => go(slider - 1)}>
          <Icon name="back" size={18} />
        </button>
      )}
      {slider < media.length - 1 && (
        <button className="vw-cnav next" aria-label="Next photo" onClick={() => go(slider + 1)}>
          <span style={{ display: 'inline-flex', transform: 'scaleX(-1)' }}>
            <Icon name="back" size={18} />
          </span>
        </button>
      )}
    </>
  );
}

function MediaLayer(props: { m: Media; current: boolean; shouldPlay: boolean; isCurrent: boolean; load: VideoLoad; muted: boolean; onAutoplayBlocked: () => void }) {
  if (props.m.kind === 'video') return <ViewerVideo {...props} />;
  return <ViewerImage m={props.m} />;
}

function ViewerImage({ m }: { m: Media }) {
  const [fit, setFit] = useState<'cover' | 'contain'>('contain');
  const [bad, setBad] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  if (bad) return <div className="vw-media vw-missing">Image unavailable</div>;
  return (
    <div className="vw-media" ref={box}>
      <img
        className={'vw-img' + (fit === 'cover' ? ' cover' : '')}
        src={m.url}
        alt=""
        decoding="async"
        onLoad={(e) => setFit(fitFor(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight, box.current))}
        onError={() => setBad(true)}
      />
    </div>
  );
}

/**
 * One video. Only gets a source when it is the current slide, the next video (preloaded) or a direct neighbour,
 * so phones never decode many at once. The thumbnail covers it until a real frame is painted (no black flash).
 */
function ViewerVideo({ m, current, shouldPlay, isCurrent, load, muted, onAutoplayBlocked }: { m: Media; current: boolean; shouldPlay: boolean; isCurrent: boolean; load: VideoLoad; muted: boolean; onAutoplayBlocked: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [fit, setFit] = useState<'cover' | 'contain'>('contain');
  const [failed, setFailed] = useState(false);
  const src = load === 'none' || !m.url ? undefined : m.url;

  useEffect(() => {
    if (!src) setFrame(false);
  }, [src]);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    let cb = 0;
    const anyV = v as any;
    const mark = () => setFrame(true);
    const onPlaying = () => {
      setWaiting(false);
      if (typeof anyV.requestVideoFrameCallback === 'function') cb = anyV.requestVideoFrameCallback(mark);
    };
    const onTime = () => {
      if (v.currentTime > 0.05 && !v.paused && v.readyState >= 2) mark();
    };
    const onWaiting = () => setWaiting(true);
    const onEmptied = () => setFrame(false);
    const onMeta = () => setFit(fitFor(v.videoWidth, v.videoHeight, box.current));
    const onError = () => {
      if (v.getAttribute('src')) setFailed(true);
    };
    v.addEventListener('playing', onPlaying);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('waiting', onWaiting);
    v.addEventListener('emptied', onEmptied);
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('error', onError);
    return () => {
      v.removeEventListener('playing', onPlaying);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('waiting', onWaiting);
      v.removeEventListener('emptied', onEmptied);
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('error', onError);
      if (cb && typeof anyV.cancelVideoFrameCallback === 'function') anyV.cancelVideoFrameCallback(cb);
    };
  }, []);

  // Start from the beginning each time it becomes the current slide (app: startFromBeginning).
  const wasCurrent = useRef(isCurrent);
  useEffect(() => {
    const v = ref.current;
    if (isCurrent && !wasCurrent.current && v && v.currentTime > 0) {
      try {
        v.currentTime = 0;
      } catch {
        /* not seekable yet */
      }
    }
    wasCurrent.current = isCurrent;
  }, [isCurrent]);

  useEffect(() => {
    const v = ref.current;
    if (!v || !src) return;
    v.muted = muted;
    if (shouldPlay) {
      const p = v.play();
      if (p && typeof p.catch === 'function')
        p.catch((err: any) => {
          if (err?.name === 'NotAllowedError' && !v.muted) {
            v.muted = true;
            onAutoplayBlocked();
            v.play().catch(() => {});
          }
        });
    } else if (!v.paused) v.pause();
  }, [shouldPlay, src, muted, onAutoplayBlocked]);

  const showPoster = !!m.poster && !frame;
  return (
    <div className="vw-media" ref={box}>
      <video
        ref={ref}
        className={'vw-video' + (fit === 'cover' ? ' cover' : '') + (frame ? ' shown' : '')}
        src={src}
        data-current={current ? '1' : '0'}
        muted={muted}
        playsInline
        loop
        preload={load === 'play' || load === 'preload' ? 'auto' : 'metadata'}
        disablePictureInPicture
        controlsList="nodownload noplaybackrate"
        {...({ 'webkit-playsinline': 'true' } as any)}
      />
      {showPoster && (
        <img
          className={'vw-poster' + (fit === 'cover' ? ' cover' : '')}
          src={m.poster}
          alt=""
          decoding="async"
          onLoad={(e) => {
            if (!frame) setFit(fitFor(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight, box.current));
          }}
          {...({ fetchpriority: isCurrent || load === 'preload' ? 'high' : 'auto' } as any)}
        />
      )}
      {failed ? (
        <div className="vw-missing">Video unavailable</div>
      ) : (
        shouldPlay && (!frame || waiting) && <span className="vw-spin vw-media-spin" aria-label="Loading video" />
      )}
    </div>
  );
}

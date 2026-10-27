import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Avatar, Empty, ErrorBox, Icon, Modal, PageHeader, Spinner, compactNumber, toast } from '../../ui/kit';
import { Link, goBack, navigate, useParams, useQueryParams } from '../../lib/router';
import { useAuth } from '../../lib/auth';
import { invalidate, setQueryData, useInfinite, useOnVisible, useQuery } from '../../lib/query';
import {
  displayName,
  errMsg,
  fetchNetworkState,
  fetchPostsPage,
  fetchProfile,
  fetchRecommendations,
  fetchReviews,
  fetchViewersCount,
  fmtDate,
  followUser,
  isVideo,
  mediaOf,
  posterUri,
  profileShareUrl,
  recordProfileView,
  unfollowUser,
  videoUri,
  type Attachment,
  type NetworkState,
  type Post,
  type ReviewRow,
} from './api';
import { PostCard } from '../home/PostCard';
import { Composer } from '../home/Composer';
import { ConfirmModal, ShareModal, Stars, VerifiedBadge } from './components';
import { bump } from './bus';

/** The app's profile tabs (useProfilePostsFeed ProfileTab): all posts, photos & videos grid, text-only feed. */
type Tab = 'all' | 'media' | 'texts';
const TAB_IDS: Tab[] = ['all', 'media', 'texts'];

export function MyProfilePage() {
  const { user } = useAuth();
  return <ProfileView userId={user?.id ?? ''} isOwn />;
}

export function UserProfilePage() {
  const { userId = '' } = useParams<{ userId: string }>();
  const { user } = useAuth();
  const isOwn = !!user?.id && String(userId) === String(user.id);
  return <ProfileView key={userId} userId={userId} isOwn={isOwn} />;
}

/** Same string the app shows next to the name: creatorStars to 1 dp, or "New". */
const ratingText = (stars?: number) => (typeof stars === 'number' ? stars.toFixed(1) : 'New');

function ProfileView({ userId, isOwn }: { userId: string; isOwn: boolean }) {
  const { user, updateUser } = useAuth();
  const qp = useQueryParams();
  const qTab = qp.get('tab') || '';
  const [tab, setTab] = useState<Tab>(TAB_IDS.includes(qTab as Tab) ? (qTab as Tab) : 'all');
  const [shareOpen, setShareOpen] = useState(false);
  const [confirmUnnet, setConfirmUnnet] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [netBusy, setNetBusy] = useState(false);

  const profileQ = useQuery(userId ? `profile:${userId}` : null, () => fetchProfile(isOwn ? undefined : userId));
  const p = profileQ.data;
  const netKey = `net:state:${userId}`;
  const netQ = useQuery(userId ? netKey : null, () => fetchNetworkState(userId));
  const recCountQ = useQuery(userId ? `recs:approvedCount:${userId}` : null, async () => (await fetchRecommendations({ direction: 'received', userId, status: 'approved', pageIndex: 1, pageSize: 1 })).totalCount);
  const viewsQ = useQuery(isOwn && userId ? `views:count:${userId}` : null, () => fetchViewersCount(userId));

  const name = displayName(p?.name, p?.userName, isOwn ? user?.name : undefined) || 'User';
  const recsPath = isOwn ? '/profile/recommendations' : `/profile/recommendations?userId=${encodeURIComponent(userId)}&name=${encodeURIComponent(name)}`;
  const reviewsPath = `/profile/reviews?userId=${encodeURIComponent(userId)}&name=${encodeURIComponent(name)}`;

  // Old deep links (settings → "/profile?tab=recommendations", "?tab=reviews") now open the dedicated pages.
  useEffect(() => {
    if (!userId) return;
    if (qTab === 'recommendations') navigate(recsPath, { replace: true });
    else if (qTab === 'reviews') navigate(isOwn ? '/profile/rating' : reviewsPath, { replace: true });
  }, [qTab, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Record a view when opening someone else's profile (ProfileScreen → recordProfileView).
  useEffect(() => {
    if (!isOwn && userId && user?.id) void recordProfileView(userId);
  }, [isOwn, userId, user?.id]);

  // Keep the signed-in user's avatar in sync (useProfileQuery does the same).
  useEffect(() => {
    if (isOwn && p?.avatar && /^https?:/.test(p.avatar) && p.avatar !== user?.imageUrl) updateUser({ imageUrl: p.avatar });
  }, [isOwn, p?.avatar, user?.imageUrl, updateUser]);

  const selectTab = (t: Tab) => {
    setTab(t);
    const base = isOwn ? '/profile' : `/u/${encodeURIComponent(userId)}`;
    navigate(base + (t === 'all' ? '' : `?tab=${t}`), { replace: true });
  };

  const toggleNetwork = async () => {
    const st = netQ.data;
    if (!st || netBusy) return;
    const now = !st.isFollowing;
    setNetBusy(true);
    setQueryData(netKey, (old: NetworkState) => (old ? { ...old, isFollowing: now, followerCount: Math.max(0, old.followerCount + (now ? 1 : -1)) } : old));
    try {
      await (now ? followUser(userId) : unfollowUser(userId));
      if (user?.id) invalidate(`net:state:${user.id}`);
      bump('net');
    } catch {
      setQueryData(netKey, () => st);
      toast.error("Couldn't update your network. Please try again.");
    } finally {
      setNetBusy(false);
    }
  };

  const onNetworkPress = () => {
    if (!netQ.data || netBusy) return;
    if (netQ.data.isFollowing) setConfirmUnnet(true);
    else void toggleNetwork();
  };

  if (!userId) return <Spinner />;
  if (profileQ.loading && !p) return <ProfileSkeleton isOwn={isOwn} />;
  if (!p) {
    return (
      <div className="pf">
        <div className="pf-sheet">
          {!isOwn && (
            <div className="pf-topbar">
              <button className="pf-top-btn" onClick={() => goBack('/')} aria-label="Go back">
                <ArrowLeft />
              </button>
            </div>
          )}
          <div className="center" style={{ padding: '32px 16px' }}>
            <div className="empty-title">Couldn't load this profile</div>
            <div className="muted" style={{ marginBottom: 14 }}>
              {profileQ.error ? errMsg(profileQ.error, 'Check your connection and try again.') : 'Check your connection and try again.'}
            </div>
            <button className="btn" onClick={() => profileQ.refetch()}>
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  const profession = p.profession;
  const site = p.weblink;
  const siteHref = site ? (/^https?:\/\//i.test(site) ? site : `https://${site}`) : '';
  // Only ever show an email on your own profile.
  const email = isOwn ? p.email : '';
  const net = netQ.data;
  const following = !!net?.isFollowing;
  const rating = ratingText(p.creatorStars);
  const author = { userId, fullName: name, userName: p.userName || name, imageDetails: p.avatar ? { src: p.avatar } : undefined, hasVerifiedBadge: !!p.hasVerifiedBadge, rankingBoostTier: p.rankingBoostTier };

  return (
    <div className="pf">
      <section className="pf-sheet">
        <div className="pf-topbar">
          {isOwn ? (
            <Link to="/profile/viewers" className="pf-top-btn pf-viewers" title="Profile viewers" aria-label={`Profile viewers: ${viewsQ.data ?? 'loading'}`}>
              <ViewerIcon />
              <span>{viewsQ.data == null ? '—' : compactNumber(viewsQ.data)}</span>
            </Link>
          ) : (
            <button className="pf-top-btn" onClick={() => goBack('/')} aria-label="Go back" title="Back">
              <ArrowLeft />
            </button>
          )}
          <div className="grow" />
          {isOwn ? (
            <div className="pf-menu-wrap">
              <button className="pf-top-btn pf-dots" onClick={() => setMenuOpen((x) => !x)} aria-label="More options" aria-haspopup="menu" aria-expanded={menuOpen} title="More">
                <Icon name="more" size={26} />
              </button>
              {menuOpen && <OwnMenu onClose={() => setMenuOpen(false)} onShare={() => setShareOpen(true)} />}
            </div>
          ) : (
            <div className="row" style={{ gap: 18 }}>
              <button className="pf-top-btn" onClick={() => setShareOpen(true)} aria-label="Share Profile" title="Share Profile">
                <ShareSquare />
              </button>
              <button className="pf-top-btn pf-net-text" onClick={onNetworkPress} disabled={!net || netBusy} aria-pressed={following}>
                {netBusy ? '...' : following ? 'Networking' : 'Network'}
              </button>
            </div>
          )}
        </div>

        <div className="pf-avatar">
          <Avatar src={p.avatar} name={name} size={124} />
          {isOwn && (
            <Link to="/profile/edit?photo=1" className="pf-avatar-edit" title="Change photo" aria-label="Change profile photo">
              <CameraIcon />
            </Link>
          )}
        </div>

        <div className="pf-name-row">
          <h1 className="pf-name">{name}</h1>
          {p.hasVerifiedBadge && <VerifiedBadge tier={p.rankingBoostTier} size={17} />}
          <span className="pf-rating-group">
            <span className="pf-name-div" aria-hidden>
              |
            </span>
            <Link
              to={isOwn ? '/profile/rating' : reviewsPath}
              className="pf-rating"
              title={isOwn ? 'Your rating. Open rating details' : `Rating ${rating}. See reviews`}
              aria-label={isOwn ? `Your rating ${rating}. Open rating details` : `Rating ${rating}. See reviews`}
            >
              <span>{rating}</span>
              <Icon name="star" size={17} />
            </Link>
          </span>
        </div>

        {profession ? (
          <div className="pf-prof">
            <CalendarIcon />
            <span>{profession}</span>
          </div>
        ) : isOwn ? (
          <Link to="/profile/edit" className="pf-prof pf-prof-add">
            <CalendarIcon />
            <span>Add your profession</span>
          </Link>
        ) : null}

        {(site || email) && (
          <div className="pf-contact">
            {site && (
              <a href={siteHref} target="_blank" rel="noreferrer noopener" className="pf-site">
                {site.replace(/\/$/, '')}
              </a>
            )}
            {site && email ? <span className="pf-contact-sep">|</span> : null}
            {email && <span>{email}</span>}
          </div>
        )}

        {p.bio ? (
          <Bio text={p.bio} />
        ) : isOwn ? (
          <Link to="/profile/edit" className="pf-bio-add">
            + Add a bio so people know what you do
          </Link>
        ) : null}

        <div className="pf-stats">
          <Link to={isOwn ? '/profile/network?tab=network' : `/profile/network?tab=network&userId=${encodeURIComponent(userId)}&name=${encodeURIComponent(name)}`} className="pf-stat" aria-label={`Network ${net?.followerCount ?? ''}`}>
            <b>{net ? compactNumber(net.followerCount) : <i className="pf-skel pf-stat-skel" />}</b>
            <span>Network</span>
          </Link>
          <Link to={isOwn ? '/profile/network?tab=networking' : `/profile/network?tab=networking&userId=${encodeURIComponent(userId)}&name=${encodeURIComponent(name)}`} className="pf-stat" aria-label={`Networking ${net?.followingCount ?? ''}`}>
            <b>{net ? compactNumber(net.followingCount) : <i className="pf-skel pf-stat-skel" />}</b>
            <span>Networking</span>
          </Link>
          <Link to={recsPath} className="pf-stat" aria-label={`Recommendations ${recCountQ.data ?? ''}`}>
            <b>{recCountQ.data == null ? <i className="pf-skel pf-stat-skel" /> : compactNumber(recCountQ.data)}</b>
            <span>Recommendations</span>
          </Link>
        </div>
      </section>

      <div className="pf-tabbar" role="tablist" aria-label="Posts">
        <div className="pf-tabs-left">
          <button role="tab" aria-selected={tab === 'all'} className={'pf-tab' + (tab === 'all' ? ' active' : '')} onClick={() => selectTab('all')}>
            All Posts
          </button>
          <button role="tab" aria-selected={tab === 'media'} aria-label="Photos & Videos" title="Photos & Videos" className={'pf-tab pf-tab-icon' + (tab === 'media' ? ' active' : '')} onClick={() => selectTab('media')}>
            <GridIcon />
          </button>
          <button role="tab" aria-selected={tab === 'texts'} className={'pf-tab' + (tab === 'texts' ? ' active' : '')} onClick={() => selectTab('texts')}>
            Feed
          </button>
        </div>
        {isOwn ? (
          <button className="pf-pill" onClick={() => setComposerOpen(true)}>
            Post
            <span className="pf-pill-dot">
              <Icon name="plus" size={14} />
            </span>
          </button>
        ) : (
          <button className="pf-pill" onClick={() => navigate(`/chat/new?u=${encodeURIComponent(userId)}&n=${encodeURIComponent(name)}`)}>
            Chat
            <span className="pf-pill-dot">
              <ChatBubble />
            </span>
          </button>
        )}
      </div>

      <PostsSection userId={userId} isOwn={isOwn} tab={tab} author={author} />

      <ShareModal open={shareOpen} onClose={() => setShareOpen(false)} url={profileShareUrl(userId)} name={name} />
      <ConfirmModal
        open={confirmUnnet}
        onClose={() => setConfirmUnnet(false)}
        title="Remove from network?"
        message={`Are you sure you want to remove ${name} from your network?`}
        confirmLabel="Remove"
        danger
        onConfirm={toggleNetwork}
      />
      {isOwn && (
        <Modal open={composerOpen} onClose={() => setComposerOpen(false)} title="Create Post">
          <div className="pf-composer">
            <Composer
              onCreated={() => {
                setComposerOpen(false);
                invalidate(`posts:self:${userId}`);
                if (tab === 'media') selectTab('all');
              }}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Own profile "…" menu. The app's "…" opens Settings; on the web it also holds Edit / Share, which used to be buttons. */
function OwnMenu({ onClose, onShare }: { onClose: () => void; onShare: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.parentElement?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  const go = (to: string) => {
    onClose();
    navigate(to);
  };
  return (
    <div className="pf-menu" role="menu" ref={ref}>
      <button role="menuitem" onClick={() => go('/profile/edit')}>
        Edit Profile
      </button>
      <button role="menuitem" onClick={() => go('/profile/edit?photo=1')}>
        Change Photo
      </button>
      <button
        role="menuitem"
        onClick={() => {
          onClose();
          onShare();
        }}
      >
        Share Profile
      </button>
      <button role="menuitem" onClick={() => go('/profile/rating')}>
        Your Rating
      </button>
      <button role="menuitem" onClick={() => go('/settings')}>
        Settings
      </button>
    </div>
  );
}

/** Bio clamped to 3 lines with a "see more" toggle on its own line (ProfileScreen BIO_MAX_LINES). */
function Bio({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      if (open) return;
      setTruncated(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [text, open]);
  return (
    <div className="pf-bio">
      <div ref={ref} className={'pf-bio-text' + (open ? '' : ' clamped')}>
        {text}
      </div>
      {(truncated || open) && (
        <button className="pf-more" onClick={() => setOpen((x) => !x)}>
          {open ? 'see less' : 'see more'}
        </button>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------- icons */

function ArrowLeft() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 12H5M11 5l-7 7 7 7" />
    </svg>
  );
}
function ShareSquare() {
  return (
    <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3" />
      <path d="M21 8l-5-5v3c-4.5 0-7 2.6-7 7.5 1.5-2.6 3.6-3.5 7-3.5v3z" />
    </svg>
  );
}
function ViewerIcon() {
  return (
    <svg width="24" height="22" viewBox="0 0 26 24" fill="currentColor" aria-hidden>
      <circle cx="10" cy="6" r="4.6" />
      <path d="M1.5 21c0-5 3.8-8.3 8.5-8.3 1.4 0 2.8.3 4 .9-1.6 1-2.9 2.4-3.6 3.9.8 1.6 2 2.9 3.4 3.5z" />
      <path d="M18.5 13.2c-3.1 0-5.6 2-6.5 4.4.9 2.4 3.4 4.4 6.5 4.4s5.6-2 6.5-4.4c-.9-2.4-3.4-4.4-6.5-4.4zm0 6.9a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z" />
      <circle cx="18.5" cy="17.6" r="1.1" />
    </svg>
  );
}
function CameraIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M9 4h6l1.6 2H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3.4zm3 4.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zm0 2a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z" />
    </svg>
  );
}
function CalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M7 2h2v2h6V2h2v2h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2zM5 9v11h14V9zm2 2h2v2H7zm4 0h2v2h-2zm4 0h2v2h-2zm-8 4h2v2H7zm4 0h2v2h-2zm4 0h2v2h-2z" />
    </svg>
  );
}
function GridIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      {[2, 9.5, 17].flatMap((y) => [2, 9.5, 17].map((x) => <rect key={`${x}-${y}`} x={x} y={y} width="5.2" height="5.2" rx="1.1" />))}
    </svg>
  );
}
function ChatBubble() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 3C6.5 3 2 6.6 2 11c0 2.3 1.2 4.4 3.2 5.9L4.5 21l4.4-2.4c1 .3 2 .4 3.1.4 5.5 0 10-3.6 10-8s-4.5-8-10-8z" />
    </svg>
  );
}

function ProfileSkeleton({ isOwn }: { isOwn: boolean }) {
  return (
    <div className="pf">
      <section className="pf-sheet">
        <div className="pf-topbar">
          {!isOwn && (
            <button className="pf-top-btn" onClick={() => goBack('/')} aria-label="Go back">
              <ArrowLeft />
            </button>
          )}
        </div>
        <div className="pf-avatar">
          <div className="pf-skel" style={{ width: 124, height: 124, borderRadius: '50%' }} />
        </div>
        <div className="pf-skel" style={{ width: 220, height: 26, margin: '14px auto 0' }} />
        <div className="pf-skel" style={{ width: 170, height: 14, margin: '12px auto 0' }} />
        <div className="pf-skel" style={{ width: '80%', height: 12, margin: '18px auto 0' }} />
        <div className="pf-skel" style={{ width: '60%', height: 12, margin: '8px auto 0' }} />
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------- posts */

function PostsSection({ userId, isOwn, tab, author }: { userId: string; isOwn: boolean; tab: Tab; author: Record<string, unknown> }) {
  const list = useInfinite<Post>(`posts:${isOwn ? 'self' : 'other'}:${userId}`, (page) => fetchPostsPage(userId, isOwn, page));
  const sentinel = useOnVisible(() => list.loadMore());

  const posts = useMemo(() => {
    const seen = new Set<number>();
    const out: Post[] = [];
    for (const p of list.items) {
      const id = Number(p.statusPostId);
      if (seen.has(id)) continue;
      if (userId && p.createdBy != null && String(p.createdBy) !== String(userId)) continue;
      seen.add(id);
      out.push(p);
    }
    return out.sort((a, b) => Number(b.createdTime || 0) - Number(a.createdTime || 0));
  }, [list.items, userId]);

  const shown = useMemo(() => posts.filter((p) => (tab === 'all' ? true : tab === 'media' ? mediaOf(p).length > 0 : mediaOf(p).length === 0)), [posts, tab]);
  // Photos & Videos: one tile per photo/video, like the app's collectMediaGridItems.
  const tiles = useMemo(() => (tab === 'media' ? shown.flatMap((p) => mediaOf(p).map((a, i) => ({ key: `${p.statusPostId}-m${i}`, post: p, att: a }))) : []), [shown, tab]);

  // Media/text posts may only show up on later pages: keep loading until we find some (same as the app).
  useEffect(() => {
    if (tab !== 'all' && !shown.length && list.hasMore && !list.loading && !list.error) list.loadMore();
  }, [tab, shown.length, list.hasMore, list.loading, list.error]); // eslint-disable-line react-hooks/exhaustive-deps

  const emptyText = tab === 'all' ? (isOwn ? 'Your posts will appear here.' : 'Nothing posted yet.') : tab === 'media' ? 'No photos to show.' : 'No texts to show.';

  return (
    <div className="pf-posts">
      {list.error && !posts.length ? (
        <div className="pf-posts-msg">
          <div className="empty-title">Couldn't load posts</div>
          <div className="muted" style={{ marginBottom: 12 }}>
            Check your connection and try again.
          </div>
          <button className="btn btn-sm" onClick={list.reload}>
            Retry
          </button>
        </div>
      ) : !shown.length && !list.loading && !list.hasMore ? (
        <Empty title="No content yet">{emptyText}</Empty>
      ) : tab !== 'media' ? (
        <div className="pf-feed">
          {shown.map((p) => (
            <PostCard key={p.statusPostId} post={(p as any).userDetails?.length ? (p as any) : ({ ...p, userDetails: [author] } as any)} />
          ))}
          {list.loading && <div className="pf-skel" style={{ height: 180, borderRadius: 16 }} />}
        </div>
      ) : (
        <div className="pf-grid">
          {tiles.map((t) => (
            <MediaTile key={t.key} post={t.post} att={t.att} />
          ))}
          {list.loading && Array.from({ length: tiles.length ? 3 : 6 }).map((_, i) => <div key={'s' + i} className="pf-tile pf-skel" />)}
        </div>
      )}
      <div ref={sentinel} style={{ height: 1 }} />
    </div>
  );
}

function MediaTile({ post, att }: { post: Post; att: Attachment }) {
  const [bad, setBad] = useState(false);
  const poster = posterUri(att);
  const video = isVideo(att);
  const caption = (post.caption || '').trim();
  return (
    <Link to={`/post/${post.statusPostId}`} className="pf-tile" title={caption.slice(0, 120) || (video ? 'View video' : 'View photo')} aria-label={video ? 'View video' : 'View photo'}>
      {poster && !bad ? (
        <img src={poster} alt="" loading="lazy" onError={() => setBad(true)} />
      ) : video && videoUri(att) ? (
        <video src={videoUri(att) + '#t=0.5'} muted playsInline preload="metadata" />
      ) : (
        <div className="pf-tile-ph">
          <Icon name={video ? 'play' : 'image'} size={26} />
        </div>
      )}
      {video && (
        <span className="pf-tile-play" aria-hidden>
          <Icon name="play" size={16} />
        </span>
      )}
    </Link>
  );
}

/* ------------------------------------------------------------------ reviews */

/** /profile/reviews?userId=&name= : job reviews for a user (opened from the "4.0 ★" rating on someone's profile). */
export function ReviewsPage() {
  const qp = useQueryParams();
  const { user } = useAuth();
  const userId = qp.get('userId') || user?.id || '';
  const name = qp.get('name') || (userId === user?.id ? user?.name || 'You' : 'User');
  return (
    <div>
      <PageHeader title="Reviews" back={userId ? `/u/${encodeURIComponent(userId)}` : '/profile'} sub={name} />
      {userId ? <ReviewsTab userId={userId} name={name} isOwn={userId === user?.id} /> : <Spinner />}
    </div>
  );
}

type ReviewSort = 'recent' | 'best' | 'lowest';

function ReviewsTab({ userId, name, isOwn }: { userId: string; name: string; isOwn: boolean }) {
  const q = useQuery(`reviews:${userId}`, () => fetchReviews(userId));
  const [sort, setSort] = useState<ReviewSort>('recent');
  const rows: ReviewRow[] = q.data || [];
  const ratings = rows.map((r) => Number(r.rating)).filter((n) => Number.isFinite(n) && n > 0);
  const avg = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;
  const hist = [5, 4, 3, 2, 1].map((s) => ({ s, n: rows.filter((r) => Math.round(Number(r.rating)) === s).length }));
  const max = Math.max(1, ...hist.map((h) => h.n));
  const sorted = useMemo(() => {
    const c = [...rows];
    if (sort === 'recent') c.sort((a, b) => Number(b.createdTime || 0) - Number(a.createdTime || 0));
    if (sort === 'best') c.sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0));
    if (sort === 'lowest') c.sort((a, b) => Number(a.rating || 0) - Number(b.rating || 0));
    return c;
  }, [rows, sort]);

  if (q.loading && !q.data) return <Spinner />;
  if (q.error && !q.data) return <ErrorBox error={q.error} onRetry={q.refetch} />;
  if (!rows.length)
    return (
      <div className="card">
        <Empty title="No reviews yet">{isOwn ? "Reviews from people you work with on i'llTip jobs will show here." : `${name} has no reviews yet. Reviews are left after a completed job.`}</Empty>
      </div>
    );

  return (
    <div className="stack">
      <div className="card pf-rev-summary">
        <div className="pf-rev-avg">
          <div className="pf-rev-big">{(Math.round(avg * 2) / 2).toFixed(1)}</div>
          <Stars value={avg} size={18} />
          <div className="muted small">
            {rows.length} review{rows.length === 1 ? '' : 's'}
          </div>
        </div>
        <div className="pf-rev-hist">
          {hist.map((h) => (
            <div key={h.s} className="pf-rev-bar-row">
              <span className="small">{h.s}★</span>
              <div className="pf-bar">
                <div style={{ width: `${(h.n / max) * 100}%` }} />
              </div>
              <span className="tiny muted" style={{ width: 22, textAlign: 'right' }}>
                {h.n}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="chips">
        {(
          [
            ['recent', 'Most recent'],
            ['best', 'Highest'],
            ['lowest', 'Lowest'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} className={'chip' + (sort === id ? ' active' : '')} onClick={() => setSort(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="card pf-rec-list">
        {sorted.map((r, i) => {
          const who = displayName(r.result?.userName) || 'User';
          return (
            <div key={`${r.serviceRequestId ?? ''}-${r.createdTime ?? i}`} className="pf-rec">
              <div className="row" style={{ alignItems: 'flex-start' }}>
                {r.givenUserId ? (
                  <Link to={`/u/${encodeURIComponent(r.givenUserId)}`}>
                    <Avatar name={who} size={40} />
                  </Link>
                ) : (
                  <Avatar name={who} size={40} />
                )}
                <div className="grow">
                  <div className="row between">
                    <span className="pf-user-name">{who}</span>
                    <span className="tiny muted">{fmtDate(r.createdTime)}</span>
                  </div>
                  <Stars value={Math.min(5, Math.max(0, Number(r.rating) || 0))} size={14} />
                  {r.review?.trim() && <div className="pf-rec-body pre">{r.review.trim()}</div>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, Empty, ErrorBox, Icon, Spinner, compactNumber, toast } from '../../ui/kit';
import { Link, goBack, navigate, useParams, useQueryParams } from '../../lib/router';
import { useAuth } from '../../lib/auth';
import { invalidate, setQueryData, useInfinite, useOnVisible, useQuery } from '../../lib/query';
import {
  displayName,
  errMsg,
  fetchHasGiven,
  fetchMyRating,
  fetchNetworkState,
  fetchPostsPage,
  fetchProfile,
  fetchRecommendations,
  fetchReviews,
  fetchServiceCatalog,
  fetchViewersCount,
  fmtDate,
  followUser,
  isVideo,
  mediaOf,
  posterUri,
  profileShareUrl,
  recordProfileView,
  toDate,
  unfollowUser,
  videoUri,
  type NetworkState,
  type Post,
  type Profile,
  type ReviewRow,
} from './api';
import { ConfirmModal, ShareModal, Stars, VerifiedBadge } from './components';
import { RecommendationModal, RecommendationsTab } from './Recommendations';
import { bump } from './bus';

type Tab = 'posts' | 'about' | 'recommendations' | 'reviews';
const TABS: { id: Tab; label: string }[] = [
  { id: 'posts', label: 'Posts' },
  { id: 'about', label: 'About' },
  { id: 'recommendations', label: 'Recommendations' },
  { id: 'reviews', label: 'Reviews' },
];

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

function useSkillNames(p?: Profile | null) {
  const cat = useQuery(p && (p.skillDetails || []).length ? 'profile:masterdata:services' : null, fetchServiceCatalog, { staleMs: 30 * 60_000 });
  return useMemo(() => {
    if (!p || !cat.data) return [] as string[];
    const svc = cat.data.find((s) => s.serviceId === p.serviceDetails?.serviceId);
    const pool = svc ? svc.skillArr || [] : cat.data.flatMap((s) => s.skillArr || []);
    const ids = new Set(p.skillDetails || []);
    const names = pool.filter((s) => ids.has(s.skillId)).map((s) => s.skill);
    return [...new Set(names)];
  }, [p, cat.data]);
}

function ProfileView({ userId, isOwn }: { userId: string; isOwn: boolean }) {
  const { user, updateUser } = useAuth();
  const qp = useQueryParams();
  const initialTab = (qp.get('tab') as Tab) || 'posts';
  const [tab, setTab] = useState<Tab>(TABS.some((t) => t.id === initialTab) ? initialTab : 'posts');
  const [shareOpen, setShareOpen] = useState(false);
  const [confirmUnnet, setConfirmUnnet] = useState(false);
  const [recOpen, setRecOpen] = useState(false);
  const [bioOpen, setBioOpen] = useState(false);
  const [netBusy, setNetBusy] = useState(false);

  const profileQ = useQuery(userId ? `profile:${userId}` : null, () => fetchProfile(isOwn ? undefined : userId));
  const p = profileQ.data;
  const netKey = `net:state:${userId}`;
  const netQ = useQuery(userId ? netKey : null, () => fetchNetworkState(userId));
  const recCountQ = useQuery(userId ? `recs:approvedCount:${userId}` : null, async () => (await fetchRecommendations({ direction: 'received', userId, status: 'approved', pageIndex: 1, pageSize: 1 })).totalCount);
  const viewsQ = useQuery(isOwn && userId ? `views:count:${userId}` : null, () => fetchViewersCount(userId));
  const ratingQ = useQuery(isOwn ? 'rating:me' : null, () => fetchMyRating(false), { staleMs: 5 * 60_000 });
  const hasGivenQ = useQuery(!isOwn && userId ? `recs:hasGiven:${userId}` : null, () => fetchHasGiven(userId));
  const skills = useSkillNames(p);

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
    history.replaceState(null, '', '#' + base + (t === 'posts' ? '' : `?tab=${t}`));
  };

  const name = displayName(p?.name, p?.userName, isOwn ? user?.name : undefined) || 'User';

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

  if (!userId) return <Spinner />;
  if (profileQ.loading && !p) return <ProfileSkeleton />;
  if (!p) {
    return (
      <div className="pf">
        {!isOwn && (
          <button className="icon-btn" onClick={() => goBack('/')} aria-label="Back">
            <Icon name="back" />
          </button>
        )}
        <div className="card center" style={{ padding: 32 }}>
          <div className="empty-title">Couldn't load this profile</div>
          <div className="muted" style={{ marginBottom: 14 }}>
            {profileQ.error ? errMsg(profileQ.error, 'Check your connection and try again.') : 'Check your connection and try again.'}
          </div>
          <button className="btn" onClick={() => profileQ.refetch()}>
            Try Again
          </button>
        </div>
      </div>
    );
  }

  const headline = p.profession || (isOwn ? 'Add your profession' : '');
  const location = p.address || p.country;
  const site = p.weblink;
  const siteHref = site ? (/^https?:\/\//i.test(site) ? site : `https://${site}`) : '';
  const stars = p.creatorStars;
  const net = netQ.data;
  const following = !!net?.isFollowing;
  const rating = ratingQ.data;
  const bioLong = p.bio.length > 280 || p.bio.split('\n').length > 4;

  const ratingPill = (
    <span className={'pf-rating' + (isOwn ? ' clickable' : '')} title={isOwn ? 'Your rating. Open rating details' : 'Creator rating'}>
      <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden>
        <path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z" fill="#FBBF24" />
      </svg>
      {typeof stars === 'number' ? stars.toFixed(1) : 'New'}
    </span>
  );

  return (
    <div className="pf">
      <section className="pf-hero">
        <div className="pf-cover">
          <div className="pf-cover-art" aria-hidden />
          <div className="pf-cover-bar">
            {!isOwn ? (
              <button className="pf-glass-btn" onClick={() => goBack('/')} aria-label="Back">
                <Icon name="back" size={20} />
              </button>
            ) : (
              <Link to="/profile/viewers" className="pf-glass-btn pf-glass-pill" title="Profile viewers">
                <Icon name="eye" size={18} fill={false} />
                <span>{viewsQ.data == null ? '–' : compactNumber(viewsQ.data)}</span>
              </Link>
            )}
            <div className="grow" />
            <button className="pf-glass-btn" onClick={() => setShareOpen(true)} aria-label="Share profile" title="Share profile">
              <Icon name="share" size={18} />
            </button>
            {isOwn && (
              <Link to="/settings" className="pf-glass-btn" title="Settings">
                <Icon name="settings" size={18} fill={false} />
              </Link>
            )}
          </div>
        </div>

        <div className="pf-head">
          <div className="pf-avatar-wrap">
            <div className="pf-avatar-ring">
              <Avatar src={p.avatar} name={name} size={116} />
            </div>
            {isOwn && (
              <Link to="/profile/edit?photo=1" className="pf-avatar-edit" title="Change photo">
                <Icon name="image" size={16} />
              </Link>
            )}
          </div>

          <div className="pf-actions">
            {isOwn ? (
              <>
                <Link to="/profile/edit" className="btn btn-sm">
                  Edit profile
                </Link>
                <button className="btn btn-ghost btn-sm" onClick={() => setShareOpen(true)}>
                  Share
                </button>
              </>
            ) : (
              <>
                <button
                  className={'btn btn-sm ' + (following ? 'btn-ghost pf-btn-on' : '')}
                  disabled={!net || netBusy}
                  onClick={() => (following ? setConfirmUnnet(true) : toggleNetwork())}
                >
                  {following ? (
                    <>
                      <Icon name="check" size={16} /> Networking
                    </>
                  ) : (
                    <>
                      <Icon name="plus" size={16} /> Network
                    </>
                  )}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/chat/new?userId=${encodeURIComponent(userId)}`)}>
                  <Icon name="chat" size={16} /> Message
                </button>
                <button className="btn btn-sm pf-btn-hire" onClick={() => navigate(`/hire/request?proId=${encodeURIComponent(userId)}`)}>
                  <Icon name="jobs" size={16} /> Hire
                </button>
              </>
            )}
          </div>

          <div className="pf-id">
            <div className="pf-name-row">
              <h1 className="pf-name">{name}</h1>
              {p.hasVerifiedBadge && <VerifiedBadge tier={p.rankingBoostTier} size={20} />}
              {isOwn ? (
                <Link to="/profile/rating" className="pf-rating-link">
                  {ratingPill}
                </Link>
              ) : (
                ratingPill
              )}
            </div>
            {headline && <div className={'pf-headline' + (p.profession ? '' : ' muted')}>{headline}</div>}
            <div className="pf-meta">
              {location && (
                <span>
                  <Icon name="location" size={15} /> {location}
                </span>
              )}
              {site && (
                <a href={siteHref} target="_blank" rel="noreferrer noopener">
                  <LinkIcon /> {site.replace(/^https?:\/\//i, '').replace(/\/$/, '')}
                </a>
              )}
              {isOwn && p.email && (
                <span>
                  <MailIcon /> {p.email}
                </span>
              )}
            </div>
          </div>

          {p.bio ? (
            <div className="pf-bio">
              <div className={'pre' + (bioOpen || !bioLong ? '' : ' pf-bio-clamp')}>{p.bio}</div>
              {bioLong && (
                <button className="pf-link-btn" onClick={() => setBioOpen((x) => !x)}>
                  {bioOpen ? 'see less' : 'see more'}
                </button>
              )}
            </div>
          ) : isOwn ? (
            <Link to="/profile/edit" className="pf-bio pf-bio-empty">
              + Add a bio so people know what you do
            </Link>
          ) : null}

          {skills.length > 0 && (
            <div className="pf-skills">
              {skills.slice(0, 8).map((s) => (
                <span key={s} className="pf-skill">
                  {s}
                </span>
              ))}
              {skills.length > 8 && (
                <button className="pf-skill pf-skill-more" onClick={() => selectTab('about')}>
                  +{skills.length - 8}
                </button>
              )}
            </div>
          )}

          <div className="pf-stats">
            <Link to={isOwn ? '/profile/network?tab=network' : `/profile/network?tab=network&userId=${encodeURIComponent(userId)}&name=${encodeURIComponent(name)}`} className="pf-stat">
              <b>{net ? compactNumber(net.followerCount) : '–'}</b>
              <span>Network</span>
            </Link>
            <Link to={isOwn ? '/profile/network?tab=networking' : `/profile/network?tab=networking&userId=${encodeURIComponent(userId)}&name=${encodeURIComponent(name)}`} className="pf-stat">
              <b>{net ? compactNumber(net.followingCount) : '–'}</b>
              <span>Networking</span>
            </Link>
            <button className="pf-stat" onClick={() => selectTab('recommendations')}>
              <b>{recCountQ.data == null ? '–' : compactNumber(recCountQ.data)}</b>
              <span>Recommendations</span>
            </button>
            {isOwn && (
              <Link to="/profile/viewers" className="pf-stat">
                <b>{viewsQ.data == null ? '–' : compactNumber(viewsQ.data)}</b>
                <span>Profile views</span>
              </Link>
            )}
          </div>
        </div>
      </section>

      {isOwn && rating && (
        <Link to="/profile/rating" className="pf-vis-card">
          <div className="pf-vis-score">{rating.isNew ? 'New' : Number(rating.stars || 0).toFixed(1)}</div>
          <div className="grow">
            <div className="row" style={{ gap: 8 }}>
              {!rating.isNew && <Stars value={rating.stars} size={15} dim="rgba(255,255,255,0.25)" />}
              <span className="pf-vis-label">Your creator rating</span>
            </div>
            <div className="pf-vis-sub">
              Visibility: {rating.visibilityLabel}
              {rating.visibilityBoostPct > 0 ? ` · +${rating.visibilityBoostPct}% reach` : ''}
              {typeof rating.change7d === 'number' && rating.change7d !== 0 && (
                <span className={rating.change7d > 0 ? 'pf-up' : 'pf-down'}>
                  {' '}
                  · {rating.change7d > 0 ? '▲ +' : '▼ '}
                  {Math.abs(Number(rating.change7d) || 0).toFixed(1)} this week
                </span>
              )}
            </div>
          </div>
          <span className="pf-vis-cta">
            Details <Icon name="back" size={16} />
          </span>
        </Link>
      )}

      <div className="tabs pf-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : ''} onClick={() => selectTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'posts' && <PostsTab userId={userId} isOwn={isOwn} />}
      {tab === 'about' && <AboutTab p={p} isOwn={isOwn} skills={skills} />}
      {tab === 'recommendations' && (
        <RecommendationsTab isOwn={isOwn} userId={userId} name={name} hasGiven={hasGivenQ.data?.hasGiven} onRecommend={() => setRecOpen(true)} />
      )}
      {tab === 'reviews' && <ReviewsTab userId={userId} name={name} isOwn={isOwn} />}

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
      {!isOwn && (
        <RecommendationModal
          open={recOpen}
          onClose={() => {
            setRecOpen(false);
            invalidate(`recs:hasGiven:${userId}`);
          }}
          recipientUserId={userId}
          recipientName={name}
        />
      )}
    </div>
  );
}

function LinkIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
      <path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
    </svg>
  );
}
function MailIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 6h16v12H4zM4 7l8 6 8-6" />
    </svg>
  );
}

function ProfileSkeleton() {
  return (
    <div className="pf">
      <section className="pf-hero">
        <div className="pf-cover">
          <div className="pf-cover-art" />
        </div>
        <div className="pf-head">
          <div className="pf-avatar-wrap">
            <div className="pf-avatar-ring">
              <div className="pf-skel" style={{ width: 116, height: 116, borderRadius: '50%' }} />
            </div>
          </div>
          <div className="pf-id" style={{ marginTop: 56 }}>
            <div className="pf-skel" style={{ width: 220, height: 22 }} />
            <div className="pf-skel" style={{ width: 160, height: 14, marginTop: 10 }} />
            <div className="pf-skel" style={{ width: '80%', height: 12, marginTop: 18 }} />
            <div className="pf-skel" style={{ width: '60%', height: 12, marginTop: 8 }} />
          </div>
        </div>
      </section>
      <div className="pf-grid" style={{ marginTop: 16 }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="pf-tile pf-skel" />
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- posts */

type PostFilter = 'all' | 'media' | 'texts';

function PostsTab({ userId, isOwn }: { userId: string; isOwn: boolean }) {
  const [filter, setFilter] = useState<PostFilter>('all');
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

  const shown = useMemo(
    () => posts.filter((p) => (filter === 'all' ? true : filter === 'media' ? mediaOf(p).length > 0 : mediaOf(p).length === 0)),
    [posts, filter]
  );

  // Media/text posts may only show up on later pages: keep loading until we find some (same as the app).
  useEffect(() => {
    if (filter !== 'all' && !shown.length && list.hasMore && !list.loading && !list.error) list.loadMore();
  }, [filter, shown.length, list.hasMore, list.loading, list.error]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div className="chips pf-filter">
        {(
          [
            ['all', 'All Posts'],
            ['media', 'Photos & Videos'],
            ['texts', 'Feed'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} className={'chip' + (filter === id ? ' active' : '')} onClick={() => setFilter(id)}>
            {label}
          </button>
        ))}
      </div>
      {list.error && !posts.length ? (
        <div className="card center" style={{ padding: 28 }}>
          <div className="empty-title">Couldn't load posts</div>
          <div className="muted" style={{ marginBottom: 12 }}>
            Check your connection and try again.
          </div>
          <button className="btn btn-sm" onClick={list.reload}>
            Retry
          </button>
        </div>
      ) : !shown.length && !list.loading && !list.hasMore ? (
        <Empty title="No content yet">
          {filter === 'all' ? (isOwn ? 'Your posts will appear here.' : 'Nothing posted yet.') : filter === 'media' ? 'No photos to show.' : 'No texts to show.'}
        </Empty>
      ) : (
        <div className="pf-grid">
          {shown.map((p) => (
            <PostTile key={p.statusPostId} post={p} />
          ))}
          {list.loading && Array.from({ length: shown.length ? 3 : 6 }).map((_, i) => <div key={'s' + i} className="pf-tile pf-skel" />)}
        </div>
      )}
      <div ref={sentinel} style={{ height: 1 }} />
    </div>
  );
}

function PostTile({ post }: { post: Post }) {
  const media = mediaOf(post);
  const first = media[0];
  const likes = Array.isArray(post.likedArr) ? post.likedArr.length : 0;
  const comments = Array.isArray(post.commentArr) ? post.commentArr.length : 0;
  const tips = Number(post.totalCoins) || 0;
  const caption = (post.caption || '').trim();
  const [bad, setBad] = useState(false);
  const poster = first ? posterUri(first) : '';
  const video = first && isVideo(first);
  const vRef = useRef<HTMLVideoElement>(null);

  return (
    <Link to={`/post/${post.statusPostId}`} className={'pf-tile' + (first ? '' : ' pf-tile-text')} title={caption.slice(0, 120) || 'View post'}>
      {first ? (
        poster && !bad ? (
          <img src={poster} alt="" loading="lazy" onError={() => setBad(true)} />
        ) : video && videoUri(first) ? (
          <video ref={vRef} src={videoUri(first) + '#t=0.5'} muted playsInline preload="metadata" />
        ) : (
          <div className="pf-tile-ph">
            <Icon name={video ? 'play' : 'image'} size={26} />
          </div>
        )
      ) : (
        <div className="pf-tile-textbody">
          {post.poll?.question ? (
            <>
              <span className="pf-tile-kind">Poll</span>
              <span className="pf-tile-quote">{post.poll.question}</span>
            </>
          ) : (
            <span className="pf-tile-quote">{caption || '…'}</span>
          )}
        </div>
      )}
      <div className="pf-tile-icons">
        {video && <Icon name="play" size={16} />}
        {media.length > 1 && <MultiIcon />}
      </div>
      <div className="pf-tile-hover">
        <span>
          <Icon name="heart" size={16} fill /> {compactNumber(likes)}
        </span>
        <span>
          <Icon name="comment" size={16} fill /> {compactNumber(comments)}
        </span>
        {tips > 0 && (
          <span>
            <Icon name="coin" size={16} fill={false} /> {compactNumber(tips)}
          </span>
        )}
      </div>
    </Link>
  );
}

function MultiIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M7 3h12a2 2 0 0 1 2 2v12h-2V5H7zM3 7h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" />
    </svg>
  );
}

/* -------------------------------------------------------------------- about */

function AboutTab({ p, isOwn, skills }: { p: Profile; isOwn: boolean; skills: string[] }) {
  const rows: { label: string; value: React.ReactNode }[] = [];
  if (p.profession) rows.push({ label: 'Profession', value: p.profession });
  if (skills.length)
    rows.push({
      label: 'Skills',
      value: (
        <div className="pf-skills" style={{ margin: 0 }}>
          {skills.map((s) => (
            <span key={s} className="pf-skill">
              {s}
            </span>
          ))}
        </div>
      ),
    });
  if (p.address || p.country) rows.push({ label: 'Operating location', value: p.address || p.country });
  if (p.weblink)
    rows.push({
      label: 'Website',
      value: (
        <a href={/^https?:\/\//i.test(p.weblink) ? p.weblink : `https://${p.weblink}`} target="_blank" rel="noreferrer noopener">
          {p.weblink}
        </a>
      ),
    });
  if (isOwn && p.email) rows.push({ label: 'Email', value: p.email });
  if (p.userRole) rows.push({ label: 'Account type', value: p.userRole === 'freelancer' ? 'Professional' : 'Hiring' });
  const joined = toDate(p.createdTime);
  if (joined) rows.push({ label: 'Member since', value: fmtDate(p.createdTime, { month: 'long', year: 'numeric' }) });

  return (
    <div className="stack">
      <div className="card">
        <div className="pf-section-title">About</div>
        {p.bio ? <div className="pre pf-about-bio">{p.bio}</div> : <div className="muted">{isOwn ? 'You have not added a bio yet.' : 'No bio yet.'}</div>}
      </div>
      {rows.length > 0 && (
        <div className="card pf-about-list">
          {rows.map((r) => (
            <div key={r.label} className="pf-about-row">
              <div className="pf-about-label">{r.label}</div>
              <div className="pf-about-value">{r.value}</div>
            </div>
          ))}
        </div>
      )}
      {isOwn && (
        <Link to="/profile/edit" className="btn btn-ghost btn-block">
          Edit profile details
        </Link>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ reviews */

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
        <Empty title="No reviews yet">{isOwn ? 'Reviews from people you work with on i\'llTip jobs will show here.' : `${name} has no reviews yet. Reviews are left after a completed job.`}</Empty>
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

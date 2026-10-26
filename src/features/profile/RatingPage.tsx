import React, { useState } from 'react';
import { Icon, PageHeader, Spinner, toast } from '../../ui/kit';
import { invalidate, setQueryData, useQuery } from '../../lib/query';
import { useAuth } from '../../lib/auth';
import { fetchMyRating, type MyRating, type RatingComponent, type RatingLevel } from './api';
import { Stars } from './components';

const LEVEL: Record<RatingLevel, string> = { low: '#EF4444', medium: '#F59E0B', high: '#16A34A' };

const ICON: Record<RatingComponent['key'], string> = {
  tipping: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm0 4v10M9 9.5c0-1 1.3-1.7 3-1.7s3 .7 3 1.7-1.3 1.6-3 1.8-3 .8-3 1.8 1.3 1.8 3 1.8 3-.7 3-1.7',
  content: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4',
  engagement: 'M12 20s-7-4.4-9.2-8.6C1.4 8.6 3 5 6.5 5c2 0 3.4 1.2 5.5 3 2.1-1.8 3.5-3 5.5-3C21 5 22.6 8.6 21.2 11.4 19 15.6 12 20 12 20z',
  recommendations: 'M12 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 14.4l-4.8 2.5.9-5.4-3.9-3.8 5.4-.8zM8 16l-2 6 6-3 6 3-2-6',
  community: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm8 1a3 3 0 1 0 0-6M2 21c0-3.9 3.1-7 7-7s7 3.1 7 7M17 14c2.8 0 5 2.2 5 5',
  trust: 'M12 2l8 3v6c0 5-3.4 9.4-8 11-4.6-1.6-8-6-8-11V5z',
};

function levelText(c: RatingComponent) {
  if (c.key === 'trust') return c.clean ? 'Good: no spam' : c.level === 'low' ? 'Spam risk' : 'Needs attention';
  const l = c.level === 'high' ? 'High' : c.level === 'medium' ? 'Medium' : 'Low';
  return c.key === 'tipping' ? `${l} tipper` : l;
}
const pl = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function statLines(c: RatingComponent): string[] {
  const s = c.stats || {};
  switch (c.key) {
    case 'tipping': {
      const lines = [`${pl(s.tips ?? 0, 'tip', 'tips')} to ${pl(s.people ?? 0, 'person', 'people')} · ${pl(s.coins ?? 0, 'coin', 'coins')} (last 90 days)`];
      if ((s.tips ?? 0) >= 5 && (s.topShare ?? 0) > 60) lines.push(`${s.topShare}% of your coins went to one person. Tipping different people counts more.`);
      return lines;
    }
    case 'content':
      if (!s.posts) return ['No posts in the last 90 days yet.'];
      return [
        `${pl(s.posts, 'post', 'posts')} in 90 days`,
        `Per post: ${s.avgViews ?? 0} views · ${s.avgLikes ?? 0} likes · ${s.avgComments ?? 0} comments · ${s.avgSaves ?? 0} saves · ${s.avgTips ?? 0} tips`,
      ];
    case 'engagement':
      return [`${pl(s.likesGiven ?? 0, 'like', 'likes')} and ${pl(s.commentsGiven ?? 0, 'comment', 'comments')} given · active ${s.activeDays ?? 0} of the last 30 days`];
    case 'recommendations':
      return [`${pl(s.recommendations ?? 0, 'recommendation', 'recommendations')} from different people`];
    case 'community':
      return [`${pl(s.followers ?? 0, 'follower', 'followers')} · ${pl(s.referralsJoined ?? 0, 'referral', 'referrals')} joined, ${s.referralsCompleted ?? 0} subscribed`];
    default:
      return [];
  }
}

function Bar({ value, color }: { value: number; color: string }) {
  return (
    <div className="pf-bar">
      <div style={{ width: `${Math.max(2, Math.min(100, value))}%`, background: color }} />
    </div>
  );
}

export function RatingPage() {
  const { user } = useAuth();
  const q = useQuery('rating:me', () => fetchMyRating(false), { staleMs: 5 * 60_000 });
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try {
      const fresh = await fetchMyRating(true);
      setQueryData('rating:me', () => fresh);
      if (user?.id) invalidate(`profile:${user.id}`);
      toast.ok('Rating refreshed');
    } catch {
      toast.error('Could not refresh right now.');
    } finally {
      setRefreshing(false);
    }
  };
  const d: MyRating | undefined = q.data;

  return (
    <div className="pf">
      <PageHeader
        title="Your rating"
        back="/profile"
        right={
          <button className="btn btn-ghost btn-sm" onClick={refresh} disabled={refreshing || !d}>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        }
      />
      {q.loading && !d ? (
        <Spinner />
      ) : q.error || !d ? (
        <div className="card center" style={{ padding: 28 }}>
          <div style={{ marginBottom: 12 }}>Couldn’t load your rating.</div>
          <button className="btn btn-sm" onClick={() => q.refetch()}>
            Try again
          </button>
        </div>
      ) : (
        <div className="stack">
          <div className="pf-rating-hero">
            {d.isNew ? (
              <>
                <div className="pf-rating-big">New</div>
                <p>Your rating starts with your first activity: tip a creator, post, like or comment, or invite a friend. Until then your profile shows “New”.</p>
              </>
            ) : (
              <>
                <div className="pf-rating-big">{d.stars.toFixed(1)}</div>
                <Stars value={d.stars} size={26} dim="rgba(255,255,255,0.28)" />
                {typeof d.change7d === 'number' && d.change7d > 0 && <div className="pf-trend-up">▲ +{d.change7d.toFixed(1)} this week. Keep it up!</div>}
                {(d.slipping || (typeof d.change7d === 'number' && d.change7d < 0)) && (
                  <div className="pf-trend-down">
                    {typeof d.change7d === 'number' && d.change7d < 0 ? `▼ ${Math.abs(d.change7d).toFixed(1)} this week. ` : ''}
                    Your rating eases down when you’re less active. Tip, post, like or comment to keep your stars and your visibility.
                  </div>
                )}
              </>
            )}
            <div className="pf-vis-pill">
              <Icon name="eye" size={14} fill={false} /> Visibility: {d.visibilityLabel}
              {d.visibilityBoostPct > 0 ? ` · +${d.visibilityBoostPct}% reach` : ''}
            </div>
            <p>The higher your rating, the more your posts are shown on Home. Tipping counts the most.</p>
            {d.cappedByTrust && <div className="pf-trend-down">Your rating is held back by spam signals. See Trust below.</div>}
          </div>

          <div className="pf-rating-grid">
            {(d.components || []).map((c) => {
              const color = LEVEL[c.level] || LEVEL.medium;
              return (
                <div key={c.key} className="card pf-rc">
                  <div className="row between">
                    <div className="row" style={{ gap: 8 }}>
                      <span className="pf-rc-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d={ICON[c.key] || ICON.trust} />
                        </svg>
                      </span>
                      <b>{c.label}</b>
                    </div>
                    <span className="tiny muted">{c.weight}% of rating</span>
                  </div>
                  <div className="row between" style={{ margin: '10px 0 6px' }}>
                    <span className="small" style={{ color, fontWeight: 700 }}>
                      {levelText(c)}
                    </span>
                    <b>{c.score}%</b>
                  </div>
                  <Bar value={c.score} color={color} />
                  {statLines(c).map((l) => (
                    <div key={l} className="small pf-rc-stat">
                      {l}
                    </div>
                  ))}
                  {c.key === 'content' && c.qualities && (c.stats?.posts ?? 0) > 0 && (
                    <div className="pf-rc-q">
                      {(
                        [
                          ['Informative (saves)', c.qualities.informative],
                          ['Entertaining (views)', c.qualities.entertaining],
                          ['Engaging (comments, likes)', c.qualities.engaging],
                          ['Creative (tips received)', c.qualities.creative],
                        ] as const
                      ).map(([label, v]) => (
                        <div key={label} className="pf-rc-qrow">
                          <span className="tiny muted">{label}</span>
                          <Bar value={v} color="#5A99F4" />
                        </div>
                      ))}
                    </div>
                  )}
                  {c.key === 'trust' &&
                    (c.clean ? (
                      <div className="small pf-rc-stat" style={{ color: LEVEL.high }}>
                        No spam found in comments, chats, recommendations or tips. This raises your rating.
                      </div>
                    ) : (
                      (c.issues || []).map((i) => (
                        <div key={i.key} className="small pf-rc-stat" style={{ color: LEVEL.low }}>
                          ! {i.label} (−{i.points})
                        </div>
                      ))
                    ))}
                  {c.score < 100 && c.tip && (
                    <div className="pf-rc-tip">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flex: 'none', marginTop: 2 }}>
                        <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3z" />
                      </svg>
                      <span>{c.tip}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="muted small center">Only you can see this page. Others just see your stars on your profile. Updated daily.</p>
        </div>
      )}
    </div>
  );
}

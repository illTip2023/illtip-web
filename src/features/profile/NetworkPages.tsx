import React, { useMemo, useState } from 'react';
import { Empty, ErrorBox, Icon, PageHeader, Spinner, compactNumber, toast } from '../../ui/kit';
import { Link, navigate, useQueryParams } from '../../lib/router';
import { useAuth } from '../../lib/auth';
import { plansHref } from '../plans/api';
import { invalidate, useInfinite, useOnVisible, useQuery } from '../../lib/query';
import { fetchFollowersPage, fetchFollowingPage, fetchNetworkState, fetchViewersPage, followUser, PAGE_SIZE, rowName, rowSkill, unfollowUser, type UserRow } from './api';
import { ConfirmModal, SkeletonRows, UserListRow } from './components';
import { bump, useVersion } from './bus';

type NetTab = 'network' | 'networking';

/** Shared list with search + network toggles (ProfileViewersScreen in the app). */
function UserList({
  qkey,
  fetchPage,
  actionFor,
  emptyTitle,
  emptyText,
  onTotal,
  footer,
}: {
  qkey: string;
  fetchPage: (page: number) => Promise<{ items: UserRow[]; totalCount: number }>;
  actionFor: (row: UserRow, update: (patch: Partial<UserRow> | null) => void) => React.ReactNode;
  emptyTitle: string;
  emptyText?: string;
  onTotal?: (n: number) => void;
  footer?: (state: { count: number; hasMore: boolean; loading: boolean; total: number }) => React.ReactNode;
}) {
  const [search, setSearch] = useState('');
  const [total, setTotal] = useState(0);
  const list = useInfinite<UserRow>(qkey, async (page) => {
    const r = await fetchPage(page);
    if (page === 1) {
      setTotal(r.totalCount);
      onTotal?.(r.totalCount);
    }
    return { items: r.items, hasMore: r.items.length >= PAGE_SIZE };
  });
  const sentinel = useOnVisible(() => list.loadMore());
  const rows = useMemo(() => {
    const seen = new Set<string>();
    const q = search.trim().toLowerCase();
    return list.items.filter((r) => {
      const id = String(r.userId);
      if (seen.has(id)) return false;
      seen.add(id);
      if (!q) return true;
      return rowName(r).toLowerCase().includes(q) || rowSkill(r).toLowerCase().includes(q);
    });
  }, [list.items, search]);

  const update = (id: string) => (patch: Partial<UserRow> | null) =>
    list.setItems((items) => (patch === null ? items.filter((i) => String(i.userId) !== id) : items.map((i) => (String(i.userId) === id ? { ...i, ...patch } : i))));

  return (
    <div className="stack">
      {list.items.length > 6 && (
        <div className="pf-search">
          <Icon name="search" size={18} />
          <input className="input" placeholder="Search username or display name" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      )}
      <div className="card pf-list-card">
        {list.error && !list.items.length ? (
          <ErrorBox error={list.error} onRetry={list.reload} />
        ) : list.loading && !list.items.length ? (
          <SkeletonRows />
        ) : !rows.length && !list.loading ? (
          search ? <Empty title="No users found" /> : <Empty title={emptyTitle}>{emptyText}</Empty>
        ) : (
          rows.map((r) => <UserListRow key={r.userId} row={r} action={actionFor(r, update(String(r.userId)))} />)
        )}
        {list.loading && list.items.length > 0 && <Spinner />}
        <div ref={sentinel} />
      </div>
      {footer?.({ count: list.items.length, hasMore: list.hasMore, loading: list.loading, total })}
    </div>
  );
}

/** Network button logic shared by the lists. */
function useNetworkToggle() {
  const { user } = useAuth();
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<{ row: UserRow; run: () => void } | null>(null);

  const toggle = async (row: UserRow, update: (p: Partial<UserRow> | null) => void, opts: { removeOnUnfollow?: boolean } = {}) => {
    const id = String(row.userId);
    if (pending.has(id)) return;
    const was = row.isFollowing === true;
    const run = async () => {
      setPending((s) => new Set(s).add(id));
      update(was && opts.removeOnUnfollow ? null : { isFollowing: !was });
      try {
        await (was ? unfollowUser(id) : followUser(id));
        invalidate(`net:state:${id}`);
        if (user?.id) invalidate(`net:state:${user.id}`);
      } catch {
        update(was && opts.removeOnUnfollow ? null : { isFollowing: was });
        if (was && opts.removeOnUnfollow) bump('net');
        toast.error("Couldn't update your network. Please try again.");
      } finally {
        setPending((s) => {
          const n = new Set(s);
          n.delete(id);
          return n;
        });
      }
    };
    if (was) setConfirm({ row, run });
    else run();
  };

  const modal = (
    <ConfirmModal
      open={!!confirm}
      onClose={() => setConfirm(null)}
      title="Remove from network?"
      message={`Are you sure you want to remove ${confirm ? rowName(confirm.row) : ''} from your network?`}
      confirmLabel="Remove"
      danger
      onConfirm={() => confirm?.run()}
    />
  );
  return { toggle, pending, modal, myId: user?.id ?? '' };
}

/* ------------------------------------------------------------ /profile/network */

export function NetworkPage() {
  const qp = useQueryParams();
  const { user } = useAuth();
  const ownerId = qp.get('userId') || user?.id || '';
  const isOwnList = ownerId === user?.id;
  const ownerName = qp.get('name') || '';
  const tab: NetTab = qp.get('tab') === 'network' ? 'network' : 'networking';
  const ver = useVersion('net');
  const st = useQuery(ownerId ? `net:state:${ownerId}` : null, () => fetchNetworkState(ownerId));
  const { toggle, pending, modal, myId } = useNetworkToggle();

  const setTab = (t: NetTab) => {
    const p = new URLSearchParams(qp);
    p.set('tab', t);
    navigate(`/profile/network?${p.toString()}`, { replace: true });
  };

  const actionFor = (t: NetTab) => (row: UserRow, update: (p: Partial<UserRow> | null) => void) => {
    const id = String(row.userId);
    if (id === myId) return null;
    const busy = pending.has(id);
    const following = row.isFollowing === true;
    if (isOwnList && t === 'network' && following) {
      return (
        <button className="btn btn-ghost btn-sm pf-row-btn" onClick={() => navigate(`/chat/new?userId=${encodeURIComponent(id)}`)}>
          Message
        </button>
      );
    }
    if (isOwnList && t === 'networking') {
      return (
        <button className="btn btn-ghost btn-sm pf-row-btn pf-btn-on" disabled={busy} onClick={() => toggle(row, update, { removeOnUnfollow: true })}>
          Networking
        </button>
      );
    }
    return following ? (
      <button className="btn btn-ghost btn-sm pf-row-btn pf-btn-on" disabled={busy} onClick={() => toggle(row, update)}>
        Networking
      </button>
    ) : (
      <button className="btn btn-sm pf-row-btn" disabled={busy} onClick={() => toggle(row, update)}>
        {isOwnList ? 'Network Back' : 'Network With'}
      </button>
    );
  };

  const counts = st.data;
  const title = isOwnList ? 'Network' : ownerName || 'Network';

  return (
    <div className="pf">
      <PageHeader title={title} back={isOwnList ? '/profile' : `/u/${encodeURIComponent(ownerId)}`} sub={isOwnList ? 'People in your network' : undefined} />
      <div className="pf-seg pf-seg-wide" role="tablist">
        <button role="tab" className={tab === 'network' ? 'active' : ''} onClick={() => setTab('network')}>
          <b>{counts ? compactNumber(counts.followerCount) : '–'}</b> Network
        </button>
        <button role="tab" className={tab === 'networking' ? 'active' : ''} onClick={() => setTab('networking')}>
          <b>{counts ? compactNumber(counts.followingCount) : '–'}</b> Networking
        </button>
      </div>
      <p className="muted small pf-hint">
        {tab === 'network'
          ? isOwnList
            ? 'People who added you to their network. Network back to connect both ways.'
            : 'People who added this user to their network.'
          : isOwnList
            ? 'People you added to your network.'
            : 'People this user added to their network.'}
      </p>
      {tab === 'network' ? (
        <UserList
          key={`n-${ownerId}`}
          qkey={`netlist:followers:${ownerId}:v${ver}`}
          fetchPage={(p) => fetchFollowersPage(ownerId, p)}
          actionFor={actionFor('network')}
          emptyTitle="No one in this network yet"
          emptyText={isOwnList ? 'Share your profile so people can network with you.' : undefined}
        />
      ) : (
        <UserList
          key={`g-${ownerId}`}
          qkey={`netlist:following:${ownerId}:v${ver}`}
          fetchPage={(p) => fetchFollowingPage(ownerId, p)}
          actionFor={actionFor('networking')}
          emptyTitle="Not networking with anyone yet"
          emptyText={isOwnList ? 'Find pros on Hire Pros or the Home feed and tap Network on their profile.' : undefined}
        />
      )}
      {modal}
    </div>
  );
}

/* ------------------------------------------------------------ /profile/viewers */

export function ViewersPage() {
  const { user } = useAuth();
  const id = user?.id ?? '';
  const { toggle, pending, modal } = useNetworkToggle();

  return (
    <div className="pf">
      <PageHeader title="Profile Viewers" back="/profile" sub="People who recently looked at your profile" />
      <UserList
        qkey={`viewers:${id}`}
        fetchPage={(p) => fetchViewersPage(id, p)}
        emptyTitle="No profile views yet"
        emptyText="Post, comment and tip to get noticed. When people view your profile they show up here."
        actionFor={(row, update) => {
          const following = row.isFollowing === true;
          const busy = pending.has(String(row.userId));
          return following ? (
            <button className="btn btn-ghost btn-sm pf-row-btn pf-btn-on" disabled={busy} onClick={() => toggle(row, update)}>
              Networking
            </button>
          ) : (
            <button className="btn btn-sm pf-row-btn" disabled={busy} onClick={() => toggle(row, update)}>
              Network With
            </button>
          );
        }}
        footer={({ count, hasMore, loading, total }) =>
          !hasMore && !loading && total > count ? (
            <div className="card pf-upsell">
              <div className="pf-upsell-lock">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M7 10V7a5 5 0 0 1 10 0v3h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zm2 0h6V7a3 3 0 0 0-6 0z" />
                </svg>
              </div>
              <div className="grow">
                <div style={{ fontWeight: 700 }}>+{compactNumber(total - count)} more people viewed your profile</div>
                <div className="muted small">Upgrade your plan to see everyone who viewed you.</div>
              </div>
              <div className="row-wrap">
                {/* PaymentPlansScreen with initialPlanId 'career-access' in the app (ProfileViewersScreen goToUpgrade). */}
                <Link className="btn btn-sm" to={plansHref({ plan: 'career-1m', next: '/profile/viewers' })}>
                  See plans
                </Link>
              </div>
            </div>
          ) : null
        }
      />
      {modal}
    </div>
  );
}

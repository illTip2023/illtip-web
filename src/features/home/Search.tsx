import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, navigate, useQueryParams } from '../../lib/router';
import { useInfinite, useOnVisible } from '../../lib/query';
import { Avatar, Empty, ErrorBox, Icon, PageHeader } from '../../ui/kit';
import { fetchBrowse, PAGE_SIZE, personFromRaw, searchPeople, searchPosts, type Post } from './api';
import { PostCard, PostSkeleton } from './PostCard';
import { PostTile } from './PostTile';
import { loadSaved } from './store';
import { useAuth } from '../../lib/auth';
import { CardSkeleton, JobCard } from '../jobs/components';
import { fetchJobsPage, useMasterServices, useSavedJobIds, type Job, type JobFilters } from '../jobs/lib';

type Tab = 'people' | 'posts' | 'jobs';
const PLACEHOLDER: Record<Tab, string> = { people: 'Search people…', posts: 'Search posts or #hashtags', jobs: 'Search jobs…' };
const PEOPLE_SERVER_PAGE = 100; // /user/people returns pageSize x 10 rows per page

function dedupePosts(list: Post[]) {
  const seen = new Set<number>();
  return list.filter((p) => {
    const id = Number(p?.statusPostId);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function SearchScreen() {
  const qp = useQueryParams();
  const urlQ = qp.get('q') || '';
  const urlTab = qp.get('tab');
  const [query, setQuery] = useState(urlQ);
  const [debounced, setDebounced] = useState(urlQ.trim());
  const [tab, setTab] = useState<Tab>(urlTab === 'jobs' ? 'jobs' : urlTab === 'posts' || urlQ.trim().startsWith('#') ? 'posts' : 'people');
  const [jobCat, setJobCat] = useState<number | null>(null);
  const { user } = useAuth();
  const written = useRef<string | null>(null);

  useEffect(() => {
    void loadSaved();
  }, []);

  // external navigation (e.g. a #hashtag link) updates the box
  useEffect(() => {
    if (urlQ === written.current) return;
    setQuery(urlQ);
    setDebounced(urlQ.trim());
    if (urlQ.trim().startsWith('#')) setTab('posts');
  }, [urlQ]);
  useEffect(() => {
    if (urlTab === 'jobs' || urlTab === 'posts') setTab(urlTab);
  }, [urlTab]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const sp = new URLSearchParams();
    if (debounced) sp.set('q', debounced);
    if (tab !== 'people') sp.set('tab', tab);
    written.current = debounced;
    const s = sp.toString();
    navigate('/search' + (s ? '?' + s : ''), { replace: true });
  }, [debounced, tab]);

  /* people (GET /user/people) */
  const lastPeopleKey = useRef('');
  const people = useInfinite(tab === 'people' ? `home:people:${debounced}` : null, async (p) => {
    const rows = await searchPeople(debounced, p);
    const firstKey = String(rows[0]?.userId ?? rows[0]?._id ?? '');
    const repeat = p > 1 && firstKey && firstKey === lastPeopleKey.current;
    lastPeopleKey.current = firstKey;
    return { items: repeat ? [] : rows, hasMore: !repeat && rows.length >= PEOPLE_SERVER_PAGE };
  });
  const peopleRows = useMemo(() => {
    const seen = new Set<string>();
    const ql = debounced.toLowerCase();
    return people.items
      .map(personFromRaw)
      .filter((u) => {
        if (!u.userId || seen.has(u.userId.toLowerCase())) return false;
        seen.add(u.userId.toLowerCase());
        return !ql || `${u.name} ${u.profession || ''}`.toLowerCase().includes(ql);
      });
  }, [people.items, debounced]);

  /* posts: browse grid (GET /post) when empty, else GET /post/search */
  const searching = debounced.length > 0;
  const browse = useInfinite(tab === 'posts' && !searching ? 'home:browse' : null, async (p) => {
    const items = await fetchBrowse(p);
    return { items, hasMore: items.length >= PAGE_SIZE };
  });
  const results = useInfinite(tab === 'posts' && searching ? `home:search:${debounced}` : null, async (p) => {
    const items = await searchPosts(debounced, p);
    return { items, hasMore: items.length >= PAGE_SIZE };
  });
  const browsePosts = useMemo(() => dedupePosts(browse.items), [browse.items]);
  const resultPosts = useMemo(() => dedupePosts(results.items), [results.items]);

  /* jobs: GET /service/v2/fetchOtherServiceRequestList (app HomeSearchScreen Jobs tab → fetchOtherServiceRequests),
     same fetch + card as the Jobs page; the query goes to the server's `search` like the Jobs page. */
  const services = useMasterServices();
  const savedJobs = useSavedJobIds();
  const jobFilters: JobFilters = { q: debounced, serviceId: jobCat, status: 'all', workMode: 'all', datePosted: 'allJobs', address: '', near: null };
  const jobs = useInfinite<Job>(tab === 'jobs' && !services.loading ? `home:jobs:${user?.id}:${debounced}:${debounced ? '' : jobCat ?? ''}` : null, (p) =>
    fetchJobsPage(jobFilters, p, user?.id, services.data),
  );

  const active = tab === 'people' ? people : tab === 'jobs' ? jobs : searching ? results : browse;
  const sentinel = useOnVisible(() => !active.error && active.loadMore());

  return (
    <div className="hp-page">
      <PageHeader title="Search" back="/" />
      <div className="hp-search-box">
        <Icon name="search" size={20} />
        <input
          autoFocus
          className="hp-search-input"
          type="search"
          placeholder={PLACEHOLDER[tab]}
          aria-label={PLACEHOLDER[tab].replace('…', '')}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (tab !== 'jobs' && e.target.value.trim().startsWith('#')) setTab('posts');
          }}
        />
        {query && (
          <button className="icon-btn" aria-label="Clear search" onClick={() => setQuery('')}>
            <Icon name="close" size={18} />
          </button>
        )}
      </div>

      <div className="tabs">
        <button className={tab === 'people' ? 'active' : ''} onClick={() => setTab('people')}>
          Users
        </button>
        <button className={tab === 'posts' ? 'active' : ''} onClick={() => setTab('posts')}>
          Posts
        </button>
        <button className={tab === 'jobs' ? 'active' : ''} onClick={() => setTab('jobs')}>
          Jobs
        </button>
      </div>

      {tab === 'jobs' && (
        <>
          {(services.data || []).length > 0 && (
            <div className="chips jb-cats hs-job-cats" role="tablist" aria-label="Categories">
              <button role="tab" aria-selected={jobCat == null} className={'chip' + (jobCat == null ? ' active' : '')} onClick={() => setJobCat(null)}>
                All
              </button>
              {(services.data || []).map((c) => (
                <button key={c.serviceId} role="tab" aria-selected={jobCat === c.serviceId} className={'chip' + (jobCat === c.serviceId ? ' active' : '')} onClick={() => setJobCat(c.serviceId)}>
                  {c.service}
                </button>
              ))}
            </div>
          )}
          {(jobs.loading || services.loading) && !jobs.items.length ? (
            <CardSkeleton count={4} />
          ) : (
            jobs.items.length > 0 && (
              <div className="jb-list hs-jobs">
                {jobs.items.map((j) => (
                  <JobCard key={j.id} job={j} saved={savedJobs.has(j.id)} onToggleSave={() => savedJobs.toggle(j)} />
                ))}
              </div>
            )
          )}
          {!jobs.loading && !services.loading && !jobs.error && !jobs.items.length && <Empty title="No jobs found">{debounced ? `No jobs match "${debounced}".` : 'Try a different search or category.'}</Empty>}
        </>
      )}

      {tab === 'people' && (
        <>
          {peopleRows.length > 0 && (
            <div className="hs-people">
              {peopleRows.map((u) => (
                <Link key={u.userId} to={`/u/${encodeURIComponent(u.userId)}`} className="hs-person">
                  <Avatar src={u.avatar} name={u.name} size={46} />
                  <div className="grow">
                    <div className="row" style={{ gap: 6 }}>
                      <span className="hp-name ellipsis">{u.name}</span>
                      {u.verified && (
                        <span className="hp-verified" title="Subscriber badge">
                          <Icon name="check" size={10} />
                        </span>
                      )}
                    </div>
                    {u.profession && <div className="muted small ellipsis">{u.profession}</div>}
                  </div>
                  <span className="hp-chev">
                    <Icon name="back" size={18} />
                  </span>
                </Link>
              ))}
            </div>
          )}
          {!people.loading && !people.error && !peopleRows.length && <Empty title="No people found">{debounced ? `Nobody matches "${debounced}".` : 'Try searching by name or profession.'}</Empty>}
        </>
      )}

      {tab === 'posts' && !searching && (
        <>
          {browsePosts.length > 0 && (
            <div className="hp-grid">
              {browsePosts.map((p) => (
                <PostTile key={p.statusPostId} post={p} />
              ))}
            </div>
          )}
          {!browse.loading && !browse.error && !browsePosts.length && <Empty title="No posts found" />}
        </>
      )}

      {tab === 'posts' && searching && (
        <>
          <div className="hp-list">
            {results.loading && !resultPosts.length && [0, 1].map((i) => <PostSkeleton key={i} />)}
            {resultPosts.map((p) => (
              <PostCard key={p.statusPostId} post={p} />
            ))}
          </div>
          {!results.loading && !results.error && !resultPosts.length && <Empty title="No posts found">{`No posts found for ${debounced}`}</Empty>}
        </>
      )}

      {active.error && <ErrorBox error={active.error} onRetry={active.items.length ? active.loadMore : active.reload} />}
      <div ref={sentinel} style={{ height: 1 }} />
      {active.loading && !(tab === 'posts' && searching && !resultPosts.length) && !(tab === 'jobs' && !jobs.items.length) && (
        <div className="center" style={{ padding: 20 }}>
          <div className="spinner" />
        </div>
      )}
      {!active.loading && !active.error && active.hasMore && active.items.length > 0 && (
        <div className="center" style={{ padding: 16 }}>
          <button className="btn btn-ghost" onClick={active.loadMore}>
            Load more
          </button>
        </div>
      )}
    </div>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { useInfinite, useOnVisible } from '../../lib/query';
import { Link, navigate, useQueryParams } from '../../lib/router';
import { ErrorBox, Modal, toast } from '../../ui/kit';
import { CardSkeleton, JIcon, JobCard, JobsNav, Switch } from './components';
import { fetchJobsPage, getDeviceLocation, Job, JobFilters, reverseGeocode, useMasterServices, useSavedJobIds } from './lib';

const STATUS_OPTIONS: { value: JobFilters['status']; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'applied', label: 'Applied' },
];
const MODE_OPTIONS: { value: JobFilters['workMode']; label: string }[] = [
  { value: 'all', label: 'Any' },
  { value: 'remote', label: 'Remote' },
  { value: 'onsite', label: 'On-site' },
  { value: 'hybrid', label: 'Hybrid' },
];
const DATE_OPTIONS: { value: JobFilters['datePosted']; label: string }[] = [
  { value: 'allJobs', label: 'All jobs' },
  { value: 'last24Hours', label: 'Last 24 hours' },
  { value: 'last3days', label: 'Last 3 days' },
  { value: 'last7days', label: 'Last 7 days' },
  { value: 'last14days', label: 'Last 14 days' },
];

/** Near-me coordinates live for the session (not in the URL). */
let nearCoords: { latitude: number; longitude: number } | null = null;
let nearLabel = '';

type UrlFilters = Omit<JobFilters, 'near'> & { nearMe: boolean };

function readFilters(qp: URLSearchParams): UrlFilters {
  const cat = qp.get('cat');
  const st = qp.get('status') as JobFilters['status'];
  const mode = qp.get('mode') as JobFilters['workMode'];
  const date = qp.get('date') as JobFilters['datePosted'];
  return {
    q: qp.get('q') || '',
    serviceId: cat && Number.isFinite(Number(cat)) ? Number(cat) : null,
    status: STATUS_OPTIONS.some((o) => o.value === st) ? st : 'all',
    workMode: MODE_OPTIONS.some((o) => o.value === mode) ? mode : 'all',
    datePosted: DATE_OPTIONS.some((o) => o.value === date) ? date : 'allJobs',
    address: qp.get('loc') || '',
    nearMe: qp.get('near') === '1',
  };
}

function writeFilters(f: UrlFilters) {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.serviceId != null) p.set('cat', String(f.serviceId));
  if (f.status !== 'all') p.set('status', f.status);
  if (f.workMode !== 'all') p.set('mode', f.workMode);
  if (f.datePosted !== 'allJobs') p.set('date', f.datePosted);
  if (f.address.trim()) p.set('loc', f.address.trim());
  if (f.nearMe) p.set('near', '1');
  const s = p.toString();
  navigate('/jobs' + (s ? '?' + s : ''), { replace: true });
}

function emptyMessage(f: UrlFilters, activeCount: number) {
  if (f.q.trim()) return 'No jobs match your search.';
  if (activeCount > 0) return 'No jobs match your filters.';
  if (f.serviceId != null) return 'No jobs in this category.';
  if (f.nearMe) return 'No jobs within 30 miles of you.';
  if (f.address.trim()) return 'No jobs in this location.';
  return 'No jobs to show right now.';
}

function FilterGroup<T extends string>({ title, options, value, onChange }: { title: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <fieldset className="jb-fgroup">
      <legend>{title}</legend>
      <div className="jb-fopts">
        {options.map((o) => (
          <button key={o.value} type="button" className={'jb-fopt' + (value === o.value ? ' active' : '')} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function FiltersPanel({ f, set, onNearToggle, nearBusy }: { f: UrlFilters; set: (p: Partial<UrlFilters>) => void; onNearToggle: (v: boolean) => void; nearBusy: boolean }) {
  return (
    <div className="jb-fpanel">
      <Switch id="jb-near" checked={f.nearMe} onChange={onNearToggle} label={<>Just show jobs near me (30 miles){nearBusy ? '…' : ''}</>} />
      {f.nearMe && nearLabel && (
        <div className="tiny muted" style={{ marginTop: -4, marginBottom: 8 }}>
          Near {nearLabel}
        </div>
      )}
      <FilterGroup title="Status" options={STATUS_OPTIONS} value={f.status} onChange={(v) => set({ status: v })} />
      <FilterGroup title="Work location" options={MODE_OPTIONS} value={f.workMode} onChange={(v) => set({ workMode: v })} />
      <FilterGroup title="Date posted" options={DATE_OPTIONS} value={f.datePosted} onChange={(v) => set({ datePosted: v })} />
    </div>
  );
}

export function JobListPage() {
  const { user } = useAuth();
  const qp = useQueryParams();
  const f = useMemo(() => readFilters(qp), [qp]);
  const services = useMasterServices();
  const saved = useSavedJobIds();
  const [qInput, setQInput] = useState(f.q);
  const [locInput, setLocInput] = useState(f.address);
  const [sheet, setSheet] = useState(false);
  const [draft, setDraft] = useState<UrlFilters>(f);
  const [nearBusy, setNearBusy] = useState(false);
  const [near, setNear] = useState(nearCoords);

  useEffect(() => setQInput((cur) => (cur.trim() === f.q.trim() ? cur : f.q)), [f.q]);
  useEffect(() => setLocInput(f.address), [f.address]);

  // Debounced search (400ms, like the app)
  useEffect(() => {
    if (qInput.trim() === f.q.trim()) return;
    const t = setTimeout(() => writeFilters({ ...f, q: qInput }), 400);
    return () => clearTimeout(t);
  }, [qInput]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (p: Partial<UrlFilters>) => writeFilters({ ...f, ...p });

  const enableNear = async (on: boolean, apply: (p: Partial<UrlFilters>) => void) => {
    if (!on) return apply({ nearMe: false });
    if (nearCoords) return apply({ nearMe: true });
    setNearBusy(true);
    try {
      nearCoords = await getDeviceLocation();
      setNear(nearCoords);
      apply({ nearMe: true, address: '' });
      reverseGeocode(nearCoords.latitude, nearCoords.longitude).then((l) => {
        nearLabel = l;
        setNear({ ...nearCoords! });
      });
    } catch (e: any) {
      toast.error(e?.message || 'Could not get your location.');
    } finally {
      setNearBusy(false);
    }
  };

  // Near-me requested by URL but no coordinates yet (e.g. after reload)
  useEffect(() => {
    if (f.nearMe && !nearCoords && !nearBusy) enableNear(true, () => undefined);
  }, [f.nearMe]); // eslint-disable-line react-hooks/exhaustive-deps

  const apiFilters: JobFilters = { ...f, near: f.nearMe ? near : null };
  const waitingNear = f.nearMe && !near;
  const key = waitingNear || services.loading ? null : 'jobs:feed:' + JSON.stringify({ u: user?.id, ...apiFilters });
  const list = useInfinite<Job>(key, (page) => fetchJobsPage(apiFilters, page, user?.id, services.data));
  const sentinel = useOnVisible(() => list.loadMore());

  const activeCount = (f.status !== 'all' ? 1 : 0) + (f.workMode !== 'all' ? 1 : 0) + (f.datePosted !== 'allJobs' ? 1 : 0);
  const cats = services.data || [];
  const selectedCat = cats.find((c) => c.serviceId === f.serviceId);
  const showingSkeleton = (list.loading && list.items.length === 0) || !key;

  return (
    <div className="jb-wide jb-page">
      <header className="jb-hero">
        <div>
          <h1>Jobs</h1>
          <p className="muted">Find work near you or remote, apply in a few clicks.</p>
          <p className="small" style={{ marginTop: 4 }}>
            <a href="https://jobs.illtip.com/">Browse all open jobs on jobs.illtip.com →</a>
          </p>
        </div>
        <Link to="/hire/request" className="btn jb-hero-btn">
          <Icon16 name="plus" /> Post a job
        </Link>
      </header>

      <JobsNav active="browse" savedCount={saved.ids.size} />

      <div className="jb-layout">
        <aside className="jb-sidebar" aria-label="Filters">
          <div className="jb-side-card">
            <div className="between row" style={{ marginBottom: 6 }}>
              <h2 className="jb-side-title">Filters</h2>
              {(activeCount > 0 || f.nearMe) && (
                <button className="jb-link-btn" onClick={() => set({ status: 'all', workMode: 'all', datePosted: 'allJobs', nearMe: false })}>
                  Reset
                </button>
              )}
            </div>
            <FiltersPanel f={f} set={set} nearBusy={nearBusy} onNearToggle={(v) => enableNear(v, set)} />
          </div>
          <div className="jb-side-card jb-side-cta">
            <div className="jb-side-cta-icon">
              <JIcon name="users" size={22} />
            </div>
            <div className="grow">
              <div style={{ fontWeight: 700 }}>Need help with a project?</div>
              <div className="small muted">Post a job and hire trusted pros.</div>
            </div>
            <Link to="/hire" className="btn btn-sm">
              Hire Pros
            </Link>
          </div>
        </aside>

        <section className="jb-main" aria-label="Job results">
          <form
            className="jb-searchbar"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              writeFilters({ ...f, q: qInput, address: f.nearMe ? '' : locInput });
            }}
          >
            <div className="jb-search-field">
              <JIcon name="search" size={18} />
              <input className="jb-search-input" placeholder="Search for a job ..." value={qInput} onChange={(e) => setQInput(e.target.value)} aria-label="Search jobs" />
              {qInput && (
                <button type="button" className="jb-clear" aria-label="Clear search" onClick={() => (setQInput(''), set({ q: '' }))}>
                  <JIcon name="close" size={14} />
                </button>
              )}
            </div>
            <div className="jb-search-field jb-search-loc">
              <JIcon name="pin" size={18} />
              <input
                className="jb-search-input"
                placeholder={f.nearMe ? 'Within 30 miles of you' : 'City, state or country'}
                value={f.nearMe ? '' : locInput}
                disabled={f.nearMe}
                onChange={(e) => setLocInput(e.target.value)}
                onBlur={() => locInput.trim() !== f.address.trim() && set({ address: locInput })}
                aria-label="Location"
              />
            </div>
            <button type="submit" className="btn jb-search-btn">
              Search
            </button>
            <button
              type="button"
              className="jb-filter-btn"
              aria-label="Open job filters"
              onClick={() => {
                setDraft(f);
                setSheet(true);
              }}
            >
              <JIcon name="filter" size={18} />
              {activeCount + (f.nearMe ? 1 : 0) > 0 && <span className="jb-badge">{activeCount + (f.nearMe ? 1 : 0)}</span>}
            </button>
          </form>

          <div className="chips jb-cats" role="tablist" aria-label="Categories">
            <button role="tab" aria-selected={f.serviceId == null} className={'chip' + (f.serviceId == null ? ' active' : '')} onClick={() => set({ serviceId: null })}>
              All
            </button>
            {cats.map((c) => (
              <button key={c.serviceId} role="tab" aria-selected={f.serviceId === c.serviceId} className={'chip' + (f.serviceId === c.serviceId ? ' active' : '')} onClick={() => set({ serviceId: c.serviceId })}>
                {c.service}
              </button>
            ))}
          </div>

          <div className="jb-results-head">
            <div className="small muted">
              {f.q.trim() ? (
                <>
                  Results for <b className="jb-strong">“{f.q.trim()}”</b>
                  {selectedCat ? ' in all categories' : ''}
                </>
              ) : selectedCat ? (
                <>
                  Showing <b className="jb-strong">{selectedCat.service}</b> jobs
                </>
              ) : (
                'Latest jobs'
              )}
              {f.nearMe ? ' · within 30 miles' : f.address ? ` · ${f.address}` : ''}
            </div>
          </div>

          {list.error && list.items.length === 0 ? (
            <ErrorBox error={{ message: 'Could not load jobs. Please try again.' }} onRetry={list.reload} />
          ) : showingSkeleton ? (
            <CardSkeleton count={5} />
          ) : list.items.length === 0 ? (
            <div className="jb-empty">
              <div className="jb-empty-icon">
                <JIcon name="search" size={26} />
              </div>
              <div className="empty-title">{emptyMessage(f, activeCount)}</div>
              <div className="muted small">Try a different search, category or location.</div>
              {(f.q || f.serviceId != null || activeCount > 0 || f.address || f.nearMe) && (
                <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => navigate('/jobs', { replace: true })}>
                  Clear all
                </button>
              )}
            </div>
          ) : (
            <div className="jb-list">
              {list.items.map((j) => (
                <JobCard key={j.id} job={j} saved={saved.has(j.id)} onToggleSave={() => saved.toggle(j)} />
              ))}
            </div>
          )}
          <div ref={sentinel} />
          {list.loading && list.items.length > 0 && <CardSkeleton count={2} />}
          {!list.error && !list.loading && list.hasMore && list.items.length > 0 && (
            <div className="center" style={{ padding: 12 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => list.loadMore()}>
                Show more jobs
              </button>
            </div>
          )}
          {list.error && list.items.length > 0 && (
            <div className="center" style={{ padding: 12 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => list.loadMore()}>
                Load more
              </button>
            </div>
          )}
          {!list.hasMore && list.items.length > 5 && <div className="center tiny muted" style={{ padding: 16 }}>You’ve reached the end.</div>}
        </section>
      </div>

      <Modal open={sheet} onClose={() => setSheet(false)} title="Filters">
        <FiltersPanel f={draft} set={(p) => setDraft((d) => ({ ...d, ...p }))} nearBusy={nearBusy} onNearToggle={(v) => enableNear(v, (p) => setDraft((d) => ({ ...d, ...p })))} />
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn btn-ghost" onClick={() => setDraft({ ...draft, status: 'all', workMode: 'all', datePosted: 'allJobs', nearMe: false })}>
            Reset
          </button>
          <button
            className="btn grow"
            onClick={() => {
              setSheet(false);
              writeFilters({ ...draft, q: f.q, serviceId: f.serviceId, address: draft.nearMe ? '' : f.address });
            }}
          >
            Update
          </button>
        </div>
      </Modal>
    </div>
  );
}

function Icon16({ name }: { name: string }) {
  return <JIcon name={name} size={16} />;
}

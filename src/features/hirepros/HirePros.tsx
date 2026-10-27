import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { invalidate, useInfinite, useOnVisible } from '../../lib/query';
import { Link, navigate, useQueryParams } from '../../lib/router';
import { toast } from '../../ui/kit';
import { ConfirmModal, JIcon } from '../jobs/components';
import { deleteJob, fetchMyJobsPage, STATUS_LABEL, str, useMasterServices, type MasterService, type MyJob } from '../jobs/lib';

/*
 * Mirrors the app's Hire Pros tab (illtip-mobile src/ui/screens/HireProsScreen.tsx):
 * navy header ("Request a Service" + collapsible SearchBar + CategoryTabs), then a white sheet with
 * either the 3-column SkillCard grid (tap → request form) or, when the user already posted requests
 * in that tab, the "Service Request History" list (HistoryCard) with a "+" FAB to post a new one.
 */

type SkillItem = { skillId: number; skill: string; imageUrl?: string; serviceId: number; service: string };

/** utils/roleOnboardingNavigationSelection.ts normalizeCatalogLabel */
function norm(v: unknown) {
  return String(v ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** utils/isSmartMatch.ts */
function isSmartMatch(target: string, search: string) {
  if (!search) return true;
  const s = search.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  const t = target.toLowerCase().split(/\s+/);
  return s.every((a) => t.some((b) => b.startsWith(a) || a.startsWith(b.slice(0, 4))));
}

/** historyItemMatchesHireProsTab + serviceSlice findCategoryForItem (catalog lookup by skillId). */
function jobMatchesTab(j: MyJob, cat: MasterService, all: MasterService[]) {
  const tab = norm(cat.service);
  if (norm(j.category) === tab || norm(j.title) === tab) return true;
  const sid = Number(j.raw?.serviceDetails?.serviceId);
  if (Number.isFinite(sid) && j.raw?.serviceDetails?.serviceId != null) return sid === cat.serviceId;
  const kid = str(j.raw?.skillTypeDetails?.skillId ?? j.raw?.skillId);
  if (!kid) return false;
  const owners = all.filter((c) => c.skills.some((k) => String(k.skillId) === kid));
  return owners.length === 1 && owners[0].serviceId === cat.serviceId;
}

/** HireProsScreen renderServiceItem: "Oct 27, 2026, 11:24 AM" */
function neededBy(raw: any): string {
  let t = Number(raw?.workTime ?? raw?.updatedTime);
  if (!Number.isFinite(t) || t <= 0) {
    const d = Date.parse(String(raw?.workTime ?? raw?.date ?? ''));
    if (!Number.isFinite(d)) return 'No Date';
    t = d;
  }
  if (String(Math.trunc(t)).length === 10) t *= 1000;
  const d = new Date(t);
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}, ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
}

function TileImg({ src, alt }: { src?: string; alt: string }) {
  const [bad, setBad] = useState(false);
  useEffect(() => setBad(false), [src]);
  if (src && !bad) return <img src={src} alt={alt} loading="lazy" onError={() => setBad(true)} />;
  return (
    <span className="hr-img-fallback" aria-hidden>
      <JIcon name="briefcase" size={30} />
    </span>
  );
}

function SearchGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5 20 20" />
    </svg>
  );
}
function BackGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </svg>
  );
}
function CloseGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}
function NoResultArt() {
  return (
    <svg width="96" height="96" viewBox="0 0 96 96" aria-hidden>
      <circle cx="48" cy="48" r="44" fill="var(--hr-noresult-bg)" />
      <circle cx="43" cy="42" r="17" fill="none" stroke="var(--hr-noresult-ink)" strokeWidth="5" />
      <path d="M55.5 54.5 68 67" stroke="var(--hr-noresult-ink)" strokeWidth="6" strokeLinecap="round" />
      <path d="M36 42h14" stroke="var(--hr-noresult-ink)" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

/** organisms/HistoryCard.tsx */
function HistoryCard({ job, onDelete }: { job: MyJob; onDelete: () => void }) {
  const status = job.status === 'bill_generated' || job.status === 'closed' ? job.status : job.hiredCount > 0 ? 'work_in_progress' : job.status;
  const label = STATUS_LABEL[status];
  return (
    <div className="hr-hcard">
      <Link to={`/jobs/mine/${encodeURIComponent(job.id)}`} className="hr-hcard-body">
        <span className="hr-hcard-img">
          <TileImg src={job.image} alt="" />
        </span>
        <span className="hr-hcard-info">
          <span className="hr-hcard-title">{job.title || 'No Title'}</span>
          <span className="hr-hcard-row">
            <JIcon name="pin" size={18} />
            <span>{job.location}</span>
          </span>
          <span className="hr-hcard-row">
            <JIcon name="money" size={18} />
            <span>
              {job.payText ? (
                <>
                  <b className="hr-paytxt">{job.payText}</b> pay range
                </>
              ) : (
                'Pay range not specified'
              )}
            </span>
          </span>
          <span className="hr-hcard-row">
            <JIcon name="calendar" size={18} />
            <span>Service needed by {neededBy(job.raw)}</span>
          </span>
        </span>
      </Link>
      <button type="button" className="hr-hcard-del" onClick={onDelete} aria-label={`Delete ${job.title}`} title="Delete">
        <JIcon name="trash" size={16} />
      </button>
      <div className="hr-hcard-foot">
        <span className="hr-applicants">
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
            <circle cx="12" cy="7" r="4" fill="currentColor" />
            <path d="M4 21c0-4.418 3.582-8 8-8s8 3.582 8 8" fill="currentColor" />
          </svg>
          <span>
            <b>{job.applicantCount}</b> {job.applicantCount === 1 ? 'applicant' : 'applicants'}
          </span>
        </span>
        {label && (
          <span className={'hr-status hr-status-' + status}>
            <i />
            {label}
          </span>
        )}
      </div>
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="hr-grid" aria-busy="true" aria-label="Loading services">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="hr-skill jb-skel">
          <span className="hr-skill-img jb-shimmer" />
          <span className="jb-shimmer" style={{ height: 10, width: '70%', borderRadius: 5, margin: '2px auto 0' }} />
        </div>
      ))}
    </div>
  );
}

export function HireProsPage() {
  const { user } = useAuth();
  const qp = useQueryParams();
  const services = useMasterServices();
  const cats = services.data || [];
  const catId = qp.get('cat') ? Number(qp.get('cat')) : null;
  const cat = cats.find((c) => c.serviceId === catId) || null;
  const activeTab = cat ? cat.service : 'All';

  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [addingNew, setAddingNew] = useState(false);
  const [toDelete, setToDelete] = useState<MyJob | null>(null);
  const [deleting, setDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);

  // GET /service/v2/fetchServiceRequestList (serviceSlice fetchServiceHistory) — same list as /jobs/mine
  const history = useInfinite<MyJob>(services.loading ? null : 'jobs:mine:' + user?.id, (p) => fetchMyJobsPage(p, services.data));
  const [historyStarted, setHistoryStarted] = useState(false);
  useEffect(() => {
    if (history.loading) setHistoryStarted(true);
  }, [history.loading]);
  const historyReady = !services.loading && (history.items.length > 0 || !!history.error || (historyStarted && !history.loading));

  // Changing tab resets "add new" and the search text (HireProsScreen: useEffect on activeTab)
  useEffect(() => {
    setAddingNew(false);
    setSearch('');
  }, [activeTab]);

  // Keep the selected tab in view
  useEffect(() => {
    const el = tabsRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeTab, cats.length]);

  const setTab = (id: number | null) => {
    navigate('/hire' + (id != null ? `?cat=${id}` : ''), { replace: true });
  };

  const tabHistory = useMemo(() => (cat ? history.items.filter((j) => jobMatchesTab(j, cat, cats)) : history.items), [history.items, cat, cats]);
  const showHistory = tabHistory.length > 0 && !addingNew;
  // Infinite scroll for the history list (FlatList onEndReached → fetchServiceHistory next page)
  const sentinel = useOnVisible(() => {
    if (showHistory && !search) history.loadMore();
  });

  const skills: SkillItem[] = useMemo(() => {
    const src = cat ? [cat] : cats;
    return src.flatMap((c) => c.skills.map((k) => ({ ...k, serviceId: c.serviceId, service: c.service })));
  }, [cat, cats]);

  const shownSkills = useMemo(() => skills.filter((k) => isSmartMatch(k.skill, search)), [skills, search]);
  const shownHistory = useMemo(() => tabHistory.filter((j) => isSmartMatch(j.title, search)), [tabHistory, search]);

  // SuggestedSkillsView ("Post job using") when a search has no exact match
  const suggested: SkillItem[] = useMemo(() => {
    if (search.length < 2) return [];
    const all = cats.flatMap((c) => c.skills.map((k) => ({ ...k, serviceId: c.serviceId, service: c.service })));
    const m = all.filter((k) => isSmartMatch(k.skill, search));
    if (m.length) return m.slice(0, 4);
    return all.filter((k) => k.service === 'Recruitment').slice(0, 4);
  }, [search, cats]);

  const openSearch = () => {
    setSearchOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };
  const closeSearch = () => {
    setSearch('');
    setSearchOpen(false);
  };

  const doDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await deleteJob(toDelete.id);
      toast.ok('Service request deleted');
      setToDelete(null);
      invalidate('jobs:mine');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to delete job');
    } finally {
      setDeleting(false);
    }
  };

  const requestHref = (k: SkillItem) => `/hire/request?serviceId=${k.serviceId}&skillId=${k.skillId}`;

  const emptyState = (count: number) =>
    count === 0 &&
    (search && suggested.length > 0 ? (
      <div className="hr-suggest">
        <h3>No exact matches found</h3>
        <p>Post job using</p>
        <div className="hr-suggest-list">
          {suggested.map((k) => (
            <Link key={k.serviceId + ':' + k.skillId} to={requestHref(k)} className="hr-suggest-item">
              <span>{k.skill}</span>
              <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden style={{ transform: 'rotate(60deg)' }}>
                <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
          ))}
        </div>
        <button type="button" className="hr-suggest-reset" onClick={() => setSearch('')}>
          Clear Search
        </button>
      </div>
    ) : (
      <div className="hr-noresult">
        <NoResultArt />
        <div>{search ? `Couldn't find any results for '${search}'.` : 'No results found.'}</div>
      </div>
    ));

  let body: React.ReactNode;
  if (services.error && !cats.length) {
    body = (
      <div className="hr-noresult">
        <NoResultArt />
        <div className="hr-err-title">Failed to load services</div>
        <div className="hr-err-msg">We couldn't load the service catalog. Please check your connection and try again.</div>
        <button type="button" className="btn btn-sm" onClick={() => services.refetch()} style={{ marginTop: 14 }}>
          Try again
        </button>
      </div>
    );
  } else if (services.loading || !historyReady) {
    body = <GridSkeleton />;
  } else if (showHistory) {
    body = (
      <>
        <h2 className="hr-history-head">Service Request History</h2>
        {shownHistory.length ? (
          <div className="hr-history">
            {shownHistory.map((j) => (
              <HistoryCard key={j.id} job={j} onDelete={() => setToDelete(j)} />
            ))}
          </div>
        ) : (
          emptyState(0)
        )}
        {history.loading && <div className="hr-more">Loading…</div>}
        {history.error && history.items.length > 0 && (
          <button type="button" className="hr-more hr-more-btn" onClick={() => history.loadMore()}>
            Couldn't load more. Tap to retry
          </button>
        )}
      </>
    );
  } else {
    body = shownSkills.length ? (
      <div className="hr-grid">
        {shownSkills.map((k) => (
          <Link key={k.serviceId + ':' + k.skillId} to={requestHref(k)} className="hr-skill" title={`${k.skill} · ${k.service}`}>
            <span className="hr-skill-img">
              <TileImg src={k.imageUrl} alt="" />
            </span>
            <span className="hr-skill-name">{k.skill || 'Unknown Skill'}</span>
          </Link>
        ))}
      </div>
    ) : (
      emptyState(0)
    );
  }

  return (
    <div className="hr-app">
      <header className="hr-head">
        <div className={'hr-titlerow' + (searchOpen ? ' searching' : '')}>
          {!searchOpen && (
            <>
              {addingNew && (
                <button type="button" className="hr-back" onClick={() => setAddingNew(false)} aria-label="Back to service request history">
                  <BackGlyph />
                </button>
              )}
              <h1 className="hr-title">Request a Service</h1>
            </>
          )}
          {searchOpen ? (
            <div className="hr-search open">
              <button type="button" className="hr-search-ic" onClick={closeSearch} aria-label="Close search">
                <BackGlyph />
              </button>
              <input
                ref={inputRef}
                className="hr-search-input"
                placeholder="Search for Related Services"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onBlur={() => !search && setSearchOpen(false)}
                onKeyDown={(e) => e.key === 'Escape' && closeSearch()}
                aria-label="Search for related services"
              />
              {search && (
                <button
                  type="button"
                  className="hr-search-clear"
                  aria-label="Clear search"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => (setSearch(''), inputRef.current?.focus())}
                >
                  <CloseGlyph />
                </button>
              )}
            </div>
          ) : (
            <button type="button" className="hr-search" onClick={openSearch} aria-label="Search for related services">
              <SearchGlyph />
            </button>
          )}
        </div>
        <div className="hr-tabs" role="tablist" aria-label="Service categories" ref={tabsRef}>
          {services.loading && !cats.length
            ? Array.from({ length: 4 }).map((_, i) => <span key={i} className="hr-tab hr-tab-skel" />)
            : [{ serviceId: null as number | null, service: 'All', imageUrl: undefined as string | undefined }, ...cats].map((c) => {
                const on = c.service === activeTab;
                return (
                  <button key={c.service} type="button" role="tab" aria-selected={on} className={'hr-tab' + (on ? ' on' : '')} onClick={() => !on && setTab(c.serviceId)}>
                    {c.imageUrl && <img src={c.imageUrl} alt="" />}
                    <span>{c.service}</span>
                  </button>
                );
              })}
        </div>
      </header>

      <section className={'hr-sheet' + (showHistory ? ' list' : '')}>
        {body}
        <div ref={sentinel} aria-hidden />
      </section>

      {showHistory && !services.loading && (
        <button type="button" className="hr-fab" onClick={() => (setAddingNew(true), window.scrollTo({ top: 0 }))} aria-label="Request a new service" title="Request a new service">
          <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden>
            <path d="M12 3v18M3 12h18" stroke="#fff" strokeWidth="3" />
          </svg>
        </button>
      )}

      <ConfirmModal
        open={!!toDelete}
        title="Manage Request"
        message={toDelete ? `Delete “${toDelete.title}”? This can't be undone.` : ''}
        confirmLabel="Delete"
        danger
        busy={deleting}
        onConfirm={doDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}

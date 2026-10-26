import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { normalizeImageDetails, pickDisplayableImageUri } from '../../lib/images';
import { useInfinite, useOnVisible } from '../../lib/query';
import { Link, navigate, useQueryParams } from '../../lib/router';
import { Avatar, ErrorBox } from '../../ui/kit';
import { JIcon, JobThumb, VerifiedBadge } from '../jobs/components';
import { str, useMasterServices } from '../jobs/lib';

type Person = { userId: string; name: string; service?: string; avatar?: string; verified: boolean };

const PEOPLE_PAGE_SIZE = 10; // server multiplies by 10 (100 rows per page)

function isBadName(v: string) {
  const l = v.trim().toLowerCase();
  return !l || l === 'undefined' || l === 'null' || l === 'nan';
}
function looksLikePhone(v: string) {
  const t = v.trim();
  if (!/^\+?[\d\s().-]+$/.test(t)) return false;
  const d = t.replace(/\D/g, '');
  return d.length >= 8 && d.length <= 15;
}

/** Mobile utils/peopleUserRows.ts */
function toPerson(o: any): Person | null {
  if (!o || typeof o !== 'object') return null;
  const userId = str(o.userId ?? o.id ?? o._id).trim();
  if (!userId) return null;
  let name = 'User';
  for (const c of [o.fullName, o.userName, o.name]) {
    if (typeof c === 'string' && !isBadName(c) && !looksLikePhone(c)) {
      name = c.trim();
      break;
    }
  }
  const service = (typeof o.profession === 'string' && o.profession.trim()) || (typeof o.serviceDetails?.service === 'string' && o.serviceDetails.service.trim()) || undefined;
  return { userId, name, service, avatar: pickDisplayableImageUri(normalizeImageDetails(o.imageDetails)), verified: o.hasVerifiedBadge === true };
}

/** GET /user/people — hooks/usePeopleSearchInfiniteQuery.ts */
async function fetchPeoplePage(term: string, page: number, me?: string) {
  const { data } = await api.get('/user/people', { params: { pageSize: PEOPLE_PAGE_SIZE, pageIndex: page, ...(term ? { user: term } : {}) } });
  const rows: any[] = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : Array.isArray(data?.users) ? data.users : [];
  const seen = new Set<string>();
  const items: Person[] = [];
  for (const r of rows) {
    const p = toPerson(r);
    if (!p || p.userId === me || seen.has(p.userId.toLowerCase())) continue;
    seen.add(p.userId.toLowerCase());
    items.push(p);
  }
  return { items, hasMore: rows.length >= PEOPLE_PAGE_SIZE * 10 };
}

export function HireProsPage() {
  const { user } = useAuth();
  const qp = useQueryParams();
  const services = useMasterServices();
  const catId = qp.get('cat') ? Number(qp.get('cat')) : null;
  const q = qp.get('q') || '';
  const [input, setInput] = useState(q);
  useEffect(() => setInput((cur) => (cur.trim() === q.trim() ? cur : q)), [q]);

  const setParams = (next: { cat?: number | null; q?: string }) => {
    const p = new URLSearchParams();
    const c = next.cat !== undefined ? next.cat : catId;
    const s = next.q !== undefined ? next.q : q;
    if (c != null) p.set('cat', String(c));
    if (s.trim()) p.set('q', s.trim());
    const qs = p.toString();
    navigate('/hire' + (qs ? '?' + qs : ''), { replace: true });
  };

  useEffect(() => {
    if (input.trim() === q.trim()) return;
    const t = setTimeout(() => setParams({ q: input }), 400);
    return () => clearTimeout(t);
  }, [input]); // eslint-disable-line react-hooks/exhaustive-deps

  const cats = services.data || [];
  const cat = cats.find((c) => c.serviceId === catId) || null;
  const term = q.trim() || cat?.service || '';
  const people = useInfinite<Person>('hire:people:' + term, (page) => fetchPeoplePage(term, page, user?.id));
  const sentinel = useOnVisible(() => people.loadMore());

  // Skill suggestions for the search text (mobile "Post job using" suggestions)
  const skillMatches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const out: { serviceId: number; service: string; skillId: number; skill: string; imageUrl?: string }[] = [];
    for (const c of cats) for (const k of c.skills) if (k.skill.toLowerCase().includes(s) || c.service.toLowerCase().includes(s)) out.push({ serviceId: c.serviceId, service: c.service, ...k });
    return out.slice(0, 8);
  }, [q, cats]);

  const skills = cat ? cat.skills : [];

  return (
    <div className="jb-wide jb-page">
      <header className="hp-hero">
        <div className="hp-hero-text">
          <h1>Hire Pros</h1>
          <p>Find and recruit top freelancers for any service — hiring has never been this straightforward.</p>
          <div className="row-wrap" style={{ marginTop: 14 }}>
            <Link to={'/hire/request' + (cat ? `?serviceId=${cat.serviceId}` : '')} className="btn hp-hero-cta">
              <JIcon name="plus" size={17} /> Request a Service
            </Link>
            <Link to="/jobs/mine" className="btn hp-hero-ghost">
              Service Request History
            </Link>
          </div>
        </div>
        <div className="hp-hero-art" aria-hidden>
          <div className="hp-bubble b1">
            <JIcon name="users" size={22} />
          </div>
          <div className="hp-bubble b2">
            <JIcon name="briefcase" size={22} />
          </div>
          <div className="hp-bubble b3">
            <JIcon name="star" size={22} />
          </div>
        </div>
      </header>

      <form
        className="jb-searchbar hp-search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setParams({ q: input });
        }}
      >
        <div className="jb-search-field">
          <JIcon name="search" size={18} />
          <input className="jb-search-input" placeholder="Search for Related Services" value={input} onChange={(e) => setInput(e.target.value)} aria-label="Search professionals and services" />
          {input && (
            <button type="button" className="jb-clear" aria-label="Clear search" onClick={() => (setInput(''), setParams({ q: '' }))}>
              <JIcon name="close" size={14} />
            </button>
          )}
        </div>
        <button className="btn jb-search-btn" type="submit">
          Search
        </button>
      </form>

      <div className="chips jb-cats" role="tablist" aria-label="Service categories">
        <button role="tab" aria-selected={catId == null} className={'chip' + (catId == null ? ' active' : '')} onClick={() => setParams({ cat: null })}>
          All
        </button>
        {cats.map((c) => (
          <button key={c.serviceId} role="tab" aria-selected={catId === c.serviceId} className={'chip' + (catId === c.serviceId ? ' active' : '')} onClick={() => setParams({ cat: c.serviceId })}>
            {c.service}
          </button>
        ))}
      </div>

      {skillMatches.length > 0 && (
        <section className="hp-section">
          <div className="hp-section-head">
            <h2>Post job using</h2>
            <span className="small muted">Matching services</span>
          </div>
          <div className="hp-skill-grid">
            {skillMatches.map((s) => (
              <Link key={s.serviceId + ':' + s.skillId} to={`/hire/request?serviceId=${s.serviceId}&skillId=${s.skillId}`} className="hp-skill">
                <JobThumb src={s.imageUrl} title={s.skill} size={44} />
                <div style={{ minWidth: 0 }}>
                  <div className="hp-skill-name ellipsis">{s.skill}</div>
                  <div className="tiny muted ellipsis">{s.service}</div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {cat && !q && skills.length > 0 && (
        <section className="hp-section">
          <div className="hp-section-head">
            <h2>Request a service in {cat.service}</h2>
            <span className="small muted">Pick a skill to post a job</span>
          </div>
          <div className="hp-tile-grid">
            {skills.map((k) => (
              <Link key={k.skillId} to={`/hire/request?serviceId=${cat.serviceId}&skillId=${k.skillId}`} className="hp-tile">
                <JobThumb src={k.imageUrl} title={k.skill} size={64} />
                <span className="hp-tile-name">{k.skill}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {!cat && !q && cats.length > 0 && (
        <section className="hp-section">
          <div className="hp-section-head">
            <h2>Browse by service</h2>
          </div>
          <div className="hp-tile-grid">
            {cats.map((c) => (
              <button key={c.serviceId} className="hp-tile" onClick={() => setParams({ cat: c.serviceId })}>
                <JobThumb src={c.imageUrl} title={c.service} size={64} />
                <span className="hp-tile-name">{c.service}</span>
                <span className="tiny muted">{c.skills.length} skills</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="hp-section">
        <div className="hp-section-head">
          <h2>{term ? `Professionals for “${term}”` : 'Professionals'}</h2>
        </div>
        {people.error && people.items.length === 0 ? (
          <ErrorBox error={{ message: 'Could not load professionals.' }} onRetry={people.reload} />
        ) : people.loading && people.items.length === 0 ? (
          <div className="hp-people">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="hp-person jb-skel">
                <div className="jb-shimmer" style={{ width: 64, height: 64, borderRadius: '50%' }} />
                <div className="jb-shimmer" style={{ height: 12, width: '70%', borderRadius: 6, marginTop: 12 }} />
                <div className="jb-shimmer" style={{ height: 10, width: '50%', borderRadius: 6, marginTop: 8 }} />
              </div>
            ))}
          </div>
        ) : people.items.length === 0 ? (
          <div className="jb-empty">
            <div className="jb-empty-icon">
              <JIcon name="users" size={26} />
            </div>
            <div className="empty-title">{term ? `Couldn't find any results for '${term}'.` : 'No results found.'}</div>
            <div className="muted small">Post a job and let professionals come to you.</div>
            <Link to={'/hire/request' + (cat ? `?serviceId=${cat.serviceId}` : '')} className="btn btn-sm" style={{ marginTop: 14 }}>
              Request a Service
            </Link>
          </div>
        ) : (
          <div className="hp-people">
            {people.items.map((p) => (
              <Link key={p.userId} to={`/u/${encodeURIComponent(p.userId)}`} className="hp-person">
                <Avatar src={p.avatar} name={p.name} size={64} />
                <div className="hp-person-name">
                  <span className="ellipsis">{p.name}</span>
                  {p.verified && <VerifiedBadge />}
                </div>
                <div className="tiny muted hp-person-svc">{p.service || 'i’llTip member'}</div>
                <span className="hp-person-cta">View profile</span>
              </Link>
            ))}
          </div>
        )}
        <div ref={sentinel} />
        {people.loading && people.items.length > 0 && <div className="center tiny muted" style={{ padding: 12 }}>Loading more…</div>}
      </section>
    </div>
  );
}

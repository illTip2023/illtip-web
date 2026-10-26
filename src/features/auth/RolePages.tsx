/** Mirrors illtip-mobile RoleSelectScreen + RoleFinalStepScreen (+ useRoleFinalStepAi). */
import React, { useEffect, useMemo, useState } from 'react';
import { navigate, useQueryParams } from '../../lib/router';
import { useAuth } from '../../lib/auth';
import { useQuery } from '../../lib/query';
import { Icon, Modal, Spinner, toast } from '../../ui/kit';
import { AuthLayout, FormError } from './AuthLayout';
import {
  completeRoleV2,
  fetchAiSuggestion,
  fetchMasterServices,
  isValidOptionalContact,
  normalizeContact,
  normalizeUrlLike,
  RoleProfile,
  servicesToItems,
  skillsToItems,
} from './authApi';
import freelancerImg from './assets/freelancer.png';
import customerImg from './assets/customer.png';

type Role = 'freelancer' | 'customer';
const MAX_TEXT = 5000;
const MAX_AI = 3;

function useRequireSession(next: string) {
  const { session } = useAuth();
  useEffect(() => {
    if (!session) navigate('/login?next=' + encodeURIComponent(next), { replace: true });
  }, [session, next]);
  return session;
}

export function RoleSelectPage() {
  const qp = useQueryParams();
  const { session, logout } = useAuth();
  const [role, setRole] = useState<Role>(qp.get('role') === 'customer' ? 'customer' : 'freelancer');
  const cards: { id: Role; title: string; sub: string; img: string }[] = [
    { id: 'freelancer', title: 'Freelancer / Service Provider', sub: 'I am looking for work.', img: freelancerImg },
    { id: 'customer', title: 'Customer or Employer', sub: 'I am looking to hire.', img: customerImg },
  ];
  function next() {
    if (!session) return navigate('/register');
    navigate('/role/finish?role=' + role);
  }
  return (
    <AuthLayout title="Select your role" sub="Tell us how you'll use i'llTip. You can still hire and work either way." wide>
      <div className="au-roles" role="radiogroup" aria-label="Role">
        {cards.map((c) => (
          <button key={c.id} type="button" role="radio" aria-checked={role === c.id} className={'au-role' + (role === c.id ? ' active' : '')} onClick={() => setRole(c.id)}>
            <span className="au-role-check" aria-hidden>
              <Icon name="check" size={16} />
            </span>
            <span className="au-role-img">
              <img src={c.img} alt="" />
            </span>
            <span className="au-role-title">{c.title}</span>
            <span className="au-role-sub">{c.sub}</span>
          </button>
        ))}
      </div>
      <button className="btn btn-block btn-dark au-cta" style={{ marginTop: 18 }} onClick={next}>
        Continue
      </button>
      {session && (
        <p className="center tiny muted" style={{ marginTop: 12 }}>
          Signed in as {session.user.email} ·{' '}
          <button type="button" className="au-linkbtn" onClick={() => { logout(); navigate('/login', { replace: true }); }}>
            Sign out
          </button>
        </p>
      )}
    </AuthLayout>
  );
}

function AiModal({ open, onClose, loading, items, index, setIndex, onMore, onUse, error }: { open: boolean; onClose: () => void; loading: boolean; items: string[]; index: number; setIndex: (i: number) => void; onMore: () => void; onUse: (t: string) => void; error: string }) {
  const cur = items[index];
  return (
    <Modal open={open} onClose={onClose} title="Ask AI">
      {loading && !cur ? (
        <Spinner label="Writing a suggestion…" />
      ) : error && !cur ? (
        <FormError msg={error} />
      ) : cur ? (
        <div className="stack">
          <div className="row between tiny muted">
            <span>
              Suggestion {index + 1} of {items.length}
            </span>
            {loading && <span>Loading another…</span>}
          </div>
          <div className="au-ai-text pre">{cur}</div>
          <div className="row-wrap" style={{ justifyContent: 'space-between' }}>
            <div className="row">
              <button className="btn btn-ghost btn-sm" disabled={index === 0} onClick={() => setIndex(index - 1)}>
                Previous
              </button>
              <button className="btn btn-ghost btn-sm" disabled={loading || (index >= items.length - 1 && items.length >= MAX_AI)} onClick={onMore}>
                Next
              </button>
            </div>
            <button className="btn btn-sm" onClick={() => onUse(cur)}>
              Use this
            </button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

export function RoleFinishPage() {
  const qp = useQueryParams();
  const role: Role = qp.get('role') === 'customer' ? 'customer' : 'freelancer';
  const session = useRequireSession('/role/finish?role=' + role);
  const { updateUser } = useAuth();
  const services = useQuery('masterdata:services', fetchMasterServices, { staleMs: 24 * 3600_000 });
  const serviceItems = useMemo(() => servicesToItems(services.data), [services.data]);
  const [serviceId, setServiceId] = useState<number | null>(null);
  const [skillIds, setSkillIds] = useState<number[]>([]);
  const [about, setAbout] = useState('');
  const [details, setDetails] = useState('');
  const [radius30, setRadius30] = useState(true);
  const [website, setWebsite] = useState('');
  const [contact, setContact] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [skillQuery, setSkillQuery] = useState('');

  const serviceRow = useMemo(() => (services.data || []).find((s) => Number(s.serviceId) === serviceId), [services.data, serviceId]);
  const skillItems = useMemo(() => skillsToItems(serviceRow), [serviceRow]);
  const shownSkills = skillQuery.trim() ? skillItems.filter((s) => s.label.toLowerCase().includes(skillQuery.trim().toLowerCase())) : skillItems;
  const serviceName = serviceItems.find((s) => s.id === serviceId)?.label ?? '';
  const firstSkill = skillItems.find((s) => s.id === skillIds[0]);
  const isCustomer = role === 'customer';

  // AI help (useRoleFinalStepAi)
  const [aiOpen, setAiOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiItems, setAiItems] = useState<string[]>([]);
  const [aiIndex, setAiIndex] = useState(0);
  const [aiErr, setAiErr] = useState('');
  const text = isCustomer ? details : about;
  async function askAi(more = false) {
    if (!serviceId || !skillIds.length) {
      setErr('Select service and skill, then try again.');
      return;
    }
    if (more && aiIndex + 1 < aiItems.length) return setAiIndex(aiIndex + 1);
    if (!more) {
      setAiItems([]);
      setAiIndex(0);
      setAiErr('');
      setAiOpen(true);
    }
    setAiLoading(true);
    try {
      const s = await fetchAiSuggestion(serviceName, firstSkill?.label || '', text);
      setAiItems((x) => {
        const n = more ? [...x, s] : [s];
        setAiIndex(n.length - 1);
        return n;
      });
    } catch {
      if (!more) setAiErr('Could not generate a suggestion. Check your connection and try again.');
    } finally {
      setAiLoading(false);
    }
  }

  function toggleSkill(id: number) {
    setErr('');
    if (isCustomer) setSkillIds([id]);
    else setSkillIds((x) => (x.includes(id) ? x.filter((i) => i !== id) : [...x, id]));
  }

  function buildProfile(): RoleProfile | null {
    const p: RoleProfile = {};
    const aboutT = about.trim().slice(0, MAX_TEXT);
    const detailsT = details.trim().slice(0, MAX_TEXT);
    const web = normalizeUrlLike(website);
    const ct = normalizeContact(contact);
    const any = serviceId || skillIds.length || (isCustomer ? detailsT || web || ct : aboutT);
    if (!any) return null;
    if (serviceName) p.profession = serviceName;
    if (firstSkill) p.skill = firstSkill.label;
    if (serviceId) {
      p.serviceDetails = { serviceId, service: serviceName || String(serviceId) };
      p.skillDetails = [...skillIds];
    }
    if (!isCustomer) {
      if (aboutT) p.about = aboutT;
    } else {
      if (detailsT) p.details = detailsT;
      p.radius30mi = radius30;
      if (web) p.website = web;
      if (ct) p.contact = ct;
    }
    return p;
  }

  async function finish(skipped: boolean) {
    setErr('');
    if (!skipped) {
      if (!serviceId || !skillIds.length) return setErr('Please select a service and a skill from the lists.');
      if (isCustomer) {
        if (details.trim().length < 8) return setErr('Please complete service, skill, and request details before confirming.');
        if (!isValidOptionalContact(contact)) return setErr('Enter a valid email or phone number.');
      }
    }
    setSaving(true);
    try {
      const res = await completeRoleV2(role, buildProfile());
      if (!res.success) return setErr(res.message || 'Could not save your profile. Please try again.');
      updateUser({ roleSelected: true, emailVerified: true });
      toast.ok('Profile saved.');
      // Same as the app: confirm → freelancers to Jobs, employers to Hire Pros; skip → Home.
      navigate(skipped ? '/' : isCustomer ? '/hire' : '/jobs', { replace: true });
    } finally {
      setSaving(false);
    }
  }

  if (!session) return null;

  return (
    <AuthLayout title="Final step" sub="A few more details help us set up your account." back="/role" wide>
      <div className="au-role-pill">
        <Icon name={isCustomer ? 'search' : 'jobs'} size={16} /> {isCustomer ? 'Customer or Employer' : 'Freelancer / Service Provider'}
      </div>

      <div className="field">
        <label className="label" htmlFor="rf-service">{isCustomer ? 'Service required' : 'Specialization / Service provided'}</label>
        {services.loading && !services.data ? (
          <div className="input muted">Loading services…</div>
        ) : services.error ? (
          <div className="au-err">
            Could not load services.{' '}
            <button type="button" className="au-linkbtn" onClick={() => services.refetch()}>Try again</button>
          </div>
        ) : (
          <select
            id="rf-service"
            className="select"
            value={serviceId ?? ''}
            onChange={(e) => {
              setServiceId(e.target.value ? Number(e.target.value) : null);
              setSkillIds([]);
              setSkillQuery('');
              setErr('');
            }}
          >
            <option value="">{isCustomer ? 'What service do you need?' : 'What service do you focus on?'}</option>
            {serviceItems.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="field">
        <div className="row between">
          <span className="label">{isCustomer ? 'Skill required' : 'Skill provided'}</span>
          {!isCustomer && skillIds.length > 0 && <span className="tiny muted">{skillIds.length} selected</span>}
        </div>
        {!serviceId ? (
          <div className="au-hint">Select a service first, then choose a skill.</div>
        ) : skillItems.length === 0 ? (
          <div className="au-hint">No skills listed for this service.</div>
        ) : (
          <>
            {skillItems.length > 12 && (
              <input className="input" style={{ marginBottom: 8 }} placeholder="Search skills…" value={skillQuery} onChange={(e) => setSkillQuery(e.target.value)} />
            )}
            <div className="au-skills">
              {shownSkills.map((s) => (
                <button key={s.id} type="button" className={'chip' + (skillIds.includes(s.id) ? ' active' : '')} aria-pressed={skillIds.includes(s.id)} onClick={() => toggleSkill(s.id)}>
                  {s.icon && <img src={s.icon} alt="" className="au-skill-ic" />}
                  {s.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="field">
        <label className="label" htmlFor="rf-text">{isCustomer ? 'Details of request' : 'About (optional)'}</label>
        <textarea
          id="rf-text"
          className="textarea"
          rows={5}
          maxLength={MAX_TEXT}
          placeholder={isCustomer ? 'Tell us about the specifics of the service you need…' : 'Tell us about your expertise in your field…'}
          value={text}
          onChange={(e) => (isCustomer ? setDetails(e.target.value) : setAbout(e.target.value))}
        />
        <button type="button" className="au-ai-btn" onClick={() => askAi(false)} disabled={aiLoading}>
          <Icon name="ai" size={18} /> Ask AI to help write {isCustomer ? 'your request details' : 'service description'}
        </button>
      </div>

      {isCustomer && (
        <>
          <label className="au-switch">
            <input type="checkbox" checked={radius30} onChange={(e) => setRadius30(e.target.checked)} />
            <span className="au-switch-track" aria-hidden />
            <span>Limit request to 30 mile radius</span>
          </label>
          <div className="field">
            <label className="label" htmlFor="rf-web">Website link</label>
            <input id="rf-web" className="input" type="url" maxLength={500} placeholder="Link your website where candidates can apply…" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor="rf-contact">Contact email or phone number (optional)</label>
            <input id="rf-contact" className="input" maxLength={240} placeholder="Contact email or phone number (optional)" value={contact} onChange={(e) => setContact(e.target.value)} />
          </div>
        </>
      )}

      <FormError msg={err} />
      <div className="au-actions">
        <button type="button" className="btn btn-ghost" onClick={() => navigate('/role?role=' + role)} disabled={saving}>
          Return
        </button>
        <button type="button" className="btn btn-dark grow" onClick={() => finish(false)} disabled={saving}>
          {saving ? 'Saving…' : 'Confirm'}
        </button>
      </div>
      <div className="center" style={{ marginTop: 12 }}>
        <button type="button" className="au-linkbtn muted" onClick={() => finish(true)} disabled={saving}>
          Skip
        </button>
      </div>

      <AiModal
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        loading={aiLoading}
        items={aiItems}
        index={aiIndex}
        setIndex={setAiIndex}
        error={aiErr}
        onMore={() => askAi(true)}
        onUse={(t) => {
          if (isCustomer) setDetails(t.slice(0, MAX_TEXT));
          else setAbout(t.slice(0, MAX_TEXT));
          setAiOpen(false);
        }}
      />
    </AuthLayout>
  );
}

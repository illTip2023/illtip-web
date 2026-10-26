import React, { useEffect, useMemo, useRef, useState } from 'react';
import { invalidate, useQuery } from '../../lib/query';
import { goBack, Link, useQueryParams } from '../../lib/router';
import { Modal, toast } from '../../ui/kit';
import { ConfirmModal, JIcon, JobThumb, PlaceInput, Switch, UpgradeModal } from '../jobs/components';
import {
  AiSuggestion,
  checkPostLimit,
  fetchAiDescription,
  fetchSubscriptionStatus,
  hasAccess,
  Place,
  saveServiceRequest,
  uploadJobImage,
  useMasterServices,
  validateDescription,
} from '../jobs/lib';

const CURRENCIES = [
  { code: 'NGN', symbol: '₦', label: 'Nigeria (NGN)' },
  { code: 'USD', symbol: '$', label: 'United States (USD)' },
  { code: 'GBP', symbol: '£', label: 'United Kingdom (GBP)' },
  { code: 'EUR', symbol: '€', label: 'Europe (EUR)' },
  { code: 'CAD', symbol: '$', label: 'Canada (CAD)' },
  { code: 'AUD', symbol: '$', label: 'Australia (AUD)' },
  { code: 'INR', symbol: '₹', label: 'India (INR)' },
  { code: 'ZAR', symbol: 'R', label: 'South Africa (ZAR)' },
];

const MAX_AI = 3;
const LIMIT_GATE = {
  title: 'Bonus Exhausted!',
  message: "You've used your free job post for this month. Upgrade to a premium subscription to keep hiring top talent on i'llTip!",
};
const MONTHLY_GATE = {
  title: 'Monthly limit reached',
  message: "You've reached your plan's job posts for this month. Upgrade your Hiring plan to keep posting.",
};

function looksLikeEmail(v: string) {
  return /@/.test(v) || /[a-z]/i.test(v.replace(/^\+/, ''));
}
function contactError(v: string): string | null {
  const c = v.trim();
  if (!c) return null;
  if (looksLikeEmail(c)) return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c) ? null : 'Please enter a valid email address.';
  const digits = c.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15 ? null : 'Please enter a valid phone number for the selected country (10–15 digits).';
}

function toLocalInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function RequestServicePage() {
  const [k, setK] = useState(0);
  return <RequestForm key={k} onReset={() => (setK((x) => x + 1), window.scrollTo(0, 0))} />;
}

function RequestForm({ onReset }: { onReset: () => void }) {
  const qp = useQueryParams();
  const services = useMasterServices();
  const subs = useQuery('hire:subscription-status', fetchSubscriptionStatus, { staleMs: 30_000 });
  const hasHire = hasAccess(subs.data, 'hire');

  const [serviceId, setServiceId] = useState<number | null>(qp.get('serviceId') ? Number(qp.get('serviceId')) : null);
  const [skillId, setSkillId] = useState<number | null>(qp.get('skillId') ? Number(qp.get('skillId')) : null);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [currency, setCurrency] = useState(CURRENCIES[1]);
  const [payMin, setPayMin] = useState('');
  const [payMax, setPayMax] = useState('');
  const [addrText, setAddrText] = useState('');
  const [place, setPlace] = useState<Place | null>(null);
  const [workMode, setWorkMode] = useState<'remote' | 'onsite' | 'hybrid'>('remote');
  const [description, setDescription] = useState('');
  const [certified, setCertified] = useState(false);
  const [radius, setRadius] = useState(false);
  const [urgent, setUrgent] = useState(true);
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [link, setLink] = useState('');
  const [contact, setContact] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [qInput, setQInput] = useState('');
  const [questions, setQuestions] = useState<{ text: string; required: boolean }[]>([]);
  const [tried, setTried] = useState(false);

  const [validating, setValidating] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [gate, setGate] = useState<{ title: string; message: string } | null>(null);
  const [done, setDone] = useState<{ id: string | null } | null>(null);

  const [aiOpen, setAiOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiList, setAiList] = useState<AiSuggestion[]>([]);
  const [aiIdx, setAiIdx] = useState(0);
  const aiGen = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const cats = services.data || [];
  const svc = cats.find((c) => c.serviceId === serviceId) || null;
  const skill = svc?.skills.find((k) => k.skillId === skillId) || null;

  // Keep the skill valid for the chosen service.
  useEffect(() => {
    if (svc && skillId != null && !svc.skills.some((k) => k.skillId === skillId)) setSkillId(null);
  }, [svc, skillId]);

  useEffect(() => {
    if (!image) return setPreview(null);
    const u = URL.createObjectURL(image);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [image]);

  const minDate = useMemo(() => toLocalInput(new Date()), []);
  const categoryName = svc?.service || '';
  const skillName = skill?.skill || '';

  const missing = {
    title: !title.trim(),
    pay: !payMin,
    address: !addrText.trim(),
    date: !date,
  };

  /* ── AI description (ServiceDetailsScreen handleOpenAiModal) ── */
  const openAi = async () => {
    if (!categoryName && !skillName) {
      toast.error('Please select a skill category first.');
      return;
    }
    const gen = ++aiGen.current;
    setAiList([]);
    setAiIdx(0);
    setAiOpen(true);
    setAiLoading(true);
    try {
      const r = await fetchAiDescription({ category: categoryName || 'General', skillName, description });
      if (gen === aiGen.current) setAiList([r]);
    } catch (e: any) {
      if (gen === aiGen.current) {
        toast.error(e?.message || 'Could not generate a suggestion. Please try again.');
        setAiOpen(false);
      }
    } finally {
      if (gen === aiGen.current) setAiLoading(false);
    }
  };

  const nextAi = async () => {
    if (aiIdx + 1 < aiList.length) return setAiIdx(aiIdx + 1);
    if (aiList.length >= MAX_AI) return;
    const gen = aiGen.current;
    setAiLoading(true);
    try {
      const r = await fetchAiDescription({ category: categoryName || 'General', skillName, description });
      if (gen !== aiGen.current) return;
      setAiList((l) => [...l, r]);
      setAiIdx(aiIdx + 1);
    } catch {
      toast.error('Could not generate a suggestion. Please try again.');
    } finally {
      if (gen === aiGen.current) setAiLoading(false);
    }
  };

  const useAi = () => {
    const s = aiList[aiIdx];
    if (s) {
      const parts: string[] = [];
      if (s.about) parts.push(`About:\n${s.about}`);
      if (s.requirements.length) parts.push(`Requirements:\n${s.requirements.map((r) => `• ${r}`).join('\n')}`);
      if (s.responsibilities.length) parts.push(`Responsibilities:\n${s.responsibilities.map((r) => `• ${r}`).join('\n')}`);
      setDescription(parts.join('\n\n'));
    }
    setAiOpen(false);
  };

  /* ── submit (ServiceDetailsScreen "Request Service" button) ── */
  const onRequest = async () => {
    setTried(true);
    if (missing.title || missing.pay || missing.address || missing.date) {
      toast.error('Please fill in all required fields.');
      return;
    }
    const cErr = contactError(contact);
    if (cErr) {
      toast.error(cErr);
      return;
    }
    setValidating(true);
    try {
      if (description.trim()) {
        const ok = await validateDescription({ description: description.trim(), jobCategory: categoryName || 'General', subCategory: skillName });
        if (!ok) {
          toast.error("Your description doesn't look like a genuine job post. Please revise it or use the AI button.");
          return;
        }
      }
      const code = await checkPostLimit();
      if (code === 'FREE_LIMIT_REACHED') {
        setGate(LIMIT_GATE);
        return;
      }
      setConfirm(true);
    } finally {
      setValidating(false);
    }
  };

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const code = await checkPostLimit();
      if (code === 'FREE_LIMIT_REACHED') {
        setConfirm(false);
        setGate(LIMIT_GATE);
        return;
      }
      const filename = image ? await uploadJobImage(image) : null;
      if (image && !filename) toast.error('Image upload failed, posting without your photo.');
      const id = await saveServiceRequest({
        serviceName: title.trim(),
        category: categoryName || 'General',
        categoryServiceId: svc?.serviceId ?? null,
        skillId: skill?.skillId ?? null,
        skillName,
        skillImageUrl: skill?.imageUrl || svc?.imageUrl || null,
        description: description.trim(),
        workMode,
        place: place && place.fullText === addrText ? place : { fullText: addrText.trim() },
        urgency: urgent,
        date: new Date(date),
        payment: [Number(payMin) || 0, Number(payMax) || 0],
        currency: { symbol: currency.symbol, code: currency.code },
        link: link.trim() && !/^https?:\/\//i.test(link.trim()) ? `https://${link.trim()}` : link.trim(),
        contact: contact.trim(),
        hashtags: tags,
        questions: hasHire ? questions : [],
        isCertified: certified,
        isLimitedRadius: radius,
        imageFilename: filename,
      });
      setConfirm(false);
      invalidate('jobs:mine');
      setDone({ id });
      window.scrollTo(0, 0);
    } catch (e: any) {
      setConfirm(false);
      if (e?.message === 'FREE_LIMIT_REACHED') setGate(LIMIT_GATE);
      else if (e?.message === 'MONTHLY_LIMIT_REACHED') setGate(MONTHLY_GATE);
      else toast.error(e?.message || 'Could not post your job. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const addTag = () => {
    const t = tagInput.trim().replace(/^#+/, '').trim();
    if (!t || tags.length >= 5) return;
    if (!tags.includes(t)) setTags([...tags, t]);
    setTagInput('');
  };
  const addQuestion = () => {
    const t = qInput.trim();
    if (!t || questions.length >= 5) return;
    setQuestions([...questions, { text: t, required: true }]);
    setQInput('');
  };

  if (done) {
    return (
      <div className="jb-page hp-form-page">
        <div className="jb-dcard hp-done">
          <div className="jb-success-icon">
            <JIcon name="check" size={30} />
          </div>
          <h1>Your job is live</h1>
          <p className="muted">Professionals can now find and apply to “{title.trim()}”. We’ll show applicants on your posted jobs page.</p>
          <div className="row-wrap" style={{ justifyContent: 'center', marginTop: 8 }}>
            <Link to={done.id ? `/jobs/mine/${encodeURIComponent(done.id)}` : '/jobs/mine'} className="btn">
              View applicants
            </Link>
            <button className="btn btn-ghost" onClick={onReset}>
              Post another job
            </button>
          </div>
        </div>
      </div>
    );
  }

  const err = (k: keyof typeof missing) => tried && missing[k];

  return (
    <div className="jb-page hp-form-page">
      <div className="jb-backbar">
        <button className="jb-back" onClick={() => goBack('/hire')}>
          <JIcon name="back" size={18} /> Back
        </button>
      </div>
      <header className="hp-form-head">
        <h1>Request a Service</h1>
        <p className="muted">Describe the job and the pros who match will be able to apply.</p>
      </header>

      <form
        className="hp-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          onRequest();
        }}
      >
        <section className="jb-dcard">
          <h2 className="jb-sec-title">Service</h2>
          <div className="hp-grid-2">
            <div className="field">
              <label className="label" htmlFor="hp-svc">
                Service category
              </label>
              <select id="hp-svc" className="select" value={serviceId ?? ''} onChange={(e) => (setServiceId(e.target.value ? Number(e.target.value) : null), setSkillId(null))}>
                <option value="">{services.loading ? 'Loading…' : 'Select a service'}</option>
                {cats.map((c) => (
                  <option key={c.serviceId} value={c.serviceId}>
                    {c.service}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="hp-skill">
                Skill
              </label>
              <select id="hp-skill" className="select" value={skillId ?? ''} disabled={!svc} onChange={(e) => setSkillId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">{svc ? 'Select a skill' : 'Select a service first'}</option>
                {svc?.skills.map((k) => (
                  <option key={k.skillId} value={k.skillId}>
                    {k.skill}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {svc && (
            <div className="hp-chosen">
              <JobThumb src={skill?.imageUrl || svc.imageUrl} title={skillName || categoryName} size={40} />
              <div className="small">
                <b>{skillName || 'Any skill'}</b>
                <div className="muted tiny">{categoryName}</div>
              </div>
            </div>
          )}
        </section>

        <section className="jb-dcard">
          <h2 className="jb-sec-title">Job Details</h2>
          <div className="field">
            <label className="label" htmlFor="hp-title">
              Job title <Req />
            </label>
            <input id="hp-title" className={'input' + (err('title') ? ' jb-invalid' : '')} placeholder="Enter company and service name here..." value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
          </div>

          <div className="hp-grid-2">
            <div className="field">
              <label className="label" htmlFor="hp-date">
                Deadline <Req />
              </label>
              <input id="hp-date" type="datetime-local" className={'input' + (err('date') ? ' jb-invalid' : '')} min={minDate} value={date} onChange={(e) => setDate(e.target.value)} aria-describedby="hp-date-hint" />
              <div id="hp-date-hint" className="tiny muted" style={{ marginTop: 4 }}>
                Enter the deadline date for your job...
              </div>
            </div>
            <div className="field">
              <label className="label" htmlFor="hp-mode">
                Work Mode
              </label>
              <select id="hp-mode" className="select" value={workMode} onChange={(e) => setWorkMode(e.target.value as any)}>
                <option value="remote">Remote</option>
                <option value="onsite">On-site</option>
                <option value="hybrid">Hybrid</option>
              </select>
            </div>
          </div>

          <div className="field">
            <span className="label">
              Pay range <Req />
            </span>
            <div className="hp-pay">
              <select className="select hp-cur" aria-label="Currency" value={currency.code} onChange={(e) => setCurrency(CURRENCIES.find((c) => c.code === e.target.value) || CURRENCIES[1])}>
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.symbol} {c.code}
                  </option>
                ))}
              </select>
              <div className="hp-money">
                <span>{currency.symbol}</span>
                <input className={'input' + (err('pay') ? ' jb-invalid' : '')} inputMode="numeric" placeholder="Min" aria-label="Minimum pay" value={payMin} onChange={(e) => setPayMin(e.target.value.replace(/[^0-9]/g, ''))} />
              </div>
              <span className="muted">–</span>
              <div className="hp-money">
                <span>{currency.symbol}</span>
                <input className="input" inputMode="numeric" placeholder="Max" aria-label="Maximum pay" value={payMax} onChange={(e) => setPayMax(e.target.value.replace(/[^0-9]/g, ''))} />
              </div>
            </div>
          </div>

          <div className="field">
            <label className="label" htmlFor="hp-addr">
              Location <Req />
            </label>
            <PlaceInput
              id="hp-addr"
              value={addrText}
              invalid={err('address')}
              placeholder="Enter location here..."
              onText={(t) => {
                setAddrText(t);
                if (place && t !== place.fullText) setPlace(null);
              }}
              onPlace={setPlace}
            />
          </div>

          <div className="field">
            <div className="row between" style={{ marginBottom: 6 }}>
              <label className="label" htmlFor="hp-desc" style={{ margin: 0 }}>
                Description
              </label>
              <span className="tiny muted">{description.length} chars</span>
            </div>
            <textarea id="hp-desc" className="textarea hp-desc" placeholder="Service Description..." value={description} onChange={(e) => setDescription(e.target.value)} />
            <button type="button" className="hp-ai-btn" onClick={openAi} disabled={aiLoading && !aiOpen}>
              <JIcon name="sparkle" size={18} /> Ask AI to help write service description
            </button>
          </div>
        </section>

        <section className="jb-dcard">
          <h2 className="jb-sec-title">Preferences</h2>
          <Switch id="hp-cert" checked={certified} onChange={setCertified} label="Certified or License required?" />
          <Switch id="hp-radius" checked={radius} onChange={setRadius} label="Limit request to 30 mile radius" />
          <Switch id="hp-urgent" checked={urgent} onChange={setUrgent} label="High priority service" />
        </section>

        <section className="jb-dcard">
          <h2 className="jb-sec-title">Extras</h2>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f && !f.type.startsWith('image/')) return toast.error('Please choose an image file.');
              if (f) setImage(f);
            }}
          />
          {preview ? (
            <div className="hp-photo">
              <img src={preview} alt="Job" />
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>
                  Change photo
                </button>
                <button type="button" className="btn btn-ghost btn-sm jb-danger-ghost" onClick={() => setImage(null)}>
                  Remove Photo
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="hp-drop" onClick={() => fileRef.current?.click()}>
              <JIcon name="image" size={24} />
              <span>Attach your images...</span>
              <span className="tiny muted">Optional — we’ll use the skill image if you skip this.</span>
            </button>
          )}

          <div className="hp-grid-2" style={{ marginTop: 14 }}>
            <div className="field">
              <label className="label" htmlFor="hp-link">
                Website
              </label>
              <input id="hp-link" className="input" type="url" placeholder="Link your website... (optional)" value={link} onChange={(e) => setLink(e.target.value)} />
            </div>
            <div className="field">
              <label className="label" htmlFor="hp-contact">
                Contact
              </label>
              <input id="hp-contact" className={'input' + (tried && contactError(contact) ? ' jb-invalid' : '')} placeholder="Contact email or phone number (optional)" value={contact} onChange={(e) => setContact(e.target.value)} autoCapitalize="none" />
            </div>
          </div>

          <div className="field">
            <div className="row between">
              <label className="label" htmlFor="hp-tag">
                Hashtags
              </label>
              <span className={'tiny ' + (tags.length >= 5 ? 'hp-max' : 'muted')}>{tags.length}/5</span>
            </div>
            <div className="hp-add-row">
              <input
                id="hp-tag"
                className="input"
                placeholder="Add up to 5 hashtags to your post..."
                value={tagInput}
                disabled={tags.length >= 5}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    addTag();
                  }
                }}
              />
              <button type="button" className="btn btn-ghost" disabled={!tagInput.trim() || tags.length >= 5} onClick={addTag}>
                Add
              </button>
            </div>
            {tags.length > 0 && (
              <div className="row-wrap" style={{ marginTop: 8 }}>
                {tags.map((t) => (
                  <button type="button" key={t} className="jb-tag hp-removable" onClick={() => setTags(tags.filter((x) => x !== t))} aria-label={`Remove #${t}`}>
                    #{t} <JIcon name="close" size={12} />
                  </button>
                ))}
              </div>
            )}
          </div>

          {hasHire && (
            <div className="field">
              <div className="row between">
                <label className="label" htmlFor="hp-q">
                  Screening Questions
                </label>
                <span className="tiny muted">{questions.length}/5</span>
              </div>
              <div className="hp-add-row">
                <input
                  id="hp-q"
                  className="input"
                  placeholder="Ask applicants a question before they apply"
                  value={qInput}
                  disabled={questions.length >= 5}
                  onChange={(e) => setQInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addQuestion();
                    }
                  }}
                />
                <button type="button" className="btn btn-ghost" disabled={!qInput.trim() || questions.length >= 5} onClick={addQuestion}>
                  Add
                </button>
              </div>
              {questions.map((q, i) => (
                <div key={i} className="hp-question">
                  <span className="grow small">
                    {i + 1}. {q.text}
                  </span>
                  <button type="button" className="jb-icon-btn jb-icon-sm" aria-label="Remove question" onClick={() => setQuestions(questions.filter((_, j) => j !== i))}>
                    <JIcon name="close" size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="hp-submit-bar">
          <button type="submit" className="btn btn-block hp-submit" disabled={validating || submitting}>
            {validating ? 'Checking…' : 'Request Service'}
          </button>
        </div>
      </form>

      <Modal open={aiOpen} onClose={() => (aiGen.current++, setAiOpen(false), setAiLoading(false))} title="AI Suggestion" wide>
        {aiLoading && aiList.length <= aiIdx ? (
          <div className="jb-ai-loading">
            <div className="jb-ai-orb">
              <JIcon name="sparkle" size={28} />
            </div>
            <div>Please wait as our AI writes your description...</div>
          </div>
        ) : aiList[aiIdx] ? (
          <>
            <div className="tiny muted" style={{ marginBottom: 8 }}>
              Suggestion {aiIdx + 1} of {MAX_AI}
            </div>
            <div className="hp-ai-doc">
              <h3 className="jb-sub-title">About:</h3>
              <p className="pre jb-prose">{aiList[aiIdx].about}</p>
              {aiList[aiIdx].requirements.length > 0 && (
                <>
                  <h3 className="jb-sub-title">Requirements:</h3>
                  <ul className="jb-bullets">
                    {aiList[aiIdx].requirements.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </>
              )}
              {aiList[aiIdx].responsibilities.length > 0 && (
                <>
                  <h3 className="jb-sub-title">Responsibilities:</h3>
                  <ul className="jb-bullets">
                    {aiList[aiIdx].responsibilities.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
            <div className="jb-ai-actions">
              <button className="btn btn-ghost" disabled={aiIdx === 0} onClick={() => setAiIdx(aiIdx - 1)}>
                Previous
              </button>
              <button className="btn btn-ghost" disabled={aiLoading || (aiIdx + 1 >= aiList.length && aiList.length >= MAX_AI)} onClick={nextAi}>
                {aiLoading ? 'Generating…' : 'Next Suggestion'}
              </button>
              <button className="btn grow" onClick={useAi}>
                Use this description
              </button>
            </div>
          </>
        ) : (
          <div className="muted">No suggestion available.</div>
        )}
      </Modal>

      <ConfirmModal open={confirm} title="Post this job?" message="Are you sure you want to post this job?" busy={submitting} onCancel={() => setConfirm(false)} onConfirm={submit} />
      <UpgradeModal open={!!gate} onClose={() => setGate(null)} title={gate?.title || ''} message={gate?.message || ''} catalog="hire" />
    </div>
  );
}

function Req() {
  return (
    <span className="hp-req" aria-label="required">
      *
    </span>
  );
}

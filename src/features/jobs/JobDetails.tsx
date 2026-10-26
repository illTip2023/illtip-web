import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { Link, goBack, useParams } from '../../lib/router';
import { Avatar, ErrorBox, Modal, Spinner, timeAgo, toast } from '../../ui/kit';
import { ConfirmModal, JIcon, JobThumb, ResumeDoc, ResumeViewer, StatusPill, UpgradeModal, VerifiedBadge } from './components';
import {
  AiSuggestion,
  applyToJob,
  contactFromRow,
  fetchAiResume,
  fetchApplicantContact,
  fetchJobById,
  fetchProfile,
  fetchSubscriptionStatus,
  formatAiResumeText,
  gateCode,
  hasAccess,
  jobRowCache,
  mapJob,
  myAction,
  normalizeResume,
  parseDescription,
  payRangeText,
  nairaNote,
  recordJobView,
  ResumeDetails,
  shareJob,
  str,
  stripHtmlToPlainText,
  uploadResumeFile,
  useMasterServices,
  useSavedJobIds,
  viewsLabel,
  workModeLabel,
} from './lib';

type LocalResume = { kind: 'file'; file: File } | { kind: 'ai'; text: string };
type Gate = { title: string; message: string } | null;

const CAREER_GATE: Gate = {
  title: 'Choose Your Plan',
  message: 'Applying to jobs is part of a Career Access plan. Unlock more opportunities. Choose what works best for your career.',
};
const MONTHLY_APPLY_GATE: Gate = {
  title: 'Monthly limit reached',
  message: "You've reached your plan's job applications for this month. Upgrade your Career plan for more.",
};
const AI_GATE_SUB: Gate = { title: 'AI Resume Builder', message: 'AI Resume Builder is available with a Career Access subscription. Upgrade to unlock it.' };
const AI_GATE_LIMIT: Gate = { title: 'AI Resume Builder', message: "You've used up your AI resumes for this subscription period. Upgrade your Career plan for more." };
const EMPLOYER_GATE: Gate = { title: 'Unlock employer details', message: 'Employer contact details are part of a Career Access plan. Unlock more opportunities. Choose what works best for your career.' };

function fmtSize(n: number) {
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

export function JobDetailsPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { user } = useAuth();
  const services = useMasterServices();
  const saved = useSavedJobIds();
  const [row, setRow] = useState<Record<string, any> | null>(() => jobRowCache.get(id) ?? null);
  const [loadErr, setLoadErr] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [viewCount, setViewCount] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      setRow(await fetchJobById(id));
    } catch (e) {
      setLoadErr(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setRow(jobRowCache.get(id) ?? null);
    setViewCount(null);
    load();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const job = useMemo(() => (row ? mapJob(row, user?.id, services.data) : null), [row, user?.id, services.data]);
  const isPoster = !!job && !!user?.id && String(row?.userId ?? job.posterId).trim() === user.id;

  // Record a unique view (not for the poster) — JobDetailsScreen useFocusEffect
  const viewed = useRef('');
  useEffect(() => {
    if (!job?.numericId || isPoster || viewed.current === id) return;
    viewed.current = id;
    recordJobView(job.numericId).then((n) => n != null && setViewCount(n));
  }, [job?.numericId, isPoster, id]);

  if (!job) {
    return (
      <div className="jb-wide jb-page">
        <BackBar />
        {loadErr ? <ErrorBox error={loadErr} onRetry={load} /> : <Spinner label="Loading job…" />}
      </div>
    );
  }

  const views = viewCount ?? job.viewCount;
  return (
    <div className="jb-wide jb-page">
      <BackBar />
      <div className="jb-detail">
        <div className="jb-detail-main">
          <section className="jb-dcard jb-dhead">
            <div className="jb-dhead-top">
              <JobThumb src={job.image} title={job.title} size={84} />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row-wrap" style={{ marginBottom: 6 }}>
                  {job.category && <span className="jb-tag">{job.category}</span>}
                  {workModeLabel(job.workMode) && <span className="jb-tag">{workModeLabel(job.workMode)}</span>}
                  {job.urgent && <span className="jb-pill jb-pill-warn">High priority</span>}
                  {job.certified && <span className="jb-pill jb-pill-info">License required</span>}
                  <StatusPill status={job.appStatus} />
                </div>
                <h1 className="jb-dtitle">{job.title}</h1>
                <div className="jb-dposter">
                  <Avatar src={job.posterAvatar} name={job.posterName} size={26} />
                  {job.posterId ? (
                    <Link to={`/u/${encodeURIComponent(job.posterId)}`} className="jb-poster-name">
                      {job.posterName}
                    </Link>
                  ) : (
                    <span className="jb-poster-name">{job.posterName}</span>
                  )}
                  {job.posterVerified && <VerifiedBadge />}
                  {job.postedAt && <span className="muted small">· Posted {timeAgo(job.postedAt)}</span>}
                </div>
              </div>
            </div>
            <div className="jb-facts">
              <Fact icon="pin" label="Location" value={job.location} />
              <Fact icon="money" label="Pay range" value={payRangeText(job) || 'Pay range not provided'} accent={!!payRangeText(job)} />
              {nairaNote(job) && <div className="muted tiny" style={{ gridColumn: '1 / -1', marginTop: -4 }}>{nairaNote(job)}</div>}
              <Fact icon="calendar" label="Service needed by" value={job.neededBy || 'Not specified'} />
              {job.link && <Fact icon="globe" label="Website" value={<a href={job.link} target="_blank" rel="noreferrer" className="ellipsis" style={{ display: 'block' }}>{job.link.replace(/^https?:\/\//, '')}</a>} />}
            </div>
            <div className="jb-dhead-actions">
              <button className={'btn btn-ghost btn-sm' + (saved.has(job.id) ? ' jb-saved-btn' : '')} onClick={() => saved.toggle(job)} aria-pressed={saved.has(job.id)}>
                <JIcon name="bookmark" size={16} fill={saved.has(job.id)} /> {saved.has(job.id) ? 'Saved' : 'Save'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => shareJob(job)}>
                <JIcon name="share" size={16} /> Share
              </button>
              {views != null && !isPoster && (
                <span className="tiny muted jb-views">
                  <JIcon name="eye" size={14} /> {viewsLabel(views)}
                </span>
              )}
            </div>
          </section>

          <Description job={job} />
        </div>

        <aside className="jb-detail-side">
          {isPoster ? (
            <PosterPanel id={job.id} applicants={Array.isArray(row?.action) ? row!.action.length : 0} />
          ) : (
            <ApplyPanel key={job.id} job={job} row={row!} onApplied={load} refreshing={loading} />
          )}
        </aside>
      </div>
    </div>
  );
}

function BackBar() {
  return (
    <div className="jb-backbar">
      <button className="jb-back" onClick={() => goBack('/jobs')}>
        <JIcon name="back" size={18} /> Back
      </button>
    </div>
  );
}

function Fact({ icon, label, value, accent }: { icon: string; label: string; value: React.ReactNode; accent?: boolean }) {
  return (
    <div className="jb-fact">
      <span className="jb-fact-icon">
        <JIcon name={icon} size={17} />
      </span>
      <div style={{ minWidth: 0 }}>
        <div className="tiny muted">{label}</div>
        <div className={'jb-fact-val' + (accent ? ' jb-pay' : '')}>{value}</div>
      </div>
    </div>
  );
}

function Description({ job }: { job: ReturnType<typeof mapJob> }) {
  const text = stripHtmlToPlainText(job.description) || 'No description provided.';
  const d = parseDescription(text);
  return (
    <section className="jb-dcard">
      <h2 className="jb-sec-title">Job Details</h2>
      {d.isStructured ? (
        <>
          {d.about && (
            <>
              <h3 className="jb-sub-title">About the job:</h3>
              <p className="pre jb-prose">{d.about}</p>
            </>
          )}
          {d.requirements.length > 0 && (
            <>
              <h3 className="jb-sub-title">Requirements:</h3>
              <ul className="jb-bullets">
                {d.requirements.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </>
          )}
          {d.responsibilities.length > 0 && (
            <>
              <h3 className="jb-sub-title">Responsibilities:</h3>
              <ul className="jb-bullets">
                {d.responsibilities.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </>
          )}
        </>
      ) : (
        <p className="pre jb-prose">{d.about}</p>
      )}
      {job.hashtags.length > 0 && (
        <div className="row-wrap" style={{ marginTop: 14 }}>
          {job.hashtags.map((t) => (
            <span key={t} className="jb-tag jb-tag-soft">
              {t}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

function PosterPanel({ id, applicants }: { id: string; applicants: number }) {
  return (
    <div className="jb-dcard jb-sticky">
      <div className="jb-side-head">
        <JIcon name="briefcase" size={20} />
        <div>
          <div style={{ fontWeight: 700 }}>You posted this job</div>
          <div className="small muted">
            {applicants} applicant{applicants === 1 ? '' : 's'} so far
          </div>
        </div>
      </div>
      <Link to={`/jobs/mine/${encodeURIComponent(id)}`} className="btn btn-block">
        <JIcon name="users" size={17} /> View applicants
      </Link>
    </div>
  );
}

/* ───────────────────────── apply panel ───────────────────────── */

function ApplyPanel({ job, row, onApplied, refreshing }: { job: ReturnType<typeof mapJob>; row: Record<string, any>; onApplied: () => void; refreshing: boolean }) {
  const { user } = useAuth();
  const [resume, setResume] = useState<LocalResume | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [gate, setGate] = useState<Gate>(null);
  const [askNoResume, setAskNoResume] = useState(false);
  const [askExternal, setAskExternal] = useState(false);
  const [questionsOpen, setQuestionsOpen] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const pendingAnswers = useRef<{ questionId: string; question: string; answer: string }[] | null>(null);
  const [success, setSuccess] = useState(false);
  const [localApplied, setLocalApplied] = useState(false);
  const [submittedResume, setSubmittedResume] = useState<ResumeDetails | null>(null);
  const [viewer, setViewer] = useState<ResumeDetails | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // AI resume
  const [aiOpen, setAiOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiMore, setAiMore] = useState(false);
  const [aiList, setAiList] = useState<AiSuggestion[]>([]);
  const [aiIdx, setAiIdx] = useState(0);
  const [aiEdits, setAiEdits] = useState<Record<number, string>>({});
  const [aiEditing, setAiEditing] = useState(false);
  const contactRef = useRef<{ name: string; email: string; phone: string; profession: string; about: string } | null>(null);

  const appStatus = job.appStatus ?? (localApplied ? 'pending' : null);
  const applied = !!appStatus;
  const closed = ['close', 'closed', 'delete', 'deleted'].includes(job.jobStatus);
  const category = job.category;
  const skillName = job.skill || job.category || job.title;

  /* contact (after applying) — useJobDetailsContact */
  const [contact, setContact] = useState('');
  const [contactLoading, setContactLoading] = useState(false);
  const [contactChecked, setContactChecked] = useState(false);
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    if (!applied) return;
    if (row.employerDetailsLocked === true) {
      setLocked(true);
      setContactChecked(true);
      return;
    }
    const existing = contactFromRow(row, user?.id);
    if (existing) {
      setContact(existing);
      setContactChecked(true);
      return;
    }
    if (contact || !job.numericId) return;
    let off = false;
    setContactLoading(true);
    fetchApplicantContact(job.numericId, job.posterId)
      .then((r) => {
        if (off) return;
        if (r.locked) setLocked(true);
        if (r.contact) setContact(r.contact);
      })
      .finally(() => {
        if (!off) {
          setContactLoading(false);
          setContactChecked(true);
        }
      });
    return () => {
      off = true;
    };
  }, [applied, row]); // eslint-disable-line react-hooks/exhaustive-deps

  const mySubmitted = submittedResume ?? normalizeResume(myAction(row, user?.id)?.resumeDetails);

  /* ── AI resume ── */
  const getContact = async () => {
    if (contactRef.current) return contactRef.current;
    const p = user?.id ? await fetchProfile(user.id) : null;
    const c = {
      name: str(p?.fullName ?? p?.name).trim() || str(p?.userName).trim() || user?.name || '',
      email: str(p?.email).trim() || user?.email || '',
      phone: str(p?.mobileNo ?? p?.phone).trim() || user?.phone || '',
      profession: str(p?.profession).trim() || str(p?.serviceDetails?.service).trim() || skillName,
      about: str(p?.bio ?? p?.about).trim(),
    };
    contactRef.current = c;
    return c;
  };

  const handleAiError = (e: any) => {
    if (e?.message === 'SUBSCRIPTION_REQUIRED') setGate(AI_GATE_SUB);
    else if (e?.message === 'MONTHLY_LIMIT_REACHED') setGate(AI_GATE_LIMIT);
    else toast.error(e?.message || 'Could not generate a resume. Please try again.');
  };

  const fetchMoreAi = async () => {
    const c = await getContact();
    const r = await fetchAiResume({
      category: category || 'General',
      skillName: skillName || 'General',
      description: stripHtmlToPlainText(job.description),
      applicantAbout: c.about,
      applicantName: c.name,
      applicantEmail: c.email,
      applicantPhone: c.phone,
      applicantProfession: c.profession,
    });
    if (r.usage?.notify) toast.ok(`You've used ${r.usage.limit - r.usage.remaining} of your ${r.usage.limit} AI resumes for this subscription period — ${r.usage.remaining} left.`);
    return r.suggestions;
  };

  const openAi = async () => {
    if (!category && !skillName) {
      toast.error('This job is missing service details for AI resume tailoring.');
      return;
    }
    setAiList([]);
    setAiIdx(0);
    setAiEdits({});
    setAiEditing(false);
    setAiOpen(true);
    setAiLoading(true);
    try {
      setAiList(await fetchMoreAi());
    } catch (e) {
      setAiOpen(false);
      handleAiError(e);
    } finally {
      setAiLoading(false);
    }
  };

  const nextAi = async () => {
    if (aiIdx + 1 < aiList.length) return setAiIdx(aiIdx + 1);
    if (aiList.length >= 3) return;
    setAiMore(true);
    try {
      const more = await fetchMoreAi();
      const merged = [...aiList];
      for (const s of more) if (merged.length < 3 && !merged.some((m) => m.about === s.about)) merged.push(s);
      setAiList(merged);
      if (aiIdx + 1 < merged.length) setAiIdx(aiIdx + 1);
    } catch (e: any) {
      if (e?.message === 'SUBSCRIPTION_REQUIRED' || e?.message === 'MONTHLY_LIMIT_REACHED') handleAiError(e);
      else toast.error('Could not load another resume suggestion.');
    } finally {
      setAiMore(false);
    }
  };

  const aiText = (i: number) => {
    if (aiEdits[i] != null) return aiEdits[i];
    const s = aiList[i];
    const c = contactRef.current;
    return s ? formatAiResumeText(s, c?.profession || skillName, { name: c?.name, email: c?.email, phone: c?.phone }) : '';
  };

  /* ── apply flow (useJobDetailsApplyFlow) ── */
  const submit = async (appliedVia?: string) => {
    if (busy) return;
    if (!user?.id || !job.numericId) {
      toast.error('We could not identify this job. Please reopen it from Jobs and try again.');
      return;
    }
    setBusy(true);
    try {
      let details: ResumeDetails | null = null;
      if (resume?.kind === 'ai' && resume.text.trim()) {
        details = { type: 'ai', aiText: resume.text.trim(), originalName: 'AI-Resume.txt', mimeType: 'text/plain' };
      } else if (resume?.kind === 'file') {
        try {
          details = await uploadResumeFile(resume.file);
        } catch {
          toast.error('Resume upload failed. We could not upload your resume. Please try again.');
          return;
        }
      }
      const r = await applyToJob({
        serviceRequestId: job.numericId,
        userId: user.id,
        resumeDetails: details,
        screeningAnswers: pendingAnswers.current ?? undefined,
        appliedVia,
      });
      pendingAnswers.current = null;
      if (r.contact) setContact(r.contact);
      setSubmittedResume(details);
      setLocalApplied(true);
      setSuccess(true);
      onApplied();
    } catch (e: any) {
      const code = gateCode(e);
      if (code === 'MONTHLY_LIMIT_REACHED') setGate(MONTHLY_APPLY_GATE);
      else if (code === 'SUBSCRIPTION_REQUIRED') setGate(CAREER_GATE);
      else toast.error(`Application failed: ${e?.message || 'Could not submit your application right now. Please try again.'}`);
    } finally {
      setBusy(false);
    }
  };

  const continueAfterResumeCheck = () => {
    if (job.link) {
      window.open(job.link, '_blank', 'noopener');
      setAskExternal(true);
      return;
    }
    submit();
  };

  const continueAfterQuestions = () => {
    if (!resume) {
      setAskNoResume(true);
      return;
    }
    continueAfterResumeCheck();
  };

  const onApply = async () => {
    if (busy || applied || closed) return;
    // Same paywall as the app: non-subscribers go to ChooseYourPlan (here: upgrade in the app).
    setChecking(true);
    const status = await fetchSubscriptionStatus();
    setChecking(false);
    if (!hasAccess(status, 'career')) {
      setGate(CAREER_GATE);
      return;
    }
    if (job.questions.length > 0 && !pendingAnswers.current) {
      setQuestionsOpen(true);
      return;
    }
    continueAfterQuestions();
  };

  const downloadLocal = () => {
    if (!resume) return;
    const blob = resume.kind === 'file' ? resume.file : new Blob([resume.text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = resume.kind === 'file' ? resume.file.name : 'AI-Resume.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <>
      {applied ? (
        <div className="jb-dcard jb-sticky">
          <div className="jb-applied-banner">
            <span className="jb-applied-check">
              <JIcon name="check" size={18} />
            </span>
            <div>
              <div style={{ fontWeight: 700 }}>{appStatus === 'pending' ? 'Application submitted' : appStatus === 'accepted' ? 'You were hired' : appStatus === 'declined' ? 'Request declined' : 'Bill generated'}</div>
              <div className="small muted">Chat with the Recruiter</div>
            </div>
          </div>

          <div className="jb-poster-card">
            <Avatar src={job.posterAvatar} name={job.posterName} size={46} />
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="row" style={{ gap: 6 }}>
                {job.posterId ? (
                  <Link to={`/u/${encodeURIComponent(job.posterId)}`} className="jb-poster-name ellipsis">
                    {job.posterName}
                  </Link>
                ) : (
                  <span className="jb-poster-name ellipsis">{job.posterName}</span>
                )}
                {job.posterVerified && <VerifiedBadge />}
              </div>
              <div className="tiny muted ellipsis">{job.category || 'Posted this job'}</div>
              <div className="jb-contact">
                {contact ? (
                  <ContactValue value={contact} />
                ) : locked ? (
                  <button className="jb-link-btn" onClick={() => setGate(EMPLOYER_GATE)}>
                    Unlock employer contact details
                  </button>
                ) : contactLoading ? (
                  <span className="small muted">Loading contact...</span>
                ) : contactChecked ? (
                  <span className="small muted">Recruiter contact not provided</span>
                ) : null}
              </div>
            </div>
            {job.posterId && (
              <Link to={`/chat?to=${encodeURIComponent(job.posterId)}&name=${encodeURIComponent(job.posterName)}`} className="jb-chat-btn" title="Chat with the recruiter">
                <JIcon name="chat" size={20} />
              </Link>
            )}
          </div>

          {mySubmitted && (
            <button className="jb-resume-row" onClick={() => setViewer(mySubmitted)}>
              <span className="jb-file-ico">
                <JIcon name="file" size={18} />
              </span>
              <span className="grow" style={{ textAlign: 'left' }}>
                View my resume
              </span>
              <JIcon name="chevron" size={16} />
            </button>
          )}
          {job.link && (
            <a className="btn btn-ghost btn-block" style={{ marginTop: 10 }} href={job.link} target="_blank" rel="noreferrer">
              <JIcon name="external" size={16} /> Open application website
            </a>
          )}
          {refreshing && <div className="tiny muted" style={{ marginTop: 8 }}>Refreshing…</div>}
        </div>
      ) : (
        <div className="jb-dcard jb-sticky">
          <h2 className="jb-sec-title" style={{ marginBottom: 4 }}>
            Applicant Details
          </h2>
          <p className="small muted" style={{ margin: '0 0 12px' }}>
            Add your resume or let AI tailor one to this job, then apply.
          </p>

          <input
            ref={fileRef}
            type="file"
            hidden
            accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              if (!/\.(pdf|docx?|png|jpe?g|gif|webp|heic|heif)$/i.test(f.name) && !f.type.startsWith('image/')) {
                toast.error('Please choose a PDF, DOC, DOCX, or image file for your resume.');
                return;
              }
              setResume({ kind: 'file', file: f });
            }}
          />

          <button className={'jb-upload' + (resume?.kind === 'file' ? ' has' : '')} onClick={() => fileRef.current?.click()}>
            <span className="jb-file-ico">
              <JIcon name={resume?.kind === 'file' ? 'file' : 'upload'} size={18} />
            </span>
            <span className="grow" style={{ minWidth: 0, textAlign: 'left' }}>
              <span className="jb-upload-title ellipsis">{resume?.kind === 'file' ? resume.file.name : 'Add your Resume'}</span>
              <span className="tiny muted">{resume?.kind === 'file' ? `${fmtSize(resume.file.size)} · Click to change` : 'Upload your resume here (PDF, DOC, image)'}</span>
            </span>
          </button>

          <div className="jb-ai-row">
            <span className="jb-ai-ico">
              <JIcon name="sparkle" size={18} />
            </span>
            <label htmlFor="jb-ai-toggle" className="grow small" style={{ fontWeight: 600 }}>
              Let AI tailor your resume to this job
            </label>
            <input
              id="jb-ai-toggle"
              type="checkbox"
              className="jb-switch-input"
              checked={resume?.kind === 'ai' || aiOpen}
              onChange={(e) => {
                if (e.target.checked) openAi();
                else if (resume?.kind === 'ai') setResume(null);
              }}
            />
            <label htmlFor="jb-ai-toggle" className="jb-switch" aria-hidden />
          </div>

          {resume?.kind === 'ai' && (
            <div className="jb-ai-chosen">
              <JIcon name="check" size={16} />
              <span className="grow small">AI-tailored resume attached</span>
              <button className="jb-link-btn" onClick={() => setViewer({ type: 'ai', aiText: resume.text })}>
                Preview
              </button>
            </div>
          )}
          {resume && (
            <button className="jb-link-btn small" style={{ marginTop: 8 }} onClick={downloadLocal}>
              Download your Resume
            </button>
          )}

          <button className="btn btn-block jb-apply-btn" disabled={busy || checking || closed} onClick={onApply}>
            {closed ? 'No longer accepting applications' : busy ? 'Applying...' : checking ? 'Checking…' : job.link ? (
              <>
                Apply Now <JIcon name="external" size={16} />
              </>
            ) : (
              'Apply Now'
            )}
          </button>
          {job.link && <div className="tiny muted center" style={{ marginTop: 6 }}>You’ll finish applying on the employer’s website.</div>}
        </div>
      )}

      {/* Screening questions */}
      <Modal open={questionsOpen} onClose={() => setQuestionsOpen(false)} title="Screening questions">
        <p className="small muted" style={{ marginTop: 0 }}>
          The employer would like you to answer these before applying.
        </p>
        {job.questions.map((q, i) => (
          <div className="field" key={q.questionId}>
            <label className="label" htmlFor={'q' + i}>
              {i + 1}. {q.text}
              {q.required !== false && <span style={{ color: 'var(--err)' }}> *</span>}
            </label>
            <textarea id={'q' + i} className="textarea" style={{ minHeight: 70 }} value={answers[q.questionId] || ''} onChange={(e) => setAnswers((a) => ({ ...a, [q.questionId]: e.target.value }))} />
          </div>
        ))}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={() => setQuestionsOpen(false)}>
            Cancel
          </button>
          <button
            className="btn"
            onClick={() => {
              const missing = job.questions.some((q) => q.required !== false && !(answers[q.questionId] || '').trim());
              if (missing) {
                toast.error('Please answer all required questions.');
                return;
              }
              pendingAnswers.current = job.questions.map((q) => ({ questionId: q.questionId, question: q.text, answer: (answers[q.questionId] || '').trim() }));
              setQuestionsOpen(false);
              continueAfterQuestions();
            }}
          >
            Continue
          </button>
        </div>
      </Modal>

      <ConfirmModal
        open={askNoResume}
        title="Apply Now?"
        message="Do you want to apply without a resume?"
        confirmLabel="Apply"
        onCancel={() => setAskNoResume(false)}
        onConfirm={() => {
          setAskNoResume(false);
          continueAfterResumeCheck();
        }}
      />
      <ConfirmModal
        open={askExternal}
        title="Did you apply?"
        message="Have you completed your application on the external site?"
        confirmLabel="Yes, I applied"
        cancelLabel="Not yet"
        busy={busy}
        onCancel={() => setAskExternal(false)}
        onConfirm={async () => {
          await submit('external_link');
          setAskExternal(false);
        }}
      />

      {/* Success */}
      <Modal open={success} onClose={() => setSuccess(false)} title="Application submitted">
        <div className="jb-success">
          <div className="jb-success-icon">
            <JIcon name="check" size={30} />
          </div>
          <div className="jb-success-step">Important Next Step:</div>
          <p className="small" style={{ margin: '0 0 6px', fontWeight: 600 }}>
            If you were not redirected to a website:
          </p>
          <p className="small" style={{ margin: '0 0 8px' }}>
            email your attached resume directly to the employer using the contact email provided above. Your application is not complete until this email is sent.
          </p>
          <p className="tiny muted" style={{ margin: '0 0 14px' }}>
            (Ignore this if you just completed your application on an external company website.)
          </p>
          <button className="btn btn-block" onClick={() => setSuccess(false)}>
            Continue
          </button>
        </div>
      </Modal>

      {/* AI resume */}
      <Modal open={aiOpen} onClose={() => setAiOpen(false)} title="AI Generated Resume" wide>
        {aiLoading ? (
          <div className="jb-ai-loading">
            <div className="jb-ai-orb">
              <JIcon name="sparkle" size={28} />
            </div>
            <div>Please wait as our AI tailors your resume to this job...</div>
          </div>
        ) : aiList.length === 0 ? (
          <div className="muted">No resume suggestion available.</div>
        ) : (
          <>
            <div className="row between" style={{ marginBottom: 10 }}>
              <span className="tiny muted">
                Option {aiIdx + 1} of {Math.max(aiList.length, aiIdx + 1)}
              </span>
              <button className="jb-link-btn small" onClick={() => setAiEditing((v) => !v)}>
                <JIcon name="edit" size={14} /> {aiEditing ? 'Done editing' : 'Edit'}
              </button>
            </div>
            {aiEditing ? (
              <textarea className="textarea jb-ai-edit" value={aiText(aiIdx)} onChange={(e) => setAiEdits((m) => ({ ...m, [aiIdx]: e.target.value }))} />
            ) : (
              <ResumeDoc text={aiText(aiIdx)} />
            )}
            <div className="jb-ai-actions">
              <button className="btn btn-ghost" disabled={aiIdx === 0} onClick={() => setAiIdx(Math.max(0, aiIdx - 1))}>
                Previous
              </button>
              <button className="btn btn-ghost" disabled={aiMore || (aiIdx + 1 >= aiList.length && aiList.length >= 3)} onClick={nextAi}>
                {aiMore ? 'Generating…' : 'Next Suggestion'}
              </button>
              <button
                className="btn grow"
                onClick={() => {
                  setResume({ kind: 'ai', text: aiText(aiIdx) });
                  setAiOpen(false);
                }}
              >
                Use this resume
              </button>
            </div>
          </>
        )}
      </Modal>

      <ResumeViewer open={!!viewer} onClose={() => setViewer(null)} name={user?.name || ''} resume={viewer} />
      <UpgradeModal open={!!gate} onClose={() => setGate(null)} title={gate?.title || ''} message={gate?.message || ''} />
    </>
  );
}

function ContactValue({ value }: { value: string }) {
  const isEmail = /@/.test(value);
  const href = isEmail ? `mailto:${value}` : /^\+?[\d\s().-]{7,}$/.test(value) ? `tel:${value.replace(/[^\d+]/g, '')}` : undefined;
  return (
    <span className="jb-contact-val">
      {href ? (
        <a href={href} className="ellipsis">
          {value}
        </a>
      ) : (
        <span className="ellipsis">{value}</span>
      )}
      <button
        className="jb-icon-btn jb-icon-sm"
        title="Copy"
        aria-label={`Copy ${value}`}
        onClick={() => navigator.clipboard?.writeText(value).then(() => toast.ok('Copied'), () => undefined)}
      >
        <JIcon name="copy" size={14} />
      </button>
    </span>
  );
}

/**
 * "✨ Let AI apply for me" on the job page (web). Talks to the backend /ai-apply/v1 API (illtip-backend
 * services/aiApply). Completely hidden unless the backend reports {enabled:true}; any failure leaves the
 * normal Apply flow untouched.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, unwrap } from '../../lib/api';
import { API_BASE_URL } from '../../lib/env';
import { loadSession } from '../../lib/api';
import { track } from '../../lib/analytics';
import { Modal, toast } from '../../ui/kit';
import { JIcon } from './components';

/* ───────────── types (mirror services/aiApply/service.js view()) ───────────── */

export type AiApplyStatus = {
  enabled: boolean;
  eligible?: boolean;
  reason?: string | null;
  dailyLimit?: number;
  usedToday?: number;
  remainingToday?: number;
  memoryCompleteness?: number;
  firstTime?: boolean;
};
type Question = { questionId: string; label: string; type: string; options: string[]; required: boolean; why?: string };
type Answer = { questionId: string; label: string; type: string; value: any; source: string; options: string[]; required: boolean };
type Resume = {
  name: string;
  headline: string;
  contact: Record<string, string>;
  summary: string;
  skills: string[];
  experience: { title: string; company: string; period: string; bullets: string[] }[];
  education: string[];
  certifications?: string[];
  languages?: string[];
};
export type AiDraft = {
  applicationId: string;
  status: 'needs_answers' | 'ready' | 'sending' | 'submitted' | 'needs_user' | 'failed';
  stage: 'core' | 'full';
  route: 'email' | 'website' | 'in_app';
  ats: string;
  job: { serviceRequestId: number; title: string; company: string; url: string; location: string };
  fit: { verdict: 'good' | 'stretch' | 'not_eligible' | 'pending'; matchScore?: number | null; reasons: string[]; gaps: string[]; blockers: string[]; locationRestriction: string[] };
  highlights: string[];
  questions: Question[];
  answers: Answer[];
  resume: Resume | null;
  coverLetter: string;
  email: { to: string; subject: string; body: string } | null;
  autoSubmit: boolean;
  handover: { url: string; steps: string[] } | null;
  result: { status: string; reason: string; confirmationText: string; screenshot: string | null; at: string } | null;
};

const ATS_NAME: Record<string, string> = { greenhouse: 'Greenhouse', ashby: 'Ashby', workable: 'Workable', lever: 'Lever', smartrecruiters: 'SmartRecruiters', breezy: 'Breezy', jazzhr: 'JazzHR', google_forms: 'Google Forms', linkedin: 'LinkedIn', generic: "the employer's website" };
const SOURCE: Record<string, string> = { profile: 'From your profile', remembered: 'Remembered', default: 'Default', written: 'Written for this job', derived: 'From your details', file: 'Attached', you: 'Your answer' };

/* ───────────── API ───────────── */

const aiApi = {
  status: async () => unwrap<AiApplyStatus>(await api.get('/ai-apply/v1/status')),
  prepare: async (serviceRequestId: number) => unwrap<AiDraft>(await api.post('/ai-apply/v1/prepare', { serviceRequestId })),
  answer: async (id: string, answers: { questionId: string; value: any }[]) => unwrap<AiDraft>(await api.post(`/ai-apply/v1/applications/${encodeURIComponent(id)}/answers`, { answers })),
  submit: async (id: string, edits: Record<string, any>) => unwrap<AiDraft>(await api.post(`/ai-apply/v1/applications/${encodeURIComponent(id)}/submit`, { edits })),
};

function errCode(e: any): string {
  return (e instanceof ApiError && e.data?.code) || e?.data?.code || '';
}
function errMsg(e: any): string {
  return (e instanceof ApiError && e.data?.message) || e?.message || 'Something went wrong. Please try again.';
}

let cachedStatus: Promise<AiApplyStatus> | null = null;

/** Status for the current session; never throws (disabled on any error). */
export function useAiApplyStatus(loggedIn: boolean) {
  const [status, setStatus] = useState<AiApplyStatus | null>(null);
  useEffect(() => {
    if (!loggedIn) return;
    let alive = true;
    cachedStatus = cachedStatus || aiApi.status().catch(() => ({ enabled: false }) as AiApplyStatus);
    cachedStatus.then((s) => alive && setStatus(s));
    return () => {
      alive = false;
    };
  }, [loggedIn]);
  return status;
}

/* ───────────── entry card ───────────── */

export function AiApplyCard({ onClick, status }: { onClick: () => void; status: AiApplyStatus }) {
  return (
    <button className="aia-card" onClick={onClick}>
      <span className="aia-card-ico">✨</span>
      <span className="grow" style={{ textAlign: 'left', minWidth: 0 }}>
        <span className="aia-card-title">Let AI apply for me</span>
        <span className="aia-card-sub">Tailored resume, cover letter and answers. You just approve.</span>
        {status.eligible && typeof status.remainingToday === 'number' && <span className="aia-card-meta">{status.remainingToday} AI applications left today</span>}
      </span>
      <JIcon name="chevron" size={16} />
    </button>
  );
}

/* ───────────── the flow ───────────── */

const WORK_STEPS = ['Checking the job fits you', 'Tailoring your resume to this job', 'Writing your cover letter', 'Answering the application questions'];

const SEND_STEPS = {
  email: ['Attaching your tailored resume and cover letter', 'Sending your email to the employer', 'Saving it to your applications'],
  website: ["Opening the employer's application form", 'Filling in your answers', 'Uploading your tailored resume', 'Submitting and checking it went through'],
  in_app: ['Attaching your tailored resume', 'Sending your application on i\'llTip'],
};

function Working({ label, steps = WORK_STEPS }: { label?: string; steps?: string[] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => Math.min(x + 1, Math.max(steps.length - 1, 0))), 2600);
    return () => clearInterval(t);
  }, [steps.length]);
  return (
    <div className="aia-working" aria-live="polite">
      <div className="aia-orb" aria-hidden>
        ✨
      </div>
      <div className="aia-working-title">{label || 'Your AI assistant is on it…'}</div>
      {steps.length > 0 && (
      <ul className="aia-steps">
        {steps.map((s, k) => (
          <li key={s} className={k < i ? 'done' : k === i ? 'now' : ''}>
            <span className="aia-step-dot">{k < i ? '✓' : ''}</span>
            {s}
            {k === i ? '…' : ''}
          </li>
        ))}
      </ul>
      )}
    </div>
  );
}

function FitBanner({ fit, highlights }: { fit: AiDraft['fit']; highlights: string[] }) {
  if (!fit || fit.verdict === 'pending') {
    return fit?.blockers?.length ? <div className="aia-fit bad">{fit.blockers[0]}</div> : null;
  }
  const cls = fit.verdict === 'good' ? 'good' : fit.verdict === 'stretch' ? 'warn' : 'bad';
  const title = fit.verdict === 'good' ? 'Strong match' : fit.verdict === 'stretch' ? 'Worth a try (a stretch)' : 'You may not be eligible';
  return (
    <div className={'aia-fit ' + cls}>
      <div className="aia-fit-title">
        {title}
        {typeof fit.matchScore === 'number' && fit.matchScore > 0 && <span className="aia-score">{fit.matchScore}% match</span>}
      </div>
      {fit.blockers.map((b) => (
        <div key={b} className="small">
          • {b}
        </div>
      ))}
      {(highlights.length ? highlights : fit.reasons).slice(0, 3).map((r) => (
        <span key={r} className="aia-chip">
          {r}
        </span>
      ))}
      {fit.gaps.length > 0 && <div className="small muted" style={{ marginTop: 6 }}>To strengthen: {fit.gaps.slice(0, 2).join('; ')}</div>}
    </div>
  );
}

function QuestionInput({ q, value, onChange }: { q: Question | Answer; value: any; onChange: (v: any) => void }) {
  const id = 'aia-' + q.questionId.replace(/[^a-z0-9]/gi, '_');
  const opts = q.options || [];
  if (opts.length && opts.length <= 6 && q.type !== 'multiselect' && q.type !== 'checkbox') {
    return (
      <div className="aia-chips" role="radiogroup" aria-labelledby={id + '-l'}>
        {opts.map((o) => (
          <button type="button" key={o} role="radio" aria-checked={value === o} className={'aia-opt' + (value === o ? ' on' : '')} onClick={() => onChange(o)}>
            {o}
          </button>
        ))}
      </div>
    );
  }
  if (opts.length) {
    return (
      <select id={id} className="input" value={value || ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {opts.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    );
  }
  if (q.type === 'textarea') return <textarea id={id} className="textarea" style={{ minHeight: 96 }} value={value || ''} onChange={(e) => onChange(e.target.value)} />;
  const t = q.type === 'email' ? 'email' : q.type === 'url' ? 'url' : q.type === 'tel' ? 'tel' : q.type === 'number' ? 'number' : q.type === 'date' ? 'date' : 'text';
  return <input id={id} className="input" type={t} value={value || ''} onChange={(e) => onChange(e.target.value)} />;
}

async function openResumePdf(applicationId: string) {
  const s = loadSession();
  const r = await fetch(`${API_BASE_URL}/ai-apply/v1/applications/${encodeURIComponent(applicationId)}/resume.pdf`, { headers: s?.accessToken ? { Authorization: `Bearer ${s.accessToken}` } : {} });
  if (!r.ok) throw new Error('Could not open the resume');
  const url = URL.createObjectURL(await r.blob());
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function AiApplyModal({
  open,
  onClose,
  serviceRequestId,
  onSubmitted,
  onNeedsPlan,
}: {
  open: boolean;
  onClose: () => void;
  serviceRequestId: number;
  onSubmitted: () => void;
  onNeedsPlan: () => void;
}) {
  const [draft, setDraft] = useState<AiDraft | null>(null);
  const [busy, setBusy] = useState<'' | 'prepare' | 'answer' | 'submit'>('');
  const [error, setError] = useState('');
  const [vals, setVals] = useState<Record<string, any>>({});
  const [edits, setEdits] = useState<Record<string, any>>({});
  const [ansEdits, setAnsEdits] = useState<Record<string, any>>({});
  const [tab, setTab] = useState<'answers' | 'resume' | 'letter'>('answers');
  const [confirm, setConfirm] = useState(false);
  const started = useRef(false);

  const run = async (kind: 'prepare' | 'answer' | 'submit', fn: () => Promise<AiDraft>) => {
    setBusy(kind);
    setError('');
    try {
      const d = await fn();
      setDraft(d);
      setVals({});
      if (d.status === 'submitted') {
        track('AI Apply Submitted', { route: d.route, ats: d.ats });
        onSubmitted();
      }
      return d;
    } catch (e) {
      const code = errCode(e);
      if (code === 'SUBSCRIPTION_REQUIRED') {
        onClose();
        onNeedsPlan();
        return null;
      }
      track('AI Apply Failed', { step: kind, code: code || 'error' });
      setError(errMsg(e));
      return null;
    } finally {
      setBusy('');
    }
  };

  useEffect(() => {
    if (!open || started.current) return;
    started.current = true;
    track('AI Apply Opened', { jobId: serviceRequestId });
    run('prepare', () => aiApi.prepare(serviceRequestId)).then((d) => d && track('AI Apply Prepared', { route: d.route, verdict: d.fit?.verdict, questions: d.questions.length }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => {
    if (busy === 'submit') return;
    onClose();
  };

  const questions = draft?.questions || [];
  const missingRequired = questions.filter((q) => q.required && !String(vals[q.questionId] ?? '').trim());

  const sendAnswers = () => {
    if (!draft) return;
    if (missingRequired.length) {
      toast.error('Please answer the required questions.');
      return;
    }
    run('answer', () => aiApi.answer(draft.applicationId, questions.map((q) => ({ questionId: q.questionId, value: vals[q.questionId] ?? '' }))));
  };

  const doSubmit = () => {
    if (!draft) return;
    setConfirm(false);
    const e: Record<string, any> = { ...edits };
    const changed = Object.entries(ansEdits).map(([questionId, value]) => ({ questionId, value }));
    if (changed.length) e.answers = changed;
    run('submit', () => aiApi.submit(draft.applicationId, e));
  };

  const routeLine = useMemo(() => {
    if (!draft) return '';
    if (draft.route === 'email') return `Sends a tailored email with your resume to ${draft.email?.to || 'the employer'}. Replies come straight to you.`;
    if (draft.route === 'in_app') return "Applies inside i'llTip with your tailored resume and answers.";
    return draft.autoSubmit ? `Fills in and submits the employer's application form on ${ATS_NAME[draft.ats] || ATS_NAME.generic}.` : `Prepares everything for the employer's form on ${ATS_NAME[draft.ats] || ATS_NAME.generic}. You paste and submit in a minute.`;
  }, [draft]);

  let body: React.ReactNode = null;
  if (busy === 'prepare' || (!draft && !error)) body = <Working />;
  else if (busy === 'answer') body = <Working label="Updating your application…" steps={['Saving your answers', 'Finishing your resume and answers']} />;
  else if (busy === 'submit')
    body = (
      <Working
        label={draft?.route === 'website' ? "Filling in the employer's form…" : 'Sending your application…'}
        steps={draft?.route === 'website' && !draft.autoSubmit ? [] : SEND_STEPS[draft?.route || 'email']}
      />
    );
  else if (!draft) {
    body = (
      <div className="aia-center">
        <p>{error}</p>
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    );
  } else if (draft.status === 'submitted') {
    body = (
      <div className="aia-center">
        <div className="aia-done">🎉</div>
        <h3>Application sent!</h3>
        <p className="muted">{draft.result?.confirmationText || 'Your application is on its way.'}</p>
        {draft.result?.screenshot && <img className="aia-shot" alt="Employer confirmation page" src={`data:image/jpeg;base64,${draft.result.screenshot}`} />}
        <p className="small muted">Good luck! I'll remember everything you told me, so your next application is even faster.</p>
        <button className="btn btn-block" onClick={onClose}>
          Done
        </button>
      </div>
    );
  } else if (draft.status === 'needs_user' || (draft.status === 'failed' && draft.route === 'website')) {
    const reason = draft.result?.reason || '';
    body = (
      <div>
        <div className="aia-fit warn">
          <div className="aia-fit-title">Almost done: finish on the employer's site</div>
          <div className="small">
            {reason === 'captcha'
              ? "The employer's site asks you to prove you're human, so you'll press Submit yourself."
              : reason === 'login_required' || reason === 'site_requires_you'
                ? 'This site needs you to sign in yourself.'
                : reason === 'unconfirmed'
                  ? "I submitted the form but couldn't confirm it went through. Check your email for a confirmation from the employer before applying again."
                  : reason === 'email_verification'
                    ? 'The employer sent a security code to your email. Open the page below to finish.'
                    : 'Everything is prepared below. It takes about a minute.'}
          </div>
        </div>
        {draft.handover && (
          <ol className="aia-handover">
            {draft.handover.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        )}
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', margin: '8px 0 14px' }}>
          {draft.job.url && (
            <a className="btn" href={draft.job.url} target="_blank" rel="noreferrer">
              Open application page <JIcon name="external" size={15} />
            </a>
          )}
          <button className="btn btn-ghost" onClick={() => openResumePdf(draft.applicationId).catch(() => toast.error('Could not open the resume.'))}>
            Tailored resume (PDF)
          </button>
        </div>
        <AnswerList draft={draft} copyable />
        {draft.coverLetter && <CopyBlock title="Cover letter" text={draft.coverLetter} />}
      </div>
    );
  } else if (draft.status === 'needs_answers') {
    body = (
      <div>
        {draft.stage === 'core' ? (
          <div className="aia-intro">
            <b>First time only:</b> tell me about yourself so every application I write is accurate. I'll never ask these again, and you can edit them any time.
          </div>
        ) : (
          <FitBanner fit={draft.fit} highlights={draft.highlights} />
        )}
        {draft.stage === 'core' && draft.fit?.blockers?.length > 0 && <FitBanner fit={draft.fit} highlights={[]} />}
        {draft.stage !== 'core' && <p className="small muted">I answered everything I could. I just need these from you (I'll remember them for next time):</p>}
        {questions.map((q) => (
          <div className="field" key={q.questionId}>
            <label className="label" id={'aia-' + q.questionId.replace(/[^a-z0-9]/gi, '_') + '-l'} htmlFor={'aia-' + q.questionId.replace(/[^a-z0-9]/gi, '_')}>
              {q.label}
              {q.required && <span style={{ color: 'var(--err)' }}> *</span>}
            </label>
            {q.why && <div className="tiny muted" style={{ marginBottom: 6 }}>{q.why}</div>}
            <QuestionInput q={q} value={vals[q.questionId]} onChange={(v) => setVals((s) => ({ ...s, [q.questionId]: v }))} />
          </div>
        ))}
        {error && <div className="aia-err">{error}</div>}
        <button className="btn btn-block" disabled={missingRequired.length > 0} onClick={sendAnswers}>
          Continue
        </button>
      </div>
    );
  } else {
    // ready (or failed for email/in-app → can retry)
    const blocked = draft.fit?.verdict === 'not_eligible';
    body = (
      <div>
        <FitBanner fit={draft.fit} highlights={draft.highlights} />
        <div className="aia-route">
          <JIcon name={draft.route === 'email' ? 'mail' : draft.route === 'website' ? 'external' : 'check'} size={16} /> {routeLine}
        </div>
        <div className="aia-tabs" role="tablist">
          {(['answers', 'resume', 'letter'] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {t === 'answers' ? `Answers (${draft.answers.length})` : t === 'resume' ? 'Resume' : draft.route === 'email' ? 'Email' : 'Cover letter'}
            </button>
          ))}
        </div>
        {tab === 'answers' && (
          <div>
            {draft.answers.length === 0 && <p className="small muted">No form questions for this job. Your resume and {draft.route === 'email' ? 'email' : 'cover letter'} carry the application.</p>}
            {draft.answers.map((a) => (
              <div className="aia-ans" key={a.questionId}>
                <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                  <span className="small" style={{ fontWeight: 600 }}>
                    {a.label}
                  </span>
                  <span className="aia-src">{SOURCE[a.source] || a.source}</span>
                </div>
                {a.type === 'file' ? (
                  <div className="small muted">{String(a.value)}</div>
                ) : (
                  <QuestionInput q={a} value={ansEdits[a.questionId] ?? a.value} onChange={(v) => setAnsEdits((s) => ({ ...s, [a.questionId]: v }))} />
                )}
              </div>
            ))}
          </div>
        )}
        {tab === 'resume' && draft.resume && <ResumePreview r={draft.resume} onPdf={() => openResumePdf(draft.applicationId).catch(() => toast.error('Could not open the resume.'))} />}
        {tab === 'letter' &&
          (draft.route === 'email' && draft.email ? (
            <div>
              <div className="field">
                <label className="label">To</label>
                <div className="small">{draft.email.to || "The employer (their address is shown once you've applied)"}</div>
              </div>
              <div className="field">
                <label className="label" htmlFor="aia-subj">Subject</label>
                <input id="aia-subj" className="input" value={edits.emailSubject ?? draft.email.subject} onChange={(e) => setEdits((s) => ({ ...s, emailSubject: e.target.value }))} />
              </div>
              <div className="field">
                <label className="label" htmlFor="aia-body">Message</label>
                <textarea id="aia-body" className="textarea" style={{ minHeight: 200 }} value={edits.emailBody ?? draft.email.body} onChange={(e) => setEdits((s) => ({ ...s, emailBody: e.target.value }))} />
              </div>
              <div className="tiny muted">Attached: your tailored resume and cover letter (PDF).</div>
            </div>
          ) : (
            <div className="field">
              <label className="label" htmlFor="aia-cl">Cover letter</label>
              <textarea id="aia-cl" className="textarea" style={{ minHeight: 260 }} value={edits.coverLetter ?? draft.coverLetter} onChange={(e) => setEdits((s) => ({ ...s, coverLetter: e.target.value }))} />
            </div>
          ))}
        {draft.status === 'failed' && (
          <div className="aia-err">
            {draft.result?.reason === 'MONTHLY_LIMIT_REACHED'
              ? "You've reached this month's application limit on your plan."
              : draft.result?.reason === 'EMAIL_REQUIRED'
                ? 'Add your email in your application details so employers can reply to you.'
                : "That didn't go through. Please try again."}
          </div>
        )}
        {error && <div className="aia-err">{error}</div>}
        <div className="aia-actions">
          {confirm ? (
            <>
              <div className="small" style={{ flex: '1 1 100%' }}>{blocked ? 'This job may not accept your location. Apply anyway?' : 'Ready to send this application?'}</div>
              <button className="btn btn-ghost" onClick={() => setConfirm(false)}>
                Not yet
              </button>
              <button className="btn" onClick={doSubmit}>
                {draft.route === 'website' && !draft.autoSubmit ? 'Prepare hand-over' : 'Yes, send it'}
              </button>
            </>
          ) : (
            <button className="btn btn-block aia-send" onClick={() => setConfirm(true)}>
              {draft.route === 'website' && !draft.autoSubmit ? 'Get everything ready' : blocked ? 'Apply anyway' : '✨ Send my application'}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <Modal open={open} onClose={close} title={draft?.job?.title ? `AI apply · ${draft.job.title}` : 'Let AI apply for me'} wide>
      <div className="aia">{body}</div>
    </Modal>
  );
}

function ResumePreview({ r, onPdf }: { r: Resume; onPdf: () => void }) {
  return (
    <div className="aia-resume">
      <div className="aia-resume-name">{r.name}</div>
      {r.headline && <div className="muted small">{r.headline}</div>}
      {r.summary && <p className="small">{r.summary}</p>}
      {r.skills?.length > 0 && (
        <div className="aia-chips" style={{ marginBottom: 8 }}>
          {r.skills.map((s) => (
            <span className="aia-chip" key={s}>
              {s}
            </span>
          ))}
        </div>
      )}
      {r.experience?.map((e, i) => (
        <div key={i} style={{ marginBottom: 8 }}>
          <div className="small" style={{ fontWeight: 700 }}>
            {[e.title, e.company].filter(Boolean).join(' — ')}
          </div>
          {e.period && <div className="tiny muted">{e.period}</div>}
          <ul className="small" style={{ margin: '4px 0 0 18px', padding: 0 }}>
            {e.bullets.map((b, k) => (
              <li key={k}>{b}</li>
            ))}
          </ul>
        </div>
      ))}
      {r.education?.length > 0 && <div className="small"><b>Education:</b> {r.education.join('; ')}</div>}
      <button className="btn btn-ghost btn-block" style={{ marginTop: 10 }} onClick={onPdf}>
        View tailored resume (PDF)
      </button>
    </div>
  );
}

function CopyBlock({ title, text }: { title: string; text: string }) {
  return (
    <div className="aia-ans">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="small" style={{ fontWeight: 600 }}>{title}</span>
        <button className="jb-link-btn small" onClick={() => navigator.clipboard?.writeText(text).then(() => toast.ok('Copied'))}>
          Copy
        </button>
      </div>
      <div className="small aia-pre">{text}</div>
    </div>
  );
}

function AnswerList({ draft, copyable }: { draft: AiDraft; copyable?: boolean }) {
  return (
    <div>
      {draft.answers
        .filter((a) => a.type !== 'file')
        .map((a) =>
          copyable ? (
            <CopyBlock key={a.questionId} title={a.label} text={String(a.value ?? '')} />
          ) : (
            <div className="aia-ans" key={a.questionId}>
              <b className="small">{a.label}</b>
              <div className="small">{String(a.value ?? '')}</div>
            </div>
          ),
        )}
    </div>
  );
}

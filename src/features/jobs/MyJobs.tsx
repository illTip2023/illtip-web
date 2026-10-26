import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { invalidate, useInfinite, useOnVisible, useQuery } from '../../lib/query';
import { Link, navigate, useParams } from '../../lib/router';
import { Avatar, ErrorBox, Spinner, timeAgo, toast } from '../../ui/kit';
import { CardSkeleton, ConfirmModal, JIcon, JobsNav, JobThumb, ResumeViewer } from './components';
import {
  Applicant,
  deleteJob,
  fetchApplicants,
  fetchJobById,
  fetchJobStatusDeltas,
  hireApplicant,
  mapMyJob,
  MyJob,
  fetchMyJobsPage,
  parseDescription,
  ResumeDetails,
  STATUS_LABEL,
  stripHtmlToPlainText,
  useMasterServices,
  useSavedJobIds,
  workModeLabel,
} from './lib';

function StatusBadge({ status }: { status: string }) {
  const label = STATUS_LABEL[status] || (status ? status[0].toUpperCase() + status.slice(1) : 'Open');
  return <span className={'jb-status jb-status-' + (STATUS_LABEL[status] ? status : 'open')}>{label}</span>;
}

/* ───────────────────────── /jobs/mine ───────────────────────── */

export function MyJobsPage() {
  const { user } = useAuth();
  const services = useMasterServices();
  const saved = useSavedJobIds();
  const list = useInfinite<MyJob>(services.loading ? null : 'jobs:mine:' + user?.id, (p) => fetchMyJobsPage(p, services.data));
  const sentinel = useOnVisible(() => list.loadMore());
  const [deltas, setDeltas] = useState<Record<string, { status: string; applicantCount: number; hiredCount: number }>>({});

  // Lightweight polling for applicant counts / status (useJobStatusPolling)
  const ids = useMemo(() => list.items.map((j) => j.id), [list.items]);
  useEffect(() => {
    if (!ids.length) return;
    let off = false;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const d = await fetchJobStatusDeltas(ids);
        if (off || !d.length) return;
        setDeltas((old) => {
          const next = { ...old };
          for (const x of d) next[String(x.serviceId)] = { status: x.status, applicantCount: Number(x.applicantCount) || 0, hiredCount: Number(x.hiredCount) || 0 };
          return next;
        });
      } catch {
        /* polling is best-effort */
      }
    };
    const t = setInterval(tick, 15_000);
    return () => {
      off = true;
      clearInterval(t);
    };
  }, [ids.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="jb-wide jb-page">
      <header className="jb-hero">
        <div>
          <h1>My posted jobs</h1>
          <p className="muted">Service Request History — review applicants and hire.</p>
        </div>
        <Link to="/hire/request" className="btn jb-hero-btn">
          <JIcon name="plus" size={16} /> Post a job
        </Link>
      </header>
      <JobsNav active="mine" savedCount={saved.ids.size} />
      <div className="jb-narrow">
        {list.error && list.items.length === 0 ? (
          <ErrorBox error={{ message: 'Could not load your jobs.' }} onRetry={list.reload} />
        ) : list.loading && list.items.length === 0 ? (
          <CardSkeleton count={4} />
        ) : list.items.length === 0 ? (
          <div className="jb-empty">
            <div className="jb-empty-icon">
              <JIcon name="briefcase" size={26} />
            </div>
            <div className="empty-title">You haven’t posted any jobs yet</div>
            <div className="muted small">Post a job and applicants will show up here.</div>
            <Link to="/hire/request" className="btn btn-sm" style={{ marginTop: 14 }}>
              Request a Service
            </Link>
          </div>
        ) : (
          <div className="jb-list">
            {list.items.map((j) => {
              const d = deltas[j.id];
              const applicants = d ? Math.max(d.applicantCount, 0) : j.applicantCount;
              const status = d && d.hiredCount > 0 && j.status === 'open' ? 'work_in_progress' : j.status;
              return (
                <Link key={j.id} to={`/jobs/mine/${encodeURIComponent(j.id)}`} className="jb-card jb-mine-card">
                  <div className="jb-card-link">
                    <JobThumb src={j.image} title={j.title} size={58} />
                    <div className="jb-card-body">
                      <div className="jb-card-top">
                        <h3 className="jb-card-title">{j.title}</h3>
                        <StatusBadge status={status} />
                      </div>
                      <div className="jb-card-poster">
                        <span className="ellipsis">{j.category || j.skill}</span>
                        {workModeLabel(j.workMode) && <span className="jb-dot">{workModeLabel(j.workMode)}</span>}
                      </div>
                      <div className="jb-meta">
                        {j.payText && (
                          <span className="jb-meta-item jb-pay">
                            <JIcon name="money" size={15} />
                            {j.payText}
                          </span>
                        )}
                        {j.neededBy && (
                          <span className="jb-meta-item">
                            <JIcon name="calendar" size={15} />
                            Needed by {j.neededBy}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="jb-card-foot">
                    <span className={'jb-applicants' + (applicants > 0 ? ' has' : '')}>
                      <JIcon name="users" size={16} /> {applicants} applicant{applicants === 1 ? '' : 's'}
                    </span>
                    <span className="tiny muted">{j.postedAt ? `Posted ${timeAgo(j.postedAt)}` : ''}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
        <div ref={sentinel} />
        {list.loading && list.items.length > 0 && <Spinner />}
      </div>
    </div>
  );
}

/* ───────────────────────── /jobs/mine/:id ───────────────────────── */

export function MyJobDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const services = useMasterServices();
  const jobQ = useQuery('jobs:mine:detail:' + id, () => fetchJobById(id));
  const appsQ = useQuery('jobs:applicants:' + id, () => fetchApplicants(id), { staleMs: 10_000 });
  const [viewer, setViewer] = useState<{ name: string; resume: ResumeDetails } | null>(null);
  const [hireTarget, setHireTarget] = useState<Applicant | null>(null);
  const [hiring, setHiring] = useState(false);
  const [askDelete, setAskDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [openAnswers, setOpenAnswers] = useState<Record<string, boolean>>({});
  const refetchApps = useRef(appsQ.refetch);
  refetchApps.current = appsQ.refetch;

  // Poll applicants every 12s while visible (useApplicantsForJob)
  useEffect(() => {
    const t = setInterval(() => !document.hidden && refetchApps.current(), 12_000);
    return () => clearInterval(t);
  }, [id]);

  const job = jobQ.data ? mapMyJob(jobQ.data, services.data) : null;
  const desc = job ? parseDescription(stripHtmlToPlainText(String(jobQ.data?.workDec ?? jobQ.data?.description ?? ''))) : null;
  const apps = appsQ.data || [];
  const hiredSomeone = apps.some((a) => a.actionName.toLowerCase() === 'accepted' && a.actionStatus.toLowerCase() === 'resolved');

  const doHire = async () => {
    if (!hireTarget) return;
    setHiring(true);
    try {
      await hireApplicant(Number(id), hireTarget.actionedBy);
      toast.ok(`${hireTarget.userName} has been hired! ✓`);
      setHireTarget(null);
      appsQ.refetch();
      jobQ.refetch();
      invalidate('jobs:mine:');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to hire applicant');
    } finally {
      setHiring(false);
    }
  };

  const doDelete = async () => {
    setDeleting(true);
    try {
      await deleteJob(id);
      toast.ok('Job deleted');
      invalidate('jobs:mine:');
      navigate('/jobs/mine', { replace: true });
    } catch (e: any) {
      toast.error(e?.message || 'Failed to delete job');
    } finally {
      setDeleting(false);
      setAskDelete(false);
    }
  };

  return (
    <div className="jb-wide jb-page">
      <div className="jb-backbar">
        <Link to="/jobs/mine" className="jb-back">
          <JIcon name="back" size={18} /> My posted jobs
        </Link>
      </div>
      {!job ? (
        jobQ.error ? <ErrorBox error={jobQ.error} onRetry={jobQ.refetch} /> : <Spinner label="Loading job…" />
      ) : (
        <div className="jb-detail jb-detail-mine">
          <div className="jb-detail-main">
            <section className="jb-dcard">
              <div className="jb-dhead-top">
                <JobThumb src={job.image} title={job.title} size={72} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row-wrap" style={{ marginBottom: 6 }}>
                    <StatusBadge status={hiredSomeone && job.status === 'open' ? 'work_in_progress' : job.status} />
                    {job.category && <span className="jb-tag">{job.category}</span>}
                    {workModeLabel(job.workMode) && <span className="jb-tag">{workModeLabel(job.workMode)}</span>}
                  </div>
                  <h1 className="jb-dtitle">{job.title}</h1>
                  <div className="small muted">{job.postedAt ? `Posted ${timeAgo(job.postedAt)}` : ''}</div>
                </div>
              </div>
              <div className="jb-facts">
                <div className="jb-fact">
                  <span className="jb-fact-icon">
                    <JIcon name="pin" size={17} />
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div className="tiny muted">Location</div>
                    <div className="jb-fact-val">{job.location}</div>
                  </div>
                </div>
                <div className="jb-fact">
                  <span className="jb-fact-icon">
                    <JIcon name="money" size={17} />
                  </span>
                  <div>
                    <div className="tiny muted">Pay range</div>
                    <div className="jb-fact-val jb-pay">{job.payText || 'Pay range not provided'}</div>
                  </div>
                </div>
                <div className="jb-fact">
                  <span className="jb-fact-icon">
                    <JIcon name="calendar" size={17} />
                  </span>
                  <div>
                    <div className="tiny muted">Service needed by</div>
                    <div className="jb-fact-val">{job.neededBy || 'Not specified'}</div>
                  </div>
                </div>
              </div>
              <div className="jb-dhead-actions">
                <Link to={`/jobs/${encodeURIComponent(id)}`} className="btn btn-ghost btn-sm">
                  <JIcon name="eye" size={16} /> View listing
                </Link>
                <button className="btn btn-ghost btn-sm jb-danger-ghost" onClick={() => setAskDelete(true)}>
                  <JIcon name="trash" size={16} /> Delete
                </button>
              </div>
            </section>

            {desc && (desc.about || desc.requirements.length > 0) && (
              <section className="jb-dcard">
                <h2 className="jb-sec-title">Job Details</h2>
                {desc.about && <p className="pre jb-prose clamp-6">{desc.about}</p>}
                {desc.requirements.length > 0 && (
                  <>
                    <h3 className="jb-sub-title">Requirements:</h3>
                    <ul className="jb-bullets">
                      {desc.requirements.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </>
                )}
              </section>
            )}
          </div>

          <aside className="jb-detail-side jb-applicants-side">
            <section className="jb-dcard">
              <div className="row between" style={{ marginBottom: 10 }}>
                <h2 className="jb-sec-title" style={{ margin: 0 }}>
                  Accepted By
                </h2>
                <span className="jb-count">{apps.length}</span>
              </div>
              {appsQ.loading && !appsQ.data ? (
                <Spinner />
              ) : appsQ.error && !appsQ.data ? (
                <ErrorBox error={appsQ.error} onRetry={appsQ.refetch} />
              ) : apps.length === 0 ? (
                <div className="jb-empty jb-empty-sm">
                  <div className="jb-empty-icon">
                    <JIcon name="users" size={22} />
                  </div>
                  <div className="muted">No applicants yet</div>
                </div>
              ) : (
                <ul className="jb-app-list">
                  {apps.map((a) => {
                    const name = a.actionName.toLowerCase();
                    const st = a.actionStatus.toLowerCase();
                    const declined = name === 'declined';
                    const accepted = !declined && name === 'accepted' && st === 'resolved';
                    const locked = declined || accepted;
                    return (
                      <li key={a.actionedBy} className="jb-app">
                        <div className="jb-app-row">
                          <Link to={`/u/${encodeURIComponent(a.actionedBy)}`} className="jb-app-who">
                            <Avatar src={a.profileImage || undefined} name={a.userName} size={42} />
                            <div style={{ minWidth: 0 }}>
                              <div className="jb-app-name ellipsis">{a.userName}</div>
                              <div className="tiny muted ellipsis">
                                {a.service}
                                {a.createdTime ? ` · ${timeAgo(a.createdTime)}` : ''}
                              </div>
                            </div>
                          </Link>
                          <div className="jb-app-actions">
                            <Link to={`/chat?to=${encodeURIComponent(a.actionedBy)}&name=${encodeURIComponent(a.userName)}`} className="jb-icon-btn" title="Chat">
                              <JIcon name="chat" size={18} />
                            </Link>
                            {a.resumeDetails && (
                              <button className="jb-icon-btn" title="View resume" aria-label={`View ${a.userName}'s resume`} onClick={() => setViewer({ name: a.userName, resume: a.resumeDetails! })}>
                                <JIcon name="file" size={18} />
                              </button>
                            )}
                            <button
                              className={'btn btn-sm jb-hire' + (accepted ? ' hired' : declined ? ' declined' : '')}
                              disabled={locked}
                              onClick={() => setHireTarget(a)}
                            >
                              {accepted ? (
                                <>
                                  <JIcon name="check" size={14} /> Hired
                                </>
                              ) : (
                                'Hire'
                              )}
                            </button>
                          </div>
                        </div>
                        {a.fitSummary && <div className="jb-fit">AI fit summary: {a.fitSummary}</div>}
                        {a.screeningAnswers.length > 0 && (
                          <>
                            <button className="jb-link-btn small" onClick={() => setOpenAnswers((m) => ({ ...m, [a.actionedBy]: !m[a.actionedBy] }))}>
                              {openAnswers[a.actionedBy] ? 'Hide screening answers' : `View screening answers (${a.screeningAnswers.length})`}
                            </button>
                            {openAnswers[a.actionedBy] && (
                              <div className="jb-answers">
                                {a.screeningAnswers.map((qa, i) => (
                                  <div key={i}>
                                    <div className="small" style={{ fontWeight: 600 }}>
                                      {qa.question}
                                    </div>
                                    <div className="small muted pre">{qa.answer || '—'}</div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </aside>
        </div>
      )}

      <ResumeViewer open={!!viewer} onClose={() => setViewer(null)} name={viewer?.name || ''} resume={viewer?.resume || null} />
      <ConfirmModal
        open={!!hireTarget}
        title={`Hire ${hireTarget?.userName || ''}?`}
        message="Hiring this applicant will decline everyone else who applied to this job."
        confirmLabel="Hire"
        busy={hiring}
        onCancel={() => setHireTarget(null)}
        onConfirm={doHire}
      />
      <ConfirmModal
        open={askDelete}
        title="Delete this job?"
        message="This removes the job from i'llTip. Applicants will no longer see it."
        confirmLabel="Delete"
        danger
        busy={deleting}
        onCancel={() => setAskDelete(false)}
        onConfirm={doDelete}
      />
    </div>
  );
}

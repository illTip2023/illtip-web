import React, { useEffect, useRef, useState } from 'react';
import { Avatar, Empty, ErrorBox, Modal, PageHeader, Spinner, toast } from '../../ui/kit';
import { Link, useQueryParams } from '../../lib/router';
import { useAuth } from '../../lib/auth';
import { invalidate, useInfinite, useOnVisible, useQuery } from '../../lib/query';
import { bump, useVersion } from './bus';
import {
  createRecommendation,
  errMsg,
  fetchHasGiven,
  fetchRecommendationCounts,
  fetchRecommendations,
  fmtDate,
  REC_PAGE_SIZE,
  relationshipLabel,
  RELATIONSHIPS,
  rowAvatar,
  rowName,
  updateRecommendation,
  updateRecommendationStatus,
  type RecRow,
} from './api';

/* ------------------------------------------------------------ form (create/edit) */

type FormValue = { relationship: string; relationshipOtherDetail: string; whereWorked: string; body: string };

export function RecommendationModal({
  open,
  onClose,
  recipientUserId,
  recipientName,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  recipientUserId?: string;
  recipientName: string;
  editing?: RecRow | null;
}) {
  const [v, setV] = useState<FormValue>({ relationship: '', relationshipOtherDetail: '', whereWorked: '', body: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    setErr('');
    setV({
      relationship: editing?.relationship ?? '',
      relationshipOtherDetail: editing?.relationshipOtherDetail ?? '',
      whereWorked: editing?.whereWorked ?? '',
      body: editing?.body ?? '',
    });
  }, [open, editing]);

  const set = (k: keyof FormValue) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setV((o) => ({ ...o, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!v.relationship) return setErr('Please select a relationship.');
    if (v.relationship === 'other' && !v.relationshipOtherDetail.trim()) return setErr('Please describe your relationship.');
    if (!v.body.trim()) return setErr('Please enter your recommendation.');
    setErr('');
    setBusy(true);
    const payload = {
      relationship: v.relationship,
      relationshipOtherDetail: v.relationship === 'other' ? v.relationshipOtherDetail.trim() : undefined,
      whereWorked: v.whereWorked.trim(),
      body: v.body.trim(),
    };
    try {
      if (editing) {
        const r = await updateRecommendation(editing.recommendationId, payload);
        toast.ok(r.pendingReapproval ? "Your changes were saved. They'll appear after the recipient approves them." : 'Your recommendation was updated.');
      } else {
        if (!recipientUserId) throw new Error("Open someone's profile to write them a recommendation.");
        await createRecommendation({ recipientUserId, ...payload });
        toast.ok('Your recommendation was sent successfully.');
      }
      invalidate('recs:');
      bump('recs');
      onClose();
    } catch (e2) {
      setErr(errMsg(e2, 'Could not save your recommendation. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit Recommendation' : `Recommend ${recipientName}`}>
      <form onSubmit={submit}>
        <div className="field">
          <label className="label" htmlFor="rec-rel">
            Relationship with {editing ? 'this user' : recipientName}
          </label>
          <select id="rec-rel" className="select" value={v.relationship} onChange={set('relationship')}>
            <option value="">Select your type of relationship</option>
            {RELATIONSHIPS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        {v.relationship === 'other' && (
          <div className="field">
            <input className="input" placeholder="Describe your relationship..." value={v.relationshipOtherDetail} onChange={set('relationshipOtherDetail')} maxLength={120} />
          </div>
        )}
        <div className="field">
          <label className="label" htmlFor="rec-where">
            Where did you work together?
          </label>
          <input id="rec-where" className="input" placeholder="Briefly summarize where you worked together" value={v.whereWorked} onChange={set('whereWorked')} maxLength={200} />
        </div>
        <div className="field">
          <label className="label" htmlFor="rec-body">
            Your recommendation
          </label>
          <textarea id="rec-body" className="textarea" rows={6} placeholder="Enter your recommendation for this user..." value={v.body} onChange={set('body')} maxLength={3000} />
          <div className="tiny muted" style={{ textAlign: 'right', marginTop: 4 }}>
            {v.body.length}/3000
          </div>
        </div>
        {err && <div className="pf-form-err">{err}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Return
          </button>
          <button className="btn" disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save' : 'Submit'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------- card */

function RecBody({ body }: { body: string }) {
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) setOver(el.scrollHeight > el.clientHeight + 2);
  }, [body]);
  return (
    <>
      <div ref={ref} className={'pf-rec-body pre' + (open ? '' : ' clamp-3')}>
        {body}
      </div>
      {(over || open) && (
        <button className="pf-link-btn" onClick={() => setOpen((x) => !x)}>
          {open ? 'see less' : 'see more'}
        </button>
      )}
    </>
  );
}

function RecCard({ row, direction, onEdit }: { row: RecRow; direction: 'received' | 'given'; onEdit?: (r: RecRow) => void }) {
  const other = row.otherUser;
  const name = rowName(other || {});
  const [busy, setBusy] = useState(false);
  const setStatus = async (status: 'approved' | 'declined') => {
    setBusy(true);
    try {
      await updateRecommendationStatus(row.recommendationId, status);
      toast.ok(status === 'approved' ? 'Recommendation approved' : 'Recommendation declined');
      invalidate('recs:');
      bump('recs');
    } catch (e) {
      toast.error(errMsg(e, 'Could not update recommendation status. Please try again.'));
    } finally {
      setBusy(false);
    }
  };
  const rel = relationshipLabel(row.relationship, row.relationshipOtherDetail);
  return (
    <div className="pf-rec">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        {other?.userId ? (
          <Link to={`/u/${encodeURIComponent(other.userId)}`}>
            <Avatar src={rowAvatar(other)} name={name} size={44} />
          </Link>
        ) : (
          <Avatar name={name} size={44} />
        )}
        <div className="grow">
          <div className="row between" style={{ alignItems: 'flex-start' }}>
            <div className="grow">
              {other?.userId ? (
                <Link to={`/u/${encodeURIComponent(other.userId)}`} className="pf-user-name">
                  {name}
                </Link>
              ) : (
                <span className="pf-user-name">{name}</span>
              )}
              <div className="muted tiny">
                {[rel, row.whereWorked?.trim()].filter(Boolean).join(' · ')}
                {rel || row.whereWorked ? ' · ' : ''}
                {fmtDate(row.createdTime)}
              </div>
            </div>
            <div className="row" style={{ gap: 6 }}>
              {row.status === 'pending' && <span className="tag tag-warn">Pending</span>}
              {row.status === 'declined' && <span className="tag pf-tag-muted">Declined</span>}
              {direction === 'given' && row.status === 'approved' && <span className="tag tag-ok">Approved</span>}
              {onEdit && row.canEdit && (
                <button className="btn btn-ghost btn-sm" onClick={() => onEdit(row)}>
                  Edit
                </button>
              )}
            </div>
          </div>
          <RecBody body={row.body || ''} />
          {direction === 'received' && (row.canApprove || row.canDecline) && (
            <div className="row" style={{ marginTop: 10 }}>
              {row.canApprove && (
                <button className="btn btn-sm" disabled={busy} onClick={() => setStatus('approved')}>
                  Approve
                </button>
              )}
              {row.canDecline && (
                <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setStatus('declined')}>
                  Decline
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- tab */

function RecList({ qkey, direction, userId, status, onEdit, emptyText }: { qkey: string; direction: 'received' | 'given'; userId?: string; status?: 'approved'; onEdit?: (r: RecRow) => void; emptyText: string }) {
  const ver = useVersion('recs');
  const list = useInfinite<RecRow>(`${qkey}:v${ver}`, async (page) => {
    const r = await fetchRecommendations({ direction, userId, status, pageIndex: page });
    return { items: r.items, hasMore: r.items.length >= REC_PAGE_SIZE };
  });
  const sentinel = useOnVisible(() => list.loadMore());
  if (list.error && !list.items.length) return <ErrorBox error={list.error} onRetry={list.reload} />;
  if (!list.loading && !list.items.length) return <Empty title="No recommendations yet">{emptyText}</Empty>;
  return (
    <div className="pf-rec-list">
      {list.items.map((r) => (
        <RecCard key={r.recommendationId} row={r} direction={direction} onEdit={onEdit} />
      ))}
      {list.loading && <Spinner />}
      <div ref={sentinel} />
    </div>
  );
}

export function RecommendationsTab({ isOwn, userId, name, hasGiven, onRecommend }: { isOwn: boolean; userId: string; name: string; hasGiven?: boolean; onRecommend?: () => void }) {
  const [dir, setDir] = useState<'received' | 'given'>('received');
  const [editing, setEditing] = useState<RecRow | null>(null);
  const counts = useQuery(isOwn ? 'recs:counts' : null, fetchRecommendationCounts);

  if (!isOwn) {
    return (
      <div className="stack">
        <div className="card pf-rec-cta">
          <div className="grow">
            <div className="pf-section-title">Recommendations</div>
            <div className="muted small">{hasGiven ? `You have recommended ${name}.` : `Worked with ${name}? Tell others what it was like.`}</div>
          </div>
          {hasGiven ? (
            <span className="tag tag-ok">Recommended</span>
          ) : (
            <button className="btn btn-sm" onClick={onRecommend}>
              Recommend
            </button>
          )}
        </div>
        <div className="card">
          <RecList qkey={`recs:received:${userId}:approved`} direction="received" userId={userId} status="approved" emptyText={`${name} has no recommendations yet.`} />
        </div>
      </div>
    );
  }

  const c = counts.data;
  return (
    <div className="stack">
      <div className="pf-seg" role="tablist">
        <button role="tab" className={dir === 'received' ? 'active' : ''} onClick={() => setDir('received')}>
          Received <span className="pf-seg-count">{c ? c.received : '·'}</span>
          {c && c.receivedPending > 0 && <span className="badge">{c.receivedPending}</span>}
        </button>
        <button role="tab" className={dir === 'given' ? 'active' : ''} onClick={() => setDir('given')}>
          Given <span className="pf-seg-count">{c ? c.given : '·'}</span>
        </button>
      </div>
      <div className="card">
        {dir === 'received' ? (
          <RecList key="r" qkey="recs:mine:received" direction="received" onEdit={setEditing} emptyText="No recommendations received yet." />
        ) : (
          <RecList key="g" qkey="recs:mine:given" direction="given" onEdit={setEditing} emptyText="You have not given any recommendations yet. Open someone's profile to recommend them." />
        )}
      </div>
      <RecommendationModal open={!!editing} onClose={() => setEditing(null)} recipientName={editing ? rowName(editing.otherUser || {}) : ''} editing={editing} />
    </div>
  );
}

/**
 * /profile/recommendations[?userId=&name=] : the only recommendations entry point (the "Recommendations" stat on a profile).
 * Own → received / given lists (app RecommendationsScreen). Someone else → their approved recommendations + "Recommend"
 * (app AddRecommendationScreen, which also knows whether you already recommended them).
 */
export function RecommendationsPage() {
  const qp = useQueryParams();
  const { user } = useAuth();
  const userId = qp.get('userId') || user?.id || '';
  const isOwn = !!user?.id && String(userId) === String(user.id);
  const name = qp.get('name') || (isOwn ? user?.name || 'You' : 'User');
  const [open, setOpen] = useState(false);
  const hasGivenQ = useQuery(!isOwn && userId ? `recs:hasGiven:${userId}` : null, () => fetchHasGiven(userId));
  return (
    <div>
      <PageHeader title="Recommendations" back={isOwn ? '/profile' : `/u/${encodeURIComponent(userId)}`} sub={isOwn ? undefined : name} />
      {userId ? (
        <RecommendationsTab isOwn={isOwn} userId={userId} name={name} hasGiven={hasGivenQ.data?.hasGiven} onRecommend={() => setOpen(true)} />
      ) : (
        <Spinner />
      )}
      {!isOwn && userId && (
        <RecommendationModal
          open={open}
          onClose={() => {
            setOpen(false);
            invalidate(`recs:hasGiven:${userId}`);
            invalidate(`recs:approvedCount:${userId}`);
          }}
          recipientUserId={userId}
          recipientName={name}
        />
      )}
    </div>
  );
}

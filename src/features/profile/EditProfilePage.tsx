import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, ErrorBox, Icon, Modal, PageHeader, Spinner, timeAgo, toast } from '../../ui/kit';
import { goBack, navigate } from '../../lib/router';
import { useAuth } from '../../lib/auth';
import { invalidate, useQuery } from '../../lib/query';
import { errMsg, fetchProfile, fetchServiceCatalog, toDate, updateProfile, uploadProfileImage } from './api';

const MAX_PX = 1080;

/** Center-crops to a square and scales to at most 1080px (the app picks at 1080px too). */
async function squareJpeg(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('This image could not be read. Try a JPG or PNG.'));
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const out = Math.min(MAX_PX, side);
    const c = document.createElement('canvas');
    c.width = out;
    c.height = out;
    const ctx = c.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, out, out);
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.9));
    return blob || file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function PhotoCard({ name, current }: { name: string; current?: string }) {
  const { user, updateUser } = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const [pick, setPick] = useState<{ blob: Blob; url: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (f?: File | null) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) return toast.error('Please choose an image file.');
    try {
      const blob = await squareJpeg(f);
      setPick({ blob, url: URL.createObjectURL(blob) });
    } catch (e) {
      toast.error(errMsg(e, "We couldn't read that picture."));
    }
  };
  const close = () => {
    if (pick) URL.revokeObjectURL(pick.url);
    setPick(null);
    if (input.current) input.current.value = '';
  };
  const confirm = async () => {
    if (!pick) return toast.error('Please choose a profile picture first.');
    setBusy(true);
    try {
      await uploadProfileImage(pick.blob, `profile_${Date.now()}.jpg`);
      toast.ok('Your profile picture was updated.');
      invalidate('profile:');
      // Pull the fresh signed URL so the sidebar/avatar update everywhere.
      const fresh = await fetchProfile().catch(() => null);
      if (fresh?.avatar && /^https?:/.test(fresh.avatar)) updateUser({ imageUrl: fresh.avatar });
      close();
    } catch (e) {
      toast.error(errMsg(e, "We couldn't update your profile picture. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card pf-photo-card">
      <div className="pf-avatar-ring pf-avatar-ring-sm">
        <Avatar src={current || user?.imageUrl} name={name} size={84} />
      </div>
      <div className="grow">
        <div style={{ fontWeight: 700 }}>Profile photo</div>
        <div className="muted small">A clear, friendly face photo helps people trust you. Square images work best.</div>
      </div>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => input.current?.click()}>
        <Icon name="image" size={16} /> Change Photo
      </button>
      <Modal open={!!pick} onClose={close} title="Edit Profile Picture">
        {pick && (
          <div className="stack" style={{ alignItems: 'center' }}>
            <img src={pick.url} alt="New profile preview" className="pf-photo-preview" />
            <div className="muted small center">This is how your photo will look on your profile.</div>
            <div className="row" style={{ width: '100%', justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => input.current?.click()} disabled={busy}>
                Choose another
              </button>
              <button className="btn" onClick={confirm} disabled={busy}>
                {busy ? 'Uploading…' : 'Confirm Changes'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export function EditProfilePage() {
  const { user, updateUser } = useAuth();
  const prof = useQuery(user?.id ? `profile:${user.id}` : null, () => fetchProfile());
  const cat = useQuery('masterdata:services', fetchServiceCatalog, { staleMs: 30 * 60_000 });
  const p = prof.data;

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [location, setLocation] = useState('');
  const [bio, setBio] = useState('');
  const [serviceId, setServiceId] = useState<number | null>(null);
  const [skills, setSkills] = useState<number[]>([]);
  const [skillSearch, setSkillSearch] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (hydrated || !p) return;
    setName(p.name);
    setEmail(p.email);
    setWebsite(p.weblink);
    setLocation(p.address);
    setBio(p.bio);
    setServiceId(p.serviceDetails?.serviceId ?? null);
    setSkills(p.skillDetails);
    setHydrated(true);
  }, [p, hydrated]);

  const service = useMemo(() => cat.data?.find((s) => s.serviceId === serviceId) ?? null, [cat.data, serviceId]);
  const skillOptions = useMemo(() => {
    const q = skillSearch.trim().toLowerCase();
    return (service?.skillArr || []).filter((s) => !q || s.skill.toLowerCase().includes(q));
  }, [service, skillSearch]);

  const toggleSkill = (id: number) => setSkills((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    const em = email.trim();
    if (!n) return setErr('Please enter your name.');
    if (!em) return setErr('Please enter your email.');
    if (serviceId == null) return setErr('Please select a profession.');
    setErr('');
    setSaving(true);
    const svcName = service?.service || p?.profession || '';
    const validSkillIds = service ? skills.filter((id) => service.skillArr.some((s) => s.skillId === id)) : skills;
    try {
      await updateProfile({
        fullName: n,
        userName: n,
        email: em,
        about: bio.trim(),
        profession: svcName,
        serviceDetails: { serviceId, service: svcName },
        skillDetails: validSkillIds,
        ...(website.trim() ? { weblink: website.trim() } : {}),
        ...(location.trim() ? { address: location.trim() } : {}),
      });
      updateUser({ name: n, email: em });
      invalidate('profile:');
      toast.ok('Your profile was updated.');
      navigate('/profile');
    } catch (e2) {
      setErr(errMsg(e2, "We couldn't save your profile. Please try again."));
    } finally {
      setSaving(false);
    }
  };

  if (prof.loading && !p) return <Spinner label="Loading your profile" />;
  if (!p) return <ErrorBox error={prof.error || 'Couldn’t load your profile.'} onRetry={prof.refetch} />;

  const updated = toDate(p.updatedTime);

  return (
    <div className="pf pf-edit">
      <PageHeader title="Edit Profile" back="/profile" sub={updated ? `Last updated ${timeAgo(updated)}` : undefined} />
      <PhotoCard name={name || p.name} current={p.avatar} />

      <form onSubmit={save} className="stack" style={{ marginTop: 12 }}>
        <div className="card">
          <div className="pf-section-title">Basic info</div>
          <div className="pf-form-grid">
            <div className="field">
              <label className="label" htmlFor="ep-name">
                Full Name
              </label>
              <input id="ep-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter your full name" maxLength={80} autoComplete="name" />
            </div>
            <div className="field">
              <label className="label" htmlFor="ep-email">
                Email Address
              </label>
              <input id="ep-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Enter your email" autoComplete="email" />
            </div>
            <div className="field">
              <label className="label" htmlFor="ep-web">
                Website
              </label>
              <input id="ep-web" className="input" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="Enter your website" inputMode="url" />
            </div>
            <div className="field">
              <label className="label" htmlFor="ep-loc">
                Operating Location
              </label>
              <input id="ep-loc" className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Enter your operating location" autoComplete="address-level2" />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="pf-section-title">Profession & skills</div>
          <div className="field">
            <label className="label" htmlFor="ep-svc">
              Profession
            </label>
            {cat.error && !cat.data ? (
              <ErrorBox error={cat.error} onRetry={cat.refetch} />
            ) : (
              <select
                id="ep-svc"
                className="select"
                value={serviceId ?? ''}
                disabled={!cat.data}
                onChange={(e) => {
                  const v = e.target.value ? Number(e.target.value) : null;
                  if (v !== serviceId) setSkills([]);
                  setServiceId(v);
                  setSkillSearch('');
                }}
              >
                <option value="">{cat.data ? 'Select your profession' : 'Loading…'}</option>
                {(cat.data || []).map((s) => (
                  <option key={s.serviceId} value={s.serviceId}>
                    {s.service}
                  </option>
                ))}
              </select>
            )}
          </div>
          {service && service.skillArr.length > 0 && (
            <div className="field" style={{ marginBottom: 0 }}>
              <div className="row between" style={{ marginBottom: 6 }}>
                <span className="label" style={{ margin: 0 }}>
                  Skills <span className="muted">({skills.length} selected)</span>
                </span>
                {skills.length > 0 && (
                  <button type="button" className="pf-link-btn" onClick={() => setSkills([])}>
                    Clear
                  </button>
                )}
              </div>
              {service.skillArr.length > 12 && <input className="input" style={{ marginBottom: 10 }} placeholder="Search skills" value={skillSearch} onChange={(e) => setSkillSearch(e.target.value)} />}
              <div className="pf-skill-pick">
                {skillOptions.map((s) => {
                  const on = skills.includes(s.skillId);
                  return (
                    <button type="button" key={s.skillId} className={'chip' + (on ? ' active' : '')} aria-pressed={on} onClick={() => toggleSkill(s.skillId)}>
                      {on && <Icon name="check" size={14} />}
                      {s.skill}
                    </button>
                  );
                })}
                {!skillOptions.length && <span className="muted small">No skills match “{skillSearch}”.</span>}
              </div>
            </div>
          )}
        </div>

        <div className="card">
          <div className="pf-section-title">About Me</div>
          <textarea className="textarea" rows={6} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Enter your bio" maxLength={2000} aria-label="Bio" />
          <div className="tiny muted" style={{ textAlign: 'right', marginTop: 4 }}>
            {bio.length}/2000
          </div>
        </div>

        {err && <div className="pf-form-err">{err}</div>}
        <div className="pf-save-bar">
          <button type="button" className="btn btn-ghost" onClick={() => goBack('/profile')}>
            Cancel
          </button>
          <button className="btn" disabled={saving}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  );
}

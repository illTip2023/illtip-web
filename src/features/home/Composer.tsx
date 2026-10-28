import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { track } from '../../lib/analytics';
import { Avatar, Icon, toast } from '../../ui/kit';
import { I } from './icons';
import { createPost, errMsg, getPost, MAX_ATTACHMENTS, remapMentions, uploadImage, type Post } from './api';
import { useMentionPicker } from './useMentionPicker';
import { MAX_VIDEO_MB, MAX_VIDEO_SECONDS, uploadVideo, videoDuration } from './uploadVideo';
import { BoostCheckoutModal, createBoostedPost, fetchBoostCredits, saveBoostDraft, takeBoostDraft, type BoostPostBody } from '../plans/boost';

/** One picked attachment. Photos and videos can be mixed, up to MAX_ATTACHMENTS (the app's CreatePostModal rules). */
type Att = { id: string; file: File; url: string; kind: 'image' | 'video'; seconds?: number | null };
const DURATIONS = [24, 48, 72] as const;
const POLL_MAX = 280;

const isVideoFile = (f: File) => f.type.startsWith('video/') || (!f.type && /\.(mp4|mov|m4v|webm|3gp|mkv|avi)$/i.test(f.name));
const isImageFile = (f: File) => f.type.startsWith('image/') || (!f.type && /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(f.name));
const fmtDur = (s?: number | null) => (s && Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '');

/**
 * Post composer. Inline (Profile page) by default; `sheet` renders the app's CreatePostModal layout
 * (close · "Create post" · Post header, author row, big text box, Poll / Photo / Video bar at the bottom).
 * `pick` hands it files chosen before the sheet opened (the image icon on Home's "Write something here..." pill).
 */
export function Composer({
  onCreated,
  sheet,
  pick,
  autoFocusKey,
}: {
  onCreated: (p: Post) => void;
  sheet?: { onClose: () => void; onBusyChange?: (busy: boolean) => void };
  pick?: { files: File[]; n: number } | null;
  autoFocusKey?: number;
}) {
  const { user } = useAuth();
  const [text, setText] = useState('');
  const [files, setFiles] = useState<Att[]>([]);
  const [pollOn, setPollOn] = useState(false);
  const [options, setOptions] = useState<string[]>(['', '']);
  const [duration, setDuration] = useState<24 | 48 | 72>(24);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const [focused, setFocused] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const filesRef = useRef<Att[]>([]);
  filesRef.current = files;

  const mention = useMentionPicker({ text, setText, taRef, selfId: user?.id });

  useEffect(() => () => filesRef.current.forEach((f) => URL.revokeObjectURL(f.url)), []);

  // Sheet: files picked from the Home pill's image icon before the sheet opened.
  const lastPick = useRef(0);
  useEffect(() => {
    if (!pick || pick.n === lastPick.current) return;
    lastPick.current = pick.n;
    void addFiles(pick.files);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pick]);
  // Sheet: focus the text box each time it opens.
  useEffect(() => {
    if (!sheet || !autoFocusKey) return;
    const t = setTimeout(() => taRef.current?.focus({ preventScroll: true }), 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocusKey]);
  useEffect(() => {
    sheet?.onBusyChange?.(!!busy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  // auto-grow textarea
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    if (sheet) return; // the sheet's text box keeps its own size and the body scrolls
    ta.style.height = Math.min(320, ta.scrollHeight) + 'px';
  }, [text, sheet]);

  const addFiles = async (list: FileList | File[] | null) => {
    if (!list) return;
    const arr = Array.from(list);
    if (!arr.length) return;
    if (pollOn) {
      toast.error('Remove the poll before adding photos or videos.');
      return;
    }
    const supported = arr.filter((f) => isImageFile(f) || isVideoFile(f));
    if (supported.length < arr.length) toast.error('Only photos and videos can be attached.');
    let room = MAX_ATTACHMENTS - filesRef.current.length;
    if (room <= 0) {
      toast.error(`You can attach up to ${MAX_ATTACHMENTS} items per post.`);
      return;
    }
    if (supported.length > room) toast.error(`You can attach up to ${MAX_ATTACHMENTS} items per post.`);
    const accepted: Att[] = [];
    const tooBig: string[] = [];
    let tooLong = 0;
    setChecking(supported.some(isVideoFile));
    try {
      for (const file of supported) {
        if (room <= 0) break;
        if (isVideoFile(file)) {
          if (file.size > MAX_VIDEO_MB * 1024 * 1024) {
            tooBig.push(file.name);
            continue;
          }
          const seconds = await videoDuration(file);
          if (seconds != null && seconds > MAX_VIDEO_SECONDS + 0.5) {
            tooLong += 1;
            continue;
          }
          accepted.push({ id: Math.random().toString(36).slice(2), file, url: URL.createObjectURL(file), kind: 'video', seconds });
        } else {
          accepted.push({ id: Math.random().toString(36).slice(2), file, url: URL.createObjectURL(file), kind: 'image' });
        }
        room -= 1;
      }
    } finally {
      setChecking(false);
    }
    if (tooLong) toast.error(tooLong === 1 ? 'Videos must be 3 minutes or shorter. That video was not added.' : `${tooLong} videos were longer than 3 minutes and were not added.`);
    if (tooBig.length) toast.error(`Videos must be ${MAX_VIDEO_MB} MB or smaller. Trim the video or send a shorter clip.`);
    if (!accepted.length) return;
    setFocused(true);
    setFiles((prev) => [...prev, ...accepted].slice(0, MAX_ATTACHMENTS));
  };

  const removeFile = (id: string) =>
    setFiles((prev) => {
      const f = prev.find((x) => x.id === id);
      if (f) URL.revokeObjectURL(f.url);
      return prev.filter((x) => x.id !== id);
    });

  const cleanOpts = options.map((o) => o.trim()).filter(Boolean);
  const optsUnique = new Set(cleanOpts.map((o) => o.toLowerCase())).size === cleanOpts.length;
  const qLen = text.trim().length;
  const pollValid = qLen > 0 && qLen <= POLL_MAX && cleanOpts.length >= 2 && cleanOpts.length <= 4 && optsUnique && cleanOpts.every((o) => o.length <= 80);
  const canPost = !busy && !checking && (pollOn ? pollValid : qLen > 0 || files.length > 0);
  const expanded = focused || !!text || files.length > 0 || pollOn;
  const keep = !!text || files.length > 0 || pollOn || !!busy;
  const full = files.length >= MAX_ATTACHMENTS;
  const mediaDisabled = !!busy || pollOn || full || checking;

  const reset = () => {
    files.forEach((f) => URL.revokeObjectURL(f.url));
    setText('');
    mention.clear();
    setFiles([]);
    setPollOn(false);
    setOptions(['', '']);
    setDuration(24);
    setFocused(false);
  };

  /** Same checks as the app's CreatePostModal before Post or Boost. */
  const validate = () => {
    if (busy) return false;
    if (!canPost) {
      if (checking) return false;
      if (pollOn && !optsUnique) toast.error('Poll options must be different.');
      else if (pollOn && qLen > POLL_MAX) toast.error(`Poll questions can be up to ${POLL_MAX} characters.`);
      else if (pollOn) toast.error('Add a question and at least two options.');
      else toast.error('Add text, a photo or a video.');
      return false;
    }
    return true;
  };

  /** Uploads the attachments (progress in the bar) and returns the POST /post body. */
  const buildBody = async (): Promise<BoostPostBody> => {
    const caption = text.trim();
    let imageArr: any[] = [];
    if (!pollOn && files.length) {
      // Like the app's useCreatePost: per-item fractions averaged into one bar, the last 10% for creating the post.
      const fr = files.map(() => 0);
      const processing = files.map(() => false);
      const report = () => {
        const avg = fr.reduce((s, x) => s + x, 0) / files.length;
        setProgress(Math.min(0.9, avg * 0.9));
        const vidsProcessing = files.some((f, i) => f.kind === 'video' && processing[i] && fr[i] < 1);
        setBusy(vidsProcessing ? 'Processing video…' : `Uploading ${Math.round(Math.min(0.9, avg * 0.9) * 100)}%`);
      };
      setProgress(0);
      setBusy('Uploading 0%');
      const batches = await Promise.all(
        files.map(async (f, i) => {
          if (f.kind === 'video') {
            const r = await uploadVideo(f.file, ({ phase, fraction }) => {
              // upload bytes = first 80% of this item; the server's MP4 conversion = the rest
              processing[i] = phase === 'processing';
              fr[i] = phase === 'processing' ? 0.8 : fraction * 0.8;
              report();
            });
            fr[i] = 1;
            processing[i] = false;
            report();
            return r;
          }
          const r = await uploadImage(f.file);
          fr[i] = 1;
          report();
          return r;
        }),
      );
      imageArr = batches.flat();
    }
    return pollOn
      ? { caption: '', imageArr: [], mentions: [], poll: { question: caption, options: cleanOpts, durationHours: duration } }
      : { caption, imageArr, mentions: remapMentions(caption, mention.tagged) };
  };

  /** Creates the post (boosted when `boost`), then clears the composer and hands the new post to the feed. */
  const publish = async (body: BoostPostBody, boost: boolean) => {
    setProgress((p) => (p == null ? null : 0.9));
    setBusy('Posting…');
    let id: number | null;
    let boosted = false;
    if (boost) {
      const r = await createBoostedPost(body);
      id = r.id;
      boosted = r.boosted;
    } else id = await createPost(body);
    track('Post Created', {
      postId: id,
      type: body.poll ? 'poll' : body.imageArr.length ? (files.some((f) => f.kind === 'video') ? 'video' : 'image') : 'text',
      mediaCount: body.imageArr.length,
      hasMentions: !!body.mentions?.length,
      boosted: boost ? boosted : false,
      source: sheet ? 'create_sheet' : 'profile',
    });
    let post: Post | null = null;
    if (id) {
      try {
        post = await getPost(id);
      } catch {
        post = null;
      }
    }
    setProgress((p) => (p == null ? null : 1));
    if (!boost) toast.ok('Post created successfully.');
    else if (boosted) toast.ok('Post boosted and published!');
    else toast.error('Post published, but the boost did not apply (no boost credit). It will show as a normal post.');
    reset();
    sheet?.onClose();
    if (post) onCreated(post);
    else
      onCreated({
        statusPostId: id || Date.now(),
        caption: body.poll ? '' : body.caption,
        createdBy: user?.id || '',
        createdTime: Math.floor(Date.now() / 1000),
        imageArr: body.imageArr,
        ...(boosted ? { boostedUntil: Math.floor(Date.now() / 1000) + 3 * 24 * 3600 } : {}),
        userDetails: [{ userId: user?.id || '', fullName: user?.name, imageDetails: user?.imageUrl ? { imgLink: user.imageUrl } : undefined }],
      });
  };

  const submit = async () => {
    if (!validate()) return;
    try {
      await publish(await buildBody(), false);
    } catch (e) {
      toast.error(errMsg(e, 'Could not create post. Please try again.'));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  /* ---- Boost (HomeScreen.handleBoostPost): use a credit if there is one, otherwise buy a boost first ---- */
  const [boostOpen, setBoostOpen] = useState(false);
  /** The uploaded body for the current draft, so paying again after closing the dialog doesn't upload twice. */
  const prepared = useRef<{ sig: string; body: BoostPostBody } | null>(null);
  const draftSig = () => JSON.stringify([text.trim(), pollOn, pollOn ? cleanOpts : [], duration, files.map((f) => f.id)]);

  const boost = async () => {
    if (!validate()) return;
    setBusy('Checking…');
    let credits = 0;
    try {
      credits = await fetchBoostCredits();
    } catch {
      credits = 0;
    }
    if (credits < 1) {
      setBusy(null);
      setBoostOpen(true);
      return;
    }
    try {
      await publish(await buildBody(), true);
    } catch (e) {
      toast.error(errMsg(e, 'Could not create post. Please try again.'));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  /** Before paying: upload the media and save the draft so it survives the Paystack / 3-D Secure redirect. */
  const prepareBoost = async () => {
    const sig = draftSig();
    try {
      let body = prepared.current?.sig === sig ? prepared.current.body : null;
      if (!body) {
        body = await buildBody();
        prepared.current = { sig, body };
      }
      saveBoostDraft({ kind: 'new', body, startedAt: Date.now() });
      return true;
    } catch (e) {
      toast.error(errMsg(e, 'Could not upload your media. Please try again.'));
      return false;
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  /** Paid in this page (Stripe) and the credit is on the account: publish the saved draft boosted. */
  const afterBoostPaid = async () => {
    setBoostOpen(false);
    const d = takeBoostDraft();
    const body = d?.kind === 'new' ? d.body : prepared.current?.body;
    if (!body) {
      toast.ok('Boost credit added. Tap Boost to publish your post.');
      return;
    }
    try {
      await publish(body, true);
      prepared.current = null;
    } catch (e) {
      toast.error(errMsg(e, 'Payment received, but the post could not be published. Tap Boost to try again; your credit is saved.'));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const togglePoll = () => {
    if (!pollOn && files.length) {
      toast.error('Remove photo and video attachments before creating a poll.');
      return;
    }
    setPollOn((v) => !v);
    setFocused(true);
    mention.close();
    requestAnimationFrame(() => taRef.current?.focus());
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fl: File[] = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    void addFiles(fl);
  };

  const dropProps = {
    onDragOver: (e: { preventDefault(): void; dataTransfer: DataTransfer }) => e.preventDefault(),
    onDrop: (e: { preventDefault(): void; dataTransfer: DataTransfer }) => {
      e.preventDefault();
      void addFiles(e.dataTransfer.files);
    },
  };

  const textarea = (
    <textarea
      ref={taRef}
      className={sheet ? 'hp-cps-input' : 'hp-composer-input'}
      rows={sheet ? 5 : expanded ? 3 : 1}
      placeholder={pollOn ? 'Ask a question…' : sheet ? 'Create a post… Tag people with @ or add #hashtags' : 'Create a post… add #hashtags'}
      aria-label={pollOn ? 'Poll question' : 'Create a post'}
      value={text}
      disabled={!!busy}
      onFocus={() => setFocused(true)}
      onChange={(e) => {
        setText(e.target.value);
        if (!pollOn) mention.detect(e.target.value, e.target.selectionStart ?? e.target.value.length);
      }}
      onBlur={() => setTimeout(mention.close, 200)}
      onPaste={(e) => {
        const fs = Array.from(e.clipboardData.files || []) as File[];
        if (fs.length) {
          e.preventDefault();
          void addFiles(fs);
        }
      }}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit();
      }}
    />
  );

  const thumbs = files.length > 0 && (
    <div className="hp-thumbs">
      {files.map((f) => (
        <div className={'hp-thumb' + (f.kind === 'video' ? ' hp-thumb-video' : '')} key={f.id}>
          {f.kind === 'video' ? (
            <>
              <video src={f.url + '#t=0.1'} muted playsInline preload="metadata" />
              <span className="hp-thumb-badge">
                <I name="video" size={12} /> {fmtDur(f.seconds) || 'Video'}
              </span>
            </>
          ) : (
            <img src={f.url} alt="" />
          )}
          <button type="button" aria-label={f.kind === 'video' ? 'Remove video' : 'Remove image'} onClick={() => removeFile(f.id)} disabled={!!busy}>
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  );

  const pollEdit = pollOn && (
    <div className="hp-poll-edit">
      <div className="hp-poll-head">
        <b className="small">Poll options</b>
        <span className={'tiny ' + (qLen > POLL_MAX ? 'hp-err' : 'muted')}>
          Question {qLen}/{POLL_MAX}
        </span>
      </div>
      {options.map((o, i) => (
        <div className="hp-pe-opt" key={i}>
          <input
            className="input"
            placeholder={`Option ${i + 1}`}
            aria-label={`Option ${i + 1}`}
            maxLength={80}
            value={o}
            disabled={!!busy}
            onChange={(e) => setOptions((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
          />
          {options.length > 2 && (
            <button type="button" className="icon-btn" aria-label={`Remove option ${i + 1}`} disabled={!!busy} onClick={() => setOptions((prev) => prev.filter((_, j) => j !== i))}>
              <Icon name="close" size={18} />
            </button>
          )}
        </div>
      ))}
      {options.length < 4 && (
        <button type="button" className="btn btn-ghost btn-sm hp-poll-add" disabled={!!busy} onClick={() => setOptions((p) => [...p, ''])}>
          <Icon name="plus" size={16} /> Add option
        </button>
      )}
      <div className="hp-poll-dur">
        <span className="muted small">Poll length</span>
        <div className="hp-poll-dur-chips" role="radiogroup" aria-label="Poll length">
          {DURATIONS.map((d) => (
            <button type="button" key={d} role="radio" aria-checked={duration === d} className={'chip' + (duration === d ? ' active' : '')} disabled={!!busy} onClick={() => setDuration(d)}>
              {d}h
            </button>
          ))}
        </div>
      </div>
      {!optsUnique && <div className="tiny hp-err">Poll options must be different.</div>}
    </div>
  );

  const progressBar = progress != null && (
    <div className="hp-upload" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-label="Upload progress">
      <div className="hp-upload-track">
        <div className="hp-upload-fill" style={{ width: `${Math.max(3, Math.round(progress * 100))}%` }} />
      </div>
      <span className="tiny muted">{busy}</span>
    </div>
  );

  const pollTool = (
    <button type="button" key="poll" className={'hp-tool hp-tool-poll' + (pollOn ? ' on' : '')} disabled={!!busy} onClick={togglePoll} title={pollOn ? 'Remove poll' : 'Poll'} aria-label={pollOn ? 'Remove poll' : 'Poll'} aria-pressed={pollOn}>
      <I name="poll" size={20} />
      <span>Poll</span>
    </button>
  );
  const photoTool = (
    <label key="photo" className={'hp-tool hp-tool-photo' + (mediaDisabled ? ' disabled' : '')} title="Add photos" aria-disabled={mediaDisabled}>
      <input className="hp-file" type="file" accept="image/*" multiple disabled={mediaDisabled} onChange={onPick} aria-label="Add photos" />
      <Icon name="image" size={20} />
      <span>Photo</span>
    </label>
  );
  const videoTool = (
    <label key="video" className={'hp-tool hp-tool-video' + (mediaDisabled ? ' disabled' : '')} title="Add a video" aria-disabled={mediaDisabled}>
      <input className="hp-file" type="file" accept="video/*" disabled={mediaDisabled} onChange={onPick} aria-label="Add a video" />
      <I name="video" size={20} />
      <span>Video</span>
    </label>
  );
  const postLabel = busy ? (progress != null ? `${Math.round(progress * 100)}%` : 'Posting…') : 'Post';
  const boostBtn = (
    <button type="button" className={'hp-boost-btn' + (canPost ? ' on' : '')} disabled={!canPost} onClick={() => void boost()} aria-label="Boost post">
      <I name="rocket" size={14} />
      <span>Boost</span>
    </button>
  );
  const boostModal = (
    <BoostCheckoutModal open={boostOpen} onClose={() => setBoostOpen(false)} prepare={prepareBoost} onConfirmed={() => void afterBoostPaid()} next="/" />
  );

  if (sheet) {
    return (
      <>
      <div className={'hp-cps' + (pollOn ? ' poll' : '')} {...dropProps}>
        <div className="hp-cps-head">
          <button type="button" className="hp-cps-close" aria-label="Close create post" disabled={!!busy} onClick={sheet.onClose}>
            <Icon name="close" size={22} />
          </button>
          <div className="hp-cps-title">Create post</div>
          {boostBtn}
          <button type="button" className="hp-cps-post" disabled={!canPost} onClick={submit}>
            {postLabel}
          </button>
        </div>
        <div className="hp-cps-body">
          <div className="hp-cps-user">
            <Avatar src={user?.imageUrl} name={user?.name} size={44} />
            <div className="hp-cps-who">
              <div className="hp-cps-name">{user?.name || 'You'}</div>
              <div className="hp-cps-sub">You</div>
            </div>
          </div>
          {textarea}
          {!pollOn && mention.list}
          {pollEdit}
          {!pollOn && thumbs}
          {progressBar}
        </div>
        <div className="hp-cps-bar">
          {pollTool}
          {photoTool}
          {videoTool}
          {checking && <span className="tiny muted hp-checking">Checking video…</span>}
        </div>
      </div>
      {boostModal}
      </>
    );
  }

  return (
    <>
    <div className={'hp-composer' + (expanded ? ' open' : '') + (keep ? ' keep' : '')} {...dropProps}>
      <div className="hp-composer-top">
        <Avatar src={user?.imageUrl} name={user?.name} size={42} />
        {textarea}
      </div>

      {!pollOn && mention.list}
      {thumbs}
      {pollEdit}
      {progressBar}

      <div className="hp-composer-bar">
        <div className="hp-tools">
          {photoTool}
          {videoTool}
          {pollTool}
        </div>
        {checking && <span className="tiny muted hp-checking">Checking video…</span>}
        {boostBtn}
        <button type="button" className="btn btn-sm hp-post-btn" disabled={!canPost} onClick={submit}>
          {postLabel}
        </button>
      </div>
    </div>
    {boostModal}
    </>
  );
}

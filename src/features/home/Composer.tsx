import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { APP_LINKS } from '../../lib/env';
import { Avatar, Icon, toast } from '../../ui/kit';
import { I } from './icons';
import { createPost, errMsg, getPost, MAX_ATTACHMENTS, uploadImage, type Post } from './api';

type Pick = { file: File; url: string };
const DURATIONS = [24, 48, 72] as const;

export function Composer({ onCreated }: { onCreated: (p: Post) => void }) {
  const { user } = useAuth();
  const [text, setText] = useState('');
  const [files, setFiles] = useState<Pick[]>([]);
  const [pollOn, setPollOn] = useState(false);
  const [options, setOptions] = useState<string[]>(['', '']);
  const [duration, setDuration] = useState<24 | 48 | 72>(24);
  const [busy, setBusy] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [videoNote, setVideoNote] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => () => files.forEach((f) => URL.revokeObjectURL(f.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  // auto-grow textarea
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(320, ta.scrollHeight) + 'px';
  }, [text]);

  const addFiles = (list: FileList | File[] | null) => {
    if (!list) return;
    const arr = Array.from(list);
    if (arr.some((f) => f.type.startsWith('video/'))) setVideoNote(true);
    const imgs = arr.filter((f) => f.type.startsWith('image/'));
    if (!imgs.length) return;
    if (pollOn) {
      toast.error('Remove the poll before adding photos.');
      return;
    }
    setFiles((prev) => {
      const room = MAX_ATTACHMENTS - prev.length;
      if (imgs.length > room) toast.error(`You can attach up to ${MAX_ATTACHMENTS} items per post.`);
      return [...prev, ...imgs.slice(0, Math.max(0, room)).map((file) => ({ file, url: URL.createObjectURL(file) }))];
    });
  };

  const removeFile = (i: number) =>
    setFiles((prev) => {
      URL.revokeObjectURL(prev[i].url);
      return prev.filter((_, j) => j !== i);
    });

  const cleanOpts = options.map((o) => o.trim()).filter(Boolean);
  const optsUnique = new Set(cleanOpts.map((o) => o.toLowerCase())).size === cleanOpts.length;
  const pollValid = text.trim().length > 0 && text.trim().length <= 280 && cleanOpts.length >= 2 && cleanOpts.length <= 4 && optsUnique && cleanOpts.every((o) => o.length <= 80);
  const canPost = !busy && (pollOn ? pollValid : text.trim().length > 0 || files.length > 0);
  const expanded = focused || !!text || files.length > 0 || pollOn;

  const reset = () => {
    files.forEach((f) => URL.revokeObjectURL(f.url));
    setText('');
    setFiles([]);
    setPollOn(false);
    setOptions(['', '']);
    setDuration(24);
    setFocused(false);
  };

  const submit = async () => {
    if (busy) return;
    if (!canPost) {
      if (pollOn && !optsUnique) toast.error('Poll options must be different.');
      else if (pollOn) toast.error('Add a question and at least two options.');
      else toast.error('Add text or at least one image.');
      return;
    }
    try {
      let imageArr: any[] = [];
      if (!pollOn && files.length) {
        let done = 0;
        setBusy(`Uploading 0/${files.length}…`);
        const batches = await Promise.all(
          files.map(async (f) => {
            const r = await uploadImage(f.file);
            done += 1;
            setBusy(`Uploading ${done}/${files.length}…`);
            return r;
          }),
        );
        imageArr = batches.flat();
      }
      setBusy('Posting…');
      const id = await createPost(
        pollOn ? { caption: '', imageArr: [], poll: { question: text.trim(), options: cleanOpts, durationHours: duration } } : { caption: text.trim(), imageArr },
      );
      let post: Post | null = null;
      if (id) {
        try {
          post = await getPost(id);
        } catch {
          post = null;
        }
      }
      toast.ok('Post created successfully.');
      reset();
      if (post) onCreated(post);
      else onCreated({ statusPostId: id || Date.now(), caption: pollOn ? '' : text.trim(), createdBy: user?.id || '', createdTime: Math.floor(Date.now() / 1000), imageArr, userDetails: [{ userId: user?.id || '', fullName: user?.name, imageDetails: user?.imageUrl ? { imgLink: user.imageUrl } : undefined }] });
    } catch (e) {
      toast.error(errMsg(e, 'Could not create post. Please try again.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className={'hp-composer' + (expanded ? ' open' : '')}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        addFiles(e.dataTransfer.files);
      }}
    >
      <div className="hp-composer-top">
        <Avatar src={user?.imageUrl} name={user?.name} size={42} />
        <textarea
          ref={taRef}
          className="hp-composer-input"
          rows={expanded ? 3 : 1}
          placeholder={pollOn ? 'Ask a question…' : 'Create a post… add #hashtags'}
          value={text}
          maxLength={pollOn ? 280 : undefined}
          disabled={!!busy}
          onFocus={() => setFocused(true)}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const fs = Array.from(e.clipboardData.files || []) as File[];
            if (fs.length) {
              e.preventDefault();
              addFiles(fs);
            }
          }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit();
          }}
        />
      </div>

      {files.length > 0 && (
        <div className="hp-thumbs">
          {files.map((f, i) => (
            <div className="hp-thumb" key={f.url}>
              <img src={f.url} alt="" />
              <button aria-label="Remove image" onClick={() => removeFile(i)} disabled={!!busy}>
                <Icon name="close" size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {pollOn && (
        <div className="hp-poll-edit">
          {options.map((o, i) => (
            <div className="row" key={i}>
              <input
                className="input"
                placeholder={`Option ${i + 1}`}
                maxLength={80}
                value={o}
                disabled={!!busy}
                onChange={(e) => setOptions((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
              />
              {options.length > 2 && (
                <button className="icon-btn" aria-label="Remove option" onClick={() => setOptions((prev) => prev.filter((_, j) => j !== i))}>
                  <Icon name="close" size={18} />
                </button>
              )}
            </div>
          ))}
          <div className="row between">
            {options.length < 4 ? (
              <button className="btn btn-ghost btn-sm" onClick={() => setOptions((p) => [...p, ''])}>
                <Icon name="plus" size={16} /> Add option
              </button>
            ) : (
              <span />
            )}
            <div className="row" style={{ gap: 6 }}>
              <span className="muted small">Duration</span>
              {DURATIONS.map((d) => (
                <button key={d} className={'chip' + (duration === d ? ' active' : '')} onClick={() => setDuration(d)}>
                  {d}h
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {videoNote && (
        <div className="hp-note">
          <div className="grow">
            <b>Video posts are uploaded from the i'llTip app.</b>
            <div className="muted small">Videos are compressed on your phone before upload, so this step needs the app.</div>
          </div>
          <div className="row-wrap">
            <a className="btn btn-sm btn-dark" href={APP_LINKS.ios} target="_blank" rel="noreferrer">
              App Store
            </a>
            <a className="btn btn-sm btn-dark" href={APP_LINKS.android} target="_blank" rel="noreferrer">
              Google Play
            </a>
            <button className="icon-btn" aria-label="Dismiss" onClick={() => setVideoNote(false)}>
              <Icon name="close" size={18} />
            </button>
          </div>
        </div>
      )}

      <div className="hp-composer-bar">
        <input ref={fileRef} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => (addFiles(e.target.files), (e.target.value = ''))} />
        <button className="hp-tool" disabled={!!busy || pollOn || files.length >= MAX_ATTACHMENTS} onClick={() => fileRef.current?.click()} title="Add photos">
          <Icon name="image" size={20} /> <span>Photo</span>
        </button>
        <button className="hp-tool" disabled={!!busy} onClick={() => setVideoNote(true)} title="Add a video">
          <I name="video" size={20} /> <span>Video</span>
        </button>
        <button
          className={'hp-tool' + (pollOn ? ' on' : '')}
          disabled={!!busy}
          onClick={() => {
            if (!pollOn && files.length) {
              toast.error('Remove photo attachments before creating a poll.');
              return;
            }
            setPollOn((v) => !v);
            setFocused(true);
          }}
          title="Create poll"
        >
          <I name="poll" size={20} /> <span>Poll</span>
        </button>
        <span className="grow" />
        {pollOn && <span className={'tiny ' + (text.trim().length > 280 ? 'hp-err' : 'muted')}>{text.trim().length}/280</span>}
        <button className="btn btn-sm hp-post-btn" disabled={!canPost} onClick={submit}>
          {busy || 'Post'}
        </button>
      </div>
    </div>
  );
}

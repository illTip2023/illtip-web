import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { APP_LINKS } from '../../lib/env';
import { Avatar, Icon, toast } from '../../ui/kit';
import { I } from './icons';
import { createPost, errMsg, getPost, MAX_ATTACHMENTS, mentionNameOf, personFromRaw, remapMentions, searchPeople, uploadImage, type Mention, type Post } from './api';

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

  /* ---- @mentions: type @ and a name (full names with spaces work, e.g. "@Blessing Ikpia") ---- */
  const [tagged, setTagged] = useState<Mention[]>([]);
  const [mq, setMq] = useState<{ q: string; start: number } | null>(null);
  const [people, setPeople] = useState<{ userId: string; name: string; avatar?: string; profession?: string }[]>([]);
  const [peopleBusy, setPeopleBusy] = useState(false);
  const detectMention = (value: string, caret: number) => {
    const before = value.slice(0, caret);
    const m = before.match(/(?:^|\s)@([^@\n]{0,40})$/);
    if (!m || m[1].split(/\s+/).filter(Boolean).length > 3 || /\s{2,}$/.test(m[1])) return setMq(null);
    setMq({ q: m[1], start: caret - m[1].length - 1 });
  };
  useEffect(() => {
    const q = mq?.q.trim() || '';
    if (!mq || !q) {
      setPeople([]);
      return;
    }
    let alive = true;
    setPeopleBusy(true);
    const t = setTimeout(async () => {
      try {
        const rows = await searchPeople(q, 1);
        if (!alive) return;
        const ql = q.toLowerCase();
        const list = rows
          .map((r) => ({ ...personFromRaw(r), name: mentionNameOf(r) }))
          .filter((p) => p.userId && p.name && p.userId !== user?.id)
          .sort((a, b) => Number(!a.name.toLowerCase().startsWith(ql)) - Number(!b.name.toLowerCase().startsWith(ql)) || Number(!a.name.toLowerCase().includes(ql)) - Number(!b.name.toLowerCase().includes(ql)))
          .slice(0, 8);
        setPeople(list);
      } catch {
        if (alive) setPeople([]);
      } finally {
        if (alive) setPeopleBusy(false);
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [mq?.q]); // eslint-disable-line react-hooks/exhaustive-deps
  const pickPerson = (p: { userId: string; name: string }) => {
    if (!mq) return;
    const ta = taRef.current;
    const caret = ta ? ta.selectionStart : text.length;
    const insert = '@' + p.name + ' ';
    const next = text.slice(0, mq.start) + insert + text.slice(caret);
    setText(next);
    setTagged((t) => (t.some((x) => x.userId === p.userId) ? t : [...t, { userId: p.userId, displayName: p.name, start: 0, length: 0 }]));
    setMq(null);
    setPeople([]);
    requestAnimationFrame(() => {
      const pos = mq.start + insert.length;
      ta?.focus();
      ta?.setSelectionRange(pos, pos);
    });
  };

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
    setTagged([]);
    setMq(null);
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
        pollOn ? { caption: '', imageArr: [], poll: { question: text.trim(), options: cleanOpts, durationHours: duration } } : { caption: text.trim(), imageArr, mentions: remapMentions(text.trim(), tagged) },
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
          onChange={(e) => {
            setText(e.target.value);
            if (!pollOn) detectMention(e.target.value, e.target.selectionStart ?? e.target.value.length);
          }}
          onBlur={() => setTimeout(() => setMq(null), 200)}
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

      {mq && mq.q.trim() && (
        <div className="hp-mentions" role="listbox" aria-label="Tag someone">
          {people.map((p) => (
            <button key={p.userId} type="button" role="option" className="hp-mention-opt" onMouseDown={(e) => e.preventDefault()} onClick={() => pickPerson(p)}>
              <Avatar src={p.avatar} name={p.name} size={30} />
              <span className="grow ellipsis">
                <b>{p.name}</b>
                {p.profession && <span className="muted tiny"> · {p.profession}</span>}
              </span>
            </button>
          ))}
          {!people.length && <div className="muted small" style={{ padding: '8px 12px' }}>{peopleBusy ? 'Searching…' : 'No one found. Try their full name or surname.'}</div>}
        </div>
      )}

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

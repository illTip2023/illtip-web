import React, { useEffect, useState, type RefObject } from 'react';
import { Avatar } from '../../ui/kit';
import { mentionNameOf, personFromRaw, searchPeople, type Mention } from './api';

type Person = { userId: string; name: string; avatar?: string; profession?: string };

/**
 * @mention picker shared by the post composer and the comment box (the app uses useMentionComposer for both).
 * Type @ and a name (full names with spaces work, e.g. "@Blessing Ikpia"), pick a person, and the tag is kept
 * as { userId, displayName }; call remapMentions(text, tagged) at send time to get start/length.
 */
export function useMentionPicker(opts: {
  text: string;
  setText: (v: string) => void;
  taRef: RefObject<HTMLTextAreaElement | null>;
  selfId?: string;
}) {
  const { text, setText, taRef, selfId } = opts;
  const [tagged, setTagged] = useState<Mention[]>([]);
  const [mq, setMq] = useState<{ q: string; start: number } | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [busy, setBusy] = useState(false);

  const detect = (value: string, caret: number) => {
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
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const rows = await searchPeople(q, 1);
        if (!alive) return;
        const ql = q.toLowerCase();
        const list = rows
          .map((r) => ({ ...personFromRaw(r), name: mentionNameOf(r) }))
          .filter((p) => p.userId && p.name && p.userId !== selfId)
          .sort(
            (a, b) =>
              Number(!a.name.toLowerCase().startsWith(ql)) - Number(!b.name.toLowerCase().startsWith(ql)) ||
              Number(!a.name.toLowerCase().includes(ql)) - Number(!b.name.toLowerCase().includes(ql)),
          )
          .slice(0, 8);
        setPeople(list);
      } catch {
        if (alive) setPeople([]);
      } finally {
        if (alive) setBusy(false);
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [mq?.q]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (p: { userId: string; name: string }) => {
    if (!mq) return;
    const ta = taRef.current;
    const caret = ta ? ta.selectionStart : text.length;
    const insert = '@' + p.name + ' ';
    const next = text.slice(0, mq.start) + insert + text.slice(caret);
    setText(next);
    setTagged((t) => (t.some((x) => x.userId === p.userId) ? t : [...t, { userId: p.userId, displayName: p.name, start: 0, length: 0 }]));
    setMq(null);
    setPeople([]);
    const pos = mq.start + insert.length;
    requestAnimationFrame(() => {
      ta?.focus();
      ta?.setSelectionRange(pos, pos);
    });
  };

  const clear = () => {
    setTagged([]);
    setMq(null);
    setPeople([]);
  };

  const close = () => setMq(null);

  const list =
    mq && mq.q.trim() ? (
      <div className="hp-mentions" role="listbox" aria-label="Tag someone">
        {people.map((p) => (
          <button key={p.userId} type="button" role="option" aria-selected={false} className="hp-mention-opt" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(p)}>
            <Avatar src={p.avatar} name={p.name} size={30} />
            <span className="grow ellipsis">
              <b>{p.name}</b>
              {p.profession && <span className="muted tiny"> · {p.profession}</span>}
            </span>
          </button>
        ))}
        {!people.length && <div className="muted small" style={{ padding: '8px 12px' }}>{busy ? 'Searching…' : 'No one found. Try their full name or surname.'}</div>}
      </div>
    ) : null;

  return { tagged, detect, pick, clear, close, list };
}

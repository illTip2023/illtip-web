import { openWatch } from './ViewerOpen';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AutoVideo } from '../../ui/AutoVideo';
import { currentPath, Link, navigate } from '../../lib/router';
import { useAuth } from '../../lib/auth';
import { BuyCoinsFlow, BuyCoinsPrompt, stepTitle as buyStepTitle } from '../coins/BuyCoins';
import { rainCoins } from '../coins/CoinRain';
import { setQueryData, invalidate, useQuery } from '../../lib/query';
import { Avatar, Icon, Modal, compactNumber, toast } from '../../ui/kit';
import { followUser, unfollowUser } from '../profile/api';
import { api } from '../../lib/api';
import { I } from './icons';
import {
  authorOf,
  bookmarkPost,
  coinTotal,
  deletePost,
  editPost,
  remapMentions,
  epochMs,
  errMsg,
  fetchCoinBalance,
  fetchPoll,
  flagPost,
  isBoosted,
  isSponsored,
  likePost,
  mediaOf,
  recordView,
  shareUrl,
  tipPost,
  votePoll,
  type Media,
  type Mention,
  type Post,
} from './api';
import { coinStore, patchPost, setSaved, useCoinBalance, usePostPatch, useSavedIds } from './store';
import { ComboTipButton } from './ComboTip';
import { CommentSheet } from './CommentSheet';
import { BoostCheckoutModal, boostExistingPost, fetchBoostCredits, isNoBoostCreditError, saveBoostDraft, takeBoostDraft } from '../plans/boost';

/* ---------------- caption ---------------- */

type Seg = { t: 'text'; v: string } | { t: 'mention'; v: string; userId: string } | { t: 'tag'; v: string; tag: string } | { t: 'url'; v: string; href: string };

function splitText(text: string, links: boolean): Seg[] {
  const out: Seg[] = [];
  const re = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)|#([A-Za-z0-9_]{1,40})(?![A-Za-z0-9_])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = m.index;
    if (m[2]) {
      const prev = start > 0 ? text[start - 1] : '';
      if (prev && /[\p{L}\p{N}_\/#&]/u.test(prev)) continue;
    } else if (!links) continue;
    if (start > last) out.push({ t: 'text', v: text.slice(last, start) });
    if (m[1]) {
      let url = m[1];
      let trail = '';
      while (/[.,;:!?)\]}'"]$/.test(url)) {
        trail = url.slice(-1) + trail;
        url = url.slice(0, -1);
      }
      out.push({ t: 'url', v: url, href: /^https?:/i.test(url) ? url : `https://${url}` });
      if (trail) out.push({ t: 'text', v: trail });
    } else out.push({ t: 'tag', v: m[0], tag: m[2].toLowerCase() });
    last = start + m[0].length;
  }
  if (last < text.length) out.push({ t: 'text', v: text.slice(last) });
  return out;
}

export function parseCaption(text: string, mentions: Mention[] | undefined, links: boolean): Seg[] {
  const valid = (mentions || [])
    .filter((m) => m && m.userId && Number.isFinite(m.start) && m.length > 0 && m.start >= 0 && m.start + m.length <= text.length)
    .sort((a, b) => a.start - b.start);
  const out: Seg[] = [];
  let cursor = 0;
  for (const m of valid) {
    if (m.start < cursor) continue;
    if (m.start > cursor) out.push(...splitText(text.slice(cursor, m.start), links));
    out.push({ t: 'mention', v: text.slice(m.start, m.start + m.length), userId: String(m.userId) });
    cursor = m.start + m.length;
  }
  if (cursor < text.length) out.push(...splitText(text.slice(cursor), links));
  return out;
}

export function RichText({ text, mentions, links }: { text: string; mentions?: Mention[]; links?: boolean }) {
  const segs = useMemo(() => parseCaption(text, mentions, !!links), [text, mentions, links]);
  return (
    <>
      {segs.map((s, i) =>
        s.t === 'text' ? (
          <React.Fragment key={i}>{s.v}</React.Fragment>
        ) : s.t === 'mention' ? (
          <Link key={i} to={`/u/${encodeURIComponent(s.userId)}`} className="hp-mention">
            {s.v}
          </Link>
        ) : s.t === 'tag' ? (
          <Link key={i} to={`/search?q=${encodeURIComponent('#' + s.tag)}`} className="hp-tag">
            {s.v}
          </Link>
        ) : (
          <a key={i} href={s.href} target="_blank" rel="noopener noreferrer nofollow" className="hp-url">
            {s.v}
          </a>
        ),
      )}
    </>
  );
}

function Caption({ post, text, full, onOpen }: { post: Post; text: string; full?: boolean; onOpen?: () => void }) {
  // App (ProfileCard ExpandableCaption): 5 lines, then "... show more" / "Show less".
  const long = text.length > 260 || text.split('\n').length > 5;
  const [open, setOpen] = useState(!!full);
  if (!text.trim()) return null;
  return (
    <div
      className={'hp-caption pre' + (onOpen ? ' hp-clickable' : '')}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a,button')) return;
        onOpen?.();
      }}
    >
      <div className={!open && long ? 'hp-clamp' : ''}>
        <RichText text={text} mentions={post.mentions} links={isBoosted(post)} />
      </div>
      {long && !full && (
        <button
          className="hp-more"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
        >
          {open ? 'Show less' : '... show more'}
        </button>
      )}
    </div>
  );
}

/* ---------------- media ---------------- */

function MediaView({ m, onOpen, cover, onOpenPost }: { m: Media; onOpen?: () => void; cover?: boolean; onOpenPost?: () => void }) {
  const [bad, setBad] = useState(false);
  if (m.kind === 'video') {
    return (
      <AutoVideo className="hp-video" src={m.url} poster={m.poster} onTap={onOpenPost} />
    );
  }
  if (bad) return <div className="hp-media-missing muted small">Image unavailable</div>;
  return <img className={'hp-img' + (cover ? ' cover' : '') + (onOpen ? ' hp-clickable' : '')} src={m.url} alt="" loading="lazy" decoding="async" onClick={onOpen} onError={() => setBad(true)} />;
}

export function PostMedia({ post, onOpenImage, onOpenPost }: { post: Post; onOpenImage?: (index: number) => void; onOpenPost?: () => void }) {
  const media = useMemo(() => mediaOf(post), [post]);
  const track = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);
  if (!media.length) return null;
  if (media.length === 1) {
    return (
      <div className="hp-media">
        <MediaView m={media[0]} onOpen={onOpenImage ? () => onOpenImage(0) : undefined} onOpenPost={onOpenPost} />
      </div>
    );
  }
  const go = (i: number) => {
    const el = track.current;
    if (!el) return;
    const n = Math.max(0, Math.min(media.length - 1, i));
    el.scrollTo({ left: n * el.clientWidth, behavior: 'smooth' });
  };
  return (
    <div className="hp-media hp-carousel-wrap">
      <div
        className="hp-carousel"
        ref={track}
        onScroll={(e) => {
          const el = e.currentTarget;
          const n = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
          if (n !== idx) setIdx(n);
        }}
      >
        {media.map((m, i) => (
          <div className="hp-slide" key={m.key}>
            <MediaView m={m} cover={false} onOpen={onOpenImage ? () => onOpenImage(i) : undefined} onOpenPost={onOpenPost} />
          </div>
        ))}
      </div>
      <span className="hp-count">
        {idx + 1}/{media.length}
      </span>
      {idx > 0 && (
        <button className="hp-nav prev" aria-label="Previous" onClick={() => go(idx - 1)}>
          <I name="left" />
        </button>
      )}
      {idx < media.length - 1 && (
        <button className="hp-nav next" aria-label="Next" onClick={() => go(idx + 1)}>
          <I name="right" />
        </button>
      )}
      <div className="hp-dots">
        {media.map((m, i) => (
          <span key={m.key} className={i === idx ? 'on' : ''} />
        ))}
      </div>
    </div>
  );
}

function Lightbox({ post, index, onClose }: { post: Post; index: number | null; onClose: () => void }) {
  const media = useMemo(() => mediaOf(post).filter((m) => m.kind === 'image'), [post]);
  const all = useMemo(() => mediaOf(post), [post]);
  const [i, setI] = useState(0);
  useEffect(() => {
    if (index == null) return;
    const target = all[index];
    setI(Math.max(0, media.findIndex((m) => m.key === target?.key)));
  }, [index, all, media]);
  useEffect(() => {
    if (index == null) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setI((x) => Math.min(media.length - 1, x + 1));
      if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [index, media.length, onClose]);
  if (index == null || !media[i]) return null;
  return (
    <div className="hp-lightbox" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <button className="hp-lb-close" aria-label="Close" onClick={onClose}>
        <Icon name="close" />
      </button>
      {i > 0 && (
        <button className="hp-nav prev" aria-label="Previous" onClick={() => setI(i - 1)}>
          <I name="left" />
        </button>
      )}
      <img src={media[i].url} alt="" />
      {i < media.length - 1 && (
        <button className="hp-nav next" aria-label="Next" onClick={() => setI(i + 1)}>
          <I name="right" />
        </button>
      )}
    </div>
  );
}

/* ---------------- poll ---------------- */

export function PollCard({ post }: { post: Post }) {
  const poll = post.poll;
  const id = Number(post.statusPostId);
  const key = poll?.options?.length ? `home:poll:${id}` : null;
  const q = useQuery(key, () => fetchPoll(id), { staleMs: 15_000 });
  const [voting, setVoting] = useState<string | null>(null);
  if (!poll || !poll.options?.length) return null;
  const data = q.data;
  const expiresAt = epochMs(data?.expiresAt ?? poll.expiresAt);
  const expired = data?.isExpired ?? (expiresAt > 0 && expiresAt <= Date.now());
  const visible = data?.resultsVisible === true || expired;
  const options = data?.options ?? poll.options.map((o) => ({ ...o, voteCount: null, percentage: null }));
  const hoursLeft = Math.max(1, Math.ceil((expiresAt - Date.now()) / 3.6e6));
  const total = Number(data?.totalVotes ?? 0);

  const vote = async (optionId: string) => {
    if (expired || data?.hasVoted || voting) return;
    setVoting(optionId);
    try {
      const res = await votePoll(id, optionId);
      if (key) setQueryData(key, () => res);
    } catch (e) {
      toast.error(errMsg(e, 'Could not record your vote'));
    } finally {
      setVoting(null);
    }
  };

  return (
    <div className="hp-poll">
      <div className="hp-poll-q">{data?.question || poll.question}</div>
      <div className="hp-poll-opts">
        {options.map((o) => {
          const sel = o.optionId === (data?.selectedOptionId ?? voting);
          const pct = Math.max(0, Math.min(100, Number(o.percentage ?? 0)));
          return (
            <button key={o.optionId} className={'hp-poll-opt' + (sel ? ' sel' : '')} disabled={expired || !!data?.hasVoted || !!voting} onClick={() => vote(o.optionId)}>
              {visible && <span className="hp-poll-bar" style={{ width: pct + '%' }} />}
              <span className="hp-poll-text">{o.text}</span>
              <span className="hp-poll-meta">
                {sel && <Icon name="check" size={16} />}
                {visible && <span>{Math.round(pct)}%</span>}
              </span>
            </button>
          );
        })}
      </div>
      <div className="muted tiny">
        {visible ? `${total} ${total === 1 ? 'vote' : 'votes'}` : 'Vote to see results'} · {expired ? 'Poll ended' : `${hoursLeft}h left`}
      </div>
    </div>
  );
}

/* ---------------- tipping ---------------- */

export function BuyCoinsCard({ compact, onBuy }: { compact?: boolean; onBuy: () => void }) {
  return <BuyCoinsPrompt compact={compact} onBuy={onBuy} />;
}

const TIP_PRESETS = [
  { coins: 1, label: 'Tip' },
  { coins: 5, label: 'Paper' },
  { coins: 10, label: 'Pen' },
  { coins: 100, label: 'Suitcase' },
];

/** Legacy amount-picker dialog. Post tip buttons now use ComboTipButton (tap = 1 coin combo, long-press = gifts) like the app; kept exported for any other caller. */
export function TipModal({ post, open, onClose }: { post: Post; open: boolean; onClose: () => void }) {
  const balance = useCoinBalance();
  const [amount, setAmount] = useState(1);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<'tip' | 'buy'>('tip');
  const [buyBusy, setBuyBusy] = useState(false);
  const [buyStep, setBuyStep] = useState('pick');
  const author = authorOf(post);

  useEffect(() => {
    if (!open) return;
    setCustom('');
    setView('tip');
    setLoading(true);
    fetchCoinBalance()
      .then((b) => coinStore.set(b))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open]);

  const n = custom ? Math.floor(Number(custom)) : amount;
  const validN = Number.isFinite(n) && n >= 1;
  const short = balance !== undefined && validN && n > balance;

  const send = async () => {
    if (!validN || short || busy) return;
    setBusy(true);
    try {
      const res = await tipPost(post, n);
      const nb = Number(res?.coinBalance);
      coinStore.set(Number.isFinite(nb) ? nb : Math.max(0, (balance ?? n) - n));
      patchPost(Number(post.statusPostId), (old) => ({ coins: (old.coins ?? coinTotal(post)) + n }));
      rainCoins(n);
      toast.ok(`You tipped ${author.name} ${n} coin${n === 1 ? '' : 's'}`);
      onClose();
    } catch (e: any) {
      const nb = Number(e?.data?.data?.coinBalance);
      if (Number.isFinite(nb)) coinStore.set(nb);
      if (e?.status === 402 || /insufficient|not enough|low balance/i.test(String(e?.message))) {
        toast.error('Not enough coins. Recharge to continue tipping.');
        setView('buy');
      } else toast.error(errMsg(e, 'Could not send tip. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (buyBusy) return;
    onClose();
  };

  return (
    <Modal open={open} onClose={close} title={view === 'buy' ? buyStepTitle(buyStep as any) : `Tip ${author.name}`}>
      {view === 'buy' ? (
        <BuyCoinsFlow doneLabel="Continue tipping" onCancel={() => setView('tip')} onDone={() => setView('tip')} onBusyChange={setBuyBusy} onStepChange={setBuyStep} />
      ) : (
        <div className="stack">
          <div className="hp-balance">
            <span className="hp-coin-badge">
              <Icon name="coin" size={22} />
            </span>
            <div className="grow">
              <div className="muted small">Your coin balance</div>
              <div className="hp-balance-n">{balance === undefined ? (loading ? '…' : '—') : compactNumber(balance)}</div>
            </div>
          </div>
          <div>
            <div className="label">Choose an amount</div>
            <div className="hp-tip-grid">
              {TIP_PRESETS.map((p) => (
                <button
                  key={p.coins}
                  className={'hp-tip-opt' + (!custom && amount === p.coins ? ' active' : '')}
                  onClick={() => {
                    setAmount(p.coins);
                    setCustom('');
                  }}
                >
                  <span className="hp-tip-n">{p.coins}</span>
                  <span className="tiny muted">{p.label}</span>
                </button>
              ))}
            </div>
            <input className="input" style={{ marginTop: 10 }} inputMode="numeric" placeholder="Or enter a custom amount" value={custom} onChange={(e) => setCustom(e.target.value.replace(/[^\d]/g, '').slice(0, 6))} />
          </div>
          {short && <div className="hp-warn small">You don't have enough coins for this tip.</div>}
          <button className="btn btn-block" disabled={!validN || short || busy || balance === undefined} onClick={send}>
            <Icon name="coin" size={18} /> {busy ? 'Sending…' : validN ? `Send ${n} coin${n === 1 ? '' : 's'}` : 'Send tip'}
          </button>
          <BuyCoinsCard compact={!short && (balance ?? 0) > 0} onBuy={() => setView('buy')} />
        </div>
      )}
    </Modal>
  );
}

/* ---------------- menu + edit ---------------- */

function PostMenu({ items }: { items: { label: string; icon: React.ReactNode; danger?: boolean; onClick: () => void }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div className="hp-menu" ref={ref}>
      <button className="icon-btn" aria-label="More options" onClick={() => setOpen((v) => !v)}>
        <Icon name="more" />
      </button>
      {open && (
        <div className="hp-menu-pop" role="menu">
          {items.map((it) => (
            <button
              key={it.label}
              className={it.danger ? 'danger' : ''}
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
            >
              {it.icon} {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function EditModal({ post, caption, open, onClose }: { post: Post; caption: string; open: boolean; onClose: () => void }) {
  const [text, setText] = useState(caption);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setText(caption);
  }, [open, caption]);
  const save = async () => {
    setBusy(true);
    try {
      const mentions = remapMentions(text.trim(), post.mentions);
      await editPost(Number(post.statusPostId), text.trim(), post.mentions);
      patchPost(Number(post.statusPostId), { caption: text.trim(), mentions });
      toast.ok('Post updated.');
      onClose();
    } catch (e) {
      toast.error(errMsg(e, 'Could not update post.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Edit post">
      <textarea className="textarea" rows={6} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
        <button className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn" disabled={busy || (!text.trim() && !mediaOf(post).length)} onClick={save}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Modal>
  );
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/* ---------------- time ("3 days ago", like the app's date-fns formatDistanceToNow(..., { addSuffix: true })) ---------------- */

export function distanceToNow(ms: number, now = Date.now()): string {
  if (!ms || !Number.isFinite(ms)) return '';
  const future = ms > now;
  const a = new Date(Math.min(ms, now));
  const b = new Date(Math.max(ms, now));
  const minutes = Math.round((b.getTime() - a.getTime()) / 60000);
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many.replace('{n}', String(n)));
  let out: string;
  if (minutes < 2) out = minutes === 0 ? 'less than a minute' : '1 minute';
  else if (minutes < 45) out = `${minutes} minutes`;
  else if (minutes < 90) out = 'about 1 hour';
  else if (minutes < 1440) out = `about ${Math.round(minutes / 60)} hours`;
  else if (minutes < 2520) out = '1 day';
  else if (minutes < 43200) out = `${Math.round(minutes / 1440)} days`;
  else if (minutes < 86400) out = plural(Math.round(minutes / 43200), 'about 1 month', 'about {n} months');
  else {
    let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
    const shifted = new Date(a.getTime());
    shifted.setMonth(a.getMonth() + months);
    if (shifted.getTime() > b.getTime()) months -= 1;
    if (months < 12) out = plural(Math.round(minutes / 43200), '1 month', '{n} months');
    else {
      const years = Math.floor(months / 12);
      const rest = months % 12;
      if (rest < 3) out = plural(years, 'about 1 year', 'about {n} years');
      else if (rest < 9) out = plural(years, 'over 1 year', 'over {n} years');
      else out = `almost ${years + 1} years`;
    }
  }
  return future ? `in ${out}` : `${out} ago`;
}

/* ---------------- "Network" on the author (app ProfileCard: one shared GET /network/following for the feed) ---------------- */

const followingKey = (me: string) => `home:following:${me}`;
let followingInflight: Record<string, Promise<string[]> | undefined> = {};
function fetchFollowingIds(me: string): Promise<string[]> {
  if (!followingInflight[me]) {
    followingInflight[me] = api
      .get('/network/following', { params: { userId: me } })
      .then(({ data }) => (Array.isArray(data?.data) ? data.data : []).map((r: any) => String(r?.userId ?? '')).filter(Boolean))
      .finally(() => {
        followingInflight[me] = undefined;
      });
  }
  return followingInflight[me]!;
}

function NetworkButton({ me, userId, name }: { me: string; userId: string; name: string }) {
  const q = useQuery(followingKey(me), () => fetchFollowingIds(me), { staleMs: 60_000 });
  const [override, setOverride] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const following = override ?? (q.data || []).includes(userId);
  const run = async (next: boolean) => {
    setPending(true);
    setOverride(next);
    try {
      await (next ? followUser(userId) : unfollowUser(userId));
      setQueryData(followingKey(me), (old: string[] | undefined) => {
        const set = new Set(old || []);
        if (next) set.add(userId);
        else set.delete(userId);
        return [...set];
      });
      invalidate(`net:state:${userId}`);
      setOverride(null);
    } catch {
      setOverride(null);
      toast.error("Couldn't update your network. Please try again.");
    } finally {
      setPending(false);
    }
  };
  return (
    <>
      <button
        type="button"
        className={'hp-net' + (following ? ' on' : '')}
        disabled={pending}
        aria-pressed={following}
        onClick={() => (following ? setConfirm(true) : run(true))}
      >
        {pending ? '...' : following ? 'Networking' : 'Network'}
      </button>
      {confirm && (
        <Modal open={confirm} onClose={() => setConfirm(false)} title="Remove from network">
          <p style={{ marginTop: 0 }}>Remove {name} from your network?</p>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => setConfirm(false)}>
              Cancel
            </button>
            <button
              className="btn btn-danger"
              onClick={() => {
                setConfirm(false);
                void run(false);
              }}
            >
              Remove
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

/* ---------------- action-row glyphs (the app's FontAwesome solid icons) ---------------- */

const ACT: Record<string, string> = {
  eye: 'M12 5C6.6 5 2.9 9.2 1.5 12c1.4 2.8 5.1 7 10.5 7s9.1-4.2 10.5-7C21.1 9.2 17.4 5 12 5zm0 11.8a4.8 4.8 0 1 1 0-9.6 4.8 4.8 0 0 1 0 9.6zm0-7.3a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
  heart: 'M12 21s-7.6-4.6-9.9-9.2C.5 8.4 2.4 4 6.6 4c2.3 0 3.8 1.3 5.4 3.1C13.6 5.3 15.1 4 17.4 4c4.2 0 6.1 4.4 4.5 7.8C19.6 16.4 12 21 12 21z',
  comment: 'M12 3C6.2 3 1.5 6.8 1.5 11.5c0 2.2 1 4.2 2.7 5.7-.3 1.6-1.2 3.1-2.5 4.1 2.4 0 4.6-.8 6.2-2 1.3.4 2.7.6 4.1.6 5.8 0 10.5-3.8 10.5-8.4S17.8 3 12 3z',
  bookmark: 'M5.5 2h13A1.5 1.5 0 0 1 20 3.5V22l-8-4.9L4 22V3.5A1.5 1.5 0 0 1 5.5 2z',
  share: 'M22 10.5 14 3v4.4C6.6 8.2 2.6 13.4 2 20.5c2.6-3.6 6.3-5.3 12-5.4V19.6z',
};
function ActIcon({ name }: { name: keyof typeof ACT }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" aria-hidden>
      <path d={ACT[name]} />
    </svg>
  );
}

/* ---------------- card ---------------- */

export function PostCard({ post, detail, onDeleted, onCommentClick }: { post: Post; detail?: boolean; onDeleted?: () => void; onCommentClick?: () => void }) {
  const { user } = useAuth();
  const id = Number(post.statusPostId);
  const patch = usePostPatch(id);
  const saved = useSavedIds();
  const author = authorOf(post);
  const isOwn = !!user && (String(post.createdBy) === String(user.id) || author.userId === String(user.id));
  const liked = patch.liked ?? !!post.amILiked;
  const likeCount = patch.likeCount ?? (post.likedArr?.length || 0);
  const comments = patch.comments ?? (post.commentArr?.length || 0);
  const caption = patch.caption ?? post.caption ?? '';
  const isSaved = saved.loaded ? saved.ids.has(id) : !!post.isSaved;
  const boostedUntil = patch.boostedUntil ?? post.boostedUntil;
  const boosted = isBoosted({ ...post, boostedUntil });
  const everBoosted = Number(boostedUntil) > 0;
  const canBoost = isOwn && !isSponsored(post);
  const [boostOpen, setBoostOpen] = useState(false);
  const [boostBusy, setBoostBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [likeBusy, setLikeBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const ref = useRef<HTMLElement>(null);

  // Impression tracking: like the app, a post counts as seen when >= 20% is on screen.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          recordView(id);
          io.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [id]);

  if (patch.deleted) return null;

  const open = detail ? undefined : () => navigate(`/post/${id}`);

  const toggleLike = async () => {
    if (likeBusy) return;
    const next = !liked;
    setLikeBusy(true);
    patchPost(id, { liked: next, likeCount: Math.max(0, likeCount + (next ? 1 : -1)) });
    try {
      await likePost(post, next);
    } catch {
      patchPost(id, { liked: !next, likeCount });
      toast.error('Could not update like. Please try again.');
    } finally {
      setLikeBusy(false);
    }
  };

  const toggleSave = async () => {
    if (saveBusy) return;
    const next = !isSaved;
    setSaveBusy(true);
    setSaved(id, next);
    try {
      await bookmarkPost(id, next);
      toast.ok(next ? 'Post saved.' : 'Removed from saved.');
      invalidate('home:saved');
    } catch {
      setSaved(id, !next);
      toast.error('Could not update saved posts.');
    } finally {
      setSaveBusy(false);
    }
  };

  const share = async () => {
    const url = shareUrl(id);
    // Phones: the native share sheet (WhatsApp, X, Messages…), like the app. Desktop / no share sheet: copy the link.
    const nav = navigator as any;
    if (typeof nav.share === 'function' && window.matchMedia?.('(pointer: coarse)').matches) {
      try {
        await nav.share({ title: "i'llTip", text: (caption || 'Check out this post on i\'llTip').slice(0, 140), url });
        return;
      } catch (e: any) {
        if (e?.name === 'AbortError') return; // user closed the sheet
      }
    }
    (await copyText(url)) ? toast.ok('Link copied to clipboard.') : toast.error('Could not copy link.');
  };

  /** ProfileScreen "Boost post" / "Boost again": spend a credit if there is one, otherwise buy a boost first. */
  const boostThis = async (afterPurchase = false) => {
    if (boostBusy) return;
    setBoostBusy(true);
    try {
      if (!afterPurchase) {
        let credits = 0;
        try {
          credits = await fetchBoostCredits();
        } catch {
          credits = 0;
        }
        if (credits < 1) {
          setBoostOpen(true);
          return;
        }
      }
      const until = await boostExistingPost(id);
      patchPost(id, { boostedUntil: until ?? Math.floor(Date.now() / 1000) + 3 * 24 * 3600 });
      toast.ok('Post boosted for 3 days!');
    } catch (e: any) {
      if (isNoBoostCreditError(e)) setBoostOpen(true);
      else toast.error(errMsg(e, 'Could not boost this post. Please try again.'));
    } finally {
      setBoostBusy(false);
    }
  };

  const menu = [
    { label: 'Copy link', icon: <I name="link" size={18} />, onClick: share },
    ...(canBoost ? [{ label: everBoosted ? 'Boost again' : 'Boost post', icon: <I name="rocket" size={18} />, onClick: () => void boostThis() }] : []),
    ...(isOwn
      ? [
          { label: 'Edit post', icon: <I name="edit" size={18} />, onClick: () => setEditOpen(true) },
          {
            label: 'Delete post',
            icon: <I name="trash" size={18} />,
            danger: true,
            onClick: async () => {
              if (!window.confirm('Delete this post? This cannot be undone.')) return;
              try {
                await deletePost(id);
                patchPost(id, { deleted: true });
                toast.ok('Post deleted.');
                onDeleted?.();
              } catch (e) {
                toast.error(errMsg(e, 'Could not delete post.'));
              }
            },
          },
        ]
      : [
          {
            label: 'Report post',
            icon: <I name="flag" size={18} />,
            danger: true,
            onClick: async () => {
              if (!window.confirm('Report this post as inappropriate?')) return;
              try {
                await flagPost(id);
                toast.ok('Thanks. We will review this post.');
              } catch (e) {
                toast.error(errMsg(e, 'Could not report post.'));
              }
            },
          },
        ]),
  ];

  const hasViews = post.viewCount !== undefined && post.viewCount !== null;

  return (
    <article className="hp-card" ref={ref}>
      {boosted && <div className="hp-boosted">Boosted Post 🚀</div>}
      {canBoost && boostOpen && (
        <BoostCheckoutModal
          open
          onClose={() => setBoostOpen(false)}
          prepare={async () => {
            saveBoostDraft({ kind: 'existing', statusPostId: id, startedAt: Date.now() });
            return true;
          }}
          onConfirmed={() => {
            setBoostOpen(false);
            takeBoostDraft();
            void boostThis(true);
          }}
          next={currentPath()}
        />
      )}
      <header className="hp-head">
        <Link to={`/u/${encodeURIComponent(author.userId)}`} className="hp-avatar-link">
          <Avatar src={author.avatar} name={author.name} size={44} />
        </Link>
        <div className="hp-who">
          <div className="hp-name-row">
            <Link to={`/u/${encodeURIComponent(author.userId)}`} className="hp-name ellipsis">
              {author.name}
            </Link>
            {author.verified && (
              <span className="hp-verified" title="Subscriber badge">
                <Icon name="check" size={9} />
              </span>
            )}
          </div>
          <Link to={`/post/${id}`} className="hp-time">
            {distanceToNow(epochMs(post.createdTime))}
          </Link>
        </div>
        <div className="hp-head-right">
          {user && author.userId && !isOwn && <NetworkButton me={String(user.id)} userId={author.userId} name={author.name} />}
          <PostMenu items={menu} />
        </div>
      </header>

      <PostMedia post={post} onOpenImage={detail ? (i) => setLightbox(i) : open ? () => open() : undefined} onOpenPost={detail ? undefined : () => openWatch(post)} />
      <Caption post={patch.mentions ? { ...post, mentions: patch.mentions } : post} text={caption} full={detail} onOpen={open} />
      <PollCard post={post} />

      <footer className="hp-actions">
        <span className="hp-pill on" title="Views">
          <span className="hp-pill-ic">
            <ActIcon name="eye" />
          </span>
          <span className="hp-pill-n">{compactNumber(hasViews ? post.viewCount : 0)}</span>
        </span>
        <button className={'hp-pill hp-act-like' + (liked ? ' liked' : '')} onClick={toggleLike} aria-pressed={liked} aria-label={liked ? 'Unlike post' : 'Like post'}>
          <span className="hp-pill-ic">
            <ActIcon name="heart" />
          </span>
          <span className="hp-pill-n">{compactNumber(likeCount)}</span>
        </button>
        <button
          className="hp-pill"
          aria-label="Comments"
          aria-haspopup="dialog"
          aria-expanded={onCommentClick ? undefined : commentsOpen}
          onClick={() => {
            // App: the comment icon opens the comments sheet over the feed (PostCommentSheet); /post/:id stays for links.
            if (onCommentClick) onCommentClick();
            else setCommentsOpen(true);
          }}
        >
          <span className="hp-pill-ic">
            <ActIcon name="comment" />
          </span>
          <span className="hp-pill-n">{compactNumber(comments)}</span>
        </button>
        <button className={'hp-pill' + (isSaved ? ' on' : '')} onClick={toggleSave} aria-pressed={isSaved} aria-label={isSaved ? 'Unsave post' : 'Save post'}>
          <span className="hp-pill-ic">
            <ActIcon name="bookmark" />
          </span>
          <span className="hp-pill-n">{isSaved ? 1 : 0}</span>
        </button>
        <button className="hp-pill on" onClick={share} aria-label="Share post (copy link)">
          <span className="hp-pill-ic">
            <ActIcon name="share" />
          </span>
        </button>
        <ComboTipButton post={post} hideTipIcon={isOwn} />
      </footer>

      {editOpen && <EditModal post={post} caption={caption} open={editOpen} onClose={() => setEditOpen(false)} />}
      {commentsOpen && <CommentSheet post={post} onClose={() => setCommentsOpen(false)} />}
      {detail && <Lightbox post={post} index={lightbox} onClose={() => setLightbox(null)} />}
    </article>
  );
}

export function PostSkeleton() {
  return (
    <div className="hp-card hp-skel" aria-hidden>
      <div className="hp-head">
        <div className="sk sk-av" />
        <div className="grow">
          <div className="sk" style={{ width: '40%', height: 12 }} />
          <div className="sk" style={{ width: '20%', height: 10, marginTop: 8 }} />
        </div>
      </div>
      <div style={{ padding: '0 16px 12px' }}>
        <div className="sk" style={{ width: '90%', height: 12 }} />
        <div className="sk" style={{ width: '70%', height: 12, marginTop: 8 }} />
      </div>
      <div className="sk sk-media" />
    </div>
  );
}

/**
 * AI career assistant (illtip-mobile AIChatbotScreen + services/aiChatbotApi.ts).
 *   POST /chatbot/start-session { userId, userType: 'new_user', category: null } → greeting
 *   POST /chatbot/chat (multipart: userId, message) → { response, credits, needsUpgrade }
 *   POST /chatbot/reset-chat
 *   GET  /chat-credits/user/:userId → { data: { credits } }
 * Conversation is kept per user in localStorage (the app keeps it in AsyncStorage).
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { APP_LINKS } from '../../lib/env';
import { navigate } from '../../lib/router';
import { Icon, toast } from '../../ui/kit';
import { BotAvatar, Ico, useMediaQuery } from './shared';

type BotMsg = { id: string; type: 'user' | 'bot' | 'loading'; text?: string; ts: number; status?: 'sending' | 'delivered' | 'read' };

const FALLBACK_WELCOME = 'Welcome! Let me know if you need any assistance.';
const NETWORK_ERROR_BOT_TEXT = 'Sorry, I could not reach the assistant. Please try again.';
const makeId = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const storeKey = (u: string) => `illtip.aichat.v1.${u}`;

function loadStored(userId: string): BotMsg[] {
  try {
    const raw = localStorage.getItem(storeKey(userId));
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((m) => m && m.type !== 'loading') : [];
  } catch {
    return [];
  }
}
function saveStored(userId: string, msgs: BotMsg[]) {
  try {
    localStorage.setItem(storeKey(userId), JSON.stringify(msgs.filter((m) => m.type !== 'loading').slice(-200)));
  } catch {
    /* storage full/blocked */
  }
}

/** Same cleanup as aiChatbotApi.cleanBotText */
function cleanBotText(raw?: string | null) {
  if (!raw) return '';
  let s = String(raw);
  s = s.replace(/^\s*(question|answer)\s*:\s*/i, '');
  s = s.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  s = s.replace(/^\s*-{3,}\s*$/gm, '');
  s = s.replace(/\n*Please type the Service ID number to see full details\.?\s*/gi, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

const DATE_Q = /\b(today'?s?\s+date|what(?:'s| is)\s+(?:the\s+)?(?:today'?s?\s+)?date|current\s+date|date\s+today|what\s+day\s+is\s+(?:it|today)|which\s+day\s+is\s+(?:it|today))\b/i;
const TIME_Q = /\b(what(?:'s| is)\s+(?:the\s+)?time|current\s+time|time\s+(?:is\s+it|now)|what\s+time\s+is\s+it)\b/i;
const BOTH_Q = /\b(what(?:'s| is)\s+(?:the\s+)?date\s+and\s+time|date\s+and\s+time\s+now)\b/i;
const fmtDate = (d = new Date()) => d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
const fmtTime = (d = new Date()) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

function localAnswer(q: string): string | null {
  const wantsDate = DATE_Q.test(q);
  const wantsTime = TIME_Q.test(q);
  if (BOTH_Q.test(q) || (wantsDate && wantsTime)) return `Today is **${fmtDate()}**. The current time is **${fmtTime()}**.`;
  if (wantsDate) return `Today's date is **${fmtDate()}**.`;
  if (wantsTime) return `The current time is **${fmtTime()}**.`;
  return null;
}
function withContext(msg: string) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
  return `[Context: The user's device reports ${fmtDate()} at ${fmtTime()} (${tz}). Treat this as the correct current date and time.]\n\n${msg}`;
}

// ── tiny markdown for bot replies: **bold**, *italic*, [text](url), bullets, headings ──
const INLINE = /(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|\*[^*\s][^*]*\*|Service\s*ID\s*:\s*\d+)/gi;

function jobIdFromHref(href: string) {
  const m = href.match(/serviceRequestId=(\d+)/i) || href.match(/serviceRequest\/(\d+)/i);
  return m ? m[1] : null;
}

function Inline({ text }: { text: string }) {
  const parts = text.split(INLINE);
  return (
    <>
      {parts.map((p, i) => {
        if (i % 2 === 0) return <React.Fragment key={i}>{p}</React.Fragment>;
        const link = p.match(/^\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/);
        if (link) {
          const jobId = jobIdFromHref(link[2]);
          if (jobId)
            return (
              <a key={i} href={'#/jobs/' + jobId} onClick={(e) => (e.preventDefault(), navigate('/jobs/' + jobId))}>
                {link[1]}
              </a>
            );
          if (/^https?:\/\//i.test(link[2]))
            return (
              <a key={i} href={link[2]} target="_blank" rel="noreferrer noopener">
                {link[1]}
              </a>
            );
          return <React.Fragment key={i}>{link[1]}</React.Fragment>;
        }
        const sid = p.match(/^Service\s*ID\s*:\s*(\d+)$/i);
        if (sid)
          return (
            <a key={i} href={'#/jobs/' + sid[1]} onClick={(e) => (e.preventDefault(), navigate('/jobs/' + sid[1]))}>
              {p}
            </a>
          );
        if (p.startsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>;
        return <em key={i}>{p.slice(1, -1)}</em>;
      })}
    </>
  );
}

function BotText({ text }: { text: string }) {
  const lines = text.split('\n');
  const out: React.ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) {
      out.push(
        <ul key={'u' + out.length}>
          {bullets.map((b, i) => (
            <li key={i}>
              <Inline text={b} />
            </li>
          ))}
        </ul>,
      );
      bullets = [];
    }
  };
  lines.forEach((l) => {
    const b = l.match(/^\s*(?:[-*•])\s+(.*)$/);
    if (b) {
      bullets.push(b[1]);
      return;
    }
    flush();
    const h = l.match(/^\s*#{1,6}\s+(.*)$/);
    if (h) out.push(<div key={out.length} className="bot-h"><Inline text={h[1]} /></div>);
    else if (!l.trim()) out.push(<div key={out.length} className="bot-gap" />);
    else out.push(<div key={out.length}><Inline text={l} /></div>);
  });
  flush();
  return <div className="bot-text">{out}</div>;
}

export function AIChat({ wide }: { wide: boolean }) {
  const { user } = useAuth();
  const userId = user?.id || '';
  const touch = useMediaQuery('(hover: none)');
  const [msgs, setMsgsState] = useState<BotMsg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [needsUpgrade, setNeedsUpgrade] = useState(false);
  const [credits, setCredits] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lock = useRef(false);

  const setMsgs = useCallback(
    (fn: (p: BotMsg[]) => BotMsg[]) =>
      setMsgsState((prev) => {
        const next = fn(prev);
        if (userId) saveStored(userId, next);
        return next;
      }),
    [userId],
  );

  const loadCredits = useCallback(async () => {
    if (!userId) return;
    try {
      const { data } = await api.get(`/chat-credits/user/${encodeURIComponent(userId)}`);
      const c = data?.data?.credits ?? data?.credits;
      if (typeof c === 'number') setCredits(c);
    } catch {
      /* header just hides the chip */
    }
  }, [userId]);

  const startSession = useCallback(async () => {
    if (!userId) return;
    const loadingId = makeId('loading');
    setMsgs((p) => [...p, { id: loadingId, type: 'loading', ts: Date.now() }]);
    let text = FALLBACK_WELCOME;
    try {
      const { data } = await api.post('/chatbot/start-session', { userId, userType: 'new_user', category: null });
      text = cleanBotText(data?.response) || cleanBotText(data?.message) || FALLBACK_WELCOME;
    } catch {
      /* fallback welcome */
    }
    setMsgs((p) => [...p.filter((m) => m.id !== loadingId), { id: makeId('bot'), type: 'bot', text, ts: Date.now() }]);
  }, [userId, setMsgs]);

  useEffect(() => {
    if (!userId) return;
    const stored = loadStored(userId);
    setMsgsState(stored);
    if (stored.length === 0) startSession();
    loadCredits();
  }, [userId, startSession, loadCredits]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length]);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(160, el.scrollHeight) + 'px';
  }, [input]);

  const patchStatus = (list: BotMsg[], id: string, status: BotMsg['status']) => list.map((m) => (m.id === id ? { ...m, status } : m));

  const send = async (raw?: string) => {
    const trimmed = (raw ?? input).trim();
    if (!trimmed || sending || lock.current || !userId || needsUpgrade) return;
    lock.current = true;
    const userMsgId = makeId('user');
    const loadingId = makeId('loading');
    setInput('');
    setSending(true);
    setMsgs((p) => [...p, { id: userMsgId, type: 'user', text: trimmed, ts: Date.now(), status: 'sending' }, { id: loadingId, type: 'loading', ts: Date.now() }]);

    const local = localAnswer(trimmed);
    if (local) {
      setMsgs((p) => [...patchStatus(p.filter((m) => m.id !== loadingId), userMsgId, 'read'), { id: makeId('bot'), type: 'bot', text: local, ts: Date.now() }]);
      setSending(false);
      lock.current = false;
      return;
    }
    try {
      const fd = new FormData();
      fd.append('userId', userId);
      fd.append('message', withContext(trimmed));
      const { data } = await api.post('/chatbot/chat', fd);
      const res = data || {};
      if (typeof res.credits === 'number') setCredits(res.credits);
      if (res.needsUpgrade === true || res.credits === 0) {
        setNeedsUpgrade(true);
        setMsgs((p) => patchStatus(p.filter((m) => m.id !== loadingId), userMsgId, 'delivered'));
        return;
      }
      const text = cleanBotText(res.response) || cleanBotText(res.message);
      setMsgs((p) => {
        const base = patchStatus(p.filter((m) => m.id !== loadingId), userMsgId, text ? 'read' : 'delivered');
        return text ? [...base, { id: makeId('bot'), type: 'bot', text, ts: Date.now() }] : base;
      });
    } catch (e: any) {
      if (e?.data?.needsUpgrade) {
        setNeedsUpgrade(true);
        setMsgs((p) => patchStatus(p.filter((m) => m.id !== loadingId), userMsgId, 'delivered'));
      } else {
        setMsgs((p) => [...patchStatus(p.filter((m) => m.id !== loadingId), userMsgId, 'read'), { id: makeId('bot'), type: 'bot', text: NETWORK_ERROR_BOT_TEXT, ts: Date.now() }]);
      }
    } finally {
      setSending(false);
      lock.current = false;
      inputRef.current?.focus();
    }
  };

  const reset = async () => {
    try {
      await api.post('/chatbot/reset-chat', {});
    } catch {
      /* best effort; clear locally regardless */
    }
    setNeedsUpgrade(false);
    setMsgsState([]);
    if (userId) saveStored(userId, []);
    startSession();
    toast.ok('Conversation reset.');
  };

  return (
    <section className="thread ai-thread" aria-label="AI Chatbot">
      <div className="thread-head ai-head">
        {!wide && (
          <button className="icon-btn" aria-label="Back to chats" onClick={() => navigate('/chat')}>
            <Icon name="back" />
          </button>
        )}
        <div className="thread-peer">
          <BotAvatar size={40} />
          <div className="thread-peer-text">
            <div className="thread-peer-name">AI Chatbot</div>
            <div className="thread-peer-sub">
              <span className="chat-green-dot" /> Online
            </div>
          </div>
        </div>
        <div className="grow" />
        {credits !== null && (
          <span className="ai-credits" title={`${credits} tokens remaining`}>
            <Icon name="coin" size={15} /> {credits.toLocaleString()}
          </span>
        )}
        <button className="icon-btn" aria-label="Reset conversation" title="Reset conversation" onClick={reset}>
          <Ico name="redo" size={18} />
        </button>
      </div>

      <div className="thread-scroll" ref={scrollRef}>
        {msgs.map((m) =>
          m.type === 'loading' ? (
            <div key={m.id} className="msg-row in">
              <div className="msg typing" aria-label="Assistant is typing">
                <span />
                <span />
                <span />
              </div>
            </div>
          ) : (
            <div key={m.id} className={'msg-row ' + (m.type === 'user' ? 'out' : 'in')}>
              <div className="msg">
                {m.type === 'bot' ? <BotText text={m.text || ''} /> : <div className="msg-text pre">{m.text}</div>}
                <div className="msg-meta">
                  <span>{new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  {m.type === 'user' && <Ico name={m.status === 'sending' ? 'clock' : m.status === 'read' ? 'ticks' : 'tick'} size={14} className={m.status === 'read' ? 'seen' : ''} />}
                </div>
              </div>
            </div>
          ),
        )}
      </div>

      {needsUpgrade && (
        <div className="ai-upgrade">
          <strong>Out of credits</strong>
          <div className="small">You've used all your chatbot credits. Top up to keep chatting in the i'llTip app.</div>
          <div className="row-wrap" style={{ marginTop: 6 }}>
            <a className="btn btn-sm" href={APP_LINKS.ios} target="_blank" rel="noreferrer">
              App Store
            </a>
            <a className="btn btn-sm btn-dark" href={APP_LINKS.android} target="_blank" rel="noreferrer">
              Google Play
            </a>
          </div>
        </div>
      )}

      <div className="composer-wrap">
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <textarea
            ref={inputRef}
            className="composer-input"
            rows={1}
            value={input}
            disabled={needsUpgrade}
            placeholder={needsUpgrade ? 'Top up to continue chatting…' : 'Message AI Chatbot…'}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !touch && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            aria-label="Message AI Chatbot"
          />
          <button type="submit" className="composer-send" aria-label="Send" disabled={!input.trim() || sending || needsUpgrade}>
            <Icon name="send" size={20} />
          </button>
        </form>
      </div>
    </section>
  );
}

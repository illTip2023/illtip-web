/**
 * Minimal Socket.IO v4 client over native WebSocket (no socket.io-client package).
 *
 * Engine.IO v4 framing:  0=open 1=close 2=ping 3=pong 4=message 6=noop
 * Socket.IO v5 packets (inside "4"): 0=CONNECT 1=DISCONNECT 2=EVENT 3=ACK 4=CONNECT_ERROR
 *   so an event arrives as `42["event",payload]` and we emit the same way.
 *
 * Mirrors illtip-mobile/src/services/chatSocket.ts: the chat server (illtip-backend/socket/server.js)
 * reads `userId` from the handshake QUERY (no auth payload) and auto-joins `user_<userId>`.
 * The app also emits `join_room { room: "user_<id>" }` on every (re)connect, so we do the same.
 * Messages are always SENT over REST (/chat/sendmessage); the backend relays `message`, `seen`,
 * `delete`, `edit`, `notification` events to the recipient's user room. Callers must keep a REST
 * polling fallback (see useChatSocketStatus) because this socket can fail (port 8080, proxies...).
 */
import { useEffect, useState } from 'react';
import { CHAT_URL } from '../../lib/env';

export const CHAT_SOCKET_EVENTS = {
  message: 'message',
  seen: 'seen',
  delete: 'delete',
  edit: 'edit',
  notification: 'notification',
  chatNotification: 'chatNotification',
} as const;

export type SocketStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'failed';
type Handler = (...args: any[]) => void;

export class MiniSocketIO {
  status: SocketStatus = 'idle';
  private ws: WebSocket | null = null;
  private closedByUser = false;
  private failures = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private watchdog: ReturnType<typeof setTimeout> | undefined;
  private pingInterval = 25_000;
  private pingTimeout = 20_000;
  private statusListeners = new Set<(s: SocketStatus) => void>();

  constructor(
    private baseUrl: string,
    private query: Record<string, string>,
    private hooks: { onEvent: (event: string, args: any[]) => void; onConnect?: (s: MiniSocketIO) => void },
    private opts: { path?: string; auth?: Record<string, unknown> } = {},
  ) {}

  get connected() {
    return this.status === 'connected';
  }

  onStatus(fn: (s: SocketStatus) => void) {
    this.statusListeners.add(fn);
    return () => {
      this.statusListeners.delete(fn);
    };
  }

  private setStatus(s: SocketStatus) {
    if (this.status === s) return;
    this.status = s;
    this.statusListeners.forEach((f) => f(s));
  }

  private buildUrl() {
    const u = new URL(this.baseUrl);
    u.protocol = u.protocol === 'http:' ? 'ws:' : 'wss:';
    u.pathname = this.opts.path || '/socket.io/';
    u.search = '';
    u.searchParams.set('EIO', '4');
    u.searchParams.set('transport', 'websocket');
    for (const [k, v] of Object.entries(this.query)) u.searchParams.set(k, v);
    return u.toString();
  }

  connect() {
    this.closedByUser = false;
    clearTimeout(this.reconnectTimer);
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    if (typeof WebSocket === 'undefined') {
      this.setStatus('failed');
      return;
    }
    this.setStatus('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.buildUrl());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') this.handleEngine(e.data);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      clearTimeout(this.watchdog);
      if (this.closedByUser) {
        this.setStatus('idle');
        return;
      }
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }

  close() {
    this.closedByUser = true;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.watchdog);
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send('41');
        ws.close();
      } catch {
        /* ignore */
      }
    }
    this.setStatus('idle');
  }

  /** Emit `42["event", ...args]`. Returns false when not connected (callers fall back to REST). */
  emit(event: string, ...args: unknown[]): boolean {
    if (!this.connected || !this.ws) return false;
    try {
      this.ws.send('42' + JSON.stringify([event, ...args]));
      return true;
    } catch {
      return false;
    }
  }

  private send(raw: string) {
    try {
      this.ws?.send(raw);
    } catch {
      /* ignore */
    }
  }

  private scheduleReconnect() {
    if (this.closedByUser) return;
    this.failures += 1;
    // After a few failed tries we report "failed" so the UI polls more eagerly; we still retry slowly.
    this.setStatus(this.failures >= 3 ? 'failed' : 'disconnected');
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.failures - 1, 5)) + Math.random() * 500;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private armWatchdog() {
    clearTimeout(this.watchdog);
    // Server pings every pingInterval; if nothing arrives within interval+timeout, the link is dead.
    this.watchdog = setTimeout(() => {
      try {
        this.ws?.close();
      } catch {
        /* ignore */
      }
    }, this.pingInterval + this.pingTimeout + 1000);
  }

  private handleEngine(data: string) {
    const type = data[0];
    const body = data.slice(1);
    switch (type) {
      case '0': {
        try {
          const o = JSON.parse(body);
          if (o.pingInterval) this.pingInterval = Number(o.pingInterval) || this.pingInterval;
          if (o.pingTimeout) this.pingTimeout = Number(o.pingTimeout) || this.pingTimeout;
        } catch {
          /* ignore */
        }
        this.armWatchdog();
        // Connect the default namespace (with auth payload only if one is configured; the app uses query only).
        this.send('40' + (this.opts.auth ? JSON.stringify(this.opts.auth) : ''));
        break;
      }
      case '2':
        this.armWatchdog();
        this.send('3' + body);
        break;
      case '1':
        try {
          this.ws?.close();
        } catch {
          /* ignore */
        }
        break;
      case '4':
        this.armWatchdog();
        this.handleSocketIO(body);
        break;
      default:
        break;
    }
  }

  private handleSocketIO(p: string) {
    const t = p[0];
    let rest = p.slice(1);
    if (rest.startsWith('/')) {
      const i = rest.indexOf(',');
      rest = i >= 0 ? rest.slice(i + 1) : '';
    }
    switch (t) {
      case '0':
        this.failures = 0;
        this.setStatus('connected');
        this.hooks.onConnect?.(this);
        break;
      case '1':
        try {
          this.ws?.close();
        } catch {
          /* ignore */
        }
        break;
      case '2': {
        const m = rest.match(/^\d*/);
        const json = rest.slice(m ? m[0].length : 0);
        try {
          const arr = JSON.parse(json);
          if (Array.isArray(arr) && typeof arr[0] === 'string') this.hooks.onEvent(arr[0], arr.slice(1));
        } catch {
          /* ignore malformed */
        }
        break;
      }
      case '4':
        // CONNECT_ERROR: drop and retry later
        try {
          this.ws?.close();
        } catch {
          /* ignore */
        }
        break;
      default:
        break;
    }
  }
}

// ── Shared inbox socket (one per logged-in user) ───────────────────────────────

const handlers = new Map<string, Set<Handler>>();
const statusSubs = new Set<(s: SocketStatus) => void>();
let shared: { sock: MiniSocketIO; userId: string; refs: number; closeTimer?: ReturnType<typeof setTimeout> } | null = null;

function dispatch(event: string, args: any[]) {
  handlers.get(event)?.forEach((h) => {
    try {
      h(...args);
    } catch (e) {
      console.warn('[chat socket] handler failed', e);
    }
  });
}

/** Subscribe to a socket event (works whether or not the socket is connected yet). */
export function onChatEvent(event: string, handler: Handler): () => void {
  const set = handlers.get(event) || new Set();
  set.add(handler);
  handlers.set(event, set);
  return () => {
    set.delete(handler);
  };
}

export function getChatSocketStatus(): SocketStatus {
  return shared?.sock.status ?? 'idle';
}

export function emitChatEvent(event: string, payload?: unknown): boolean {
  return shared?.sock.emit(event, payload) ?? false;
}

/** Open (or reuse) the inbox socket for this user. Returns a release function. */
export function acquireInboxSocket(rawUserId: string): () => void {
  const raw = String(rawUserId || '').trim();
  const userId = raw.toLowerCase(); // app normalises chat ids to lowercase (normalizeChatUserId)
  if (!userId) return () => {};
  if (shared && shared.userId !== userId) {
    shared.sock.close();
    shared = null;
  }
  if (!shared) {
    const sock = new MiniSocketIO(CHAT_URL, { userId }, {
      onEvent: dispatch,
      onConnect: (s) => {
        s.emit('join_room', { room: `user_${userId}` });
        if (raw !== userId) s.emit('join_room', { room: `user_${raw}` });
      },
    });
    sock.onStatus((st) => statusSubs.forEach((f) => f(st)));
    shared = { sock, userId, refs: 0 };
    sock.connect();
  }
  const entry = shared;
  clearTimeout(entry.closeTimer);
  entry.refs += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    entry.refs -= 1;
    if (entry.refs <= 0) {
      // Keep it briefly so moving between chat and notifications does not reconnect.
      entry.closeTimer = setTimeout(() => {
        if (entry.refs <= 0 && shared === entry) {
          entry.sock.close();
          shared = null;
        }
      }, 60_000);
    }
  };
}

/** Keeps the inbox socket open while mounted and returns its live status. */
export function useChatSocketStatus(userId?: string | null): SocketStatus {
  const [status, setStatus] = useState<SocketStatus>(getChatSocketStatus());
  useEffect(() => {
    if (!userId) return;
    const release = acquireInboxSocket(userId);
    setStatus(getChatSocketStatus());
    const sub = (s: SocketStatus) => setStatus(s);
    statusSubs.add(sub);
    return () => {
      statusSubs.delete(sub);
      release();
    };
  }, [userId]);
  return status;
}

/** Subscribe to a socket event for the lifetime of the component. */
export function useChatEvent(event: string, handler: Handler) {
  useEffect(() => {
    const off = onChatEvent(event, (...a) => handler(...a));
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, handler]);
}

/**
 * Small data-fetching helpers (a lightweight stand-in for react-query).
 * useQuery(key, fn): cached by key, refetch(), loading/error states.
 * useInfinite(key, fn(page)): page-based lists with loadMore().
 * invalidate(prefix): clears cache entries whose key starts with prefix and refetches mounted queries.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

type Entry = { data: any; at: number };
const cache = new Map<string, Entry>();
const subs = new Map<string, Set<() => void>>();

export function invalidate(prefix: string) {
  for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k);
  for (const [k, set] of subs) if (k.startsWith(prefix)) set.forEach((f) => f());
}

export function setQueryData(key: string, updater: (old: any) => any) {
  const e = cache.get(key);
  cache.set(key, { data: updater(e?.data), at: Date.now() });
  subs.get(key)?.forEach((f) => f());
}

export function useQuery<T>(key: string | null, fn: () => Promise<T>, opts: { staleMs?: number } = {}) {
  const stale = opts.staleMs ?? 30_000;
  const [state, setState] = useState<{ data?: T; error?: any; loading: boolean }>(() => {
    const e = key ? cache.get(key) : undefined;
    return { data: e?.data, loading: !!key && !e };
  });
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async () => {
    if (!key) return;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    try {
      const data = await fnRef.current();
      cache.set(key, { data, at: Date.now() });
      setState({ data, loading: false });
    } catch (error) {
      setState((s) => ({ ...s, error, loading: false }));
    }
  }, [key]);

  useEffect(() => {
    if (!key) return;
    const e = cache.get(key);
    if (e) setState({ data: e.data, loading: false });
    if (!e || Date.now() - e.at > stale) run();
    const set = subs.get(key) || new Set();
    const onInvalidate = () => {
      const c = cache.get(key);
      if (c) setState({ data: c.data, loading: false });
      else run();
    };
    set.add(onInvalidate);
    subs.set(key, set);
    return () => {
      set.delete(onInvalidate);
    };
  }, [key, run, stale]);

  return { ...state, refetch: run };
}

export function useInfinite<T>(key: string | null, fetchPage: (page: number) => Promise<{ items: T[]; hasMore: boolean }>, firstPage = 1) {
  const [items, setItems] = useState<T[]>([]);
  const [page, setPage] = useState(firstPage);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<any>();
  const fnRef = useRef(fetchPage);
  fnRef.current = fetchPage;
  const busy = useRef(false);
  const gen = useRef(0);

  const load = useCallback(async (p: number, reset = false) => {
    if (busy.current && !reset) return;
    busy.current = true;
    const g = reset ? ++gen.current : gen.current;
    setLoading(true);
    setError(undefined);
    try {
      const r = await fnRef.current(p);
      if (g !== gen.current) return;
      setItems((old) => (reset ? r.items : [...old, ...r.items]));
      setHasMore(r.hasMore && r.items.length > 0);
      setPage(p);
    } catch (e) {
      if (g === gen.current) setError(e);
    } finally {
      if (g === gen.current) {
        setLoading(false);
        busy.current = false;
      }
    }
  }, []);

  useEffect(() => {
    if (!key) return;
    setItems([]);
    setHasMore(true);
    load(firstPage, true);
    const set = subs.get(key) || new Set();
    const onInvalidate = () => load(firstPage, true);
    set.add(onInvalidate);
    subs.set(key, set);
    return () => {
      set.delete(onInvalidate);
    };
  }, [key, load, firstPage]);

  return {
    items,
    setItems,
    loading,
    error,
    hasMore,
    loadMore: () => hasMore && !loading && load(page + 1),
    reload: () => load(firstPage, true),
  };
}

/** Calls onVisible when the returned ref element scrolls into view (for infinite lists). */
export function useOnVisible(onVisible: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  const cb = useRef(onVisible);
  cb.current = onVisible;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && cb.current(), { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}

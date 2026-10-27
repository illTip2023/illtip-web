/**
 * Small shared stores for the home feature so a like/tip/save made on one screen
 * shows everywhere the same post is rendered (feed, details, saved, search).
 */
import { useEffect, useRef, useState } from 'react';
import { fetchSaved, type Post } from './api';

/** Minimal useSyncExternalStore stand-in (the project's React typings don't expose it). */
function useSyncExternalStore<T>(subscribe: (l: () => void) => () => void, get: () => T, _server?: () => T): T {
  const [v, setV] = useState<T>(get);
  const getRef = useRef(get);
  getRef.current = get;
  useEffect(() => {
    const on = () => setV(() => getRef.current());
    on();
    return subscribe(on);
  }, [subscribe]);
  return get();
}
type Listener = () => void;
function makeStore<T>(initial: T) {
  let value = initial;
  const ls = new Set<Listener>();
  return {
    get: () => value,
    set(next: T | ((v: T) => T)) {
      value = typeof next === 'function' ? (next as (v: T) => T)(value) : next;
      ls.forEach((l) => l());
    },
    subscribe(l: Listener) {
      ls.add(l);
      return () => ls.delete(l);
    },
  };
}

/* ----- per-post engagement overrides ----- */
export type PostPatch = { liked?: boolean; likeCount?: number; coins?: number; comments?: number; caption?: string; mentions?: import('./api').Mention[]; deleted?: boolean; boostedUntil?: number };
const patches = makeStore<Record<number, PostPatch>>({});

export function patchPost(id: number, patch: PostPatch | ((old: PostPatch) => PostPatch)) {
  patches.set((all) => {
    const old = all[id] || {};
    return { ...all, [id]: { ...old, ...(typeof patch === 'function' ? patch(old) : patch) } };
  });
}

export function usePostPatch(id: number): PostPatch {
  const get = () => patches.get()[id] || EMPTY;
  return useSyncExternalStore(patches.subscribe, get, get);
}
const EMPTY: PostPatch = {};

/* ----- saved (bookmarked) ids, from GET /post/saved like mobile useSavedPosts ----- */
const saved = makeStore<{ ids: Set<number>; loaded: boolean }>({ ids: new Set(), loaded: false });
let savedLoading: Promise<void> | null = null;

export function loadSaved(force = false): Promise<void> {
  if (savedLoading && !force) return savedLoading;
  savedLoading = fetchSaved()
    .then((posts: Post[]) => {
      saved.set({ ids: new Set(posts.map((p) => Number(p.statusPostId)).filter((n) => n > 0)), loaded: true });
    })
    .catch(() => {
      saved.set((s) => ({ ...s, loaded: true }));
    });
  return savedLoading;
}

export function setSaved(id: number, on: boolean) {
  saved.set((s) => {
    const ids = new Set(s.ids);
    if (on) ids.add(id);
    else ids.delete(id);
    return { ...s, ids };
  });
}

export function useSavedIds() {
  return useSyncExternalStore(saved.subscribe, saved.get, saved.get);
}

/* ----- coin balance (GET /coins/balance) ----- */
export const coinStore = makeStore<number | undefined>(undefined);
export function useCoinBalance() {
  return useSyncExternalStore(coinStore.subscribe, coinStore.get, coinStore.get);
}

/**
 * Tiny version counters so useInfinite lists (which invalidate() doesn't reach) can be reloaded:
 * include useVersion('recs') in the list key and call bump('recs') after a change.
 */
import { useEffect, useState } from 'react';

const versions = new Map<string, number>();
const subs = new Map<string, Set<(v: number) => void>>();

export function bump(name: string) {
  const v = (versions.get(name) || 0) + 1;
  versions.set(name, v);
  subs.get(name)?.forEach((f) => f(v));
}

export function useVersion(name: string) {
  const [v, setV] = useState(versions.get(name) || 0);
  useEffect(() => {
    const set = subs.get(name) || new Set();
    set.add(setV);
    subs.set(name, set);
    return () => {
      set.delete(setV);
    };
  }, [name]);
  return v;
}

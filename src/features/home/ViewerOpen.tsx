/**
 * Opening the full-screen viewer (/watch/:id) from a feed card. Kept separate from Viewer.tsx so
 * PostCard/HomeFeed can import it without pulling the viewer (or creating an import cycle).
 */
import { navigate } from '../../lib/router';
import { setQueryData } from '../../lib/query';
import type { Post } from './api';

let pendingFeedSeed: string | undefined;

/**
 * Seeds the viewer with the post the user tapped (so it shows instantly, no GET /post/single) and,
 * optionally, the home feed seed (used only if GET /post/related fails, like the app's fallback).
 */
export function openWatch(post: Post, opts: { feedSeed?: string; replace?: boolean } = {}) {
  const id = Number(post.statusPostId);
  if (!Number.isFinite(id) || id <= 0) return;
  setQueryData(`home:post:${id}`, () => post);
  pendingFeedSeed = opts.feedSeed;
  navigate(`/watch/${id}`, { replace: opts.replace });
}

/** Read once by the viewer when it builds its list. */
export function takeWatchFeedSeed(): string | undefined {
  const s = pendingFeedSeed;
  pendingFeedSeed = undefined;
  return s;
}

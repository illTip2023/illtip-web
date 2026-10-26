/**
 * Feed video like the app: autoplays (muted) when at least 60% on screen, pauses when scrolled away or the tab is hidden,
 * only one video plays at a time, tap the speaker to unmute (the choice sticks for the session).
 */
import React, { useEffect, useRef, useState } from 'react';

const players = new Set<HTMLVideoElement>();
let soundOn = false;
const soundListeners = new Set<(v: boolean) => void>();

/** Pauses we make ourselves (scrolling away, another video starting) must not count as the user pausing. */
const autoPaused = new WeakSet<HTMLVideoElement>();
function autoPause(v: HTMLVideoElement) {
  if (v.paused) return;
  autoPaused.add(v);
  v.pause();
}
function pauseOthers(me: HTMLVideoElement) {
  players.forEach((v) => {
    if (v !== me) autoPause(v);
  });
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) players.forEach((v) => autoPause(v));
  });
}

/** onTap: feed mode (no native controls; tapping the video opens the post, like the app). Without it the video shows controls. */
export function AutoVideo({ src, poster, className, onTap }: { src: string; poster?: string; className?: string; onTap?: () => void }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [muted, setMuted] = useState(!soundOn);
  const userPaused = useRef(false);
  // iPhones only decode a few videos at once and show the rest as black boxes: only videos near the screen get a
  // source, and the thumbnail covers the video until it is actually playing.
  const [near, setNear] = useState(false);
  const [playing, setPlaying] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => es.forEach((e) => setNear(e.isIntersecting)), { rootMargin: '200% 0px 200% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  // Far away: the source is dropped, so the thumbnail must cover it again when it comes back.
  useEffect(() => {
    if (!near) setPlaying(false);
  }, [near]);

  useEffect(() => {
    const on = (v: boolean) => setMuted(!v);
    soundListeners.add(on);
    return () => {
      soundListeners.delete(on);
    };
  }, []);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    players.add(v);
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.intersectionRatio >= 0.6) {
            if (userPaused.current || document.hidden) continue;
            pauseOthers(v);
            v.muted = !soundOn;
            v.play().catch(() => {
              // Browsers block autoplay with sound: retry muted.
              v.muted = true;
              setMuted(true);
              v.play().catch(() => {});
            });
          } else {
            autoPause(v);
          }
        }
      },
      { threshold: [0, 0.25, 0.6, 0.9] }
    );
    io.observe(v);
    const onPlay = () => {
      autoPaused.delete(v);
      userPaused.current = false;
      pauseOthers(v);
    };
    // Only uncover the video once a real frame is on screen (iPhones report "playing" while still black).
    let frameCb = 0;
    const onPlaying = () => {
      const anyV = v as any;
      if (typeof anyV.requestVideoFrameCallback === 'function') frameCb = anyV.requestVideoFrameCallback(() => setPlaying(true));
    };
    const onTime = () => {
      if (v.currentTime > 0.15 && !v.paused) setPlaying(true);
    };
    const onStop = () => setPlaying(false);
    v.addEventListener('playing', onPlaying);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('emptied', onStop);
    const onPauseByUser = () => {
      if (autoPaused.has(v)) {
        autoPaused.delete(v);
        return;
      }
      // A pause while the video is still mostly visible = the user paused it; don't auto-resume.
      const r = v.getBoundingClientRect();
      const visible = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) / Math.max(1, r.height);
      if (visible >= 0.6 && !document.hidden) userPaused.current = true;
    };
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPauseByUser);
    return () => {
      io.disconnect();
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPauseByUser);
      v.removeEventListener('playing', onPlaying);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('emptied', onStop);
      if (frameCb && typeof (v as any).cancelVideoFrameCallback === 'function') (v as any).cancelVideoFrameCallback(frameCb);
      // The 'pause' event arrives later (after the next run has added its listeners), so flag it as ours.
      autoPause(v);
      players.delete(v);
    };
  }, [src, near]);

  function toggleSound(e: any) {
    e.preventDefault();
    e.stopPropagation();
    soundOn = muted;
    soundListeners.forEach((l) => l(soundOn));
    players.forEach((p) => (p.muted = !soundOn));
    const v = ref.current;
    if (v && v.paused) {
      userPaused.current = false;
      pauseOthers(v);
      v.play().catch(() => {});
    }
  }

  return (
    <div className="autovideo" ref={wrap}>
      <video
        ref={ref}
        className={className + (onTap ? ' hp-clickable' : '')}
        src={near ? (poster || src.includes('#') || !/\.(mp4|mov|m4v|webm)(\?|$)/i.test(src) ? src : src + '#t=0.1') : undefined}
        poster={poster}
        muted={muted}
        playsInline
        loop
        preload="metadata"
        controls={!onTap}
        controlsList="nodownload noplaybackrate"
        disablePictureInPicture
        onClick={onTap}
      />
      {poster && !playing && onTap && <img className="autovideo-poster" src={poster} alt="" onClick={onTap} />}
      <button type="button" className="autovideo-sound" aria-label={muted ? 'Turn sound on' : 'Mute'} onClick={toggleSound}>
        {muted ? '🔇' : '🔊'}
      </button>
    </div>
  );
}

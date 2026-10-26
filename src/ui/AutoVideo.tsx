/**
 * Feed video like the app: autoplays (muted) when at least 60% on screen, pauses when scrolled away or the tab is hidden,
 * only one video plays at a time, tap the speaker to unmute (the choice sticks for the session).
 */
import React, { useEffect, useRef, useState } from 'react';

const players = new Set<HTMLVideoElement>();
let soundOn = false;
const soundListeners = new Set<(v: boolean) => void>();

function pauseOthers(me: HTMLVideoElement) {
  players.forEach((v) => {
    if (v !== me && !v.paused) v.pause();
  });
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) players.forEach((v) => v.pause());
  });
}

/** onTap: feed mode (no native controls; tapping the video opens the post, like the app). Without it the video shows controls. */
export function AutoVideo({ src, poster, className, onTap }: { src: string; poster?: string; className?: string; onTap?: () => void }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [muted, setMuted] = useState(!soundOn);
  const userPaused = useRef(false);

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
          } else if (!v.paused) {
            v.pause();
          }
        }
      },
      { threshold: [0, 0.25, 0.6, 0.9] }
    );
    io.observe(v);
    const onPlay = () => {
      userPaused.current = false;
      pauseOthers(v);
    };
    const onPauseByUser = () => {
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
      v.pause();
      players.delete(v);
    };
  }, [src]);

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
    <div className="autovideo">
      <video ref={ref} className={className + (onTap ? ' hp-clickable' : '')} src={src} poster={poster} muted={muted} playsInline loop preload="metadata" controls={!onTap} controlsList="nodownload noplaybackrate" disablePictureInPicture onClick={onTap} />
      <button type="button" className="autovideo-sound" aria-label={muted ? 'Turn sound on' : 'Mute'} onClick={toggleSound}>
        {muted ? '🔇' : '🔊'}
      </button>
    </div>
  );
}

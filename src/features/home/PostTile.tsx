import React from 'react';
import { Link } from '../../lib/router';
import { Icon } from '../../ui/kit';
import { I } from './icons';
import { authorOf, mediaOf, type Post } from './api';

/** Square grid tile (search "Explore" grid, related posts). Text/poll posts get a caption tile. */
export function PostTile({ post }: { post: Post }) {
  const m = mediaOf(post)[0];
  const many = mediaOf(post).length > 1;
  const text = (post.caption || post.poll?.question || '').trim();
  return (
    <Link to={`/post/${post.statusPostId}`} className="hp-tile" title={text.slice(0, 120)}>
      {m?.kind === 'image' ? (
        <img src={m.url} alt="" loading="lazy" decoding="async" />
      ) : m?.kind === 'video' ? (
        m.poster ? <img src={m.poster} alt="" loading="lazy" /> : <video src={m.url} preload="metadata" muted playsInline />
      ) : (
        <div className="hp-tile-text">
          {post.poll && <I name="poll" size={18} />}
          <span>{text || authorOf(post).name}</span>
        </div>
      )}
      {m?.kind === 'video' && (
        <span className="hp-tile-badge">
          <Icon name="play" size={14} />
        </span>
      )}
      {many && m?.kind !== 'video' && (
        <span className="hp-tile-badge">
          <Icon name="image" size={14} />
        </span>
      )}
    </Link>
  );
}

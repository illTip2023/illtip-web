import React from 'react';

const P: Record<string, string> = {
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  poll: 'M5 20V10M12 20V4M19 20v-7',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  flag: 'M5 21V4h11l-1.5 4L16 12H5',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  left: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  video: 'M3 6h12v12H3zM15 10l6-3v10l-6-3',
  reply: 'M10 8 4 13l6 5M4 13h11a5 5 0 0 1 5 5v1',
  rocket:
    'M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09zM12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2zM9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5',
};

export function I({ name, size = 20, fill }: { name: keyof typeof P; size?: number; fill?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden fill={fill ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d={P[name]} />
    </svg>
  );
}

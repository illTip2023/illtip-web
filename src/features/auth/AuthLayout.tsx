import React, { useCallback, useEffect, useRef, useState } from 'react';
import { APP_LINKS } from '../../lib/env';
import { goBack } from '../../lib/router';
import { Icon } from '../../ui/kit';
import './auth.css';

/** Centered auth card on the brand gradient. `back` shows a back arrow (fallback path), `wide` widens the card (role select). */
export function AuthLayout({
  children,
  title,
  sub,
  back,
  wide,
  step,
}: {
  children: React.ReactNode;
  title?: string;
  sub?: React.ReactNode;
  back?: string;
  wide?: boolean;
  step?: { at: number; of: number };
}) {
  return (
    <div className="auth-wrap">
      <div className={'auth-card' + (wide ? ' au-wide' : '')}>
        <div className="au-top">
          {back ? (
            <button type="button" className="icon-btn" aria-label="Go back" onClick={() => goBack(back)}>
              <Icon name="back" />
            </button>
          ) : (
            <span className="au-top-spacer" />
          )}
          <div className="auth-logo">
            <img src="logo.png" alt="" /> i'llTip
          </div>
          <span className="au-top-spacer" />
        </div>
        {step && (
          <div className="au-steps" aria-label={`Step ${step.at} of ${step.of}`}>
            {Array.from({ length: step.of }, (_, i) => (
              <span key={i} className={i < step.at ? 'on' : ''} />
            ))}
          </div>
        )}
        {title && <h1 className="center au-title">{title}</h1>}
        {sub && <p className="center muted au-sub">{sub}</p>}
        <div style={{ marginTop: 18 }}>{children}</div>
        <p className="center muted tiny" style={{ marginTop: 18 }}>
          Get the app:{' '}
          <a href={APP_LINKS.ios} target="_blank" rel="noreferrer">
            iPhone
          </a>{' '}
          ·{' '}
          <a href={APP_LINKS.android} target="_blank" rel="noreferrer">
            Android
          </a>
        </p>
      </div>
    </div>
  );
}

export function PasswordInput({ id, value, onChange, autoComplete, placeholder }: { id: string; value: string; onChange: (v: string) => void; autoComplete?: string; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="au-pw">
      <input id={id} className="input" type={show ? 'text' : 'password'} autoComplete={autoComplete} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
      <button type="button" className="au-pw-toggle" onClick={() => setShow((x) => !x)} aria-label={show ? 'Hide password' : 'Show password'}>
        {show ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}

export function FormError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return (
    <div className="au-err" role="alert">
      {msg}
    </div>
  );
}

/** 6-box OTP input with paste + backspace navigation (VerifyEmailScreen). */
export function OtpInput({ value, onChange, onComplete, disabled }: { value: string; onChange: (v: string) => void; onComplete?: (v: string) => void; disabled?: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] || '');
  function set(next: string[], focus?: number) {
    const v = next.join('').slice(0, 6);
    onChange(v);
    if (focus != null) refs.current[Math.max(0, Math.min(5, focus))]?.focus();
    if (v.length === 6 && !next.includes('')) onComplete?.(v);
  }
  return (
    <div className="au-otp" onPaste={(e) => {
      const t = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
      if (!t) return;
      e.preventDefault();
      const next = Array.from({ length: 6 }, (_, i) => t[i] || '');
      set(next, t.length);
    }}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          className="au-otp-box"
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={6}
          value={d}
          disabled={disabled}
          aria-label={`Digit ${i + 1}`}
          onChange={(e) => {
            const raw = e.target.value.replace(/\D/g, '');
            const next = [...digits];
            if (raw.length > 1) {
              raw.slice(0, 6 - i).split('').forEach((c, k) => (next[i + k] = c));
              set(next, i + raw.length);
            } else {
              next[i] = raw;
              set(next, raw ? i + 1 : undefined);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !digits[i] && i > 0) {
              const next = [...digits];
              next[i - 1] = '';
              set(next, i - 1);
            } else if (e.key === 'ArrowLeft') refs.current[i - 1]?.focus();
            else if (e.key === 'ArrowRight') refs.current[i + 1]?.focus();
          }}
        />
      ))}
    </div>
  );
}

export function fmtCountdown(s: number) {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Resend cooldown based on an end time (keeps counting correctly while the tab is in the background). null = not started. */
export function useCountdown() {
  const [end, setEnd] = useState<number | null>(null);
  const [, tick] = useState(0);
  const left = end == null ? null : Math.max(0, Math.ceil((end - Date.now()) / 1000));
  useEffect(() => {
    if (!left) return;
    const id = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [left === 0, end]);
  const start = useCallback((seconds: number) => setEnd(Date.now() + seconds * 1000), []);
  return [left, start] as const;
}

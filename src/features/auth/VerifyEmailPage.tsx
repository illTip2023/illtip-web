/** Mirrors illtip-mobile VerifyEmailScreen (signup / login sources): 6-digit OTP, 90s resend, validateOTP → session. */
import React, { useEffect, useState } from 'react';
import { Link, navigate, useQueryParams } from '../../lib/router';
import { saveSession } from '../../lib/api';
import { sessionFromAuthResponse, useAuth } from '../../lib/auth';
import { toast } from '../../ui/kit';
import { AuthLayout, fmtCountdown, FormError, OtpInput, useCountdown } from './AuthLayout';
import { generateOTP, getSignupContact, isValidEmail, normalizeEmail, validateOTP } from './authApi';

const RESEND_SECONDS = 90;
/** Guards against sending a second code when the page re-mounts (StrictMode / quick back-forward). */
const lastSent = new Map<string, number>();

export function maskEmail(email: string) {
  const raw = String(email ?? '').trim().toLowerCase();
  const at = raw.indexOf('@');
  if (at <= 0) return raw;
  const name = raw.slice(0, at);
  return (name.length <= 3 ? name : name.slice(0, 3)) + '****' + raw.slice(at);
}

export function VerifyEmailPage() {
  const qp = useQueryParams();
  const { user, logout } = useAuth();
  const email = normalizeEmail(qp.get('email') || user?.email || '');
  const source = qp.get('source') === 'signup' ? 'signup' : 'login';
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');
  const [left, startCooldown] = useCountdown();

  async function send(): Promise<boolean> {
    const res = await generateOTP(email, source === 'signup' ? 'verification' : 'login');
    if (res.success) {
      lastSent.set(email, Date.now());
      toast.ok('A new code was sent to your email.');
      return true;
    }
    toast.error(res.message || 'Failed to resend code. Please try again.');
    return false;
  }

  // Signup already emailed a code (registerV2); login sends one here once.
  useEffect(() => {
    if (!email) return;
    const recent = Date.now() - (lastSent.get(email) || 0) < RESEND_SECONDS * 1000;
    if (source === 'signup' || recent) {
      startCooldown(recent ? RESEND_SECONDS - Math.floor((Date.now() - (lastSent.get(email) || 0)) / 1000) : RESEND_SECONDS);
      if (source === 'signup' && !recent) lastSent.set(email, Date.now());
      return;
    }
    lastSent.set(email, Date.now());
    setSending(true);
    send()
      .then((ok) => startCooldown(ok ? RESEND_SECONDS : 0))
      .finally(() => setSending(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, source]);

  async function verify(value = code) {
    setErr('');
    if (value.length !== 6) return setErr('Please enter the full 6-digit code.');
    if (!isValidEmail(email)) return setErr('Please enter a valid email address.');
    if (busy) return;
    setBusy(true);
    try {
      const res = await validateOTP(email, value);
      if (!res.success || !res.data?.accessToken) {
        setErr('Invalid or expired code. Please try again.');
        return;
      }
      const s = sessionFromAuthResponse(res.data, email);
      const signup = getSignupContact(s.user.email);
      const name = s.user.name && s.user.name !== s.user.email ? s.user.name : signup?.name || s.user.name;
      saveSession({ ...s, user: { ...s.user, name, phone: s.user.phone || signup?.phone, emailVerified: true } });
      toast.ok('Email verified.');
      navigate(res.data.data?.roleSelected === true ? '/' : '/role', { replace: true });
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (left !== 0 || sending || !email) return;
    setSending(true);
    try {
      if (await send()) {
        setCode('');
        startCooldown(RESEND_SECONDS);
      }
    } finally {
      setSending(false);
    }
  }

  if (!email) {
    return (
      <AuthLayout title="Verification" sub="We couldn't tell which email to verify." back="/login">
        <Link to="/login" className="btn btn-block btn-dark">Back to login</Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Enter 6-digit verification code" back={source === 'signup' ? '/register' : '/login'}>
      <p className="center muted small au-sub" style={{ marginTop: -8 }}>
        {left === 0 ? (
          <>Code sent to <b>{maskEmail(email)}</b>. Your code has expired — tap Resend code below.</>
        ) : (
          <>Code sent to <b>{maskEmail(email)}</b>.{left ? <> This code will expire in <b>{fmtCountdown(left)}</b></> : null}</>
        )}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          verify();
        }}
      >
        <OtpInput value={code} onChange={setCode} onComplete={(v) => verify(v)} disabled={busy} />
        <FormError msg={err} />
        <button className="btn btn-block btn-dark au-cta" disabled={busy || code.length !== 6}>
          {busy ? 'Verifying…' : 'Verify'}
        </button>
      </form>
      <div className="center small" style={{ marginTop: 14 }}>
        {left ? (
          <span className="muted">Resend code in {fmtCountdown(left)}</span>
        ) : (
          <button type="button" className="au-linkbtn" onClick={resend} disabled={sending || left == null}>
            {sending ? 'Sending…' : 'Resend code'}
          </button>
        )}
      </div>
      <p className="center tiny muted" style={{ marginTop: 14 }}>
        Wrong account?{' '}
        <button
          type="button"
          className="au-linkbtn"
          onClick={() => {
            logout();
            navigate('/login', { replace: true });
          }}
        >
          Use a different email
        </button>
      </p>
    </AuthLayout>
  );
}

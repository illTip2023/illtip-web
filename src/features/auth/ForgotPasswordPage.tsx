/**
 * Mirrors illtip-mobile ForgotPasswordScreen → VerifyEmailScreen(source: forgotPassword) → SetNewPasswordScreen:
 * POST /auth/v2/forgot-password → /auth/v2/verify-password-reset-code → /auth/v2/reset-password.
 */
import React, { useState } from 'react';
import { Link, navigate, useQueryParams } from '../../lib/router';
import { Icon, toast } from '../../ui/kit';
import { AuthLayout, fmtCountdown, FormError, OtpInput, PasswordInput, useCountdown } from './AuthLayout';
import { maskEmail } from './VerifyEmailPage';
import { forgotPasswordV2, isValidEmail, isValidPassword, normalizeEmail, normalizePassword, resetPasswordV2, verifyPasswordResetCodeV2 } from './authApi';

const RESEND_SECONDS = 90;
type Step = 'email' | 'code' | 'password' | 'done';

export function ForgotPasswordPage() {
  const qp = useQueryParams();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState(qp.get('email') || '');
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [left, startCooldown] = useCountdown();
  const mail = normalizeEmail(email);

  async function sendCode() {
    const res = await forgotPasswordV2(mail);
    // Same as the app: always confirm, so the screen doesn't reveal which emails have accounts.
    if (!res.success && /network/i.test(res.message)) {
      toast.error('Network error. Please try again.');
      return false;
    }
    toast.ok('A password reset code was sent to your email.');
    startCooldown(RESEND_SECONDS);
    return true;
  }

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (!mail) return setErr('Please enter your email address.');
    if (!isValidEmail(mail)) return setErr('Please enter a valid email address.');
    setBusy(true);
    try {
      if (await sendCode()) setStep('code');
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(value = code) {
    setErr('');
    if (value.length !== 6) return setErr('Please enter the full 6-digit code.');
    if (busy) return;
    setBusy(true);
    try {
      const res = await verifyPasswordResetCodeV2(mail, value);
      if (!res.success) return setErr('Invalid or expired code. Please try again.');
      toast.ok('Email verified.');
      setStep('password');
    } finally {
      setBusy(false);
    }
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    const a = normalizePassword(pw);
    const b = normalizePassword(pw2);
    if (!mail || code.length !== 6) {
      toast.error('Your session expired. Please start password recovery again.');
      setStep('email');
      return;
    }
    if (!isValidPassword(a)) return setErr('Password must be at least 8 characters.');
    if (a !== b) return setErr('Passwords do not match.');
    setBusy(true);
    try {
      const res = await resetPasswordV2(mail, code, a);
      if (!res.success) return setErr(res.message || 'Could not update your password. Please try again.');
      setStep('done');
    } finally {
      setBusy(false);
    }
  }

  if (step === 'done') {
    return (
      <AuthLayout>
        <div className="center">
          <div className="au-success-badge">
            <Icon name="check" size={34} />
          </div>
          <h1 className="au-title">Password Updated!</h1>
          <p className="muted au-sub">Your password has been successfully updated.</p>
          <button className="btn btn-block btn-dark au-cta" style={{ marginTop: 18 }} onClick={() => navigate(`/login`, { replace: true })}>
            Continue
          </button>
        </div>
      </AuthLayout>
    );
  }

  if (step === 'password') {
    return (
      <AuthLayout title="Set New Password" sub="Choose a new password for your account." step={{ at: 3, of: 3 }}>
        <form onSubmit={submitPassword} noValidate>
          <div className="field">
            <label className="label" htmlFor="np1">Password</label>
            <PasswordInput id="np1" autoComplete="new-password" placeholder="At least 8 characters" value={pw} onChange={setPw} />
          </div>
          <div className="field">
            <label className="label" htmlFor="np2">Confirm Password</label>
            <PasswordInput id="np2" autoComplete="new-password" placeholder="Confirm Password" value={pw2} onChange={setPw2} />
          </div>
          <FormError msg={err} />
          <button className="btn btn-block btn-dark au-cta" disabled={busy || !isValidPassword(pw) || normalizePassword(pw) !== normalizePassword(pw2)}>
            {busy ? 'Saving…' : 'Confirm Changes'}
          </button>
        </form>
      </AuthLayout>
    );
  }

  if (step === 'code') {
    return (
      <AuthLayout title="Recover Account" step={{ at: 2, of: 3 }}>
        <p className="center muted small au-sub" style={{ marginTop: -8 }}>
          Enter the 6-digit code sent to <b>{maskEmail(mail)}</b>.
          {left ? <> This code will expire in <b>{fmtCountdown(left)}</b></> : null}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitCode();
          }}
        >
          <OtpInput value={code} onChange={setCode} onComplete={(v) => submitCode(v)} disabled={busy} />
          <FormError msg={err} />
          <button className="btn btn-block btn-dark au-cta" disabled={busy || code.length !== 6}>
            {busy ? 'Checking…' : 'Recover Account'}
          </button>
        </form>
        <div className="row between small" style={{ marginTop: 14 }}>
          <button type="button" className="au-linkbtn" onClick={() => { setStep('email'); setCode(''); setErr(''); }}>
            Change email
          </button>
          {left ? (
            <span className="muted">Resend code in {fmtCountdown(left)}</span>
          ) : (
            <button type="button" className="au-linkbtn" disabled={busy} onClick={async () => { setBusy(true); try { if (await sendCode()) setCode(''); } finally { setBusy(false); } }}>
              Resend code
            </button>
          )}
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Recover Account" sub="Enter your email and we'll send you a code to reset your password." back="/login" step={{ at: 1, of: 3 }}>
      <form onSubmit={submitEmail} noValidate>
        <div className="field">
          <label className="label" htmlFor="fp-email">Email Address</label>
          <input id="fp-email" className="input" type="email" autoComplete="email" placeholder="Your Email Address" value={email} onChange={(e) => setEmail(e.target.value.toLowerCase())} />
        </div>
        <FormError msg={err} />
        <button className="btn btn-block btn-dark au-cta" disabled={busy || !isValidEmail(mail)}>
          {busy ? 'Sending code…' : 'Continue'}
        </button>
      </form>
      <p className="center small" style={{ marginTop: 16 }}>
        Remembered it? <Link to="/login">Back to login</Link>
      </p>
    </AuthLayout>
  );
}

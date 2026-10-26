import React, { useState } from 'react';
import type { RouteDef } from '../../lib/router';
import { Link, navigate, useQueryParams } from '../../lib/router';
import { useAuth } from '../../lib/auth';
import { AuthLayout, FormError, PasswordInput } from './AuthLayout';
import { RegisterPage } from './RegisterPage';
import { VerifyEmailPage } from './VerifyEmailPage';
import { ForgotPasswordPage } from './ForgotPasswordPage';
import { RoleFinishPage, RoleSelectPage } from './RolePages';

export { AuthLayout };

/** Same order as the app's LoginScreen.routeAfterAuth: unverified → OTP, no role yet → role select, else into the app. */
export function routeAfterAuth(user: { email: string; emailVerified?: boolean; roleSelected?: boolean }, next?: string | null) {
  if (user.emailVerified !== true) navigate(`/verify-email?email=${encodeURIComponent(user.email)}&source=login`, { replace: true });
  else if (user.roleSelected !== true) navigate('/role', { replace: true });
  else navigate(next && next.startsWith('/') && !next.startsWith('/login') ? next : '/', { replace: true });
}

function LoginPage() {
  const { login } = useAuth();
  const qp = useQueryParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (!email || !password) return setErr('Email and password are required.');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setErr('Please enter a valid email address.');
    setBusy(true);
    try {
      const s = await login(email, password);
      routeAfterAuth(s.user, qp.get('next'));
    } catch (e: any) {
      setErr(e?.message || 'Login failed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthLayout title="Welcome back" sub="Find work, get seen, get tipped.">
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label className="label" htmlFor="email">Email</label>
          <input id="email" className="input" type="email" autoComplete="email" placeholder="Your Email Address" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <div className="row between">
            <label className="label" htmlFor="pw">Password</label>
            <Link to={'/forgot-password' + (email.includes('@') ? '?email=' + encodeURIComponent(email.trim().toLowerCase()) : '')} className="small">
              Forgot password?
            </Link>
          </div>
          <PasswordInput id="pw" autoComplete="current-password" value={password} onChange={setPassword} />
        </div>
        <FormError msg={err} />
        <button className="btn btn-block btn-dark au-cta" disabled={busy}>{busy ? 'Signing in…' : 'Log in'}</button>
      </form>
      <p className="center small" style={{ marginTop: 16 }}>
        Not yet signed in? <Link to={'/register' + (qp.get('ref') ? '?ref=' + encodeURIComponent(qp.get('ref')!) : '')}>Register Now</Link>
      </p>
    </AuthLayout>
  );
}

/** Auth screens: all `chrome: false`, so they render without the app shell and without requiring a session. */
export const routes: RouteDef[] = [
  { path: '/login', element: LoginPage, chrome: false, auth: false },
  { path: '/register', element: RegisterPage, chrome: false, auth: false },
  { path: '/verify-email', element: VerifyEmailPage, chrome: false, auth: false },
  { path: '/forgot-password', element: ForgotPasswordPage, chrome: false, auth: false },
  { path: '/role', element: RoleSelectPage, chrome: false, auth: false },
  { path: '/role/finish', element: RoleFinishPage, chrome: false, auth: false },
];

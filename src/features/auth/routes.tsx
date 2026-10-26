import React, { useState } from 'react';
import type { RouteDef } from '../../lib/router';
import { navigate, useQueryParams } from '../../lib/router';
import { useAuth } from '../../lib/auth';
import { APP_LINKS } from '../../lib/env';

export function AuthLayout({ children, title, sub }: { children: React.ReactNode; title?: string; sub?: string }) {
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-logo">
          <img src="logo.png" alt="" /> i'llTip
        </div>
        {title && <h1 className="center" style={{ marginTop: 6 }}>{title}</h1>}
        {sub && <p className="center muted" style={{ marginTop: 6 }}>{sub}</p>}
        <div style={{ marginTop: 18 }}>{children}</div>
        <p className="center muted tiny" style={{ marginTop: 18 }}>
          Get the app: <a href={APP_LINKS.ios} target="_blank" rel="noreferrer">iPhone</a> · <a href={APP_LINKS.android} target="_blank" rel="noreferrer">Android</a>
        </p>
      </div>
    </div>
  );
}

function LoginPage() {
  const { login } = useAuth();
  const qp = useQueryParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (!email || !password) return setErr('Enter your email and password.');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setErr('Enter a valid email address.');
    setBusy(true);
    try {
      const s = await login(email, password);
      if (s.user.emailVerified === false) navigate('/verify-email', { replace: true });
      else if (s.user.roleSelected === false) navigate('/role', { replace: true });
      else navigate(qp.get('next') || '/', { replace: true });
    } catch (e: any) {
      setErr(e?.message || 'Login failed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthLayout title="Welcome back" sub="Find work, get seen, get tipped.">
      <form onSubmit={submit}>
        <div className="field">
          <label className="label" htmlFor="email">Email</label>
          <input id="email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="pw">Password</label>
          <div className="row">
            <input id="pw" className="input" type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShow((x) => !x)}>{show ? 'Hide' : 'Show'}</button>
          </div>
        </div>
        {err && <div className="small" style={{ color: 'var(--err)', marginBottom: 10 }}>{err}</div>}
        <button className="btn btn-block" disabled={busy}>{busy ? 'Signing in…' : 'Log in'}</button>
      </form>
      <div className="row between small" style={{ marginTop: 14 }}>
        <a href="#/forgot-password">Forgot password?</a>
        <a href="#/register">Create account</a>
      </div>
    </AuthLayout>
  );
}

export const routes: RouteDef[] = [{ path: '/login', element: LoginPage, chrome: false }];

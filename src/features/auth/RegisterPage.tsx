/** Mirrors illtip-mobile RegisterScreen: same fields, validation order and messages. */
import React, { useEffect, useState } from 'react';
import { Link, navigate, useQueryParams } from '../../lib/router';
import { saveSession } from '../../lib/api';
import { sessionFromAuthResponse } from '../../lib/auth';
import { toast } from '../../ui/kit';
import { APP_LINKS } from '../../lib/env';
import { AuthLayout, FormError, PasswordInput } from './AuthLayout';
import {
  AUTH_FULL_NAME_MAX_LEN,
  clearPendingReferral,
  composePhone,
  DEFAULT_PHONE_COUNTRY,
  findCountry,
  formatLocalDigits,
  getPendingReferral,
  isValidEmail,
  isValidFullName,
  isValidLocalPhone,
  isValidPassword,
  isValidSignupPhone,
  normalizeEmail,
  normalizeFullName,
  normalizePassword,
  normalizeReferralCode,
  PHONE_COUNTRIES,
  registerV2,
  sanitizeReferralInput,
  savePendingReferral,
  saveSignupContact,
} from './authApi';

export function RegisterPage() {
  const qp = useQueryParams();
  const [fullName, setFullName] = useState('');
  const [countryId, setCountryId] = useState(DEFAULT_PHONE_COUNTRY);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [referral, setReferral] = useState('');
  const [refLocked, setRefLocked] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const country = findCountry(countryId);

  // ?ref=CODE (also ?code= / ?referral_code= like the app's install referrer), else a code saved earlier.
  useEffect(() => {
    const fromUrl = normalizeReferralCode(qp.get('ref') || qp.get('code') || qp.get('referral_code') || qp.get('referralCode'));
    if (fromUrl) {
      savePendingReferral(fromUrl);
      setReferral(fromUrl);
      setRefLocked(true);
      return;
    }
    const stored = getPendingReferral();
    if (stored) setReferral(stored);
  }, [qp]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setErr('');
    const name = normalizeFullName(fullName);
    const phoneStored = composePhone(phone, country);
    const mail = normalizeEmail(email);
    const pwd = normalizePassword(password);
    const confirmPwd = normalizePassword(confirm);
    const code = normalizeReferralCode(referral);
    if (!name || !phoneStored || phoneStored === '+' || !mail || !pwd || !confirmPwd) return setErr('All fields are required.');
    if (!isValidFullName(name)) return setErr('Please enter your full name (at least 2 characters).');
    if (!isValidLocalPhone(phone, country) || !isValidSignupPhone(phoneStored)) return setErr('Please enter a valid phone number for the selected country (10–15 digits).');
    if (!isValidEmail(mail)) return setErr('Please enter a valid email address.');
    if (!isValidPassword(pwd)) return setErr('Password must be at least 8 characters.');
    if (pwd !== confirmPwd) return setErr('Passwords do not match.');
    if (referral.trim() && !code) return setErr('Enter a valid 8–16 character referral code.');
    setBusy(true);
    try {
      const res = await registerV2({ email: mail, password: pwd, fullName: name, phoneNumber: phoneStored, referralCode: code });
      if (!res.success) {
        setErr(res.message || 'Registration failed.');
        return;
      }
      clearPendingReferral();
      saveSignupContact({ email: mail, name, phone: phoneStored });
      // registerV2 normally answers without tokens (the session comes from the OTP step); store one if the API sends it.
      if (res.data?.accessToken) {
        const s = sessionFromAuthResponse(res.data, mail);
        saveSession({ ...s, user: { ...s.user, name: s.user.name || name, phone: s.user.phone || phoneStored } });
      }
      toast.ok('Account created. Check your email for the code.');
      navigate(`/verify-email?email=${encodeURIComponent(mail)}&source=signup`, { replace: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Create Account" sub="Create an account so you can explore all the existing jobs" back="/login">
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label className="label" htmlFor="r-name">Full Name</label>
          <input id="r-name" className="input" autoComplete="name" placeholder="Your Full Name" value={fullName} onChange={(e) => setFullName(e.target.value.slice(0, AUTH_FULL_NAME_MAX_LEN))} />
        </div>
        <div className="field">
          <label className="label" htmlFor="r-phone">Phone Number</label>
          <div className="au-phone">
            <select className="select" aria-label="Country code" value={countryId} onChange={(e) => { setCountryId(e.target.value); setPhone((p) => formatLocalDigits(p, findCountry(e.target.value))); }}>
              {PHONE_COUNTRIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.shortLabel} (+{c.dialCode})
                </option>
              ))}
            </select>
            <input id="r-phone" className="input" type="tel" inputMode="numeric" autoComplete="tel-national" placeholder="Phone number" value={phone} onChange={(e) => setPhone(formatLocalDigits(e.target.value, country))} />
          </div>
        </div>
        <div className="field">
          <label className="label" htmlFor="r-email">Email Address</label>
          <input id="r-email" className="input" type="email" autoComplete="email" placeholder="Your Email Address" value={email} onChange={(e) => setEmail(e.target.value.toLowerCase())} />
        </div>
        <div className="field">
          <label className="label" htmlFor="r-ref">
            Referral Code <span className="muted" style={{ fontWeight: 400 }}>(Optional)</span>
          </label>
          <input
            id="r-ref"
            className="input au-mono"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={16}
            placeholder="Referral Code (Optional)"
            value={referral}
            readOnly={refLocked}
            onChange={(e) => setReferral(sanitizeReferralInput(e.target.value))}
          />
          {refLocked && (
            <div className="tiny muted" style={{ marginTop: 6 }}>
              Invited with code <b>{referral}</b>.{' '}
              <button type="button" className="au-linkbtn" onClick={() => setRefLocked(false)}>Change</button>
            </div>
          )}
        </div>
        <div className="field">
          <label className="label" htmlFor="r-pw">Password</label>
          <PasswordInput id="r-pw" autoComplete="new-password" placeholder="At least 8 characters" value={password} onChange={setPassword} />
        </div>
        <div className="field">
          <label className="label" htmlFor="r-pw2">Confirm Password</label>
          <PasswordInput id="r-pw2" autoComplete="new-password" placeholder="Confirm Password" value={confirm} onChange={setConfirm} />
        </div>
        <p className="tiny muted" style={{ margin: '4px 0 14px' }}>
          By signing up you agree to our{' '}
          <a href={APP_LINKS.site} target="_blank" rel="noreferrer">Terms &amp; Conditions</a>,{' '}
          <a href={APP_LINKS.site} target="_blank" rel="noreferrer">EULA</a> and{' '}
          <a href={APP_LINKS.site} target="_blank" rel="noreferrer">Privacy Policy</a>.
        </p>
        <FormError msg={err} />
        <button className="btn btn-block btn-dark au-cta" disabled={busy}>
          {busy ? 'Creating account…' : 'Sign Up'}
        </button>
      </form>
      <p className="center small" style={{ marginTop: 16 }}>
        Already registered? <Link to="/login">Sign In</Link>
      </p>
    </AuthLayout>
  );
}

import { useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { supabase, authConfigured } from '../lib/supabaseClient';

function detect(value) {
  const v = value.trim();
  if (v.includes('@')) return { type: 'email', value: v };
  let digits = v.replace(/[^\d+]/g, '');
  if (!digits.startsWith('+')) {
    digits = digits.length === 10 ? '+91' + digits : '+' + digits;
  }
  return { type: 'phone', value: digits };
}

export default function Login() {
  const router = useRouter();
  const [stage, setStage] = useState('enter');
  const [identifier, setIdentifier] = useState(null);
  const [raw, setRaw] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function sendCode(e) {
    e.preventDefault();
    setError(null);
    if (!authConfigured) { setError('Sign-in is launching shortly — check back soon.'); return; }
    const id = detect(raw);
    setBusy(true);
    const { error: err } = await supabase.auth.signInWithOtp(
      id.type === 'email' ? { email: id.value } : { phone: id.value }
    );
    setBusy(false);
    if (err) { setError(err.message); return; }
    setIdentifier(id);
    setStage('code');
  }

  async function verifyCode(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error: err } = await supabase.auth.verifyOtp({
      [identifier.type]: identifier.value,
      token: code,
      type: identifier.type === 'email' ? 'email' : 'sms'
    });
    setBusy(false);
    if (err) { setError(err.message); return; }
    const next = router.query.next || '/dashboard';
    router.push(next);
  }

  return (
    <>
      <Head><title>Sign In — Drape</title></Head>
      <div className="auth-wrap">
        <div className="auth-card">
          {stage === 'enter' ? (
            <form onSubmit={sendCode}>
              <div className="auth-title">Sign in to Drape</div>
              <div className="auth-sub">Enter your email or phone number. We'll text or email you a one-time code — no password needed.</div>
              <div className="field">
                <label>Email or Phone</label>
                <input
                  type="text"
                  placeholder="you@example.com or 98765 43210"
                  value={raw}
                  onChange={e => setRaw(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              {error && <div className="alert alert-error">{error}</div>}
              <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Sending…' : 'Send Code'}</button>
            </form>
          ) : (
            <form onSubmit={verifyCode}>
              <div className="auth-title">Enter your code</div>
              <div className="auth-sub">We sent a 6-digit code to {identifier.value}.</div>
              <div className="field otp-row">
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="••••••"
                  value={code}
                  onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                  required
                  autoFocus
                />
              </div>
              {error && <div className="alert alert-error">{error}</div>}
              <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Verifying…' : 'Verify & Continue'}</button>
            </form>
          )}
        </div>
      </div>
    </>
  );
}

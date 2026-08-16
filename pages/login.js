import { useState, useEffect } from 'react';
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

  // If Supabase already signed the user in via a magic-link callback
  // (#access_token in the URL fragment), bounce to the dashboard.
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      if (data?.session) {
        const next = router.query.next || '/dashboard';
        router.replace(next);
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        const next = router.query.next || '/dashboard';
        router.replace(next);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [router]);

  async function sendCode(e) {
    e.preventDefault();
    setError(null);
    if (!authConfigured) { setError('Sign-in is launching shortly. Check back soon.'); return; }
    const id = detect(raw);
    setBusy(true);
    const opts = id.type === 'email'
      ? { email: id.value, options: { emailRedirectTo: (typeof window !== 'undefined' ? window.location.origin : '') + '/auth/callback' } }
      : { phone: id.value };
    const { error: err } = await supabase.auth.signInWithOtp(opts);
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

  const isEmail = identifier && identifier.type === 'email';

  return (
    <>
      <Head><title>Sign In to Drape</title></Head>
      <div className="auth-wrap">
        <div className="auth-card">
          {stage === 'enter' ? (
            <form onSubmit={sendCode}>
              <div className="auth-title">Sign in to Drape</div>
              <div className="auth-sub">Enter your email or phone number. We will send you a sign-in link or a one-time code.</div>
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
              <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Sending...' : 'Continue'}</button>
            </form>
          ) : isEmail ? (
            <div>
              <div className="auth-title">Check your inbox</div>
              <div className="auth-sub">
                We sent a sign-in link to <b>{identifier.value}</b>. Open it on this device and you will be signed in automatically.
              </div>
              <div className="alert alert-info">Tip: check your spam folder if you do not see it in a minute.</div>
              <div className="auth-note">
                Got a 6-digit code in the email instead? Paste it below.
              </div>
              <form onSubmit={verifyCode} style={{marginTop:18}}>
                <div className="field otp-row">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="......"
                    value={code}
                    onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                  />
                </div>
                {error && <div className="alert alert-error">{error}</div>}
                <button className="btn btn-ghost btn-block" disabled={busy || code.length < 6}>{busy ? 'Verifying...' : 'Verify Code'}</button>
              </form>
              <div className="auth-note">
                Wrong address? <a href="#" onClick={(e) => { e.preventDefault(); setStage('enter'); setCode(''); setError(null); }} style={{color:'var(--gold-deep)',textDecoration:'underline'}}>Use a different one</a>
              </div>
            </div>
          ) : (
            <form onSubmit={verifyCode}>
              <div className="auth-title">Enter your code</div>
              <div className="auth-sub">We texted a 6-digit code to <b>{identifier.value}</b>.</div>
              <div className="field otp-row">
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="......"
                  value={code}
                  onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                  required
                  autoFocus
                />
              </div>
              {error && <div className="alert alert-error">{error}</div>}
              <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Verifying...' : 'Verify and Continue'}</button>
              <div className="auth-note">
                Wrong number? <a href="#" onClick={(e) => { e.preventDefault(); setStage('enter'); setCode(''); setError(null); }} style={{color:'var(--gold-deep)',textDecoration:'underline'}}>Use a different one</a>
              </div>
            </form>
          )}
        </div>
      </div>
    </>
  );
}

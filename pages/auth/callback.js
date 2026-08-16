import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { supabase } from '../../lib/supabaseClient';

export default function AuthCallback() {
  const router = useRouter();
  const [state, setState] = useState('signing_in');
  const [errMsg, setErrMsg] = useState(null);

  useEffect(() => {
    if (!supabase) { setState('error'); setErrMsg('Sign-in is not configured yet.'); return; }
    // supabase-js autoruns detectSessionInUrl on load; give it a beat, then check.
    const t = setTimeout(async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error) { setState('error'); setErrMsg(error.message); return; }
      if (data?.session) {
        const next = router.query.next || '/dashboard';
        router.replace(next);
      } else {
        setState('error');
        setErrMsg('This sign-in link has expired or was already used. Request a new one.');
      }
    }, 400);
    return () => clearTimeout(t);
  }, [router]);

  return (
    <>
      <Head><title>Signing you in - Drape</title></Head>
      <div className="auth-wrap">
        <div className="auth-card">
          {state === 'signing_in' ? (
            <>
              <div className="auth-title">Signing you in</div>
              <div className="auth-sub">One moment while we finish setting up your session.</div>
            </>
          ) : (
            <>
              <div className="auth-title">Could not sign in</div>
              <div className="auth-sub">{errMsg}</div>
              <a className="btn btn-primary btn-block" href="/login">Back to sign in</a>
            </>
          )}
        </div>
      </div>
    </>
  );
}

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { supabase, authConfigured } from '../lib/supabaseClient';

export default function Layout({ children }) {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [credits, setCredits] = useState(null);

  useEffect(() => {
    if (!authConfigured) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setCredits(null); return; }
    fetch('/api/profile', { headers: { Authorization: 'Bearer ' + session.access_token } })
      .then(r => r.ok ? r.json() : null)
      .then(d => setCredits(d ? d.credits_remaining : null))
      .catch(() => setCredits(null));
  }, [session, router.pathname]);

  return (
    <>
      <header className="site-header">
        <Link href="/" className="brand">DRAPE</Link>
        <nav className="site-nav">
          <Link href="/" className={router.pathname === '/' ? 'active' : ''}>Home</Link>
          <Link href="/pricing" className={router.pathname === '/pricing' ? 'active' : ''}>Pricing</Link>
          <Link href="/studio" className={router.pathname === '/studio' ? 'active' : ''}>Studio</Link>
          {session && (
            <Link href="/dashboard" className={router.pathname === '/dashboard' ? 'active' : ''}>Dashboard</Link>
          )}
          {session ? (
            <>
              {credits !== null && <span className="nav-credits">{credits} credits</span>}
              <a className="nav-cta" href="/studio">Try It</a>
            </>
          ) : (
            <Link href="/login" className="nav-cta">Sign In</Link>
          )}
        </nav>
      </header>
      {children}
      <footer className="site-footer">
        <span className="label">© {new Date().getFullYear()} Drape — AI Virtual Try-On</span>
        <span className="label">Built on Replicate · Claude · Fal.ai</span>
      </footer>
    </>
  );
}

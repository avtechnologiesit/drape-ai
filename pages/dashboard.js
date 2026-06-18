import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Head from 'next/head';
import { supabase, authConfigured } from '../lib/supabaseClient';
import { getPlanById } from '../lib/plans';

export default function Dashboard() {
  const router = useRouter();
  const [profile, setProfile] = useState(null);
  const [usage, setUsage] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authConfigured) { setLoading(false); return; }
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) { router.replace('/login?next=/dashboard'); return; }
      const headers = { Authorization: 'Bearer ' + data.session.access_token };
      const [p, u] = await Promise.all([
        fetch('/api/profile', { headers }).then(r => r.json()),
        fetch('/api/usage', { headers }).then(r => r.json())
      ]);
      setProfile(p);
      setUsage(Array.isArray(u) ? u : []);
      setLoading(false);
    });
  }, [router]);

  if (!authConfigured) {
    return (
      <main className="page">
        <div className="alert alert-info">Accounts and dashboards are launching shortly — check back soon.</div>
      </main>
    );
  }
  if (loading) return <main className="page"><p className="label">Loading…</p></main>;

  const planLabel = getPlanById(profile?.plan)?.name || 'Free Trial';

  return (
    <>
      <Head><title>Dashboard — Drape</title></Head>
      <main className="page">
        <div className="section-label">Dashboard</div>
        <div className="dash-grid">
          <div className="dash-card">
            <div className="label">Credits Remaining</div>
            <div className="big gold">{profile?.credits_remaining ?? 0}</div>
            <div className="sub">1 credit = 1 generation</div>
          </div>
          <div className="dash-card">
            <div className="label">Current Plan</div>
            <div className="big">{planLabel}</div>
            <div className="sub"><Link href="/pricing">Upgrade plan →</Link></div>
          </div>
          <div className="dash-card">
            <div className="label">Total Generations</div>
            <div className="big">{usage.length}</div>
            <div className="sub"><Link href="/studio">Start a new try-on →</Link></div>
          </div>
        </div>

        <div className="section-label">Recent Activity</div>
        {usage.length === 0 ? (
          <div className="usage-empty" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
            No generations yet. <Link href="/studio">Try your first one →</Link>
          </div>
        ) : (
          <table className="usage-table">
            <thead><tr><th>Date</th><th>Engine</th><th>Status</th><th>Credits Used</th></tr></thead>
            <tbody>
              {usage.map(row => (
                <tr key={row.id}>
                  <td>{new Date(row.created_at).toLocaleString()}</td>
                  <td>{row.engine || 'idm-vton'}</td>
                  <td>{row.status}</td>
                  <td>{row.credits_used}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
    </>
  );
}

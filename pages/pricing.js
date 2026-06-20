import { useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { PLANS, TRIAL_CREDITS } from '../lib/plans';
import { supabase, authConfigured } from '../lib/supabaseClient';

function loadRazorpayScript() {
  return new Promise((resolve) => {
    if (document.getElementById('razorpay-sdk')) return resolve(true);
    const script = document.createElement('script');
    script.id = 'razorpay-sdk';
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export default function Pricing() {
  const router = useRouter();
  const [busyPlan, setBusyPlan] = useState(null);
  const [notice, setNotice] = useState(null);

  async function startCheckout(plan) {
    setNotice(null);
    if (!plan.price) { window.location.href = 'mailto:hello@drape.app?subject=Business plan'; return; }

    if (!authConfigured) { setNotice('Sign-in is launching shortly — check back soon.'); return; }
    const { data } = await supabase.auth.getSession();
    if (!data.session) { router.push('/login?next=/pricing&plan=' + plan.id); return; }

    setBusyPlan(plan.id);
    try {
      const res = await fetch('/api/checkout/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + data.session.access_token },
        body: JSON.stringify({ planId: plan.id })
      });
      const order = await res.json();
      if (!res.ok) throw new Error(order.error || 'Checkout is not available yet');

      const ok = await loadRazorpayScript();
      if (!ok) throw new Error('Could not load payment widget');

      const rz = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        order_id: order.orderId,
        name: 'Drape',
        description: plan.name + ' Plan',
        theme: { color: '#C9A84C' },
        handler: async function (response) {
          const verify = await fetch('/api/checkout/verify-payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + data.session.access_token },
            body: JSON.stringify({ ...response, planId: plan.id })
          });
          if (verify.ok) router.push('/dashboard');
          else setNotice('Payment received but activation failed — contact support with your payment ID.');
        }
      });
      rz.open();
    } catch (e) {
      setNotice(e.message.includes('not available') || e.message.includes('not set')
        ? 'Online payments are launching shortly — you can still use your free trial credits in the meantime.'
        : e.message);
    }
    setBusyPlan(null);
  }

  return (
    <>
      <Head><title>Pricing — Drape</title></Head>
      <main className="page">
        <div className="section-label">Pricing</div>
        <h1 style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 'clamp(2.6rem, 4vw, 3.6rem)', marginBottom: 12 }}>Simple, credit-based plans</h1>
        <p style={{ fontSize: '1.05rem', color: 'var(--warm-gray)', maxWidth: 560, marginBottom: 8, lineHeight: 1.7 }}>
          One credit equals one try-on generation — three AI-picked results included. Every new account starts with {TRIAL_CREDITS} free credits, no card required.
        </p>
        {notice && <div className="alert alert-info" style={{ marginTop: 24 }}>{notice}</div>}
        <div className="pricing-grid">
          {PLANS.map(plan => (
            <div className={'plan-card' + (plan.featured ? ' featured' : '')} key={plan.id}>
              {plan.featured && <span className="plan-badge">Most Popular</span>}
              <div className="plan-name">{plan.name}</div>
              <div className="plan-tagline">{plan.tagline}</div>
              {plan.price ? (
                <>
                  <div className="plan-price">₹{plan.price}<sup>/mo</sup></div>
                  <div className="plan-price-sub">{plan.credits} credits / month</div>
                </>
              ) : (
                <>
                  <div className="plan-price">Custom</div>
                  <div className="plan-price-sub">Volume pricing</div>
                </>
              )}
              <ul className="plan-features">
                {plan.features.map(f => <li key={f}>{f}</li>)}
              </ul>
              <button
                className={'btn btn-block ' + (plan.featured ? 'btn-gold' : 'btn-ghost')}
                onClick={() => startCheckout(plan)}
                disabled={busyPlan === plan.id}
              >
                {plan.price ? (busyPlan === plan.id ? 'Opening…' : 'Choose ' + plan.name) : 'Contact Sales'}
              </button>
            </div>
          ))}
        </div>
      </main>
    </>
  );
}

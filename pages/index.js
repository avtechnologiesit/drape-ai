import { useEffect, useState } from 'react';
import Link from 'next/link';
import Head from 'next/head';

const SWATCHES = [
  { name: 'Banarasi Silk', tag: 'Saree · Upper & Lower', fill: 'linear-gradient(135deg,#7a1f2b,#c9a84c)' },
  { name: 'Linen Blazer', tag: 'Formal · Upper Body', fill: 'linear-gradient(135deg,#3d4a52,#8b7d6b)' },
  { name: 'Velvet Kurta', tag: 'Festive · Full Body', fill: 'linear-gradient(135deg,#2e1f4d,#8a6bbf)' },
  { name: 'Cotton Dress', tag: 'Casual · Dress', fill: 'linear-gradient(135deg,#1a4d3e,#8fbf9f)' }
];

export default function Home() {
  const [front, setFront] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setFront(f => (f + 1) % SWATCHES.length), 2800);
    return () => clearInterval(t);
  }, []);

  return (
    <>
      <Head><title>DRAPE — See it on, before you buy it</title></Head>
      <main className="page">
        <section className="hero">
          <div>
            <div className="hero-eyebrow">AI Virtual Try-On</div>
            <h1>See it<br />draped on <em>you</em>,<br />before you buy.</h1>
            <p className="lede">Upload a photo of yourself and any garment. Drape generates three AI-picked try-on results in under a minute — your face and body, exactly as they are, wearing someone else's wardrobe.</p>
            <div className="hero-actions">
              <Link href="/studio" className="btn btn-primary">Try It Free</Link>
              <Link href="/pricing" className="btn btn-ghost">See Pricing</Link>
            </div>
            <div className="hero-stats">
              <div className="hero-stat"><b>3</b><span>Results Per Generation</span></div>
              <div className="hero-stat"><b>~45s</b><span>Average Generation Time</span></div>
              <div className="hero-stat"><b>100%</b><span>Face &amp; Body Preserved</span></div>
            </div>
          </div>
          <div className="swatch-stack">
            {SWATCHES.map((s, i) => {
              const pos = (i - front + SWATCHES.length) % SWATCHES.length;
              const styles = [
                { transform: 'translateY(0) scale(1)', opacity: 1, zIndex: 4 },
                { transform: 'translateY(18px) scale(.96)', opacity: .7, zIndex: 3 },
                { transform: 'translateY(34px) scale(.92)', opacity: .4, zIndex: 2 },
                { transform: 'translateY(48px) scale(.88)', opacity: 0, zIndex: 1 }
              ][pos];
              return (
                <div className="swatch-card" key={s.name} style={styles}>
                  <div>
                    <div className="sw-tag">{s.tag}</div>
                    <div className="sw-name">{s.name}</div>
                  </div>
                  <div className="swatch-fill" style={{ background: s.fill }} />
                  <div className="sw-foot">
                    <span>Option {i + 1} of 3</span>
                    {pos === 0 && <span className="sw-pick">AI Pick</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <div className="section-label">How It Works</div>
        <div className="steps">
          <div className="step">
            <span className="num">01</span>
            <h3>Upload your photo</h3>
            <p>A clear, front-facing photo works best. Nothing is stored beyond generating your result.</p>
          </div>
          <div className="step">
            <span className="num">02</span>
            <h3>Upload the garment</h3>
            <p>A saree, kurta, dress, or any outfit photo. Drape reads the fabric, colour, and cut automatically.</p>
          </div>
          <div className="step">
            <span className="num">03</span>
            <h3>Get three AI picks</h3>
            <p>Three results, generated in parallel. Claude reviews all three and ranks the most natural one first.</p>
          </div>
        </div>

        <div className="section-label">Plans</div>
        <p style={{ fontSize: '.8rem', color: 'var(--warm-gray)', maxWidth: 520, marginBottom: 28, lineHeight: 1.7 }}>
          Every account starts with 5 free generations. Paid plans run from ₹499/month for shoppers who try on a few outfits a week, up to custom volume pricing for stores.
        </p>
        <Link href="/pricing" className="btn btn-gold">View Full Pricing</Link>
      </main>
    </>
  );
}

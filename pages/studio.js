import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { supabase, authConfigured } from '../lib/supabaseClient';

const LOAD_MSGS = [
  'Uploading photos to AI...', 'Analysing outfit reference...',
  'Running try-on seed 1 of 3...', 'Running try-on seed 2 of 3...',
  'Running try-on seed 3 of 3...', 'Claude picking best result...', 'Almost done...'
];

function resizeImg(dataUrl, maxPx) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const { width: w, height: h } = img;
      if (w <= maxPx && h <= maxPx) { resolve(dataUrl); return; }
      const sc = maxPx / Math.max(w, h);
      const c = document.createElement('canvas');
      c.width = Math.round(w * sc); c.height = Math.round(h * sc);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.src = dataUrl;
  });
}

function UploadCard({ tag, image, onUpload, onRemove }) {
  const inputRef = useRef(null);
  return (
    <div className={'ucard' + (image ? ' has-img' : '')} onClick={() => !image && inputRef.current.click()}>
      <div className="ucard-tag">{tag}</div>
      {!image && (
        <>
          <input ref={inputRef} type="file" accept="image/*" className="ucard-input"
            onChange={e => e.target.files[0] && onUpload(e.target.files[0])} />
          <div className="ucard-placeholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
            </svg>
            <div className="ucard-placeholder-title">Upload {tag}</div>
            <div className="ucard-placeholder-sub">Click anywhere to browse</div>
          </div>
        </>
      )}
      {image && (
        <div className="ucard-img" style={{ display: 'block', zIndex: 10 }}>
          <img src={image} alt={tag} />
          <div className="ucard-img-overlay" />
          <div className="ucard-img-actions">
            <button onClick={(e) => { e.stopPropagation(); inputRef.current.click(); }}>Change</button>
            <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }}
              onChange={e => e.target.files[0] && onUpload(e.target.files[0])} />
            <button className="remove" onClick={(e) => { e.stopPropagation(); onRemove(); }}>Remove</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Studio() {
  const router = useRouter();
  const [session, setSession] = useState(undefined);
  const [credits, setCredits] = useState(null);
  const [img1, setImg1] = useState(null);
  const [img2, setImg2] = useState(null);
  const [garmentType, setGarmentType] = useState('Upper Body');
  const [generating, setGenerating] = useState(false);
  const [status, setStatus] = useState({ state: 'ready', text: 'Ready' });
  const [error, setError] = useState(null);
  const [loadingMsg, setLoadingMsg] = useState(LOAD_MSGS[0]);
  const [results, setResults] = useState(null);
  const [selected, setSelected] = useState(null);
  const [toastMsg, setToastMsg] = useState(null);
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiAnswer, setAiAnswer] = useState(null);
  const [shakeCard, setShakeCard] = useState(null);

  useEffect(() => {
    if (!authConfigured) { setSession(null); return; }
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setCredits(null); return; }
    fetch('/api/profile', { headers: { Authorization: 'Bearer ' + session.access_token } })
      .then(r => r.ok ? r.json() : null).then(d => setCredits(d ? d.credits_remaining : null));
  }, [session]);

  function toast(msg) { setToastMsg(msg); setTimeout(() => setToastMsg(null), 2800); }

  async function handleUpload(n, file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      if (n === 1) setImg1(e.target.result); else setImg2(e.target.result);
      toast(n === 1 ? 'Portrait uploaded!' : 'Outfit uploaded!');
    };
    reader.readAsDataURL(file);
  }

  async function generate() {
    if (generating) return;
    if (!img1 || !img2) {
      toast('Upload both images first');
      setShakeCard(!img1 ? 1 : 2); setTimeout(() => setShakeCard(null), 400);
      return;
    }
    if (authConfigured && !session) { router.push('/login?next=/studio'); return; }
    if (authConfigured && credits !== null && credits <= 0) {
      setError('You are out of credits. Upgrade your plan to keep generating.');
      return;
    }

    setGenerating(true); setError(null); setStatus({ state: 'loading', text: 'Generating...' });
    let mi = 0; setLoadingMsg(LOAD_MSGS[0]);
    const iv = setInterval(() => { mi = (mi + 1) % LOAD_MSGS.length; setLoadingMsg(LOAD_MSGS[mi]); }, 3500);

    try {
      let garmentDes = 'clothing item';
      try {
        const dr = await fetch('/api/describe', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ images: [img2], garmentType })
        });
        if (dr.ok) garmentDes = (await dr.json()).text || garmentDes;
      } catch (_) {}

      let category = 'upper_body';
      if (garmentType === 'Lower Body') category = 'lower_body';
      else if (garmentType === 'Dress / One-piece' || garmentType === 'Full Body') category = 'dresses';

      const h1 = await resizeImg(img1, 900);
      const h2 = await resizeImg(img2, 900);

      const headers = { 'Content-Type': 'application/json' };
      if (session) headers.Authorization = 'Bearer ' + session.access_token;

      const resp = await fetch('/api/tryon', {
        method: 'POST', headers,
        body: JSON.stringify({ humanBase64: h1, garmentBase64: h2, garmentDes, category })
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || 'HTTP ' + resp.status);
      }
      const result = await resp.json();
      clearInterval(iv); setStatus({ state: 'ready', text: 'Done' });
      const outputs = result.all_outputs || [result.output];
      setResults({ outputs, best: result.output });
      setSelected(result.output);
      if (typeof result.credits_remaining === 'number') setCredits(result.credits_remaining);
      toast('Generated ' + outputs.length + ' results!');
    } catch (err) {
      clearInterval(iv); setStatus({ state: 'error', text: 'Error' });
      setError('Generation failed: ' + String(err.message || err).slice(0, 300));
      toast('Generation failed');
    }
    setGenerating(false);
  }

  async function askAI() {
    const q = aiQuestion.trim();
    if (!q) { toast('Type a question first'); return; }
    setAiAnswer('Thinking...');
    try {
      const r = await fetch('/api/describe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: [img1, img2].filter(Boolean), garmentType, question: q })
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      setAiAnswer((await r.json()).text);
    } catch (e) {
      setAiAnswer('Could not get a response right now. Try again in a moment.');
    }
  }

  function tryAnother() {
    setResults(null); setSelected(null); setImg2(null);
  }

  return (
    <>
      <Head><title>Studio \u2014 Drape</title></Head>
      <main className="page">
        <div className="studio-bar">
          <span className="label">Engine</span>
          <span className="engine">IDM-VTON (Replicate) + Claude</span>
          <div className={'status-dot' + (status.state === 'loading' ? ' loading' : status.state === 'error' ? ' error' : '')} />
          <span className="status-txt">{status.text}</span>
        </div>

        <div className="section-label">Virtual Try-On Studio</div>

        {authConfigured && session && credits !== null && (
          <div className="alert alert-info">{credits} credit{credits === 1 ? '' : 's'} remaining on your account.</div>
        )}
        {authConfigured && session === null && (
          <div className="alert alert-info">Sign in to save your results and track credits \u2014 generating still works, you'll just be asked to sign in first.</div>
        )}

        <div className="upload-grid">
          <div className={shakeCard === 1 ? 'shake' : ''}>
            <UploadCard tag="Your Photo" image={img1} onUpload={f => handleUpload(1, f)} onRemove={() => setImg1(null)} />
          </div>
          <div className={shakeCard === 2 ? 'shake' : ''}>
            <UploadCard tag="Outfit Reference" image={img2} onUpload={f => handleUpload(2, f)} onRemove={() => setImg2(null)} />
          </div>
        </div>

        <div className="settings-row">
          <div className="setting-group">
            <span className="setting-label">Garment Type</span>
            <select className="setting-select" value={garmentType} onChange={e => setGarmentType(e.target.value)}>
              <option>Upper Body</option><option>Lower Body</option><option>Full Body</option>
              <option>Dress / One-piece</option><option>Outerwear</option>
            </select>
          </div>
        </div>

        {error && <div className="error-card show"><div className="error-title">Generation Error</div><div className="error-msg">{error}</div></div>}

        <div className="generate-wrap">
          <button className="generate-btn" onClick={generate} disabled={generating}>
            {generating ? 'Generating\u2026' : 'Generate Try-On'}
          </button>
          {authConfigured && <div className="credit-note">Uses 1 credit per generation</div>}
        </div>

        <div className="ai-box">
          <div className="ai-box-title">AI Fashion Stylist \u2014 Claude</div>
          <div className="ai-input-row">
            <input type="text" className="ai-input" placeholder="Ask about fit, colour, what to pair with this outfit..."
              value={aiQuestion} onChange={e => setAiQuestion(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && askAI()} />
            <button className="ai-ask-btn" onClick={askAI}>Ask AI</button>
          </div>
          {aiAnswer && <div className="ai-answer show">{aiAnswer}</div>}
          <div className="ai-quick">
            {['Body fit?', 'Shoes & accessories?', 'What occasion?', 'Colour match?'].map(q => (
              <button key={q} onClick={() => { setAiQuestion(q); setTimeout(askAI, 0); }}>{q}</button>
            ))}
          </div>
        </div>

        {results && (
          <div className="result-section show">
            {results.outputs.length > 1 && (
              <div className="variants-grid">
                {results.outputs.map((url, i) => (
                  <div key={url} className={'variant-card' + (url === selected ? ' selected' : '')} onClick={() => setSelected(url)}>
                    <img src={url} alt={'Option ' + (i + 1)} />
                    <div className="variant-label">Option {i + 1}{url === results.best && <span className="variant-badge">AI PICK</span>}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="result-img-wrap"><img src={selected} alt="Try-on result" /></div>
            <div className="result-panel">
              <div className="score-box">
                <div className="score-label">AI Match Score</div>
                <div className="score-value">AI</div>
                <div className="score-sub">Compatibility rating</div>
              </div>
              <div className="actions-box">
                <button className="action-btn primary" onClick={() => { const a = document.createElement('a'); a.href = selected; a.download = 'drape-tryon.jpg'; a.click(); }}>\u2193 Download HD Image</button>
                <button className="action-btn" onClick={() => { if (navigator.share) navigator.share({ title: 'My DRAPE Try-On', url: location.href }); else { navigator.clipboard?.writeText(location.href); toast('Link copied!'); } }}>\u2197 Share Look</button>
                <button className="action-btn" onClick={tryAnother}>\u21ba Try Another Outfit</button>
              </div>
            </div>
          </div>
        )}
      </main>
      {toastMsg && <div className="toast show"><span>{toastMsg}</span></div>}
    </>
  );
}

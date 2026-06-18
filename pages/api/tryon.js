import { getUserFromRequest, supabaseAdmin, adminConfigured, getOrCreateProfile } from '../../lib/supabaseAdmin';
import { TRIAL_CREDITS } from '../../lib/plans';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function uploadB64(dataUrl, filename, R8) {
  const raw = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  const ct = dataUrl.startsWith('data:image/') ? dataUrl.split(';')[0].split(':')[1] : 'image/jpeg';
  const buf = Buffer.from(raw, 'base64');
  const bnd = 'B' + Date.now();
  const NL = '\r\n';
  const disp = 'form-data; name="content"; filename="' + filename + '"';
  const hs = '--' + bnd + NL + 'Content-Disposition: ' + disp + NL + 'Content-Type: ' + ct + NL + NL;
  const ts = NL + '--' + bnd + '--' + NL;
  const body = Buffer.concat([Buffer.from(hs), buf, Buffer.from(ts)]);
  const r = await fetch('https://api.replicate.com/v1/files', {
    method: 'POST',
    headers: { Authorization: 'Token ' + R8, 'Content-Type': 'multipart/form-data; boundary=' + bnd, 'Content-Length': String(body.length) },
    body
  });
  const txt = await r.text();
  if (!r.ok) throw new Error('Upload ' + r.status + ': ' + txt.slice(0, 60));
  return JSON.parse(txt).urls.get;
}

async function createPred(hUrl, gUrl, des, cat, seed, R8) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const pr = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: { Authorization: 'Token ' + R8, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: 'c871bb9b046607b680449ecbae55fd8c6d945e0a1948644bf2361b3d021d3ff4',
        input: { human_img: hUrl, garm_img: gUrl, garment_des: des, category: cat, crop: true, steps: 30, seed }
      })
    });
    if (pr.status === 429) {
      const retryAfter = parseInt(pr.headers.get('retry-after') || '12');
      await sleep((retryAfter + 2) * 1000);
      continue;
    }
    const pd = await pr.json();
    if (!pd.id) throw new Error('No pred ID: ' + JSON.stringify(pd).slice(0, 60));
    return pd.id;
  }
  throw new Error('Rate limited after 4 attempts');
}

async function pollPred(predId, R8) {
  for (let i = 0; i < 25; i++) {
    await sleep(3000);
    const p = await (await fetch('https://api.replicate.com/v1/predictions/' + predId, { headers: { Authorization: 'Token ' + R8 } })).json();
    if (p.status === 'succeeded') return p.output;
    if (p.status === 'failed' || p.status === 'canceled') throw new Error(p.status + ': ' + (p.error || ''));
  }
  throw new Error('Timeout');
}

async function runIdmVton(humanUrl, garmentUrl, garmentDes, category, R8) {
  const outputs = [];
  const seeds = [42, 123, 777];
  for (let s = 0; s < seeds.length; s++) {
    try {
      if (s > 0) await sleep(11000);
      const predId = await createPred(humanUrl, garmentUrl, garmentDes, category, seeds[s], R8);
      outputs.push(await pollPred(predId, R8));
    } catch (e) { console.warn('[tryon] idm-vton seed', seeds[s], 'failed:', e.message); }
  }
  return outputs;
}

function mapCategoryToGarmentType(category) {
  if (category === 'lower_body') return 'lower_body';
  if (category === 'dresses') return 'dress';
  return 'upper_body';
}

async function runLeffa(humanUrl, garmentUrl, category, FAL) {
  const garmentType = mapCategoryToGarmentType(category);
  const sub = await fetch('https://queue.fal.run/fal-ai/leffa/virtual-tryon', {
    method: 'POST',
    headers: { Authorization: 'Key ' + FAL, 'Content-Type': 'application/json' },
    body: JSON.stringify({ human_image_url: humanUrl, garment_image_url: garmentUrl, garment_type: garmentType })
  });
  const subData = await sub.json();
  if (!subData.status_url) throw new Error('LEFFA submit failed: ' + JSON.stringify(subData).slice(0, 100));
  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    const st = await (await fetch(subData.status_url, { headers: { Authorization: 'Key ' + FAL } })).json();
    if (st.status === 'COMPLETED') {
      const result = await (await fetch(st.response_url, { headers: { Authorization: 'Key ' + FAL } })).json();
      if (result.image && result.image.url) return [result.image.url];
      throw new Error('LEFFA result missing image: ' + JSON.stringify(result).slice(0, 100));
    }
    if (st.status === 'ERROR') throw new Error('LEFFA error: ' + JSON.stringify(st).slice(0, 100));
  }
  throw new Error('LEFFA timed out');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  let user = null;
  let profile = null;
  if (adminConfigured) {
    user = await getUserFromRequest(req);
    if (!user) { res.status(401).json({ error: 'Sign in to generate' }); return; }
    profile = await getOrCreateProfile(user, TRIAL_CREDITS);
    if (!profile || profile.credits_remaining <= 0) {
      res.status(402).json({ error: 'Out of credits \u2014 upgrade your plan to keep generating' });
      return;
    }
  }

  try {
    const R8 = process.env.REPLICATE_API_TOKEN;
    const ANT = process.env.ANTHROPIC_API_KEY;
    const FAL = process.env.FAL_API_KEY;

    let humanUrl = req.body.humanUrl;
    let garmentUrl = req.body.garmentUrl;
    const garmentDes = req.body.garmentDes || 'clothing';
    const category = req.body.category || 'upper_body';
    const engine = req.body.engine || 'idm-vton';

    if (!humanUrl && req.body.humanBase64) humanUrl = await uploadB64(req.body.humanBase64, 'person.jpg', R8);
    if (!garmentUrl && req.body.garmentBase64) garmentUrl = await uploadB64(req.body.garmentBase64, 'garment.jpg', R8);
    if (!humanUrl || !garmentUrl) { res.status(400).json({ error: 'Missing images' }); return; }

    let outputs = [];
    let engineUsed = engine;

    if (engine === 'leffa') {
      if (!FAL) { res.status(500).json({ error: 'FAL_API_KEY not set' }); return; }
      try {
        outputs = await runLeffa(humanUrl, garmentUrl, category, FAL);
      } catch (e) {
        console.warn('[tryon] LEFFA failed, falling back to idm-vton:', e.message);
        if (!R8) throw e;
        outputs = await runIdmVton(humanUrl, garmentUrl, garmentDes, category, R8);
        engineUsed = 'idm-vton (fallback)';
      }
    } else {
      if (!R8) { res.status(500).json({ error: 'REPLICATE_API_TOKEN not set' }); return; }
      outputs = await runIdmVton(humanUrl, garmentUrl, garmentDes, category, R8);
    }

    if (outputs.length === 0) throw new Error('All generations failed. Check provider balance and dashboards.');

    let best = outputs[0];
    if (outputs.length > 1 && ANT) {
      try {
        const b64s = await Promise.all(outputs.map(async (url) => {
          const r2 = await fetch(url);
          return Buffer.from(await r2.arrayBuffer()).toString('base64');
        }));
        const msgs = [];
        for (let j = 0; j < b64s.length; j++) {
          msgs.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64s[j] } });
          msgs.push({ type: 'text', text: 'Option ' + (j + 1) });
        }
        msgs.push({ type: 'text', text: 'Which is most photorealistic and natural? Reply only: 1, 2, or 3.' });
        const cr = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': ANT, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 3, system: 'Reply with only a single digit.', messages: [{ role: 'user', content: msgs }] })
        });
        const cd = await cr.json();
        const pick = parseInt((cd.content && cd.content[0] ? cd.content[0].text : '1').trim()) || 1;
        best = outputs[Math.min(Math.max(pick - 1, 0), outputs.length - 1)];
      } catch (e) { console.warn('[tryon] pick failed:', e.message); }
    }

    let creditsRemaining;
    if (adminConfigured && user) {
      creditsRemaining = profile.credits_remaining - 1;
      await supabaseAdmin.from('profiles').update({ credits_remaining: creditsRemaining }).eq('id', user.id);
      await supabaseAdmin.from('generations').insert({ user_id: user.id, engine: engineUsed, status: 'succeeded', credits_used: 1 });
    }

    res.status(200).json({ output: best, all_outputs: outputs, seeds_used: outputs.length, engine: engineUsed, credits_remaining: creditsRemaining });
  } catch (err) {
    if (adminConfigured && user) {
      await supabaseAdmin.from('generations').insert({ user_id: user.id, engine: 'idm-vton', status: 'failed', credits_used: 0 });
    }
    console.error('[tryon]', err.message);
    res.status(500).json({ error: err.message });
  }
}

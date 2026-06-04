export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const { humanBase64, garmentBase64, garmentDes, category } = req.body;
    if (!humanBase64 || !garmentBase64) { res.status(400).json({ error: 'Missing images' }); return; }

    const R8 = process.env.REPLICATE_API_TOKEN;
    if (!R8) { res.status(500).json({ error: 'REPLICATE_API_TOKEN not set' }); return; }

    const sleep = function(ms) { return new Promise(function(r) { setTimeout(r, ms); }); };

    function getB64(d) { return d.includes(',') ? d.split(',')[1] : d; }
    function getMime(d) { return d.startsWith('data:image/') ? d.split(';')[0].split(':')[1] : 'image/jpeg'; }

    async function upload(dataUrl, filename) {
      const buf = Buffer.from(getB64(dataUrl), 'base64');
      const ct  = getMime(dataUrl);
      const bnd = 'Drape' + Date.now();
      const CR  = '
';
      const h = Buffer.from('--' + bnd + CR + 'Content-Disposition: form-data; name="content"; filename="' + filename + '"' + CR + 'Content-Type: ' + ct + CR + CR);
      const t = Buffer.from(CR + '--' + bnd + '--' + CR);
      const body = Buffer.concat([h, buf, t]);
      const r = await fetch('https://api.replicate.com/v1/files', {
        method: 'POST',
        headers: { 'Authorization': 'Token ' + R8, 'Content-Type': 'multipart/form-data; boundary=' + bnd, 'Content-Length': String(body.length) },
        body: body
      });
      const txt = await r.text();
      if (!r.ok) throw new Error('Upload ' + r.status + ': ' + txt.slice(0, 80));
      return JSON.parse(txt).urls.get;
    }

    async function runSeed(hUrl, gUrl, des, cat, seed) {
      const pr = await fetch('https://api.replicate.com/v1/predictions', {
        method: 'POST',
        headers: { 'Authorization': 'Token ' + R8, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: 'c871bb9b046607b680449ecbae55fd8c6d945e0a1948644bf2361b3d021d3ff4',
          input: { human_img: hUrl, garm_img: gUrl, garment_des: des || 'clothing', category: cat || 'upper_body', crop: true, steps: 30, seed: seed }
        })
      });
      const pd = await pr.json();
      if (!pd.id) throw new Error('No pred ID');
      for (var i = 0; i < 25; i++) {
        await sleep(3000);
        const p = await (await fetch('https://api.replicate.com/v1/predictions/' + pd.id, { headers: { 'Authorization': 'Token ' + R8 } })).json();
        if (p.status === 'succeeded') return p.output;
        if (p.status === 'failed' || p.status === 'canceled') throw new Error(p.status + ': ' + (p.error || ''));
      }
      throw new Error('Timeout');
    }

    const uploaded = await Promise.all([upload(humanBase64, 'person.jpg'), upload(garmentBase64, 'garment.jpg')]);
    const hUrl = uploaded[0];
    const gUrl = uploaded[1];

    const outputs = [];
    const seeds = [42, 123, 777];
    for (var s = 0; s < seeds.length; s++) {
      try {
        const out = await runSeed(hUrl, gUrl, garmentDes, category, seeds[s]);
        outputs.push(out);
        if (s < seeds.length - 1) await sleep(500);
      } catch(e) {
        console.warn('seed failed:', e.message);
      }
    }

    if (outputs.length === 0) throw new Error('All seeds failed. Check Replicate balance at replicate.com/account/billing');

    res.status(200).json({ output: outputs[0], all_outputs: outputs, seeds_used: outputs.length });

  } catch(err) {
    console.error('[tryon]', err.message);
    res.status(500).json({ error: err.message });
  }
}

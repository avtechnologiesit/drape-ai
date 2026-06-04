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
    if (!R8) { res.status(500).json({ error: 'No R8 token' }); return; }

    function getB64(d) { return d.includes(',') ? d.split(',')[1] : d; }
    function getMime(d) { return d.startsWith('data:image/') ? d.split(';')[0].split(':')[1] : 'image/jpeg'; }

    async function upload(dataUrl, filename) {
      const buf = Buffer.from(getB64(dataUrl), 'base64');
      const ct  = getMime(dataUrl);
      const bnd = 'D' + Date.now();
      const CR  = '
';
      const h   = Buffer.from('--' + bnd + CR + 'Content-Disposition: form-data; name="content"; filename="' + filename + '"' + CR + 'Content-Type: ' + ct + CR + CR);
      const t   = Buffer.from(CR + '--' + bnd + '--' + CR);
      const body = Buffer.concat([h, buf, t]);
      const r = await fetch('https://api.replicate.com/v1/files', {
        method: 'POST',
        headers: { 'Authorization': 'Token ' + R8, 'Content-Type': 'multipart/form-data; boundary=' + bnd, 'Content-Length': String(body.length) },
        body: body
      });
      const txt = await r.text();
      if (!r.ok) throw new Error('Upload failed: ' + txt.slice(0, 60));
      return JSON.parse(txt).urls.get;
    }

    async function runOneSeed(hUrl, gUrl, des, cat) {
      const sleep = function(ms) { return new Promise(function(r) { setTimeout(r, ms); }); };
      const pr = await fetch('https://api.replicate.com/v1/predictions', {
        method: 'POST',
        headers: { 'Authorization': 'Token ' + R8, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: 'c871bb9b046607b680449ecbae55fd8c6d945e0a1948644bf2361b3d021d3ff4',
          input: { human_img: hUrl, garm_img: gUrl, garment_des: des || 'clothing', category: cat || 'upper_body', crop: true, steps: 30, seed: 42 }
        })
      });
      const pd = await pr.json();
      if (!pd.id) throw new Error('No pred ID');
      for (var i = 0; i < 25; i++) {
        await sleep(3000);
        const p = await (await fetch('https://api.replicate.com/v1/predictions/' + pd.id, { headers: { 'Authorization': 'Token ' + R8 } })).json();
        if (p.status === 'succeeded') return p.output;
        if (p.status === 'failed' || p.status === 'canceled') throw new Error(p.status);
      }
      throw new Error('Timeout');
    }

    const uploaded = await Promise.all([upload(humanBase64, 'person.jpg'), upload(garmentBase64, 'garment.jpg')]);
    const output = await runOneSeed(uploaded[0], uploaded[1], garmentDes, category);
    res.status(200).json({ output: output, all_outputs: [output], seeds_used: 1 });

  } catch(err) {
    console.error('[tryon]', err.message);
    res.status(500).json({ error: err.message });
  }
}

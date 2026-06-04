export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST')   { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const { humanBase64, garmentBase64, garmentDes, category } = req.body;
    if (!humanBase64 || !garmentBase64) { res.status(400).json({ error: 'Missing images' }); return; }

    const R8  = process.env.REPLICATE_API_TOKEN;
    const ANT = process.env.ANTHROPIC_API_KEY;
    if (!R8) { res.status(500).json({ error: 'REPLICATE_API_TOKEN not set' }); return; }

    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const strip = d => d.includes(',') ? d.split(',')[1] : d;
    const mime  = d => d.startsWith('data:image/') ? d.split(';')[0].split(':')[1] : 'image/jpeg';

    async function upload(dataUrl, filename) {
      const buf   = Buffer.from(strip(dataUrl), 'base64');
      const ct    = mime(dataUrl);
      const bound = 'Drape' + Date.now();
      const CRLF  = '
';
      const head  = Buffer.from('--' + bound + CRLF +
        'Content-Disposition: form-data; name="content"; filename="' + filename + '"' + CRLF +
        'Content-Type: ' + ct + CRLF + CRLF);
      const tail  = Buffer.from(CRLF + '--' + bound + '--' + CRLF);
      const body  = Buffer.concat([head, buf, tail]);
      const r = await fetch('https://api.replicate.com/v1/files', {
        method: 'POST',
        headers: {
          'Authorization': 'Token ' + R8,
          'Content-Type': 'multipart/form-data; boundary=' + bound,
          'Content-Length': String(body.length)
        },
        body
      });
      const t = await r.text();
      if (!r.ok) throw new Error('Upload ' + r.status + ': ' + t.slice(0, 100));
      return JSON.parse(t).urls.get;
    }

    async function runVTON(hUrl, gUrl, des, cat, seed) {
      const pr = await fetch('https://api.replicate.com/v1/predictions', {
        method: 'POST',
        headers: { 'Authorization': 'Token ' + R8, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: 'c871bb9b046607b680449ecbae55fd8c6d945e0a1948644bf2361b3d021d3ff4',
          input: { human_img: hUrl, garm_img: gUrl, garment_des: des || 'clothing',
                   category: cat || 'upper_body', crop: true, steps: 30, seed }
        })
      });
      const pd = await pr.json();
      if (!pd.id) throw new Error('No ID: ' + JSON.stringify(pd).slice(0, 80));
      for (let i = 0; i < 25; i++) {
        await sleep(3000);
        const p = await (await fetch('https://api.replicate.com/v1/predictions/' + pd.id,
          { headers: { 'Authorization': 'Token ' + R8 } })).json();
        if (p.status === 'succeeded') return p.output;
        if (p.status === 'failed' || p.status === 'canceled')
          throw new Error(p.status + ': ' + (p.error || ''));
      }
      throw new Error('Timeout seed ' + seed);
    }

    const [hUrl, gUrl] = await Promise.all([
      upload(humanBase64, 'person.jpg'),
      upload(garmentBase64, 'garment.jpg')
    ]);

    const outputs = [];
    for (const seed of [42, 123, 777]) {
      try {
        outputs.push(await runVTON(hUrl, gUrl, garmentDes, category, seed));
        if (outputs.length < 3) await sleep(500);
      } catch(e) { console.warn('seed', seed, 'failed:', e.message); }
    }

    if (outputs.length === 0)
      throw new Error('All seeds failed. Check Replicate balance at replicate.com/account/billing');

    let best = outputs[0];
    if (outputs.length > 1 && ANT) {
      try {
        const b64s = await Promise.all(outputs.map(async url => {
          const r = await fetch(url);
          return Buffer.from(await r.arrayBuffer()).toString('base64');
        }));
        var content = [
          { type:'image', source:{ type:'base64', media_type:'image/jpeg', data: strip(humanBase64) } },
          { type:'text', text: 'Original person' },
          { type:'image', source:{ type:'base64', media_type:'image/jpeg', data: strip(garmentBase64) } },
          { type:'text', text: 'Reference garment' }
        ];
        b64s.forEach(function(b, i) {
          content.push({ type:'image', source:{ type:'base64', media_type:'image/jpeg', data: b } });
          content.push({ type:'text', text: 'Option ' + (i+1) });
        });
        content.push({ type:'text', text: 'Which best preserves the person face AND shows the garment accurately? Reply: 1, 2, or 3 only.' });
        const cr = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': ANT, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 3,
            system: 'Reply with only a single digit.', messages: [{ role:'user', content }] })
        });
        const cd = await cr.json();
        const pick = parseInt(cd.content?.[0]?.text?.trim()) || 1;
        best = outputs[Math.min(Math.max(pick - 1, 0), outputs.length - 1)];
      } catch(e) { console.warn('Claude pick failed:', e.message); }
    }

    res.status(200).json({ output: best, all_outputs: outputs, seeds_used: outputs.length });

  } catch(err) {
    console.error('[tryon]', err.message);
    res.status(500).json({ error: err.message });
  }
}

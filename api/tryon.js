export const config = { maxDuration: 120 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { humanBase64, garmentBase64, garmentDes, category } = req.body;
    if (!humanBase64 || !garmentBase64) return res.status(400).json({ error: 'Missing images' });

    const R8  = process.env.REPLICATE_API_TOKEN;
    const ANT = process.env.ANTHROPIC_API_KEY;

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    // Strip data URL prefix and get raw base64
    function getRawB64(dataUrl) {
      return dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
    }

    // Get content type from data URL
    function getContentType(dataUrl) {
      if (dataUrl.startsWith('data:')) {
        const ct = dataUrl.split(';')[0].split(':')[1];
        if (ct && ct.startsWith('image/')) return ct;
      }
      return 'image/jpeg';
    }

    // Upload to Replicate
    async function upload(dataUrl, filename) {
      const rawB64      = getRawB64(dataUrl);
      const contentType = getContentType(dataUrl);
      const buffer      = Buffer.from(rawB64, 'base64');
      const boundary    = 'DrapeB' + Date.now() + Math.random().toString(36).slice(2);
      const CRLF        = '\r\n';

      const head = Buffer.from(
        '--' + boundary + CRLF +
        'Content-Disposition: form-data; name="content"; filename="' + filename + '"' + CRLF +
        'Content-Type: ' + contentType + CRLF + CRLF
      );
      const tail = Buffer.from(CRLF + '--' + boundary + '--' + CRLF);
      const body = Buffer.concat([head, buffer, tail]);

      const resp = await fetch('https://api.replicate.com/v1/files', {
        method: 'POST',
        headers: {
          'Authorization': 'Token ' + R8,
          'Content-Type':  'multipart/form-data; boundary=' + boundary,
          'Content-Length': String(body.length)
        },
        body
      });

      const text = await resp.text();
      if (!resp.ok) throw new Error('Upload failed ' + resp.status + ': ' + text.slice(0, 150));
      const result = JSON.parse(text);
      return result.urls.get;
    }

    // Run one IDM-VTON prediction
    async function runVTON(humanUrl, garmentUrl, des, cat, seed) {
      const pr = await fetch('https://api.replicate.com/v1/predictions', {
        method: 'POST',
        headers: { 'Authorization': 'Token ' + R8, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: 'c871bb9b046607b680449ecbae55fd8c6d945e0a1948644bf2361b3d021d3ff4',
          input: {
            human_img:   humanUrl,
            garm_img:    garmentUrl,
            garment_des: des || 'clothing',
            category:    cat || 'upper_body',
            crop:        true,
            steps:       30,
            seed
          }
        })
      });
      const pd = await pr.json();
      if (!pd.id) throw new Error('No prediction ID: ' + JSON.stringify(pd).slice(0, 100));
      console.log('[tryon] seed', seed, 'prediction', pd.id);

      for (let i = 0; i < 25; i++) {
        await sleep(3000);
        const poll = await fetch('https://api.replicate.com/v1/predictions/' + pd.id, {
          headers: { 'Authorization': 'Token ' + R8 }
        });
        const p = await poll.json();
        console.log('[tryon] seed', seed, 'poll', i+1, p.status);
        if (p.status === 'succeeded') return p.output;
        if (p.status === 'failed' || p.status === 'canceled')
          throw new Error('seed ' + seed + ' ' + p.status + ': ' + (p.error || ''));
      }
      throw new Error('seed ' + seed + ' timed out');
    }

    // Upload both images
    console.log('[tryon] uploading...');
    const [humanUrl, garmentUrl] = await Promise.all([
      upload(humanBase64,   'person.jpg'),
      upload(garmentBase64, 'garment.jpg')
    ]);
    console.log('[tryon] uploaded. human:', humanUrl.slice(-20), 'garment:', garmentUrl.slice(-20));

    // Run seeds sequentially
    const seeds   = [42, 123, 777];
    const outputs = [];
    for (const seed of seeds) {
      try {
        const out = await runVTON(humanUrl, garmentUrl, garmentDes, category, seed);
        outputs.push(out);
        console.log('[tryon] seed', seed, 'output:', out);
        if (outputs.length < seeds.length) await sleep(500);
      } catch (e) {
        console.warn('[tryon] seed', seed, 'failed:', e.message);
      }
    }

    if (outputs.length === 0)
      throw new Error('All seeds failed — check your Replicate balance at replicate.com/account/billing');

    // Claude picks best
    let bestUrl = outputs[0];
    if (outputs.length > 1 && ANT) {
      try {
        const outB64s = await Promise.all(outputs.map(async url => {
          const r = await fetch(url);
          return Buffer.from(await r.arrayBuffer()).toString('base64');
        }));
        const hd = getRawB64(humanBase64);
        const gd = getRawB64(garmentBase64);
        const content = [
          { type:'image', source:{ type:'base64', media_type:'image/jpeg', data: hd } },
          { type:'text',  text: 'Original person' },
          { type:'image', source:{ type:'base64', media_type:'image/jpeg', data: gd } },
          { type:'text',  text: 'Reference garment' },
        ];
        outB64s.forEach((b64, i) => {
          content.push({ type:'image', source:{ type:'base64', media_type:'image/jpeg', data: b64 } });
          content.push({ type:'text',  text: 'Option ' + (i+1) });
        });
        content.push({ type:'text', text:
          'Which best preserves the person face AND shows the garment? Reply: 1, 2, or 3 only.'
        });
        const cr = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': ANT, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001', max_tokens: 3,
            system: 'Reply with only a single digit number.',
            messages: [{ role:'user', content }]
          })
        });
        const cd = await cr.json();
        const pick = parseInt(cd.content?.[0]?.text?.trim()) || 1;
        bestUrl = outputs[Math.min(Math.max(pick-1,0), outputs.length-1)];
        console.log('[tryon] Claude picked', pick, 'of', outputs.length);
      } catch (e) {
        console.warn('[tryon] Claude pick failed:', e.message);
      }
    }

    console.log('[tryon] done, returning', outputs.length, 'outputs');
    return res.status(200).json({ output: bestUrl, all_outputs: outputs, seeds_used: outputs.length });

  } catch (err) {
    console.error('[tryon] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

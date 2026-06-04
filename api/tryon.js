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

    // ── Upload image to Replicate ──────────────────────────────────────────
    async function upload(b64Data, filename) {
      const b64    = b64Data.includes(',') ? b64Data.split(',')[1] : b64Data;
      const buffer = Buffer.from(b64, 'base64');
      const boundary = 'DrapeB' + Date.now();
      const CRLF = '\r\n';
      const head = Buffer.from(
        '--' + boundary + CRLF +
        'Content-Disposition: form-data; name="content"; filename="' + filename + '"' + CRLF +
        'Content-Type: image/jpeg' + CRLF + CRLF
      );
      const tail = Buffer.from(CRLF + '--' + boundary + '--' + CRLF);
      const body = Buffer.concat([head, buffer, tail]);

      const resp = await fetch('https://api.replicate.com/v1/files', {
        method: 'POST',
        headers: {
          'Authorization': 'Token ' + R8,
          'Content-Type': 'multipart/form-data; boundary=' + boundary,
          'Content-Length': body.length.toString()
        },
        body
      });
      const text = await resp.text();
      if (!resp.ok) throw new Error('Upload failed (' + resp.status + '): ' + text.slice(0,100));
      return JSON.parse(text).urls.get;
    }

    // ── Run IDM-VTON with one seed ─────────────────────────────────────────
    async function runVTON(humanUrl, garmentUrl, des, cat, seed) {
      const predResp = await fetch('https://api.replicate.com/v1/predictions', {
        method: 'POST',
        headers: { 'Authorization': 'Token ' + R8, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: 'c871bb9b046607b680449ecbae55fd8c6d945e0a1948644bf2361b3d021d3ff4',
          input: {
            human_img:   humanUrl,
            garm_img:    garmentUrl,
            garment_des: des || 'clothing item',
            category:    cat || 'upper_body',
            crop:        true,
            steps:       40,
            seed:        seed
          }
        })
      });
      const predData = await predResp.json();
      if (!predData.id) throw new Error('No prediction ID: ' + JSON.stringify(predData).slice(0,100));

      for (let i = 0; i < 30; i++) {
        await sleep(3000);
        const poll = await fetch('https://api.replicate.com/v1/predictions/' + predData.id, {
          headers: { 'Authorization': 'Token ' + R8 }
        });
        const p = await poll.json();
        if (p.status === 'succeeded') return p.output;
        if (p.status === 'failed' || p.status === 'canceled')
          throw new Error('Seed ' + seed + ' failed: ' + (p.error || ''));
      }
      throw new Error('Seed ' + seed + ' timed out');
    }

    // ── Claude picks best output ───────────────────────────────────────────
    async function pickBest(humanB64, garmentB64, outputUrls) {
      if (outputUrls.length === 1) return outputUrls[0];

      const outputB64s = await Promise.all(outputUrls.map(async url => {
        const r = await fetch(url);
        return Buffer.from(await r.arrayBuffer()).toString('base64');
      }));

      const hd = humanB64.includes(',')   ? humanB64.split(',')[1]   : humanB64;
      const gd = garmentB64.includes(',') ? garmentB64.split(',')[1] : garmentB64;

      const content = [
        { type:'image', source:{ type:'base64', media_type:'image/jpeg', data: hd } },
        { type:'text',  text: 'Image 1: Original person' },
        { type:'image', source:{ type:'base64', media_type:'image/jpeg', data: gd } },
        { type:'text',  text: 'Image 2: Reference garment' },
      ];
      outputB64s.forEach((b64, i) => {
        content.push({ type:'image', source:{ type:'base64', media_type:'image/jpeg', data: b64 } });
        content.push({ type:'text',  text: 'Option ' + (i+1) });
      });
      content.push({ type:'text', text:
        'Which option best preserves the person face from Image 1 AND accurately shows the garment from Image 2 with no artifacts? Reply with only the number: 1, 2, or 3.'
      });

      const cr = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': ANT, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001', max_tokens: 5,
          system: 'Reply with only a single digit number.',
          messages: [{ role:'user', content }]
        })
      });
      const cd = await cr.json();
      const pick = parseInt(cd.content?.[0]?.text?.trim()) || 1;
      const idx  = Math.min(Math.max(pick - 1, 0), outputUrls.length - 1);
      console.log('[DRAPE] Claude picked option', pick, 'of', outputUrls.length);
      return outputUrls[idx];
    }

    // ── MAIN ──────────────────────────────────────────────────────────────
    console.log('[DRAPE] Uploading images...');
    const [humanUrl, garmentUrl] = await Promise.all([
      upload(humanBase64,   'person.jpg'),
      upload(garmentBase64, 'garment.jpg')
    ]);
    console.log('[DRAPE] Uploaded. Running seeds sequentially...');

    // Run 3 seeds SEQUENTIALLY to avoid rate limits
    const seeds = [42, 123, 777];
    const outputs = [];

    for (const seed of seeds) {
      try {
        console.log('[DRAPE] Running seed', seed, '...');
        const out = await runVTON(humanUrl, garmentUrl, garmentDes, category, seed);
        outputs.push(out);
        console.log('[DRAPE] Seed', seed, 'succeeded');
        // Small delay between seeds to respect rate limits
        if (seed !== seeds[seeds.length - 1]) await sleep(2000);
      } catch(e) {
        console.warn('[DRAPE] Seed', seed, 'failed:', e.message);
        // Continue with next seed
      }
    }

    if (outputs.length === 0) throw new Error('All seeds failed — check Replicate balance and rate limits');
    console.log('[DRAPE]', outputs.length, 'outputs generated');

    const bestUrl = await pickBest(humanBase64, garmentBase64, outputs);

    return res.status(200).json({
      output:      bestUrl,
      all_outputs: outputs,
      seeds_used:  outputs.length
    });

  } catch (err) {
    console.error('[DRAPE error]', err.message);
    return res.status(500).json({ error: err.message });
  }
}

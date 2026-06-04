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

    // ── Upload to Replicate ──────────────────────────────────────────────────
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
      if (!resp.ok) throw new Error('Upload failed (' + resp.status + '): ' + text.slice(0,120));
      return JSON.parse(text).urls.get;
    }

    // ── Run IDM-VTON ─────────────────────────────────────────────────────────
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
            steps:       30,
            seed:        seed
          }
        })
      });

      const predData = await predResp.json();
      if (!predData.id) throw new Error('No prediction ID: ' + JSON.stringify(predData).slice(0,150));
      console.log('[DRAPE] Prediction created:', predData.id, 'seed:', seed);

      for (let i = 0; i < 25; i++) {
        await sleep(3000);
        const poll = await fetch('https://api.replicate.com/v1/predictions/' + predData.id, {
          headers: { 'Authorization': 'Token ' + R8 }
        });
        const p = await poll.json();
        console.log('[DRAPE] Poll', i+1, ':', p.status);
        if (p.status === 'succeeded') return p.output;
        if (p.status === 'failed' || p.status === 'canceled')
          throw new Error('Prediction ' + p.status + ': ' + (p.error || 'unknown error'));
      }
      throw new Error('Timed out after 75s waiting for IDM-VTON');
    }

    // ── MAIN ─────────────────────────────────────────────────────────────────
    console.log('[DRAPE] Starting. Uploading images...');

    const [humanUrl, garmentUrl] = await Promise.all([
      upload(humanBase64,   'person.jpg'),
      upload(garmentBase64, 'garment.jpg')
    ]);
    console.log('[DRAPE] Both images uploaded');

    // Run 3 seeds sequentially — each takes ~20s, total ~60s well within 120s limit
    const seeds   = [42, 123, 777];
    const outputs = [];

    for (const seed of seeds) {
      try {
        console.log('[DRAPE] Running seed', seed);
        const out = await runVTON(humanUrl, garmentUrl, garmentDes, category, seed);
        outputs.push(out);
        console.log('[DRAPE] Seed', seed, 'done:', out);
        if (outputs.length < seeds.length) await sleep(1000);
      } catch(e) {
        console.warn('[DRAPE] Seed', seed, 'failed:', e.message);
      }
    }

    if (outputs.length === 0) {
      throw new Error('All seeds failed. Check Replicate balance at replicate.com/account/billing');
    }

    // Pick best with Claude if multiple outputs, else return single
    let bestUrl = outputs[0];

    if (outputs.length > 1 && ANT) {
      try {
        const outputB64s = await Promise.all(outputs.map(async url => {
          const r = await fetch(url);
          return Buffer.from(await r.arrayBuffer()).toString('base64');
        }));
        const hd = humanBase64.includes(',')   ? humanBase64.split(',')[1]   : humanBase64;
        const gd = garmentBase64.includes(',') ? garmentBase64.split(',')[1] : garmentBase64;
        const content = [
          { type:'image', source:{ type:'base64', media_type:'image/jpeg', data: hd } },
          { type:'text',  text: 'Original person' },
          { type:'image', source:{ type:'base64', media_type:'image/jpeg', data: gd } },
          { type:'text',  text: 'Reference garment' },
        ];
        outputB64s.forEach((b64, i) => {
          content.push({ type:'image', source:{ type:'base64', media_type:'image/jpeg', data: b64 } });
          content.push({ type:'text',  text: 'Option ' + (i+1) });
        });
        content.push({ type:'text', text:
          'Which option best preserves the exact face from the original person AND most accurately shows the reference garment? Reply with only: 1, 2, or 3.'
        });
        const cr = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': ANT, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001', max_tokens: 3,
            system: 'Reply with only a single digit.',
            messages: [{ role:'user', content }]
          })
        });
        const cd = await cr.json();
        const pick = parseInt(cd.content?.[0]?.text?.trim()) || 1;
        const idx  = Math.min(Math.max(pick - 1, 0), outputs.length - 1);
        bestUrl = outputs[idx];
        console.log('[DRAPE] Claude picked option', pick);
      } catch(e) {
        console.warn('[DRAPE] Claude pick failed, using first result:', e.message);
      }
    }

    console.log('[DRAPE] Done! Returning', outputs.length, 'results');
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

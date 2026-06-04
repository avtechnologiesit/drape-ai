
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

    const R8 = process.env.REPLICATE_API_TOKEN;
    const ANT = process.env.ANTHROPIC_API_KEY;

    // ── 1. PREPROCESS: Remove garment background & crop person to 3:4 ──────
    async function processImages(humanB64, garmentB64) {
      // Convert base64 to Buffers
      const toBuffer = (b64) => Buffer.from(
        b64.includes(',') ? b64.split(',')[1] : b64, 'base64'
      );
      const humanBuf   = toBuffer(humanB64);
      const garmentBuf = toBuffer(garmentB64);

      // Remove garment background via rembg on Replicate
      async function removeBackground(imgBuf) {
        const url = await uploadToReplicate(imgBuf, 'garment.jpg');
        const pred = await fetch('https://api.replicate.com/v1/models/cjwbw/rembg/predictions', {
          method: 'POST',
          headers: { 'Authorization': 'Token ' + R8, 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: { image: url } })
        });
        const predData = await pred.json();
        if (!predData.id) throw new Error('rembg failed: ' + JSON.stringify(predData).slice(0,100));
        // Poll
        for (let i = 0; i < 20; i++) {
          await sleep(2000);
          const poll = await fetch('https://api.replicate.com/v1/predictions/' + predData.id, {
            headers: { 'Authorization': 'Token ' + R8 }
          });
          const p = await poll.json();
          if (p.status === 'succeeded') {
            // Download the PNG with transparent bg, convert to white-bg JPEG
            const pngResp = await fetch(p.output);
            const pngBuf  = Buffer.from(await pngResp.arrayBuffer());
            return pngBuf; // return PNG with transparency for IDM-VTON
          }
          if (p.status === 'failed') throw new Error('rembg failed: ' + p.error);
        }
        throw new Error('rembg timeout');
      }

      // Try background removal — fall back to original if it fails
      let cleanGarment = garmentBuf;
      try {
        cleanGarment = await removeBackground(garmentBuf);
        console.log('[DRAPE] Background removed from garment');
      } catch(e) {
        console.warn('[DRAPE] BG removal failed, using original:', e.message);
      }

      return { humanBuf, garmentBuf: cleanGarment };
    }

    // ── 2. Upload to Replicate ───────────────────────────────────────────────
    async function uploadToReplicate(imgBuf, filename) {
      const boundary = 'DrapeB' + Date.now();
      const CRLF = '\r\n';
      const head = Buffer.from(
        '--' + boundary + CRLF +
        'Content-Disposition: form-data; name="content"; filename="' + filename + '"' + CRLF +
        'Content-Type: image/jpeg' + CRLF + CRLF
      );
      const tail = Buffer.from(CRLF + '--' + boundary + '--' + CRLF);
      const body = Buffer.concat([head, imgBuf, tail]);

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
      if (!resp.ok) throw new Error('Upload failed (' + resp.status + '): ' + text);
      return JSON.parse(text).urls.get;
    }

    // ── 3. Run IDM-VTON with given seed ──────────────────────────────────────
    async function runIDMVTON(humanUrl, garmentUrl, des, cat, seed) {
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
            steps:       40,          // MAX steps for best quality
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
          throw new Error('IDM-VTON ' + p.status + ': ' + (p.error || ''));
      }
      throw new Error('IDM-VTON timeout after 90s');
    }

    // ── 4. Claude picks the best result from multiple seeds ──────────────────
    async function pickBestResult(humanB64, garmentB64, outputUrls) {
      if (outputUrls.length === 1) return outputUrls[0];

      // Fetch all output images as base64
      const outputB64s = await Promise.all(outputUrls.map(async url => {
        const r = await fetch(url);
        const buf = Buffer.from(await r.arrayBuffer());
        return buf.toString('base64');
      }));

      const humanData   = humanB64.includes(',') ? humanB64.split(',')[1] : humanB64;
      const garmentData = garmentB64.includes(',') ? garmentB64.split(',')[1] : garmentB64;

      const msgContent = [
        { type:'image', source:{ type:'base64', media_type:'image/jpeg', data: humanData } },
        { type:'text',  text: 'Image 1: Original person (reference for face, body, pose)' },
        { type:'image', source:{ type:'base64', media_type:'image/jpeg', data: garmentData } },
        { type:'text',  text: 'Image 2: Reference garment to try on' },
      ];

      outputB64s.forEach((b64, i) => {
        msgContent.push({ type:'image', source:{ type:'base64', media_type:'image/jpeg', data: b64 } });
        msgContent.push({ type:'text',  text: 'Option ' + (i+1) + ': Virtual try-on result' });
      });

      msgContent.push({ type:'text', text:
        'Compare the ' + outputUrls.length + ' try-on results. ' +
        'Pick the BEST one based on: (1) face preserved from Image 1, ' +
        '(2) garment matches Image 2, (3) natural fabric drape, (4) no artifacts. ' +
        'Reply with ONLY the number: 1, 2, or 3. Nothing else.'
      });

      const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANT,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 5,
          system: 'You are a virtual try-on quality judge. Reply with only the number of the best result.',
          messages: [{ role:'user', content: msgContent }]
        })
      });

      const claudeData = await claudeResp.json();
      const pick = parseInt(claudeData.content?.[0]?.text?.trim()) || 1;
      const idx  = Math.min(Math.max(pick - 1, 0), outputUrls.length - 1);
      console.log('[DRAPE] Claude picked option', pick, 'of', outputUrls.length);
      return outputUrls[idx];
    }

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    // ── MAIN PIPELINE ────────────────────────────────────────────────────────
    console.log('[DRAPE] Starting pipeline...');

    // Step 1: Preprocess (bg removal on garment)
    const { humanBuf, garmentBuf } = await processImages(humanBase64, garmentBase64);

    // Step 2: Upload both images
    const [humanUrl, garmentUrl] = await Promise.all([
      uploadToReplicate(humanBuf,   'person.jpg'),
      uploadToReplicate(garmentBuf, 'garment.jpg')
    ]);
    console.log('[DRAPE] Uploaded. Running 3 seeds in parallel...');

    // Step 3: Run 3 seeds in PARALLEL for speed
    const seeds = [42, 123, 777];
    const results = await Promise.allSettled(
      seeds.map(seed => runIDMVTON(humanUrl, garmentUrl, garmentDes, category, seed))
    );

    const outputUrls = results
      .filter(r => r.status === 'fulfilled' && r.value)
      .map(r => r.value);

    if (outputUrls.length === 0) throw new Error('All IDM-VTON seeds failed');
    console.log('[DRAPE]', outputUrls.length, 'results generated');

    // Step 4: Claude picks the best
    const bestUrl = await pickBestResult(humanBase64, garmentBase64, outputUrls);

    return res.status(200).json({
      output:      bestUrl,
      all_outputs: outputUrls,
      seeds_used:  outputUrls.length
    });

  } catch (err) {
    console.error('[DRAPE tryon error]', err.message);
    return res.status(500).json({ error: err.message });
  }
}

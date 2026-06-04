export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  try {
    const { humanUrl, garmentUrl, garmentDes, category } = req.body;
    if (!humanUrl || !garmentUrl) { res.status(400).json({ error: 'Missing image URLs' }); return; }
    const R8  = process.env.REPLICATE_API_TOKEN;
    const ANT = process.env.ANTHROPIC_API_KEY;
    if (!R8) { res.status(500).json({ error: 'REPLICATE_API_TOKEN not set' }); return; }
    const sleep = function(ms) { return new Promise(function(r) { setTimeout(r, ms); }); };
    async function runSeed(seed) {
      const pr = await fetch('https://api.replicate.com/v1/predictions', {
        method: 'POST',
        headers: { 'Authorization': 'Token ' + R8, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: 'c871bb9b046607b680449ecbae55fd8c6d945e0a1948644bf2361b3d021d3ff4',
          input: { human_img: humanUrl, garm_img: garmentUrl, garment_des: garmentDes || 'clothing', category: category || 'upper_body', crop: true, steps: 30, seed: seed }
        })
      });
      const pd = await pr.json();
      if (!pd.id) throw new Error('No pred ID: ' + JSON.stringify(pd).slice(0, 60));
      for (var i = 0; i < 25; i++) {
        await sleep(3000);
        const p = await (await fetch('https://api.replicate.com/v1/predictions/' + pd.id, { headers: { 'Authorization': 'Token ' + R8 } })).json();
        if (p.status === 'succeeded') return p.output;
        if (p.status === 'failed' || p.status === 'canceled') throw new Error(p.status + ': ' + (p.error || ''));
      }
      throw new Error('Timeout seed ' + seed);
    }
    const outputs = [];
    const seeds = [42, 123, 777];
    for (var s = 0; s < seeds.length; s++) {
      try {
        const out = await runSeed(seeds[s]);
        outputs.push(out);
        if (s < seeds.length - 1) await sleep(500);
      } catch(e) { console.warn('seed ' + seeds[s] + ' failed:', e.message); }
    }
    if (outputs.length === 0) throw new Error('All seeds failed. Check Replicate balance at replicate.com/account/billing');
    var best = outputs[0];
    if (outputs.length > 1 && ANT) {
      try {
        var b64s = await Promise.all(outputs.map(async function(url) {
          var r = await fetch(url); return Buffer.from(await r.arrayBuffer()).toString('base64');
        }));
        var content = [];
        for (var j = 0; j < b64s.length; j++) {
          content.push({ type:'image', source:{ type:'base64', media_type:'image/jpeg', data: b64s[j] } });
          content.push({ type:'text', text: 'Option ' + (j+1) });
        }
        content.push({ type:'text', text: 'Which option looks most like a real photo of the person wearing the garment naturally? Pick the best quality result. Reply with only: 1, 2, or 3.' });
        var cr = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': ANT, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 3, system: 'Reply with only a single digit.', messages: [{ role:'user', content: content }] })
        });
        var cd = await cr.json();
        var pickTxt = cd.content && cd.content[0] ? cd.content[0].text.trim() : '1';
        var pick = parseInt(pickTxt) || 1;
        best = outputs[Math.min(Math.max(pick - 1, 0), outputs.length - 1)];
        console.log('Claude picked', pick, 'of', outputs.length);
      } catch(e) { console.warn('Claude pick failed:', e.message); }
    }
    res.status(200).json({ output: best, all_outputs: outputs, seeds_used: outputs.length });
  } catch(err) {
    console.error('[tryon]', err.message);
    res.status(500).json({ error: err.message });
  }
}

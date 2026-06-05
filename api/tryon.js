export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  var sleep = function(ms) { return new Promise(function(r) { setTimeout(r, ms); }); };

  var uploadB64 = async function(dataUrl, filename, R8) {
    var raw = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
    var ct  = dataUrl.startsWith('data:image/') ? dataUrl.split(';')[0].split(':')[1] : 'image/jpeg';
    var buf = Buffer.from(raw, 'base64');
    var bnd = 'B' + Date.now();
    var NL  = '\r\n';
    var disp = 'form-data; name="content"; filename="' + filename + '"';
    var hs  = '--' + bnd + NL + 'Content-Disposition: ' + disp + NL + 'Content-Type: ' + ct + NL + NL;
    var ts  = NL + '--' + bnd + '--' + NL;
    var head = Buffer.from(hs);
    var tail = Buffer.from(ts);
    var body = Buffer.concat([head, buf, tail]);
    var r = await fetch('https://api.replicate.com/v1/files', {
      method: 'POST',
      headers: { 'Authorization': 'Token ' + R8, 'Content-Type': 'multipart/form-data; boundary=' + bnd, 'Content-Length': String(body.length) },
      body: body
    });
    var txt = await r.text();
    if (!r.ok) throw new Error('Upload ' + r.status + ': ' + txt.slice(0, 60));
    return JSON.parse(txt).urls.get;
  };

  var runSeed = async function(hUrl, gUrl, des, cat, seed, R8) {
    var pr = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: { 'Authorization': 'Token ' + R8, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: 'c871bb9b046607b680449ecbae55fd8c6d945e0a1948644bf2361b3d021d3ff4',
        input: { human_img: hUrl, garm_img: gUrl, garment_des: des, category: cat, crop: true, steps: 30, seed: seed }
      })
    });
    var pd = await pr.json();
    if (!pd.id) throw new Error('No pred ID');
    for (var i = 0; i < 25; i++) {
      await sleep(3000);
      var p = await (await fetch('https://api.replicate.com/v1/predictions/' + pd.id,
        { headers: { 'Authorization': 'Token ' + R8 } })).json();
      if (p.status === 'succeeded') return p.output;
      if (p.status === 'failed' || p.status === 'canceled') throw new Error(p.status + ': ' + (p.error || ''));
    }
    throw new Error('Timeout seed ' + seed);
  };

  try {
    var R8  = process.env.REPLICATE_API_TOKEN;
    var ANT = process.env.ANTHROPIC_API_KEY;
    if (!R8) { res.status(500).json({ error: 'REPLICATE_API_TOKEN not set' }); return; }

    var humanUrl   = req.body.humanUrl;
    var garmentUrl = req.body.garmentUrl;
    var garmentDes = req.body.garmentDes || 'clothing';
    var category   = req.body.category   || 'upper_body';

    if (!humanUrl   && req.body.humanBase64)   humanUrl   = await uploadB64(req.body.humanBase64,   'person.jpg',  R8);
    if (!garmentUrl && req.body.garmentBase64) garmentUrl = await uploadB64(req.body.garmentBase64, 'garment.jpg', R8);
    if (!humanUrl || !garmentUrl) { res.status(400).json({ error: 'Missing images' }); return; }

    var outputs = [];
    for (var s = 0; s < 3; s++) {
      var seed = [42, 123, 777][s];
      try {
        outputs.push(await runSeed(humanUrl, garmentUrl, garmentDes, category, seed, R8));
        if (s < 2) await sleep(500);
      } catch(e) { console.warn('seed ' + seed + ':', e.message); }
    }
    if (outputs.length === 0) throw new Error('All seeds failed. Check replicate.com/account/billing');

    var best = outputs[0];
    if (outputs.length > 1 && ANT) {
      try {
        var b64s = await Promise.all(outputs.map(async function(url) {
          var r2 = await fetch(url);
          return Buffer.from(await r2.arrayBuffer()).toString('base64');
        }));
        var msgs = [];
        for (var j = 0; j < b64s.length; j++) {
          msgs.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64s[j] } });
          msgs.push({ type: 'text', text: 'Option ' + (j + 1) });
        }
        msgs.push({ type: 'text', text: 'Which is most photorealistic? Reply only: 1, 2, or 3.' });
        var cr = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': ANT, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 3,
            system: 'Reply with only a single digit.',
            messages: [{ role: 'user', content: msgs }] })
        });
        var cd = await cr.json();
        var pick = parseInt((cd.content && cd.content[0] ? cd.content[0].text : '1').trim()) || 1;
        best = outputs[Math.min(Math.max(pick - 1, 0), outputs.length - 1)];
      } catch(e) { console.warn('pick failed:', e.message); }
    }

    res.status(200).json({ output: best, all_outputs: outputs, seeds_used: outputs.length });
  } catch(err) {
    console.error('[tryon]', err.message);
    res.status(500).json({ error: err.message });
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  try {
    var body = req.body;
    var R8   = process.env.REPLICATE_API_TOKEN;
    var ANT  = process.env.ANTHROPIC_API_KEY;
    if (!R8) { res.status(500).json({ error: 'REPLICATE_API_TOKEN not set' }); return; }

    var humanUrl   = body.humanUrl;
    var garmentUrl = body.garmentUrl;
    var garmentDes = body.garmentDes || 'clothing';
    var category   = body.category   || 'upper_body';

    // If base64 images provided, upload them to Replicate first
    if (!humanUrl && body.humanBase64) {
      humanUrl = await uploadB64(body.humanBase64, 'person.jpg', R8);
    }
    if (!garmentUrl && body.garmentBase64) {
      garmentUrl = await uploadB64(body.garmentBase64, 'garment.jpg', R8);
    }
    if (!humanUrl || !garmentUrl) {
      res.status(400).json({ error: 'Missing images' }); return;
    }

    var sleep = function(ms) { return new Promise(function(r) { setTimeout(r, ms); }); };

    var outputs = [];
    var seeds = [42, 123, 777];
    for (var s = 0; s < seeds.length; s++) {
      try {
        var out = await runSeed(humanUrl, garmentUrl, garmentDes, category, seeds[s], R8, sleep);
        outputs.push(out);
        if (s < seeds.length - 1) await sleep(500);
      } catch(e) { console.warn('seed ' + seeds[s] + ' failed:', e.message); }
    }
    if (outputs.length === 0) throw new Error('All seeds failed. Check Replicate balance.');

    var best = outputs[0];
    if (outputs.length > 1 && ANT) {
      try { best = await pickBest(outputs, ANT); } catch(e) { console.warn('pick failed:', e.message); }
    }

    res.status(200).json({ output: best, all_outputs: outputs, seeds_used: outputs.length });
  } catch(err) {
    console.error('[tryon]', err.message);
    res.status(500).json({ error: err.message });
  }
}

async function uploadB64(dataUrl, filename, R8) {
  var raw = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  var ct  = dataUrl.startsWith('data:image/') ? dataUrl.split(';')[0].split(':')[1] : 'image/jpeg';
  var buf = Buffer.from(raw, 'base64');
  var bnd = 'B' + Date.now();
  var CR  = '
';
  var disp = 'form-data; name="content"; filename="' + filename + '"';
  var headStr = '--' + bnd + CR + 'Content-Disposition: ' + disp + CR + 'Content-Type: ' + ct + CR + CR;
  var tailStr = CR + '--' + bnd + '--' + CR;
  var head = Buffer.from(headStr);
  var tail = Buffer.from(tailStr);
  var body = Buffer.concat([head, buf, tail]);
  var r = await fetch('https://api.replicate.com/v1/files', {
    method: 'POST',
    headers: { 'Authorization': 'Token ' + R8, 'Content-Type': 'multipart/form-data; boundary=' + bnd, 'Content-Length': String(body.length) },
    body: body
  });
  var txt = await r.text();
  if (!r.ok) throw new Error('Upload ' + r.status + ': ' + txt.slice(0, 60));
  return JSON.parse(txt).urls.get;
}

async function runSeed(hUrl, gUrl, des, cat, seed, R8, sleep) {
  var pr = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: { 'Authorization': 'Token ' + R8, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      version: 'c871bb9b046607b680449ecbae55fd8c6d945e0a1948644bf2361b3d021d3ff4',
      input: { human_img: hUrl, garm_img: gUrl, garment_des: des, category: cat, crop: true, steps: 30, seed: seed }
    })
  });
  var pd = await pr.json();
  if (!pd.id) throw new Error('No pred ID: ' + JSON.stringify(pd).slice(0, 60));
  for (var i = 0; i < 25; i++) {
    await sleep(3000);
    var p = await (await fetch('https://api.replicate.com/v1/predictions/' + pd.id,
      { headers: { 'Authorization': 'Token ' + R8 } })).json();
    if (p.status === 'succeeded') return p.output;
    if (p.status === 'failed' || p.status === 'canceled') throw new Error(p.status + ': ' + (p.error || ''));
  }
  throw new Error('Timeout seed ' + seed);
}

async function pickBest(outputs, ANT) {
  var b64s = await Promise.all(outputs.map(async function(url) {
    var r = await fetch(url); return Buffer.from(await r.arrayBuffer()).toString('base64');
  }));
  var content = [];
  for (var j = 0; j < b64s.length; j++) {
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64s[j] } });
    content.push({ type: 'text', text: 'Option ' + (j + 1) });
  }
  content.push({ type: 'text', text: 'Which looks most natural and realistic? Reply with only: 1, 2, or 3.' });
  var cr = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANT, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 3, system: 'Reply with only a single digit.', messages: [{ role: 'user', content: content }] })
  });
  var cd = await cr.json();
  var pick = parseInt((cd.content && cd.content[0] ? cd.content[0].text : '1').trim()) || 1;
  return outputs[Math.min(Math.max(pick - 1, 0), outputs.length - 1)];
}

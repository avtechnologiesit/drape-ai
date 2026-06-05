export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  try {
    const { imageBase64, filename } = req.body;
    if (!imageBase64) { res.status(400).json({ error: 'Missing imageBase64' }); return; }
    const R8 = process.env.REPLICATE_API_TOKEN;
    if (!R8) { res.status(500).json({ error: 'No token' }); return; }
    const raw  = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
    const ct   = imageBase64.startsWith('data:image/') ? imageBase64.split(';')[0].split(':')[1] : 'image/jpeg';
    const buf  = Buffer.from(raw, 'base64');
    const bnd  = 'IMG' + Date.now();
    const CR   = '
';
    const fn   = filename || 'img.jpg';
    const head = Buffer.from('--' + bnd + CR + 'Content-Disposition: form-data; name="content"; filename="' + fn + '"' + CR + 'Content-Type: ' + ct + CR + CR);
    const tail = Buffer.from(CR + '--' + bnd + '--' + CR);
    const body = Buffer.concat([head, buf, tail]);
    const r = await fetch('https://api.replicate.com/v1/files', {
      method: 'POST',
      headers: { 'Authorization': 'Token ' + R8, 'Content-Type': 'multipart/form-data; boundary=' + bnd, 'Content-Length': String(body.length) },
      body: body
    });
    const txt = await r.text();
    if (!r.ok) throw new Error('Upload ' + r.status + ': ' + txt.slice(0, 60));
    const data = JSON.parse(txt);
    res.status(200).json({ url: data.urls.get });
  } catch(err) {
    console.error('[imgupload]', err.message);
    res.status(500).json({ error: err.message });
  }
}

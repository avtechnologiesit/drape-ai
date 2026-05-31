export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST')   { res.status(405).json({error:'Method not allowed'}); return; }
  try {
    const { prompt, model = 'gpt-image-1' } = req.body;
    if (!prompt) { res.status(400).json({error:'Missing prompt'}); return; }
    const oaiRes = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model, prompt, n: 1, size: '1024x1024', output_format: 'jpeg' })
    });
    const data = await oaiRes.json();
    if (!oaiRes.ok) {
      const msg = data?.error?.message || 'OpenAI error';
      const isBilling = oaiRes.status === 402 || msg.toLowerCase().includes('billing');
      res.status(oaiRes.status).json({ error: isBilling ? 'BILLING_LIMIT' : msg });
      return;
    }
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) { res.status(500).json({error:'No image returned'}); return; }
    res.status(200).json({ b64 });
  } catch(err) {
    res.status(500).json({ error: String(err.message || err) });
  }
}

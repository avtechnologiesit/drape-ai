export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST')   { res.status(405).json({error:'Method not allowed'}); return; }
  try {
    const { images, garmentType, question } = req.body;
    const isQ = !!question;
    const content = [];
    if (images && images.length) {
      images.forEach((img, i) => {
        content.push({ type:'image', source:{ type:'base64', media_type:'image/jpeg', data: img.replace(/^data:image\/[^;]+;base64,/,'') } });
        content.push({ type:'text', text: i===0 ? 'Person portrait.' : 'Reference outfit.' });
      });
    }
    content.push({ type:'text', text: isQ
      ? 'Garment: '+(garmentType||'outfit')+'. Question: '+question
      : 'Describe this garment in one sentence: type, colour, fabric, fit only.' });
    const antRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: isQ ? 400 : 80,
        system: isQ
          ? 'You are DRAPE, expert AI fashion stylist. Analyse images and give specific practical advice in 2-4 sentences.'
          : 'Describe clothing in one short sentence. Type, colour, fabric, fit only.',
        messages: [{ role: 'user', content }]
      })
    });
    const data = await antRes.json();
    if (!antRes.ok) { res.status(antRes.status).json({error:data?.error?.message||'Claude error'}); return; }
    res.status(200).json({ text: data.content[0].text });
  } catch(err) {
    res.status(500).json({ error: String(err.message || err) });
  }
}

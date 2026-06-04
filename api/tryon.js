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

    const R8_TOKEN = process.env.REPLICATE_API_TOKEN;

    // Upload both images to Replicate file storage
    async function uploadImage(base64Data) {
      const base64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
      const buffer = Buffer.from(base64, 'base64');
      const resp = await fetch('https://api.replicate.com/v1/files', {
        method: 'POST',
        headers: {
          'Authorization': `Token ${R8_TOKEN}`,
          'Content-Type': 'image/jpeg',
          'Content-Length': buffer.length.toString()
        },
        body: buffer
      });
      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Upload failed: ${err}`);
      }
      const data = await resp.json();
      return data.urls?.get || data.url;
    }

    const [humanUrl, garmentUrl] = await Promise.all([
      uploadImage(humanBase64),
      uploadImage(garmentBase64)
    ]);

    // Call IDM-VTON
    const prediction = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${R8_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        version: 'c871bb9b046607b680449ecbae55fd8c6d945e0a1948644bf2361b3d021d3ff4',
        input: {
          human_img: humanUrl,
          garm_img: garmentUrl,
          garment_des: garmentDes || 'clothing item',
          category: category || 'upper_body',
          crop: true,
          steps: 30,
          seed: 42
        }
      })
    });

    const predData = await prediction.json();
    const predId = predData.id;
    if (!predId) throw new Error('No prediction ID: ' + JSON.stringify(predData));

    // Poll until complete (max 90s)
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const poll = await fetch(`https://api.replicate.com/v1/predictions/${predId}`, {
        headers: { 'Authorization': `Token ${R8_TOKEN}` }
      });
      const pollData = await poll.json();
      if (pollData.status === 'succeeded') {
        return res.status(200).json({ output: pollData.output });
      }
      if (pollData.status === 'failed') {
        throw new Error('IDM-VTON failed: ' + pollData.error);
      }
    }
    throw new Error('Timed out waiting for result');

  } catch (err) {
    console.error('[DRAPE tryon]', err);
    return res.status(500).json({ error: err.message });
  }
}

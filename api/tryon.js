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

    // Upload image to Replicate using multipart/form-data with "content" field
    async function uploadToReplicate(base64Data, filename) {
      const b64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
      const buffer = Buffer.from(b64, 'base64');

      const boundary = '----ReplicateBoundary' + Date.now();
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
        body: body
      });

      const text = await resp.text();
      if (!resp.ok) throw new Error('Upload failed (' + resp.status + '): ' + text);
      const data = JSON.parse(text);
      return data.urls.get;
    }

    // Upload both images in parallel
    const [humanUrl, garmentUrl] = await Promise.all([
      uploadToReplicate(humanBase64, 'person.jpg'),
      uploadToReplicate(garmentBase64, 'garment.jpg')
    ]);

    console.log('[DRAPE] humanUrl:', humanUrl);
    console.log('[DRAPE] garmentUrl:', garmentUrl);

    // Call IDM-VTON
    const predResp = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': 'Token ' + R8,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        version: 'c871bb9b046607b680449ecbae55fd8c6d945e0a1948644bf2361b3d021d3ff4',
        input: {
          human_img:   humanUrl,
          garm_img:    garmentUrl,
          garment_des: garmentDes || 'clothing item',
          category:    category || 'upper_body',
          crop:        true,
          steps:       30,
          seed:        42
        }
      })
    });

    const predData = await predResp.json();
    const predId = predData.id;
    if (!predId) throw new Error('No prediction ID: ' + JSON.stringify(predData).slice(0, 200));

    // Poll until complete (max 90s)
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const poll = await fetch('https://api.replicate.com/v1/predictions/' + predId, {
        headers: { 'Authorization': 'Token ' + R8 }
      });
      const pollData = await poll.json();
      console.log('[DRAPE] Poll', i+1, ':', pollData.status);
      if (pollData.status === 'succeeded') {
        return res.status(200).json({ output: pollData.output });
      }
      if (pollData.status === 'failed' || pollData.status === 'canceled') {
        throw new Error('IDM-VTON ' + pollData.status + ': ' + (pollData.error || ''));
      }
    }
    throw new Error('Timed out after 90s waiting for IDM-VTON');

  } catch (err) {
    console.error('[DRAPE tryon error]', err.message);
    return res.status(500).json({ error: err.message });
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  try {
    const R8 = process.env.REPLICATE_API_TOKEN;
    if (!R8) { res.status(500).json({ error: 'REPLICATE_API_TOKEN not set' }); return; }
    // Return the token so browser can upload directly
    // Browser will POST multipart directly to api.replicate.com/v1/files
    res.status(200).json({ token: R8, uploadUrl: 'https://api.replicate.com/v1/files' });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const R8 = process.env.REPLICATE_API_TOKEN;
  if (!R8) { res.status(500).json({ error: 'No R8 token' }); return; }

  // Return the Replicate upload endpoint + auth token
  // Browser will POST image bytes directly to Replicate
  res.status(200).json({
    uploadUrl: 'https://api.replicate.com/v1/files',
    token: R8
  });
}

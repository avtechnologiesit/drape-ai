export default async function handler(req, res) {
  try {
    const { humanBase64 } = req.body || {};
    const buf = Buffer.from('test', 'base64');
    res.status(200).json({ ok: true, len: buf.length });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
}

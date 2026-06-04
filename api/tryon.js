export default async function handler(req, res) {
  try {
    const r = await fetch('https://httpbin.org/get');
    const d = await r.json();
    res.status(200).json({ ok: true, url: d.url });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
}

const { rpc, body, E } = require('./_lib');
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  if (req.headers['x-upload-key'] !== E.UPLOAD_KEY) return res.status(401).json({ error: 'Schluessel' });
  const { name, ctype, idx, total, b64 } = await body(req);
  if (!/^[\w.\-]+$/.test(name || '')) return res.status(400).json({ error: 'name' });
  try { await rpc('api_asset_put', { p_name: name, p_ctype: ctype || 'application/octet-stream', p_idx: idx, p_total: total, p_b64: b64 }); res.status(200).json({ ok: true }); }
  catch (e) { res.status(500).json({ error: String(e.message) }); }
};

const { rpc, guard, body } = require('./_lib');
module.exports = async (req, res) => {
  if (req.method !== 'POST' || !guard(req, res)) return;
  const { name, idx, total, b64 } = await body(req);
  if (!/^tmp-[\w\-]+$/.test(name || '')) return res.status(400).json({ error: 'name' });
  try { await rpc('api_asset_put', { p_name: name, p_ctype: 'application/pdf', p_idx: idx, p_total: total, p_b64: b64 }); res.status(200).json({ ok: true }); }
  catch (e) { res.status(500).json({ error: String(e.message) }); }
};

const { rpc, guard, body } = require('./_lib');
module.exports = async (req, res) => {
  if (!guard(req, res)) return;
  try {
    if (req.method === 'GET') {
      const since = req.query.since || '1970-01-01T00:00:00Z';
      const rows = await rpc('api_docs_since', { p_since: since });
      /* Antwort in Teilen (max. ca. 3 MB), damit das Vercel-Limit nie überschritten wird */
      let size = 0, n = 0; for (const r of rows) { size += JSON.stringify(r).length; if (n > 0 && size > 3000000) break; n++; }
      const part = rows.slice(0, n);
      return res.status(200).json({ docs: part, more: n < rows.length, now: part.length ? part[part.length - 1].updated_at : since });
    }
    if (req.method === 'PUT') { const { path, data } = await body(req); if (!path || typeof data !== 'object') return res.status(400).json({ error: 'path/data' }); const t = await rpc('api_doc_put', { p_path: path, p_data: data }); return res.status(200).json({ ok: true, updated_at: t }); }
    if (req.method === 'DELETE') { await rpc('api_doc_del', { p_path: req.query.path }); return res.status(200).json({ ok: true }); }
    res.status(405).end();
  } catch (e) { res.status(500).json({ error: String(e.message) }); }
};

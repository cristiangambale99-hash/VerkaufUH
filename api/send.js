const { rpc, guard, body, sendMail, assetBytes } = require('./_lib');
module.exports = async (req, res) => {
  if (req.method !== 'POST' || !guard(req, res)) return;
  const { to, subject, text, kind, objectId, filename, stash } = await body(req);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to || '') || !subject || !text) return res.status(400).json({ error: 'Empfänger, Betreff oder Text fehlt' });
  try {
    let attachments;
    if (stash) { if (!/^tmp-[\w\-]+$/.test(stash)) return res.status(400).json({ error: 'stash' }); const a = await assetBytes(stash); if (!a) return res.status(400).json({ error: 'Anhang nicht gefunden' }); attachments = [{ filename: filename || 'Offerte.pdf', content: a.b64 }]; }
    const id = await sendMail({ to, subject, text, kind, objectId, attachments });
    if (stash) { try { await rpc('api_asset_del', { p_name: stash }); } catch (e) {} }
    res.status(200).json({ ok: true, id });
  } catch (e) { res.status(502).json({ error: String(e.message) }); }
};

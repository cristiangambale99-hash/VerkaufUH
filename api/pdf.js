/* Offerte Unterhaltsreinigung im neuen Layout als PDF (Server-Chromium).
   POST { d: Daten der Offerte, stash?: 'tmp-<id>' }
   ohne stash → PDF als Datei zurück (Vorschau), mit stash → PDF als Zwischenablage für den Mailversand, Antwort JSON. */
const { guard, body, rpc } = require('./_lib');
const R = require('./_render');
module.exports = async (req, res) => {
  if (req.method !== 'POST' || !guard(req, res)) return;
  const b = await body(req), d = b.d;
  if (!d || typeof d !== 'object' || !Array.isArray(d.rb) || !Array.isArray(d.lv)) return res.status(400).json({ error: 'Daten fehlen' });
  try {
    const { pdf, info } = await R.render(R.uhOfferHtml(d), { wait: true });
    res.setHeader('X-Pages', String((info && info.pages) || 0));
    if (info && info.over && info.over.length) res.setHeader('X-Overflow', JSON.stringify(info.over).slice(0, 200));
    if (b.stash) {
      if (!/^tmp-[\w\-]+$/.test(b.stash)) return res.status(400).json({ error: 'name' });
      const CH = 600000, s = pdf.toString('base64'), tot = Math.max(1, Math.ceil(s.length / CH));
      for (let i = 0; i < tot; i++) await rpc('api_asset_put', { p_name: b.stash, p_ctype: 'application/pdf', p_idx: i, p_total: tot, p_b64: s.slice(i * CH, (i + 1) * CH) });
      return res.status(200).json({ ok: true, name: b.stash, bytes: pdf.length, pages: info && info.pages, over: info && info.over });
    }
    res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(pdf);
  } catch (e) { res.status(500).json({ error: 'PDF konnte nicht erstellt werden: ' + String(e.message || e).slice(0, 300) }); }
};

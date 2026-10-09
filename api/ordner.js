const { guard, body, assetBytes, rpc } = require('./_lib');
const O = require('./_ordner');
const { PDFDocument } = require('pdf-lib');

async function landing(res, nr, meta, id) {
  const firma = meta.firma || 'Ihr Objekt', ch = O.chapters(meta), b = '/o/' + id;
  const items = ch.map((c, i) => `<section class="ch"><div class="n">${i + 1}</div><div class="b"><h2>${O.esc(c.title)}</h2>${c.files.map(f => `<a class="f" href="${f.lv ? b + '/lv' : '/ordner/' + f.file}" target="_blank" rel="noopener"><span>${O.esc(f.label)}${f.note ? ` <small>${O.esc(f.note)}</small>` : ''}</span><i>PDF</i></a>`).join('')}</div></section>`).join('');
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Objektordner ${O.esc(firma)}</title><style>
*{box-sizing:border-box}body{margin:0;background:#f4f9fa;color:#16323a;font:14px/1.55 Verdana,Geneva,"DejaVu Sans",sans-serif}
header{background:#ddf1f3;padding:28px 18px 44px;position:relative}.w{max-width:680px;margin:0 auto}
header small{display:block;letter-spacing:.14em;text-transform:uppercase;color:#0e7c80;font-size:11px;margin-bottom:6px}h1{margin:0;font-size:22px;line-height:1.25}
header p{margin:6px 0 0;color:#5b7279}svg{position:absolute;left:0;bottom:-1px;width:100%;height:26px}
main{padding:8px 18px 40px}.ch{display:flex;gap:14px;background:#fff;border:1px solid #d5e4e7;border-radius:10px;padding:14px;margin-top:12px}
.n{flex:none;width:30px;height:30px;border-radius:50%;background:#ddf1f3;color:#0e7c80;display:grid;place-items:center;font-weight:700}.b{flex:1;min-width:0}
h2{margin:4px 0 8px;font-size:15px}.f{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:10px 0;border-top:1px solid #e6eff1;color:#16323a;text-decoration:none}
.f:first-of-type{border-top:0}.f span{min-width:0}.f small{color:#5b7279;margin-left:6px}.f i{font-style:normal;font-size:11px;font-weight:700;color:#0e7c80;background:#ddf1f3;border-radius:20px;padding:3px 10px}
.f:hover span{text-decoration:underline}.all{display:block;text-align:center;background:#0e7c80;color:#fff;text-decoration:none;font-weight:700;border-radius:10px;padding:14px;margin-top:18px}
footer{color:#5b7279;font-size:12px;text-align:center;padding:0 18px 30px}</style></head><body>
<header><div class="w"><small>Clean Service Scaramuzzo AG</small><h1>${O.esc(firma)}</h1><p>Objektordner mit allen Unterlagen zu Ihrer Unterhaltsreinigung</p></div><svg viewBox="0 0 1200 26" preserveAspectRatio="none"><path d="M0 26V12C120 0 220 24 360 14S600 0 760 12 1030 24 1200 8V26z" fill="#f4f9fa"/></svg></header>
<main class="w">${items}<a class="all" href="${b}/komplett">Alles als ein PDF öffnen</a></main>
<footer>Clean Service Scaramuzzo AG · Industriestrasse 5 · 8307 Effretikon · 0844 355 355</footer></body></html>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.status(200).send(html);
}
async function merged(nr, meta) {
  const out = await PDFDocument.create();
  const add = async bytes => { const d = await PDFDocument.load(bytes, { ignoreEncryption: true }); (await out.copyPages(d, d.getPageIndices())).forEach(p => out.addPage(p)); };
  for (const c of O.chapters(meta)) for (const f of c.files) {
    if (f.lv) { const a = await assetBytes('ordner-lv-' + nr); if (a) await add(a.buf); } else await add(O.readStatic(f.file));
  }
  out.setTitle('Objektordner ' + (meta.firma || nr)); out.setAuthor('Clean Service Scaramuzzo AG');
  return Buffer.from(await out.save({ useObjectStreams: true }));
}
module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') {
      if (!guard(req, res)) return;
      const b = await body(req);
      if (b.qrfy) return require('./_qrfy')(b, res);
      if (b.bk) return require('./_beekeeper')(b, res);
      const nr = O.safeNr(b.nr); if (!nr) return res.status(400).json({ error: 'nr' });
      const idx = +b.idx || 0, total = +b.total || 1;
      if (b.b64) await rpc('api_asset_put', { p_name: 'ordner-lv-' + nr, p_ctype: 'application/pdf', p_idx: idx, p_total: total, p_b64: b.b64 });
      if (idx >= total - 1) {
        const old = await O.getMeta(nr) || {};
        const meta = { nr, firma: String(b.firma || old.firma || nr).slice(0, 120), hilfe: b.hilfe !== false, updated: new Date().toISOString() };
        await O.putAsset('ordner-meta-' + nr, 'application/json', Buffer.from(JSON.stringify(meta)));
        return res.status(200).json({ ok: true, url: O.urlOf(nr), id: O.idOf(nr) });
      }
      return res.status(200).json({ ok: true });
    }
    const id = String(req.query.id || ''), nr = O.parseId(id); if (!nr) return res.status(404).send('Nicht gefunden');
    const meta = await O.getMeta(nr); if (!meta) return res.status(404).send('Objektordner nicht gefunden');
    const f = String(req.query.f || '');
    if (f === 'lv') { const a = await assetBytes('ordner-lv-' + nr); if (!a) return res.status(404).send('Leistungsverzeichnis fehlt'); res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', 'inline; filename="Leistungsverzeichnis_' + nr + '.pdf"'); res.setHeader('Cache-Control', 'no-store'); return res.status(200).send(a.buf); }
    if (f === 'komplett') { const buf = await merged(nr, meta); res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', 'inline; filename="Objektordner_' + nr + '.pdf"'); res.setHeader('Cache-Control', 'no-store'); return res.status(200).send(buf); }
    return landing(res, nr, meta, id);
  } catch (e) { res.status(500).send('Fehler: ' + String(e.message || e)); }
};

/* Reinigungsvertrag nach Online-Auftragserteilung (Unterhaltsreinigung):
   die versendete Offerte (alle Seiten ausser der letzten «Verbindliche Auftragserteilung») plus eine
   Vertragsseite im weichen Layout mit der Unterschrift des Kunden und der hinterlegten Unterschrift
   von Mirco Scaramuzzo. Fehlt die Offerte als PDF, besteht der Vertrag nur aus der Vertragsseite. */
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const fs = require('fs');
const path = require('path');
const { SIG_MIRCO, BADGES } = require('./_sig');

const MM = 2.83465;
const TEAL = rgb(0.106, 0.514, 0.518), INK = rgb(0.235, 0.235, 0.231), MUTE = rgb(0.463, 0.463, 0.463), LINE = rgb(0.863, 0.922, 0.933), ICE = rgb(0.933, 0.969, 0.973), WHITE = rgb(1, 1, 1);
const chfTxt = n => (Math.round((+n || 0) * 20) / 20).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, "'");
const MON = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const longDate = iso => { const [y, m, d] = String(iso || '').split('-').map(Number); return y && m && d ? `${d}. ${MON[m - 1]} ${y}` : ''; };

/* s = Kurzfassung der Offerte (ann-<nr>), r = Annahme (Name, Funktion, Unterschrift, Vertragsbeginn …), offerPdf = Buffer oder null */
const escH = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/* Vertragsseite im weichen Layout (gleiches Briefpapier, Schriften und Badges wie die Offerte) */
function vertragHtml(s, r, n, opts) {
  const R = require('./_render'), A = R.assets();
  const ort = [s.objekt, s.adresse].filter(Boolean).join(', ');
  const rows = [['Vertragsbeginn', r.vbTxt || s.start || 'Nach Vereinbarung'], ['Leistung', 'Unterhaltsreinigung gemäss Raumbuch und Leistungsverzeichnis' + (s.reinigung ? ', ' + s.reinigung : '')], ['Monatspauschale', 'CHF ' + chfTxt(r.betrag) + ' exkl. MwSt.' + (r.variante ? ' · ' + r.variante : '')], ['Vertragsdauer', s.dauerTxt || 'Unbefristet, kündbar mit 3 Monaten Frist auf Monatsende'], ['Online angenommen', (r.atTxt || '') + ', von ' + (r.name || '') + (r.funktion ? ' (' + r.funktion + ')' : '')]];
  const next = opts.nextTxt || 'Unsere Administration meldet sich für einen Besprechungstermin vor Ort bei Ihnen. Fragen beantworten wir gerne unter 0844 355 355 oder unterhalt@clean-service.ch.';
  const body = '<section class="pg" style="background:#fff url(' + A.LH + ') 0 0/100% 100% no-repeat"><div class="hd"><div class="m"><b>' + String(n).padStart(2, '0') + '&nbsp;&nbsp;Reinigungsvertrag</b><br>Offerte ' + escH(s.nr) + ' · ' + escH(s.firma) + '</div></div><div class="in sigpg">'
    + '<div class="eb">Reinigungsvertrag</div><h1>Reinigungsvertrag</h1><p style="margin:0 0 4mm">Basierend auf der Offerte ' + escH(s.nr) + (s.rev ? ' (Rev. ' + s.rev + ')' : '') + ' erteilt ' + (s.firma ? 'die ' + escH(s.firma) : 'der Auftraggeber') + ' der Clean Service Scaramuzzo AG den Auftrag für die Unterhaltsreinigung' + (ort ? ' am Objekt ' + escH(ort) : '') + '. Es gelten die Offerte, das Raumbuch, das Leistungsverzeichnis und die Allgemeinen Geschäftsbedingungen.</p>'
    + '<table class="pr cp" style="margin-bottom:5mm"><colgroup><col style="width:52mm"><col></colgroup><tbody>' + rows.map(([k, v]) => '<tr><td>' + k + '</td><td style="font-weight:normal">' + escH(v) + '</td></tr>').join('') + '</tbody></table>'
    + '<div class="sig"><div><div class="l"><img src="' + escH(r.sig) + '" alt=""></div><small>Auftraggeber: ' + escH(s.firma) + '<br>' + escH(r.name) + (r.funktion ? ', ' + escH(r.funktion) : '') + '</small><div class="esig">Elektronisch unterzeichnet am ' + escH(r.atTxt) + ' · Referenz ' + escH(r.ref) + '</div></div>'
    + '<div><div class="l" style="border-bottom:0"><img src="data:image/png;base64,' + SIG_MIRCO + '" alt="" style="max-height:19mm;margin-bottom:-2mm"></div><small>Auftragnehmer: Clean Service Scaramuzzo AG<br>Mirco Scaramuzzo, Inhaber und Geschäftsführer</small><div class="esig">Hinterlegte Unterschrift, Effretikon</div></div></div>'
    + '<div class="box" style="margin-top:8mm"><b>Nächste Schritte.</b> ' + escH(next) + '</div><p class="note" style="margin-top:4mm">Dieser Vertrag entspricht der Offerte ' + escH(s.nr) + ' mit allen Beilagen. Eine Kopie geht an unterhalt@clean-service.ch.' + (r.email ? ' Elektronisch erteilt über ' + escH(opts.host || 'offertplattform-uh.vercel.app') + ' · ' + escH(r.email) + (r.ip ? ' · IP ' + escH(r.ip) : '') + '.' : '') + '</p></div>'
    + '<div class="isonew">' + A.BADGES.map(b => '<div>' + b + '</div>').join('') + '</div></section>';
  return R.shell('<div class="doc">' + body + '</div>');
}

async function vertragPdf(s, r, offerPdf, opts = {}) {
  const out = await PDFDocument.create();
  if (offerPdf) {
    try {
      const src = await PDFDocument.load(offerPdf, { ignoreEncryption: true });
      const n = src.getPageCount(), idx = []; for (let i = 0; i < (n > 1 ? n - 1 : n); i++) idx.push(i);
      const pages = await out.copyPages(src, idx); pages.forEach(p => out.addPage(p));
    } catch (e) { /* Offerte nicht lesbar: nur Vertragsseite */ }
  }
  /* 1. Wahl: Vertragsseite mit Chromium im Offert-Layout; nur wenn das nicht geht, die einfache Seite mit pdf-lib */
  if (!opts.plain) { try { const { pdf } = await require('./_render').render(vertragHtml(s, r, out.getPageCount() + 1, opts)); const vd = await PDFDocument.load(pdf); (await out.copyPages(vd, [0])).forEach(p => out.addPage(p)); out.setTitle('Reinigungsvertrag ' + (s.nr || '')); out.setAuthor('Clean Service Scaramuzzo AG'); return Buffer.from(await out.save({ useObjectStreams: true })); } catch (e) { console.error('vertrag chromium', e && e.message); } }
  const F = await out.embedFont(StandardFonts.Helvetica), B = await out.embedFont(StandardFonts.HelveticaBold);
  const safe = (f, t) => Array.from(String(t == null ? '' : t)).map(ch => { try { f.encodeText(ch); return ch; } catch (e) { return ch === '‑' ? '-' : '?'; } }).join('');
  const pg = out.addPage([595.28, 841.89]);
  const X = 20 * MM, W = 595.28 - 40 * MM;
  const txt = (t, o = {}) => { const f = o.b ? B : F, sz = o.sz || 9.2; pg.drawText(safe(f, t), { x: o.x != null ? o.x : X, y: o.y, size: sz, font: f, color: o.c || INK }); };
  const wrap = (t, f, sz, w) => { const outL = []; String(t).split('\n').forEach(par => { let cur = ''; par.split(/\s+/).forEach(wd => { const n = cur ? cur + ' ' + wd : wd; if (f.widthOfTextAtSize(safe(f, n), sz) > w && cur) { outL.push(cur); cur = wd; } else cur = n; }); outL.push(cur); }); return outL; };
  const spaced = (t, y, sz, c, gap) => { let x = X; Array.from(t).forEach(ch => { pg.drawText(safe(B, ch), { x, y, size: sz, font: B, color: c }); x += B.widthOfTextAtSize(safe(B, ch), sz) + gap; }); };
  /* Kopf: Kapitelzeile links, Logo rechts */
  const num = String(opts.pageNo || out.getPageCount()).padStart(2, '0');
  txt(num + '   Reinigungsvertrag', { b: true, sz: 7.2, y: 841.89 - 14 * MM, c: INK });
  txt(`Offerte ${s.nr || ''} · ${s.firma || ''}`, { sz: 6.8, y: 841.89 - 17.6 * MM, c: MUTE });
  try { const lp = logoPath(); if (lp) { const img = await out.embedPng(fs.readFileSync(lp)); const w = 46 * MM, h = w * img.height / img.width; pg.drawImage(img, { x: 595.28 - 20 * MM - w, y: 841.89 - 10 * MM - h, width: w, height: h }); } } catch (e) {}
  /* Titel */
  let y = 841.89 - 38 * MM;
  spaced('REINIGUNGSVERTRAG', y, 6.6, TEAL, 1.4); y -= 7.5 * MM;
  spaced('REINIGUNGSVERTRAG', y, 19, TEAL, 1.2); y -= 9 * MM;
  const ort = [s.objekt, s.adresse].filter(Boolean).join(', ');
  const intro = `Basierend auf der Offerte ${s.nr || ''}${s.rev ? ' (Rev. ' + s.rev + ')' : ''}${s.datum ? ' vom ' + s.datum : ''} erteilt ${s.firma ? 'die ' + s.firma : 'der Auftraggeber'} der Clean Service Scaramuzzo AG den Auftrag für die Unterhaltsreinigung${ort ? ' am Objekt ' + ort : ''}. Es gelten die Offerte, das Raumbuch, das Leistungsverzeichnis und die Allgemeinen Geschäftsbedingungen.`;
  wrap(intro, F, 9.2, W).forEach(l => { txt(l, { y }); y -= 4.6 * MM; });
  y -= 2 * MM;
  /* Vertragstabelle */
  const rows = [['Vertragsbeginn', r.vbTxt || s.start || 'Nach Vereinbarung'], ['Leistung', 'Unterhaltsreinigung gemäss Raumbuch und Leistungsverzeichnis' + (s.reinigung ? ', ' + s.reinigung : '')],
    ['Monatspauschale', `CHF ${chfTxt(r.betrag)} exkl. MwSt.${r.variante ? ' · ' + r.variante : ''}`], ['Vertragsdauer', s.dauerTxt || 'Unbefristet, kündbar mit 3 Monaten Frist auf Monatsende'],
    ['Online angenommen', `${r.atTxt || ''}, von ${r.name || ''}${r.funktion ? ' (' + r.funktion + ')' : ''}`]];
  const c1 = 52 * MM; pg.drawLine({ start: { x: X, y: y + 2 * MM }, end: { x: X + W, y: y + 2 * MM }, thickness: 1, color: TEAL });
  rows.forEach(([k, v]) => { const ls = wrap(v, F, 8.6, W - c1 - 2 * MM); const h = Math.max(1, ls.length) * 4.2 * MM + 3.2 * MM; y -= 4.4 * MM; txt(k, { b: true, sz: 8.2, y }); ls.forEach((l, i) => txt(l, { x: X + c1, y: y - i * 4.2 * MM, sz: 8.6 })); y -= h - 4.4 * MM; pg.drawLine({ start: { x: X, y: y + 0.6 * MM }, end: { x: X + W, y: y + 0.6 * MM }, thickness: 0.5, color: LINE }); });
  /* Unterschriften */
  y -= 14 * MM; const colW = (W - 12 * MM) / 2, xR = X + colW + 12 * MM, baseY = y - 16 * MM;
  try { const sig = await out.embedPng(Buffer.from(String(r.sig || '').split(',')[1] || '', 'base64')); const q = sig.height / sig.width; let w = Math.min(colW, 62 * MM), h = w * q; if (h > 16 * MM) { h = 16 * MM; w = h / q; } pg.drawImage(sig, { x: X, y: baseY + 1 * MM, width: w, height: h }); } catch (e) {}
  pg.drawLine({ start: { x: X, y: baseY }, end: { x: X + colW, y: baseY }, thickness: 0.8, color: INK });
  try { const ms = await out.embedPng(Buffer.from(SIG_MIRCO, 'base64')); const h = 19 * MM, w = h * ms.width / ms.height; pg.drawImage(ms, { x: xR, y: baseY - 1.5 * MM, width: w, height: h }); } catch (e) {}
  let yl = baseY - 4.2 * MM;
  txt(`Auftraggeber: ${s.firma || ''}`, { sz: 7, c: MUTE, y: yl }); txt('Auftragnehmer: Clean Service Scaramuzzo AG', { x: xR, sz: 7, c: MUTE, y: yl }); yl -= 3.6 * MM;
  txt(`${r.name || ''}${r.funktion ? ', ' + r.funktion : ''}`, { sz: 7, c: MUTE, y: yl }); txt('Mirco Scaramuzzo, Inhaber und Geschäftsführer', { x: xR, sz: 7, c: MUTE, y: yl }); yl -= 4.2 * MM;
  txt(`Elektronisch unterzeichnet am ${r.atTxt || ''} · Referenz ${r.ref || ''}`, { sz: 6.4, c: MUTE, y: yl }); txt('Hinterlegte Unterschrift, Effretikon', { x: xR, sz: 6.4, c: MUTE, y: yl });
  /* Nächste Schritte */
  y = yl - 12 * MM; const boxT = opts.nextTxt || 'Unsere Administration meldet sich für einen Besprechungstermin vor Ort bei Ihnen. Fragen beantworten wir gerne unter 0844 355 355 oder unterhalt@clean-service.ch.';
  const bl = wrap('Nächste Schritte. ' + boxT, F, 8.6, W - 12 * MM), bh = bl.length * 4.6 * MM + 9 * MM;
  pg.drawRectangle({ x: X, y: y - bh, width: W, height: bh, color: ICE, borderWidth: 0 }); pg.drawRectangle({ x: X, y: y - bh, width: 1.2 * MM, height: bh, color: TEAL, borderWidth: 0 });
  bl.forEach((l, i) => { const yy = y - 5.5 * MM - i * 4.6 * MM; if (i === 0) { const lead = 'Nächste Schritte.'; txt(lead, { x: X + 6 * MM, y: yy, b: true, sz: 8.6 }); txt(l.slice(lead.length), { x: X + 6 * MM + B.widthOfTextAtSize(lead, 8.6), y: yy, sz: 8.6 }); } else txt(l, { x: X + 6 * MM, y: yy, sz: 8.6 }); });
  y -= bh + 6 * MM;
  wrap(`Dieser Vertrag entspricht der Offerte ${s.nr || ''} mit allen Beilagen. Eine Kopie geht an unterhalt@clean-service.ch.${r.email ? ' Elektronisch erteilt über ' + (opts.host || 'offertplattform-uh.vercel.app') + ' · ' + r.email + (r.ip ? ' · IP ' + r.ip : '') + '.' : ''}`, F, 6.8, W).forEach(l => { txt(l, { y, sz: 6.8, c: MUTE }); y -= 3.6 * MM; });
  /* Fuss: ISO-Badges links, Adresse rechts */
  try { for (let i = 0; i < BADGES.length; i++) { const img = await out.embedPng(Buffer.from(BADGES[i], 'base64')); pg.drawImage(img, { x: X + i * 20 * MM, y: 9 * MM, width: 17 * MM, height: 17 * MM }); } } catch (e) {}
  const fx = 595.28 - 20 * MM - 95 * MM;
  txt('Hauptsitz', { x: fx, y: 21 * MM, sz: 6.8, c: TEAL });
  txt('Clean Service Scaramuzzo AG', { x: fx, y: 17 * MM, sz: 6.8, c: TEAL }); txt('   Industriestrasse 5   8307 Effretikon', { x: fx + F.widthOfTextAtSize('Clean Service Scaramuzzo AG', 6.8), y: 17 * MM, sz: 6.8, c: MUTE });
  txt('T 0844 355 355   info@clean-service.ch   clean-service.ch', { x: fx, y: 13 * MM, sz: 6.8, c: MUTE });
  out.setTitle('Reinigungsvertrag ' + (s.nr || '')); out.setAuthor('Clean Service Scaramuzzo AG');
  return Buffer.from(await out.save({ useObjectStreams: true }));
}
function logoPath() { for (const d of [path.join(process.cwd(), 'public', 'ordner'), path.join(__dirname, '..', 'public', 'ordner')]) { const p = path.join(d, 'logo.png'); if (fs.existsSync(p)) return p; } return null; }
module.exports = { vertragPdf, vertragHtml };

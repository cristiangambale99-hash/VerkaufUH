const JSZip = require('jszip');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const { guard, assetBytes } = require('./_lib');
const O = require('./_ordner');

const X = s => O.esc(s);
const R = (t, o = {}) => `<w:r><w:rPr>${o.b ? '<w:b/>' : ''}${o.col ? `<w:color w:val="${o.col}"/>` : ''}<w:sz w:val="${o.sz || 20}"/><w:szCs w:val="${o.sz || 20}"/></w:rPr><w:t xml:space="preserve">${X(t)}</w:t></w:r>`;
const P = (runs, o = {}) => `<w:p><w:pPr>${o.style ? `<w:pStyle w:val="${o.style}"/>` : ''}${o.keep ? '<w:keepNext/>' : ''}<w:spacing w:before="${o.before || 0}" w:after="${o.after || 0}" w:line="${o.line || 300}" w:lineRule="auto"/>${o.ind ? `<w:ind w:left="${o.ind}" w:hanging="${o.hang || 0}"/>` : ''}</w:pPr>${runs}</w:p>`;
function pic(rid, cm) {
  const e = Math.round(cm * 360000);
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${e}" cy="${e}"/><wp:docPr id="1" name="QR-Code" descr="QR-Code zum Objektordner"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="1" name="qr.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${e}" cy="${e}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}
const VER = '<w:rFonts w:ascii="Verdana" w:hAnsi="Verdana"/>';
const li = t => `<w:p><w:pPr><w:pStyle w:val="Listenabsatz"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="6"/></w:numPr><w:rPr>${VER}<w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:pPr><w:r><w:rPr>${VER}<w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr><w:t xml:space="preserve">${X(t)}</w:t></w:r></w:p>`;
function qrAnchor(rid, cm) {
  const e = Math.round(cm * 360000);
  return `<w:r><w:rPr><w:noProof/></w:rPr><w:drawing><wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="251659264" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>60000</wp:posOffset></wp:positionV><wp:extent cx="${e}" cy="${e}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="9001" name="QR-Code" descr="QR-Code zum Objektordner"/><wp:cNvGraphicFramePr/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="9001" name="qr_objekt.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${e}" cy="${e}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`;
}
/* Vorlage = euer Aushang (Layout unverändert): Firmenname, Inhaltsverzeichnis und QR-Code werden eingesetzt */
async function buildDocx(nr, meta) {
  const url = O.urlOf(nr);
  let qr = null; try { const a = await assetBytes('ordner-qr-' + nr); if (a && /png/i.test(a.ctype)) qr = a.buf; } catch (e) {}
  if (!qr) qr = await QRCode.toBuffer(url, { width: 700, margin: 1, errorCorrectionLevel: 'M', type: 'png' });
  const tplPath = [path.join(__dirname, '_tpl', 'aushang.docx'), path.join(process.cwd(), 'api', '_tpl', 'aushang.docx')].find(p => fs.existsSync(p));
  const zip = await JSZip.loadAsync(fs.readFileSync(tplPath));
  let doc = await zip.file('word/document.xml').async('string');
  if (!doc.includes('<w:t>Streck Transport AG</w:t>')) throw new Error('Vorlage: Firmenname nicht gefunden');
  doc = doc.replace('<w:t>Streck Transport AG</w:t>', `<w:t xml:space="preserve">${X(meta.firma || nr)}</w:t>`);
  const names = { lv: 'Leistungsverzeichnis', ansprechpartner: 'Ansprechpartner', notruf: 'Notrufnummern', farben: 'Farbensystem', sdb: 'Sicherheitsdatenblätter', gefahr: 'Gefahrstoffe', hilfe: 'Hilfemassnahmen' };
  const items = O.chapters(meta).map(c => li(names[c.key] || c.title)).join('');
  const i0 = doc.indexOf('<w:p w14:paraId="45038E5C"'), k = doc.indexOf('<w:p w14:paraId="7D53D9D9"'), i1 = k < 0 ? -1 : doc.indexOf('</w:p>', k) + 6;
  if (i0 < 0 || i1 < 6) throw new Error('Vorlage: Inhaltsverzeichnis nicht gefunden');
  doc = doc.slice(0, i0) + items + doc.slice(i1);
  const j = doc.indexOf('<w:p w14:paraId="5649E670"'), j1 = doc.indexOf('</w:p>', j);
  if (j < 0) throw new Error('Vorlage: Überschrift Inhaltsverzeichnis nicht gefunden');
  doc = doc.slice(0, j1) + qrAnchor('rIdQrObj', 7.3) + doc.slice(j1);
  zip.file('word/document.xml', doc);
  zip.file('word/media/qr_objekt.png', qr);
  let rels = await zip.file('word/_rels/document.xml.rels').async('string');
  rels = rels.replace('</Relationships>', '<Relationship Id="rIdQrObj" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/qr_objekt.png"/></Relationships>');
  zip.file('word/_rels/document.xml.rels', rels);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
module.exports = async (req, res) => {
  if (!guard(req, res)) return;
  try {
    const nr = O.safeNr(req.query.nr); if (!nr) return res.status(400).json({ error: 'nr' });
    const meta = await O.getMeta(nr); if (!meta) return res.status(404).json({ error: 'Objektordner noch nicht erstellt' });
    const buf = await buildDocx(nr, meta);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="Aushang_QR-Code_${nr}.docx"`);
    res.status(200).send(buf);
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
};

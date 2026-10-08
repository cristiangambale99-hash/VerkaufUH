const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { rpc, assetBytes, E } = require('./_lib');

/* Kapitel des Objektordners in der festen Reihenfolge. LV (Kapitel 1) wird je Objekt erzeugt, der Rest sind feste PDFs. */
const SDB = [
  ['Alkoholreiniger SMA 2', 'sdb/alkoholreiniger-sma2.pdf', '18.06.2025'],
  ['Sanitärunterhaltsreiniger PRO 80', 'sdb/sanitaerunterhaltsreiniger-pro80.pdf', '17.06.2025'],
  ['Neutralreiniger SMA 3', 'sdb/neutralreiniger-sma3.pdf', '01.11.2021'],
  ['Glasreiniger PRO 19', 'sdb/glasreiniger-pro19.pdf', '07.02.2023'],
  ['Scheuermilch PRO 16', 'sdb/scheuermilch-pro16.pdf', '01.11.2021']
];
function chapters(meta) {
  const c = [{ key: 'lv', title: 'Leistungsverzeichnis', files: [{ label: 'Leistungsverzeichnis', lv: true }] },
    { key: 'ansprechpartner', title: 'Ansprechpartner', files: [{ label: 'Ansprechpartner', file: 'ansprechpartner.pdf' }] },
    { key: 'notruf', title: 'Notrufnummern', files: [{ label: 'Notrufnummern', file: 'notrufnummern.pdf' }] },
    { key: 'farben', title: '4-Farben-System', files: [{ label: '4-Farben-System', file: 'farbsystem.pdf' }] },
    { key: 'sdb', title: 'Sicherheitsdatenblätter', files: SDB.map(s => ({ label: s[0], file: s[1], note: 'Stand ' + s[2] })) },
    { key: 'gefahr', title: 'Gefahrstoffe', files: [{ label: 'Gefahrstoffe', file: 'gefahrstoffe.pdf' }] }];
  if (!meta || meta.hilfe !== false) c.push({ key: 'hilfe', title: 'Hilfemassnahmen', files: [{ label: 'Hilfemassnahmen', file: 'hilfemassnahmen.pdf' }] });
  return c;
}
const base = () => E.PUBLIC_URL || 'https://offertplattform-uh.vercel.app';
const tok = nr => crypto.createHmac('sha256', E.SESSION_SECRET).update('ordner:' + nr).digest('hex').slice(0, 12);
const idOf = nr => nr + '-' + tok(nr);
const urlOf = nr => base() + '/o/' + idOf(nr);
function parseId(id) {
  id = String(id || ''); const i = id.lastIndexOf('-'); if (i < 1) return null;
  const nr = id.slice(0, i), t = id.slice(i + 1);
  if (!/^[\w\-]+$/.test(nr) || t !== tok(nr)) return null; return nr;
}
const safeNr = nr => /^[\w\-]+$/.test(String(nr || '')) ? String(nr) : null;
async function putAsset(name, ctype, buf) {
  const CH = 600000, b64 = Buffer.from(buf).toString('base64'), tot = Math.max(1, Math.ceil(b64.length / CH));
  for (let i = 0; i < tot; i++) await rpc('api_asset_put', { p_name: name, p_ctype: ctype, p_idx: i, p_total: tot, p_b64: b64.slice(i * CH, (i + 1) * CH) });
}
async function getMeta(nr) { try { const a = await assetBytes('ordner-meta-' + nr); return a ? JSON.parse(a.buf.toString('utf8')) : null; } catch (e) { return null; } }
function staticDir() { for (const d of [path.join(process.cwd(), 'public', 'ordner'), path.join(__dirname, '..', 'public', 'ordner')]) if (fs.existsSync(d)) return d; return null; }
function readStatic(rel) { const d = staticDir(); if (!d) throw new Error('Ordner-PDFs nicht gefunden'); return fs.readFileSync(path.join(d, rel)); }
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
module.exports = { chapters, SDB, base, tok, idOf, urlOf, parseId, safeNr, putAsset, getMeta, readStatic, esc };

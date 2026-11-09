/* Aufträge vom Besprechungstool «Startgespräch UH» ausführen.
   Das Besprechungstool legt einen Auftrag in der Tabelle bt_jobs an (nur mit service_role möglich) und ruft
   POST /api/ordner { bt: '<auftrags-id>' } auf. Hier wird der Auftrag genau einmal abgeholt und ausgeführt:
   PDFs auf dem Logopapier, Mails an unterhalt@, Kunde und spezialreinigung@, Beekeeper (Vakanz, Gruppenbeschreibung),
   Stellenportal. Die Antwort enthält das Ergebnis jedes einzelnen Schritts. */
const { rpc, sendMail, settings, esc } = require('./_lib');
const R = require('./_render');

const UH = 'unterhalt@clean-service.ch', SPEZ = 'spezialreinigung@clean-service.ch';
const WD = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MO = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const TAG = { Mo: 'Montag', Di: 'Dienstag', Mi: 'Mittwoch', Do: 'Donnerstag', Fr: 'Freitag', Sa: 'Samstag', So: 'Sonntag' };
const dLong = s => { if (!/^\d{4}-\d{2}-\d{2}/.test(s || '')) return s || ''; const d = new Date(s.slice(0, 10) + 'T12:00:00Z'); return WD[d.getUTCDay()] + ', ' + d.getUTCDate() + '. ' + MO[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); };
const dShort = s => /^\d{4}-\d{2}-\d{2}/.test(s || '') ? s.slice(8, 10) + '.' + s.slice(5, 7) + '.' + s.slice(0, 4) : (s || '');
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Zurich' });
const chf = n => 'CHF ' + (Math.round((+n || 0) * 100) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, "'");
const h = s => esc(s == null ? '' : String(s));
const isMail = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());
const isImg = s => /^data:image\/(png|jpe?g|webp|gif);base64,/.test(String(s || ''));
const nameLast = s => String(s || '').trim().split(/\s+/).slice(-1)[0] || '';

/* Handler aus anderen Modulen wiederverwenden (sie schreiben ihr Ergebnis in res.json) */
const via = (mod, b) => new Promise(resolve => {
  const res = { status() { return res; }, setHeader() {}, json(j) { resolve(j || {}); return res; } };
  Promise.resolve(mod(b, res)).catch(e => resolve({ ok: false, error: String(e && e.message || e) }));
});
const bk = b => via(require('./_beekeeper'), Object.assign({ bk: 1 }, b));
const sp = b => via(require('./_stellen'), Object.assign({ sp: 1 }, b));

/* ---------- PDF auf dem Logopapier ---------- */
const PCSS = `@page{size:A4;margin:46mm 20mm 34mm 22mm}
html,body{background:transparent!important}
body{font-family:"DejaVu Sans",Verdana,sans-serif;font-size:8.6pt;line-height:1.45;color:#3C3C3B}
.k{font-family:Figtree,sans-serif;font-size:7.4pt;letter-spacing:.12em;text-transform:uppercase;color:#1B8384;font-weight:600;margin:0 0 1.5mm}
h1{font-family:Figtree,sans-serif;font-weight:300;font-size:19pt;letter-spacing:.06em;text-transform:uppercase;color:#1B8384;margin:0 0 1mm;line-height:1.15}
.sub{color:#767676;margin:0 0 6mm}
h2{font-family:Figtree,sans-serif;font-weight:600;font-size:9.4pt;letter-spacing:.06em;text-transform:uppercase;color:#1B8384;margin:6mm 0 2mm;padding-bottom:1.2mm;border-bottom:.6pt solid #BEE2E9;break-after:avoid}
table.dl{width:100%;border-collapse:collapse}table.dl td{padding:1.3mm 0;vertical-align:top;border-bottom:.3pt solid #E6EFF1}
table.dl td:first-child{width:52mm;color:#767676;padding-right:4mm}
.ph{display:flex;flex-wrap:wrap;gap:2mm;margin-top:1.5mm}.ph img{height:34mm;max-width:52mm;object-fit:cover;border-radius:1.5mm;border:.3pt solid #D9ECEF}
.big .ph img{height:62mm;max-width:80mm}
p{margin:0 0 3mm}
table.pos{width:100%;border-collapse:collapse;margin:2mm 0 4mm}table.pos th{font-family:Figtree,sans-serif;font-size:7.4pt;letter-spacing:.06em;text-transform:uppercase;color:#1B8384;text-align:left;border-bottom:.8pt solid #1B8384;padding:1.6mm 1mm}
table.pos td{padding:2mm 1mm;border-bottom:.3pt solid #E6EFF1;vertical-align:top}table.pos td.r,table.pos th.r{text-align:right;white-space:nowrap}
table.pos tr.tot td{font-weight:700;border-bottom:0;border-top:.8pt solid #3C3C3B}
.sig{display:grid;grid-template-columns:1fr 1fr;gap:10mm;margin-top:8mm;break-inside:avoid}.sig .l{height:22mm;border-bottom:.6pt solid #3C3C3B;display:flex;align-items:flex-end}.sig .l img{max-height:20mm;max-width:70mm}
.sig small{display:block;color:#767676;margin-top:1mm}
.note{background:#F2F9FA;border-left:2pt solid #2BB6B7;padding:2.5mm 3.5mm;margin:3mm 0}
.row{break-inside:avoid}`;
function pdfHtml(inner) {
  return R.shell(`<div class="pdoc">${inner}</div>`).replace('</style>', PCSS + '</style>');
}
/* Inhalt mit Seitenrändern rendern und danach jede Seite auf das Logopapier (lh.png) legen */
async function pdf(inner) {
  const { PDFDocument } = require('pdf-lib');
  const body = (await R.render(pdfHtml(inner))).pdf;
  const src = await PDFDocument.load(body), out = await PDFDocument.create();
  const lh = await out.embedPng(Buffer.from(R.assets().LH.split(',')[1], 'base64'));
  const pages = await out.embedPdf(src, src.getPageIndices());
  for (const ep of pages) { const pg = out.addPage([595.28, 841.89]); pg.drawImage(lh, { x: 0, y: 0, width: 595.28, height: 841.89 }); pg.drawPage(ep, { x: 0, y: 0, width: 595.28, height: 841.89 }); }
  out.setAuthor('Clean Service Scaramuzzo AG'); out.setProducer('Clean Service Scaramuzzo AG');
  return Buffer.from(await out.save());
}
const tr = (a, b) => b == null || b === '' ? '' : `<tr class="row"><td>${h(a)}</td><td>${b}</td></tr>`;
const photos = (arr, max = 12) => (arr || []).filter(isImg).slice(0, max).length ? `<div class="ph">${(arr || []).filter(isImg).slice(0, max).map(p => `<img src="${p}" alt="">`).join('')}</div>` : '';
const sigBox = (img, label, sub) => `<div><div class="l">${isImg(img) ? `<img src="${img}" alt="">` : ''}</div><small>${h(label)}${sub ? ' · ' + h(sub) : ''}</small></div>`;
const kopf = (k, titel, g) => `<div class="k">${h(k)}</div><h1>${h(titel)}</h1><p class="sub">${h(g.firma)} · Objekt-Nr. ${h(g.objNr)} · ${h(g.adresse)}</p>`;

function protokollHtml(g, x) {
  const P = g.prot || {}, keys = (P.keys || []).filter(k => k.marke || k.nr);
  const zeit = (P.zeit === 'Andere' ? P.zeitAndere : P.zeit) + (P.zeitExakt ? ' · ' + P.zeitExakt : '');
  const nf = (P.notfall || []).filter(n => n.n || n.t);
  return kopf('Intern · Neues UH Objekt', 'Protokoll Startgespräch', g) + `
  <h2>Termin und Kunde</h2><table class="dl">${tr('Termin vor Ort', h(dLong(P.termin)))}${tr('Firma', h(g.firma))}${tr('Ansprechperson', h([g.anrede, g.kontakt].filter(Boolean).join(' ')))}${tr('E-Mail / Telefon', h([g.email, g.tel].filter(Boolean).join(' · ')))}${tr('Adresse', h(g.adresse))}${tr('Offerte', h(g.nr))}${tr('Verkäufer', h(g.verk))}${tr('Abteilungsleiter', h(g.al))}</table>
  <h2>Notfallnummern</h2><table class="dl">${nf.length ? nf.map((n, i) => tr(i === (P.notfallPrio || 0) ? '1. Priorität' : 'Weitere Nummer', h([n.n, n.t].filter(Boolean).join(' · ')))).join('') : tr('Notfall', 'nicht erfasst')}</table>
  <h2>Reinigung</h2><table class="dl">${tr('Reinigungsstart', h(dLong(P.start) + (P.startZeit ? ', ' + P.startZeit + ' Uhr' : '')))}${tr('Frequenz', h(P.freq))}${tr('Aufwand pro Reinigung', h(P.aufwand ? P.aufwand + ' h' : ''))}${tr('Reinigungstage', h((P.tage || []).map(t => TAG[t] || t).join(', ')))}${tr('Reinigungszeit', h(zeit))}${tr('Reinigungsteam', h(x.team || 'noch nicht besetzt'))}</table>
  <h2>Alarmanlage und Schlüssel</h2><table class="dl">${tr('Alarmanlage', h(P.alarm))}${tr('Hinweis', h(P.alarmHinweis))}${keys.map((k, i) => tr('Schlüssel / Badge ' + (i + 1), h([k.marke, k.nr].filter(Boolean).join(' · ')) + photos(k.fotos, 4))).join('')}</table>
  <h2>Material und Putzraum</h2><table class="dl">${tr('Verbrauchsmaterial über', h(P.material))}${tr('Lieferung durch', h((P.lieferung || 'Webstar') + (P.lieferGrund ? ' · ' + P.lieferGrund : '')))}${tr('Putzraum', h(P.putzraum + (P.putzraumBem ? ' · ' + P.putzraumBem : '')) + photos(P.putzraumFotos, 4))}</table>
  ${(x.mat || []).length ? `<h2>Richtmengen Materialbestellung (pro Monat)</h2><table class="dl">${x.mat.map(m => tr(m.n, h(String(m.m).replace('.', ',') + ' ' + (m.e || '')))).join('')}</table>` : ''}
  <h2>Container und Entsorgung</h2><table class="dl">${tr('Container', h(P.container + (P.containerBem ? ' · ' + P.containerBem : '')) + photos(P.containerFotos, 4))}${tr('Karton / Altpapier / PET', h(P.entsorgung + (P.entsorgungBem ? ' · ' + P.entsorgungBem : '')))}${P.entsorgung === 'separat' ? tr('Aufwand / Kosten', h((P.entsorgungAufwand || 0) + ' h pro Woche · ' + chf(P.entsorgungKosten) + ' pro Monat')) : ''}</table>
  <h2>Spezialreinigungen und Waschservice</h2><table class="dl">${(x.zl || []).map(z => tr(z.off ? 'Offeriert' : 'Nachofferte', h(z.n + ' · ' + (z.menge ? z.menge + ' · ' : '') + chf(z.total) + (z.dispo ? ' · provisorisch disponieren' : '')))).join('') || tr('Spezialreinigungen', 'keine')}${tr('Waschservice', h((P.wasch || 'Nein') + (P.wasch === 'Ja' ? ' · Mitarbeiter ' + chf(P.waschAus) + ' auszahlen, Kunde ' + chf(P.waschVer) + ' verrechnen, pro ' + (P.waschPro || 'Waschgang') : '')))}</table>
  <h2>Schäden und sonstige Infos</h2><table class="dl">${tr('Schäden', h(P.schaeden + (P.schaeden === 'Ja' && P.schaedenBem ? ' · ' + P.schaedenBem : '')) + photos(P.schaedenFotos, 8))}${tr('Sonstige Infos', h(P.material2))}</table>
  ${g.springer ? `<div class="note">Start mit Springerteam${(g.ma || []).length ? ', danach ' + h(g.ma.join(', ')) : ', Vakanz noch offen'}.</div>` : ''}
  <div class="sig">${sigBox(P.sigK, 'Kunde', [g.anrede, g.kontakt].filter(Boolean).join(' '))}${sigBox(P.sigCS, 'Clean Service Scaramuzzo AG', g.al)}</div>`;
}
function schluesselHtml(g) {
  const P = g.prot || {}, keys = (P.keys || []).filter(k => k.marke || k.nr);
  return kopf('Schlüsselprotokoll', 'Übergabe Schlüssel und Badges', g) + `
  <p>Am ${h(dLong(P.termin))} wurden Clean Service Scaramuzzo AG für die Unterhaltsreinigung folgende Schlüssel und Badges übergeben. Clean Service bewahrt sie gemäss dem internen Schlüsselprozess sicher auf und verwendet sie ausschliesslich für die vereinbarten Reinigungen.</p>
  <table class="pos"><thead><tr><th>#</th><th>Bezeichnung / Marke</th><th>Nummer</th></tr></thead><tbody>${keys.map((k, i) => `<tr class="row"><td>${i + 1}</td><td>${h(k.marke)}${photos(k.fotos, 3)}</td><td>${h(k.nr)}</td></tr>`).join('')}</tbody></table>
  ${P.alarm === 'Ja' ? `<p><b>Alarmanlage:</b> ${h(P.alarmHinweis || 'vorhanden')}</p>` : ''}
  <p>Bei Verlust eines Schlüssels oder Badges informiert Clean Service Sie umgehend. Die Rückgabe erfolgt bei Vertragsende oder auf Ihren Wunsch hin gegen Quittung.</p>
  <div class="sig">${sigBox(P.sigK, 'Übergeben: Kunde', [g.anrede, g.kontakt].filter(Boolean).join(' '))}${sigBox(P.sigCS, 'Übernommen: Clean Service Scaramuzzo AG', g.al)}</div>`;
}
function schadenHtml(g) {
  const P = g.prot || {};
  return kopf('Schadenprotokoll', 'Bestehende Schäden vor Reinigungsstart', g) + `
  <p>Beim Startgespräch vom ${h(dLong(P.termin))} wurden vor Beginn der Unterhaltsreinigung gemeinsam folgende bereits bestehende Schäden festgehalten. Sie sind nicht durch Clean Service Scaramuzzo AG entstanden.</p>
  <div class="note">${h(P.schaedenBem || 'Siehe Fotos').replace(/\n/g, '<br>')}</div>
  <div class="big">${photos(P.schaedenFotos, 12)}</div>
  <div class="sig">${sigBox(P.sigK, 'Kunde', [g.anrede, g.kontakt].filter(Boolean).join(' '))}${sigBox(P.sigCS, 'Clean Service Scaramuzzo AG', g.al)}</div>`;
}
function nachofferteHtml(g, items) {
  const tot = items.reduce((s, z) => s + (+z.total || 0), 0);
  return kopf('Offerte Spezialreinigung', 'Offerte Spezialreinigung', g) + `
  <p>${h(g.anrede ? 'Guten Tag ' + g.anrede + ' ' + nameLast(g.kontakt) : 'Guten Tag')}</p>
  <p>Vielen Dank für das angenehme Startgespräch vom ${h(dLong((g.prot || {}).termin))}. Wie besprochen offerieren wir Ihnen ergänzend zur Unterhaltsreinigung folgende Spezialreinigungen:</p>
  <table class="pos"><thead><tr><th>Leistung</th><th class="r">Menge</th><th class="r">Total</th></tr></thead><tbody>${items.map(z => `<tr class="row"><td>${h(z.n)}</td><td class="r">${h(z.menge || 'pauschal')}</td><td class="r">${chf(z.total)}</td></tr>`).join('')}<tr class="tot"><td>Total exkl. MWST</td><td></td><td class="r">${chf(tot)}</td></tr></tbody></table>
  <p>Die Offerte ist während der gesamten Vertragsdauer der Unterhaltsreinigung gültig. Die Ausführung erfolgt nach Absprache durch unsere Spezialreinigungsabteilung. Für einen Auftrag melden Sie sich bitte direkt bei ${SPEZ}, wir planen den Termin gerne mit Ihnen.</p>
  <p>Freundliche Grüsse<br>Clean Service Scaramuzzo AG</p>`;
}

/* ---------- Auftrag: Startgespräch abgeschlossen (oder PDFs erneut senden) ---------- */
async function abschluss(p, nurIntern) {
  const g = p.g || {}, x = p.x || {}, P = g.prot || {}, out = [];
  const firma = g.firma || 'Kunde', obj = g.objNr ? ' – OBJ ' + g.objNr : '';
  const keys = (P.keys || []).filter(k => k.marke || k.nr), dmg = P.schaeden === 'Ja';
  const S = await settings().catch(() => ({}));
  const alMail = isMail(x.alMail) ? x.alMail : undefined;
  const fn = s => s.replace(/[^\wäöüÄÖÜ\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 60);
  const att = (name, buf) => ({ filename: name, content: buf.toString('base64'), content_type: 'application/pdf' });

  let fP, fK, fS, fN;
  try { fP = att(`Protokoll_Startgespraech_${fn(firma)}.pdf`, await pdf(protokollHtml(g, x))); } catch (e) { out.push({ k: 'pdf', ok: false, t: 'Protokoll-PDF: ' + e.message }); }
  if (keys.length) try { fK = att(`Schluesselprotokoll_${fn(firma)}.pdf`, await pdf(schluesselHtml(g))); } catch (e) { out.push({ k: 'pdf', ok: false, t: 'Schlüsselprotokoll-PDF: ' + e.message }); }
  if (dmg) try { fS = att(`Schadenprotokoll_${fn(firma)}.pdf`, await pdf(schadenHtml(g))); } catch (e) { out.push({ k: 'pdf', ok: false, t: 'Schadenprotokoll-PDF: ' + e.message }); }

  /* 1. Intern an unterhalt@ */
  const intern = [fP, fK, fS].filter(Boolean);
  if (intern.length) {
    const t = `Hallo zusammen\n\nDas Startgespräch bei ${firma}${g.adresse ? ', ' + g.adresse : ''} wurde am ${dShort(P.termin)} von ${g.al || 'der Abteilungsleitung'} durchgeführt und unterschrieben. Reinigungsstart ist am ${dLong(P.start) || 'noch offen'}${P.startZeit ? ' um ' + P.startZeit + ' Uhr' : ''}, ${P.freq || ''}, ${P.aufwand || '?'} h pro Reinigung (${(P.tage || []).map(t => TAG[t] || t).join(', ')}). Reinigungsteam: ${x.team || 'noch nicht besetzt'}.`
      + (P.wasch === 'Ja' ? `\n\nWaschservice: Mitarbeiter ${chf(P.waschAus)} auszahlen, Kunde ${chf(P.waschVer)} verrechnen, pro ${P.waschPro || 'Waschgang'}.` : '')
      + (P.material === 'Kunde' ? '\n\nVerbrauchsmaterial besorgt der Kunde selbst.' : '')
      + ((P.lieferung || '') === 'Clean Service Hauptlager' ? `\n\nMaterial-Lieferung über das Clean Service Hauptlager${P.lieferGrund ? ' (' + P.lieferGrund + ')' : ''}.` : '')
      + `\n\nIm Anhang: ${intern.map(a => a.filename.split('_')[0].replace('Startgespraech', 'Startgespräch').replace('Schluesselprotokoll', 'Schlüsselprotokoll')).join(', ')}.${nurIntern ? '\n\n(Erneut gesendet aus dem Besprechungstool.)' : ''}\n\nGruss\nBesprechungstool Startgespräch UH`;
    try { await sendMail({ to: UH, subject: `${nurIntern ? 'Erneut: ' : ''}Startgespräch abgeschlossen: ${firma}${obj}`, text: t, attachments: intern, kind: 'bt-intern', objectId: g.id, S, nocopy: true, replyTo: alMail });
      out.push({ k: 'intern', ok: true, t: `Mail an ${UH} mit ${intern.length} PDF gesendet` }); }
    catch (e) { out.push({ k: 'intern', ok: false, t: 'Mail an unterhalt@: ' + e.message }); }
  }
  if (nurIntern) return out;

  /* 2. Springerteam disponieren */
  if (g.springer) {
    const t = `Hallo zusammen\n\nBeim Objekt ${firma}${g.adresse ? ', ' + g.adresse : ''} startet die Reinigung mit dem Springerteam. Bitte ab Reinigungsstart am ${dLong(P.start) || 'noch offen'}${P.startZeit ? ' um ' + P.startZeit + ' Uhr' : ''} disponieren: ${P.freq || ''}, ${P.aufwand || '?'} h pro Reinigung, ${(P.tage || []).map(t => TAG[t] || t).join(', ')}.\n\n${(g.ma || []).length ? `Übergabe an ${g.ma[0]} nach der Einführung.` : 'Die Vakanz ist noch offen. Das Springerteam reinigt, bis jemand fest eingeteilt ist.'}\n\nGruss\nBesprechungstool Startgespräch UH`;
    try { await sendMail({ to: UH, subject: `Springerteam disponieren: ${firma}${obj}, Start ${dShort(P.start)}`, text: t, kind: 'bt-springer', objectId: g.id, S, nocopy: true, replyTo: alMail });
      out.push({ k: 'springer', ok: true, t: 'Springerteam-Meldung an unterhalt@ gesendet' }); }
    catch (e) { out.push({ k: 'springer', ok: false, t: 'Springerteam-Meldung: ' + e.message }); }
  }

  /* 3. Kunde: Schlüssel- und Schadenprotokoll */
  const kunde = [fK, fS].filter(Boolean);
  if (x.autoPdf !== false && kunde.length) {
    if (!isMail(g.email)) out.push({ k: 'kunde', ok: false, t: 'Kunde hat keine gültige Mailadresse, Protokolle nicht gesendet' });
    else {
      const was = [fK && 'das Schlüsselprotokoll', fS && 'das Schadenprotokoll'].filter(Boolean).join(' und ');
      const t = `${g.anrede ? 'Guten Tag ' + g.anrede + ' ' + nameLast(g.kontakt) : 'Guten Tag'}\n\nHerzlichen Dank für das angenehme Startgespräch vom ${dLong(P.termin)}. Wie besprochen erhalten Sie im Anhang ${was} zu Ihrem Objekt ${firma}. Damit ist alles für einen reibungslosen Reinigungsstart${P.start ? ' am ' + dLong(P.start) : ''} vorbereitet.\n\nBei Fragen ist ${g.al || 'unsere Abteilungsleitung'} gerne für Sie da.\n\nFreundliche Grüsse\nClean Service Scaramuzzo AG`;
      try { await sendMail({ to: g.email.trim(), subject: `${fK && fS ? 'Schlüssel- und Schadenprotokoll' : fK ? 'Schlüsselprotokoll' : 'Schadenprotokoll'}: ${firma}`, text: t, attachments: kunde, kind: 'bt-kunde', objectId: g.id, S, copyTo: UH, replyTo: alMail });
        out.push({ k: 'kunde', ok: true, t: `${kunde.length === 2 ? 'Schlüssel- und Schadenprotokoll' : fK ? 'Schlüsselprotokoll' : 'Schadenprotokoll'} an ${g.email.trim()} gesendet` }); }
      catch (e) { out.push({ k: 'kunde', ok: false, t: 'Mail an Kunde: ' + e.message }); }
    }
  }

  /* 4. Nachofferte Spezialreinigung */
  const items = (x.nach || []).filter(z => z && z.n);
  if (x.autoOfferte !== false && items.length) {
    if (!isMail(g.email)) out.push({ k: 'offerte', ok: false, t: 'Nachofferte: Kunde hat keine gültige Mailadresse' });
    else try {
      fN = att(`Offerte_Spezialreinigung_${fn(firma)}.pdf`, await pdf(nachofferteHtml(g, items)));
      const t = `${g.anrede ? 'Guten Tag ' + g.anrede + ' ' + nameLast(g.kontakt) : 'Guten Tag'}\n\nWie beim Startgespräch besprochen, erhalten Sie im Anhang unsere Offerte für die ergänzenden Spezialreinigungen (${items.map(z => z.n).join(', ')}). Die Offerte gilt während der gesamten Vertragsdauer. Für einen Auftrag oder Fragen erreichen Sie unsere Spezialreinigungsabteilung direkt unter ${SPEZ}.\n\nFreundliche Grüsse\nClean Service Scaramuzzo AG`;
      await sendMail({ to: g.email.trim(), subject: `Offerte Spezialreinigung: ${firma}`, text: t, attachments: [fN], kind: 'bt-offerte', objectId: g.id, S, copyTo: SPEZ, replyTo: SPEZ });
      out.push({ k: 'offerte', ok: true, t: `Nachofferte (${chf(items.reduce((s, z) => s + (+z.total || 0), 0))}) an ${g.email.trim()} gesendet, Kopie an ${SPEZ}` });
    } catch (e) { out.push({ k: 'offerte', ok: false, t: 'Nachofferte: ' + e.message }); }
  }

  /* 5. Beekeeper-Gruppenbeschreibung */
  if (x.autoChat !== false && x.desc) {
    const o = g.id ? await rpc('api_doc_get', { p_path: 'objects/' + g.id }).catch(() => null) : null;
    const chat = o && o.bk && o.bk.chatId;
    if (!chat) out.push({ k: 'chat', ok: false, t: 'Beekeeper: kein Gruppenchat im Verkaufstool eröffnet, Beschreibung nicht ergänzt' });
    else { const j = await bk({ action: 'desc', chatId: chat, description: String(x.desc).slice(0, 300) });
      out.push({ k: 'chat', ok: !!j.ok, t: j.ok ? 'Gruppenbeschreibung im Beekeeper-Chat ergänzt' : 'Beekeeper-Beschreibung: ' + (j.error || 'fehlgeschlagen') }); }
  }

  /* 6. Verlauf im Verkaufstool */
  await logVk(g.id, `Startgespräch abgeschlossen (${g.al || 'Besprechungstool'})` + (out.some(r => !r.ok) ? ', mit offenen Punkten' : ''));
  return out;
}

async function logVk(id, text, mut) {
  if (!id) return;
  try { const o = await rpc('api_doc_get', { p_path: 'objects/' + id }); if (!o || !o.id) return;
    if (mut) mut(o); o.log = Array.isArray(o.log) ? o.log : []; o.log.push([today(), text]); o.upd = Date.now();
    await rpc('api_doc_put', { p_path: 'objects/' + id, p_data: o }); } catch (e) {}
}

/* ---------- Auftrag: Vakanz im Startgespräch besetzen (gleicher Ablauf wie «Bestätigen» im Verkaufstool) ---------- */
async function vakanz(p) {
  const out = [], id = p.id, wahl = String(p.name || '').trim(), rest = (p.rest || []).map(String);
  const o = id ? await rpc('api_doc_get', { p_path: 'objects/' + id }) : null;
  if (!o || !o.id) return [{ k: 'vak', ok: false, t: 'Objekt im Verkaufstool nicht gefunden' }];
  const v = o.vak = o.vak || {}, apps = v.apps = Array.isArray(v.apps) ? v.apps : [];
  const cu = o.customerId ? await rpc('api_doc_get', { p_path: 'customers/' + o.customerId }).catch(() => null) : null;
  const firma = (cu && cu.firma) || o.name || '';
  const same = (a, n) => String(a.name || '').trim().toLowerCase() === n.toLowerCase();
  let a = apps.find(x => same(x, wahl));
  if (!a) { a = { id: 'bt' + Date.now().toString(36), name: wahl }; apps.push(a); }
  /* Beekeeper-Konto suchen, falls im Verkaufstool noch nicht zugeordnet */
  const need = [a].concat(rest.map(n => apps.find(x => same(x, n)) || null)).filter(x => x && !x.bkId);
  if (need.length) { const m = await bk({ action: 'match', names: need.map(x => x.name) }); (m.users || []).forEach((u, i) => { if (u && u.id) need[i].bkId = u.id; }); }
  const start = p.start ? dLong(p.start) : '';
  const text = `Willkommen im Team, ${a.name}! Du übernimmst die Unterhaltsreinigung bei ${firma}, ${o.adresse || ''}.${start ? ' Start: ' + start + '.' : ''} Das Leistungsverzeichnis findest du hier im Chat. Bei Fragen melde dich jederzeit hier.`;
  if (!a.bkId) out.push({ k: 'chat', ok: false, t: `${a.name} in Beekeeper nicht gefunden: bitte manuell zum Gruppenchat hinzufügen` });
  else if (!o.bk || !o.bk.chatId) out.push({ k: 'chat', ok: false, t: 'Kein Beekeeper-Gruppenchat vorhanden: bitte zuerst im Verkaufstool eröffnen' });
  else { const j = await bk({ action: 'addMember', chatId: o.bk.chatId, userId: a.bkId, text }); out.push({ k: 'chat', ok: !!j.ok, t: j.ok ? `${a.name} zum Gruppenchat hinzugefügt, Startnachricht gesendet` : 'Gruppenchat: ' + (j.error || 'fehlgeschlagen') }); }
  if (!v.spOff && o.sp && o.sp.id) { const j = await sp({ action: 'vergeben', id: o.sp.id }); v.spOff = !!j.ok; out.push({ k: 'stellen', ok: !!j.ok, t: j.ok ? 'Kunde aus dem Stellenportal genommen' : 'Stellenportal: ' + (j.error || 'fehlgeschlagen') }); }
  for (const n of rest) {
    const r = apps.find(x => same(x, n)); if (!r || r.st) continue;
    const first = String(r.name || '').trim().split(/\s+/)[0];
    if (!r.bkId) { r.st = 'abgesagt'; out.push({ k: 'absage', ok: false, t: `${r.name} in Beekeeper nicht gefunden: Absage bitte persönlich mitteilen` }); continue; }
    const j = await bk({ action: 'dm', userId: r.bkId, text: `Hallo ${first}, vielen Dank für deine Bewerbung für ${firma}. Dieses Mal haben wir uns für eine andere Mitarbeiterin entschieden. Schau gerne weiter im Stellenportal vorbei, wir freuen uns auf deine nächste Bewerbung. Liebe Grüsse, Clean Service` });
    r.st = 'abgesagt'; r.absage = !!j.ok; out.push({ k: 'absage', ok: !!j.ok, t: j.ok ? `Absage an ${r.name} gesendet` : `Absage an ${r.name}: ` + (j.error || 'fehlgeschlagen') });
  }
  a.st = 'zugesagt'; a.res = out.filter(r => r.k !== 'absage'); if (!v.chosen) { v.chosen = a.id; v.chosenAt = today(); }
  o.log = Array.isArray(o.log) ? o.log : []; o.log.push([today(), `Vakanz: ${a.name} im Startgespräch bestätigt (${p.von || 'Besprechungstool'})` + (out.some(r => !r.ok) ? ', mit offenen Punkten' : '')]); o.upd = Date.now();
  try { await rpc('api_doc_put', { p_path: 'objects/' + o.id, p_data: o }); } catch (e) { out.push({ k: 'vk', ok: false, t: 'Verkaufstool nicht aktualisiert: ' + e.message }); }
  return out;
}

module.exports = async (b, res) => {
  const id = String(b.bt || '');
  if (!/^[a-f0-9]{32}$/.test(id)) return res.status(400).json({ error: 'Auftrag ungültig' });
  let job;
  try { job = await rpc('api_bt_take', { p_id: id }); } catch (e) { return res.status(502).json({ error: 'Datenbank: ' + e.message }); }
  if (!job || !job.art) return res.status(404).json({ error: 'Auftrag nicht gefunden oder bereits ausgeführt' });
  let out;
  try {
    if (job.art === 'abschluss') out = await abschluss(job.payload || {}, false);
    else if (job.art === 'pdf') out = await abschluss(job.payload || {}, true);
    else if (job.art === 'vakanz') out = await vakanz(job.payload || {});
    else out = [{ k: 'art', ok: false, t: 'Unbekannter Auftrag' }];
  } catch (e) { out = [{ k: 'fehler', ok: false, t: 'Fehler: ' + String(e && e.message || e).slice(0, 300) }]; }
  try { await rpc('api_bt_done', { p_id: id, p_result: { results: out } }); } catch (e) {}
  res.status(200).json({ ok: out.every(r => r.ok), results: out });
};
module.exports._test = { protokollHtml, schluesselHtml, schadenHtml, nachofferteHtml, pdfHtml, pdf };

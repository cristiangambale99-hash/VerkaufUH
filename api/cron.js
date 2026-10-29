const { rpc, sendMail, settings, E, HOTEL_RT } = require('./_lib');
const { MAIL_NF_EN } = require('./_en');
const TZ = 'Europe/Zurich';
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ }).format(new Date());
const addD = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const addM = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
const dmy = iso => iso ? iso.split('-').reverse().join('.') : '–';
const gaps = S => { const g = String(S.nachStufen || '7T, 14T, 5T').split(/[,;]/).map(x => x.trim()).filter(x => !/M$/i.test(x)).map(x => parseInt(x, 10)).filter(x => x > 0); return [g[0] || 7, g[1] || 14, g[2] || 5]; };
const salutation = (cu, lang) => { const n = String(cu.kontakt || '').trim().split(/\s+/).pop() || ''; if (lang === 'en') { if (cu.anrede === 'Herr' && n) return `Dear Mr ${n}`; if (cu.anrede === 'Frau' && n) return `Dear Ms ${n}`; return 'Dear Sir or Madam'; } if (cu.anrede === 'Herr' && n) return `Sehr geehrter Herr ${n}`; if (cu.anrede === 'Frau' && n) return `Sehr geehrte Frau ${n}`; return 'Sehr geehrte Damen und Herren'; };
function mail(S, o, cu, k, closeDue) {
  const en = o.lang === 'en', pre = en ? 'mail_en_' : 'mail_';
  const b = S[pre + k + '_b'] || (en && MAIL_NF_EN[k] && MAIL_NF_EN[k].b), t = S[pre + k + '_t'] || (en && MAIL_NF_EN[k] && MAIL_NF_EN[k].t); if (!b || !t) return null;
  const fill = s => s.replace(/\{objekt\}/g, o.name || (en ? 'your property' : 'Ihr Objekt')).replace(/\{frist\}/g, dmy(closeDue));
  return { subject: fill(b), text: fill(t).replace(/^(Sehr geehrte|Dear)[^\n]*/, salutation(cu, en ? 'en' : 'de')) };
}
/* ---------- Nachfassung Hotelofferten (gleicher Rhythmus wie Unterhaltsreinigung) ---------- */
const HNF = {
  nf1: { b: 'Ihre Offerte für den Hotelservice: Gerne beantworten wir offene Fragen', t: "{gruss}\n\nVor einer Woche haben wir Ihnen unsere Offerte {nr} für den Hotelservice{objekt} zugestellt. Gerne möchten wir uns erkundigen, ob Sie die Unterlagen in Ruhe prüfen konnten und ob sich daraus Fragen ergeben haben.\n\nMöchten Sie Zimmertypen, Leistungen oder den Umfang des Public Area Cleaning anpassen, überarbeiten wir die Offerte unkompliziert für Sie. Gerne besprechen wir die Details auch in einem kurzen Telefonat oder direkt bei Ihnen vor Ort.\n\n{btn}Wir freuen uns auf Ihre Rückmeldung und darauf, Ihre Gäste gemeinsam mit Ihnen zu begeistern.\n\nFreundliche Grüsse" },
  nf2: { b: 'Rückfrage zu unserer Offerte {nr} für den Hotelservice', t: "{gruss}\n\nVor drei Wochen haben wir Ihnen unsere Offerte {nr} für den Hotelservice{objekt} unterbreitet. Damit wir den Start sauber planen und das Team rechtzeitig für Sie einteilen können, bitten wir Sie um eine kurze Rückmeldung, ob Sie weiterhin an einer Zusammenarbeit interessiert sind.\n\nHaben sich Ihre Anforderungen verändert, überarbeiten wir die Offerte gerne und stimmen die Leistungen auf Ihren aktuellen Bedarf ab. Ein kurzer Anruf oder eine Antwort auf diese Mail genügt.\n\n{btn}Hören wir bis am {frist} nichts von Ihnen, gehen wir davon aus, dass das Thema im Moment nicht ansteht, und schliessen die Offerte vorläufig. Sie können jederzeit auf uns zukommen.\n\nFreundliche Grüsse" },
  re6: { b: 'Hotelservice{objektB}: Wir sind weiterhin für Sie da', t: "{gruss}\n\nVor einem halben Jahr haben wir Ihnen eine Offerte für den Hotelservice{objekt} erstellt. Da sich Belegung, Zimmerangebot und Anforderungen im Laufe der Zeit häufig verändern, möchten wir uns kurz bei Ihnen melden.\n\nSollte das Thema für Sie wieder aktuell sein, erstellen wir Ihnen gerne eine überarbeitete Offerte mit Ihren heutigen Zimmertypen und Bereichen. Eine unverbindliche Besichtigung vor Ort ist jederzeit möglich.\n\nWir freuen uns, wenn wir Sie mit unserem Hotelservice unterstützen dürfen.\n\nFreundliche Grüsse" }
};
const hGruss = h => { const n = String(h.kontakt || '').trim().split(/\s+/).pop() || ''; if (h.anrede === 'h' && n) return `Sehr geehrter Herr ${n}`; if (h.anrede === 'f' && n) return `Sehr geehrte Frau ${n}`; return 'Sehr geehrte Damen und Herren'; };
function hMail(h, k, closeDue) {
  const m = HNF[k], ob = h.objekt ? ' (' + h.objekt + ')' : '', btn = h.annUrl && k !== 're6' ? `Haben Sie sich bereits entschieden? Die Auftragserteilung retournieren Sie in zwei Minuten online:\n\n[[BTN:Auftragserteilung online retournieren|${h.annUrl}|Dauer ca. 2 Minuten · Unterzeichnung direkt am Bildschirm]]\n\n` : '';
  const f = s => s.replace(/\{gruss\}/g, hGruss(h)).replace(/\{nr\}/g, h.nr || '').replace(/\{objektB\}/g, h.objekt ? ' ' + h.objekt : '').replace(/\{objekt\}/g, ob).replace(/\{frist\}/g, dmy(closeDue)).replace(/\{btn\}/g, btn);
  return { subject: f(m.b), text: f(m.t) };
}
async function hotelNf(rows, g, T, dry, out) {
  const nfs = Object.fromEntries(rows.filter(r => r.col === 'hotelnf' && !r.deleted).map(r => [r.id, r.data]));
  for (const r of rows.filter(r => r.col === 'hotel' && !r.deleted)) {
    const h = JSON.parse(JSON.stringify(r.data || {})); if (!h.id) continue;
    const st = JSON.parse(JSON.stringify(nfs[h.id] || { id: h.id, nf: 0, nfDates: [], log: [] })); let ch = false, hch = false;
    const lg = m => { (st.log = st.log || []).push([T, m]); ch = true; };
    const sent = String(h.sent || '').slice(0, 10), to = String(h.email || '').trim();
    const send = async (k, closeDue) => {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { out.push({ nr: h.nr, k, skip: 'keine E-Mail' }); return false; }
      if (dry) { out.push({ nr: h.nr, k, dry: true, an: to }); return false; }
      const m = hMail(h, k, closeDue);
      try { await sendMail({ to, subject: m.subject, text: m.text, kind: k, objectId: h.id, lang: 'de', replyTo: HOTEL_RT }); out.push({ nr: h.nr, k, gesendet: to }); return true; }
      catch (e) { out.push({ nr: h.nr, k, fehler: e.message }); return false; }
    };
    if (h.status === 'versendet' && /^\d{4}-\d\d-\d\d$/.test(sent) && !h.nfOff) {
      const done = Math.min(st.nf || 0, 2), nfd = st.nfDates || [];
      const due0 = addD(sent, g[0]), n1 = nfd[0] || due0, due1 = addD(n1, g[1]), n2 = nfd[1] || due1, close = addD(n2, g[2]);
      if (done < 2) { if ((done === 0 ? due0 : due1) <= T && await send('nf' + (done + 1), close)) { st.nf = done + 1; st.nfDates = [...nfd, T]; lg(`${st.nf}. Nachfassung gesendet an ${to}`); } }
      else if (close <= T && !dry) { h.status = 'abgelehnt'; h.auto = true; h.upd = Date.now(); hch = true; st.closed = close; lg('Keine Rückmeldung: Offerte automatisch geschlossen'); }
    } else if (h.status === 'abgelehnt' && h.auto && st.closed && !st.re6 && !h.nfOff && addM(st.closed, 6) <= T) {
      if (await send('re6', null)) { st.re6 = T; lg(`Erneute Anfrage nach 6 Monaten gesendet an ${to}`); }
    }
    if (hch) await rpc('api_doc_put', { p_path: 'hotel/' + h.id, p_data: h });
    if (ch && !dry) await rpc('api_doc_put', { p_path: 'hotelnf/' + h.id, p_data: st });
  }
}
module.exports = async (req, res) => {
  if ((req.headers.authorization || '') !== 'Bearer ' + E.CRON_SECRET) return res.status(401).end();
  const dry = req.query && req.query.dry === '1', T = today(), out = [];
  try {
    const S = await settings(), g = gaps(S);
    const rows = await rpc('api_docs_since', { p_since: '1970-01-01T00:00:00Z' });
    const custs = Object.fromEntries(rows.filter(r => r.col === 'customers' && !r.deleted).map(r => [r.id, r.data]));
    for (const r of rows.filter(r => r.col === 'objects' && !r.deleted)) {
      const o = JSON.parse(JSON.stringify(r.data)), cu = custs[o.customerId] || {}; let changed = false;
      const log = m => { (o.log = o.log || []).push([T, m]); changed = true; };
      /* Auftragserteilung erhalten → Aktiv am Vertragsbeginn */
      if (o.status === 'gewonnen' && o.aktiv === false && !o.inaktiv) { const ab = o.aktivAb || (o.start && o.start.datum) || ''; if (ab && ab <= T) { o.aktiv = true; log('Aktiv seit Vertragsbeginn ' + ab.split('-').reverse().join('.')); out.push({ nr: o.nr, aktiv: ab }); } }
      const run = o.inaktiv ? false : (o.status === 'versendet' || (o.status === 'gewonnen' && o.revOpen)) && o.sent;
      const send = async (k, closeDue) => {
        const m = mail(S, o, cu, k, closeDue);
        if (!cu.email || !m) { out.push({ nr: o.nr, k, skip: !cu.email ? 'keine E-Mail' : 'Vorlage fehlt' }); return false; }
        if (dry) { out.push({ nr: o.nr, k, dry: true, an: cu.email }); return false; }
        try { await sendMail({ to: cu.email, subject: m.subject, text: m.text, kind: k, objectId: o.id, S, lang: o.lang === 'en' ? 'en' : 'de' }); out.push({ nr: o.nr, k, gesendet: cu.email }); return true; }
        catch (e) { out.push({ nr: o.nr, k, fehler: e.message }); return false; }
      };
      if (run) {
        const done = Math.min(o.nf || 0, 2), nfd = o.nfDates || [];
        const sh = Array.isArray(o.nfShift) ? o.nfShift : [], due0 = addD(o.sent, g[0] + (+sh[0] || 0)), n1 = nfd[0] || due0, due1 = addD(n1, g[1] + (+sh[1] || 0)), n2 = nfd[1] || due1, close = addD(n2, g[2]);
        if (done < 2) {
          if ((done === 0 ? due0 : due1) <= T && await send('nf' + (done + 1), close)) { o.nf = done + 1; o.nfDates = [...nfd, T]; log(`${o.nf}. Nachfassung automatisch gesendet an ${cu.email}`); }
        } else if (close <= T) {
          if (o.status === 'versendet') { o.status = 'verloren'; o.auto = true; o.verlorenSeit = close; o.reMail = false; log('Keine Rückmeldung: automatisch auf inaktiv gesetzt'); }
          else { o.revOpen = false; log('Keine Rückmeldung zur angepassten Offerte: bisherige Konditionen gelten weiter'); }
        }
      } else if (o.status === 'verloren' && o.auto && o.verlorenSeit && !o.reMail && addM(o.verlorenSeit, 6) <= T) {
        if (await send('re6', null)) { o.reMail = true; log(`Erneute Anfrage nach 6 Monaten gesendet an ${cu.email}`); }
      }
      if (changed && !dry) await rpc('api_doc_put', { p_path: 'objects/' + o.id, p_data: o });
    }
    try { await hotelNf(rows, g, T, dry, out); } catch (e) { out.push({ hotel: 'fehler', e: String(e.message || e) }); }
    try { await rpc('api_asset_cleanup', {}); } catch (e) {}
    res.status(200).json({ datum: T, dry, ergebnis: out });
  } catch (e) { res.status(500).json({ error: String(e.message), out }); }
};

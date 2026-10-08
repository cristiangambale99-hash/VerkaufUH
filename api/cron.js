const { rpc, sendMail, settings, E } = require('./_lib');
const TZ = 'Europe/Zurich';
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ }).format(new Date());
const addD = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const addM = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
const dmy = iso => iso ? iso.split('-').reverse().join('.') : '–';
const gaps = S => { const g = String(S.nachStufen || '7T, 14T, 5T').split(/[,;]/).map(x => x.trim()).filter(x => !/M$/i.test(x)).map(x => parseInt(x, 10)).filter(x => x > 0); return [g[0] || 7, g[1] || 14, g[2] || 5]; };
const salutation = cu => { const n = String(cu.kontakt || '').trim().split(/\s+/).pop() || ''; if (cu.anrede === 'Herr' && n) return `Sehr geehrter Herr ${n}`; if (cu.anrede === 'Frau' && n) return `Sehr geehrte Frau ${n}`; return 'Sehr geehrte Damen und Herren'; };
function mail(S, o, cu, k, closeDue) {
  const b = S['mail_' + k + '_b'], t = S['mail_' + k + '_t']; if (!b || !t) return null;
  const fill = s => s.replace(/\{objekt\}/g, o.name || 'Ihr Objekt').replace(/\{frist\}/g, dmy(closeDue));
  return { subject: fill(b), text: fill(t).replace(/^Sehr geehrte[^\n]*/, salutation(cu)) };
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
      const run = o.inaktiv ? false : (o.status === 'versendet' || (o.status === 'gewonnen' && o.revOpen)) && o.sent;
      const send = async (k, closeDue) => {
        const m = mail(S, o, cu, k, closeDue);
        if (!cu.email || !m) { out.push({ nr: o.nr, k, skip: !cu.email ? 'keine E-Mail' : 'Vorlage fehlt' }); return false; }
        if (dry) { out.push({ nr: o.nr, k, dry: true, an: cu.email }); return false; }
        try { await sendMail({ to: cu.email, subject: m.subject, text: m.text, kind: k, objectId: o.id, S }); out.push({ nr: o.nr, k, gesendet: cu.email }); return true; }
        catch (e) { out.push({ nr: o.nr, k, fehler: e.message }); return false; }
      };
      if (run) {
        const done = Math.min(o.nf || 0, 2), nfd = o.nfDates || [];
        const due0 = addD(o.sent, g[0]), n1 = nfd[0] || due0, due1 = addD(n1, g[1]), n2 = nfd[1] || due1, close = addD(n2, g[2]);
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
    try { await rpc('api_asset_cleanup', {}); } catch (e) {}
    res.status(200).json({ datum: T, dry, ergebnis: out });
  } catch (e) { res.status(500).json({ error: String(e.message), out }); }
};

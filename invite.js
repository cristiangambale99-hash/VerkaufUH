const crypto = require('crypto');
const { guard, body, sendMail, E, MS_ON, msToken, MS_G, rpc, esc } = require('./_lib');
const TZ = 'Europe/Zurich';
function offsetMin(utcMs) { const f = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(utcMs)); const g = t => +f.find(p => p.type === t).value; return (Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - utcMs) / 6e4; }
function localToUtc(s) { const [d, t] = s.split('T'), [y, m, dd] = d.split('-').map(Number), [h, mi] = (t || '09:00').split(':').map(Number); const guess = Date.UTC(y, m - 1, dd, h, mi); return new Date(guess - offsetMin(guess - offsetMin(guess) * 6e4) * 6e4); }
const fmt = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const ics = t => String(t || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function fold(l) { const o = []; while (l.length > 73) { o.push(l.slice(0, 73)); l = ' ' + l.slice(73); } o.push(l); return o.join('\r\n'); }
function build({ uid, seq, method, start, dur, summary, location, description, to }) {
  const s = localToUtc(start), e = new Date(s.getTime() + (dur || 60) * 6e4), org = E.MAIL_REPLY_TO || 'unterhalt@clean-service.ch';
  const L = ['BEGIN:VCALENDAR', 'PRODID:-//Clean Service Scaramuzzo AG//Offertplattform//DE', 'VERSION:2.0', 'CALSCALE:GREGORIAN', 'METHOD:' + method, 'BEGIN:VEVENT', 'UID:' + uid, 'DTSTAMP:' + fmt(new Date()), 'DTSTART:' + fmt(s), 'DTEND:' + fmt(e), 'SEQUENCE:' + (seq || 0),
    'SUMMARY:' + ics(summary), 'LOCATION:' + ics(location), 'DESCRIPTION:' + ics(description), 'STATUS:' + (method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'), 'TRANSP:OPAQUE', 'ORGANIZER;CN=Clean Service Scaramuzzo AG:mailto:' + org, 'ATTENDEE;CN=' + ics(to) + ';ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=FALSE:mailto:' + to];
  if (method !== 'CANCEL') L.push('BEGIN:VALARM', 'TRIGGER:-PT30M', 'ACTION:DISPLAY', 'DESCRIPTION:Termin', 'END:VALARM');
  L.push('END:VEVENT', 'END:VCALENDAR'); return L.map(fold).join('\r\n') + '\r\n';
}
const dmy = iso => iso.split('-').reverse().join('.');
/* Interne Termine (Besichtigung, Einführung) direkt im Outlook-Kalender der Person eintragen, statt nur eine .ics-Datei zu schicken.
   Die Event-ID wird unter docs «calev/…» gemerkt, damit Verschieben und Absagen denselben Termin ändern. */
async function graph(method, p, bodyObj) {
  const r = await fetch(MS_G() + p, { method, headers: { Authorization: 'Bearer ' + await msToken(), 'Content-Type': 'application/json' }, body: bodyObj ? JSON.stringify(bodyObj) : undefined });
  const t = await r.text(); let j = {}; try { j = t ? JSON.parse(t) : {}; } catch (e) {}
  if (!r.ok) { const e = new Error('Kalender ' + r.status + ': ' + ((j.error && j.error.message) || t.slice(0, 160))); e.status = r.status; throw e; }
  return j;
}
function plusMin(start, dur) { const [d, t] = start.split('T'), [y, m, dd] = d.split('-').map(Number), [h, mi] = t.split(':').map(Number); return new Date(Date.UTC(y, m - 1, dd, h, mi) + (dur || 60) * 6e4).toISOString().slice(0, 19); }
async function calDirect({ to, uid, method, start, dur, summary, location, description }) {
  const key = 'calev/' + crypto.createHash('sha1').update(uid + '|' + to.toLowerCase()).digest('hex').slice(0, 24);
  const old = await rpc('api_doc_get', { p_path: key }).catch(() => null), U = '/users/' + encodeURIComponent(to) + '/events';
  if (method === 'CANCEL') {
    if (old && old.id) { try { await graph('DELETE', U + '/' + encodeURIComponent(old.id)); } catch (e) { if (e.status !== 404) throw e; } await rpc('api_doc_del', { p_path: key }).catch(() => {}); }
    return { done: 'deleted' };
  }
  const ev = { subject: summary, body: { contentType: 'HTML', content: `<div style="font-family:Verdana,Arial,sans-serif;font-size:13px;line-height:1.5">${esc(description || '').replace(/\n/g, '<br>')}</div>` },
    start: { dateTime: start + ':00', timeZone: 'W. Europe Standard Time' }, end: { dateTime: plusMin(start, dur), timeZone: 'W. Europe Standard Time' },
    location: { displayName: location || '' }, showAs: 'busy', isReminderOn: true, reminderMinutesBeforeStart: 30 };
  if (old && old.id) { try { await graph('PATCH', U + '/' + encodeURIComponent(old.id), ev); return { done: 'updated', id: old.id }; } catch (e) { if (e.status !== 404) throw e; } }
  const j = await graph('POST', U, Object.assign({ transactionId: key.slice(6) + '-' + Date.now() }, ev));
  await rpc('api_doc_put', { p_path: key, p_data: { id: j.id, to, uid, start } }).catch(() => {});
  return { done: 'created', id: j.id };
}
module.exports = async (req, res) => {
  if (req.method !== 'POST' || !guard(req, res)) return;
  const b = await body(req), method = b.method === 'CANCEL' ? 'CANCEL' : 'REQUEST';
  const rec = (Array.isArray(b.to) ? b.to : [b.to]).filter(x => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x || ''));
  if (!rec.length || !b.uid || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(b.start || '')) return res.status(400).json({ error: 'Empfänger, ID oder Termin fehlt' });
  try {
    const [d, t] = b.start.split('T'); const ids = [];
    for (const to of rec) {
      const cal = build({ uid: b.uid, seq: b.seq, method, start: b.start, dur: b.dur, summary: b.summary || 'Besichtigung', location: b.location, description: b.description, to });
      const kunde = b.audience === 'kunde', first = b.seq > 0;
      let direct = null;
      if (!kunde && MS_ON() && /@clean-service\.ch$/i.test(to)) {
        try { direct = await calDirect({ to, uid: b.uid, method, start: b.start, dur: b.dur, summary: b.summary || 'Besichtigung', location: b.location, description: b.description }); }
        catch (e) { console.error('Kalender direkt', to, e.message); direct = null; }
      }
      const when = `${dmy(d)} um ${t} Uhr`, where = b.location ? ', ' + b.location : '';
      const subject = kunde ? (method === 'CANCEL' ? 'Absage: ' : first ? 'Neuer Zeitpunkt: ' : '') + 'Besichtigung für Ihre Reinigungsofferte am ' + when + ' · Clean Service Scaramuzzo AG' : (method === 'CANCEL' ? 'Abgesagt: ' : (first ? 'Aktualisiert: ' : '')) + (b.summary || 'Besichtigung');
      let text = kunde
        ? (method === 'CANCEL'
          ? `${b.greeting || 'Sehr geehrte Damen und Herren'}\n\nDer Besichtigungstermin vom ${when}${where} muss leider entfallen. Der Termin wird aus Ihrem Kalender entfernt. Wir melden uns bei Ihnen, um gemeinsam einen neuen Zeitpunkt zu finden, und danken Ihnen für Ihr Verständnis.\n\nFür Rückfragen erreichen Sie uns jederzeit unter 0844 355 355.\n\nFreundliche Grüsse`
          : `${b.greeting || 'Sehr geehrte Damen und Herren'}\n\n${first ? 'Der Besichtigungstermin wurde angepasst. Der neue Zeitpunkt ist' : 'Gerne bestätigen wir Ihnen den Besichtigungstermin am'} ${when}${where}.${b.seller ? ` ${b.seller} wird Sie vor Ort besuchen` : ' Unser Verkäufer wird Sie vor Ort besuchen'} und mit Ihnen den Umfang der Unterhaltsreinigung klären, damit wir Ihnen anschliessend eine massgeschneiderte Offerte erstellen können.\n\nDie Einladung hängt als Kalenderdatei an. Mit einem Klick darauf wird der Termin in Ihren Kalender übernommen. Sollte der Termin nicht passen, erreichen Sie uns unter 0844 355 355.\n\nFreundliche Grüsse`)
        : b.kind === 'einfuehrung'
        ? (method === 'CANCEL' ? `Die Einführung am ${when} (${b.summary || ''}) wurde abgesagt. Der Termin wird aus deinem Kalender entfernt.`
          : `${first ? 'Der Termin wurde angepasst.' : 'Es wurde eine neue Einführung für dich eingetragen.'} ${b.summary || ''} am ${when}${where}.\n\nDie Einladung hängt als Kalenderdatei an. Mit einem Klick darauf wird der Termin in deinen Kalender übernommen.${b.description ? '\n\n' + b.description : ''}`)
        : (method === 'CANCEL' ? `Die Besichtigung am ${when} (${b.summary || ''}) wurde abgesagt. Der Termin wird aus deinem Kalender entfernt.`
          : `${first ? 'Der Termin wurde angepasst.' : 'Es wurde eine neue Besichtigung für dich eingetragen.'} ${b.summary || ''} am ${when}${where}.\n\nDie Einladung hängt als Kalenderdatei an. Mit einem Klick darauf wird der Termin in deinen Kalender übernommen.${b.description ? '\n\n' + b.description : ''}`);
      if (direct) text = text.replace('Die Einladung hängt als Kalenderdatei an. Mit einem Klick darauf wird der Termin in deinen Kalender übernommen.', 'Der Termin ist bereits in deinem Outlook-Kalender eingetragen.').replace('Der Termin wird aus deinem Kalender entfernt.', 'Der Termin wurde aus deinem Outlook-Kalender entfernt.');
      ids.push(await sendMail({ to, subject, text, kind: (kunde ? 'cal-kunde-' : direct ? 'cal-direkt-' : 'cal-') + method.toLowerCase(), objectId: b.objectId || b.uid, attachments: direct ? [] : [{ filename: (b.kind === 'einfuehrung' ? 'Einfuehrung' : 'Besichtigung') + '.ics', content: Buffer.from(cal).toString('base64'), content_type: 'text/calendar; charset=UTF-8; method=' + method }] }));
    }
    res.status(200).json({ ok: true, ids, kalender: rec.length });
  } catch (e) { res.status(502).json({ error: String(e.message) }); }
};
module.exports.calDirect = calDirect;

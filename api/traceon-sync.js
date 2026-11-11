// Traceon-Anbindung Dispotool Spezialreinigung · Clean Service Scaramuzzo AG
// Holt die GPS-Dateien vom Traceon-FTPS-Server, speichert die Positionen in Supabase
// und löscht die übertragenen Dateien auf dem Server (Wunsch von Traceon).
// Zugangsdaten kommen ausschliesslich aus Umgebungsvariablen.
//
//   GET /api/traceon-sync            → Abgleich (alle 5 Min. durch den Supabase-Zeitplan)
//   GET /api/traceon-sync?test=1     → Verbindungstest ohne Speichern und ohne Löschen
//
// Jeder Aufruf braucht den Header «Authorization: Bearer <CRON_SECRET>»
// oder (nur für den Test im Browser) ?key=<CRON_SECRET>.
//
// Dateiformat GPS_JJJJMMTTHHMM.json (Stand 11.11.2026):
//   [{"HirotID":5209,"Numberplate":"CSSA-Nr.41 / SH 52 620","DriverName":"…",
//     "Timestamp":"2026-11-11 14:15:05","Longitude":"8.749","Latitude":"47.679",
//     "Distance":"517.0","Speed":"84"}, …]
// Triplog_JJJJMMTT.json (Fahrten des Vortages) bleibt liegen, bis das Format bekannt ist.

const ftp = require('basic-ftp');
const { Writable } = require('stream');

const ENV = k => (process.env[k] || '').trim();
const PRO_LAUF = () => Math.max(1, +ENV('TRACEON_DATEIEN_PRO_LAUF') || 25);
const LOESCHEN = () => ENV('TRACEON_LOESCHEN') !== '0';
const MIN_ABSTAND_S = 60; // pro Fahrzeug höchstens ein Punkt pro Minute speichern

function erlaubteFahrzeuge() {
  const l = ENV('TRACEON_FAHRZEUGE').split(/[\s,;]+/).map(x => parseInt(x, 10)).filter(Number.isFinite);
  return l.length ? new Set(l) : null; // leer = alle Fahrzeuge
}

function verbinden() {
  const c = new ftp.Client(25000);
  const implizit = ENV('TRACEON_FTPS_IMPLICIT') === '1';
  return c.access({
    host: ENV('TRACEON_FTPS_HOST'),
    port: +ENV('TRACEON_FTPS_PORT') || (implizit ? 990 : 21),
    user: ENV('TRACEON_FTPS_USER'),
    password: ENV('TRACEON_FTPS_PASSWORD'),
    secure: implizit ? 'implicit' : true,
    secureOptions: { rejectUnauthorized: ENV('TRACEON_TLS_STRICT') !== '0' }
  }).then(() => c);
}

async function lesen(client, name) {
  const teile = [];
  const ziel = new Writable({ write(chunk, _e, cb) { teile.push(chunk); cb(); } });
  await client.downloadTo(ziel, name);
  return Buffer.concat(teile).toString('utf8');
}

// Traceon liefert Schweizer Ortszeit ohne Zeitzone → in UTC umrechnen
function zeitIso(v) {
  if (!v) return null;
  const s = String(v).trim().replace(' ', 'T');
  const d = new Date(s + 'Z'); if (isNaN(d)) return null;
  const off = new Date(d.toLocaleString('en-US', { timeZone: 'Europe/Zurich' })) - new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(d.getTime() - off).toISOString();
}
const zahl = v => { const n = parseFloat(String(v ?? '').replace(',', '.').trim()); return Number.isFinite(n) ? n : null; };

// «CSSA-Nr.41 / SH 52 620» → { nr: 41, kennzeichen: 'SH 52 620' }
function fahrzeug(numberplate) {
  const t = String(numberplate || '');
  const m = t.match(/Nr\.?\s*(\d+)/i);
  const kz = t.includes('/') ? t.split('/').pop().trim() : t.trim();
  return { nr: m ? parseInt(m[1], 10) : null, kennzeichen: kz || null };
}

// GPS-Datei → Positionen (ohne Fahrernamen, ausgedünnt auf 1 Punkt pro Minute und Fahrzeug)
function gpsPositionen(text, datei, erlaubt) {
  const roh = JSON.parse(text);
  const L = (Array.isArray(roh) ? roh : []).map(o => {
    const f = fahrzeug(o.Numberplate);
    return {
      fahrzeug_nr: f.nr, kennzeichen: f.kennzeichen,
      geraet: o.HirotID != null ? String(o.HirotID) : null,
      zeit: zeitIso(o.Timestamp), lat: zahl(o.Latitude), lng: zahl(o.Longitude),
      tempo: zahl(o.Speed), datei
    };
  }).filter(p => p.fahrzeug_nr != null && p.zeit && p.lat != null && p.lng != null && (!erlaubt || erlaubt.has(p.fahrzeug_nr)))
    .sort((a, b) => a.fahrzeug_nr - b.fahrzeug_nr || a.zeit.localeCompare(b.zeit));
  const out = [];
  for (let i = 0; i < L.length; i++) {
    const p = L[i], prev = out[out.length - 1], next = L[i + 1];
    const letzterDesFahrzeugs = !next || next.fahrzeug_nr !== p.fahrzeug_nr;
    const neuesFahrzeug = !prev || prev.fahrzeug_nr !== p.fahrzeug_nr;
    if (neuesFahrzeug || letzterDesFahrzeugs || (Date.parse(p.zeit) - Date.parse(prev.zeit)) / 1000 >= MIN_ABSTAND_S) {
      if (prev && prev.fahrzeug_nr === p.fahrzeug_nr && prev.zeit === p.zeit) continue;
      out.push(p);
    }
  }
  return out;
}

async function sb(pfad, opt = {}) {
  const r = await fetch(ENV('SUPABASE_URL').replace(/\/$/, '') + '/rest/v1/' + pfad, {
    ...opt,
    headers: {
      apikey: ENV('SUPABASE_SERVICE_KEY'), Authorization: 'Bearer ' + ENV('SUPABASE_SERVICE_KEY'),
      'Content-Type': 'application/json', ...(opt.headers || {})
    }
  });
  if (!r.ok) throw new Error('Supabase ' + r.status + ': ' + (await r.text()).slice(0, 300));
  return r.status === 204 || r.status === 201 ? null : r.json().catch(() => null);
}

module.exports = async (req, res) => {
  const fehlt = ['TRACEON_FTPS_HOST', 'TRACEON_FTPS_USER', 'TRACEON_FTPS_PASSWORD', 'CRON_SECRET'].filter(k => !ENV(k));
  if (fehlt.length) return res.status(500).json({ ok: false, fehler: 'Umgebungsvariablen fehlen: ' + fehlt.join(', ') });
  const q = req.query || {};
  const auth = req.headers.authorization || '';
  if (auth !== 'Bearer ' + ENV('CRON_SECRET') && !(q.test && q.key === ENV('CRON_SECRET')))
    return res.status(401).json({ ok: false, fehler: 'Nicht berechtigt' });

  const erlaubt = erlaubteFahrzeuge();
  let client;
  try {
    client = await verbinden();
    const alle = (await client.list()).filter(f => f.isFile);
    const gps = alle.filter(f => /^GPS_\d+\.json$/i.test(f.name)).sort((a, b) => b.name.localeCompare(a.name)); // neueste zuerst
    const trip = alle.filter(f => /^Triplog_\d+\.json$/i.test(f.name)).sort((a, b) => b.name.localeCompare(a.name));

    if (q.test) {
      const neu = gps[0];
      const text = neu ? await lesen(client, neu.name) : '';
      let erkannt = [];
      try { erkannt = gpsPositionen(text, neu && neu.name, erlaubt); } catch (e) { erkannt = ['Nicht lesbar: ' + e.message]; }
      const proFz = {};
      erkannt.forEach(p => { if (p.fahrzeug_nr != null) proFz['Nr. ' + p.fahrzeug_nr + ' · ' + p.kennzeichen] = p.zeit; });
      return res.status(200).json({
        ok: true, gpsDateien: gps.length, triplogDateien: trip.length,
        neuesteGps: neu ? neu.name : null, neuesterTriplog: trip[0] ? trip[0].name : null,
        fahrzeugeInNeusterDatei: proFz, beispiel: erkannt.slice(0, 3)
      });
    }

    const bekannt = new Set(((await sb('traceon_dateien?select=name')) || []).map(d => d.name));
    let verarbeitet = 0, gespeichert = 0, geloescht = 0;
    for (const f of gps.slice(0, PRO_LAUF())) {
      if (!bekannt.has(f.name)) {
        const P = gpsPositionen(await lesen(client, f.name), f.name, erlaubt);
        for (let i = 0; i < P.length; i += 500)
          await sb('fahrzeug_positionen?on_conflict=fahrzeug_nr,zeit', {
            method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
            body: JSON.stringify(P.slice(i, i + 500))
          });
        await sb('traceon_dateien?on_conflict=name', {
          method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify([{ name: f.name, eintraege: P.length, verarbeitet: new Date().toISOString() }])
        });
        verarbeitet++; gespeichert += P.length;
      }
      // Erst löschen, wenn die Datei sicher in Supabase steht
      if (LOESCHEN()) { await client.remove(f.name); geloescht++; }
    }
    return res.status(200).json({
      ok: true, verarbeitet, gespeichert, geloescht,
      gpsNochOffen: Math.max(0, gps.length - PRO_LAUF()), triplogWartet: trip.length
    });
  } catch (e) {
    const pw = ENV('TRACEON_FTPS_PASSWORD');
    return res.status(502).json({ ok: false, fehler: String(e.message || e).split(pw || '\u0000').join('***') });
  } finally {
    if (client) client.close();
  }
};

module.exports._intern = { gpsPositionen, zeitIso, fahrzeug };

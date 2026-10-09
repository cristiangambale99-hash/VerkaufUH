const { E } = require('./_lib');

const URL_ = () => String(E.STELLEN_URL || '').replace(/\/+$/, '').replace(/^(?!https?:\/\/)(?=.)/, 'https://');
const SECRET = () => E.STELLEN_SECRET || E.PORTAL_SECRET || '';
const clip = (s, n) => String(s || '').trim().slice(0, n);

module.exports = async (b, res) => {
  try {
    if (!URL_()) return res.status(200).json({ ok: false, error: 'STELLEN_URL fehlt in Vercel (Adresse des Stellenportals)' });

    if (b.action === 'test') {
      // GET auf den Endpunkt legt nichts an: 405 bedeutet «erreichbar und bereit»
      const r = await fetch(URL_() + '/api/kunde-anlegen', { method: 'GET' });
      const ok = r.status === 405;
      return res.status(200).json({
        ok,
        secret: !!SECRET(),
        error: ok ? (SECRET() ? undefined : 'STELLEN_SECRET fehlt in Vercel') : (r.status === 404 ? 'Endpunkt /api/kunde-anlegen nicht gefunden' : 'Stellenportal antwortet mit Status ' + r.status),
      });
    }

    if (b.action === 'create') {
      const firma = clip(b.kundenname, 120);
      if (!firma) return res.status(200).json({ ok: false, error: 'Kundenname fehlt' });
      const payload = {
        dept: 'UH',
        kundenname: firma,
        adresse: clip(b.adresse, 200),
        plzOrt: clip(b.plzOrt, 120),
        turnus: clip(b.turnus, 40) || '1x pro Woche',
        schedule: (Array.isArray(b.schedule) ? b.schedule : []).slice(0, 7).map(x => ({ day: clip(x.day, 10), hours: clip(x.hours, 30), time: clip(x.time, 40) })),
        info: clip(b.info, 600),
        angebotsnr: clip(b.nr, 40),
      };
      const r = await fetch(URL_() + '/api/kunde-anlegen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-portal-schluessel': SECRET() },
        body: JSON.stringify(payload),
      });
      const text = await r.text();
      let j = null; try { j = JSON.parse(text); } catch (e) {}
      if (!r.ok || !j || !j.ok) {
        const why = r.status === 401 ? 'Das Stellenportal lehnt den Schlüssel ab (STELLEN_SECRET stimmt nicht mit PORTAL_SECRET überein)'
          : (j && j.error) || ('Status ' + r.status + ': ' + text.replace(/\s+/g, ' ').slice(0, 200));
        return res.status(200).json({ ok: false, error: why });
      }
      return res.status(200).json({ ok: true, id: j.id, dept: j.dept || 'UH', region: j.region, regionErmittelt: j.regionErmittelt, plzErkannt: j.plzErkannt, turnus: j.turnus, tage: j.tage, beekeeper: j.beekeeper });
    }

    return res.status(200).json({ ok: false, error: 'Unbekannte Aktion' });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String((e && e.message) || e) });
  }
};

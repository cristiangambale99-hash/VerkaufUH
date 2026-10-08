const { guard, body, E } = require('./_lib');
const O = require('./_ordner');

const KEY = () => E.QRFY_API_KEY || E.API_KEY || E['API:KEY'] || '';
const HOST = () => (E.QRFY_BASE ? E.QRFY_BASE.replace(/\/$/, '') : 'https://qrfy.com');

async function call(method, p, payload) {
  const headers = { 'API-KEY': KEY(), Accept: 'application/json, image/*' };
  if (payload) headers['Content-Type'] = 'application/json';
  const r = await fetch(HOST() + p, { method, headers, body: payload ? JSON.stringify(payload) : undefined });
  const ct = r.headers.get('content-type') || '';
  if (/^image\//.test(ct)) return { status: r.status, ct, buf: Buffer.from(await r.arrayBuffer()) };
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) {}
  return { status: r.status, ct, text, json };
}

const short = (r) => (r.buf ? '[Bild ' + r.buf.length + ' Bytes]' : String(r.text || '').slice(0, 300));

module.exports = async (req, res) => {
  const g = await guard(req, res);
  if (!g) return;
  const b = await body(req);
  try {
    if (!KEY()) return res.status(200).json({ ok: false, error: 'Kein qrfy-Schlüssel in Vercel hinterlegt (QRFY_API_KEY)' });

    if (b.action === 'test') {
      const r = await call('GET', '/api/public/qrs?page=1');
      const ok = r.status >= 200 && r.status < 300;
      return res.status(200).json({
        ok,
        error: ok ? undefined : (r.status === 401 || r.status === 403 ? 'qrfy lehnt den Schlüssel ab' : 'qrfy antwortet mit Status ' + r.status),
        results: [{ host: HOST(), status: r.status, antwort: short(r) }],
      });
    }

    if (b.action === 'create') {
      const nr = String(b.nr || '').trim();
      const firma = String(b.firma || '').trim();
      if (!nr || !firma) return res.status(200).json({ ok: false, error: 'Offertnummer und Firma fehlen' });
      const name = (firma + ' – ' + nr).slice(0, 100);
      const url = O.urlOf(nr);
      const r = await call('POST', '/api/public/qrs', { qrs: [{ type: 'url', name, data: { url } }] });
      const versuche = [{ host: HOST(), form: 'url', status: r.status, antwort: short(r) }];
      if (r.status === 401 || r.status === 403) return res.status(200).json({ ok: false, error: 'qrfy lehnt den Schlüssel ab', versuche });
      const id = r.json && Array.isArray(r.json.ids) ? r.json.ids[0] : null;
      if (!(r.status >= 200 && r.status < 300) || id == null) return res.status(200).json({ ok: false, error: 'qrfy hat keinen QR-Code angelegt (Status ' + r.status + ')', versuche });
      let image = false;
      try {
        const im = await call('GET', '/api/public/qrs/' + id + '/png');
        if (im.buf && im.buf.length > 200) {
          await O.putAsset('ordner-qr-' + nr, im.ct, im.buf);
          image = true;
        }
      } catch (e) {}
      return res.status(200).json({ ok: true, qrId: id, name, host: HOST(), form: 'url', image, antwort: short(r) });
    }

    return res.status(200).json({ ok: false, error: 'Unbekannte Aktion' });
  } catch (e) {
    return res.status(200).json({ ok: false, error: 'Fehler: ' + (e && e.message) });
  }
};

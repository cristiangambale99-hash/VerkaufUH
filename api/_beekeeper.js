const { E, rpc, assetBytes } = require('./_lib');
const O = require('./_ordner');

const TOKEN = () => E.BEEKEEPER_TOKEN || E.BEEKEEPER_API_TOKEN || '';
const BASE = () => String(E.BEEKEEPER_URL || '').replace(/\/+$/, '').replace(/^(?!https?:\/\/)/, 'https://');
const MEMBERS = () => String(E.BEEKEEPER_MEMBERS || '').split(/[\s,;]+/).filter(Boolean);
const LANGS = ['de', 'en', 'it', 'es', 'pt'];
const LANGNAME = { de: 'Deutsch', en: 'English', it: 'Italiano', es: 'Español', pt: 'Português' };

async function call(method, path, opt = {}) {
  const headers = { Authorization: 'Token ' + TOKEN(), Accept: /^\/api\/2\/chats/.test(path) ? 'application/json, application/vnd.io.beekeeper.chats+json;version=1' : 'application/json' };
  let body;
  if (opt.json) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opt.json); }
  if (opt.form) body = opt.form;
  const r = await fetch(BASE() + path, { method, headers, body });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch (e) {}
  return { status: r.status, ok: r.status >= 200 && r.status < 300, text, json };
}
const short = r => String(r.text || '').replace(/\s+/g, ' ').slice(0, 300);
const fail = (res, error, extra) => res.status(200).json(Object.assign({ ok: false, error }, extra || {}));

async function uploadPdf(name, buf) {
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: 'application/pdf' }), name);
  return call('POST', '/api/2/files', { form: fd });
}

module.exports = async (b, res) => {
  try {
    if (!TOKEN()) return fail(res, 'Kein Beekeeper-Token in Vercel hinterlegt (BEEKEEPER_TOKEN)');
    if (!E.BEEKEEPER_URL) return fail(res, 'Keine Beekeeper-Adresse in Vercel hinterlegt (BEEKEEPER_URL, z. B. https://firma.beekeeper.io)');
    const act = b.action;

    if (act === 'test') {
      const r = await call('GET', '/api/2/users?limit=1');
      const isJson = r.json !== null;
      if (r.ok && !isJson) return res.status(200).json({ ok: false, members: MEMBERS().length, error: 'BEEKEEPER_URL ist falsch: die Adresse liefert eine Webseite statt der API. Richtig ist https://clean-service.ch.beekeeper.io', status: r.status, antwort: short(r) });
      return res.status(200).json({ ok: r.ok, members: MEMBERS().length, error: r.ok ? undefined : (r.status === 401 || r.status === 403 ? 'Beekeeper lehnt den Token ab' : 'Beekeeper antwortet mit Status ' + r.status), status: r.status, antwort: short(r) });
    }

    if (act === 'users') {
      const r = await call('GET', '/api/2/users?limit=200');
      if (!r.ok) return fail(res, 'Benutzerliste nicht lesbar (Status ' + r.status + ')', { antwort: short(r) });
      const arr = Array.isArray(r.json) ? r.json : (r.json && (r.json.users || r.json.items || r.json.results || r.json.data)) || [];
      const q = String(b.q || '').toLowerCase();
      const list = arr.map(u => ({ id: u.id || u.user_id || u.userid, name: [u.firstname || u.first_name, u.lastname || u.last_name].filter(Boolean).join(' ') || u.name || u.display_name || '', username: u.username || u.email || '' })).filter(u => u.id && (!q || (u.name + ' ' + u.username).toLowerCase().includes(q)));
      return res.status(200).json({ ok: true, users: list.slice(0, 50) });
    }

    if (act === 'upload') {
      const nr = O.safeNr(b.nr), lang = String(b.lang || '');
      if (!nr || !LANGS.includes(lang)) return fail(res, 'Angaben fehlen');
      await rpc('api_asset_put', { p_name: 'bk-lv-' + nr + '-' + lang, p_ctype: 'application/pdf', p_idx: +b.idx || 0, p_total: +b.total || 1, p_b64: b.b64 });
      return res.status(200).json({ ok: true });
    }

    if (act === 'chat') {
      const nr = O.safeNr(b.nr), firma = String(b.firma || '').trim();
      if (!nr || !firma) return fail(res, 'Offertnummer und Firma fehlen');
      const mem = MEMBERS();
      if (!mem.length) return fail(res, 'Keine Chat-Mitglieder hinterlegt (BEEKEEPER_MEMBERS in Vercel: Benutzer-IDs, durch Komma getrennt)');
      const title = (firma + ' – ' + nr).slice(0, 100);
      const desc = String(b.objekt || '').slice(0, 300);
      const c = await call('POST', '/api/2/chats/groups', { json: { title, description: desc || undefined, members: mem.map(id => ({ user_id: id, role: 'ADMIN' })) } });
      // Antwortform von Beekeeper ist nicht fest: Chat-ID in gängigen Feldern und verschachtelt suchen
      const findId = (j, d = 0) => {
        if (!j || typeof j !== 'object' || d > 3) return null;
        for (const k of ['id', 'chat_id', 'chatId', 'conversation_id', 'group_id', 'groupId']) if (j[k] != null && j[k] !== '' && typeof j[k] !== 'object') return j[k];
        for (const k of ['chat', 'group', 'conversation', 'data', 'result', 'item']) { const r = findId(j[k], d + 1); if (r != null) return r; }
        return null;
      };
      const chatId = findId(c.json);
      if (c.ok && c.json === null) return fail(res, 'BEEKEEPER_URL ist falsch: Beekeeper liefert eine Webseite statt der API. Richtig ist https://clean-service.ch.beekeeper.io');
      if (!c.ok || !chatId) return fail(res, 'Gruppenchat konnte nicht erstellt werden (Status ' + c.status + '): ' + short(c), { antwort: short(c) });
      const sent = [], errors = [];
      const intro = String(b.text || '').slice(0, 2000);
      if (intro) { const m = await call('POST', '/api/2/chats/groups/' + encodeURIComponent(chatId) + '/messages', { json: { body: intro } }); if (!m.ok) errors.push('Begrüssung: ' + m.status + ' ' + short(m)); }
      for (const lang of LANGS) {
        const a = await assetBytes('bk-lv-' + nr + '-' + lang);
        if (!a) { errors.push(lang + ': PDF fehlt'); continue; }
        const fname = 'Leistungsverzeichnis_' + nr + '_' + lang.toUpperCase() + '.pdf';
        const u = await uploadPdf(fname, a.buf);
        if (!u.ok || !u.json) { errors.push(lang + ': Upload ' + u.status + ' ' + short(u)); continue; }
        const m = await call('POST', '/api/2/chats/groups/' + encodeURIComponent(chatId) + '/messages', { json: { body: 'Leistungsverzeichnis ' + LANGNAME[lang], attachment: u.json } });
        if (m.ok) sent.push(lang); else errors.push(lang + ': Nachricht ' + m.status + ' ' + short(m));
      }
      return res.status(200).json({ ok: true, chatId, title, sent, errors, partial: errors.length > 0 });
    }

    return fail(res, 'Unbekannte Aktion');
  } catch (e) { return fail(res, 'Fehler: ' + (e && e.message)); }
};

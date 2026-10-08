const crypto = require('crypto');
const E = process.env;
const SB = () => E.SUPABASE_URL + '/rest/v1/rpc/';
async function rpc(fn, args) {
  const r = await fetch(SB() + fn, { method: 'POST', headers: { apikey: E.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + E.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_secret: E.DB_SECRET, ...args }) });
  const t = await r.text();
  if (!r.ok) throw new Error('db ' + fn + ' ' + r.status + ' ' + t.slice(0, 200));
  return t ? JSON.parse(t) : null;
}
const b64u = b => Buffer.from(b).toString('base64url');
const sign = s => crypto.createHmac('sha256', E.SESSION_SECRET).update(s).digest('base64url');
function makeToken(days = 30) { const p = b64u(JSON.stringify({ exp: Date.now() + days * 864e5 })); return { token: p + '.' + sign(p), exp: Date.now() + days * 864e5 }; }
function okToken(tok) {
  if (!tok || !tok.includes('.')) return false; const [p, s] = tok.split('.');
  const a = Buffer.from(sign(p)), b = Buffer.from(s || ''); if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try { return JSON.parse(Buffer.from(p, 'base64url').toString()).exp > Date.now(); } catch (e) { return false; }
}
const bearer = req => (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
function guard(req, res) { if (okToken(bearer(req))) return true; res.status(401).json({ error: 'Nicht angemeldet' }); return false; }
async function body(req) { if (req.body && typeof req.body === 'object') return req.body; try { return JSON.parse(req.body || '{}'); } catch (e) { return {}; } }
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
async function settings() { const d = await rpc('api_docs_since', { p_since: '1970-01-01T00:00:00Z' }); const x = d.find(r => r.path === 'config/settings' && !r.deleted); return x ? x.data : {}; }
function sigHtml(S, iso, lang) {
  const n = S.mailSigName || 'Diogo Pereira', f = lang === 'en' ? (S.mailSigRolleEn || (!S.mailSigRolle || S.mailSigRolle === 'Sachbearbeiter Innendienst' ? 'Office Administration' : S.mailSigRolle)) : (S.mailSigRolle || 'Sachbearbeiter Innendienst'), d = S.mailSigDirekt || '052 557 02 12';
  return `<div style="font-family:Verdana,Arial,sans-serif;font-size:14px;line-height:1.5;color:#555;margin-top:22px"><div style="color:#4fb3a5">${esc(n)}</div>${esc(f)}<br>${lang === 'en' ? 'Direct' : 'Direkt'} ${esc(d)}<br>---------------------------------<br><div style="color:#4fb3a5">Clean Service Scaramuzzo AG</div>Industriestrasse 5<br>8307 Effretikon<br>0844 355 355<div style="margin-top:14px"><img src="${iso}" alt="ISO 9001, 14001, 45001" width="172" height="52" style="display:block;border:0"></div></div>`;
}
function sigText(S, lang) { return `\n\n${S.mailSigName || 'Diogo Pereira'}\n${lang === 'en' ? (S.mailSigRolleEn || (!S.mailSigRolle || S.mailSigRolle === 'Sachbearbeiter Innendienst' ? 'Office Administration' : S.mailSigRolle)) : (S.mailSigRolle || 'Sachbearbeiter Innendienst')}\n${lang === 'en' ? 'Direct' : 'Direkt'} ${S.mailSigDirekt || '052 557 02 12'}\n\nClean Service Scaramuzzo AG\nIndustriestrasse 5\n8307 Effretikon\n0844 355 355`; }
async function sendMail({ to, subject, text, attachments, kind, objectId, S, lang }) {
  S = S || await settings();
  const base = E.PUBLIC_URL || 'https://offertplattform-uh.vercel.app';
  const MDL = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  const lnk = p => esc(p).replace(MDL, (m, t, u) => `<a href="${u}" style="color:#1f6f8b;text-decoration:underline">${t}</a>`).replace(/\n/g, '<br>');
  let iso = base + '/asset/iso.png', inl = null;
  try { const a = await assetBytes('iso.png'); if (a) { inl = { filename: 'iso.png', content: a.b64, content_type: 'image/png', content_id: 'iso-zertifikate' }; iso = 'cid:iso-zertifikate'; } } catch (e) {}
  const html = `<div style="font-family:Verdana,Arial,sans-serif;font-size:14px;line-height:1.6;color:#222">${String(text).split(/\n{2,}/).map(p => `<p style="margin:0 0 14px">${lnk(p)}</p>`).join('')}${sigHtml(S, iso, lang)}</div>`;
  const plain = String(text).replace(MDL, '$1: $2');
  const k = String(kind || ''), copy = /^cal/.test(k) ? S.bccBes !== 'nein' : /^(nf\d|re6)/.test(k) ? S.bccNach !== 'nein' : true;
  const payload = { from: E.MAIL_FROM, to: [to], reply_to: E.MAIL_REPLY_TO, subject, html, text: plain + sigText(S, lang) };
  if (copy) payload.bcc = [E.MAIL_REPLY_TO];
  const att = (attachments && attachments.length ? attachments.slice() : []); if (inl) att.push(inl);
  if (att.length) payload.attachments = att;
  let id = null, status = 'ok', err = null;
  try {
    const r = await fetch((E.RESEND_URL || 'https://api.resend.com') + '/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + E.RESEND_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const j = await r.json().catch(() => ({})); if (!r.ok) { status = 'fehler'; err = j.message || ('HTTP ' + r.status); } else id = j.id;
  } catch (e) { status = 'fehler'; err = String(e.message || e); }
  try { await rpc('api_mail_log', { p_kind: kind || '', p_object: objectId || '', p_to: to, p_subject: subject, p_resend: id, p_status: status, p_error: err }); } catch (e) {}
  if (status !== 'ok') throw new Error(err);
  return id;
}
async function assetBytes(name) {
  const r = await rpc('api_asset_get', { p_name: name }); if (!r || !r.length || !r[0].b64) return null;
  return { ctype: r[0].ctype, buf: Buffer.from(r[0].b64, 'base64'), b64: r[0].b64 };
}
module.exports = { rpc, makeToken, okToken, bearer, guard, body, sendMail, settings, assetBytes, E };

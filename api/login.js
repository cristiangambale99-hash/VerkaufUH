const { makeToken, body, E } = require('./_lib');
const crypto = require('crypto');
const fails = new Map();
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x', now = Date.now();
  const f = (fails.get(ip) || []).filter(t => now - t < 10 * 60 * 1000);
  if (f.length >= 6) return res.status(429).json({ error: 'Zu viele Versuche. Bitte in 10 Minuten erneut versuchen.' });
  const { code } = await body(req); const a = Buffer.from(String(code || '').trim().toLowerCase()), b = Buffer.from(String(E.APP_CODE).toLowerCase());
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) { f.push(now); fails.set(ip, f); await new Promise(r => setTimeout(r, 700)); return res.status(401).json({ error: 'Zugangscode falsch' }); }
  fails.delete(ip);
  res.status(200).json(makeToken(30));
};

const { assetBytes, okToken, bearer } = require('./_lib');
const PUBLIC = ['app.html', 'iso.png'];
module.exports = async (req, res) => {
  const n = String(req.query.n || '');
  if (!PUBLIC.includes(n) && !okToken(bearer(req))) return res.status(401).end();
  try {
    const a = await assetBytes(n); if (!a) return res.status(404).end();
    res.setHeader('Content-Type', a.ctype); res.setHeader('Cache-Control', n === 'app.html' ? 'no-cache' : 'public, max-age=86400');
    res.status(200).send(a.buf);
  } catch (e) { res.status(500).end(String(e.message)); }
};

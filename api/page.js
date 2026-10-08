const fs = require('fs'), path = require('path');
const { assetBytes } = require('./_lib');
// Die App liegt im Repository (app/app.html). Fallback: Datenbank (Upload-Weg).
module.exports = async (req, res) => {
  try {
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-cache');
    for (const p of [path.join(process.cwd(), 'app', 'app.html'), path.join(__dirname, '..', 'app', 'app.html')]) {
      if (fs.existsSync(p)) return res.status(200).send(fs.readFileSync(p));
    }
    const a = await assetBytes('app.html');
    if (!a) return res.status(200).end('<meta charset="utf-8"><p style="font:16px sans-serif;padding:40px">Die App wird gerade eingerichtet.</p>');
    res.status(200).send(a.buf);
  } catch (e) { res.status(500).end('Fehler: ' + e.message); }
};

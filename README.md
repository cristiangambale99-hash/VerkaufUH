# Offertplattform Unterhaltsreinigung – Clean Service Scaramuzzo AG

- `app/app.html` – die App (Frontend, eine Datei)
- `api/*.js` – Server (Login, Datenbank, Mail, Kalender, Nachfass-Cron)
- `public/upload.html` – alter Upload-Weg (nur mit UPLOAD_KEY)
- Geheimnisse (RESEND_API_KEY, SUPABASE_*, DB_SECRET, SESSION_SECRET, CRON_SECRET, UPLOAD_KEY, APP_CODE, MAIL_FROM, MAIL_REPLY_TO) liegen nur in Vercel > Settings > Environment Variables, nie im Repo.

Update: `app/app.html` ersetzen → Commit → Vercel deployt automatisch.

# Exam Trainer

A personal, offline-first study app for practising exam questions and memorising
verses. Pure static site — no backend, no build step. Your data lives in the
browser (`localStorage`), with optional Google Drive sync as a backup / cross-device
"source of truth".

- **Exams** — import/create question banks, practise full / weak-areas / custom sets,
  self-mark, and track attempt history.
- **Verses** — memorise verses with a graded first-letter typing trainer.
- **Installable PWA** — add to your home screen on Android/desktop and use it fully
  offline.

## Running locally

Service workers require `https://` or `localhost` (not `file://`):

```bash
python -m http.server 8000
# open http://localhost:8000/
```

## Deployment

Hosted on GitHub Pages. See **[DEPLOY.md](DEPLOY.md)** — including the important step
of bumping the service worker cache version on each release.

## Data: import / export / sync

- **Import JSON** — load one or more `.json` question files (see
  [import-format.md](import-format.md)).
- **Export** — save exams back out as `.json` (per exam), to Downloads or a chosen
  folder.
- **☁ Drive** — optional Google Drive sync (below). Backs up **everything** (exams,
  attempt history, verses, active selection) to a single JSON file in your Drive and
  restores it on any device. Manual import/export remains as the offline fallback.

## Google Drive sync (optional)

Drive sync is off until you configure it. It's a client-side OAuth flow appropriate
for a static site — there is no server and no secret.

### What it does

- Signs in with your Google account (Google Identity Services).
- Lets you pick a folder (Google Picker) and creates one backup file
  (`ExamTrainer-backup.json` by default), or re-link an existing one.
- **Back up to Drive** uploads your full local state; **Restore from Drive**
  downloads it and replaces local state.
- While online and signed in, local changes auto-sync to the linked file shortly
  after you make them; offline, everything stays in `localStorage` and syncs when you
  reconnect (and a token is available).

### One-time setup (your own free Google Cloud project)

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and create a
   project (or reuse one).
2. **APIs & Services → Library** — enable both:
   - **Google Drive API**
   - **Google Picker API**
3. **APIs & Services → OAuth consent screen** — configure it:
   - User type **External** is fine. Add yourself as a **Test user** (so you don't
     need Google verification for personal use).
   - Scope used by the app: `.../auth/drive.file` (per-file access only — the app can
     only see files it creates or you explicitly pick).
4. **APIs & Services → Credentials → Create credentials:**
   - **OAuth client ID** → type **Web application**. Under
     **Authorised JavaScript origins** add your site origin(s), e.g.
     `https://<username>.github.io` and `http://localhost:8000` for local testing.
     Copy the **Client ID**.
   - **API key** → copy it. Recommended: restrict it to the **Picker API** and to
     your site's HTTP referrers.
5. Open [`config.js`](config.js) and fill in:

   ```js
   window.DRIVE_CONFIG = {
     clientId: 'YOUR_CLIENT_ID.apps.googleusercontent.com',
     apiKey:   'YOUR_API_KEY',
     fileName: 'ExamTrainer-backup.json',
   };
   ```

6. Commit and deploy. Click **☁ Drive** in the app → **Sign in to Google** →
   **Back up to Drive**.

### Is it safe to commit the Client ID and API key?

Yes — for this kind of static, browser-only app these values are **public by
design**; the browser has to send them. Security comes from:

- the **Authorised JavaScript origins** allow-list on the OAuth client (tokens are
  only issued to your own site),
- the **OAuth consent screen** (only you / your test users can grant access),
- the minimal `drive.file` scope (no access to the rest of your Drive),
- restricting the **API key** to the Picker API + your referrer.

Never put a **client secret** or a service-account key in `config.js` — they aren't
needed for this flow.

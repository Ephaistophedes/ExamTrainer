# Deploying Exam Trainer

Exam Trainer is a fully static site (HTML/CSS/JS, no backend). It is hosted on
**GitHub Pages** and installs as a Progressive Web App (PWA) that works offline.

## One-time setup

1. Push this repository to GitHub (e.g. `https://github.com/Ephaistophedes/ExamTrainer`).
2. In the repo: **Settings → Pages**.
   - **Source:** `Deploy from a branch`
   - **Branch:** `main`  ·  **Folder:** `/ (root)`
3. Save. After a minute the app is live at:
   `https://<username>.github.io/ExamTrainer/`

> The site lives under the `/ExamTrainer/` subpath, so **all asset paths must stay
> relative** (`./app.js`, not `/app.js`). The service worker and manifest already
> use relative paths — keep it that way.

## Deploying an update

Just push to `main`:

```bash
git add -A
git commit -m "Describe the change"
git push
```

GitHub Pages redeploys automatically.

## ⚠️ Bump the service worker cache version on every release

Installed devices cache the app. The service worker serves **our own files
network-first**, so an online launch always runs the release that is live —
never the previous one. The cache is the offline fallback, not the default
source. Still **bump the cache version** before you push, so stale caches from
older releases are purged:

1. Open [`sw.js`](sw.js).
2. Change `CACHE_VERSION`, e.g. `'v1'` → `'v2'`.
3. Commit and push.

An online device picks the update up on its **next launch**. No manual reinstall
needed on the phone.

> Third-party assets (Google Fonts) stay stale-while-revalidate — they never
> change under us, so they should not hold up a launch.

### If a change doesn't appear

Confirm which build is actually running before digging into the code — a served
stale copy looks exactly like a broken feature. In DevTools → Console:
`caches.keys()` shows the live cache version. Hard-reload with
**Ctrl/Cmd + Shift + R**, or DevTools → Application → Service Workers →
*Unregister* for a clean slate.

## Local testing

Service workers need HTTPS or `localhost` (they do **not** run from `file://`).

```bash
# from the project root
python -m http.server 8000
# then open http://localhost:8000/
```

Use Chrome DevTools → **Application** tab to inspect the manifest, service worker,
and cache, and **Lighthouse** to check PWA installability.

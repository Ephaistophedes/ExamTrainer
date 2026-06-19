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

Installed phones cache the app. The service worker uses a
**stale-while-revalidate** strategy: a returning, online device fetches new files
in the background and applies them on the next launch. To guarantee old caches are
purged and the update is picked up cleanly, **bump the cache version** before you push:

1. Open [`sw.js`](sw.js).
2. Change `CACHE_VERSION`, e.g. `'v1'` → `'v2'`.
3. Commit and push.

On the next one or two launches (while online) the installed app updates itself and
reloads once automatically. No manual reinstall needed on the phone.

## Local testing

Service workers need HTTPS or `localhost` (they do **not** run from `file://`).

```bash
# from the project root
python -m http.server 8000
# then open http://localhost:8000/
```

Use Chrome DevTools → **Application** tab to inspect the manifest, service worker,
and cache, and **Lighthouse** to check PWA installability.

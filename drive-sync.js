/* ═══════════════════════════════════════════════════════
   Exam Trainer — Google Drive sync (optional)
   ───────────────────────────────────────────────────────
   Wraps: OAuth (Google Identity Services token flow),
   the Google Picker (visual file/folder selection), and
   Drive API v3 read/write of a single full-state backup
   JSON file that acts as the source of truth.

   The app data itself always lives in localStorage, so it
   works fully offline. This layer mirrors that state to one
   Drive file and pulls it back on demand. Manual JSON
   import/export remains as the offline fallback.
   ═══════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const CFG = window.DRIVE_CONFIG || {};
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';

  // Persisted sync metadata (NOT the app data — that lives under its own keys).
  const META = {
    fileId:   'et_drive_fileId',
    fileName: 'et_drive_fileName',
    dirty:    'et_drive_dirty',
    lastSync: 'et_drive_lastSync',
  };

  // In-memory token (GIS access tokens are short-lived and never persisted).
  let accessToken = null;
  let tokenExpiry = 0;
  let tokenClient = null;
  let gisReady = false;
  let pickerReady = false;
  let autoSyncTimer = null;

  /* ─── small helpers ──────────────────────────────────── */

  function isConfigured() {
    return !!(CFG.clientId && CFG.apiKey);
  }
  function getMeta(k) { return localStorage.getItem(META[k]) || null; }
  function setMeta(k, v) {
    if (v === null || v === undefined) localStorage.removeItem(META[k]);
    else localStorage.setItem(META[k], v);
  }
  function isOnline() { return navigator.onLine !== false; }
  function tokenValid() { return accessToken && Date.now() < tokenExpiry - 60000; }
  function isSignedIn() { return tokenValid(); }
  function isLinked() { return !!getMeta('fileId'); }

  function waitForGlobal(check, timeoutMs) {
    return new Promise(function (resolve, reject) {
      const start = Date.now();
      (function poll() {
        if (check()) return resolve();
        if (Date.now() - start > (timeoutMs || 10000)) return reject(new Error('timed out loading Google libraries'));
        setTimeout(poll, 100);
      })();
    });
  }

  /* ─── auth (Google Identity Services) ────────────────── */

  function initTokenClient() {
    if (tokenClient) return;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CFG.clientId,
      scope: SCOPE,
      callback: function () {}, // replaced per-request below
    });
    gisReady = true;
  }

  // Resolve once a valid access token is available.
  function ensureToken(interactive) {
    if (tokenValid()) return Promise.resolve(accessToken);
    if (!isConfigured()) return Promise.reject(new Error('Drive sync is not configured (see config.js).'));
    if (!isOnline()) return Promise.reject(new Error('You are offline.'));

    return waitForGlobal(function () { return window.google && google.accounts && google.accounts.oauth2; })
      .then(function () {
        initTokenClient();
        return new Promise(function (resolve, reject) {
          tokenClient.callback = function (resp) {
            if (resp && resp.error) return reject(new Error(resp.error));
            accessToken = resp.access_token;
            tokenExpiry = Date.now() + (resp.expires_in || 3600) * 1000;
            resolve(accessToken);
          };
          try {
            tokenClient.requestAccessToken({ prompt: interactive ? 'consent' : '' });
          } catch (e) { reject(e); }
        });
      });
  }

  function signIn() { return ensureToken(true); }

  function signOut() {
    return new Promise(function (resolve) {
      const tok = accessToken;
      accessToken = null;
      tokenExpiry = 0;
      if (tok && window.google && google.accounts && google.accounts.oauth2) {
        google.accounts.oauth2.revoke(tok, resolve);
      } else { resolve(); }
    });
  }

  /* ─── Google Picker ──────────────────────────────────── */

  function ensurePicker() {
    if (pickerReady) return Promise.resolve();
    return waitForGlobal(function () { return window.gapi; })
      .then(function () {
        return new Promise(function (resolve) {
          gapi.load('picker', { callback: function () { pickerReady = true; resolve(); } });
        });
      });
  }

  /**
   * Open the Picker.
   * mode 'file'   → choose an existing backup JSON (app-created files).
   * mode 'folder' → choose a folder to create the backup in.
   * Resolves with { id, name, isFolder } or null if cancelled.
   */
  function openPicker(mode) {
    return ensureToken(true).then(ensurePicker).then(function () {
      return new Promise(function (resolve, reject) {
        let view;
        if (mode === 'folder') {
          view = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
            .setSelectFolderEnabled(true)
            .setMimeTypes('application/vnd.google-apps.folder');
        } else {
          view = new google.picker.DocsView(google.picker.ViewId.DOCS)
            .setMimeTypes('application/json');
        }
        try {
          const picker = new google.picker.PickerBuilder()
            .setOAuthToken(accessToken)
            .setDeveloperKey(CFG.apiKey)
            .addView(view)
            .setCallback(function (data) {
              if (data.action === google.picker.Action.PICKED) {
                const doc = data.docs[0];
                resolve({ id: doc.id, name: doc.name, isFolder: doc.type === 'folder' });
              } else if (data.action === google.picker.Action.CANCEL) {
                resolve(null);
              }
            })
            .build();
          picker.setVisible(true);
        } catch (e) { reject(e); }
      });
    });
  }

  /* ─── Drive API v3 file read / write ─────────────────── */

  function authHeaders(extra) {
    const h = { Authorization: 'Bearer ' + accessToken };
    if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
    return h;
  }

  // Create a new JSON file (optionally inside folderId). Returns {id, name}.
  function createFile(name, content, folderId) {
    const boundary = '-------ExamTrainer' + Date.now();
    const delim = '\r\n--' + boundary + '\r\n';
    const close = '\r\n--' + boundary + '--';
    const metadata = { name: name, mimeType: 'application/json' };
    if (folderId) metadata.parents = [folderId];

    const body =
      delim + 'Content-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(metadata) +
      delim + 'Content-Type: application/json\r\n\r\n' + content + close;

    return fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'multipart/related; boundary=' + boundary }),
      body: body,
    }).then(handleJson);
  }

  // Overwrite the contents of an existing file. Returns {id, name}.
  function updateFile(id, content) {
    return fetch('https://www.googleapis.com/upload/drive/v3/files/' + encodeURIComponent(id) +
      '?uploadType=media&fields=id,name', {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: content,
    }).then(handleJson);
  }

  // Download file contents as text.
  function downloadFile(id) {
    return fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) + '?alt=media', {
      headers: authHeaders(),
    }).then(function (res) {
      if (!res.ok) return res.text().then(function (t) { throw new Error('Drive download failed: ' + res.status + ' ' + t); });
      return res.text();
    });
  }

  function handleJson(res) {
    if (!res.ok) return res.text().then(function (t) { throw new Error('Drive request failed: ' + res.status + ' ' + t); });
    return res.json();
  }

  /* ─── high-level sync operations ─────────────────────── */

  // Push local state up to Drive (create the file if not linked yet).
  function backup() {
    const snapshot = JSON.stringify(window.ExamTrainerState.export(), null, 2);
    let fileId = getMeta('fileId');

    return ensureToken(true).then(function () {
      if (fileId) {
        return updateFile(fileId, snapshot).catch(function (err) {
          // Linked file gone (deleted/unshared) → recreate.
          if (/40[34]/.test(err.message)) { setMeta('fileId', null); return backup(); }
          throw err;
        });
      }
      // Not linked: ask where to create it, then create.
      return openPicker('folder').then(function (folder) {
        const folderId = folder ? folder.id : null; // null → My Drive root
        return createFile(CFG.fileName || 'ExamTrainer-backup.json', snapshot, folderId);
      });
    }).then(function (file) {
      if (file && file.id) {
        setMeta('fileId', file.id);
        setMeta('fileName', file.name || CFG.fileName);
      }
      setMeta('dirty', '');
      setMeta('lastSync', new Date().toISOString());
      return file;
    });
  }

  // Pull state down from Drive (overwrites local — the file is source of truth).
  function restore() {
    return ensureToken(true).then(function () {
      let fileId = getMeta('fileId');
      if (fileId) return fileId;
      return openPicker('file').then(function (picked) {
        if (!picked) throw new Error('No file selected.');
        setMeta('fileId', picked.id);
        setMeta('fileName', picked.name);
        return picked.id;
      });
    }).then(downloadFile).then(function (text) {
      let parsed;
      try { parsed = JSON.parse(text); }
      catch (e) { throw new Error('The linked Drive file is not valid JSON.'); }
      const result = window.ExamTrainerState.import(parsed);
      if (!result.ok) throw new Error(result.error);
      setMeta('dirty', '');
      setMeta('lastSync', new Date().toISOString());
      return result;
    });
  }

  // Re-link to a different existing Drive backup file.
  function chooseFile() {
    return openPicker('file').then(function (picked) {
      if (!picked) return null;
      setMeta('fileId', picked.id);
      setMeta('fileName', picked.name);
      return picked;
    });
  }

  function unlink() {
    setMeta('fileId', null);
    setMeta('fileName', null);
    setMeta('dirty', '');
    setMeta('lastSync', null);
  }

  /* ─── change tracking + auto-sync ────────────────────── */

  // Called by app.js whenever local data changes.
  function markLocalChange() {
    if (!isLinked()) return;
    setMeta('dirty', '1');
    render();
    // If we can sync silently right now, debounce a push to Drive.
    if (isOnline() && isSignedIn()) {
      clearTimeout(autoSyncTimer);
      autoSyncTimer = setTimeout(function () {
        backup().then(render).catch(function (e) { console.warn('Auto-sync failed:', e); render(); });
      }, 4000);
    }
  }

  // When connectivity returns, flush pending local changes if we have a token.
  function onReconnect() {
    render();
    if (isLinked() && getMeta('dirty') && isSignedIn()) {
      backup().then(render).catch(function (e) { console.warn('Reconnect sync failed:', e); });
    }
  }

  /* ─── UI wiring ──────────────────────────────────────── */

  function $(id) { return document.getElementById(id); }

  function setStatus(msg, kind) {
    const el = $('drive-status');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'drive-status' + (kind ? ' drive-status-' + kind : '');
  }

  function render() {
    const linkedName = getMeta('fileName');
    const last = getMeta('lastSync');
    const dirty = !!getMeta('dirty');

    const fileEl = $('drive-file-name');
    if (fileEl) fileEl.textContent = isLinked() ? (linkedName || 'Linked file') : 'No file linked';

    const stateEl = $('drive-sync-state');
    if (stateEl) {
      if (!isLinked()) stateEl.textContent = '';
      else if (dirty) stateEl.textContent = 'Local changes not yet synced';
      else if (last) stateEl.textContent = 'Last synced ' + new Date(last).toLocaleString();
      else stateEl.textContent = 'Linked';
    }

    const signBtn = $('btn-drive-signin');
    if (signBtn) signBtn.textContent = isSignedIn() ? 'Sign out' : 'Sign in to Google';
  }

  function openModal() {
    const m = $('drive-modal');
    if (!m) return;
    if (!isConfigured()) {
      setStatus('Drive sync is not set up yet. Add your Client ID and API key in config.js (see README).', 'warn');
    } else {
      setStatus('');
    }
    render();
    m.classList.remove('hidden');
  }
  function closeModal() { const m = $('drive-modal'); if (m) m.classList.add('hidden'); }

  function busy(btn, label, work) {
    const orig = btn ? btn.textContent : null;
    if (btn) { btn.disabled = true; btn.textContent = label; }
    return work().catch(function (err) {
      setStatus(err && err.message ? err.message : String(err), 'error');
      throw err;
    }).finally(function () {
      if (btn) { btn.disabled = false; btn.textContent = orig; }
      render();
    });
  }

  function wireUI() {
    const trigger = $('btn-drive');
    if (trigger) trigger.addEventListener('click', openModal);

    const closeBtn = $('drive-close');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    const backdrop = $('drive-backdrop');
    if (backdrop) backdrop.addEventListener('click', closeModal);
    const cancel = $('btn-drive-cancel');
    if (cancel) cancel.addEventListener('click', closeModal);

    const signBtn = $('btn-drive-signin');
    if (signBtn) signBtn.addEventListener('click', function () {
      if (isSignedIn()) {
        busy(signBtn, 'Signing out…', function () { return signOut(); })
          .then(function () { setStatus('Signed out.'); });
      } else {
        busy(signBtn, 'Opening Google…', function () { return signIn(); })
          .then(function () { setStatus('Signed in.', 'ok'); });
      }
    });

    const backupBtn = $('btn-drive-backup');
    if (backupBtn) backupBtn.addEventListener('click', function () {
      busy(backupBtn, 'Backing up…', function () { return backup(); })
        .then(function () { setStatus('Backed up to Drive.', 'ok'); });
    });

    const restoreBtn = $('btn-drive-restore');
    if (restoreBtn) restoreBtn.addEventListener('click', function () {
      busy(restoreBtn, 'Restoring…', function () { return restore(); })
        .then(function () { setStatus('Restored from Drive.', 'ok'); });
    });

    const chooseBtn = $('btn-drive-choose');
    if (chooseBtn) chooseBtn.addEventListener('click', function () {
      busy(chooseBtn, 'Opening picker…', function () { return chooseFile(); })
        .then(function (p) { if (p) setStatus('Linked "' + p.name + '".', 'ok'); });
    });

    const unlinkBtn = $('btn-drive-unlink');
    if (unlinkBtn) unlinkBtn.addEventListener('click', function () {
      unlink(); setStatus('Unlinked. Local data is untouched.'); render();
    });
  }

  /* ─── init ───────────────────────────────────────────── */

  function init() {
    if (!isConfigured()) {
      // Leave the Drive button visible but mark it; clicking explains setup.
      const t = $('btn-drive');
      if (t) t.title = 'Drive sync not configured — see README / config.js';
    }
    wireUI();
    render();

    if (window.ExamTrainerState && window.ExamTrainerState.onChange) {
      window.ExamTrainerState.onChange(markLocalChange);
    }
    window.addEventListener('online', onReconnect);
    window.addEventListener('offline', render);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose a small surface for debugging / future use.
  window.DriveSync = {
    isConfigured: isConfigured,
    isSignedIn: isSignedIn,
    isLinked: isLinked,
    signIn: signIn,
    signOut: signOut,
    backup: backup,
    restore: restore,
    chooseFile: chooseFile,
    unlink: unlink,
    markLocalChange: markLocalChange,
  };
})();

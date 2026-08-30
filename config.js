/* ═══════════════════════════════════════════════════════
   Exam Trainer — Google Drive sync configuration
   ───────────────────────────────────────────────────────
   Drive sync is OPTIONAL. The app works fully offline with
   local storage + manual JSON import/export and does not
   need anything below.

   To enable Drive sync, create your own Google Cloud project
   (free) and fill in the two public values below. See the
   "Google Drive sync" section of README.md for step-by-step
   instructions.

   These values are PUBLIC by design for a static site — the
   browser needs them. Security comes from the OAuth consent
   screen + the authorised-JavaScript-origins allow-list you
   configure in Google Cloud, NOT from keeping these secret.
   Do not put any secret (client secret, service-account key)
   here.
   ═══════════════════════════════════════════════════════ */

window.DRIVE_CONFIG = {
  // OAuth 2.0 Client ID  (APIs & Services → Credentials → OAuth client ID,
  // type "Web application"). Looks like: 1234567890-abc...apps.googleusercontent.com
  clientId: '',

  // API key (APIs & Services → Credentials → API key). Required by the
  // Google Picker. Restrict it to the Picker API + your site's referrer.
  apiKey: '',

  // Default file name created in Drive when you back up without first
  // linking an existing file. You can rename/move it freely in Drive.
  fileName: 'ExamTrainer-backup.json',
};

/* ═══════════════════════════════════════════════════════
   Audio practice — optional overrides
   ───────────────────────────────────────────────────────
   Audio practice works with no configuration. The setting
   below only changes where the offline speech model is
   downloaded from the first time you enable it.
   ═══════════════════════════════════════════════════════ */

window.AUDIO_CONFIG = {
  // Source for the on-device model, downloaded once (~39MB) and then kept
  // on the device. It must be a **gzipped tar** of a Vosk model folder, and
  // it must be readable cross-origin (or same-origin).
  //
  // Note the official alphacephei.com downloads will NOT work directly:
  // they are .zip, and that host sends no CORS header. The default below is
  // the vosk-browser author's build, which is the right shape and allows
  // cross-origin reads.
  //
  // To self-host instead, drop the .tar.gz next to the app and point here:
  //   voskModelUrl: './models/vosk-model-small-en-us-0.15.tar.gz',
  voskModelUrl: '',
};

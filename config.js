/* ═══════════════════════════════════════════════════════
   Exam Trainer — optional configuration
   ───────────────────────────────────────────────────────
   Nothing here is required. The app works fully offline
   with local storage + manual JSON import/export, and every
   setting below has a working default.
   ═══════════════════════════════════════════════════════ */

/* ─── Audio practice — optional overrides ─────────────────
   Audio practice works with no configuration. The setting
   below only changes where the offline speech model is
   downloaded from the first time you enable it.
   ─────────────────────────────────────────────────────── */

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

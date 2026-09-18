# Exam Trainer

A personal, offline-first study app for practising exam questions and memorising
verses. Pure static site — no backend, no build step. Your data lives in the
browser (`localStorage`), with JSON import/export for backups and for moving
between devices.

- **Exams** — import/create question banks, practise full / weak-areas / custom sets,
  self-mark, and track attempt history.
- **Audio practice** — a hands-free voice session for the commute: the app reads each
  question aloud, listens for your spoken answer, and says whether it was right
  ([details](#audio-practice)).
- **Verses** — memorise verses with a graded first-letter typing trainer. On a desktop
  keyboard, <kbd>←</kbd>/<kbd>→</kbd> page between the verses of an entry and
  <kbd>Shift</kbd>+<kbd>←</kbd>/<kbd>→</kbd> lower/raise the difficulty.
- **Installable PWA** — add to your home screen on Android/desktop and use it fully
  offline (with one caveat for audio practice, below).
- **Report a bug** — the bug button in the header writes up the report, attaches
  version/browser/device details, and opens it as a pre-filled GitHub issue for you
  to read over and submit. Nothing leaves the device until you press Create.

## Running locally

Service workers require `https://` or `localhost` (not `file://`):

```bash
python -m http.server 8000
# open http://localhost:8000/
```

## Tests

Audio practice grades speech, which is fiddly enough to be worth pinning down. The
suite covers the answer grader, the voice-command grammar (including phrasings that
must *not* trigger a command), scripture-reference handling, and the text that gets
spoken aloud. No install step and no dependencies:

```bash
node tests/run.js
```

It reads the real `app.js` and lifts the pure functions out of it, so it tests the
shipping code rather than a copy that can drift. If a section marker in `app.js` is
renamed the harness fails loudly instead of quietly testing nothing.

**Development only — it is not part of the app.** Nothing loads `tests/` at runtime,
the service worker never caches it, and [`_config.yml`](_config.yml) keeps GitHub
Pages from publishing it.

## Deployment

Hosted on GitHub Pages. See **[DEPLOY.md](DEPLOY.md)** — including the important step
of bumping the service worker cache version on each release.

## Audio practice

**Trainer** tab → **🎧 Audio Practice**, next to the mode toggle. It practises whatever
the mode selects, so Full Exam / Weak Areas / Custom all carry over.

The app reads a question, listens, then says **correct** or **incorrect** and reads the
real answer back. Multi-part questions are asked a part at a time. At any point while
it is listening you can say:

| Say | Does |
|---|---|
| "what is the answer" / "what's the answer" | Reads the answer without marking the question |
| "next question" / "skip" | Moves on |
| "repeat question" / "say again" | Reads the question again |
| "stop" / "end session" | Ends the session and shows the score |

The same four are on screen as buttons, for a glance at a red light.

Answers are graded on how much of the correct answer you actually said, not on exact
wording — speech gets the words right and the phrasing wrong. Scripture references are
matched by meaning, so "revelation three twelve" answers `Rv 3:12`, and they are read
back expanded ("Matthew 17 verse 27") rather than as written. A near miss is marked
**close**, which still reads the answer back but does not count as correct. Audio
results are **not** written to attempt history — they are speech-graded, and letting
them feed Weak Areas would change what the typed Practice mode shows you.

### Offline

Text-to-speech is on-device and works offline (given the system voice data is
installed). **Speech recognition is the part that needs setting up.** There are two
recognisers, and the session header always says which one you are on:

| | Works offline | Setup |
|---|---|---|
| **Browser recognition** (default) | Only on desktop Chrome 139+ | None |
| **Offline recognition** (Vosk) | Yes, everywhere | One 39MB download |

The browser's own recogniser is the more accurate of the two, but it only runs
on-device in desktop Chrome 139+ (which the app opts into automatically). Chrome on
Android has no on-device path, so there it sends audio to Google and **a tunnel will
break it** — which is the whole reason for the second option.

**To make it work underground:** start an audio session while you still have signal
and tap **Enable offline** in the session header. That fetches a small English
[Vosk](https://alphacephei.com/vosk/) model (Kaldi compiled to WebAssembly, ~39MB),
keeps it on the device, and uses it from the next session on. Nothing after that
touches the network. Expect somewhat lower accuracy than the online recogniser — it
is a small model — in exchange for actually working in a tunnel.

If the model is missing or damaged, a session quietly falls back to the browser
recogniser and tells you, rather than failing.

Both pieces are cached on the device: the WebAssembly bundle is vendored in
[`vendor/vosk/`](vendor/vosk) and fetched on first use, and the model lives in its own
Cache Storage entry that survives app updates (it is deliberately **not** named with
the `examtrainer-` prefix the service worker sweeps on each release).

Engines sit behind a small interface — `createSttEngine()`, with `isSupported()`,
`prepare()`, `start()`, `stop()` and `release()` — so the session loop, the command
grammar and the grader are all engine-agnostic.

By default the model is fetched from the vosk-browser author's build, because it is
the right shape (a gzipped tar) and readable cross-origin. The official
alphacephei.com downloads are `.zip` and send no CORS header, so they cannot be used
directly. To self-host it instead, set `voskModelUrl` in [`config.js`](config.js).

## Data: import / export

- **Import JSON** — load one or more `.json` question files (see
  [import-format.md](import-format.md)).
- **Export** — save exams back out as `.json` (per exam), to Downloads or a chosen
  folder.

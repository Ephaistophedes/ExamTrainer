#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════
   Regenerate the phone screenshots in docs/screenshots/.

     npm i -g playwright && playwright install chromium
     node docs/tools/screenshots.js            # all of them
     node docs/tools/screenshots.js verse-level2 audio-verdict

   Development only: nothing in the app loads this, and
   _config.yml keeps docs/tools/ out of the published site.

   It serves the repo itself, seeds a phone-sized Chromium
   from the real Data/*.json files, and drives the shipping
   UI — so a screenshot can only ever show what the app
   actually does. The speech APIs are the one exception:
   headless Chromium has no voices and no recogniser, so
   they are stubbed to let the audio views reach their
   normal states.

   After a run, optionally shrink the PNGs (they are flat
   UI, so a palette costs nothing visible):

     pngquant --force --ext .png --quality 70-95 docs/screenshots/*.png
   ═══════════════════════════════════════════════════════ */

'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT  = path.join(ROOT, 'docs', 'screenshots');
const ONLY = process.argv.slice(2);

const { chromium } = require('playwright');

/* ─── A static server for the repo, so no separate step ── */

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
};

function serve() {
  const server = http.createServer(function (req, res) {
    const rel  = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(function (resolve) {
    server.listen(0, '127.0.0.1', function () {
      resolve({ server: server, port: server.address().port });
    });
  });
}

/* ─── Demo data, built from the repo's own question files ── */

let qid = 1000;

function questionsFrom(file) {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'Data', file), 'utf8'));
  return raw.map(function (q) {
    return {
      id: ++qid,
      // Typos in the study files would only be distracting in a screenshot.
      question: q.question.replace(/\bkeet\b/g, 'keep'),
      correct:  q.correct.map(function (c) { return c.replace(/^\(promise\)$/, 'promise'); }),
    };
  });
}

function buildSeed() {
  const examFolders = [
    { id: 'folder_bb', name: 'Basic Bible Study', created: '2026-01-11', collapsed: false },
    { id: 'folder_rv', name: 'Revelation',        created: '2026-02-03', collapsed: true  },
  ];

  const examBank = [
    ['exam_bb1',  'BB Lesson 1 · Distinguishing the era',       'folder_bb', 'BB Lesson 1 - Distinguishing the era.json'],
    ['exam_bb2',  'BB Lesson 2 · What kind of book is the Bible','folder_bb', 'BB Lesson 2 - What kind of book is the Bible_ pt 1.json'],
    ['exam_bb3',  'BB Lesson 3 · Old & New Testament',           'folder_bb', 'BB Lesson 3 - OT & NT.json'],
    ['exam_rev',  'Revelation Exam',                             'folder_rv', 'Revelation_Exam.json'],
    ['exam_seal', 'Sealing Exam · Rv 6',                         'folder_rv', 'Sealing Exam 430510 Rv6 part2.json'],
    ['exam_par',  'Parables Exam',                               null,        'Parables Exam New.json'],
    ['exam_mock', 'Mock Exam · Lessons 3 & 4',                   null,        'Mock Exam BB lesson 3 & 4.json'],
  ].map(function (row, i) {
    return {
      id: row[0], name: row[1], folderId: row[2],
      created: '2026-0' + (1 + (i % 3)) + '-1' + (i % 9),
      questions: questionsFrom(row[3]),
    };
  });

  /* Attempts on the active exam, hand-built so the chart tells a story: a
     rough first sitting, steady improvement, one plateau. Misses cluster on
     a few questions so Weak Areas and "most missed" have something real. */
  const bb3 = examBank.find(function (e) { return e.id === 'exam_bb3'; });
  const plans = [
    { daysAgo: 26, wrong: { 0: [1, 2], 1: [0, 1], 2: [0], 3: [0], 4: [1, 2], 7: [1, 2], 8: [0, 1, 2] } },
    { daysAgo: 21, wrong: { 0: [2], 1: [1], 2: [0], 3: [0], 4: [2], 7: [2], 8: [1, 2] } },
    { daysAgo: 16, wrong: { 0: [2], 2: [0], 3: [0], 4: [2], 8: [1, 2] } },
    { daysAgo: 12, wrong: { 2: [0], 3: [0], 4: [2], 8: [2] } },
    { daysAgo: 9,  wrong: { 0: [1], 2: [0], 3: [0], 8: [2] } },
    { daysAgo: 5,  wrong: { 3: [0], 8: [2] } },
    { daysAgo: 2,  wrong: { 3: [0] } },
  ];
  const GUESSES = ['Ex 19:5', 'Jn 1:12', 'Lk 24:45', '27', 'believers', 'the promise', 'Rom 1:2'];

  const examHistory = plans.map(function (plan) {
    const d = new Date();
    d.setDate(d.getDate() - plan.daysAgo);
    d.setHours(19 - (plan.daysAgo % 5), 40 - (plan.daysAgo % 17), 0, 0);

    let score = 0, total = 0;
    const answers = bb3.questions.map(function (q, qi) {
      const wrong = plan.wrong[qi] || [];
      const partResults = q.correct.map(function (_, pi) { return wrong.indexOf(pi) === -1; });
      const userAnswers = q.correct.map(function (c, pi) {
        return partResults[pi] ? c : GUESSES[(pi + q.id) % GUESSES.length];
      });
      const partsCorrect = partResults.filter(Boolean).length;
      score += partsCorrect;
      total += partResults.length;
      return {
        id: q.id, userAnswers: userAnswers, partResults: partResults,
        partsCorrect: partsCorrect, partsTotal: partResults.length,
      };
    });

    return {
      examId: bb3.id, date: d.toISOString(), score: score, total: total,
      percent: Math.round((score / total) * 100), answers: answers,
    };
  });

  const verseBank = [
    {
      id: 'verse_rv3', title: 'The letter to Philadelphia', titleAuto: false,
      folderId: 'folder_v_rev', created: '2026-02-05T09:00:00.000Z',
      verses: [
        { ref: 'Rv 3:10', text: 'Since you have kept my command to endure patiently, I will also keep you from the hour of trial that is going to come on the whole world to test the inhabitants of the earth.' },
        { ref: 'Rv 3:11', text: 'I am coming soon. Hold on to what you have, so that no one will take your crown.' },
        { ref: 'Rv 3:12', text: 'The one who is victorious I will make a pillar in the temple of my God. Never again will they leave it. I will write on them the name of my God and the name of the city of my God, the new Jerusalem, which is coming down out of heaven from my God; and I will also write on them my new name.' },
      ],
    },
    {
      id: 'verse_rv1', title: 'Rv 1:1–3', titleAuto: true,
      folderId: 'folder_v_rev', created: '2026-02-07T09:00:00.000Z',
      verses: [
        { ref: 'Rv 1:1', text: 'The revelation from Jesus Christ, which God gave him to show his servants what must soon take place. He made it known by sending his angel to his servant John,' },
        { ref: 'Rv 1:2', text: 'who testifies to everything he saw — that is, the word of God and the testimony of Jesus Christ.' },
        { ref: 'Rv 1:3', text: 'Blessed is the one who reads aloud the words of this prophecy, and blessed are those who hear it and take to heart what is written in it, because the time is near.' },
      ],
    },
    {
      id: 'verse_ps89', title: 'Ps 89:3', titleAuto: true, folderId: null,
      created: '2026-01-12T09:00:00.000Z',
      verses: [{ ref: 'Ps 89:3', text: 'You said, "I have made a covenant with my chosen one, I have sworn to David my servant,"' }],
    },
    {
      id: 'verse_mt24', title: 'Mt 24:15–16', titleAuto: true, folderId: null,
      created: '2026-01-20T09:00:00.000Z',
      verses: [
        { ref: 'Mt 24:15', text: 'So when you see standing in the holy place the abomination that causes desolation, spoken of through the prophet Daniel — let the reader understand —' },
        { ref: 'Mt 24:16', text: 'then let those who are in Judea flee to the mountains.' },
      ],
    },
  ];

  return {
    examBank: examBank,
    examFolders: examFolders,
    examHistory: examHistory,
    activeExamId: 'exam_bb3',
    verseBank: verseBank,
    verseFolders: [{ id: 'folder_v_rev', name: 'Revelation', created: '2026-02-05', collapsed: false }],
  };
}

/* ─── Speech stubs ──────────────────────────────────────
   Headless Chromium has no voices and no recogniser, so an
   audio session would stop at the first utterance. These
   let it run its normal loop; everything on screen is the
   app's own UI in its own states.
   ─────────────────────────────────────────────────────── */

const SPEECH_STUB = `
  window.__speakDelay = 20;
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
    speak(u) { setTimeout(() => u.onend && u.onend(), window.__speakDelay); },
    cancel() {},
    getVoices() { return [{ lang: 'en-US', localService: true, name: 'Demo' }]; },
    addEventListener() {},
  }});
  window.SpeechSynthesisUtterance = function (text) { this.text = text; };

  function FakeRecognition() { window.__recog = this; }
  FakeRecognition.prototype.start = function () { window.__recog = this; };
  FakeRecognition.prototype.stop  = function () { if (this.onend) this.onend(); };
  FakeRecognition.prototype.abort = function () { if (this.onend) this.onend(); };
  window.SpeechRecognition = FakeRecognition;
  window.__hear = function (text) {
    const r = window.__recog;
    if (!r || !r.onresult) return false;
    const alt = [{ transcript: text, confidence: 0.9 }];
    alt.isFinal = true;
    r.onresult({ resultIndex: 0, results: [alt] });
    return true;
  };

  if (!navigator.mediaDevices) navigator.mediaDevices = {};
  navigator.mediaDevices.getUserMedia = () => Promise.resolve({ getTracks: () => [] });
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: {
    request: () => Promise.resolve({ release: () => Promise.resolve(), addEventListener() {} }),
  }});
`;

const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

/* ─── The run ───────────────────────────────────────────── */

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const seed = buildSeed();
  const { server, port } = await serve();
  const url = 'http://127.0.0.1:' + port + '/index.html';

  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });

  const taken = [];

  async function newPage(dark) {
    const ctx = await browser.newContext({
      viewport: { width: 412, height: 880 },   // a mid-size Android phone
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      colorScheme: dark ? 'dark' : 'light',
      locale: 'en-GB',
      permissions: ['microphone'],
    });
    await ctx.addInitScript(SPEECH_STUB);
    await ctx.addInitScript(`
      try {
        localStorage.clear();
        const seed = ${JSON.stringify(seed)};
        Object.keys(seed).forEach(function (k) {
          localStorage.setItem(k, k === 'activeExamId' ? seed[k] : JSON.stringify(seed[k]));
        });
        localStorage.setItem('theme', '${dark ? 'dark' : 'light'}');
      } catch (e) {}
    `);
    const page = await ctx.newPage();
    page.on('pageerror', function (e) { console.error('  ! page error:', e.message); });
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.evaluate(function () { return document.fonts.ready; });
    await sleep(250);
    return page;
  }

  /*
   * Several screens (the audio session, its summary) only fill half a phone
   * screen, and in a thumbnail that empty half is all you see — so the shot
   * is clipped to the content, measured in the page rather than by sniffing
   * pixels afterwards.
   */
  async function shot(page, name) {
    if (ONLY.length && ONLY.indexOf(name) === -1) return;
    await sleep(200);

    const height = await page.evaluate(function () {
      let lowest = 0;
      document.querySelectorAll('main, main *, .modal:not(.hidden), .modal:not(.hidden) *')
        .forEach(function (el) {
          if (!el.offsetParent && el.tagName !== 'BODY') return;
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) lowest = Math.max(lowest, r.bottom);
        });
      return Math.ceil(lowest + 20);
    });

    const clipH = Math.min(880, Math.max(420, height));
    await page.screenshot({
      path: path.join(OUT, name + '.png'),
      clip: { x: 0, y: 0, width: 412, height: clipH },
    });
    taken.push(name);
    console.log('  ✓ ' + name);
  }

  /* — 1. Exams — */
  {
    const page = await newPage(false);
    await shot(page, 'exams-list');

    await page.evaluate(function () {
      enterSelectionMode(EXAM_FOLDERS, 'exam_par');
      toggleItemSelected(EXAM_FOLDERS, 'exam_mock');
    });
    await shot(page, 'exams-select');
    await page.evaluate(function () { exitSelectionMode(EXAM_FOLDERS); });

    await page.click('#btn-export');
    await page.waitForSelector('#export-modal:not(.hidden)');
    await page.click('#export-select-all');
    await shot(page, 'exams-export');
    await page.click('#btn-cancel-export');

    await page.evaluate(function () { openEditor('exam_bb3'); });
    await page.waitForSelector('#editor-modal:not(.hidden)');
    await shot(page, 'exam-editor');
    await page.evaluate(function () {
      const row  = document.querySelector('.editor-q-row');
      const body = document.querySelector('#editor-modal .modal-body');
      if (row) body.scrollTop = row.offsetTop - 56;
    });
    await shot(page, 'exam-editor-blanks');
    await page.evaluate(function () { closeEditor(); clearDraft(); });

    await page.click('#btn-report-bug');
    await page.waitForSelector('#bug-modal:not(.hidden)');
    await page.fill('#bug-summary', 'Verse trainer skips the last line');
    await page.fill('#bug-description', 'At level 3 the final word of a verse never turns green, so the session cannot finish.');
    await shot(page, 'bug-report');
    await page.context().close();
  }

  /* — 2. Trainer — */
  {
    const page = await newPage(false);
    await page.click('.tab-btn[data-tab="trainer"]');
    await sleep(250);
    await shot(page, 'trainer-full');

    // A plausible sitting: mostly right, one recital short, one reference wrong.
    await page.evaluate(function () {
      const answers = {
        0: ['covenant', 'promise', 'salvation'],
        1: ['persecuted', 'believers'],
        2: ['You said, "I have made a covenant with my chosen one, I have sworn to David my servant'],
        3: ['The Lord Almighty has sworn, "Surely, as I have planned, so it will be'],
        4: ['66', '39', '27'],
        5: ["It's a book of covenant that God makes with the chosen people."],
        6: ['Ex 19:5-6'],
        7: ['Jesus', 'Rom 1:2-4', 'Lk 24:44'],
        8: ['Jn 1:11', 'Jn 8:37', ''],
      };
      document.querySelectorAll('.question-card').forEach(function (card, qi) {
        const vals = answers[qi] || [];
        card.querySelectorAll('.answer-part-input').forEach(function (inp, pi) {
          if (vals[pi] != null) inp.value = vals[pi];
        });
      });
      const card = document.querySelectorAll('.question-card')[1];
      window.scrollTo(0, card.offsetTop - 130);
    });
    await shot(page, 'trainer-answering');

    await page.click('#btn-submit-mark');
    await page.waitForSelector('#self-mark-view:not(.hidden)');
    await sleep(250);
    await page.evaluate(function () {
      document.querySelectorAll('.smg-blank-chip').forEach(function (c, i) { if (i < 5) c.click(); });
      document.querySelectorAll('.mark-btn.mark-check').forEach(function (b, i) { if (i < 2) b.click(); });
      window.scrollTo(0, 0);
    });
    await shot(page, 'self-mark');
    await page.evaluate(function () {
      const nums = Array.prototype.slice.call(document.querySelectorAll('.smg-q-num'));
      const cell = (nums.filter(function (n) { return n.textContent.trim() === 'Question 4'; })[0] || nums[0]).parentElement;
      window.scrollTo(0, cell.getBoundingClientRect().top + window.scrollY - 46);
    });
    await shot(page, 'self-mark-detail');
    await page.click('#btn-self-mark-cancel');
    await sleep(200);

    await page.evaluate(function () { window.scrollTo(0, 0); });
    await page.click('#btn-submit');
    await sleep(400);
    await page.evaluate(function () { window.scrollTo(0, 0); });
    await shot(page, 'trainer-results');
    await page.evaluate(function () {
      const card = document.querySelectorAll('.question-card')[3]; // wrong, with the right one under it
      window.scrollTo(0, card.offsetTop - 108);
    });
    await shot(page, 'trainer-marked');

    await page.evaluate(function () { window.scrollTo(0, 0); switchMode('weak'); });
    await sleep(300);
    await page.check('#weak-parts-check');
    await sleep(300);
    await page.evaluate(function () { window.scrollTo(0, 0); });
    await shot(page, 'trainer-weak');

    await page.evaluate(function () {
      switchMode('custom');
      window.scrollTo(0, 0);
      customSelectedIds.clear();
      const exam = getActiveExam();
      [0, 4, 7, 8].forEach(function (i) { customSelectedIds.add(exam.questions[i].id); });
      renderQuestionPicker(exam);
      updatePickerCount(exam);
    });
    await shot(page, 'trainer-custom');
    await page.context().close();
  }

  /* — 3. Audio practice — */
  {
    const page = await newPage(false);
    await page.click('.tab-btn[data-tab="trainer"]');
    await sleep(200);
    await page.evaluate(function () {
      switchMode('custom');
      customSelectedIds.clear();
      const exam = getActiveExam();
      [4, 7].forEach(function (i) { customSelectedIds.add(exam.questions[i].id); });
      renderQuestionPicker(exam);
      updatePickerCount(exam);
    });
    await page.click('#btn-pick-start');
    await sleep(300);
    await page.click('#btn-audio-practice');
    await page.waitForSelector('#audio-practice-view:not(.hidden)');

    const listening = function () {
      return page.waitForFunction(
        function () { return document.getElementById('audio-state-label').textContent === 'Listening…'; },
        null, { timeout: 15000 });
    };

    await listening();
    await shot(page, 'audio-listening');

    // Real speech takes seconds; slow the stub so the verdicts can be caught.
    await page.evaluate(function () { window.__speakDelay = 2500; });
    await page.evaluate(function () { window.__hear('sixty six'); });
    await sleep(500);
    await shot(page, 'audio-verdict');

    await page.evaluate(function () { window.__speakDelay = 20; });
    await listening();
    await page.evaluate(function () { window.__speakDelay = 2500; });
    await page.evaluate(function () { window.__hear('what is the answer'); });
    await sleep(500);
    await shot(page, 'audio-answer');

    await page.evaluate(function () { window.__speakDelay = 20; });
    await listening();
    await page.evaluate(function () { window.__hear('thirty nine'); });
    await sleep(600);
    await page.evaluate(function () { window.__hear('the letter of the law'); });
    await sleep(600);
    await page.click('#btn-audio-stop');
    await page.waitForSelector('#audio-summary:not(.hidden)', { timeout: 10000 });
    await shot(page, 'audio-summary');
    await page.context().close();
  }

  /* — 4. History — */
  {
    const page = await newPage(false);
    await page.click('.tab-btn[data-tab="history"]');
    await sleep(500);
    await shot(page, 'history-stats');
    await page.evaluate(function () {
      const el = document.querySelector('.chart-section');
      window.scrollTo(0, el.offsetTop - 120);
    });
    await shot(page, 'history-chart');
    await page.click('.attempt-card:nth-child(2) .attempt-header');
    await sleep(300);
    await page.evaluate(function () {
      const card = document.querySelectorAll('.attempt-card')[1];
      window.scrollTo(0, card.offsetTop - 120);
    });
    await shot(page, 'history-attempt');
    await page.context().close();
  }

  /* — 5. Verses — */
  {
    const page = await newPage(false);
    await page.click('.tab-btn[data-tab="verses"]');
    await sleep(300);
    await shot(page, 'verses-list');

    await page.evaluate(function () { startVersePractice('verse_rv3'); });
    await sleep(300);
    await shot(page, 'verse-select');

    await page.click('.verse-select-row[data-idx="0"] .verse-select-ref');
    await page.waitForSelector('#verse-practice-view:not(.hidden)');
    await sleep(400);
    await shot(page, 'verse-level1-start');

    // Type the letters the trainer is expecting, optionally fluffing one so
    // the red "wrong word" state is documented too.
    async function typeWords(count, slipAt) {
      const letters = await page.evaluate(function (args) {
        const ls = _verseModel.letters.slice(0, args[0]);
        if (args[1] != null && ls[args[1]]) ls[args[1]] = ls[args[1]] === 'z' ? 'q' : 'z';
        return ls.join('');
      }, [count, slipAt]);
      await page.evaluate(function () { document.getElementById('verse-type-input').focus(); });
      await page.keyboard.type(letters, { delay: 12 });
      await sleep(200);
    }

    await typeWords(11, 7);
    await shot(page, 'verse-level1-typing');

    await page.click('.verse-level-pill[data-level="2"]');
    await sleep(300);
    await typeWords(9);
    await shot(page, 'verse-level2');

    await page.click('.verse-level-pill[data-level="3"]');
    await sleep(300);
    await typeWords(12);
    await shot(page, 'verse-level3');

    await page.click('.verse-level-pill[data-level="4"]');
    await sleep(300);
    await typeWords(9);
    await shot(page, 'verse-level4');

    await page.click('#btn-verse-audio-toggle');
    await sleep(900);
    await shot(page, 'verse-audio');
    await page.context().close();
  }

  /* — 6. Dark mode — */
  {
    const page = await newPage(true);
    await shot(page, 'dark-exams');
    await page.click('.tab-btn[data-tab="verses"]');
    await sleep(250);
    await page.evaluate(function () { startVersePractice('verse_ps89'); });
    await sleep(500);
    const letters = await page.evaluate(function () { return _verseModel.letters.slice(0, 8).join(''); });
    await page.evaluate(function () { document.getElementById('verse-type-input').focus(); });
    await page.keyboard.type(letters, { delay: 15 });
    await sleep(250);
    await shot(page, 'dark-verse');
    await page.context().close();
  }

  /* — 7. The hero, composed in the browser so there is no image library — */
  if (!ONLY.length || ONLY.indexOf('hero') !== -1) {
    const panels = ['trainer-results', 'verse-level2', 'audio-verdict'];
    const html = `<!doctype html><meta charset="utf-8"><style>
      body { margin:0; padding:40px 34px 52px; display:flex; gap:26px; align-items:flex-start;
             background:transparent; width:max-content; }
      img  { width:292px; border:2px solid #d6dbd8; border-radius:28px;
             box-shadow:0 14px 28px rgba(15,26,22,.22); display:block;
             object-fit:cover; object-position:top; }
      img:nth-child(1), img:nth-child(3) { width:252px; margin-top:46px; height:466px; }
      img:nth-child(2) { height:540px; }
    </style>` + panels.map(function (n) {
      return '<img src="' + n + '.png">';
    }).join('');

    fs.writeFileSync(path.join(OUT, '_hero.html'), html);
    const ctx  = await browser.newContext({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto('http://127.0.0.1:' + port + '/docs/screenshots/_hero.html', { waitUntil: 'networkidle' });
    const box = await page.locator('body').boundingBox();
    await page.screenshot({
      path: path.join(OUT, 'hero.png'),
      clip: { x: 0, y: 0, width: Math.ceil(box.width), height: Math.ceil(box.height) },
      omitBackground: true,   // transparent: readable on a light or dark page
    });
    fs.unlinkSync(path.join(OUT, '_hero.html'));
    await ctx.close();
    console.log('  ✓ hero');
  }

  await browser.close();
  server.close();
  console.log('\n' + taken.length + ' screenshots → docs/screenshots/');
}

main().catch(function (e) { console.error(e); process.exit(1); });

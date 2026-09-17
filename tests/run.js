/* ═══════════════════════════════════════════════════════
   Exam Trainer — audio practice test suite
   ───────────────────────────────────────────────────────
   Development only. Nothing here ships: the app never loads
   this directory, the service worker never caches it, and
   _config.yml keeps GitHub Pages from publishing it.

   Run it with plain Node, no install step:

       node tests/run.js

   It reads the real app.js and pulls the pure grading
   functions out of it, so it tests the shipping code rather
   than a copy that can drift away from it.
   ═══════════════════════════════════════════════════════ */

'use strict';

const fs   = require('fs');
const path = require('path');

const APP_PATH = path.join(__dirname, '..', 'app.js');
const APP      = fs.readFileSync(APP_PATH, 'utf8');

/**
 * Lift a region of app.js out by its section markers. Throws loudly if a
 * marker moves, which is the point: a silent miss would leave the suite
 * testing nothing while still reporting green.
 */
function slice(startMarker, endMarker) {
  const a = APP.indexOf(startMarker);
  if (a === -1) throw new Error('test harness: start marker not found: ' + startMarker);
  const b = APP.indexOf(endMarker, a);
  if (b === -1) throw new Error('test harness: end marker not found: ' + endMarker);
  return APP.slice(a, b);
}

// The typed trainer's helpers that the audio grader builds on...
const base   = slice('function normalizeAnswer(str)', '/* ─── Results Panel');
// ...the grading and command layer...
const audio  = slice('const SPOKEN_NUMBERS', '/* ─── Speech out (TTS)');
// ...the pure text-shaping helpers used for what gets spoken...
const speech = slice('function chunkForSpeech', '/* ─── Speech in (STT)');
// ...and the rule for which verses a listening session covers.
const verse  = slice('function verseSessionItems', '/* ─── Practice session');

// ...plus the speech engine itself, which is built per scenario below
// against a fake engine, since what it does with a phone that will not
// speak is the whole point of it.
const speaker = slice('const Speaker = (function ()', 'function chunkForSpeech');

const EXPORTS = [
  'normalizeSpeech', 'spokenNumbersToDigits', 'canonicalizeRefs', 'extractRefs',
  'matchSpokenAnswer', 'matchCommand', 'speakableAnswer', 'speakableQuestion',
  'chunkForSpeech', 'matchCommandFrom', 'VERSE_VOICE_COMMANDS',
  'speechFailureMessage', 'verseSessionItems',
];

const mod = { exports: {} };
new Function('module', 'exports', 'window',
  base + '\n' + audio + '\n' + speech + '\n' + verse +
  '\nmodule.exports = { ' + EXPORTS.join(', ') + ' };'
)(mod, mod.exports, {});

const {
  matchSpokenAnswer, matchCommand, speakableAnswer, speakableQuestion,
  chunkForSpeech, canonicalizeRefs, spokenNumbersToDigits,
  matchCommandFrom, VERSE_VOICE_COMMANDS, speechFailureMessage,
  verseSessionItems,
} = mod.exports;

/* ─── A phone that will not speak ───────────────────── */

/**
 * The speech engine, wired to a fake browser one whose behaviour the test
 * chooses, on a clock the test drives. Timers and Date are passed in so a
 * five-second wait for an utterance that never starts costs nothing here.
 */
function buildSpeaker(behaviour) {
  const opts = behaviour || {};
  let now    = 0;
  const timers = [];

  const clock = {
    setTimeout: function (fn, ms) {
      const t = { at: now + ms, fn: fn };
      timers.push(t);
      return t;
    },
    clearTimeout: function (t) { if (t) t.cancelled = true; },
    advance: function (ms) {
      now += ms;
      timers.slice().forEach(function (t) {
        if (t.cancelled || t.fired || t.at > now) return;
        t.fired = true;
        t.fn();
      });
    },
  };

  const spoken = [];

  function Utterance(text) { this.text = text; }

  const synth = {
    cancelled: 0,
    getVoices: function () { return opts.voices || []; },
    addEventListener: function () {},
    cancel: function () { this.cancelled++; },
    speak: function (u) {
      spoken.push(u);
      if (opts.onSpeak) opts.onSpeak(u, clock, now);
    },
  };

  const win = opts.noApi ? {} : { speechSynthesis: synth, SpeechSynthesisUtterance: Utterance };
  const nav = { userAgent: opts.userAgent || 'Mozilla/5.0 (Linux; Android 14; Pixel) Chrome/126' };

  const m = { exports: {} };
  new Function('module', 'window', 'navigator', 'setTimeout', 'clearTimeout', 'Date',
    speaker + '\n' + speech + '\nmodule.exports = Speaker;'
  )(m, win, nav, clock.setTimeout, clock.clearTimeout, { now: function () { return now; } });

  return { Speaker: m.exports, clock: clock, spoken: spoken, synth: synth };
}

/** Let the promise chain run between clock moves. */
function tick() { return new Promise(function (r) { setImmediate(r); }); }

/* ─── Tiny assertion harness ────────────────────────── */

let pass = 0;
const failures = [];

function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else failures.push('  ' + label + '\n      got  ' + JSON.stringify(got) +
                     '\n      want ' + JSON.stringify(want));
}

/** A spoken answer graded against the stored one. */
function answer(spoken, correct, want) {
  const r = matchSpokenAnswer(spoken, correct);
  check('answer  "' + spoken + '"  vs  "' + correct + '"  [coverage ' +
        r.coverage.toFixed(2) + ']', r.verdict, want);
}

function command(spoken, want) {
  check('command "' + spoken + '"', matchCommand(spoken), want);
}

function speaks(input, want) {
  check('speak   "' + input + '"', speakableAnswer(input), want);
}

function group(name) { console.log('\n' + name); }

/* ═══ Commands ═══════════════════════════════════════ */
group('Voice commands — the required phrasings');

command('what is the answer',   'answer');
command("what's the answer",    'answer');
command('whats the answer',     'answer');
command('next question',        'next');
command('repeat question',      'repeat');

group('Voice commands — near misses a recogniser produces');

command('what was the answer',      'answer');
command('tell me the answer',       'answer');
command('give me the answer',       'answer');
command('ok what is the answer please', 'answer');
command('i dont know',              'answer');
command('next question please',     'next');
command('next',                     'next');
command('skip',                     'next');
command('move on',                  'next');
command('repeat the question',      'repeat');
command('say that again',           'repeat');
command('once more',                'repeat');
command('stop',                     'stop');
command('end session',              'stop');
command('im done',                  'stop');

group('Voice commands — must not fire on a real answer');

command('the holy city the new jerusalem',                    null);
command('moses exodus 25 8 to 9',                             null);
command('because they broke the covenant and betrayed like adam', null);
command('the next generation of the chosen people',           null); // contains "next"
command('jesus repeated the prophecy to his disciples',       null); // contains "repeat"
command('he did not stop teaching in the temple courts',      null); // contains "stop"
command('forgiveness of sins heaven and eternal life',        null);

group('Verse audio commands — repeat / next / previous / stop');

function verseCommand(spoken, want) {
  check('verse command "' + spoken + '"', matchCommandFrom(spoken, VERSE_VOICE_COMMANDS), want);
}

verseCommand('repeat',         'repeat');
verseCommand('say that again', 'repeat');
verseCommand('read it again',  'repeat');
verseCommand('next',           'next');
verseCommand('next verse',     'next');
verseCommand('skip',           'next');
verseCommand('previous',       'previous');
verseCommand('previous verse', 'previous');
verseCommand('go back',        'previous');
verseCommand('stop',           'stop');
verseCommand('done',           'stop');
verseCommand('quit',           'stop');
verseCommand('for god so loved the world that he gave his only begotten son', null);

/* ═══ Scripture references ═══════════════════════════ */
group('Scripture references — spoken aloud');

answer('revelation three twelve',        'Rv 3:12',      'correct');
answer('revelation chapter 3 verse 12',  'Rv 3:12',      'correct');
answer('exodus nineteen five to six',    'Ex 19:5-6',    'correct');
answer('psalm eighty nine three',        'Ps 89:3',      'correct');
answer('matthew twenty six twenty six to twenty nine', 'Mt 26:26-29', 'correct');
answer('first corinthians five seven',   '1 Cor 5:7',    'correct');
answer('second timothy three sixteen',   '2 Tim 3:16',   'correct');
answer('john five nineteen',             'Jn 5:19',      'correct');
answer('romans one two to four',         'Rom 1:2-4',    'correct');
answer('luke twenty four forty four',    'Lk 24:44-45',  'correct'); // range read short
answer('revelation four',                'Rv 4',         'correct');

group('Scripture references — a wrong verse is wrong');

// One edit apart, and well inside what the typed grader forgives.
answer('revelation three thirteen',      'Rv 3:12',      'wrong');
answer('genesis three twelve',           'Rv 3:12',      'wrong');
answer('revelation four twelve',         'Rv 3:12',      'wrong');

/* ═══ Prose answers ══════════════════════════════════ */
group('Prose answers — said in the user’s own words');

answer('the holy city the new jerusalem',
       'The holy city, the new Jerusalem', 'correct');
answer('um I think it is the holy city the new jerusalem',
       'The holy city, the new Jerusalem', 'correct');
answer('they broke the covenant and betrayed like adam',
       'Because they broke the covenant and betrayed like Adam', 'correct');
answer('to restore man and the earth and fulfill a world of gods reign',
       "To restore man and the earth and fulfill a world of God's reign", 'correct');
answer('forgiveness of sin heaven and eternal life',     // recogniser drops a plural
       'Forgiveness of sins, heaven, and eternal life', 'correct');
answer('those who keep the new covenant',
       'Those who keep the new covenant', 'correct');
answer('fled in seven ways', 'Fled in seven ways', 'correct');

group('Prose answers — partial and wrong');

answer('forgiveness of sins',
       'Forgiveness of sins, heaven, and eternal life', 'close');
answer('the twelve tribes of israel',
       'Forgiveness of sins, heaven, and eternal life', 'wrong');
answer('i have no idea about this one',
       'Because they broke the covenant and betrayed like Adam', 'wrong');
answer('', 'Fled in seven ways', 'wrong');

group('Prose answers — short answers are all content');

answer('moses',                             'Moses, Ex 25:8-9', 'wrong');
answer('moses exodus twenty five eight to nine', 'Moses, Ex 25:8-9', 'correct');
answer('jesus',                             'Jesus',            'correct');

/* ═══ What gets spoken ═══════════════════════════════ */
group('Reading answers aloud — references are expanded');

speaks('Mt 17:27; Jn 17:3', 'Matthew 17 verse 27; John 17 verse 3');
speaks('Ex 19:5-6',         'Exodus 19 verse 5 to 6');
speaks('Moses, Ex 25:8-9',  'Moses, Exodus 25 verse 8 to 9');
speaks('1 Cor 5:7',         'First Corinthians 5 verse 7');
speaks('2 Tim 3:16',        'Second Timothy 3 verse 16');
speaks('Rv 4',              'Revelation 4');

group('Reading answers aloud — prose is left alone');

speaks('The holy city, the new Jerusalem', 'The holy city, the new Jerusalem');
speaks('Fled in seven ways',               'Fled in seven ways');
speaks('Jesus; the Old Testament prophecies and the physical fulfillment',
       'Jesus; the Old Testament prophecies and the physical fulfillment');

group('Reading questions aloud');

check('blanks become the word "blank"',
      speakableQuestion('The ___ city, the new ___'),
      'The blank city, the new blank');
check('editor-marked blanks too',
      speakableQuestion('The [[holy]] city'),
      'The blank city');
check('the stored "Question 4 —" prefix is dropped',
      speakableQuestion('Question 4 — Fill in the blanks.'),
      'Fill in the blanks.');

group('Chunking long text for the speech engine');

check('short text stays one chunk', chunkForSpeech('Hello there.'), ['Hello there.']);
check('sentences split', chunkForSpeech('One. Two. Three.'), ['One.', 'Two.', 'Three.']);
check('no chunk runs over the engine limit',
      chunkForSpeech('word '.repeat(120)).every(function (c) { return c.length <= 180; }),
      true);
check('nothing is lost in the split',
      chunkForSpeech('Alpha beta. Gamma delta.').join(' '),
      'Alpha beta. Gamma delta.');

group('Number words');

check('teens',      spokenNumbersToDigits('nineteen'),      '19');
check('compound',   spokenNumbersToDigits('twenty six'),    '26');
check('not greedy', spokenNumbersToDigits('twenty chapter'), '20 chapter');
check('ordinals',   spokenNumbersToDigits('first corinthians'), '1 corinthians');

group('Reference canonicalisation');

check('abbreviation expands',
      canonicalizeRefs('rv 3 12'), 'revelation 3 12');
check('chapter/verse labels drop out',
      canonicalizeRefs('revelation chapter 3 verse 12'), 'revelation 3 12');
check('range connectors between numbers drop out',
      canonicalizeRefs('exodus 19 5 to 6'), 'exodus 19 5 6');
check('"and" between words is kept',
      canonicalizeRefs('heaven and eternal life'), 'heaven and eternal life');

group('Verse audio — the session is what was selected');

const JOHN = [
  { ref: 'John 1:1', text: 'In the beginning was the Word.' },
  { ref: 'John 1:2', text: 'He was with God in the beginning.' },
  { ref: 'John 1:3', text: 'Through him all things were made.' },
  { ref: 'John 1:4', text: 'In him was life.' },
];

function refsOf(session) {
  return session.items.map(function (it) { return it.ref; });
}

check('a selection is read, not the entry it came from',
      refsOf(verseSessionItems(JOHN, [JOHN[1], JOHN[2]], -1)), ['John 1:2', 'John 1:3']);
check('...starting on the first verse selected',
      verseSessionItems(JOHN, [JOHN[1], JOHN[2]], -1).index, 0);
check('the whole entry selected is still the whole entry',
      refsOf(verseSessionItems(JOHN, JOHN, -1)).length, 4);
check('one verse, pageable, opens the entry on that verse',
      verseSessionItems(JOHN, [JOHN[2]], 2), { items: JOHN, index: 2 });
check('one verse with no place in the entry stands alone',
      refsOf(verseSessionItems(JOHN, [JOHN[2]], -1)), ['John 1:3']);
check('a position past the end of the entry is ignored',
      refsOf(verseSessionItems(JOHN, [JOHN[0]], 9)), ['John 1:1']);
check('no session at all falls back to the whole entry',
      verseSessionItems(JOHN, [], -1), { items: JOHN, index: 0 });

/* ═══ Speaking, and failing to speak ═════════════════ */

/**
 * Every case here used to resolve as though the words had been read out,
 * which is exactly how a phone with no working text-to-speech engine ran a
 * whole session in silence without ever saying why.
 */
async function speakingTests() {
  group('Speech out — a phone that will not speak says so');

  {
    const s = buildSpeaker({ noApi: true });
    check('no speech synthesis at all: supported() is false', s.Speaker.supported(), false);
    check('no speech synthesis at all: speak() reports it',
          await s.Speaker.speak('Question one.'), { spoke: false, code: 'no-api' });
  }

  {
    // The Android case: the API is there, the engine behind it is not, and
    // the utterance simply vanishes — no start, no end, no error.
    const s = buildSpeaker({ voices: [], onSpeak: function () { /* dropped */ } });
    const p = s.Speaker.speak('Question one.');
    await tick();
    s.clock.advance(5000);
    check('dropped utterance is a failure, not a success',
          await p, { spoke: false, code: 'no-start' });
    check('...and the reason blames the missing voices',
          /no text-to-speech voices installed/.test(
            speechFailureMessage('no-start', s.Speaker.diagnose('no-start'))), true);
  }

  {
    // The other Android case: an engine that reports the utterance finished
    // the moment it is handed over, having made no sound.
    const s = buildSpeaker({ voices: [], onSpeak: function (u) { u.onend(); } });
    check('an utterance that ends without ever starting is a failure',
          await s.Speaker.speak('Question one.'), { spoke: false, code: 'no-sound' });
    check('...and it is retried, since it costs nothing',
          (await s.Speaker.speak('Question two.')) && s.spoken.length, 2);
  }

  {
    // Chrome for Android refusing to speak without a tap behind it.
    const s = buildSpeaker({
      voices:  [{ lang: 'en-US', localService: true }],
      onSpeak: function (u) { u.onerror({ error: 'not-allowed' }); },
    });
    check('a blocked utterance reports why',
          await s.Speaker.speak('Question one.'), { spoke: false, code: 'not-allowed' });
    check('...and the reason points at the tap',
          /Repeat/.test(speechFailureMessage('not-allowed', s.Speaker.diagnose('not-allowed'))), true);
    check('...and the rest of the session does not wait on it again',
          (await s.Speaker.speak('Question two.')) && s.spoken.length, 1);
  }

  {
    let blocked = true;
    const s = buildSpeaker({
      voices: [{ lang: 'en-US', localService: true }],
      onSpeak: function (u, clock) {
        if (blocked) { u.onerror({ error: 'not-allowed' }); return; }
        u.onstart();
        clock.setTimeout(function () { u.onend(); }, 500);
      },
    });
    await s.Speaker.speak('Question one.');
    blocked = false;
    s.Speaker.reset();
    const p = s.Speaker.speak('Question one.');
    await tick();
    s.clock.advance(500);
    check('a tap clears the verdict and speaks again', await p, { spoke: true, code: null });
    check('...having cleared the queue first', s.synth.cancelled, 1);
  }

  {
    const s = buildSpeaker({
      voices:  [{ lang: 'en-US', localService: true }],
      onSpeak: function (u, clock) { u.onstart(); clock.setTimeout(function () { u.onend(); }, 900); },
    });
    const p = s.Speaker.speak('Question one.');
    await tick();
    s.clock.advance(900);
    check('a working engine still just works', await p, { spoke: true, code: null });
  }

  {
    // Stop, and the cancel() on the way out of a session, arrive as errors.
    const s = buildSpeaker({
      voices:  [{ lang: 'en-US', localService: true }],
      onSpeak: function (u) { u.onstart(); u.onerror({ error: 'interrupted' }); },
    });
    check('being interrupted is not an engine failure',
          await s.Speaker.speak('Question one.'), { spoke: true, code: null });
  }

  {
    const s = buildSpeaker({ voices: [], onSpeak: function () { /* dropped */ } });
    const p = s.Speaker.speak('One. Two. Three.');
    await tick();
    s.clock.advance(5000);
    await p;
    check('a dead engine is not handed the rest of the sentences', s.spoken.length, 1);
  }

  {
    const s = buildSpeaker({ voices: [], onSpeak: function (u) { u.onerror({ error: 'not-allowed' }); } });
    s.Speaker.prime();
    check('the unlock utterance goes out silently', s.spoken.length && s.spoken[0].volume, 0);
    check('...and what it learned is carried into the diagnosis',
          s.Speaker.diagnose('no-start').prime, 'not-allowed');
  }

  group('Speech out — the reason, in words and in a code');

  const androidNoVoices = { voices: 0, android: true };
  check('missing voice data names where to install it',
        /Settings → Accessibility → Text-to-speech output/.test(
          speechFailureMessage('no-start', androidNoVoices)), true);
  check('every message ends with the raw reason',
        /\[no-start · 0 voices\]$/.test(speechFailureMessage('no-start', androidNoVoices)), true);
  check('one voice is not "1 voices"',
        /1 voice\]/.test(speechFailureMessage('audio-busy', { voices: 1 })), true);
  check('an engine with voices that failed is not told to install voices',
        /no text-to-speech voices installed/.test(
          speechFailureMessage('no-start', { voices: 4, android: true })), false);
  check('an unknown code still reports itself',
        speechFailureMessage('wobbly', { voices: 2 }),
        'The text-to-speech engine could not read the text aloud. [wobbly · 2 voices]');
}

/* ─── Report ────────────────────────────────────────── */

function report() {
  console.log('');
  if (failures.length) {
    console.log('FAILURES\n');
    console.log(failures.join('\n\n'));
    console.log('');
  }
  console.log(pass + ' passed, ' + failures.length + ' failed');
  process.exit(failures.length ? 1 : 0);
}

speakingTests().then(report, function (err) {
  console.error('\nthe speech tests threw:\n', err);
  process.exit(1);
});

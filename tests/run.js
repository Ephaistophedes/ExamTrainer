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
// ...and the pure text-shaping helpers used for what gets spoken.
const speech = slice('function chunkForSpeech', '/* ─── Speech in (STT)');

const EXPORTS = [
  'normalizeSpeech', 'spokenNumbersToDigits', 'canonicalizeRefs', 'extractRefs',
  'matchSpokenAnswer', 'matchCommand', 'speakableAnswer', 'speakableQuestion',
  'chunkForSpeech',
];

const mod = { exports: {} };
new Function('module', 'exports', 'window',
  base + '\n' + audio + '\n' + speech +
  '\nmodule.exports = { ' + EXPORTS.join(', ') + ' };'
)(mod, mod.exports, {});

const {
  matchSpokenAnswer, matchCommand, speakableAnswer, speakableQuestion,
  chunkForSpeech, canonicalizeRefs, spokenNumbersToDigits,
} = mod.exports;

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

/* ─── Report ────────────────────────────────────────── */

console.log('');
if (failures.length) {
  console.log('FAILURES\n');
  console.log(failures.join('\n\n'));
  console.log('');
}
console.log(pass + ' passed, ' + failures.length + ' failed');
process.exit(failures.length ? 1 : 0);

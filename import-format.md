# JSON Import Format

Both exams and verses import/export from `.json` files containing a **top-level array**.
Each file becomes one exam (or one verse entry); the file name is used as a fallback title.

---

# Exams

The import file must be a `.json` file containing a **top-level array** of question objects.

## Minimal example

```json
[
  {
    "question": "What is the powerhouse of the cell?",
    "correct": ["mitochondria"]
  },
  {
    "question": "What is the chemical symbol for water?",
    "correct": ["H2O"]
  }
]
```

## Multi-part questions

Use multiple entries in the `correct` array when a question has several distinct answers. Each part is graded independently.

```json
[
  {
    "question": "Name the three states of matter.",
    "correct": ["solid", "liquid", "gas"]
  },
  {
    "question": "What are the products of photosynthesis?",
    "correct": ["glucose", "oxygen"]
  }
]
```

## Field reference

| Field | Type | Required | Notes |
|---|---|---|---|
| `question` | string | Yes | The question text shown to the user |
| `correct` | array of strings | Yes | One entry per answer part. Must have at least one entry. |

## Grading behaviour

- Answers are checked **case-insensitively** and with **whitespace trimmed**
- `"Mitochondria"`, `"mitochondria"`, and `"  MITOCHONDRIA  "` are all accepted
- Each part in a multi-part question is graded independently
- A question is fully correct only if **every part** matches

## Common mistakes

**Root is not an array** — the top level must be `[...]`, not `{...}`
```json
// ✗ Wrong
{ "questions": [ ... ] }

// ✓ Correct
[ ... ]
```

**`correct` is a string instead of an array**
```json
// ✗ Wrong
{ "question": "...", "correct": "mitochondria" }

// ✓ Correct
{ "question": "...", "correct": ["mitochondria"] }
```

**Empty `correct` array**
```json
// ✗ Wrong — must have at least one entry
{ "question": "...", "correct": [] }
```

---

# Verses

A verse file is a **top-level array** of verse objects. Each file becomes one verse entry
(which may hold several verses for back-to-back practice).

## Minimal example

```json
[
  { "ref": "John 3:16", "text": "For God so loved the world..." }
]
```

## Multiple verses in one entry

```json
[
  { "ref": "Psalm 23:1", "text": "The Lord is my shepherd; I shall not want." },
  { "ref": "Psalm 23:2", "text": "He makes me lie down in green pastures." }
]
```

## Field reference

| Field | Type | Required | Notes |
|---|---|---|---|
| `text` | string | Yes | The verse text to memorise |
| `ref` | string | No | Reference, e.g. `"John 3:16"`. Used to title the entry. |

## Title behaviour

- If any item has a `ref`, the entry is titled from those references (e.g. `"Psalm 23:1, Psalm 23:2"`).
- Otherwise the **file name** is used (e.g. `Psalm 23.json` → `"Psalm 23"`).
- Otherwise it falls back to an auto-number (`"Verse 1"`, `"Verse 2"`, …).

## Convenience

- A bare string is accepted as verse text with no reference: `["In the beginning..."]`.
- A single object (not wrapped in an array) is also accepted as a one-verse file.

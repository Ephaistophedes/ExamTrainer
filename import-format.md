# JSON Import Format

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

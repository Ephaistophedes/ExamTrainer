/* ═══════════════════════════════════════════════════════
   Exam Trainer — app.js
   ═══════════════════════════════════════════════════════ */

'use strict';

/* ═══════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════ */

function $(id) {
  return document.getElementById(id);
}

function pluralize(count, singular) {
  return count + ' ' + singular + (count !== 1 ? 's' : '');
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncate(text, maxLen) {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '…';
}

/* ─── Theme toggle ──────────────────────────────────── */

(function () {
  var btn  = $('theme-toggle');
  var root = document.documentElement;

  function applyTheme(dark) {
    if (dark) {
      root.setAttribute('data-theme', 'dark');
    } else {
      root.removeAttribute('data-theme');
    }
    btn.textContent = dark ? '\u2600\uFE0F' : '\uD83C\uDF19';
    btn.title       = dark ? 'Switch to light mode' : 'Switch to dark mode';
  }

  applyTheme(root.getAttribute('data-theme') === 'dark');

  btn.addEventListener('click', function () {
    var nowDark = root.getAttribute('data-theme') !== 'dark';
    applyTheme(nowDark);
    localStorage.setItem('theme', nowDark ? 'dark' : 'light');
  });
})();

/* ─── Alert helpers ─────────────────────────────────── */

const alertTimers = {};

function showAlert(id, msg) {
  const el = $(id);
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(alertTimers[id]);
  alertTimers[id] = setTimeout(function () { hideAlert(id); }, 6000);
}

function hideAlert(id) {
  $(id).classList.add('hidden');
}

/* ═══════════════════════════════════════════════════════
   STORAGE LAYER
   ═══════════════════════════════════════════════════════ */

const KEYS = {
  examBank:    'examBank',
  examHistory: 'examHistory',
  activeExam:  'activeExamId',
  editorDraft: 'editorDraft',
  verseBank:   'verseBank',
};

// Listeners notified whenever persisted app data changes (used by Drive sync).
const _stateListeners = [];
function emitStateChange() {
  _stateListeners.forEach(function (fn) { try { fn(); } catch (e) { /* ignore */ } });
}

function loadJSON(key, fallback) {
  try {
    const val = JSON.parse(localStorage.getItem(key));
    return val !== null ? val : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function loadExams() {
  return loadJSON(KEYS.examBank, []);
}

function saveExams(exams) {
  saveJSON(KEYS.examBank, exams);
  emitStateChange();
}

function loadHistory() {
  return loadJSON(KEYS.examHistory, []);
}

function saveHistory(history) {
  saveJSON(KEYS.examHistory, history);
  emitStateChange();
}

function getActiveExamId() {
  return localStorage.getItem(KEYS.activeExam) || null;
}

function setActiveExamId(id) {
  localStorage.setItem(KEYS.activeExam, id);
  emitStateChange();
}

function loadDraft() {
  return loadJSON(KEYS.editorDraft, null);
}

function saveDraft(draft) {
  saveJSON(KEYS.editorDraft, draft);
}

function clearDraft() {
  localStorage.removeItem(KEYS.editorDraft);
}

function getActiveExam() {
  const id = getActiveExamId();
  if (!id) return null;
  return loadExams().find(function (e) { return e.id === id; }) || null;
}

/* ─── Full app-state snapshot (for Drive sync / backup) ── */

const BACKUP_FORMAT = 1;

/** Serialise everything persisted locally into one backup object. */
function exportAppState() {
  return {
    _app: 'ExamTrainer',
    _format: BACKUP_FORMAT,
    exportedAt: new Date().toISOString(),
    data: {
      examBank:    loadExams(),
      examHistory: loadHistory(),
      verseBank:   loadVerses(),
      activeExamId: getActiveExamId(),
    },
  };
}

/**
 * Restore a backup object produced by exportAppState().
 * Replaces local state wholesale (this file is the source of truth).
 * Returns { ok, error }.
 */
function importAppState(backup) {
  if (!backup || typeof backup !== 'object' || !backup.data || typeof backup.data !== 'object') {
    return { ok: false, error: 'Not a valid Exam Trainer backup file.' };
  }
  const d = backup.data;
  if (!Array.isArray(d.examBank)) {
    return { ok: false, error: 'Backup is missing the exam list.' };
  }

  // Write through the normal storage layer so listeners fire as expected.
  saveExams(d.examBank);
  saveHistory(Array.isArray(d.examHistory) ? d.examHistory : []);
  saveVerses(Array.isArray(d.verseBank) ? d.verseBank : []);
  if (d.activeExamId && d.examBank.some(function (e) { return e.id === d.activeExamId; })) {
    setActiveExamId(d.activeExamId);
  } else {
    localStorage.removeItem(KEYS.activeExam);
  }

  // Refresh whatever is on screen.
  refreshAllViews();
  return { ok: true };
}

/** Re-render the currently visible tab after a bulk state change. */
function refreshAllViews() {
  try { renderExamList(); } catch (e) {}
  try { renderTrainer(); } catch (e) {}
  try { renderVerseList(); } catch (e) {}
  const histTab = document.getElementById('tab-history');
  if (histTab && histTab.classList.contains('active')) {
    try { renderHistory(); } catch (e) {}
  }
}

// Public surface consumed by drive-sync.js (loaded after this file).
window.ExamTrainerState = {
  export: exportAppState,
  import: importAppState,
  onChange: function (fn) { if (typeof fn === 'function') _stateListeners.push(fn); },
};

/* ─── ID Generators ─────────────────────────────────── */

function generateExamId() {
  return 'exam_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}

let _qidSeq = Date.now() + Math.floor(Math.random() * 1e9);

function generateQid() {
  return ++_qidSeq;
}

/* ═══════════════════════════════════════════════════════
   TAB SWITCHING
   ═══════════════════════════════════════════════════════ */

const tabBtns     = document.querySelectorAll('.tab-btn');
const tabSections = document.querySelectorAll('.tab-content');

tabBtns.forEach(function (btn) {
  btn.addEventListener('click', function () {
    const target = btn.dataset.tab;

    tabBtns.forEach(function (b) {
      b.classList.toggle('active', b === btn);
      b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
    });

    tabSections.forEach(function (s) { s.classList.remove('active'); });
    $('tab-' + target).classList.add('active');

    if (target === 'history') renderHistory();
    if (target === 'verses') renderVerseList();
  });
});

// Keep tab-nav sticky top aligned to actual header height (handles any screen size / font scaling)
function updateTabNavTop() {
  const h = document.querySelector('header');
  const nav = document.querySelector('.tab-nav');
  if (h && nav) nav.style.top = h.offsetHeight + 'px';
}
updateTabNavTop();
window.addEventListener('resize', updateTabNavTop);

/* ═══════════════════════════════════════════════════════
   TAB 1 — EXAMS
   ═══════════════════════════════════════════════════════ */

function renderExamList() {
  const exams    = loadExams();
  const activeId = getActiveExamId();
  const history  = loadHistory();
  const list     = $('exam-list');
  const noExams  = $('no-exams');

  list.innerHTML = '';

  if (exams.length === 0) {
    noExams.classList.remove('hidden');
    return;
  }

  noExams.classList.add('hidden');

  exams.forEach(function (exam) {
    const isActive    = exam.id === activeId;
    const attempts    = history.filter(function (a) { return a.examId === exam.id; });
    const lastAttempt = attempts[attempts.length - 1];
    const lastScore   = lastAttempt
      ? 'Last: ' + lastAttempt.percent + '%'
      : 'No attempts yet';

    const card = document.createElement('div');
    card.className = 'exam-card' + (isActive ? ' active-exam' : '');

    card.innerHTML =
      '<div class="exam-card-info">' +
        '<div class="exam-card-name">' + esc(exam.name) + '</div>' +
        '<div class="exam-card-meta">' +
          '<span>' + pluralize(exam.questions.length, 'question') + '</span>' +
          '<span>' + lastScore + '</span>' +
        '</div>' +
      '</div>' +
      (isActive ? '<span class="active-badge">Active</span>' : '') +
      '<div class="exam-card-actions">' +
        (!isActive
          ? '<button class="btn btn-primary" data-action="activate" data-id="' + esc(exam.id) + '">Set Active</button>'
          : ''
        ) +
        '<button class="btn btn-secondary" data-action="edit" data-id="' + esc(exam.id) + '">Edit</button>' +
        '<button class="btn btn-ghost" data-action="delete" data-id="' + esc(exam.id) + '">Delete</button>' +
      '</div>';

    card.querySelectorAll('[data-action]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        handleExamAction(btn.dataset.action, btn.dataset.id);
      });
    });

    list.appendChild(card);
  });
}

function handleExamAction(action, id) {
  if (action === 'activate') {
    setActiveExamId(id);
    renderExamList();
    renderTrainer();

  } else if (action === 'edit') {
    openEditor(id);

  } else if (action === 'delete') {
    const exam = loadExams().find(function (e) { return e.id === id; });
    const name = exam ? '"' + exam.name + '"' : 'this exam';
    showConfirm('Delete ' + name + '? This cannot be undone.', 'Delete', function () {
      const updated = loadExams().filter(function (e) { return e.id !== id; });
      saveExams(updated);
      if (getActiveExamId() === id) {
        localStorage.removeItem(KEYS.activeExam);
        renderTrainer();
      }
      renderExamList();
    });
  }
}

/* ─── JSON Import ───────────────────────────────────── */

$('btn-import').addEventListener('click', function () {
  $('import-file').click();
});

$('import-file').addEventListener('change', function (e) {
  const files = Array.from(e.target.files);
  if (!files.length) return;

  const exams    = loadExams();
  const errors   = [];
  let   imported = 0;
  let   done     = 0;

  files.forEach(function (file) {
    const reader = new FileReader();
    reader.onload = function (ev) {
      try {
        const raw    = JSON.parse(ev.target.result);
        const result = validateImport(raw);

        if (!result.ok) {
          errors.push('"' + file.name + '": ' + result.error);
        } else {
          const name = file.name.replace(/\.json$/i, '').replace(/[-_]/g, ' ').trim();
          exams.push({
            id:        generateExamId(),
            name:      name || 'Imported Exam',
            created:   new Date().toISOString().slice(0, 10),
            questions: result.questions,
          });
          imported++;
        }
      } catch {
        errors.push('"' + file.name + '": could not parse — make sure it is valid JSON.');
      }

      if (++done === files.length) {
        saveExams(exams);
        renderExamList();

        if (errors.length) {
          showAlert('import-error', errors.join(' | '));
        } else {
          hideAlert('import-error');
        }

        if (imported > 0) {
          showAlert('import-success',
            'Imported ' + pluralize(imported, 'exam') + '.' +
            (errors.length ? ' ' + pluralize(errors.length, 'file') + ' had errors.' : ''));
        } else {
          hideAlert('import-success');
        }
      }
    };
    reader.readAsText(file);
  });

  e.target.value = '';
});

function validateImport(data) {
  if (!Array.isArray(data)) {
    return { ok: false, error: 'Root must be a JSON array.' };
  }
  if (data.length === 0) {
    return { ok: false, error: 'The array is empty.' };
  }

  for (let i = 0; i < data.length; i++) {
    const q     = data[i];
    const label = 'Item ' + (i + 1);

    if (typeof q !== 'object' || q === null) {
      return { ok: false, error: label + ' is not an object.' };
    }
    if (typeof q.question !== 'string' || !q.question.trim()) {
      return { ok: false, error: label + ' is missing a "question" string.' };
    }
    if (!Array.isArray(q.correct) || q.correct.length === 0) {
      return { ok: false, error: label + ' needs a "correct" array with at least one entry.' };
    }
    for (let j = 0; j < q.correct.length; j++) {
      if (typeof q.correct[j] !== 'string') {
        return { ok: false, error: label + ', correct[' + j + '] must be a string.' };
      }
    }
  }

  const questions = data.map(function (q, i) {
    return {
      id:       i + 1,
      question: q.question.trim(),
      correct:  q.correct.map(function (c) { return String(c).trim(); }),
    };
  });

  return { ok: true, questions: questions };
}

/* ─── JSON Export ───────────────────────────────────── */

$('btn-export').addEventListener('click', openExportModal);
$('export-close').addEventListener('click', closeExportModal);
$('btn-cancel-export').addEventListener('click', closeExportModal);
$('export-backdrop').addEventListener('click', closeExportModal);

let exportFolderHandle = null;
const supportsDirectoryPicker = typeof window.showDirectoryPicker === 'function';

if (!supportsDirectoryPicker) {
  $('btn-choose-folder').disabled = true;
  $('btn-choose-folder').title = 'Your browser does not support choosing a folder. Files will be saved to the default Downloads folder.';
}

$('btn-choose-folder').addEventListener('click', async function () {
  if (!supportsDirectoryPicker) return;
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    exportFolderHandle = handle;
    const nameEl = $('export-folder-name');
    nameEl.textContent = handle.name;
    nameEl.classList.add('is-custom');
  } catch (err) {
    if (err && err.name !== 'AbortError') console.error(err);
  }
});

function resetExportFolder() {
  exportFolderHandle = null;
  const nameEl = $('export-folder-name');
  nameEl.textContent = 'Downloads folder (default)';
  nameEl.classList.remove('is-custom');
}

function openExportModal() {
  const exams = loadExams();
  const list  = $('export-exam-list');
  list.innerHTML = '';

  resetExportFolder();

  if (exams.length === 0) {
    list.innerHTML = '<p style="color:var(--text-muted);font-size:0.9rem;">No exams to export.</p>';
    $('btn-do-export').disabled = true;
    $('export-select-all').checked = false;
    $('export-selected-count').textContent = '0 selected';
    $('export-modal').classList.remove('hidden');
    return;
  }

  exams.forEach(function (exam) {
    const item = document.createElement('label');
    item.className = 'export-exam-item';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = exam.id;

    cb.addEventListener('change', updateExportState);

    const info = document.createElement('div');
    info.className = 'export-exam-item-info';
    info.innerHTML =
      '<div class="export-exam-item-name">' + esc(exam.name) + '</div>' +
      '<div class="export-exam-item-meta">' + pluralize(exam.questions.length, 'question') + '</div>';

    item.appendChild(cb);
    item.appendChild(info);
    list.appendChild(item);
  });

  $('export-select-all').checked = false;
  updateExportState();
  $('export-modal').classList.remove('hidden');
}

function closeExportModal() {
  $('export-modal').classList.add('hidden');
}

function updateExportState() {
  const checkboxes = $('export-exam-list').querySelectorAll('input[type="checkbox"]');
  let checked = 0;
  checkboxes.forEach(function (cb) {
    cb.closest('.export-exam-item').classList.toggle('selected', cb.checked);
    if (cb.checked) checked++;
  });

  $('export-selected-count').textContent = checked + ' selected';
  $('btn-do-export').disabled = checked === 0;

  const allChecked = checkboxes.length > 0 && checked === checkboxes.length;
  const someChecked = checked > 0 && checked < checkboxes.length;
  const selectAll = $('export-select-all');
  selectAll.checked = allChecked;
  selectAll.indeterminate = someChecked;
}

$('export-select-all').addEventListener('change', function () {
  const checkboxes = $('export-exam-list').querySelectorAll('input[type="checkbox"]');
  checkboxes.forEach(function (cb) { cb.checked = $('export-select-all').checked; });
  updateExportState();
});

$('btn-do-export').addEventListener('click', async function () {
  const exams      = loadExams();
  const checkboxes = $('export-exam-list').querySelectorAll('input[type="checkbox"]:checked');
  const selectedIds = Array.from(checkboxes).map(function (cb) { return cb.value; });
  const btn = $('btn-do-export');

  const selectedExams = selectedIds
    .map(function (id) { return exams.find(function (e) { return e.id === id; }); })
    .filter(Boolean);

  if (exportFolderHandle) {
    btn.disabled = true;
    try {
      for (const exam of selectedExams) {
        const payload = exam.questions.map(function (q) {
          return { question: q.question, correct: q.correct };
        });
        const fileName = exam.name.replace(/[<>:"/\\|?*]/g, '_') + '.json';
        const fileHandle = await exportFolderHandle.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(payload, null, 2));
        await writable.close();
      }
    } catch (err) {
      console.error('Export to folder failed:', err);
      alert('Could not write to the chosen folder: ' + (err && err.message ? err.message : err));
      btn.disabled = false;
      return;
    }
    btn.disabled = false;
  } else {
    selectedExams.forEach(function (exam) {
      const payload = exam.questions.map(function (q) {
        return { question: q.question, correct: q.correct };
      });

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = exam.name.replace(/[<>:"/\\|?*]/g, '_') + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  closeExportModal();
});

/* ═══════════════════════════════════════════════════════
   EXAM EDITOR MODAL
   ═══════════════════════════════════════════════════════ */

let editingExamId = null;

$('btn-create').addEventListener('click', function () { openEditor(null); });
$('editor-close').addEventListener('click', closeEditor);
$('btn-cancel-editor').addEventListener('click', closeEditor);
$('editor-backdrop').addEventListener('click', closeEditor);

function openEditor(examId) {
  editingExamId = examId;
  $('editor-title').textContent = examId ? 'Edit Exam' : 'Create New Exam';

  const draft    = loadDraft();
  const draftKey = examId || '__new__';
  let exam;

  if (draft && draft.examId === draftKey) {
    exam = draft.exam;
  } else if (examId) {
    exam = loadExams().find(function (e) { return e.id === examId; });
    if (!exam) return;
  } else {
    exam = { name: '', questions: [blankQuestion()] };
  }

  $('editor-name').value = exam.name;
  renderEditorQuestions(exam.questions);

  $('editor-modal').classList.remove('hidden');
  $('editor-name').focus();
}

function closeEditor() {
  $('editor-modal').classList.add('hidden');
  editingExamId = null;
}

/* ─── Editor question/part building ────────────────── */

function blankQuestion() {
  return { id: generateQid(), question: '', correct: [''] };
}

function renderEditorQuestions(questions) {
  const container = $('editor-questions');
  container.innerHTML = '';
  questions.forEach(function (q, i) {
    if (q.type === 'fill_blank') {
      container.appendChild(createFillBlankEditorRow(q, i));
    } else {
      container.appendChild(createEditorRow(q, i));
    }
  });
  initDragAndDrop();
}

function createEditorRow(q, idx) {
  const row = document.createElement('div');
  row.className   = 'editor-q-row';
  row.dataset.qid = q.id;

  const partsHtml = q.correct.map(function (ans, pi) {
    return buildPartRowHtml(ans, pi, q.correct.length);
  }).join('');

  row.innerHTML =
    '<div class="editor-q-header">' +
      '<span class="drag-handle" draggable="true" title="Drag to reorder" aria-hidden="true">⠿</span>' +
      '<span class="editor-q-label">Question ' + (idx + 1) + '</span>' +
      '<button class="btn btn-ghost btn-remove-q" type="button" title="Remove question">✕ Remove</button>' +
    '</div>' +
    '<div class="form-group" style="margin-bottom:0.625rem;">' +
      '<input type="text" class="input editor-q-text"' +
        ' placeholder="Enter question text…"' +
        ' value="' + esc(q.question) + '"' +
        ' autocomplete="off">' +
    '</div>' +
    '<div class="editor-q-parts">' + partsHtml + '</div>' +
    '<button class="btn-add-part" type="button">+ Add Part</button>';

  row.querySelector('.btn-remove-q').addEventListener('click', function () {
    row.remove();
    renumberEditorRows();
    autoSaveDraft();
  });

  row.querySelector('.btn-add-part').addEventListener('click', function () {
    appendPartRow(row);
    autoSaveDraft();
  });

  row.querySelectorAll('.btn-remove-part').forEach(function (btn) {
    btn.addEventListener('click', function () {
      btn.closest('.editor-part-row').remove();
      relabelParts(row);
      autoSaveDraft();
    });
  });

  row.addEventListener('input', autoSaveDraft);

  return row;
}

function buildPartRowHtml(value, partIdx, totalParts) {
  const showRemove = totalParts > 1 ? '' : 'style="visibility:hidden;"';
  return (
    '<div class="editor-part-row">' +
      '<span class="editor-part-label">Answer ' + (partIdx + 1) + '</span>' +
      '<input type="text" class="input editor-part-input"' +
        ' placeholder="Correct answer…"' +
        ' value="' + esc(value) + '"' +
        ' autocomplete="off">' +
      '<button class="btn-remove-part" type="button" title="Remove part" ' + showRemove + '>✕</button>' +
    '</div>'
  );
}

function appendPartRow(row) {
  const partsContainer = row.querySelector('.editor-q-parts');
  const count   = partsContainer.querySelectorAll('.editor-part-row').length;
  const partRow = document.createElement('div');
  partRow.className = 'editor-part-row';
  partRow.innerHTML =
    '<span class="editor-part-label">Answer ' + (count + 1) + '</span>' +
    '<input type="text" class="input editor-part-input"' +
      ' placeholder="Correct answer…"' +
      ' autocomplete="off">' +
    '<button class="btn-remove-part" type="button" title="Remove part">✕</button>';

  partsContainer.appendChild(partRow);

  partRow.querySelector('.btn-remove-part').addEventListener('click', function () {
    partRow.remove();
    relabelParts(row);
    autoSaveDraft();
  });

  const input = partRow.querySelector('.editor-part-input');
  input.addEventListener('input', autoSaveDraft);
  input.focus();

  relabelParts(row);
}

function relabelParts(row) {
  const partRows = row.querySelectorAll('.editor-part-row');
  partRows.forEach(function (pr, i) {
    pr.querySelector('.editor-part-label').textContent = 'Answer ' + (i + 1);
    const rmBtn = pr.querySelector('.btn-remove-part');
    if (rmBtn) rmBtn.style.visibility = partRows.length > 1 ? '' : 'hidden';
  });
}

function renumberEditorRows() {
  document.querySelectorAll('.editor-q-row').forEach(function (row, i) {
    const label = row.querySelector('.editor-q-label');
    if (!label) return;
    if (row.dataset.type === 'fill_blank') {
      label.innerHTML = 'Question ' + (i + 1) +
        ' <span class="fib-badge">Fill in the Blanks</span>';
    } else {
      label.textContent = 'Question ' + (i + 1);
    }
  });
}

/* ─── Fill-in-the-Blanks editor row ─────────────────── */

function blankFillQuestion() {
  return { id: generateQid(), type: 'fill_blank', sentence: '', correct: [] };
}

function createFillBlankEditorRow(q, idx) {
  const row = document.createElement('div');
  row.className   = 'editor-q-row editor-q-fill-blank';
  row.dataset.qid  = q.id;
  row.dataset.type = 'fill_blank';

  // Parse existing sentence to find which word positions are blanks
  const blankIndices = new Set();
  let cleanSentence = '';
  if (q.sentence) {
    const rawTokens = q.sentence.split(/\s+/).filter(Boolean);
    rawTokens.forEach(function (token, i) {
      if (token.startsWith('[[') && token.endsWith(']]')) {
        blankIndices.add(i);
      }
    });
    cleanSentence = q.sentence.replace(/\[\[([^\]]+)\]\]/g, '$1');
  }

  row.innerHTML =
    '<div class="editor-q-header">' +
      '<span class="drag-handle" draggable="true" title="Drag to reorder" aria-hidden="true">⠿</span>' +
      '<span class="editor-q-label">Question ' + (idx + 1) +
        ' <span class="fib-badge">Fill in the Blanks</span></span>' +
      '<button class="btn btn-ghost btn-remove-q" type="button" title="Remove question">✕ Remove</button>' +
    '</div>' +
    '<div class="form-group" style="margin-bottom:0.5rem;">' +
      '<textarea class="input fib-sentence-input" rows="3"' +
        ' placeholder="Type the full sentence here…"' +
        ' autocomplete="off">' + esc(cleanSentence) + '</textarea>' +
    '</div>' +
    '<div class="fib-words-hint">Click words to mark them as blanks:</div>' +
    '<div class="fib-words-container"></div>' +
    '<div class="fib-preview-row">' +
      '<span class="fib-preview-label">Preview:</span> ' +
      '<span class="fib-preview-text"></span>' +
    '</div>';

  function updatePreview() {
    const words = Array.from(row.querySelectorAll('.fib-word'));
    const parts = words.map(function (span) {
      return span.classList.contains('fib-blank') ? '___' : span.dataset.word;
    });
    row.querySelector('.fib-preview-text').textContent = parts.join(' ');
  }

  function renderWordTokens() {
    const text = row.querySelector('.fib-sentence-input').value.trim();
    const container = row.querySelector('.fib-words-container');
    container.innerHTML = '';

    if (!text) {
      row.querySelector('.fib-preview-text').textContent = '';
      return;
    }

    const words = text.split(/\s+/).filter(Boolean);
    words.forEach(function (word, i) {
      const span = document.createElement('span');
      span.className = 'fib-word' + (blankIndices.has(i) ? ' fib-blank' : '');
      span.textContent = word;
      span.dataset.word = word;
      span.dataset.idx  = i;

      span.addEventListener('click', function () {
        if (blankIndices.has(i)) {
          blankIndices.delete(i);
          span.classList.remove('fib-blank');
        } else {
          blankIndices.add(i);
          span.classList.add('fib-blank');
        }
        updatePreview();
        autoSaveDraft();
      });

      container.appendChild(span);
    });

    updatePreview();
  }

  // Debounce textarea re-tokenisation
  let debounceTimer = null;
  row.querySelector('.fib-sentence-input').addEventListener('input', function () {
    blankIndices.clear();
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      renderWordTokens();
      autoSaveDraft();
    }, 250);
  });

  row.querySelector('.btn-remove-q').addEventListener('click', function () {
    row.remove();
    renumberEditorRows();
    autoSaveDraft();
  });

  renderWordTokens();
  return row;
}

/* ─── Add Question / Add Fill-in-the-Blanks buttons ─── */

$('btn-add-question').addEventListener('click', function () {
  const container = $('editor-questions');
  const idx = container.querySelectorAll('.editor-q-row').length;
  container.appendChild(createEditorRow(blankQuestion(), idx));
  autoSaveDraft();
});

$('btn-add-fill-blank').addEventListener('click', function () {
  const container = $('editor-questions');
  const idx = container.querySelectorAll('.editor-q-row').length;
  container.appendChild(createFillBlankEditorRow(blankFillQuestion(), idx));
  autoSaveDraft();
});

/* ─── Auto-save draft ───────────────────────────────── */

$('editor-name').addEventListener('input', autoSaveDraft);

function autoSaveDraft() {
  try {
    const state    = getEditorState();
    const draftKey = editingExamId || '__new__';
    saveDraft({ examId: draftKey, exam: state });
  } catch {
    // Editor might not be fully rendered yet
  }
}

function getEditorState() {
  const name = $('editor-name').value.trim();
  const rows = document.querySelectorAll('.editor-q-row');

  const questions = Array.from(rows).map(function (row) {
    const qid = row.dataset.qid;
    const id  = isNaN(qid) ? qid : Number(qid);

    if (row.dataset.type === 'fill_blank') {
      const wordEls = row.querySelectorAll('.fib-word');
      const sentenceParts = [];
      const correct = [];
      const questionParts = [];

      wordEls.forEach(function (el) {
        const word    = el.dataset.word;
        const isBlank = el.classList.contains('fib-blank');
        if (isBlank) {
          sentenceParts.push('[[' + word + ']]');
          correct.push(word);
          questionParts.push('___');
        } else {
          sentenceParts.push(word);
          questionParts.push(word);
        }
      });

      // If no tokens rendered yet, fall back to raw textarea value
      const sentence  = sentenceParts.length ? sentenceParts.join(' ')
        : row.querySelector('.fib-sentence-input').value.trim();
      const question  = questionParts.length ? questionParts.join(' ') : sentence;

      return { id: id, type: 'fill_blank', sentence: sentence, question: question, correct: correct };
    }

    const question   = row.querySelector('.editor-q-text').value.trim();
    const partInputs = row.querySelectorAll('.editor-part-input');

    const correct = Array.from(partInputs)
      .map(function (inp) { return inp.value.trim(); })
      .filter(function (v) { return v !== ''; });

    return { id: id, question: question, correct: correct.length ? correct : [''] };
  });

  return { name: name, questions: questions };
}

/* ─── Save Exam ─────────────────────────────────────── */

$('btn-save-exam').addEventListener('click', function () {
  const state = getEditorState();

  if (!state.name) {
    showAlert('editor-alert', 'Please enter an exam name.');
    $('editor-name').focus();
    return;
  }
  if (state.questions.length === 0) {
    showAlert('editor-alert', 'Please add at least one question.');
    return;
  }
  const emptyQ = state.questions.find(function (q) { return !q.question; });
  if (emptyQ) {
    showAlert('editor-alert', 'Every question needs question text. Please fill in all question fields.');
    return;
  }
  const noBlankQ = state.questions.find(function (q) {
    return q.type === 'fill_blank' && q.correct.length === 0;
  });
  if (noBlankQ) {
    showAlert('editor-alert', 'Fill in the Blanks questions need at least one blank. Click a word to mark it as a blank.');
    return;
  }
  hideAlert('editor-alert');

  const exams = loadExams();

  if (editingExamId) {
    const idx = exams.findIndex(function (e) { return e.id === editingExamId; });
    if (idx >= 0) {
      exams[idx] = {
        ...exams[idx],
        name:      state.name,
        questions: state.questions,
      };
    }
  } else {
    exams.push({
      id:        generateExamId(),
      name:      state.name,
      created:   new Date().toISOString().slice(0, 10),
      questions: state.questions,
    });
  }

  saveExams(exams);
  clearDraft();
  closeEditor();
  renderExamList();
  renderTrainer();
  renderHistory();
});

window.addEventListener('beforeunload', function () {
  if (!$('editor-modal').classList.contains('hidden')) {
    autoSaveDraft();
  }
});

/* ═══════════════════════════════════════════════════════
   DRAG AND DROP (editor question rows)
   ═══════════════════════════════════════════════════════ */

let _editorDragCleanup = null;

function initDragAndDrop() {
  if (_editorDragCleanup) {
    _editorDragCleanup();
    _editorDragCleanup = null;
  }

  const container = $('editor-questions');
  let dragSrc = null;

  function onDragStart(e) {
    if (!e.target.classList.contains('drag-handle')) return;
    const row = e.target.closest('.editor-q-row');
    if (!row) return;
    dragSrc = row;
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  }

  function onDragEnd(e) {
    const row = e.target.closest('.editor-q-row');
    if (row) row.classList.remove('dragging');
    container.querySelectorAll('.editor-q-row').forEach(function (r) {
      r.classList.remove('drag-over');
    });
    renumberEditorRows();
    autoSaveDraft();
    dragSrc = null;
  }

  function onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const row = e.target.closest('.editor-q-row');
    if (row && row !== dragSrc) {
      container.querySelectorAll('.editor-q-row').forEach(function (r) {
        r.classList.remove('drag-over');
      });
      row.classList.add('drag-over');
    }
  }

  function onDragLeave(e) {
    if (!container.contains(e.relatedTarget)) {
      container.querySelectorAll('.editor-q-row').forEach(function (r) {
        r.classList.remove('drag-over');
      });
    }
  }

  function onDrop(e) {
    e.preventDefault();
    const row = e.target.closest('.editor-q-row');
    if (row) row.classList.remove('drag-over');
    if (!row || !dragSrc || row === dragSrc) return;

    const rows   = [...container.querySelectorAll('.editor-q-row')];
    const srcIdx = rows.indexOf(dragSrc);
    const tgtIdx = rows.indexOf(row);

    if (srcIdx < tgtIdx) {
      container.insertBefore(dragSrc, row.nextSibling);
    } else {
      container.insertBefore(dragSrc, row);
    }
  }

  container.addEventListener('dragstart', onDragStart);
  container.addEventListener('dragend',   onDragEnd);
  container.addEventListener('dragover',  onDragOver);
  container.addEventListener('dragleave', onDragLeave);
  container.addEventListener('drop',      onDrop);

  _editorDragCleanup = function () {
    container.removeEventListener('dragstart', onDragStart);
    container.removeEventListener('dragend',   onDragEnd);
    container.removeEventListener('dragover',  onDragOver);
    container.removeEventListener('dragleave', onDragLeave);
    container.removeEventListener('drop',      onDrop);
  };
}

/* ═══════════════════════════════════════════════════════
   CONFIRM DIALOG
   ═══════════════════════════════════════════════════════ */

let _confirmCallback = null;

function showConfirm(message, actionLabel, callback) {
  _confirmCallback = callback;
  $('confirm-message').textContent = message;
  $('btn-confirm-yes').textContent = actionLabel || 'Confirm';
  $('confirm-modal').classList.remove('hidden');
}

function dismissConfirm() {
  $('confirm-modal').classList.add('hidden');
  _confirmCallback = null;
}

$('btn-confirm-yes').addEventListener('click', function () {
  $('confirm-modal').classList.add('hidden');
  if (typeof _confirmCallback === 'function') _confirmCallback();
  _confirmCallback = null;
});

$('btn-confirm-no').addEventListener('click', dismissConfirm);
$('confirm-backdrop').addEventListener('click', dismissConfirm);

/* ═══════════════════════════════════════════════════════
   TAB 2 — TRAINER
   ═══════════════════════════════════════════════════════ */

let trainerMode       = 'full';
let currentQuestions   = [];
let examSubmitted      = false;
let customSelectedIds  = new Set();
let weakPartsOnly      = false;   // weak mode: drill only previously-missed sub-parts
let activeParts        = {};      // qid -> [original part indices] to practise this session

// Self-mark state
let selfMarkResults       = {};
let selfMarkUserAnswers   = [];
let selfMarkQuestionsSnap = [];

/* ─── Trainer UI reset ─────────────────────────────── */

function resetTrainerUI() {
  examSubmitted = false;
  $('results-panel').classList.add('hidden');
  $('question-picker').classList.add('hidden');
  $('self-mark-view').classList.add('hidden');
  $('self-mark-bottom-bar').classList.add('hidden');
  $('trainer-content').classList.remove('hidden');

  const submitBtn = $('btn-submit');
  submitBtn.disabled    = false;
  submitBtn.textContent = 'Submit';
  $('btn-submit-mark').disabled = false;
}

/* ─── Render Trainer tab ────────────────────────────── */

function renderTrainer() {
  const exam    = getActiveExam();
  const noExam  = $('trainer-no-exam');
  const content = $('trainer-content');

  if (!exam) {
    noExam.classList.remove('hidden');
    content.classList.add('hidden');
    return;
  }

  noExam.classList.add('hidden');
  content.classList.remove('hidden');
  $('trainer-exam-name').textContent = exam.name;

  customSelectedIds.clear();
  startTrainer();
}

/* ─── Mode toggle ───────────────────────────────────── */

$('mode-full').addEventListener('click', function ()   { switchMode('full'); });
$('mode-weak').addEventListener('click', function ()   { switchMode('weak'); });
$('mode-custom').addEventListener('click', function () { switchMode('custom'); });

$('weak-parts-check').addEventListener('change', function () {
  weakPartsOnly = this.checked;
  if (trainerMode === 'weak') startTrainer();
});

function switchMode(mode) {
  trainerMode = mode;
  $('mode-full').classList.toggle('active', mode === 'full');
  $('mode-weak').classList.toggle('active', mode === 'weak');
  $('mode-custom').classList.toggle('active', mode === 'custom');

  // The "sub-questions only" option is only meaningful when reviewing weak areas.
  $('weak-parts-toggle').classList.toggle('hidden', mode !== 'weak');

  if (mode === 'custom') {
    const exam = getActiveExam();
    if (!exam) return;
    resetTrainerUI();
    $('question-list').innerHTML = '';
    clearInlineNotice();
    renderQuestionPicker(exam);
  } else {
    $('question-picker').classList.add('hidden');
    startTrainer();
  }
}

/* ─── Start / reset trainer ─────────────────────────── */

function startTrainer() {
  resetTrainerUI();

  const exam = getActiveExam();
  if (!exam) return;

  if (trainerMode === 'weak') {
    currentQuestions = getWeakQuestions(exam);
    if (currentQuestions.length === 0) {
      currentQuestions = [...exam.questions];
      showInlineNotice('No weak areas found yet — showing full exam.');
    } else {
      clearInlineNotice();
    }
  } else if (trainerMode === 'custom') {
    currentQuestions = exam.questions.filter(function (q) {
      return customSelectedIds.has(q.id);
    });
    clearInlineNotice();
  } else {
    currentQuestions = [...exam.questions];
    clearInlineNotice();
  }

  computeActiveParts(exam);

  // Tell the user when we've trimmed multi-part questions down to the misses.
  if (trainerMode === 'weak' && weakPartsOnly) {
    const trimmed = currentQuestions.some(function (q) {
      return (activeParts[q.id] || q.correct).length < q.correct.length;
    });
    if (trimmed) {
      showInlineNotice('Drilling only the sub-questions you’ve missed before.');
    }
  }

  renderQuestions(currentQuestions);
}

/* ─── Question Picker ───────────────────────────────── */

let _pickerDragCleanup = null;

function renderQuestionPicker(exam) {
  const picker = $('question-picker');
  const grid   = $('picker-grid');

  if (_pickerDragCleanup) {
    _pickerDragCleanup();
    _pickerDragCleanup = null;
  }

  if (customSelectedIds.size === 0) {
    exam.questions.forEach(function (q) { customSelectedIds.add(q.id); });
  }

  grid.innerHTML = '';

  let dragActive = false;
  let dragAction = null;
  const dragVisited = new Set();

  exam.questions.forEach(function (q, i) {
    const box = document.createElement('button');
    box.type        = 'button';
    box.className   = 'q-pick-box' + (customSelectedIds.has(q.id) ? ' selected' : '');
    box.textContent = i + 1;
    box.title       = q.question;
    box.dataset.qid = String(q.id);

    box.addEventListener('click', function () {
      if (dragVisited.has(q.id)) return;
      if (customSelectedIds.has(q.id)) {
        customSelectedIds.delete(q.id);
        box.classList.remove('selected');
      } else {
        customSelectedIds.add(q.id);
        box.classList.add('selected');
      }
      updatePickerCount(exam);
    });

    grid.appendChild(box);
  });

  // Drag-select support
  function applyDragToBox(box) {
    const qid = Number(box.dataset.qid);
    if (dragVisited.has(qid)) return;
    dragVisited.add(qid);
    if (dragAction) {
      customSelectedIds.add(qid);
      box.classList.add('selected');
    } else {
      customSelectedIds.delete(qid);
      box.classList.remove('selected');
    }
    updatePickerCount(exam);
  }

  function onDragMove(e) {
    if (!dragActive) return;
    const el  = document.elementFromPoint(e.clientX, e.clientY);
    const box = el && el.closest('.q-pick-box');
    if (box && grid.contains(box)) applyDragToBox(box);
  }

  function onDragEnd() {
    dragActive = false;
    grid.classList.remove('drag-selecting');
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
    setTimeout(function () { dragVisited.clear(); }, 0);
  }

  function onMouseDown(e) {
    const box = e.target.closest('.q-pick-box');
    if (!box) return;
    e.preventDefault();
    dragActive = true;
    grid.classList.add('drag-selecting');
    dragVisited.clear();
    dragAction = !customSelectedIds.has(Number(box.dataset.qid));
    applyDragToBox(box);
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
  }

  grid.addEventListener('mousedown', onMouseDown);
  _pickerDragCleanup = function () {
    grid.removeEventListener('mousedown', onMouseDown);
  };

  updatePickerCount(exam);
  picker.classList.remove('hidden');
}

function updatePickerCount(exam) {
  const count = customSelectedIds.size;
  const total = exam.questions.length;

  let label;
  if (count === total) {
    label = 'All ' + total + ' selected';
  } else if (count === 0) {
    label = 'None selected';
  } else {
    label = count + ' / ' + total + ' selected';
  }

  $('picker-count').textContent = label;
}

$('btn-pick-all').addEventListener('click', function () {
  const exam = getActiveExam();
  if (!exam) return;
  exam.questions.forEach(function (q) { customSelectedIds.add(q.id); });
  document.querySelectorAll('.q-pick-box').forEach(function (b) {
    b.classList.add('selected');
  });
  updatePickerCount(exam);
});

$('btn-pick-none').addEventListener('click', function () {
  const exam = getActiveExam();
  if (!exam) return;
  customSelectedIds.clear();
  document.querySelectorAll('.q-pick-box').forEach(function (b) {
    b.classList.remove('selected');
  });
  updatePickerCount(exam);
});

$('btn-pick-start').addEventListener('click', function () {
  if (customSelectedIds.size === 0) {
    showInlineNotice('Select at least one question to start.', 'warning');
    return;
  }
  startTrainer();
});

let _noticeEl = null;

function showInlineNotice(msg, type) {
  if (!_noticeEl) {
    _noticeEl = document.createElement('div');
    _noticeEl.style.marginBottom = '1rem';
    const list = $('question-list');
    list.parentNode.insertBefore(_noticeEl, list);
  }
  _noticeEl.className = 'alert alert-' + (type || 'success');
  _noticeEl.textContent = msg;
  _noticeEl.classList.remove('hidden');
}

function clearInlineNotice() {
  if (_noticeEl) _noticeEl.classList.add('hidden');
}

/* ─── Render question cards ─────────────────────────── */

function questionDisplayNum(q, fallbackIdx) {
  if (trainerMode === 'weak') {
    const exam = getActiveExam();
    if (exam) {
      const idx = exam.questions.findIndex(function (eq) { return eq.id === q.id; });
      if (idx >= 0) return idx + 1;
    }
  }
  return fallbackIdx + 1;
}

function renderQuestions(questions) {
  const list = $('question-list');
  list.innerHTML = '';

  if (questions.length === 0) {
    list.innerHTML = '<div class="empty-state"><p>No questions to show.</p></div>';
    return;
  }

  questions.forEach(function (q, i) {
    const card = document.createElement('div');
    card.className = 'question-card';
    card.id = 'qcard-' + q.id;

    if (q.type === 'fill_blank') {
      // Render sentence with inline inputs for each blank
      const tokens = q.sentence.split(/\s+/).filter(Boolean);
      let blankIdx = 0;
      const sentenceHtml = tokens.map(function (token) {
        if (token.startsWith('[[') && token.endsWith(']]')) {
          const pi = blankIdx++;
          return (
            '<input' +
              ' type="text"' +
              ' class="input answer-part-input fib-inline-input"' +
              ' data-qid="' + q.id + '"' +
              ' data-part="' + pi + '"' +
              ' placeholder="___"' +
              ' autocomplete="off"' +
              ' spellcheck="false"' +
              ' aria-label="Blank ' + (pi + 1) + ' for question ' + (i + 1) + '"' +
            '>'
          );
        }
        return '<span class="fib-sentence-word">' + esc(token) + '</span>';
      }).join(' ');

      const feedbackHtml = q.correct.map(function (_, pi) {
        return '<div class="answer-part-feedback" id="fb-' + q.id + '-' + pi + '"></div>';
      }).join('');

      card.innerHTML =
        '<div class="question-num">Question ' + questionDisplayNum(q, i) + '</div>' +
        '<div class="fib-sentence-display">' + sentenceHtml + '</div>' +
        '<div class="fib-feedbacks">' + feedbackHtml + '</div>' +
        '<div class="question-partial-label" id="partial-' + q.id + '" hidden></div>';
    } else {
      const parts = activeParts[q.id] || q.correct.map(function (_, pi) { return pi; });
      const partsHtml = parts.map(function (pi) {
        return (
          '<div class="answer-part-row">' +
            '<span class="answer-part-label">' + (pi + 1) + '.</span>' +
            '<input' +
              ' type="text"' +
              ' class="input answer-part-input"' +
              ' data-qid="' + q.id + '"' +
              ' data-part="' + pi + '"' +
              ' placeholder="Your answer…"' +
              ' autocomplete="off"' +
              ' spellcheck="false"' +
              ' aria-label="Answer ' + (pi + 1) + ' for question ' + (i + 1) + '"' +
            '>' +
          '</div>' +
          '<div class="answer-part-feedback" id="fb-' + q.id + '-' + pi + '"></div>'
        );
      }).join('');

      card.innerHTML =
        '<div class="question-num">Question ' + questionDisplayNum(q, i) + '</div>' +
        '<div class="question-text">' + esc(q.question) + '</div>' +
        '<div class="answer-parts">' + partsHtml + '</div>' +
        '<div class="question-partial-label" id="partial-' + q.id + '" hidden></div>';
    }

    list.appendChild(card);
  });

  const allInputs = list.querySelectorAll('.answer-part-input');
  allInputs.forEach(function (inp, i) {
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        const next = allInputs[i + 1];
        if (next) {
          next.focus();
        } else {
          $('btn-submit').focus();
        }
      }
    });
  });

  // Don't auto-focus on touch devices — pops keyboard before user is ready
  if (allInputs.length > 0 && !('ontouchstart' in window)) allInputs[0].focus();
}

/* ─── Grading ───────────────────────────────────────── */

function classifyResult(partsCorrect, partsTotal) {
  if (partsCorrect === 0) return 'incorrect';
  if (partsCorrect < partsTotal) return 'partial';
  return 'correct';
}

function applyFeedbackToCard(card, q, record) {
  card.classList.add(classifyResult(record.partsCorrect, record.partsTotal));

  card.querySelectorAll('.answer-part-input').forEach(function (inp) {
    inp.disabled = true;
  });

  // partResults is aligned to the parts actually practised; map back to the
  // original part index so feedback lands on the right input.
  const parts = record.partIndices || q.correct.map(function (_, pi) { return pi; });
  record.partResults.forEach(function (isCorrect, i) {
    const pi = parts[i];
    const fb = $('fb-' + q.id + '-' + pi);
    if (!fb) return;
    if (isCorrect) {
      fb.className   = 'answer-part-feedback correct-fb';
      fb.textContent = '\u2713 Correct';
    } else {
      fb.className   = 'answer-part-feedback incorrect-fb';
      fb.textContent = '\u2717 Correct answer: ' + q.correct[pi];
    }
  });

  const partialEl = $('partial-' + q.id);
  if (partialEl) {
    const show = record.partsTotal > 1
      && record.partsCorrect > 0
      && record.partsCorrect < record.partsTotal;
    partialEl.textContent = show
      ? record.partsCorrect + ' / ' + record.partsTotal + ' parts correct'
      : '';
    partialEl.hidden = !show;
  }
}

function lockSubmitButtons() {
  examSubmitted = true;
  const submitBtn = $('btn-submit');
  submitBtn.disabled    = true;
  submitBtn.textContent = 'Submitted \u2713';
  $('btn-submit-mark').disabled = true;
}

$('btn-submit').addEventListener('click', function () {
  if (examSubmitted) return;
  gradeExam();
});

function gradeExam() {
  const exam = getActiveExam();
  if (!exam) return;

  let totalParts   = 0;
  let correctParts = 0;
  const answerRecords = [];

  currentQuestions.forEach(function (q) {
    const card  = $('qcard-' + q.id);
    const parts = activeParts[q.id] || q.correct.map(function (_, pi) { return pi; });

    const userAnswers = [];
    const partResults = [];
    parts.forEach(function (pi) {
      const inp = card.querySelector('.answer-part-input[data-part="' + pi + '"]');
      const val = inp ? inp.value.trim() : '';
      userAnswers.push(val);
      partResults.push(answersMatch(val, q.correct[pi]));
    });
    const partsCorrect = partResults.filter(Boolean).length;
    const partsTotal   = parts.length;

    totalParts   += partsTotal;
    correctParts += partsCorrect;

    const record = {
      id: q.id,
      userAnswers:  userAnswers,
      partResults:  partResults,
      partsCorrect: partsCorrect,
      partsTotal:   partsTotal,
    };
    // Only present when practising a subset of a question's parts.
    if (parts.length !== q.correct.length) record.partIndices = parts.slice();
    answerRecords.push(record);

    applyFeedbackToCard(card, q, record);
  });

  const percent = totalParts > 0 ? Math.round((correctParts / totalParts) * 100) : 0;
  const historyRecord = {
    examId:  getActiveExamId(),
    date:    new Date().toISOString(),
    score:   correctParts,
    total:   totalParts,
    percent: percent,
    answers: answerRecords,
  };
  const history = loadHistory();
  history.push(historyRecord);
  saveHistory(history);

  lockSubmitButtons();
  showResultsPanel(correctParts, totalParts, percent, answerRecords);
}

/* ─── Answer matching ───────────────────────────────── */

function normalizeAnswer(str) {
  return String(str)
    .toLowerCase()
    .trim()
    .replace(/[.,;:!?'"'"`~@#%^&*()+|<>()\[\]\\/]/g, ' ')
    .replace(/[-\u2013\u2014]/g, ' ')
    .replace(/\bof the\b/g, 'the')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = [];
  for (let i = 0; i <= m; i++) { dp[i] = [i]; }
  for (let j = 0; j <= n; j++) { dp[0][j] = j; }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

function answersMatch(userAns, correctAns) {
  const a = normalizeAnswer(userAns);
  const b = normalizeAnswer(correctAns);
  if (a === b) return true;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return true;
  const threshold = Math.max(1, Math.floor(maxLen * 0.10));
  return levenshtein(a, b) <= threshold;
}

/* ─── Results Panel ─────────────────────────────────── */

function showResultsPanel(correct, total, percent, answers) {
  const panel = $('results-panel');
  panel.classList.remove('hidden');

  $('results-score-display').textContent = correct + ' / ' + total;

  const bar = $('results-percent-bar');
  bar.style.width = '0';
  bar.className = 'results-percent-bar';
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      bar.style.width = percent + '%';
      if (percent >= 75) {
        bar.classList.add('green');
      } else if (percent >= 51) {
        bar.classList.add('amber');
      } else {
        bar.classList.add('red');
      }
    });
  });

  $('results-percent-label').textContent = percent + '%';

  const needsWork = answers.filter(function (a) { return a.partsCorrect < a.partsTotal; });
  const nwSection = $('needs-work-section');
  const nwList    = $('needs-work-list');
  nwList.innerHTML = '';

  if (needsWork.length > 0) {
    nwSection.classList.remove('hidden');
    needsWork.forEach(function (a) {
      const q     = currentQuestions.find(function (q) { return q.id === a.id; });
      const label = q ? truncate(q.question, 55) : 'Question ' + a.id;
      const li    = document.createElement('li');
      const link  = document.createElement('a');
      link.textContent = label;
      link.href = '#';
      link.addEventListener('click', function (e) {
        e.preventDefault();
        scrollToCard(a.id);
      });
      li.appendChild(link);
      nwList.appendChild(li);
    });
  } else {
    nwSection.classList.add('hidden');
  }

  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function scrollToCard(qid) {
  const el = $('qcard-' + qid);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* ─── Retry buttons ─────────────────────────────────── */

$('btn-retry-all').addEventListener('click', function () {
  switchMode('full');
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

$('btn-retry-weak').addEventListener('click', function () {
  switchMode('weak');
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

/* ─── Weak Areas ────────────────────────────────────── */

function getWeakQuestions(exam) {
  const history = loadHistory().filter(function (a) { return a.examId === exam.id; });
  if (history.length === 0) return [];

  // Score by total parts missed across all attempts (not just attempt count),
  // so multi-part questions that are repeatedly wrong rank higher.
  const missCount = {};
  history.forEach(function (attempt) {
    attempt.answers.forEach(function (a) {
      const missed = a.partsTotal - a.partsCorrect;
      if (missed > 0) {
        missCount[a.id] = (missCount[a.id] || 0) + missed;
      }
    });
  });

  const weakIds = new Set(Object.keys(missCount).map(Number));
  // Sort by original exam position so numbering is always ascending,
  // even when exam.questions is stored out of order.
  const posById = new Map();
  exam.questions.forEach(function (q, i) { posById.set(q.id, i); });
  return exam.questions
    .filter(function (q) { return weakIds.has(q.id); })
    .slice()
    .sort(function (a, b) { return posById.get(a.id) - posById.get(b.id); });
}

// Which individual sub-parts (by original part index) have ever been missed,
// per question. Used to drill only the wrong sub-questions in weak mode.
function getWeakPartMap(exam) {
  const history = loadHistory().filter(function (a) { return a.examId === exam.id; });
  const map = {};
  history.forEach(function (attempt) {
    attempt.answers.forEach(function (a) {
      if (!Array.isArray(a.partResults)) return;
      a.partResults.forEach(function (ok, i) {
        if (ok) return;
        // Records from a focused session store the original indices separately.
        const pi = Array.isArray(a.partIndices) ? a.partIndices[i] : i;
        if (pi == null) return;
        if (!map[a.id]) map[a.id] = {};
        map[a.id][pi] = true;
      });
    });
  });
  const out = {};
  Object.keys(map).forEach(function (id) {
    out[id] = Object.keys(map[id]).map(Number).sort(function (x, y) { return x - y; });
  });
  return out;
}

// Decide which part indices to render/grade for each current question.
// Normally every part; in weak mode with "sub-questions only" enabled, just
// the parts that have been missed (skipped for fill-in-the-blank, which must
// always show the whole sentence).
function computeActiveParts(exam) {
  activeParts = {};
  const partMap = (trainerMode === 'weak' && weakPartsOnly) ? getWeakPartMap(exam) : null;

  currentQuestions.forEach(function (q) {
    const all = q.correct.map(function (_, pi) { return pi; });
    if (partMap && q.type !== 'fill_blank') {
      const missed = (partMap[q.id] || []).filter(function (pi) { return pi < q.correct.length; });
      if (missed.length > 0 && missed.length < all.length) {
        activeParts[q.id] = missed;
        return;
      }
    }
    activeParts[q.id] = all;
  });
}

/* ═══════════════════════════════════════════════════════
   SELF-MARK MODE
   ═══════════════════════════════════════════════════════ */

$('btn-submit-mark').addEventListener('click', function () {
  if (examSubmitted) return;
  enterSelfMarkMode();
});

$('btn-self-mark-finish').addEventListener('click', finishSelfMark);
$('btn-self-mark-cancel').addEventListener('click', exitSelfMarkView);

function enterSelfMarkMode() {
  if (currentQuestions.length === 0) return;

  selfMarkQuestionsSnap = [...currentQuestions];
  selfMarkUserAnswers   = currentQuestions.map(function (q) {
    const card  = $('qcard-' + q.id);
    const parts = activeParts[q.id] || q.correct.map(function (_, pi) { return pi; });
    return {
      id: q.id,
      parts: parts.slice(),
      userAnswers: parts.map(function (pi) {
        const inp = card ? card.querySelector('.answer-part-input[data-part="' + pi + '"]') : null;
        return inp ? inp.value.trim() : '';
      }),
    };
  });

  selfMarkResults = {};
  selfMarkQuestionsSnap.forEach(function (q) {
    const parts = activeParts[q.id] || q.correct.map(function (_, pi) { return pi; });
    parts.forEach(function (pi) {
      selfMarkResults[q.id + '-' + pi] = null;
    });
  });

  $('trainer-content').classList.add('hidden');
  $('self-mark-view').classList.remove('hidden');
  $('self-mark-bottom-bar').classList.remove('hidden');

  renderSelfMarkView();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderSelfMarkView() {
  const grid = $('self-mark-grid');

  while (grid.children.length > 2) grid.removeChild(grid.lastChild);

  let totalParts = 0;
  selfMarkQuestionsSnap.forEach(function (q) {
    totalParts += (activeParts[q.id] || q.correct).length;
  });
  $('self-mark-score-total').textContent = totalParts;
  updateSelfMarkScore();

  selfMarkQuestionsSnap.forEach(function (q, qi) {
    const parts     = activeParts[q.id] || q.correct.map(function (_, pi) { return pi; });
    const uRec      = selfMarkUserAnswers.find(function (a) { return a.id === q.id; });
    const userAns   = uRec ? uRec.userAnswers : parts.map(function () { return ''; });
    const multiPart = q.correct.length > 1;

    // Left cell: question text + user's answers
    const leftCell     = document.createElement('div');
    leftCell.className = 'smg-left';

    const userAnsHtml = parts.map(function (pi, i) {
      const ans = userAns[i];
      return (
        '<div class="smg-user-ans">' +
          (multiPart ? '<span class="smg-part-num">' + (pi + 1) + '.</span>' : '') +
          (ans ? esc(ans) : '<span class="smg-no-answer">\u2014</span>') +
        '</div>'
      );
    }).join('');

    leftCell.innerHTML =
      '<div class="smg-q-num">Question ' + questionDisplayNum(q, qi) + '</div>' +
      '<div class="smg-q-text">' + esc(q.question) + '</div>' +
      '<div class="smg-user-answers">' + userAnsHtml + '</div>';

    // Right cell: correct answers + mark buttons
    const rightCell     = document.createElement('div');
    rightCell.className = 'smg-right';

    rightCell.innerHTML = parts.map(function (pi) {
      const ans  = q.correct[pi];
      const key  = q.id + '-' + pi;
      const mark = selfMarkResults[key];

      let partClass = 'smg-correct-part';
      if (mark === true) partClass += ' marked-correct';
      else if (mark === false) partClass += ' marked-incorrect';

      return (
        '<div class="' + partClass + '" id="smp-' + q.id + '-' + pi + '">' +
          '<div class="smg-correct-info">' +
            (multiPart ? '<span class="smg-part-num">' + (pi + 1) + '.</span>' : '') +
            '<span class="smg-correct-text">' + esc(ans) + '</span>' +
          '</div>' +
          '<div class="smg-mark-btns">' +
            '<button class="mark-btn mark-check' + (mark === true ? ' active' : '') + '"' +
              ' data-qid="' + q.id + '" data-part="' + pi + '"' +
              ' title="Mark correct" aria-label="Mark correct">\u2713</button>' +
            '<button class="mark-btn mark-cross' + (mark === false ? ' active' : '') + '"' +
              ' data-qid="' + q.id + '" data-part="' + pi + '"' +
              ' title="Mark incorrect" aria-label="Mark incorrect">\u2717</button>' +
          '</div>' +
        '</div>'
      );
    }).join('');

    rightCell.querySelectorAll('.mark-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        handleMarkBtn(
          Number(btn.dataset.qid),
          Number(btn.dataset.part),
          btn.classList.contains('mark-check')
        );
      });
    });

    grid.appendChild(leftCell);
    grid.appendChild(rightCell);
  });
}

function handleMarkBtn(qid, partIdx, isCorrect) {
  const key    = qid + '-' + partIdx;
  const partEl = $('smp-' + qid + '-' + partIdx);
  if (!partEl) return;

  selfMarkResults[key] = isCorrect;

  partEl.querySelectorAll('.mark-btn').forEach(function (b) {
    b.classList.toggle('active', b.classList.contains('mark-check') === isCorrect);
  });

  partEl.classList.toggle('marked-correct', isCorrect);
  partEl.classList.toggle('marked-incorrect', !isCorrect);

  updateSelfMarkScore();
}

function updateSelfMarkScore() {
  const correct = Object.values(selfMarkResults).filter(function (v) {
    return v === true;
  }).length;
  $('self-mark-score-num').textContent = correct;
}

function exitSelfMarkView() {
  $('self-mark-view').classList.add('hidden');
  $('self-mark-bottom-bar').classList.add('hidden');
  $('trainer-content').classList.remove('hidden');
}

function finishSelfMark() {
  const activeId = getActiveExamId();
  if (!activeId) return;

  let totalParts   = 0;
  let correctParts = 0;
  const answerRecords = [];

  selfMarkQuestionsSnap.forEach(function (q) {
    const uRec        = selfMarkUserAnswers.find(function (a) { return a.id === q.id; });
    const parts       = (uRec && uRec.parts) || activeParts[q.id] || q.correct.map(function (_, pi) { return pi; });
    const userAnswers = uRec ? uRec.userAnswers : parts.map(function () { return ''; });
    const partResults = parts.map(function (pi) {
      return selfMarkResults[q.id + '-' + pi] === true;
    });
    const partsCorrect = partResults.filter(Boolean).length;
    const partsTotal   = parts.length;

    totalParts   += partsTotal;
    correctParts += partsCorrect;
    const rec = {
      id:           q.id,
      userAnswers:  userAnswers,
      partResults:  partResults,
      partsCorrect: partsCorrect,
      partsTotal:   partsTotal,
    };
    if (parts.length !== q.correct.length) rec.partIndices = parts.slice();
    answerRecords.push(rec);
  });

  const percent = totalParts > 0 ? Math.round((correctParts / totalParts) * 100) : 0;
  const history = loadHistory();
  history.push({
    examId:     activeId,
    date:       new Date().toISOString(),
    score:      correctParts,
    total:      totalParts,
    percent:    percent,
    answers:    answerRecords,
    selfMarked: true,
  });
  saveHistory(history);

  exitSelfMarkView();
  currentQuestions = selfMarkQuestionsSnap;
  renderQuestions(currentQuestions);

  selfMarkQuestionsSnap.forEach(function (q) {
    const card = $('qcard-' + q.id);
    if (!card) return;
    const rec = answerRecords.find(function (r) { return r.id === q.id; });
    if (!rec) return;

    // Restore user answers into re-rendered inputs
    const inputs = card.querySelectorAll('.answer-part-input');
    inputs.forEach(function (inp, pi) {
      inp.value = rec.userAnswers[pi] || '';
    });

    applyFeedbackToCard(card, q, rec);
  });

  lockSubmitButtons();
  showResultsPanel(correctParts, totalParts, percent, answerRecords);
}

/* ═══════════════════════════════════════════════════════
   TAB 3 — HISTORY
   ═══════════════════════════════════════════════════════ */

function renderHistory() {
  const exam = getActiveExam();

  const elNoExam  = $('history-no-exam');
  const elNoAtt   = $('history-no-attempts');
  const elContent = $('history-content');

  elNoExam.classList.add('hidden');
  elNoAtt.classList.add('hidden');
  elContent.classList.add('hidden');

  if (!exam) {
    elNoExam.classList.remove('hidden');
    return;
  }

  const activeId = getActiveExamId();
  const history  = loadHistory().filter(function (a) { return a.examId === activeId; });

  if (history.length === 0) {
    $('history-exam-name-empty').textContent = exam.name;
    elNoAtt.classList.remove('hidden');
    return;
  }

  elContent.classList.remove('hidden');
  $('history-exam-name').textContent = exam.name;

  // Stats
  const total = history.length;
  const best  = history.reduce(function (m, a) { return Math.max(m, a.percent); }, 0);
  const avg   = Math.round(history.reduce(function (s, a) { return s + a.percent; }, 0) / total);

  const missCount = {};
  history.forEach(function (attempt) {
    attempt.answers.forEach(function (a) {
      if (a.partsCorrect < a.partsTotal) {
        missCount[a.id] = (missCount[a.id] || 0) + 1;
      }
    });
  });

  let topMissedId = null;
  let topMissedCount = 0;
  for (const [id, count] of Object.entries(missCount)) {
    if (count > topMissedCount) {
      topMissedCount = count;
      topMissedId = Number(id);
    }
  }

  const topQ = topMissedId
    ? exam.questions.find(function (q) { return q.id === topMissedId; })
    : null;
  const topQText = topQ ? truncate(topQ.question, 45) : '\u2014';

  $('stat-attempts').textContent = total;
  $('stat-best').textContent     = best + '%';
  $('stat-avg').textContent      = avg + '%';
  $('stat-missed').textContent   = topQText;

  drawChart(history);
  renderAttemptList(history, exam);
}

/* ─── Canvas Chart ──────────────────────────────────── */

function drawChart(history) {
  const canvas = $('progress-chart');
  const ctx    = canvas.getContext('2d');
  const dpr    = window.devicePixelRatio || 1;
  const W      = canvas.offsetWidth || 300; // no floor — avoids overflow on narrow phone screens
  const H      = 250;

  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const pad = { top: 20, right: 24, bottom: 50, left: 46 };
  const cW  = W - pad.left - pad.right;
  const cH  = H - pad.top - pad.bottom;

  // Y-axis grid lines and labels
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth   = 1;
  for (let pct = 0; pct <= 100; pct += 25) {
    const y = pad.top + cH - (pct / 100) * cH;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + cW, y);
    ctx.stroke();

    ctx.fillStyle    = '#9ca3af';
    ctx.font         = '11px DM Sans, sans-serif';
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(pct + '%', pad.left - 8, y);
  }

  if (history.length === 0) return;

  const stepX = history.length > 1 ? cW / (history.length - 1) : cW / 2;

  function ptX(i) {
    return pad.left + (history.length > 1 ? i * stepX : cW / 2);
  }

  function ptY(a) {
    return pad.top + cH - (a.percent / 100) * cH;
  }

  // Fill area
  if (history.length > 1) {
    ctx.beginPath();
    history.forEach(function (a, i) {
      const x = ptX(i);
      const y = ptY(a);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(ptX(history.length - 1), pad.top + cH);
    ctx.lineTo(ptX(0), pad.top + cH);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + cH);
    grad.addColorStop(0, 'rgba(5, 150, 105, 0.20)');
    grad.addColorStop(1, 'rgba(5, 150, 105, 0.02)');
    ctx.fillStyle = grad;
    ctx.fill();
  }

  // Line
  if (history.length > 1) {
    ctx.beginPath();
    ctx.strokeStyle = '#059669';
    ctx.lineWidth   = 2.5;
    ctx.lineJoin    = 'round';
    ctx.lineCap     = 'round';
    history.forEach(function (a, i) {
      const x = ptX(i);
      const y = ptY(a);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  // Dots and x-axis date labels
  const maxLabels = Math.min(history.length, Math.floor(cW / 48));
  const step      = history.length <= maxLabels ? 1 : Math.ceil(history.length / maxLabels);

  history.forEach(function (a, i) {
    const x = ptX(i);
    const y = ptY(a);

    ctx.beginPath();
    ctx.fillStyle = '#059669';
    ctx.arc(x, y, 4.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.fillStyle = '#ffffff';
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();

    if (i % step === 0 || i === history.length - 1) {
      const date  = new Date(a.date);
      const label = (date.getMonth() + 1) + '/' + date.getDate();
      ctx.fillStyle    = '#6b7280';
      ctx.font         = '10px DM Sans, sans-serif';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(label, x, pad.top + cH + 10);

      ctx.strokeStyle = '#d1d5db';
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(x, pad.top + cH);
      ctx.lineTo(x, pad.top + cH + 5);
      ctx.stroke();
    }
  });
}

/* ─── Attempt list ──────────────────────────────────── */

function renderAttemptList(history, exam) {
  const list = $('attempt-list');
  list.innerHTML = '';

  const sorted = [...history].reverse();

  sorted.forEach(function (attempt, ai) {
    const date    = new Date(attempt.date);
    const dateStr = date.toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

    let badgeClass;
    if (attempt.percent >= 75) {
      badgeClass = 'badge-green';
    } else if (attempt.percent >= 51) {
      badgeClass = 'badge-amber';
    } else {
      badgeClass = 'badge-red';
    }

    const card = document.createElement('div');
    card.className = 'attempt-card';
    card.innerHTML =
      '<div class="attempt-header">' +
        '<div class="attempt-meta">' +
          '<div class="attempt-date">' + esc(dateStr) + '</div>' +
          '<div class="attempt-score">' + attempt.score + ' / ' + attempt.total + ' — ' + attempt.percent + '%</div>' +
        '</div>' +
        '<span class="score-badge ' + badgeClass + '">' + attempt.percent + '%</span>' +
        '<span class="attempt-chevron">\u25BE</span>' +
      '</div>' +
      '<div class="attempt-body">' +
        '<table class="attempt-table">' +
          '<thead>' +
            '<tr>' +
              '<th>Question</th>' +
              '<th>Your Answer(s)</th>' +
              '<th>Correct Answer(s)</th>' +
              '<th style="text-align:center;">Result</th>' +
            '</tr>' +
          '</thead>' +
          '<tbody id="attbody-' + ai + '"></tbody>' +
        '</table>' +
      '</div>';

    card.querySelector('.attempt-header').addEventListener('click', function () {
      const wasOpen = card.classList.contains('open');
      card.classList.toggle('open');
      if (!wasOpen && card.classList.contains('open')) {
        const tbody = $('attbody-' + ai);
        if (tbody.children.length === 0) {
          populateAttemptTable(tbody, attempt, exam);
        }
      }
    });

    list.appendChild(card);
  });
}

function populateAttemptTable(tbody, attempt, exam) {
  attempt.answers.forEach(function (a) {
    const q = exam.questions.find(function (q) { return q.id === a.id; });
    if (!q) return;

    let resultHtml;
    if (a.partsCorrect === a.partsTotal) {
      resultHtml = '<span class="result-correct">\u2713</span>';
    } else if (a.partsCorrect === 0) {
      resultHtml = '<span class="result-incorrect">\u2717</span>';
    } else {
      resultHtml = '<span class="result-partial">' + a.partsCorrect + '/' + a.partsTotal + '</span>';
    }

    // A focused session only covers some parts; show just those, aligned.
    const correctList = Array.isArray(a.partIndices)
      ? a.partIndices.map(function (pi) { return q.correct[pi]; })
      : q.correct;

    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td>' + esc(q.question) + '</td>' +
      '<td>' + a.userAnswers.map(esc).join('<br>') + '</td>' +
      '<td>' + correctList.map(esc).join('<br>') + '</td>' +
      '<td class="result-cell">' + resultHtml + '</td>';
    tbody.appendChild(tr);
  });
}

/* ─── Clear History ─────────────────────────────────── */

$('btn-clear-history').addEventListener('click', function () {
  const activeId = getActiveExamId();
  const exam     = getActiveExam();
  const name     = exam ? '"' + exam.name + '"' : 'this exam';

  showConfirm(
    'Clear all history for ' + name + '? This cannot be undone.',
    'Clear History',
    function () {
      const history = loadHistory().filter(function (a) { return a.examId !== activeId; });
      saveHistory(history);
      renderHistory();
    }
  );
});

/* ═══════════════════════════════════════════════════════
   TAB 4 — VERSES
   ═══════════════════════════════════════════════════════ */

/* ─── Verse Storage ────────────────────────────────── */

function loadVerses() {
  return loadJSON(KEYS.verseBank, []);
}

function saveVerses(verses) {
  saveJSON(KEYS.verseBank, verses);
  emitStateChange();
}

function generateVerseId() {
  return 'verse_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}

/* ─── Verse List Rendering ─────────────────────────── */

function renderVerseList() {
  const verses  = loadVerses();
  const list    = $('verse-list');
  const noItems = $('no-verses');

  list.innerHTML = '';

  if (verses.length === 0) {
    noItems.classList.remove('hidden');
    return;
  }

  noItems.classList.add('hidden');

  verses.forEach(function (v) {
    const card = document.createElement('div');
    card.className = 'exam-card';
    const items = normalizeVerseEntry(v);
    const wordCount = items.reduce(function (sum, it) {
      return sum + it.text.split(/\s+/).filter(Boolean).length;
    }, 0);
    const meta = (items.length > 1
      ? '<span>' + pluralize(items.length, 'verse') + '</span><span>· '
      : '<span>') + pluralize(wordCount, 'word') + '</span>';

    card.innerHTML =
      '<div class="exam-card-info">' +
        '<div class="exam-card-name">' + esc(v.title) + '</div>' +
        '<div class="exam-card-meta">' + meta + '</div>' +
      '</div>' +
      '<div class="exam-card-actions">' +
        '<button class="btn btn-primary btn-sm" data-verse-practice="' + esc(v.id) + '">Practice</button>' +
        '<button class="btn btn-secondary btn-sm" data-verse-edit="' + esc(v.id) + '">Edit</button>' +
        '<button class="btn btn-danger-ghost btn-sm" data-verse-delete="' + esc(v.id) + '">Delete</button>' +
      '</div>';
    list.appendChild(card);
  });
}

/* ─── Verse List Event Delegation ──────────────────── */

$('verse-list').addEventListener('click', function (e) {
  const btn = e.target.closest(
    '[data-verse-practice], [data-verse-edit], [data-verse-delete]'
  );
  if (!btn) return;

  if (btn.dataset.versePractice) {
    startVersePractice(btn.dataset.versePractice);
  } else if (btn.dataset.verseEdit) {
    openVerseEditor(btn.dataset.verseEdit);
  } else if (btn.dataset.verseDelete) {
    const id = btn.dataset.verseDelete;
    const v  = loadVerses().find(function (v) { return v.id === id; });
    const name = v ? '"' + v.title + '"' : 'this verse';
    showConfirm('Delete ' + name + '? This cannot be undone.', 'Delete', function () {
      const verses = loadVerses().filter(function (v) { return v.id !== id; });
      saveVerses(verses);
      renderVerseList();
    });
  }
});

/* ═══════════════════════════════════════════════════════
   VERSE IMPORT / EXPORT  (mirrors the exam JSON system)
   A file is an array of { ref?, text } items → one verse entry.
   ═══════════════════════════════════════════════════════ */

$('btn-verse-import').addEventListener('click', function () {
  $('verse-import-file').click();
});

$('verse-import-file').addEventListener('change', function (e) {
  const files = Array.from(e.target.files);
  if (!files.length) return;

  const verses   = loadVerses();
  const errors   = [];
  let   imported = 0;
  let   done     = 0;

  files.forEach(function (file) {
    const reader = new FileReader();
    reader.onload = function (ev) {
      try {
        const raw    = JSON.parse(ev.target.result);
        const result = validateVerseImport(raw);

        if (!result.ok) {
          errors.push('"' + file.name + '": ' + result.error);
        } else {
          verses.push({
            id:      generateVerseId(),
            title:   importVerseTitle(result.items, file.name),
            verses:  result.items,
            created: new Date().toISOString(),
          });
          imported++;
        }
      } catch {
        errors.push('"' + file.name + '": could not parse — make sure it is valid JSON.');
      }

      if (++done === files.length) {
        saveVerses(verses);
        renderVerseList();

        if (errors.length) {
          showAlert('verse-import-error', errors.join(' | '));
        } else {
          hideAlert('verse-import-error');
        }

        if (imported > 0) {
          showAlert('verse-import-success',
            'Imported ' + pluralize(imported, 'verse') + '.' +
            (errors.length ? ' ' + pluralize(errors.length, 'file') + ' had errors.' : ''));
        } else {
          hideAlert('verse-import-success');
        }
      }
    };
    reader.readAsText(file);
  });

  e.target.value = '';
});

function validateVerseImport(data) {
  // Accept a single { ref?, text } object as a one-item file too.
  const arr = Array.isArray(data) ? data : [data];

  if (arr.length === 0) {
    return { ok: false, error: 'The file is empty.' };
  }

  const items = [];
  for (let i = 0; i < arr.length; i++) {
    let entry = arr[i];
    const label = 'Item ' + (i + 1);

    // A bare string is treated as verse text with no reference.
    if (typeof entry === 'string') entry = { text: entry };

    if (typeof entry !== 'object' || entry === null) {
      return { ok: false, error: label + ' is not an object.' };
    }
    if (typeof entry.text !== 'string' || !entry.text.trim()) {
      return { ok: false, error: label + ' is missing a "text" string.' };
    }
    if (entry.ref != null && typeof entry.ref !== 'string') {
      return { ok: false, error: label + ', "ref" must be a string.' };
    }

    items.push({ ref: (entry.ref || '').trim(), text: entry.text.trim() });
  }

  return { ok: true, items: items };
}

/** Title for an imported entry: its references, else the file name, else a number. */
function importVerseTitle(items, fileName) {
  const refs = items.map(function (it) { return it.ref; }).filter(Boolean);
  if (refs.length) return refs.join(', ');
  const fromName = (fileName || '').replace(/\.json$/i, '').replace(/[-_]/g, ' ').trim();
  if (fromName) return fromName;
  return 'Verse ' + nextVerseNumber();
}

/* ─── Verse Export ──────────────────────────────────── */

$('btn-verse-export').addEventListener('click', openVerseExportModal);
$('verse-export-close').addEventListener('click', closeVerseExportModal);
$('btn-verse-cancel-export').addEventListener('click', closeVerseExportModal);
$('verse-export-backdrop').addEventListener('click', closeVerseExportModal);

let verseExportFolderHandle = null;

if (!supportsDirectoryPicker) {
  $('btn-verse-choose-folder').disabled = true;
  $('btn-verse-choose-folder').title = 'Your browser does not support choosing a folder. Files will be saved to the default Downloads folder.';
}

$('btn-verse-choose-folder').addEventListener('click', async function () {
  if (!supportsDirectoryPicker) return;
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    verseExportFolderHandle = handle;
    const nameEl = $('verse-export-folder-name');
    nameEl.textContent = handle.name;
    nameEl.classList.add('is-custom');
  } catch (err) {
    if (err && err.name !== 'AbortError') console.error(err);
  }
});

function resetVerseExportFolder() {
  verseExportFolderHandle = null;
  const nameEl = $('verse-export-folder-name');
  nameEl.textContent = 'Downloads folder (default)';
  nameEl.classList.remove('is-custom');
}

function openVerseExportModal() {
  const verses = loadVerses();
  const list   = $('verse-export-list');
  list.innerHTML = '';

  resetVerseExportFolder();

  if (verses.length === 0) {
    list.innerHTML = '<p style="color:var(--text-muted);font-size:0.9rem;">No verses to export.</p>';
    $('btn-verse-do-export').disabled = true;
    $('verse-export-select-all').checked = false;
    $('verse-export-selected-count').textContent = '0 selected';
    $('verse-export-modal').classList.remove('hidden');
    return;
  }

  verses.forEach(function (v) {
    const item = document.createElement('label');
    item.className = 'export-exam-item';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = v.id;
    cb.addEventListener('change', updateVerseExportState);

    const items = normalizeVerseEntry(v);
    const info = document.createElement('div');
    info.className = 'export-exam-item-info';
    info.innerHTML =
      '<div class="export-exam-item-name">' + esc(v.title) + '</div>' +
      '<div class="export-exam-item-meta">' + pluralize(items.length, 'verse') + '</div>';

    item.appendChild(cb);
    item.appendChild(info);
    list.appendChild(item);
  });

  $('verse-export-select-all').checked = false;
  updateVerseExportState();
  $('verse-export-modal').classList.remove('hidden');
}

function closeVerseExportModal() {
  $('verse-export-modal').classList.add('hidden');
}

function updateVerseExportState() {
  const checkboxes = $('verse-export-list').querySelectorAll('input[type="checkbox"]');
  let checked = 0;
  checkboxes.forEach(function (cb) {
    cb.closest('.export-exam-item').classList.toggle('selected', cb.checked);
    if (cb.checked) checked++;
  });

  $('verse-export-selected-count').textContent = checked + ' selected';
  $('btn-verse-do-export').disabled = checked === 0;

  const allChecked = checkboxes.length > 0 && checked === checkboxes.length;
  const someChecked = checked > 0 && checked < checkboxes.length;
  const selectAll = $('verse-export-select-all');
  selectAll.checked = allChecked;
  selectAll.indeterminate = someChecked;
}

$('verse-export-select-all').addEventListener('change', function () {
  const checkboxes = $('verse-export-list').querySelectorAll('input[type="checkbox"]');
  checkboxes.forEach(function (cb) { cb.checked = $('verse-export-select-all').checked; });
  updateVerseExportState();
});

/** Build the export payload for one verse entry: [{ ref?, text }]. */
function verseExportPayload(v) {
  return normalizeVerseEntry(v).map(function (it) {
    return it.ref ? { ref: it.ref, text: it.text } : { text: it.text };
  });
}

$('btn-verse-do-export').addEventListener('click', async function () {
  const verses     = loadVerses();
  const checkboxes = $('verse-export-list').querySelectorAll('input[type="checkbox"]:checked');
  const selectedIds = Array.from(checkboxes).map(function (cb) { return cb.value; });
  const btn = $('btn-verse-do-export');

  const selected = selectedIds
    .map(function (id) { return verses.find(function (v) { return v.id === id; }); })
    .filter(Boolean);

  if (verseExportFolderHandle) {
    btn.disabled = true;
    try {
      for (const v of selected) {
        const payload = verseExportPayload(v);
        const fileName = v.title.replace(/[<>:"/\\|?*]/g, '_') + '.json';
        const fileHandle = await verseExportFolderHandle.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(payload, null, 2));
        await writable.close();
      }
    } catch (err) {
      console.error('Export to folder failed:', err);
      alert('Could not write to the chosen folder: ' + (err && err.message ? err.message : err));
      btn.disabled = false;
      return;
    }
    btn.disabled = false;
  } else {
    selected.forEach(function (v) {
      const payload = verseExportPayload(v);
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = v.title.replace(/[<>:"/\\|?*]/g, '_') + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  closeVerseExportModal();
});

/* ─── Verse Editor Modal ───────────────────────────── */

let _editingVerseId = null;

$('btn-add-verse').addEventListener('click', function () { openVerseEditor(null); });

/**
 * Normalise an entry to a list of { ref, text } verses, supporting the old
 * single-text shape ({ title, text }) saved before multi-verse support.
 */
function normalizeVerseEntry(v) {
  if (Array.isArray(v.verses) && v.verses.length) {
    return v.verses.map(function (it) {
      return { ref: (it.ref || '').trim(), text: it.text || '' };
    });
  }
  return [{ ref: '', text: v.text || '' }];
}

function blankVerseItem() { return { ref: '', text: '' }; }

function createVerseEditorRow(item, idx) {
  const row = document.createElement('div');
  row.className = 'editor-q-row verse-ed-row';
  row.innerHTML =
    '<div class="editor-q-header">' +
      '<span class="editor-q-label">Verse ' + (idx + 1) + '</span>' +
      '<button class="btn btn-ghost btn-remove-q btn-remove-verse" type="button" title="Remove verse">✕ Remove</button>' +
    '</div>' +
    '<div class="form-group" style="margin-bottom:0.625rem;">' +
      '<input type="text" class="input verse-ed-ref"' +
        ' placeholder="Reference (optional) — e.g. John 3:16"' +
        ' value="' + esc(item.ref || '') + '" autocomplete="off">' +
    '</div>' +
    '<textarea class="input verse-ed-textarea verse-ed-text"' +
      ' placeholder="Type or paste the verse text…" rows="4">' + esc(item.text || '') + '</textarea>';

  row.querySelector('.btn-remove-verse').addEventListener('click', function () {
    const list = $('verse-ed-list');
    if (list.querySelectorAll('.verse-ed-row').length <= 1) return; // keep at least one
    row.remove();
    renumberVerseRows();
  });

  return row;
}

function renumberVerseRows() {
  const rows = $('verse-ed-list').querySelectorAll('.verse-ed-row');
  rows.forEach(function (row, i) {
    row.querySelector('.editor-q-label').textContent = 'Verse ' + (i + 1);
    row.querySelector('.btn-remove-verse').style.visibility = rows.length > 1 ? '' : 'hidden';
  });
}

function renderVerseEditorRows(items) {
  const list = $('verse-ed-list');
  list.innerHTML = '';
  items.forEach(function (item, i) { list.appendChild(createVerseEditorRow(item, i)); });
  renumberVerseRows();
}

$('btn-add-verse-row').addEventListener('click', function () {
  const list = $('verse-ed-list');
  const idx  = list.querySelectorAll('.verse-ed-row').length;
  list.appendChild(createVerseEditorRow(blankVerseItem(), idx));
  renumberVerseRows();
  const ta = list.lastElementChild.querySelector('.verse-ed-text');
  if (ta) ta.focus();
});

function openVerseEditor(verseId) {
  _editingVerseId = verseId;
  $('verse-editor-title').textContent = verseId ? 'Edit Verse' : 'Add Verse';

  if (verseId) {
    const v = loadVerses().find(function (v) { return v.id === verseId; });
    if (!v) return;
    renderVerseEditorRows(normalizeVerseEntry(v));
  } else {
    renderVerseEditorRows([blankVerseItem()]);
  }

  hideAlert('verse-editor-alert');
  $('verse-editor-modal').classList.remove('hidden');
  const firstText = $('verse-ed-list').querySelector('.verse-ed-text');
  if (firstText) firstText.focus();
}

/** Next auto-number for entries with no reference ("Verse 1", "Verse 2", …). */
function nextVerseNumber() {
  let max = 0;
  loadVerses().forEach(function (v) {
    const m = /^Verse (\d+)$/.exec(v.title || '');
    if (m) max = Math.max(max, Number(m[1]));
  });
  return max + 1;
}

/** Auto-title an entry: use its references if any, else keep/assign a number. */
function deriveVerseTitle(items, existingTitle) {
  const refs = items.map(function (it) { return it.ref; }).filter(Boolean);
  if (refs.length) return refs.join(', ');
  if (existingTitle && /^Verse \d+$/.test(existingTitle)) return existingTitle;
  return 'Verse ' + nextVerseNumber();
}

function closeVerseEditor() {
  $('verse-editor-modal').classList.add('hidden');
  _editingVerseId = null;
}

$('verse-editor-close').addEventListener('click', closeVerseEditor);
$('verse-editor-backdrop').addEventListener('click', closeVerseEditor);
$('btn-cancel-verse').addEventListener('click', closeVerseEditor);

$('btn-save-verse').addEventListener('click', function () {
  const items = [];
  $('verse-ed-list').querySelectorAll('.verse-ed-row').forEach(function (row) {
    const ref  = row.querySelector('.verse-ed-ref').value.trim();
    const text = row.querySelector('.verse-ed-text').value.trim();
    if (text) items.push({ ref: ref, text: text });
  });

  if (items.length === 0) {
    showAlert('verse-editor-alert', 'Please enter at least one verse.');
    return;
  }

  const verses = loadVerses();

  if (_editingVerseId) {
    const idx = verses.findIndex(function (v) { return v.id === _editingVerseId; });
    if (idx !== -1) {
      verses[idx].title  = deriveVerseTitle(items, verses[idx].title);
      verses[idx].verses = items;
      delete verses[idx].text;   // drop legacy single-text field
      delete verses[idx].blanks; // drop legacy manual blanks
    }
  } else {
    verses.push({
      id:      generateVerseId(),
      title:   deriveVerseTitle(items, null),
      verses:  items,
      created: new Date().toISOString(),
    });
  }

  saveVerses(verses);
  closeVerseEditor();
  renderVerseList();
});

/* ─── Verse Practice — First-Letter Method ─────────────── */

let _practiceVerse = null;
let _verseLevel    = 1;     // 1 = follow along, 2 = blanks, 3 = from memory
let _verseModel    = null;  // { lines, count, letters } built from the verse text
let _verseStatus   = [];    // per typeable word: 'pending' | 'correct' | 'wrong'
let _verseBlank    = [];    // per typeable word: true if hidden (level 2)
let _verseCursor   = 0;     // index of the current typeable word

const VERSE_LEVEL_HINTS = {
  1: 'The whole verse is shown, greyed out. Type the first letter of each word to follow along.',
  2: 'Some words are hidden. Type the first letter of each word — blanks reveal as you go.',
  3: 'Nothing is shown. Type the first letter of every word from memory.',
};

const VERSE_BLANK_RATIO = 0.4; // fraction of words hidden at level 2

/**
 * Build a line/word model from the raw verse text, preserving line breaks
 * and leading indentation. A "typeable" word is one that contains at least
 * one letter or digit; pure-punctuation tokens are shown but never typed.
 *
 * Returns { lines: [{ indent, tokens: [{ raw, letter, wi }] }], count, letters }
 *   - letter : lowercase first alphanumeric char, or null for separators
 *   - wi     : index into the typeable-word arrays, or -1 for separators
 *   - letters: flat array of first letters indexed by wi
 */
function buildVerseModel(text) {
  const letters = [];
  let wi = 0;

  const modelLines = text.split('\n').map(function (line) {
    const leadingMatch = line.match(/^(\s+)/);
    const indent = leadingMatch ? leadingMatch[1].length : 0;
    const words = line.trim().split(/\s+/).filter(Boolean);

    const tokens = words.map(function (raw) {
      const m = raw.match(/[a-z0-9]/i);
      if (m) {
        const letter = m[0].toLowerCase();
        letters.push(letter);
        return { raw: raw, letter: letter, wi: wi++ };
      }
      return { raw: raw, letter: null, wi: -1 };
    });

    return { indent: indent, tokens: tokens };
  });

  return { lines: modelLines, count: wi, letters: letters };
}

/* ─── Start / Stop ─────────────────────────────────── */

let _verseEntry      = null; // the entry being practised (for back-nav / re-selection)
let _verseQueue      = [];   // [{ ref, text }] selected for this session
let _verseQueueIdx   = 0;    // index of the current verse in the queue
let _verseFromSelect = false; // launched from the selection view?

/** Entry point from the verse list. Single-verse → practice; multi → selection. */
function startVersePractice(verseId) {
  const v = loadVerses().find(function (v) { return v.id === verseId; });
  if (!v) return;

  _verseEntry = v;
  const items = normalizeVerseEntry(v);

  if (items.length > 1) {
    openVerseSelect(v, items);
  } else {
    beginVerseSession(items, 0, false);
  }
}

/* ─── Selection view (multi-verse entries) ─────────── */

function openVerseSelect(entry, items) {
  _practiceVerse = null;
  $('verse-list-view').classList.add('hidden');
  $('verse-practice-view').classList.add('hidden');
  $('verse-select-view').classList.remove('hidden');
  $('verse-select-title').textContent = entry.title;
  $('verse-select-all').checked = true;

  const list = $('verse-select-list');
  list.innerHTML = '';
  items.forEach(function (it, i) {
    const ref = it.ref || ('Verse ' + (i + 1));
    const flat = it.text.replace(/\s+/g, ' ').trim();
    const preview = flat.length > 90 ? flat.slice(0, 90) + '…' : flat;

    const row = document.createElement('div');
    row.className = 'verse-select-row';
    row.innerHTML =
      '<label class="verse-select-check">' +
        '<input type="checkbox" class="verse-select-cb" data-idx="' + i + '" checked>' +
        '<span class="verse-select-info">' +
          '<span class="verse-select-ref">' + esc(ref) + '</span>' +
          '<span class="verse-select-preview">' + esc(preview) + '</span>' +
        '</span>' +
      '</label>' +
      '<button class="btn btn-secondary btn-sm verse-select-one" data-idx="' + i + '">Practice</button>';
    list.appendChild(row);
  });
}

$('verse-select-all').addEventListener('change', function () {
  const checked = this.checked;
  $('verse-select-list').querySelectorAll('.verse-select-cb').forEach(function (cb) {
    cb.checked = checked;
  });
});

$('verse-select-list').addEventListener('click', function (e) {
  const btn = e.target.closest('.verse-select-one');
  if (!btn || !_verseEntry) return;
  const items = normalizeVerseEntry(_verseEntry);
  beginVerseSession([items[Number(btn.dataset.idx)]], 0, true);
});

$('btn-verse-practice-selected').addEventListener('click', function () {
  if (!_verseEntry) return;
  const items = normalizeVerseEntry(_verseEntry);
  const selected = [];
  $('verse-select-list').querySelectorAll('.verse-select-cb').forEach(function (cb) {
    if (cb.checked) selected.push(items[Number(cb.dataset.idx)]);
  });
  if (selected.length === 0) return;
  beginVerseSession(selected, 0, true);
});

$('btn-verse-select-back').addEventListener('click', function () {
  $('verse-select-view').classList.add('hidden');
  $('verse-list-view').classList.remove('hidden');
  _verseEntry = null;
});

/* ─── Practice session ─────────────────────────────── */

function beginVerseSession(queue, startIdx, fromSelect) {
  _verseQueue      = queue;
  _verseQueueIdx   = startIdx || 0;
  _verseFromSelect = !!fromSelect;
  _verseLevel      = 1;

  $('verse-list-view').classList.add('hidden');
  $('verse-select-view').classList.add('hidden');
  $('verse-practice-view').classList.remove('hidden');

  loadVerseFromQueue();
}

/** Load the current queued verse into the practice UI. */
function loadVerseFromQueue() {
  const item = _verseQueue[_verseQueueIdx];
  _practiceVerse = item;
  _verseModel = buildVerseModel(item.text);

  $('verse-practice-title').textContent = _verseEntry ? _verseEntry.title : (item.ref || 'Verse');
  $('verse-ref-text').textContent = item.text;

  // Subtitle: show the verse reference / position when it adds context
  const sub = $('verse-practice-sub');
  let subText = '';
  if (item.ref) subText = item.ref;
  else if (_verseQueue.length > 1) subText = 'Verse ' + (_verseQueueIdx + 1);
  if (subText) { sub.textContent = subText; sub.classList.remove('hidden'); }
  else sub.classList.add('hidden');

  // Verse navigation (only for multi-verse sessions)
  const nav = $('verse-nav');
  if (_verseQueue.length > 1) {
    nav.classList.remove('hidden');
    $('verse-nav-status').textContent = 'Verse ' + (_verseQueueIdx + 1) + ' of ' + _verseQueue.length;
    $('btn-verse-prev').disabled = _verseQueueIdx === 0;
    $('btn-verse-next').disabled = _verseQueueIdx === _verseQueue.length - 1;
  } else {
    nav.classList.add('hidden');
  }

  setupVerseLevel();
}

$('btn-verse-prev').addEventListener('click', function () {
  if (_verseQueueIdx > 0) { _verseQueueIdx--; loadVerseFromQueue(); }
});

$('btn-verse-next').addEventListener('click', function () {
  if (_verseQueueIdx < _verseQueue.length - 1) { _verseQueueIdx++; loadVerseFromQueue(); }
});

$('btn-verse-back').addEventListener('click', function () {
  $('verse-practice-view').classList.add('hidden');
  _practiceVerse = null;
  _verseModel = null;

  if (_verseFromSelect && _verseEntry) {
    openVerseSelect(_verseEntry, normalizeVerseEntry(_verseEntry));
  } else {
    $('verse-list-view').classList.remove('hidden');
    _verseEntry = null;
  }
});

/* ─── Level setup ──────────────────────────────────── */

/** Randomly choose which words are hidden at level 2 (Fisher–Yates). */
function pickVerseBlanks(n) {
  const blanks = new Array(n).fill(false);
  if (n === 0) return blanks;

  const howMany = Math.max(1, Math.round(n * VERSE_BLANK_RATIO));
  const order = [];
  for (let i = 0; i < n; i++) order.push(i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = order[i]; order[i] = order[j]; order[j] = tmp;
  }
  order.slice(0, howMany).forEach(function (idx) { blanks[idx] = true; });
  return blanks;
}

/** (Re)start the current level — resets progress, re-randomizes blanks. */
function setupVerseLevel() {
  if (!_verseModel) return;

  const n = _verseModel.count;
  _verseStatus = new Array(n).fill('pending');
  _verseCursor = 0;
  _verseBlank  = _verseLevel === 2 ? pickVerseBlanks(n) : new Array(n).fill(false);

  // Reflect the active level in the pills + hint
  document.querySelectorAll('.verse-level-pill').forEach(function (pill) {
    pill.classList.toggle('active', Number(pill.dataset.level) === _verseLevel);
  });
  $('verse-level-hint').textContent = VERSE_LEVEL_HINTS[_verseLevel];

  // Next-difficulty button state
  const nextBtn = $('btn-verse-next-level');
  if (_verseLevel >= 3) {
    nextBtn.disabled = true;
    nextBtn.textContent = 'Max difficulty';
  } else {
    nextBtn.disabled = false;
    nextBtn.innerHTML = 'Next difficulty &rarr;';
  }

  renderVerseType();

  const input = $('verse-type-input');
  input.value = '';
  input.disabled = false;
  input.focus();
}

/* ─── Rendering ────────────────────────────────────── */

/** A pending word is hidden depending on the current level. */
function isVerseWordHidden(wi, status) {
  if (status !== 'pending') return false; // revealed once attempted
  if (_verseLevel === 3) return true;     // everything hidden
  if (_verseLevel === 2) return _verseBlank[wi];
  return false;                           // level 1: always visible
}

/** Replace letters/digits with underscores, keep surrounding punctuation. */
function maskVerseWord(raw) {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    out += /[a-z0-9]/i.test(raw[i]) ? '_' : raw[i];
  }
  return esc(out);
}

function renderVerseType() {
  if (!_verseModel) return;
  const container = $('verse-type-display');

  const linesHtml = _verseModel.lines.map(function (line) {
    if (line.tokens.length === 0) return '<div class="vt-line"></div>';

    const wordsHtml = line.tokens.map(function (tok) {
      if (tok.wi === -1) {
        return '<span class="vt-word vt-sep">' + esc(tok.raw) + '</span>';
      }

      const status  = _verseStatus[tok.wi];
      const current = (tok.wi === _verseCursor);
      const hidden  = isVerseWordHidden(tok.wi, status);

      let cls = 'vt-word';
      if (status === 'correct')    cls += ' vt-correct';
      else if (status === 'wrong') cls += ' vt-wrong';
      else                         cls += ' vt-pending';
      if (hidden)  cls += ' vt-hidden';
      if (current) cls += ' vt-current';

      const content = hidden ? maskVerseWord(tok.raw) : esc(tok.raw);
      return '<span class="' + cls + '">' + content + '</span>';
    }).join(' ');

    const indentStyle = line.indent > 0
      ? ' style="padding-left:' + (line.indent * 0.55) + 'rem"'
      : '';
    return '<div class="vt-line"' + indentStyle + '>' + wordsHtml + '</div>';
  });

  container.innerHTML = linesHtml.join('');
  renderVerseProgress();
}

function renderVerseProgress() {
  const total    = _verseModel.count;
  const progress = $('verse-type-progress');

  if (_verseCursor >= total) {
    const correct = _verseStatus.filter(function (s) { return s === 'correct'; }).length;
    const pct = total ? Math.round(correct / total * 100) : 0;
    progress.textContent = 'Done!  ' + correct + ' / ' + total + ' correct (' + pct + '%)';
    progress.classList.add('vt-done');
  } else {
    progress.textContent = 'Word ' + (_verseCursor + 1) + ' of ' + total;
    progress.classList.remove('vt-done');
  }
}

/* ─── Typing logic ─────────────────────────────────── */

/**
 * Process one typed character for the current word. Correct first letter
 * marks the word green, a wrong one marks it red — either way we advance
 * to the next word (spaces/punctuation are skipped automatically).
 */
function handleVerseKey(ch) {
  if (!_practiceVerse || !_verseModel) return;
  if (_verseCursor >= _verseModel.count) return; // finished

  const expected = _verseModel.letters[_verseCursor];
  _verseStatus[_verseCursor] = (ch.toLowerCase() === expected) ? 'correct' : 'wrong';
  _verseCursor++;
  renderVerseType();
}

/** Backspace steps back one word and clears its result. */
function verseStepBack() {
  if (_verseCursor <= 0) return;
  _verseCursor--;
  _verseStatus[_verseCursor] = 'pending';
  renderVerseType();
}

// Capture typed characters via the input event (robust on mobile keyboards).
// The field is kept empty — it exists only to collect keystrokes.
$('verse-type-input').addEventListener('input', function () {
  const val = this.value;
  this.value = '';
  for (const ch of val) {
    if (/\s/.test(ch)) continue; // ignore spaces; words advance on their own
    handleVerseKey(ch);
  }
});

// Backspace fires on the (empty) input via keydown, not input.
$('verse-type-input').addEventListener('keydown', function (e) {
  if (e.key === 'Backspace' && this.value === '') {
    e.preventDefault();
    verseStepBack();
  }
});

// Tapping the verse re-focuses the input so the keyboard reappears.
$('verse-type-display').addEventListener('click', function () {
  $('verse-type-input').focus();
});

/* ─── Controls: levels, redo, next ─────────────────── */

document.querySelectorAll('.verse-level-pill').forEach(function (pill) {
  pill.addEventListener('click', function () {
    if (!_practiceVerse) return;
    _verseLevel = Number(pill.dataset.level);
    setupVerseLevel();
  });
});

$('btn-verse-redo').addEventListener('click', function () {
  if (!_practiceVerse) return;
  setupVerseLevel(); // re-randomizes blanks at level 2
});

$('btn-verse-next-level').addEventListener('click', function () {
  if (!_practiceVerse || _verseLevel >= 3) return;
  _verseLevel++;
  setupVerseLevel();
});


/* ═══════════════════════════════════════════════════════
   INITIALISE
   ═══════════════════════════════════════════════════════ */

renderExamList();
renderTrainer();
renderVerseList();

/* ─── Service worker (offline + auto-update) ─────────── */
// Only register over HTTPS or localhost; file:// has no SW support.
if ('serviceWorker' in navigator &&
    (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('./sw.js').then(function (reg) {
      // When a new SW takes control after an update, reload once so the
      // freshly-cached assets are used (stale-while-revalidate already
      // fetched them in the background on the previous visit).
      reg.addEventListener('updatefound', function () {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', function () {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            sw.postMessage('SKIP_WAITING');
          }
        });
      });
    }).catch(function (err) {
      console.warn('Service worker registration failed:', err);
    });

    let _reloadedForSW = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (_reloadedForSW) return;
      _reloadedForSW = true;
      window.location.reload();
    });
  });
}

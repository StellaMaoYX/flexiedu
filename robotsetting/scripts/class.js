/* ═══════════════════════════════════════════════════════════════════════════
 * FLEXI Teacher Interface — Class editor
 * A Class is one lesson's content: a list of heterogeneous Tasks (ordering /
 * sorting / multiple-choice). All tasks are edited and pushed to the
 * student's robot from this single page — selecting a different task in the
 * sidebar swaps which form is shown below, but "Push to Student" always
 * targets whichever task is currently selected.
 *
 * Firebase paths (under /robots/{robotId}/flexi/):
 *   pushed   – the task the teacher pushed (includes activityType)
 *   command  – control commands the teacher sends
 *   result   – result the student submitted
 * ═══════════════════════════════════════════════════════════════════════════ */

// ── Cloudinary Config ──────────────────────────────────────────────────────
const CLOUDINARY_CLOUD_NAME = 'dcqqsp2kz';
const CLOUDINARY_PRESET     = 'kolywy3s';
const UPLOAD_LABEL_STYLE = 'cursor:pointer;white-space:nowrap;padding:4px 9px;' +
  'background:#1a56a0;color:white;border-radius:7px;font-size:0.8rem;flex-shrink:0;';

// ── Task types a teacher can add to a class ─────────────────────────────────
const TASK_TYPES = [
  {
    key: 'ordering',
    label: 'Ordering',
    icon: '🧩',
    description: 'Drag-and-drop sequencing — words, sentences, paragraphs, pictures, or spelling.',
  },
  {
    key: 'sorting',
    label: 'Sorting',
    icon: '🗂️',
    description: 'Drag words or pictures into the correct category bin.',
  },
  {
    key: 'multiple-choice',
    label: 'Multiple Choice',
    icon: '✅',
    description: 'Single- or multi-select question, with optional images.',
  },
];
const TASK_TYPE_META = {};
TASK_TYPES.forEach(t => { TASK_TYPE_META[t.key] = t; });

// ── Ordering language levels (unchanged from the old sentence-ordering.js) ──
const LEVEL_LABELS = { word: 'Word', phrase: 'Phrase', sentence: 'Sentence', paragraph: 'Paragraph' };
const DEFAULT_INSTRUCTION = {
  word:      'Spell the word!',
  phrase:    'Put these phrases in order!',
  sentence:  'Put these steps in the correct order!',
  paragraph: 'Put these paragraphs in the correct order!',
};

const STUCK_PHRASE = "Uh-oh, I'm stuck. Let's try that again!";

// ── State ──────────────────────────────────────────────────────────────────
let currentRobotId = null;
let currentUid      = null;
let classId         = new URLSearchParams(window.location.search).get('class');
let robot           = null;
let robotConnected   = false;
let languageLevel    = 'sentence';   // only meaningful while an 'ordering' task is selected
let lastResultTs     = 0;

let tasks          = [];
let activeIndex     = 0;
let dragSrcIndex    = null;

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function esc(s) {
  return (s || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Load / Save Class ────────────────────────────────────────────────────
function storageKey() { return `emar_class_${classId}`; }

function normalizeTask(t) {
  if (!t.taskType) t.taskType = 'ordering';
  if (!t.id) t.id = genId();
  if (t.instruction === undefined) t.instruction = '';
  if (t.successPhrase === undefined) t.successPhrase = '';
  return t;
}

function _loadFromLocalStorage() {
  try {
    const raw = localStorage.getItem(storageKey());
    if (raw) {
      const data = JSON.parse(raw);
      tasks       = (data.tasks || []).map(normalizeTask);
      activeIndex = data.activeIndex || 0;
      return;
    }
  } catch (e) { /* corrupted */ }
  tasks       = [];
  activeIndex = 0;
}

function loadClassFromStorage() {
  function applyAndRender() {
    if (activeIndex >= tasks.length) activeIndex = tasks.length - 1;
    if (activeIndex < 0) activeIndex = 0;
    renderTaskList();
    if (tasks.length) loadTaskIntoEditor(activeIndex); else showEmptyEditorState();
  }

  if (!classId || !currentUid) { tasks = []; activeIndex = 0; applyAndRender(); return; }

  firebase.database()
    .ref(`/users/${currentUid}/library/${classId}`)
    .once('value',
      snapshot => {
        const data = snapshot.val();
        if (data) setClassName(data.name);
        if (data && Array.isArray(data.tasks)) {
          tasks       = data.tasks.map(normalizeTask);
          activeIndex = data.activeIndex || 0;
        } else {
          _loadFromLocalStorage();
        }
        applyAndRender();
      },
      error => {
        console.warn('Class load failed:', error);
        _loadFromLocalStorage();
        applyAndRender();
      }
    );
}

function setClassName(name) {
  const el = document.getElementById('topbarTitle');
  if (el && name) el.textContent = '🏫 ' + name;
}

function saveClassToStorage() {
  const data = { tasks, activeIndex };
  try { localStorage.setItem(storageKey(), JSON.stringify(data)); } catch (e) {}
  if (classId && currentUid) {
    try {
      firebase.database()
        .ref(`/users/${currentUid}/library/${classId}`)
        .update({ tasks, activeIndex, updatedAt: Date.now() })
        .catch(e => console.warn('Class save failed:', e));
    } catch (e) {}
  }
}

// ── Task Sidebar ───────────────────────────────────────────────────────────
function renderTaskList() {
  const container = document.getElementById('taskList');
  const emptyHint = document.getElementById('emptyTasksHint');
  if (!container) return;
  container.innerHTML = '';
  emptyHint.style.display = tasks.length ? 'none' : 'block';

  tasks.forEach((task, i) => {
    const meta = TASK_TYPE_META[task.taskType] || { icon: '📄', label: 'Task' };
    const div = document.createElement('div');
    div.className = 'queue-item' + (i === activeIndex ? ' active' : '');
    div.draggable = true;
    div.innerHTML = `
      <span class="queue-drag">&#8942;</span>
      <span class="queue-num">${i + 1}</span>
      <span class="queue-title">${esc(task.title || 'Untitled')}</span>
      <span class="queue-level-badge">${meta.icon} ${esc(meta.label)}</span>
      <button class="queue-rm" title="Remove" onclick="event.stopPropagation();removeTask(${i})">&#10005;</button>`;
    div.addEventListener('click', () => selectTask(i));
    div.addEventListener('dragstart', e => {
      dragSrcIndex = i;
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => div.classList.add('dragging'), 0);
    });
    div.addEventListener('dragend', () => {
      dragSrcIndex = null;
      document.querySelectorAll('.queue-item').forEach(el => el.classList.remove('dragging', 'drag-over'));
    });
    div.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      document.querySelectorAll('.queue-item').forEach(el => el.classList.remove('drag-over'));
      div.classList.add('drag-over');
    });
    div.addEventListener('dragleave', () => div.classList.remove('drag-over'));
    div.addEventListener('drop', e => {
      e.preventDefault();
      e.stopPropagation();
      if (dragSrcIndex === null || dragSrcIndex === i) return;
      saveCurrentTask();
      const moved = tasks.splice(dragSrcIndex, 1)[0];
      tasks.splice(i, 0, moved);
      if      (activeIndex === dragSrcIndex)                                   activeIndex = i;
      else if (dragSrcIndex < i && activeIndex > dragSrcIndex && activeIndex <= i) activeIndex--;
      else if (dragSrcIndex > i && activeIndex < dragSrcIndex && activeIndex >= i) activeIndex++;
      renderTaskList();
      saveClassToStorage();
    });
    container.appendChild(div);
  });
}

function selectTask(i) {
  saveCurrentTask();
  activeIndex = i;
  renderTaskList();
  loadTaskIntoEditor(i);
}

function openTaskTypePicker() {
  document.getElementById('taskTypeList').innerHTML = TASK_TYPES.map(t => `
    <button class="material-type-option" onclick="addTaskOfType('${t.key}')">
      <span class="material-type-icon">${t.icon}</span>
      <span class="material-type-text">
        <span class="material-type-label">${esc(t.label)}</span>
        <span class="material-type-desc">${esc(t.description)}</span>
      </span>
    </button>`).join('');
  document.getElementById('taskTypeModal').style.display = 'flex';
}
function closeTaskTypeModal() {
  document.getElementById('taskTypeModal').style.display = 'none';
}

function addTaskOfType(typeKey) {
  const meta = TASK_TYPE_META[typeKey];
  if (!meta) return;
  saveCurrentTask();

  const base = { id: genId(), taskType: typeKey, title: 'New ' + meta.label + ' Task', instruction: '', successPhrase: 'Great job!' };
  let task;
  if (typeKey === 'ordering') {
    task = Object.assign(base, { level: 'sentence', instruction: DEFAULT_INSTRUCTION.sentence, items: [], targetWord: null });
  } else if (typeKey === 'sorting') {
    task = Object.assign(base, {
      categories: [{ id: genId(), text: 'Category 1', image: null }, { id: genId(), text: 'Category 2', image: null }],
      items: [],
    });
  } else if (typeKey === 'multiple-choice') {
    task = Object.assign(base, {
      question: { text: '', image: null },
      multiSelect: false,
      options: [{ id: genId(), text: '', image: null, isCorrect: true }, { id: genId(), text: '', image: null, isCorrect: false }],
    });
  } else {
    return;
  }

  tasks.push(task);
  activeIndex = tasks.length - 1;
  closeTaskTypeModal();
  renderTaskList();
  loadTaskIntoEditor(activeIndex);
  saveClassToStorage();
}

function removeTask(i) {
  tasks.splice(i, 1);
  if (activeIndex >= tasks.length) activeIndex = tasks.length - 1;
  renderTaskList();
  if (tasks.length) loadTaskIntoEditor(activeIndex); else showEmptyEditorState();
  saveClassToStorage();
}

function saveTasks() {
  saveCurrentTask();
  saveClassToStorage();
  showSaveStatus('✓ Saved!');
}

function showSaveStatus(msg) {
  const el = document.getElementById('saveStatus');
  if (!el) return;
  el.textContent = msg;
  el.className   = 'save-status ok';
  setTimeout(() => { el.textContent = ''; el.className = 'save-status'; }, 3000);
}

function skipToNext() {
  if (tasks.length < 2) { showPushStatus('Only one task in this class.', 'error'); return; }
  saveCurrentTask();
  activeIndex = (activeIndex + 1) % tasks.length;
  renderTaskList();
  loadTaskIntoEditor(activeIndex);
  saveClassToStorage();
  pushToStudent();
}

function showEmptyEditorState() {
  document.getElementById('editorCardBody').style.display = 'none';
  document.getElementById('editorEmptyState').style.display = 'block';
}
function hideEmptyEditorState() {
  document.getElementById('editorCardBody').style.display = 'block';
  document.getElementById('editorEmptyState').style.display = 'none';
}

// ── Editor: load / save the selected task ───────────────────────────────────
function loadTaskIntoEditor(i) {
  const task = tasks[i];
  if (!task) { showEmptyEditorState(); return; }
  hideEmptyEditorState();

  document.getElementById('edTitle').value       = task.title       || '';
  document.getElementById('edInstruction').value = task.instruction || '';
  document.getElementById('edSuccess').value     = task.successPhrase || '';

  document.getElementById('orderingBody').style.display = task.taskType === 'ordering'        ? 'block' : 'none';
  document.getElementById('sortingBody').style.display  = task.taskType === 'sorting'          ? 'block' : 'none';
  document.getElementById('mcBody').style.display        = task.taskType === 'multiple-choice' ? 'block' : 'none';

  if (task.taskType === 'ordering') {
    languageLevel = task.level || 'sentence';
    const isWord = languageLevel === 'word';
    document.getElementById('wordInputArea').style.display = isWord ? 'block' : 'none';
    document.getElementById('itemsArea').style.display     = isWord ? 'none'  : 'block';
    if (isWord) {
      const word = task.targetWord || (task.items || []).map(it => it.text || '').join('');
      document.getElementById('wordLetterInput').value = word;
      previewWordLetters();
    } else {
      renderEditorItems(task.items || []);
    }
    updateEditorLevelTabs();
  } else if (task.taskType === 'sorting') {
    renderSortingCategories(task.categories || []);
    renderSortingItems(task.items || []);
  } else if (task.taskType === 'multiple-choice') {
    document.getElementById('mcQuestionText').value = (task.question && task.question.text) || '';
    const qImg = (task.question && task.question.image) || '';
    document.getElementById('mcQuestionImgUrl').value = qImg;
    const qPreview = document.getElementById('mcQuestionImgPreview');
    qPreview.style.display = qImg ? 'block' : 'none';
    qPreview.innerHTML     = qImg ? `<img src="${esc(qImg)}" style="max-height:70px;border-radius:6px;border:1px solid #dde;">` : '';
    setMcMultiSelect(!!task.multiSelect, true);
    renderMcOptions(task.options || []);
  }
}

function saveCurrentTask() {
  const task = tasks[activeIndex];
  if (!task) return;
  task.title         = document.getElementById('edTitle').value.trim()   || 'Untitled Task';
  task.successPhrase = document.getElementById('edSuccess').value.trim() || '';

  if (task.taskType === 'ordering') {
    task.level = languageLevel;
    if (languageLevel === 'word') {
      const word = (document.getElementById('wordLetterInput').value || '').trim().toLowerCase();
      task.instruction = document.getElementById('edInstruction').value.trim() || DEFAULT_INSTRUCTION.word;
      task.items        = word.split('').map(ch => ({ text: ch, image: null }));
      task.targetWord    = word;
    } else {
      const rows = document.querySelectorAll('#editorItems .editor-item');
      task.instruction = document.getElementById('edInstruction').value.trim() || '';
      task.items        = Array.from(rows).map(row => ({
        text:  row.querySelector('.item-text-input').value.trim(),
        image: row.querySelector('.item-img-input').value.trim() || null,
      })).filter(item => item.text || item.image);
      task.targetWord = null;
    }
  } else if (task.taskType === 'sorting') {
    task.instruction  = document.getElementById('edInstruction').value.trim() || '';
    task.categories    = currentCategoryDraft();
    const rows = document.querySelectorAll('#sortingItems .editor-item');
    task.items = Array.from(rows).map(row => ({
      id:         row.dataset.id,
      text:       row.querySelector('.sort-item-text').value.trim(),
      image:      row.querySelector('.sort-item-img').value.trim() || null,
      categoryId: row.querySelector('.sort-item-cat').value || null,
    })).filter(item => item.text || item.image);
  } else if (task.taskType === 'multiple-choice') {
    task.instruction = document.getElementById('edInstruction').value.trim() || '';
    task.multiSelect  = document.getElementById('mcMultiBtn').classList.contains('active');
    task.question = {
      text:  document.getElementById('mcQuestionText').value.trim(),
      image: document.getElementById('mcQuestionImgUrl').value.trim() || null,
    };
    const rows = document.querySelectorAll('#mcOptions .editor-item');
    task.options = Array.from(rows).map(row => ({
      id:        row.dataset.id,
      text:      row.querySelector('.opt-text').value.trim(),
      image:     row.querySelector('.opt-img').value.trim() || null,
      isCorrect: row.querySelector('.opt-correct-cb').checked,
    })).filter(o => o.text || o.image);
  }

  renderTaskList();
  saveClassToStorage();
}

// ── Read the selected task for pushing (reads live DOM, like the old
// readActivity() — doesn't depend on saveCurrentTask() having run first) ───
function readTask() {
  const task = tasks[activeIndex];
  if (!task) return null;

  const shared = {
    title:         document.getElementById('edTitle').value.trim()       || 'Untitled Task',
    instruction:   document.getElementById('edInstruction').value.trim() || '',
    successPhrase: document.getElementById('edSuccess').value.trim()     || 'Great job!',
    timestamp:     Date.now(),
  };

  if (task.taskType === 'ordering') {
    let items, targetWord;
    if (languageLevel === 'word') {
      const word = (document.getElementById('wordLetterInput').value || '').trim().toLowerCase();
      items      = word.split('').map(ch => ({ text: ch, image: null }));
      targetWord = word;
    } else {
      const rows = document.querySelectorAll('#editorItems .editor-item');
      items = Array.from(rows).map(row => ({
        text:  row.querySelector('.item-text-input').value.trim(),
        image: row.querySelector('.item-img-input').value.trim() || null,
      })).filter(item => item.text || item.image);
      targetWord = null;
    }
    return Object.assign(shared, { activityType: 'ordering', languageLevel, items, targetWord });
  }

  if (task.taskType === 'sorting') {
    const categories = currentCategoryDraft();
    const rows = document.querySelectorAll('#sortingItems .editor-item');
    const items = Array.from(rows).map(row => ({
      text:       row.querySelector('.sort-item-text').value.trim(),
      image:      row.querySelector('.sort-item-img').value.trim() || null,
      categoryId: row.querySelector('.sort-item-cat').value || null,
    })).filter(item => item.text || item.image);
    return Object.assign(shared, { activityType: 'sorting', categories, items });
  }

  if (task.taskType === 'multiple-choice') {
    const isMulti = document.getElementById('mcMultiBtn').classList.contains('active');
    const question = {
      text:  document.getElementById('mcQuestionText').value.trim(),
      image: document.getElementById('mcQuestionImgUrl').value.trim() || null,
    };
    const rows = document.querySelectorAll('#mcOptions .editor-item');
    const options = Array.from(rows).map(row => ({
      text:      row.querySelector('.opt-text').value.trim(),
      image:     row.querySelector('.opt-img').value.trim() || null,
      isCorrect: row.querySelector('.opt-correct-cb').checked,
    })).filter(o => o.text || o.image);
    return Object.assign(shared, { activityType: 'multiple-choice', multiSelect: isMulti, question, options });
  }

  return null;
}

// ── Shared image-upload helper ──────────────────────────────────────────────
function cloudinaryUpload(file, urlInput, preview, uploadLabel, onDone) {
  const origText = uploadLabel.childNodes[0].textContent;
  uploadLabel.childNodes[0].textContent = ' Uploading…';
  uploadLabel.style.background = '#888';

  const formData = new FormData();
  formData.append('file',          file);
  formData.append('upload_preset', CLOUDINARY_PRESET);

  fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
    method: 'POST',
    body:   formData,
  })
    .then(res => res.ok ? res.json() : res.json().then(err => { throw err; }))
    .then(data => {
      urlInput.value        = data.secure_url;
      preview.style.display = 'block';
      preview.innerHTML     = `<img src="${data.secure_url}" style="max-height:56px;border-radius:6px;border:1px solid #dde;">`;
      uploadLabel.childNodes[0].textContent = origText;
      uploadLabel.style.background = '#1a56a0';
      if (onDone) onDone(data.secure_url);
    })
    .catch(err => {
      console.error('Image upload failed:', err);
      alert('Image upload failed. Check the console for details.');
      uploadLabel.childNodes[0].textContent = origText;
      uploadLabel.style.background = '#1a56a0';
    });
}

function wireManualUrlPreview(urlInput, preview) {
  urlInput.addEventListener('change', () => {
    const url = urlInput.value.trim();
    preview.style.display = url ? 'block' : 'none';
    preview.innerHTML     = url
      ? `<img src="${url}" style="max-height:56px;border-radius:6px;border:1px solid #dde;">`
      : '';
  });
}

// ── Ordering: item editor (ported from the old sentence-ordering.js) ───────
let dragSrcRow = null;

function renderEditorItems(items) {
  const container = document.getElementById('editorItems');
  container.innerHTML = '';
  items.forEach((item, i) => container.appendChild(buildOrderingRow(i, item.text, item.image || '')));
  refreshRowNumbers();
}

function previewWordLetters() {
  const word = (document.getElementById('wordLetterInput').value || '').trim().toLowerCase();
  const container = document.getElementById('wordLetterPreview');
  if (!container) return;
  container.innerHTML = '';
  word.split('').forEach(ch => {
    const tile = document.createElement('span');
    tile.textContent = ch;
    tile.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;' +
      'width:36px;height:36px;border:2px solid #1a56a0;border-radius:8px;' +
      'font-size:1.2rem;font-weight:bold;color:#1a56a0;background:#f0f5ff;';
    container.appendChild(tile);
  });
  saveCurrentTask();
}

function refreshRowNumbers() {
  document.querySelectorAll('#editorItems .editor-item').forEach((row, i) => {
    const num = row.querySelector('.item-order-num');
    if (num) num.textContent = i + 1;
    row.dataset.idx = i;
  });
}

function buildOrderingRow(index, text, imgUrl) {
  const row = document.createElement('div');
  row.className = 'editor-item';
  row.dataset.idx = index;
  row.setAttribute('draggable', 'true');
  row.innerHTML = `
    <span class="item-drag-handle" title="Drag to reorder">⠿</span>
    <span class="item-order-num">${index + 1}</span>
    <div class="item-fields">
      <input class="item-text-input" type="text" placeholder="Word or sentence… (optional if using an image)" value="${esc(text)}">
      <div style="display:flex;gap:6px;align-items:center;">
        <input class="item-img-input" type="url"
               placeholder="Image URL (optional — or upload ▶)"
               value="${esc(imgUrl)}"
               style="flex:1;">
        <label style="${UPLOAD_LABEL_STYLE}" title="Upload image from computer">
          📤 Upload
          <input type="file" accept="image/*" style="display:none"
                 onchange="uploadOrderingItemImage(this)">
        </label>
      </div>
      <div class="item-img-preview" style="display:${imgUrl ? 'block' : 'none'};margin-top:4px;">
        ${imgUrl ? `<img src="${esc(imgUrl)}" style="max-height:56px;border-radius:6px;border:1px solid #dde;">` : ''}
      </div>
    </div>
    <button class="item-remove" onclick="removeOrderingItem(this)" title="Remove">&#10005;</button>`;

  const urlInput = row.querySelector('.item-img-input');
  const preview  = row.querySelector('.item-img-preview');
  wireManualUrlPreview(urlInput, preview);

  row.addEventListener('dragstart', e => {
    dragSrcRow = row;
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => row.style.opacity = '0.4', 0);
  });
  row.addEventListener('dragend', () => {
    row.style.opacity = '';
    document.querySelectorAll('#editorItems .editor-item').forEach(r => r.classList.remove('drag-over'));
  });
  row.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (row !== dragSrcRow) row.classList.add('drag-over');
  });
  row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
  row.addEventListener('drop', e => {
    e.preventDefault();
    row.classList.remove('drag-over');
    if (!dragSrcRow || dragSrcRow === row) return;
    const container = document.getElementById('editorItems');
    const rows = Array.from(container.querySelectorAll('.editor-item'));
    const srcIdx = rows.indexOf(dragSrcRow);
    const tgtIdx = rows.indexOf(row);
    if (srcIdx < tgtIdx) container.insertBefore(dragSrcRow, row.nextSibling);
    else container.insertBefore(dragSrcRow, row);
    refreshRowNumbers();
    saveCurrentTask();
  });

  return row;
}

function uploadOrderingItemImage(fileInput) {
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;
  const row      = fileInput.closest('.editor-item');
  const urlInput = row.querySelector('.item-img-input');
  const preview  = row.querySelector('.item-img-preview');
  cloudinaryUpload(file, urlInput, preview, fileInput.parentElement, () => saveCurrentTask());
  fileInput.value = '';
}

function addEditorItem() {
  const container = document.getElementById('editorItems');
  const newIdx    = container.querySelectorAll('.editor-item').length;
  container.appendChild(buildOrderingRow(newIdx, '', ''));
}

function removeOrderingItem(btn) {
  btn.closest('.editor-item').remove();
  refreshRowNumbers();
  saveCurrentTask();
}

// ── Ordering: language level ─────────────────────────────────────────────
function switchEditorLevel(level) {
  const task = tasks[activeIndex];
  if (!task || task.taskType !== 'ordering') return;
  if (level === task.level) { updateEditorLevelTabs(); return; }

  saveCurrentTask();

  const hasContent = task.level === 'word'
    ? !!(task.targetWord || (task.items && task.items.length))
    : !!((task.instruction && task.instruction !== DEFAULT_INSTRUCTION[task.level]) || (task.items && task.items.length));

  if (hasContent) {
    const ok = confirm(
      `Switching from "${LEVEL_LABELS[task.level]}" to "${LEVEL_LABELS[level]}" will clear this ` +
      `task's current content (each task can only have one tag). Continue?`
    );
    if (!ok) return;
  }

  languageLevel     = level;
  task.level         = level;
  task.instruction   = DEFAULT_INSTRUCTION[level];
  task.items         = [];
  task.targetWord    = null;

  const isWord = level === 'word';
  document.getElementById('wordInputArea').style.display = isWord ? 'block' : 'none';
  document.getElementById('itemsArea').style.display     = isWord ? 'none'  : 'block';
  document.getElementById('edInstruction').value = task.instruction;
  if (isWord) {
    document.getElementById('wordLetterInput').value = '';
    previewWordLetters();
  } else {
    renderEditorItems([]);
  }
  renderTaskList();
  saveClassToStorage();
  updateEditorLevelTabs();
}

function updateEditorLevelTabs() {
  document.querySelectorAll('#editorLevelTabs .level-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.level === languageLevel)
  );
}

// ── Sorting: categories & items ─────────────────────────────────────────────
function currentCategoryDraft() {
  return Array.from(document.querySelectorAll('#sortingCategories .editor-item')).map(row => ({
    id:    row.dataset.id,
    text:  row.querySelector('.cat-text-input').value.trim(),
    image: row.querySelector('.cat-img-input').value.trim() || null,
  })).filter(c => c.text || c.image);
}

function refreshItemCategoryOptions() {
  const cats = currentCategoryDraft();
  document.querySelectorAll('#sortingItems .sort-item-cat').forEach(select => {
    const row  = select.closest('.editor-item');
    const prev = select.options.length ? select.value : (row.dataset.wantCat || '');
    select.innerHTML = '<option value="">— choose category —</option>' +
      cats.map(c => `<option value="${esc(c.id)}">${esc(c.text || '(image category)')}</option>`).join('');
    select.value = cats.some(c => c.id === prev) ? prev : '';
    delete row.dataset.wantCat;
  });
}

function buildCategoryRow(cat) {
  const row = document.createElement('div');
  row.className = 'editor-item';
  row.dataset.id = cat.id || genId();
  const imgUrl = cat.image || '';
  row.innerHTML = `
    <div class="item-fields">
      <input class="item-text-input cat-text-input" type="text" placeholder="Category name…" value="${esc(cat.text || '')}">
      <div style="display:flex;gap:6px;align-items:center;">
        <input class="item-img-input cat-img-input" type="url" placeholder="Image URL (optional)" value="${esc(imgUrl)}" style="flex:1;">
        <label style="${UPLOAD_LABEL_STYLE}" title="Upload image from computer">
          📤 Upload
          <input type="file" accept="image/*" style="display:none" onchange="uploadCategoryImage(this)">
        </label>
      </div>
      <div class="item-img-preview" style="display:${imgUrl ? 'block' : 'none'};margin-top:4px;">
        ${imgUrl ? `<img src="${esc(imgUrl)}" style="max-height:56px;border-radius:6px;border:1px solid #dde;">` : ''}
      </div>
    </div>
    <button class="item-remove" onclick="removeSortingCategory(this)" title="Remove">&#10005;</button>`;

  const urlInput = row.querySelector('.cat-img-input');
  const preview  = row.querySelector('.item-img-preview');
  wireManualUrlPreview(urlInput, preview);
  urlInput.addEventListener('change', () => { refreshItemCategoryOptions(); saveCurrentTask(); });
  row.querySelector('.cat-text-input').addEventListener('change', () => { refreshItemCategoryOptions(); saveCurrentTask(); });
  return row;
}

function renderSortingCategories(categories) {
  const container = document.getElementById('sortingCategories');
  container.innerHTML = '';
  categories.forEach(cat => container.appendChild(buildCategoryRow(cat)));
}

function addSortingCategory() {
  document.getElementById('sortingCategories').appendChild(buildCategoryRow({ id: genId(), text: '', image: null }));
  refreshItemCategoryOptions();
}

function removeSortingCategory(btn) {
  btn.closest('.editor-item').remove();
  refreshItemCategoryOptions();
  saveCurrentTask();
}

function uploadCategoryImage(fileInput) {
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;
  const row      = fileInput.closest('.editor-item');
  const urlInput = row.querySelector('.cat-img-input');
  const preview  = row.querySelector('.item-img-preview');
  cloudinaryUpload(file, urlInput, preview, fileInput.parentElement, () => { refreshItemCategoryOptions(); saveCurrentTask(); });
  fileInput.value = '';
}

function buildSortingItemRow(item) {
  const row = document.createElement('div');
  row.className = 'editor-item';
  row.dataset.id = item.id || genId();
  row.dataset.wantCat = item.categoryId || '';
  const imgUrl = item.image || '';
  row.innerHTML = `
    <div class="item-fields">
      <input class="item-text-input sort-item-text" type="text" placeholder="Word or picture label… (optional if using an image)" value="${esc(item.text || '')}">
      <div style="display:flex;gap:6px;align-items:center;">
        <input class="item-img-input sort-item-img" type="url" placeholder="Image URL (optional — or upload ▶)" value="${esc(imgUrl)}" style="flex:1;">
        <label style="${UPLOAD_LABEL_STYLE}" title="Upload image from computer">
          📤 Upload
          <input type="file" accept="image/*" style="display:none" onchange="uploadSortingItemImage(this)">
        </label>
      </div>
      <div class="item-img-preview" style="display:${imgUrl ? 'block' : 'none'};margin-top:4px;">
        ${imgUrl ? `<img src="${esc(imgUrl)}" style="max-height:56px;border-radius:6px;border:1px solid #dde;">` : ''}
      </div>
      <select class="item-cat-select sort-item-cat"></select>
    </div>
    <button class="item-remove" onclick="removeSortingItem(this)" title="Remove">&#10005;</button>`;

  const urlInput = row.querySelector('.sort-item-img');
  const preview  = row.querySelector('.item-img-preview');
  wireManualUrlPreview(urlInput, preview);
  row.querySelector('.sort-item-cat').addEventListener('change', saveCurrentTask);
  return row;
}

function renderSortingItems(items) {
  const container = document.getElementById('sortingItems');
  container.innerHTML = '';
  items.forEach(item => container.appendChild(buildSortingItemRow(item)));
  refreshItemCategoryOptions();
}

function addSortingItem() {
  document.getElementById('sortingItems').appendChild(buildSortingItemRow({ id: genId(), text: '', image: null, categoryId: null }));
  refreshItemCategoryOptions();
  saveCurrentTask();
}

function removeSortingItem(btn) {
  btn.closest('.editor-item').remove();
  saveCurrentTask();
}

function uploadSortingItemImage(fileInput) {
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;
  const row      = fileInput.closest('.editor-item');
  const urlInput = row.querySelector('.sort-item-img');
  const preview  = row.querySelector('.item-img-preview');
  cloudinaryUpload(file, urlInput, preview, fileInput.parentElement, () => saveCurrentTask());
  fileInput.value = '';
}

// ── Multiple Choice: question & options ─────────────────────────────────────
function setMcMultiSelect(isMulti, fromLoad) {
  document.getElementById('mcSingleBtn').classList.toggle('active', !isMulti);
  document.getElementById('mcMultiBtn').classList.toggle('active', isMulti);
  if (fromLoad) return;
  if (!isMulti) {
    let seenChecked = false;
    document.querySelectorAll('#mcOptions .opt-correct-cb').forEach(cb => {
      if (cb.checked) { if (seenChecked) cb.checked = false; else seenChecked = true; }
    });
  }
  saveCurrentTask();
}

function uploadMcQuestionImage(fileInput) {
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;
  const urlInput = document.getElementById('mcQuestionImgUrl');
  const preview  = document.getElementById('mcQuestionImgPreview');
  cloudinaryUpload(file, urlInput, preview, fileInput.parentElement, () => saveCurrentTask());
  fileInput.value = '';
}
// Wire the manual-URL preview for the question image once at load time.
document.addEventListener('DOMContentLoaded', () => {
  const urlInput = document.getElementById('mcQuestionImgUrl');
  const preview  = document.getElementById('mcQuestionImgPreview');
  if (urlInput && preview) wireManualUrlPreview(urlInput, preview);
});

function buildMcOptionRow(opt) {
  const row = document.createElement('div');
  row.className = 'editor-item';
  row.dataset.id = opt.id || genId();
  const imgUrl = opt.image || '';
  row.innerHTML = `
    <div class="item-fields">
      <input class="item-text-input opt-text" type="text" placeholder="Option text… (optional if using an image)" value="${esc(opt.text || '')}">
      <div style="display:flex;gap:6px;align-items:center;">
        <input class="item-img-input opt-img" type="url" placeholder="Image URL (optional — or upload ▶)" value="${esc(imgUrl)}" style="flex:1;">
        <label style="${UPLOAD_LABEL_STYLE}" title="Upload image from computer">
          📤 Upload
          <input type="file" accept="image/*" style="display:none" onchange="uploadMcOptionImage(this)">
        </label>
      </div>
      <div class="item-img-preview" style="display:${imgUrl ? 'block' : 'none'};margin-top:4px;">
        ${imgUrl ? `<img src="${esc(imgUrl)}" style="max-height:56px;border-radius:6px;border:1px solid #dde;">` : ''}
      </div>
      <label class="item-correct-row">
        <input type="checkbox" class="opt-correct-cb" ${opt.isCorrect ? 'checked' : ''}> Correct answer
      </label>
    </div>
    <button class="item-remove" onclick="removeMcOption(this)" title="Remove">&#10005;</button>`;

  const urlInput = row.querySelector('.opt-img');
  const preview  = row.querySelector('.item-img-preview');
  wireManualUrlPreview(urlInput, preview);

  row.querySelector('.opt-correct-cb').addEventListener('change', e => {
    const isMulti = document.getElementById('mcMultiBtn').classList.contains('active');
    if (!isMulti && e.target.checked) {
      document.querySelectorAll('#mcOptions .opt-correct-cb').forEach(other => {
        if (other !== e.target) other.checked = false;
      });
    }
    saveCurrentTask();
  });

  return row;
}

function renderMcOptions(options) {
  const container = document.getElementById('mcOptions');
  container.innerHTML = '';
  options.forEach(opt => container.appendChild(buildMcOptionRow(opt)));
}

function addMcOption() {
  document.getElementById('mcOptions').appendChild(buildMcOptionRow({ id: genId(), text: '', image: null, isCorrect: false }));
  saveCurrentTask();
}

function removeMcOption(btn) {
  btn.closest('.editor-item').remove();
  saveCurrentTask();
}

function uploadMcOptionImage(fileInput) {
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;
  const row      = fileInput.closest('.editor-item');
  const urlInput = row.querySelector('.opt-img');
  const preview  = row.querySelector('.item-img-preview');
  cloudinaryUpload(file, urlInput, preview, fileInput.parentElement, () => saveCurrentTask());
  fileInput.value = '';
}

// ── Push to Student Screen ─────────────────────────────────────────────────
function pushToStudent() {
  const task = tasks[activeIndex];
  if (!task) { showPushStatus('Add a task first.', 'error'); return; }
  const activity = readTask();
  if (!activity) return;

  if (activity.activityType === 'ordering') {
    if (activity.items.length === 0) { showPushStatus('Please add at least one item.', 'error'); return; }
  } else if (activity.activityType === 'sorting') {
    if (activity.categories.length < 2) { showPushStatus('Add at least 2 categories.', 'error'); return; }
    if (activity.items.length === 0)     { showPushStatus('Please add at least one item.', 'error'); return; }
    if (activity.items.some(it => !it.categoryId)) { showPushStatus('Every item needs a category.', 'error'); return; }
  } else if (activity.activityType === 'multiple-choice') {
    if (activity.options.length < 2) { showPushStatus('Add at least 2 options.', 'error'); return; }
    const correctCount = activity.options.filter(o => o.isCorrect).length;
    if (correctCount === 0) { showPushStatus('Mark at least one correct option.', 'error'); return; }
    if (!activity.multiSelect && correctCount > 1) { showPushStatus('Single-choice can only have 1 correct option.', 'error'); return; }
  }

  try {
    firebase.database()
      .ref(`/robots/${currentRobotId}/flexi/pushed`)
      .set(Object.assign({}, activity, { _pushedAt: Date.now() }))
      .then(() => firebase.database().ref(`/robots/${currentRobotId}/flexi/bellyMode`).set('activity'))
      .then(() => { showPushStatus('✓ Pushed to student screen!', 'ok'); startWaitingMotion(); showAnsweringState(); })
      .catch(e => showPushStatus('Firebase error: ' + e.message, 'error'));
  } catch (e) {
    showPushStatus('Firebase unavailable — check your connection.', 'error');
  }
}

function showPushStatus(msg, type) {
  const el = document.getElementById('pushStatus');
  el.textContent = msg;
  el.className   = `push-status ${type}`;
  setTimeout(() => { el.textContent = ''; el.className = 'push-status'; }, 4000);
}

// ── Initialization ─────────────────────────────────────────────────────────
function initClass() {
  currentRobotId = Number(new URLSearchParams(window.location.search).get('robot') || 0);

  try {
    robot = new Robot(currentRobotId);
    Robot.initialize();

    let statusResolved = false;

    firebase.database()
      .ref(`/robots/${currentRobotId}/state`)
      .once('value', snapshot => {
        statusResolved = true;
        const hasState = snapshot.val() !== null;
        robotConnected = hasState;
        setRobotStatus(hasState);
      })
      .catch(() => {
        statusResolved = true;
        setRobotStatus(false);
      });

    setTimeout(() => {
      if (!statusResolved) setRobotStatus(false);
    }, 5000);

    firebase.database()
      .ref(`/robots/${currentRobotId}/state`)
      .on('value', snapshot => {
        const online = snapshot.val() !== null;
        robotConnected = online;
        setRobotStatus(online);
      });

  } catch (e) {
    console.warn('Firebase unavailable — standalone mode:', e);
    setRobotStatus(false);
  }

  const base = window.location.href.replace(/\/robotsetting\/.*$/, '');
  const studentUrl = `${base}/robotdisplay/robot-belly.html?robot=${currentRobotId}`;
  const linkEl = document.getElementById('studentLink');
  linkEl.href        = studentUrl;
  linkEl.textContent = studentUrl;

  loadClassFromStorage();
  listenForResults();
}

function setRobotStatus(connected) {
  robotConnected = connected;
  document.getElementById('statusDot').className  = `status-dot ${connected ? 'dot-on' : 'dot-off'}`;
  document.getElementById('statusText').textContent = connected ? 'Robot connected' : 'Robot not connected (standalone)';
  document.getElementById('robotBadge').textContent = connected ? '🤖 Connected' : '⚠ No robot';
}

// ── Robot Motion (unchanged from the old sentence-ordering.js) ─────────────
let waitingMotionInterval = null;
let motionTimeouts = [];

function clearMotionTimeouts() {
  motionTimeouts.forEach(id => clearTimeout(id));
  motionTimeouts = [];
}

function mot(fn, delay) {
  motionTimeouts.push(setTimeout(fn, delay));
}

function startWaitingMotion() {
  if (!robotConnected || !robot || !Robot.currentMotorState) return;
  stopWaitingMotion();
  clearMotionTimeouts();
  try {
    robot.moveNeck(0, -1100, 0, 0);
    mot(() => { if (Robot.currentMotorState) robot.moveNeck( 150, 0, 0, 0); }, 600);
    mot(() => { if (Robot.currentMotorState) robot.moveNeck(-450, 0, 0, 0); }, 1200);
    mot(() => { if (Robot.currentMotorState) robot.moveNeck( 300, 0, 0, 0); }, 1800);
  } catch (e) {}
}

function stopWaitingMotion() {
  if (waitingMotionInterval) {
    clearInterval(waitingMotionInterval);
    waitingMotionInterval = null;
  }
}

function playCorrectMotion() {
  if (!robotConnected || !robot || !Robot.currentMotorState) return;
  stopWaitingMotion();
  clearMotionTimeouts();
  try {
    robot.moveNeck(0,  200, 0, 0);
    mot(() => { if (Robot.currentMotorState) robot.moveNeck(0, -400, 0, 0); }, 500);
    mot(() => { if (Robot.currentMotorState) robot.moveNeck(0,  400, 0, 0); }, 1000);
    mot(() => { if (Robot.currentMotorState) robot.moveNeck(0, -400, 0, 0); }, 1500);
    mot(() => { if (Robot.currentMotorState) robot.moveNeck(0,  400, 0, 0); }, 2000);
    mot(() => { if (Robot.currentMotorState) robot.moveNeck(0, -200, 0, 0); }, 2500);
  } catch (e) {}
}

function playStuckMotion() {
  if (!robotConnected || !robot || !Robot.currentMotorState) return;
  stopWaitingMotion();
  clearMotionTimeouts();
  try {
    robot.moveNeck(0, -200, 0, 0);
    mot(() => { if (Robot.currentMotorState) robot.moveNeck(0, 0, 0, -300); }, 600);
    mot(() => { if (Robot.currentMotorState) robot.moveNeck(0, 0, 0,  600); }, 1200);
    mot(() => { if (Robot.currentMotorState) robot.moveNeck(0, 0, 0, -600); }, 1800);
    mot(() => { if (Robot.currentMotorState) robot.moveNeck(0, 0, 0,  300); }, 2400);
    mot(() => { if (Robot.currentMotorState) robot.moveNeck(0, 200, 0,   0); }, 3000);
  } catch (e) {}
}

// ── Teacher Commands ───────────────────────────────────────────────────────
function sendCommand(type) {
  try {
    firebase.database()
      .ref(`/robots/${currentRobotId}/flexi/command`)
      .set({ type, timestamp: Date.now() });
    if (type === 'reset' || type === 'tryAgain') showAnsweringState();
  } catch (e) { console.warn('Command send failed:', e); }
}

// ── Student Result Listener ────────────────────────────────────────────────
function listenForResults() {
  try {
    firebase.database()
      .ref(`/robots/${currentRobotId}/flexi/result`)
      .on('value', snapshot => {
        const data = snapshot.val();
        if (!data || data.timestamp <= lastResultTs) return;
        lastResultTs = data.timestamp;
        handleStudentResult(data.isCorrect);
      });
    firebase.database()
      .ref(`/robots/${currentRobotId}/flexi/studentStatus`)
      .on('value', snapshot => {
        const data = snapshot.val();
        if (data && data.status === 'answering') showAnsweringState();
      });
  } catch (e) { console.warn('Result listener failed:', e); }
}

function handleStudentResult(isCorrect) {
  const activity = readTask();
  if (!activity) return;

  if (isCorrect) {
    updateResultBox(true, activity.successPhrase || '');
    robotSpeak(activity.successPhrase || 'Wonderful! You did it!');
    playCorrectMotion();
  } else {
    updateResultBox(false);
    robotSpeak(STUCK_PHRASE);
    playStuckMotion();
  }
}

function robotSpeak(text) {
  if (robotConnected) {
    try { Robot._requestRobotAction('speak', { text }); } catch (e) { /* standalone */ }
  }
}

function showAnsweringState() {
  const box = document.getElementById('resultBox');
  box.className = 'result-box answering';
  box.innerHTML = `
    <div class="result-emoji">✏️</div>
    <div class="result-label">Student is answering…</div>
    <div class="result-time"></div>`;
}

function updateResultBox(isCorrect, successPhrase) {
  const box = document.getElementById('resultBox');
  const now = new Date().toLocaleTimeString();
  if (isCorrect) {
    box.className = 'result-box correct';
    box.innerHTML = `
      <div class="result-emoji">🎉</div>
      <div class="result-label">Amazing! You got it right!</div>
      ${successPhrase ? `<div class="result-sub">${esc(successPhrase)}</div>` : ''}
      <div class="result-time">at ${now}</div>`;
  } else {
    box.className = 'result-box incorrect';
    box.innerHTML = `
      <div class="result-emoji">🤔</div>
      <div class="result-label">Hmm, I'm stuck…</div>
      <div class="result-sub">Let's try that again!</div>
      <div class="result-time">at ${now}</div>`;
  }
}

// ── Bootstrap ──────────────────────────────────────────────────────────────
Database.handleAuthStateChange = function(user) {
  if (user && !user.isAnonymous && Database.readyCallback) {
    Database.readyCallback(user);
  }
};

function waitForAuth() {
  if (typeof firebase !== 'undefined' && firebase.auth) {
    firebase.auth().onAuthStateChanged(user => {
      if (!user || user.isAnonymous) {
        window.location.href = '../index.html';
        return;
      }
      currentUid = user.uid;
      initClass();
    });
  } else {
    setTimeout(waitForAuth, 200);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  if (typeof Config !== 'undefined' && typeof Database !== 'undefined') {
    try {
      new Database(new Config().config, null);
      waitForAuth();
    } catch (e) {
      console.warn('Firebase init failed — running standalone:', e);
      initClass();
    }
  } else {
    initClass();
  }
});

window.addEventListener('beforeunload', () => saveCurrentTask());

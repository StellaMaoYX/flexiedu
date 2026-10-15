/* ═══════════════════════════════════════════════════════════════════════════
 * FLEXI Student Interface
 * Two ways content arrives:
 *   /robots/{id}/flexi/lesson – a whole class started by the teacher. The
 *     student works through lesson.steps on their own: tasks must be answered
 *     correctly (retrying as often as needed), then "Next"; intro/reflection
 *     steps just need "Next"/"Done". Progress (current, results) is written
 *     back so the teacher's class page can follow along.
 *   /robots/{id}/flexi/pushed – a single task pushed for a quick try; only
 *     shown while no lesson is running.
 * Task types: 'ordering' (drag-from-bank-to-slot), 'sorting'
 * (drag-from-bank-to-bin), 'multiple-choice' (tap options). Missing/legacy
 * activityType is treated as 'ordering'. With neither, the welcome screen shows.
 * ═══════════════════════════════════════════════════════════════════════════ */

// ── Shared state ─────────────────────────────────────────────────────────
let currentActivity   = null;
let currentRobotId    = null;
let feedbackIsCorrect = false;
let lastCommandTs     = 0;

// Lesson state
let lesson            = null;  // /flexi/lesson while one is running or finished
let renderedStepKey   = null;  // "<current>:<stepStartedAt>" of the step on screen
let lastPushed        = null;  // last single pushed task, shown when no lesson
let advancing         = false;

// Ordering state
let slots = [];   // array of N: null or item object
let bank  = [];   // unplaced items
let dragSrc = null;  // { from: 'slot'|'bank', index: number }

// Sorting state
let sortBinItems     = {};   // categoryId -> [item,...]
let sortBankItems    = [];   // unplaced items
let selectedBankItem = null; // index into sortBankItems, for tap-to-place
let sortDragSrc      = null; // { from:'bank', index } | { from:'bin', catId, index }

// Multiple choice state
let mcSelected = []; // selected option indices

const STUCK_PHRASE = "Uh-oh, I'm stuck. Let's try that again!";

// ── Initialization ─────────────────────────────────────────────────────────
function initStudent() {
  currentRobotId = Number(new URLSearchParams(window.location.search).get('robot') || 0);

  firebase.database()
    .ref(`/robots/${currentRobotId}/flexi/pushed`)
    .on('value', snapshot => {
      lastPushed = snapshot.val();
      if (lesson) return;  // a running lesson takes priority
      if (lastPushed) renderActivity(lastPushed);
      else showOnly('waitingScreen');
    });

  firebase.database()
    .ref(`/robots/${currentRobotId}/flexi/lesson`)
    .on('value', snapshot => onLessonChanged(snapshot.val()));

  firebase.database()
    .ref(`/robots/${currentRobotId}/flexi/command`)
    .on('value', snapshot => {
      const data = snapshot.val();
      if (!data || data.timestamp <= lastCommandTs) return;
      lastCommandTs = data.timestamp;
      handleCommand(data.type);
    });
}

// Starts the right activity for a task payload (pushed task or lesson step).
function renderActivity(data) {
  const type = data.activityType || 'ordering';
  if (type === 'multiple-choice') {
    if (!data.options || !data.options.length) return;
    startMultipleChoice(data);
  } else if (type === 'sorting') {
    const rawItems = Array.isArray(data.items) ? data.items : Object.values(data.items || {});
    if (rawItems.length === 0) return;
    startSorting(Object.assign({}, data, { items: rawItems }));
  } else {
    if (!data.items) return;
    const rawItems = Array.isArray(data.items) ? data.items : Object.values(data.items);
    if (rawItems.length > 0) startOrdering(Object.assign({}, data, { items: rawItems }));
  }
}

// ── Lesson ──────────────────────────────────────────────────────────────────
function lessonRef(path) {
  return firebase.database().ref(`/robots/${currentRobotId}/flexi/lesson` + (path ? '/' + path : ''));
}

function onLessonChanged(data) {
  lesson = data && Array.isArray(data.steps) ? data : null;
  advancing = false;

  if (!lesson) {
    renderedStepKey = null;
    if (lastPushed) renderActivity(lastPushed);
    else { currentActivity = null; showOnly('waitingScreen'); }
    return;
  }

  // Result/attempt writes also change the lesson; only re-render on a new step.
  const key = lesson.status + ':' + lesson.current + ':' + lesson.stepStartedAt;
  if (key === renderedStepKey) return;
  renderedStepKey = key;
  hideFeedback();

  if (lesson.status === 'finished' || lesson.current >= lesson.steps.length) {
    currentActivity = null;
    showOnly('finishedScreen');
    speakText('Great work! You finished the lesson.');
    return;
  }

  const step = lesson.steps[lesson.current];
  const progress = 'Step ' + (lesson.current + 1) + ' of ' + lesson.steps.length;
  if (step.activityType === 'intro' || step.activityType === 'reflection') {
    currentActivity = null;
    document.getElementById('messageProgress').textContent = progress;
    document.getElementById('messageTitle').textContent = step.title || '';
    document.getElementById('messageText').textContent  = step.instruction || '';
    const img = document.getElementById('messageImage');
    img.style.display = step.image ? '' : 'none';
    if (step.image) img.src = step.image; else img.removeAttribute('src');
    const isLast = lesson.current === lesson.steps.length - 1;
    document.getElementById('messageBtn').textContent = isLast ? 'Done ✓' : 'Next ➜';
    showOnly('messageScreen');
    const title = step.title && !/[.!?]$/.test(step.title) ? step.title + '.' : step.title;
    speakText([title, step.instruction].filter(Boolean).join(' '));
  } else {
    renderActivity(step);
    document.getElementById('activityProgress').textContent = progress;
    speakText(step.instruction || step.title);
  }
}

// Move to the next step, or finish after the last one.
function advanceLesson() {
  if (!lesson || advancing) return;
  advancing = true;
  const next = lesson.current + 1;
  const updates = { current: next, stepStartedAt: Date.now() };
  if (next >= lesson.steps.length) updates.status = 'finished';
  lessonRef().update(updates).catch(e => { advancing = false; console.warn('Advance failed:', e); });
}

function onMessageNext() {
  if (!lesson) return;
  lessonRef('results/' + lesson.current).set({ done: true, completedAt: Date.now() });
  advanceLesson();
}

// Count every check of a lesson task; mark it correct once it is.
function recordLessonAttempt(isCorrect) {
  if (!lesson) return;
  const ref = lessonRef('results/' + lesson.current);
  ref.child('attempts').transaction(n => (n || 0) + 1);
  if (isCorrect) ref.update({ correct: true, completedAt: Date.now() });
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Shows one of the top-level screens and hides the rest.
function showOnly(screenId) {
  ['waitingScreen', 'activityScreen', 'messageScreen', 'finishedScreen'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = id !== screenId ? 'none' : (id === 'activityScreen' ? 'block' : 'flex');
  });
}

function showScreen(activityType) {
  showOnly('activityScreen');
  document.getElementById('activityProgress').textContent = '';
  document.getElementById('orderingScreen').style.display = activityType === 'ordering'        ? 'block' : 'none';
  document.getElementById('sortingScreen').style.display  = activityType === 'sorting'          ? 'block' : 'none';
  document.getElementById('mcScreen').style.display        = activityType === 'multiple-choice' ? 'block' : 'none';
}

// ── Teacher Commands ───────────────────────────────────────────────────────
function handleCommand(type) {
  if (!currentActivity) return;
  const actType = currentActivity.activityType || 'ordering';
  if (type === 'reset' || type === 'tryAgain') {
    if      (actType === 'sorting')          resetSorting();
    else if (actType === 'multiple-choice')  resetMultipleChoice();
    else                                      resetOrdering();
    if (type === 'tryAgain') speakText(STUCK_PHRASE);
  } else if (type === 'repeat') {
    speakText(currentActivity.instruction);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Ordering — drag-from-bank-to-slot (unchanged behavior, just namespaced)
// ═══════════════════════════════════════════════════════════════════════════
function startOrdering(data) {
  currentActivity = data;

  const items = data.items.map((item, i) => ({ ...item, origIdx: i }));
  slots = new Array(items.length).fill(null);
  bank  = shuffle([...items]);

  showScreen('ordering');
  document.getElementById('activityTitle').textContent       = data.title;
  document.getElementById('activityInstruction').textContent = data.instruction;
  document.getElementById('levelBadge').textContent =
    (data.languageLevel || 'sentence').charAt(0).toUpperCase() + (data.languageLevel || 'sentence').slice(1);

  hideFeedback();
  renderOrdering();
}

function resetOrdering() {
  const items = currentActivity.items.map((item, i) => ({ ...item, origIdx: i }));
  slots = new Array(items.length).fill(null);
  bank  = shuffle([...items]);
  hideFeedback();
  renderOrdering();
}

function renderOrdering() {
  renderSlots();
  renderBank();
  updateCheckBtn();
}

function renderSlots() {
  const container = document.getElementById('answerSlots');
  container.innerHTML = '';

  slots.forEach((item, i) => {
    const slot = document.createElement('div');
    slot.className   = 'answer-slot' + (item ? ' filled' : '');
    slot.dataset.idx = i;

    const num = document.createElement('span');
    num.className   = 'slot-num';
    num.textContent = i + 1;
    slot.appendChild(num);

    if (item) {
      const content = document.createElement('div');
      content.className = 'slot-content';
      if (item.image) {
        const img = document.createElement('img');
        img.className = 'slot-img';
        img.src = item.image;
        img.alt = item.text;
        content.appendChild(img);
      }
      const text = document.createElement('div');
      text.className   = 'slot-text';
      text.textContent = item.text;
      content.appendChild(text);

      const speakBtn = document.createElement('button');
      speakBtn.className   = 'slot-speak';
      speakBtn.textContent = '🔊';
      speakBtn.title = 'Listen';
      speakBtn.onclick = e => { e.stopPropagation(); speakText(item.text); };
      content.appendChild(speakBtn);

      slot.appendChild(content);

      // Tap filled slot → return to bank
      slot.addEventListener('click', () => returnSlotToBank(i));

      // Drag from filled slot
      slot.setAttribute('draggable', 'true');
      slot.addEventListener('dragstart', e => {
        dragSrc = { from: 'slot', index: i };
        e.dataTransfer.effectAllowed = 'move';
        slot.style.opacity = '0.4';
      });
      slot.addEventListener('dragend', () => { slot.style.opacity = ''; });

    } else {
      const hint = document.createElement('span');
      hint.className   = 'slot-empty-hint';
      hint.textContent = '+';
      slot.appendChild(hint);
    }

    // Drop onto slot
    slot.addEventListener('dragover', e => {
      e.preventDefault();
      slot.classList.add('drag-over');
    });
    slot.addEventListener('dragleave', () => slot.classList.remove('drag-over'));
    slot.addEventListener('drop', e => {
      e.preventDefault();
      slot.classList.remove('drag-over');
      dropOnSlot(i);
    });

    container.appendChild(slot);
  });

  // Drop on the zone itself (between slots)
  container.addEventListener('dragover', e => {
    e.preventDefault();
    container.classList.add('drag-over-zone');
  });
  container.addEventListener('dragleave', () => container.classList.remove('drag-over-zone'));
  container.addEventListener('drop', e => {
    e.preventDefault();
    container.classList.remove('drag-over-zone');
    const firstEmpty = slots.indexOf(null);
    if (firstEmpty !== -1) dropOnSlot(firstEmpty);
  });
}

function renderBank() {
  const container = document.getElementById('bankItems');
  container.innerHTML = '';

  if (bank.length === 0) {
    const hint = document.createElement('div');
    hint.className   = 'bank-empty-hint';
    hint.textContent = 'All placed!';
    container.appendChild(hint);
  }

  bank.forEach((item, i) => {
    const bubble = document.createElement('div');
    bubble.className   = 'bank-bubble';
    bubble.dataset.idx = i;

    if (item.image) {
      const img = document.createElement('img');
      img.className = 'bubble-img';
      img.src = item.image;
      img.alt = item.text;
      bubble.appendChild(img);
    }

    const text = document.createElement('span');
    text.textContent = item.text;
    bubble.appendChild(text);

    const speakBtn = document.createElement('button');
    speakBtn.className   = 'bubble-speak';
    speakBtn.textContent = '🔊';
    speakBtn.title = 'Listen';
    speakBtn.onclick = e => { e.stopPropagation(); speakText(item.text); };
    bubble.appendChild(speakBtn);

    // Tap bubble → auto-place in first empty slot
    bubble.addEventListener('click', e => {
      if (e.target.closest('.bubble-speak')) return;
      const firstEmpty = slots.indexOf(null);
      if (firstEmpty !== -1) {
        slots[firstEmpty] = bank.splice(i, 1)[0];
        renderOrdering();
      }
    });

    // Drag from bank
    bubble.setAttribute('draggable', 'true');
    bubble.addEventListener('dragstart', e => {
      dragSrc = { from: 'bank', index: i };
      e.dataTransfer.effectAllowed = 'move';
      bubble.classList.add('dragging');
    });
    bubble.addEventListener('dragend', () => bubble.classList.remove('dragging'));

    container.appendChild(bubble);
  });

  // Drop on bank → return slot item to bank
  container.addEventListener('dragover', e => {
    e.preventDefault();
    container.classList.add('drag-over-zone');
  });
  container.addEventListener('dragleave', () => container.classList.remove('drag-over-zone'));
  container.addEventListener('drop', e => {
    e.preventDefault();
    container.classList.remove('drag-over-zone');
    if (dragSrc && dragSrc.from === 'slot') {
      const item = slots[dragSrc.index];
      if (item) {
        bank.push(item);
        slots[dragSrc.index] = null;
        dragSrc = null;
        renderOrdering();
      }
    } else {
      dragSrc = null;
    }
  });
}

function dropOnSlot(targetSlotIdx) {
  if (!dragSrc) return;

  if (dragSrc.from === 'bank') {
    const item = bank.splice(dragSrc.index, 1)[0];
    if (slots[targetSlotIdx]) bank.push(slots[targetSlotIdx]);
    slots[targetSlotIdx] = item;

  } else if (dragSrc.from === 'slot') {
    const srcIdx = dragSrc.index;
    if (srcIdx === targetSlotIdx) { dragSrc = null; return; }
    [slots[srcIdx], slots[targetSlotIdx]] = [slots[targetSlotIdx], slots[srcIdx]];
  }

  dragSrc = null;
  renderOrdering();
}

function returnSlotToBank(i) {
  if (!slots[i]) return;
  bank.push(slots[i]);
  slots[i] = null;
  renderOrdering();
}

// ═══════════════════════════════════════════════════════════════════════════
// Sorting — drag/tap items from a bank into category bins
// ═══════════════════════════════════════════════════════════════════════════
function startSorting(data) {
  currentActivity = data;
  sortBinItems     = {};
  (data.categories || []).forEach(c => { sortBinItems[c.id] = []; });
  sortBankItems    = shuffle((data.items || []).map((item, i) => ({ ...item, origIdx: i })));
  selectedBankItem = null;

  showScreen('sorting');
  document.getElementById('activityTitle').textContent       = data.title;
  document.getElementById('activityInstruction').textContent = data.instruction;
  document.getElementById('levelBadge').textContent = 'Sorting';

  hideFeedback();
  renderSorting();
}

function resetSorting() {
  sortBinItems = {};
  (currentActivity.categories || []).forEach(c => { sortBinItems[c.id] = []; });
  sortBankItems    = shuffle((currentActivity.items || []).map((item, i) => ({ ...item, origIdx: i })));
  selectedBankItem = null;
  hideFeedback();
  renderSorting();
}

function renderSorting() {
  renderSortBins();
  renderSortBank();
  updateCheckBtn();
}

function renderSortBins() {
  const container = document.getElementById('sortBins');
  container.innerHTML = '';

  (currentActivity.categories || []).forEach(cat => {
    const bin = document.createElement('div');
    bin.className = 'sort-bin';
    bin.dataset.catId = cat.id;

    const label = document.createElement('div');
    label.className = 'sort-bin-label';
    if (cat.image) {
      const img = document.createElement('img');
      img.src = cat.image;
      img.alt = cat.text || '';
      label.appendChild(img);
    }
    if (cat.text) {
      const span = document.createElement('span');
      span.textContent = cat.text;
      label.appendChild(span);
    }
    bin.appendChild(label);

    const itemsWrap = document.createElement('div');
    itemsWrap.className = 'sort-bin-items';
    (sortBinItems[cat.id] || []).forEach((item, i) => itemsWrap.appendChild(buildSortChip(item, cat.id, i)));
    bin.appendChild(itemsWrap);

    bin.addEventListener('click', () => {
      if (selectedBankItem !== null) placeInBin(selectedBankItem, cat.id);
    });
    bin.addEventListener('dragover', e => { e.preventDefault(); bin.classList.add('drag-over'); });
    bin.addEventListener('dragleave', () => bin.classList.remove('drag-over'));
    bin.addEventListener('drop', e => {
      e.preventDefault();
      bin.classList.remove('drag-over');
      if (sortDragSrc && sortDragSrc.from === 'bank') placeInBin(sortDragSrc.index, cat.id);
      else if (sortDragSrc && sortDragSrc.from === 'bin') moveWithinBins(sortDragSrc, cat.id);
      sortDragSrc = null;
    });

    container.appendChild(bin);
  });
}

function buildSortChip(item, catId, idxInBin) {
  const chip = document.createElement('div');
  chip.className = 'sort-chip';
  if (item.image) {
    const img = document.createElement('img');
    img.src = item.image;
    img.alt = item.text || '';
    chip.appendChild(img);
  }
  if (item.text) {
    const span = document.createElement('span');
    span.textContent = item.text;
    chip.appendChild(span);
  }
  chip.setAttribute('draggable', 'true');
  chip.addEventListener('click', e => { e.stopPropagation(); returnBinItemToBank(catId, idxInBin); });
  chip.addEventListener('dragstart', e => {
    sortDragSrc = { from: 'bin', catId, index: idxInBin };
    e.dataTransfer.effectAllowed = 'move';
  });
  return chip;
}

function placeInBin(bankIdx, catId) {
  const item = sortBankItems.splice(bankIdx, 1)[0];
  if (!item) return;
  if (!sortBinItems[catId]) sortBinItems[catId] = [];
  sortBinItems[catId].push(item);
  selectedBankItem = null;
  renderSorting();
}

function returnBinItemToBank(catId, idx) {
  const item = sortBinItems[catId].splice(idx, 1)[0];
  if (item) sortBankItems.push(item);
  renderSorting();
}

function moveWithinBins(src, targetCatId) {
  if (src.catId === targetCatId) return;
  const item = sortBinItems[src.catId].splice(src.index, 1)[0];
  if (!item) return;
  if (!sortBinItems[targetCatId]) sortBinItems[targetCatId] = [];
  sortBinItems[targetCatId].push(item);
  renderSorting();
}

function renderSortBank() {
  const container = document.getElementById('sortBank');
  container.innerHTML = '';

  if (sortBankItems.length === 0) {
    const hint = document.createElement('div');
    hint.className   = 'bank-empty-hint';
    hint.textContent = 'All placed!';
    container.appendChild(hint);
  }

  sortBankItems.forEach((item, i) => {
    const bubble = document.createElement('div');
    bubble.className = 'bank-bubble' + (selectedBankItem === i ? ' selected' : '');

    if (item.image) {
      const img = document.createElement('img');
      img.className = 'bubble-img';
      img.src = item.image;
      img.alt = item.text || '';
      bubble.appendChild(img);
    }
    if (item.text) {
      const text = document.createElement('span');
      text.textContent = item.text;
      bubble.appendChild(text);
    }

    const speakBtn = document.createElement('button');
    speakBtn.className   = 'bubble-speak';
    speakBtn.textContent = '🔊';
    speakBtn.title = 'Listen';
    speakBtn.onclick = e => { e.stopPropagation(); speakText(item.text || ''); };
    bubble.appendChild(speakBtn);

    bubble.addEventListener('click', e => {
      if (e.target.closest('.bubble-speak')) return;
      selectedBankItem = (selectedBankItem === i) ? null : i;
      renderSortBank();
    });

    bubble.setAttribute('draggable', 'true');
    bubble.addEventListener('dragstart', e => {
      sortDragSrc = { from: 'bank', index: i };
      e.dataTransfer.effectAllowed = 'move';
      bubble.classList.add('dragging');
    });
    bubble.addEventListener('dragend', () => bubble.classList.remove('dragging'));

    container.appendChild(bubble);
  });

  container.addEventListener('dragover', e => {
    e.preventDefault();
    container.classList.add('drag-over-zone');
  });
  container.addEventListener('dragleave', () => container.classList.remove('drag-over-zone'));
  container.addEventListener('drop', e => {
    e.preventDefault();
    container.classList.remove('drag-over-zone');
    if (sortDragSrc && sortDragSrc.from === 'bin') returnBinItemToBank(sortDragSrc.catId, sortDragSrc.index);
    sortDragSrc = null;
  });
}

function checkSortingCorrect() {
  if (sortBankItems.length > 0) return false;
  return Object.keys(sortBinItems).every(catId =>
    sortBinItems[catId].every(item => currentActivity.items[item.origIdx].categoryId === catId)
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Multiple Choice — tap to select option(s)
// ═══════════════════════════════════════════════════════════════════════════
function startMultipleChoice(data) {
  currentActivity = data;
  mcSelected       = [];

  showScreen('multiple-choice');
  document.getElementById('activityTitle').textContent       = data.title;
  document.getElementById('activityInstruction').textContent = data.instruction;
  document.getElementById('levelBadge').textContent = data.multiSelect ? 'Choose all that apply' : 'Choose one';

  hideFeedback();
  renderMc();
}

function resetMultipleChoice() {
  mcSelected = [];
  hideFeedback();
  renderMc();
}

function renderMc() {
  const qBox = document.getElementById('mcQuestionBox');
  qBox.innerHTML = '';
  const question = currentActivity.question || {};
  if (question.text) {
    const p = document.createElement('div');
    p.className   = 'mc-question-text';
    p.textContent = question.text;
    qBox.appendChild(p);
  }
  if (question.image) {
    const img = document.createElement('img');
    img.src = question.image;
    img.alt = question.text || '';
    qBox.appendChild(img);
  }

  const optBox = document.getElementById('mcOptionsBox');
  optBox.innerHTML = '';
  (currentActivity.options || []).forEach((opt, i) => {
    const row = document.createElement('div');
    row.className = 'mc-option' + (mcSelected.includes(i) ? ' selected' : '');

    const check = document.createElement('span');
    check.className   = 'mc-check';
    check.textContent = mcSelected.includes(i) ? '✓' : '';
    row.appendChild(check);

    if (opt.image) {
      const img = document.createElement('img');
      img.src = opt.image;
      img.alt = opt.text || '';
      row.appendChild(img);
    }
    if (opt.text) {
      const span = document.createElement('span');
      span.textContent = opt.text;
      row.appendChild(span);
    }

    row.addEventListener('click', () => toggleMcOption(i));
    optBox.appendChild(row);
  });

  updateCheckBtn();
}

function toggleMcOption(i) {
  const isMulti = !!(currentActivity && currentActivity.multiSelect);
  if (isMulti) {
    const idx = mcSelected.indexOf(i);
    if (idx === -1) mcSelected.push(i); else mcSelected.splice(idx, 1);
  } else {
    mcSelected = [i];
  }
  renderMc();
}

function checkMcCorrect() {
  const correctIdxs = currentActivity.options
    .map((o, i) => (o.isCorrect ? i : null))
    .filter(i => i !== null);
  if (correctIdxs.length !== mcSelected.length) return false;
  const selSet = new Set(mcSelected);
  return correctIdxs.every(i => selSet.has(i));
}

// ═══════════════════════════════════════════════════════════════════════════
// Shared: check button, answer checking, feedback
// ═══════════════════════════════════════════════════════════════════════════
function updateCheckBtn() {
  const btn = document.getElementById('checkBtn');
  if (!currentActivity) { btn.disabled = true; return; }
  const type = currentActivity.activityType || 'ordering';
  if (type === 'sorting') {
    btn.disabled = sortBankItems.length > 0;
  } else if (type === 'multiple-choice') {
    btn.disabled = mcSelected.length === 0;
  } else {
    btn.disabled = !slots.every(s => s !== null);
  }
}

function checkAnswer() {
  if (!currentActivity) return;
  const type = currentActivity.activityType || 'ordering';
  let isCorrect;
  if (type === 'sorting') {
    isCorrect = checkSortingCorrect();
  } else if (type === 'multiple-choice') {
    isCorrect = checkMcCorrect();
  } else if (currentActivity.languageLevel === 'word' && currentActivity.targetWord) {
    const assembled = slots.map(s => s ? s.text : '').join('');
    isCorrect = assembled === currentActivity.targetWord;
  } else {
    isCorrect = slots.every((item, i) => item && item.origIdx === i);
  }

  try {
    firebase.database()
      .ref(`/robots/${currentRobotId}/flexi/result`)
      .set({ isCorrect, timestamp: Date.now() });
    recordLessonAttempt(isCorrect);
  } catch (e) { console.warn('Result write failed:', e); }

  if (isCorrect) {
    showCorrect();
  } else {
    showStuck();
  }
}

function showCorrect() {
  feedbackIsCorrect = true;
  document.querySelectorAll('.answer-slot').forEach(el => {
    el.classList.remove('state-incorrect');
    el.classList.add('state-correct');
  });
  // In a lesson the student moves on themselves; a single pushed task waits
  // for the teacher.
  const isLast = lesson && lesson.current === lesson.steps.length - 1;
  showFeedback('overlay-correct', '🎉', 'Amazing! You got it right!',
    currentActivity.successPhrase || '',
    lesson ? (isLast ? 'Finish ✓' : 'Next ➜') : null,
    lesson ? 'btn-continue' : null);
  speakText(currentActivity.successPhrase || 'Wonderful! You did it!');
}

function showStuck() {
  feedbackIsCorrect = false;
  document.querySelectorAll('.answer-slot').forEach(el => {
    el.classList.remove('state-correct');
    el.classList.add('state-incorrect');
    setTimeout(() => el.classList.remove('state-incorrect'), 400);
  });
  showFeedback('overlay-stuck', '🤔', "Hmm, I'm stuck…",
    "Let's try that again!", '💪 Try Again', 'btn-tryagain');
  speakText(STUCK_PHRASE);
}

function showFeedback(overlayClass, emoji, title, sub, btnLabel, btnClass) {
  const overlay = document.getElementById('feedbackOverlay');
  overlay.className = `feedback-overlay show ${overlayClass}`;
  document.getElementById('fbEmoji').textContent = emoji;
  document.getElementById('fbTitle').textContent = title;
  document.getElementById('fbSub').textContent   = sub;
  const btn  = document.getElementById('fbBtn');
  const wait = document.getElementById('fbWait');
  if (btnLabel) {
    btn.textContent   = btnLabel;
    btn.className     = `fb-btn ${btnClass}`;
    btn.style.display = '';
    if (wait) wait.style.display = 'none';
  } else {
    btn.style.display = 'none';
    if (wait) wait.style.display = 'block';
  }
}

function hideFeedback() {
  document.getElementById('feedbackOverlay').className = 'feedback-overlay';
}

function onFeedbackBtn() {
  hideFeedback();
  if (feedbackIsCorrect && lesson) {
    advanceLesson();
    return;
  }
  if (!feedbackIsCorrect) {
    const type = currentActivity.activityType || 'ordering';
    if      (type === 'sorting')          resetSorting();
    else if (type === 'multiple-choice')  resetMultipleChoice();
    else                                   resetOrdering();
    try {
      firebase.database()
        .ref(`/robots/${currentRobotId}/flexi/studentStatus`)
        .set({ status: 'answering', timestamp: Date.now() });
    } catch (e) {}
  }
}

// ── Vocabulary Audio ───────────────────────────────────────────────────────
// Speaks one sentence at a time. Tablet browsers (iPad Safari, Android Chrome)
// don't always stop the previous sentence when cancel() is followed at once
// by speak(), which played two voices over each other on a new step — so
// wait a moment after stopping, let only the latest request through, and
// don't repeat the exact same sentence within 2 seconds.
let speakTimer = null;
let lastSpoken = { text: '', at: 0 };

function speakText(text) {
  if (!('speechSynthesis' in window) || !text) return;
  if (text === lastSpoken.text && Date.now() - lastSpoken.at < 2000) return;
  lastSpoken = { text, at: Date.now() };

  clearTimeout(speakTimer);
  const say = () => {
    const utt  = new SpeechSynthesisUtterance(text);
    utt.lang   = 'en-US';
    utt.rate   = 0.88;
    utt.pitch  = 1.0;
    window.speechSynthesis.speak(utt);
  };
  if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
    window.speechSynthesis.cancel();
    speakTimer = setTimeout(say, 250);
  } else {
    say();  // right away: iPad only allows speech started directly by a tap
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (typeof Config !== 'undefined' && typeof Database !== 'undefined') {
    try {
      new Database(new Config().config, initStudent);
    } catch (e) {
      console.error('Firebase required for student screen:', e);
    }
  }
});

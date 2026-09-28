/* ═══════════════════════════════════════════════════════════════════════════
 * Robot Tools — belly-mode switch + quick task push.
 * Relies on globals set up by scripts/index.js on the same page:
 *   currentRobot, currentUid, isAdmin, onAuthReady()/onRobotSelected() hooks.
 * ═══════════════════════════════════════════════════════════════════════════ */

const TOOL_TASK_ICONS = { ordering: '🧩', sorting: '🗂️', 'multiple-choice': '✅' };

let libraryClasses = {};
let bellyModeRef   = null;
let currentBellyMode = null;

// Called by index.js once Google auth + admin-check have resolved.
function onAuthReady() {
  loadClassesForPicker();
  subscribeBellyMode();
}

// Called by index.js's selectRobot() whenever the teacher picks a different robot.
function onRobotSelected() {
  subscribeBellyMode();
}

// ── Belly mode ───────────────────────────────────────────────────────────
function subscribeBellyMode() {
  if (bellyModeRef) bellyModeRef.off();
  bellyModeRef = firebase.database().ref('/robots/' + currentRobot + '/flexi/bellyMode');
  bellyModeRef.on('value', function(snap) {
    currentBellyMode = snap.val() === 'activity' ? 'activity' : 'face';
    updateModeUI();
  });
}

function updateModeUI() {
  var label = document.getElementById('currentModeLabel');
  if (label) label.textContent = currentBellyMode === 'activity' ? 'Activity' : 'Face Editing';
  var faceBtn = document.getElementById('modeFaceBtn');
  var actBtn  = document.getElementById('modeActivityBtn');
  if (faceBtn) faceBtn.classList.toggle('mode-active', currentBellyMode === 'face');
  if (actBtn)  actBtn.classList.toggle('mode-active', currentBellyMode === 'activity');
}

function setBellyMode(mode) {
  firebase.database().ref('/robots/' + currentRobot + '/flexi/bellyMode').set(mode)
    .catch(function(err) { alert('Could not set belly mode: ' + err.message); });
}


// ── Class / task picker ─────────────────────────────────────────────────
function loadClassesForPicker() {
  firebase.database().ref('/users/' + currentUid + '/library').once('value').then(function(snap) {
    var nodes = snap.val() || {};
    libraryClasses = {};
    Object.keys(nodes).forEach(function(id) {
      if (nodes[id] && nodes[id].type === 'class') libraryClasses[id] = nodes[id];
    });
    renderClassPicker();
  }).catch(function(err) {
    var sel = document.getElementById('pickClass');
    if (sel) sel.innerHTML = '<option value="">Could not load classes</option>';
    console.warn('Load classes failed:', err);
  });
}

function renderClassPicker() {
  var sel = document.getElementById('pickClass');
  if (!sel) return;
  var ids = Object.keys(libraryClasses).sort(function(a, b) {
    return (libraryClasses[a].name || '').localeCompare(libraryClasses[b].name || '');
  });
  if (ids.length === 0) {
    sel.innerHTML = '<option value="">No classes yet — create one in My Materials</option>';
    document.getElementById('pickTask').innerHTML = '<option value="">—</option>';
    return;
  }
  sel.innerHTML = ids.map(function(id) {
    return '<option value="' + id + '">' + escToolsHtml(libraryClasses[id].name || 'Untitled') + '</option>';
  }).join('');
  onPickClassChange();
}

function onPickClassChange() {
  var classId = document.getElementById('pickClass').value;
  var taskSel = document.getElementById('pickTask');
  var cls = libraryClasses[classId];
  var tasks = (cls && cls.tasks) || [];
  if (tasks.length === 0) {
    taskSel.innerHTML = '<option value="">No tasks in this class</option>';
    return;
  }
  taskSel.innerHTML = tasks.map(function(t, i) {
    var icon = TOOL_TASK_ICONS[t.taskType] || '📄';
    return '<option value="' + i + '">' + icon + ' ' + escToolsHtml(t.title || 'Untitled') + '</option>';
  }).join('');
}

// Mirrors readTask()'s output shape in class.js, but reads from already-saved
// task data instead of a live editor form.
function buildPushPayload(task) {
  var shared = {
    title:         task.title || 'Untitled Task',
    instruction:   task.instruction || '',
    successPhrase: task.successPhrase || 'Great job!',
    timestamp:     Date.now(),
  };
  if (task.taskType === 'sorting') {
    shared.activityType = 'sorting';
    shared.categories    = task.categories || [];
    shared.items          = task.items || [];
  } else if (task.taskType === 'multiple-choice') {
    shared.activityType = 'multiple-choice';
    shared.multiSelect    = !!task.multiSelect;
    shared.question        = task.question || { text: '', image: null };
    shared.options          = task.options || [];
  } else {
    shared.activityType = 'ordering';
    shared.languageLevel = task.level || 'sentence';
    shared.items           = task.items || [];
    shared.targetWord      = task.targetWord || null;
  }
  return shared;
}

function pushPickedTask() {
  var classId  = document.getElementById('pickClass').value;
  var taskIdx  = document.getElementById('pickTask').value;
  var cls      = libraryClasses[classId];
  var task     = cls && cls.tasks && cls.tasks[taskIdx];
  var statusEl = document.getElementById('pushPickStatus');

  if (!task) {
    if (statusEl) statusEl.textContent = 'Pick a class and a task first.';
    return;
  }

  var payload = buildPushPayload(task);
  firebase.database().ref('/robots/' + currentRobot + '/flexi/pushed')
    .set(Object.assign({}, payload, { _pushedAt: Date.now() }))
    .then(function() {
      return firebase.database().ref('/robots/' + currentRobot + '/flexi/bellyMode').set('activity');
    })
    .then(function() {
      if (statusEl) {
        statusEl.textContent = '✓ Pushed to belly!';
        setTimeout(function() { statusEl.textContent = ''; }, 3000);
      }
    })
    .catch(function(err) {
      if (statusEl) statusEl.textContent = 'Could not push: ' + err.message;
    });
}

function escToolsHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ═══════════════════════════════════════════════════════════════════════════
 * My Materials — Google-Drive-style folder/class browser for teachers.
 * Every node lives at /users/{uid}/library/{nodeId}:
 *   folder: { type: 'folder', name, parentId, createdAt, updatedAt }
 *   class:  { type: 'class', name, parentId, createdAt, updatedAt,
 *             tasks: Task[], activeIndex }
 * A class is the content of one lesson: it holds many heterogeneous tasks
 * (ordering / sorting / multiple-choice — see class.js), all editable and
 * pushable to a robot from the single class.html page.
 *
 * Legacy nodes of { type: 'material', activityType: 'sentence-ordering',
 * queue, activeIndex } are auto-migrated into the class shape the first
 * time a teacher opens them — see migrateLegacyMaterialToClass() below.
 * ═══════════════════════════════════════════════════════════════════════════ */

var config = new Config();
var db = new Database(config.config, null);

// Read the robotId the homepage assigned this teacher (via idEmails), same
// as scripts/index.js and robotdisplay/scripts/index.js do — without this,
// every non-admin teacher fell through to the robot-0 default regardless of
// what they were actually assigned.
var urlParams = new URLSearchParams(window.location.search);
var isAdmin = urlParams.get('role') === 'admin';
var lockedRobotId = urlParams.get('robotId') !== null ? parseInt(urlParams.get('robotId')) : (isAdmin ? null : 0);

var currentUid = null;
var currentRobot = lockedRobotId !== null ? lockedRobotId : 0;
var robotNames = [];

var nodes = {};
var currentFolderId = null;
var libraryLoaded = false;

// Require Google login from the homepage, same as the other teacher tools.
Database.handleAuthStateChange = function(user) {
  if (user && !user.isAnonymous && Database.readyCallback) {
    Database.readyCallback(user);
  }
};

function waitForAuth() {
  if (typeof firebase !== 'undefined' && firebase.auth) {
    firebase.auth().onAuthStateChanged(function(user) {
      if (!user || user.isAnonymous) {
        window.location.href = '../index.html';
        return;
      }
      currentUid = user.uid;
      initLibrary();
    });
  } else {
    setTimeout(waitForAuth, 200);
  }
}
waitForAuth();

function initLibrary() {
  firebase.database().ref('/adminUids/' + currentUid).once('value').then(function(snap) {
    isAdmin = snap.val() === true;
    loadRobots();
    updateNavLinks();
  }).catch(function() {
    isAdmin = false;
    loadRobots();
    updateNavLinks();
  });

  firebase.database().ref('/users/' + currentUid + '/library').on('value', function(snapshot) {
    nodes = snapshot.val() || {};
    libraryLoaded = true;
    render();
  });
}

// Carry the robotId/admin context forward into the Tools link — without
// this it's a bare href="tools.html" and a non-admin teacher's robotId gets
// silently dropped the moment they click through, falling back to robot 0.
function updateNavLinks() {
  var link = document.getElementById('toolsLink');
  if (!link) return;
  link.href = isAdmin ? 'tools.html?role=admin' : 'tools.html?robotId=' + currentRobot;
}

// ── Robot selector (which robot a material gets opened against) ────────────
function loadRobots() {
  if (!isAdmin) {
    firebase.database().ref('/robots/' + currentRobot).once('value').then(function(snapshot) {
      var robot = snapshot.val();
      var robotName = (robot && robot.name) ? robot.name : ('Robot ' + currentRobot);
      var bar = document.querySelector('.selector-bar');
      if (bar) {
        bar.innerHTML = '<span style="font-size:1rem;font-weight:600;color:#374151;">Your Robot:</span>'
          + '<span style="font-size:1rem;font-weight:700;color:#1a1a2e;">' + escHtml(robotName) + '</span>';
      }
    }).catch(function(err) {
      var el = document.getElementById('selectedRobot');
      if (el) el.innerHTML = 'Error: ' + err.message;
    });
    return;
  }

  firebase.database().ref('/robots/').once('value').then(function(snapshot) {
    var robots = snapshot.val();
    if (!robots) {
      document.getElementById('selectedRobot').innerHTML = 'No robots found';
      return;
    }
    var robotArray = Array.isArray(robots) ? robots : Object.values(robots);
    robotNames = robotArray.map(function(r) { return r ? (r.name || '') : ''; });

    var robotListHTML = '';
    robotArray.forEach(function(robot, i) {
      if (!robot) return;
      robotListHTML += "<a class='dropdown-item' href='#' onclick='selectRobot(" + i + ")'>" + escHtml(robot.name) + "</a>";
    });
    document.getElementById('robots').innerHTML = robotListHTML;
    document.getElementById('selectedRobot').innerHTML = robotNames[currentRobot] || ('Robot ' + currentRobot);
  }).catch(function(err) {
    document.getElementById('selectedRobot').innerHTML = 'Error: ' + err.message;
  });
}

function selectRobot(robotId) {
  if (!isAdmin) return;
  currentRobot = robotId;
  document.getElementById('selectedRobot').innerHTML = robotNames[currentRobot];
}

function signInWithGoogle() { Database.signInWithGoogle(); }
function signOutFromGoogle() { Database.signOut(); }

// ── Navigation ───────────────────────────────────────────────────────────
function navigateTo(folderId) {
  currentFolderId = folderId || null;
  render();
}

function breadcrumbPath() {
  var path = [];
  var id = currentFolderId;
  var guard = 0;
  while (id && guard++ < 100) {
    var node = nodes[id];
    if (!node) break;
    path.unshift({ id: id, name: node.name });
    id = node.parentId;
  }
  return path;
}

// ── Create ───────────────────────────────────────────────────────────────
function newId() {
  return firebase.database().ref('/users/' + currentUid + '/library').push().key;
}

function createFolder() {
  closeNewMenu();
  var name = prompt('Folder name:', 'Untitled folder');
  if (!name) return;
  name = name.trim();
  if (!name) return;

  var id = newId();
  var now = Date.now();
  firebase.database().ref('/users/' + currentUid + '/library/' + id).set({
    type: 'folder',
    name: name,
    parentId: currentFolderId,
    createdAt: now,
    updatedAt: now,
  }).then(function() {
    navigateTo(id);
  }).catch(function(err) { alert('Could not create folder: ' + err.message); });
}

function createClass() {
  closeNewMenu();
  var name = prompt('Class name:', 'Untitled Class');
  if (!name) return;
  name = name.trim();
  if (!name) return;

  var id = newId();
  var now = Date.now();
  var node = {
    type: 'class',
    name: name,
    parentId: currentFolderId,
    tasks: [],
    activeIndex: 0,
    createdAt: now,
    updatedAt: now,
  };

  firebase.database().ref('/users/' + currentUid + '/library/' + id).set(node)
    .then(function() { openMaterial(id); })
    .catch(function(err) { alert('Could not create class: ' + err.message); });
}

// ── Legacy migration ────────────────────────────────────────────────────
// Normalizes an old sentence-ordering "activity" (any of its historical
// shapes) into the flat { title, successPhrase, level, instruction, items,
// targetWord } form — ported from migrateActivity() in the old
// sentence-ordering.js so legacy Firebase data still opens correctly.
function migrateLegacyActivity(act) {
  var LEVELS = { word: 1, phrase: 1, sentence: 1, paragraph: 1 };
  if (act.level && !act.levels) {
    if (!(act.level in LEVELS)) act.level = 'sentence';
    if (act.items === undefined) act.items = [];
    if (act.targetWord === undefined) act.targetWord = null;
    return act;
  }
  if (act.levels) {
    var level = (act.currentLevel && act.levels[act.currentLevel]) ? act.currentLevel : 'sentence';
    var lvl = act.levels[level] || { instruction: '', items: [] };
    return {
      title: act.title || 'Untitled',
      successPhrase: act.successPhrase || '',
      level: level,
      instruction: lvl.instruction || '',
      items: lvl.items || [],
      targetWord: lvl.targetWord || null,
    };
  }
  return {
    title: act.title || 'Untitled',
    successPhrase: act.successPhrase || '',
    level: 'sentence',
    instruction: act.instruction || '',
    items: act.items || [],
    targetWord: null,
  };
}

function genTaskId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Converts a legacy { type:'material', activityType:'sentence-ordering',
// queue, activeIndex } node into the new { type:'class', tasks, activeIndex }
// shape. Each queue entry becomes one 'ordering' task.
function migrateLegacyMaterialToClass(node) {
  var queue = node.queue || [];
  var tasks = queue.map(function(act) {
    var norm = migrateLegacyActivity(act);
    norm.id = genTaskId();
    norm.taskType = 'ordering';
    if (norm.instruction === undefined) norm.instruction = '';
    if (norm.successPhrase === undefined) norm.successPhrase = '';
    return norm;
  });
  return {
    type: 'class',
    name: node.name,
    parentId: node.parentId,
    createdAt: node.createdAt,
    updatedAt: Date.now(),
    tasks: tasks,
    activeIndex: node.activeIndex || 0,
  };
}

// ── Open ─────────────────────────────────────────────────────────────────
function openMaterial(id) {
  var node = nodes[id];
  if (!node) return;
  if (node.type === 'class') {
    window.location.href = 'class.html?class=' + id + '&robot=' + currentRobot;
    return;
  }
  if (node.type === 'material') {
    var migrated = migrateLegacyMaterialToClass(node);
    firebase.database().ref('/users/' + currentUid + '/library/' + id).set(migrated)
      .then(function() { window.location.href = 'class.html?class=' + id + '&robot=' + currentRobot; })
      .catch(function(err) { alert('Could not open class: ' + err.message); });
  }
}

// ── Rename / Delete ─────────────────────────────────────────────────────
function renameNode(id) {
  var node = nodes[id];
  if (!node) return;
  var name = prompt('Rename to:', node.name);
  if (!name) return;
  name = name.trim();
  if (!name || name === node.name) return;
  firebase.database().ref('/users/' + currentUid + '/library/' + id)
    .update({ name: name, updatedAt: Date.now() })
    .catch(function(err) { alert('Could not rename: ' + err.message); });
}

function collectDescendantIds(id) {
  var result = [];
  Object.keys(nodes).forEach(function(key) {
    if (nodes[key].parentId === id) {
      result.push(key);
      result = result.concat(collectDescendantIds(key));
    }
  });
  return result;
}

function deleteNode(id) {
  var node = nodes[id];
  if (!node) return;
  var descendants = node.type === 'folder' ? collectDescendantIds(id) : [];
  var count = descendants.length;
  var msg = (node.type === 'folder' && count > 0)
    ? 'Delete "' + node.name + '" and everything inside it (' + count + ' item' + (count === 1 ? '' : 's') + ')?'
    : 'Delete "' + node.name + '"?';
  if (!confirm(msg)) return;

  var updates = {};
  updates[id] = null;
  descendants.forEach(function(dId) { updates[dId] = null; });
  firebase.database().ref('/users/' + currentUid + '/library').update(updates)
    .catch(function(err) { alert('Could not delete: ' + err.message); });
}

// ── Render ───────────────────────────────────────────────────────────────
function render() {
  renderBreadcrumb();
  renderGrid();
}

function renderBreadcrumb() {
  var el = document.getElementById('breadcrumb');
  var path = breadcrumbPath();
  var html = '<span class="crumb" onclick="navigateTo(null)">📚 My Materials</span>';
  path.forEach(function(p) {
    html += '<span class="crumb-sep">/</span><span class="crumb" onclick="navigateTo(\'' + p.id + '\')">' + escHtml(p.name) + '</span>';
  });
  el.innerHTML = html;
  var crumbs = el.querySelectorAll('.crumb');
  if (crumbs.length) crumbs[crumbs.length - 1].classList.add('current');
}

function nodeIcon(node) {
  if (node.type === 'class') return '🏫';
  if (node.type === 'material') return '🧩'; // legacy, migrates on open
  return '📄';
}

function renderGrid() {
  var grid  = document.getElementById('libraryGrid');
  var empty = document.getElementById('emptyState');

  if (!libraryLoaded) {
    grid.innerHTML = '';
    empty.style.display = 'none';
    return;
  }

  var items = Object.keys(nodes)
    .map(function(id) { var n = Object.assign({}, nodes[id]); n.id = id; return n; })
    .filter(function(n) { return (n.parentId || null) === (currentFolderId || null); })
    .sort(function(a, b) {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return (a.name || '').localeCompare(b.name || '');
    });

  if (items.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'flex';
    return;
  }
  empty.style.display = 'none';

  grid.innerHTML = items.map(function(n) {
    var icon = n.type === 'folder' ? '📁' : nodeIcon(n);
    var openAction = n.type === 'folder' ? "navigateTo('" + n.id + "')" : "openMaterial('" + n.id + "')";
    return '' +
      '<div class="lib-tile">' +
        '<div class="lib-tile-menu-wrap">' +
          '<button class="lib-tile-menu-btn" onclick="event.stopPropagation();toggleTileMenu(this)">&#8942;</button>' +
          '<div class="lib-tile-menu-dropdown">' +
            '<button onclick="event.stopPropagation();' + openAction + '">Open</button>' +
            '<button onclick="event.stopPropagation();renameNode(\'' + n.id + '\')">Rename</button>' +
            '<button class="danger" onclick="event.stopPropagation();deleteNode(\'' + n.id + '\')">Delete</button>' +
          '</div>' +
        '</div>' +
        '<div class="lib-tile-body" ondblclick="' + openAction + '" onclick="' + openAction + '">' +
          '<div class="lib-tile-icon">' + icon + '</div>' +
          '<div class="lib-tile-name">' + escHtml(n.name) + '</div>' +
        '</div>' +
      '</div>';
  }).join('');
}

function closeAllTileMenus() {
  document.querySelectorAll('.lib-tile-menu-dropdown.open').forEach(function(m) { m.classList.remove('open'); });
}

function toggleTileMenu(btn) {
  var dropdown = btn.nextElementSibling;
  var isOpen = dropdown.classList.contains('open');
  closeAllTileMenus();
  closeNewMenu();
  if (!isOpen) dropdown.classList.add('open');
}
document.addEventListener('click', closeAllTileMenus);

// ── "+ New" menu ─────────────────────────────────────────────────────────
function toggleNewMenu() {
  var wasOpen = document.getElementById('newMenuDropdown').classList.contains('open');
  closeAllTileMenus();
  closeNewMenu();
  if (!wasOpen) document.getElementById('newMenuDropdown').classList.add('open');
}
function closeNewMenu() {
  document.getElementById('newMenuDropdown').classList.remove('open');
}
document.addEventListener('click', function(e) {
  var wrap = document.getElementById('newMenuWrap');
  if (wrap && !wrap.contains(e.target)) closeNewMenu();
});

function escHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

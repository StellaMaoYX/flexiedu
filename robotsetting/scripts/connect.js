/* ═══════════════════════════════════════════════════════════════════════════
 * Connect Robot Screens (teacher side of device pairing, see
 * robotdisplay/scripts/pair.js). The teacher enters (or arrives via QR with)
 * the code a robot screen shows; confirming adds that device to
 * /robots/{id}/devices/{uid} until midnight and tells the device which robot
 * it now belongs to. The first connection of the day also resets the robot to
 * its defaults (welcome screen, default face, no old lesson or results), so
 * every class starts fresh. The access check in database.js has already
 * pinned a teacher's ?robotId= to their own robot; admins pick a robot here.
 * ═══════════════════════════════════════════════════════════════════════════ */

var CODE_LIFETIME_MS = 10 * 60 * 1000;
var ROLE_NAMES = { face: 'Face', belly: 'Belly' };

var urlParams = new URLSearchParams(window.location.search);
var currentRobot = urlParams.get('robotId');
var isAdmin = false;
var devicesRef = null;

function setMessage(text, kind) {
  var el = document.getElementById('connectMsg');
  el.textContent = text;
  el.className = 'msg ' + (kind || '');
}

// Midnight tonight, in the teacher's own time zone.
function endOfToday() {
  var d = new Date();
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

function startOfToday() {
  var d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Clears what the robot showed last time, once per day: the first screen
// connected today resets it; later ones (e.g. a tablet re-paired mid-lesson)
// leave today's lesson alone.
function resetRobotIfNewDay(robotId) {
  var flexiRef = firebase.database().ref('robots/' + robotId + '/flexi');
  return flexiRef.child('resetAt').once('value').then(function(snap) {
    if (snap.val() && snap.val() >= startOfToday()) return;
    return flexiRef.set({ bellyMode: 'activity', resetAt: Date.now() });
  });
}

function initConnect(uid) {
  var codeFromQr = urlParams.get('code');
  if (codeFromQr) document.getElementById('codeInput').value = codeFromQr;

  firebase.database().ref('/adminUids/' + uid).once('value')
    .then(function(snap) { isAdmin = snap.val() === true; })
    .catch(function() { isAdmin = false; })
    .then(function() {
      document.getElementById('homeLink').href = isAdmin
        ? 'index.html?role=admin' : 'index.html?robotId=' + currentRobot;
      if (isAdmin) loadRobotPicker();
      else selectRobot(currentRobot);
    });
}

function loadRobotPicker() {
  firebase.database().ref('/robots/').once('value').then(function(snapshot) {
    var robots = snapshot.val() || {};
    var select = document.getElementById('robotSelect');
    select.innerHTML = '';
    Object.keys(robots).forEach(function(id) {
      if (!robots[id] || isNaN(Number(id))) return;
      var option = document.createElement('option');
      option.value = id;
      option.textContent = robots[id].name || ('Robot ' + id);
      select.appendChild(option);
    });
    document.getElementById('robotPicker').style.display = 'block';
    if (currentRobot != null && robots[currentRobot]) select.value = currentRobot;
    selectRobot(select.value);
  });
}

function selectRobot(robotId) {
  currentRobot = robotId;
  firebase.database().ref('/robots/' + robotId + '/name').once('value').then(function(snap) {
    document.getElementById('robotLabel').textContent =
      'Connecting screens to: ' + (snap.val() || ('Robot ' + robotId));
  });
  watchDevices();
}

function connectDevice() {
  var code = document.getElementById('codeInput').value.replace(/\D/g, '');
  if (code.length !== 6) return setMessage('Please enter the 6-digit code shown on the robot screen.', 'err');
  if (currentRobot == null) return setMessage('Please choose a robot first.', 'err');

  var btn = document.getElementById('connectBtn');
  btn.disabled = true;
  setMessage('Connecting…');

  var db = firebase.database();
  db.ref('pairing/' + code).once('value').then(function(snap) {
    var request = snap.val();
    if (!request || !request.uid || !ROLE_NAMES[request.role]) {
      throw new Error('That code was not found. Check the robot screen for the current code.');
    }
    if (request.robot != null) throw new Error('That code has already been used.');
    if (Date.now() - request.createdAt > CODE_LIFETIME_MS) {
      throw new Error('That code has expired. The robot screen will show a new one.');
    }

    // Both writes land together: the device gets access, then learns its robot.
    var updates = {};
    updates['robots/' + currentRobot + '/devices/' + request.uid] = {
      role: request.role,
      pairedAt: firebase.database.ServerValue.TIMESTAMP,
      expiresAt: endOfToday()
    };
    updates['pairing/' + code + '/robot'] = String(currentRobot);
    return resetRobotIfNewDay(currentRobot)
      .then(function() { return db.ref().update(updates); })
      .then(function() { return request; });
  }).then(function(request) {
    setMessage(ROLE_NAMES[request.role] + ' screen connected. It will switch over in a moment.', 'ok');
    document.getElementById('codeInput').value = '';
  }).catch(function(error) {
    var text = error && error.code === 'PERMISSION_DENIED'
      ? 'You do not have permission to connect screens to this robot.'
      : (error.message || 'Something went wrong. Please try again.');
    setMessage(text, 'err');
  }).then(function() {
    btn.disabled = false;
  });
}

function watchDevices() {
  if (devicesRef) devicesRef.off();
  devicesRef = firebase.database().ref('robots/' + currentRobot + '/devices');
  devicesRef.on('value', function(snapshot) {
    var devices = snapshot.val() || {};
    Object.keys(devices).forEach(function(uid) {
      if (!devices[uid] || devices[uid].expiresAt <= Date.now()) devicesRef.child(uid).remove();
    });
    var list = document.getElementById('deviceList');
    var uids = Object.keys(devices).filter(function(uid) {
      return devices[uid] && devices[uid].expiresAt > Date.now();
    });
    if (uids.length === 0) {
      list.innerHTML = '<span class="empty">No screens connected today.</span>';
      return;
    }
    list.innerHTML = '';
    uids.sort(function(a, b) { return (devices[a].role > devices[b].role) ? 1 : -1; });
    uids.forEach(function(uid) {
      var d = devices[uid];
      var row = document.createElement('div');
      row.className = 'device';
      var info = document.createElement('div');
      info.innerHTML = '<b></b><small></small>';
      info.querySelector('b').textContent = (ROLE_NAMES[d.role] || d.role) + ' screen';
      info.querySelector('small').textContent = d.pairedAt
        ? 'Connected at ' + new Date(d.pairedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        : '';
      var btn = document.createElement('button');
      btn.className = 'btn-sm';
      btn.textContent = 'Disconnect';
      btn.onclick = function() { disconnectDevice(uid); };
      row.appendChild(info);
      row.appendChild(btn);
      list.appendChild(row);
    });
  });
}

function disconnectDevice(uid) {
  if (!confirm('Disconnect this screen? It will go back to showing a pairing code.')) return;
  firebase.database().ref('robots/' + currentRobot + '/devices/' + uid).remove();
}

document.getElementById('codeInput').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') connectDevice();
});

new Database(new Config().config, initConnect);

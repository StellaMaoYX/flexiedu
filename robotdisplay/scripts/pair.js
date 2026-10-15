/* ═══════════════════════════════════════════════════════════════════════════
 * Robot screen pairing (device side).
 *
 * The robot's face phone and belly tablet open this page instead of signing
 * in with a teacher account. The device signs in anonymously and shows a
 * short-lived code (+ QR). The teacher confirms it on robotsetting/
 * connect.html, which adds this device to /robots/{id}/devices/{uid} until
 * midnight and writes the robot id back to /pairing/{code}/robot. The device
 * then remembers {robot, role} and opens its screen.
 * ═══════════════════════════════════════════════════════════════════════════ */

var PAIRING_KEY = 'flexiDevicePairing';   // { robot, role }
var ROLE_KEY = 'flexiDeviceRole';         // 'face' | 'belly'
var CODE_LIFETIME_MS = 10 * 60 * 1000;
var SCREEN_PAGES = { face: 'sentence-face.html', belly: 'robot-belly.html' };

var deviceUid = null;
var started = false;
var currentCode = null;
var codeRef = null;
var codeTimer = null;

function storageGet(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
}

function show(viewId) {
  ['loadingView', 'teacherView', 'roleView', 'codeView'].forEach(function(id) {
    document.getElementById(id).classList.toggle('hidden', id !== viewId);
  });
}

function openScreen(pairing) {
  window.location.replace(SCREEN_PAGES[pairing.role] + '?robot=' + pairing.robot);
}

// Called by Database once someone is signed in (anonymously, if nobody was).
function onSignedIn(uid) {
  var user = firebase.auth().currentUser;
  if (!user) return;
  if (!user.isAnonymous) {
    document.getElementById('teacherEmail').textContent = Database.userEmail || user.displayName || '';
    show('teacherView');
    return;
  }
  if (started) return;
  started = true;
  deviceUid = uid;

  // Still paired from earlier today? Go straight to the screen.
  var saved = storageGet(PAIRING_KEY);
  if (saved && saved.robot != null && SCREEN_PAGES[saved.role]) {
    firebase.database().ref('robots/' + saved.robot + '/devices/' + deviceUid + '/expiresAt').once('value')
      .then(function(snap) {
        if (snap.val() && snap.val() > Date.now()) openScreen(saved);
        else startForRole();
      })
      .catch(startForRole);  // no read access = not paired (or expired)
  } else {
    startForRole();
  }
}

function startForRole() {
  var role = storageGet(ROLE_KEY);
  if (SCREEN_PAGES[role]) startPairing(role);
  else show('roleView');
}

function chooseRole(role) {
  storageSet(ROLE_KEY, role);
  startPairing(role);
}

function changeRole() {
  stopPairing();
  show('roleView');
}

function signOutForPairing() {
  started = false;
  firebase.auth().signOut();  // Database then signs in anonymously and calls onSignedIn again
  show('loadingView');
}

function newCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// Claim a fresh code; the rules only allow creating a code that doesn't exist,
// so a collision is refused and we just try another.
function startPairing(role, attempt) {
  attempt = attempt || 0;
  stopPairing();
  var code = newCode();
  var ref = firebase.database().ref('pairing/' + code);
  ref.set({ uid: deviceUid, role: role, createdAt: firebase.database.ServerValue.TIMESTAMP })
    .then(function() { showCode(code, ref, role); })
    .catch(function(error) {
      if (attempt < 5) return startPairing(role, attempt + 1);
      Database.handleError(error);
      document.getElementById('pairError').textContent =
        'Could not get a pairing code. Check the internet connection and reload this page.';
      show('roleView');
    });
}

function showCode(code, ref, role) {
  currentCode = code;
  codeRef = ref;
  document.getElementById('codeTitle').textContent =
    'Connect this ' + (role === 'face' ? 'face' : 'belly') + ' screen';
  document.getElementById('pairCode').textContent = code.slice(0, 3) + ' ' + code.slice(3);

  var link = new URL('../robotsetting/connect.html?code=' + code, window.location.href).href;
  var qr = document.getElementById('qr');
  qr.innerHTML = '';
  new QRCode(qr, { text: link, width: 200, height: 200, correctLevel: QRCode.CorrectLevel.M });
  show('codeView');

  // The teacher's confirmation writes the robot id here.
  ref.child('robot').on('value', function(snap) {
    if (snap.val() == null) return;
    var pairing = { robot: snap.val(), role: role };
    storageSet(PAIRING_KEY, pairing);
    stopPairing();
    openScreen(pairing);
  });

  codeTimer = setTimeout(function() { startPairing(role); }, CODE_LIFETIME_MS);
}

function stopPairing() {
  if (codeTimer) clearTimeout(codeTimer);
  codeTimer = null;
  if (codeRef) {
    codeRef.child('robot').off();
    codeRef.remove().catch(function() {});
  }
  codeRef = null;
  currentCode = null;
}

window.addEventListener('pagehide', stopPairing);

new Database(new Config().config, onSignedIn);

/* ═══════════════════════════════════════════════════════════════════════════
 * Keeps a paired robot screen (face phone / belly tablet) on its robot only
 * while the pairing is valid. When /robots/{id}/devices/{uid} expires at
 * midnight or the teacher disconnects it, the device goes back to pair.html
 * to show a new code. Pages opened by a signed-in teacher are left alone.
 * Robot 0 (the public Test Robot) still works without pairing.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function() {
  var robot = new URLSearchParams(window.location.search).get('robot') || '0';
  var expiryTimer = null;
  var watching = false;

  function wasPaired() {
    try { return !!localStorage.getItem('flexiDevicePairing'); } catch (e) { return false; }
  }

  function backToPairing() {
    try { localStorage.removeItem('flexiDevicePairing'); } catch (e) {}
    window.location.replace('pair.html');
  }

  function watch(user) {
    if (!user || !user.isAnonymous) return;      // teacher/admin account: no pairing needed
    if (robot === '0' && !wasPaired()) return;    // public Test Robot
    if (watching) return;
    watching = true;

    firebase.database().ref('robots/' + robot + '/devices/' + user.uid + '/expiresAt').on('value',
      function(snap) {
        var expiresAt = snap.val();
        if (expiryTimer) clearTimeout(expiryTimer);
        if (!expiresAt || expiresAt <= Date.now()) return backToPairing();
        expiryTimer = setTimeout(backToPairing, expiresAt - Date.now());
      },
      backToPairing);  // permission denied = not paired with this robot
  }

  // Firebase is loaded on demand by database.js; wait for it.
  (function waitForFirebase() {
    if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length && firebase.database) {
      firebase.auth().onAuthStateChanged(watch);
    } else {
      setTimeout(waitForFirebase, 200);
    }
  })();
})();

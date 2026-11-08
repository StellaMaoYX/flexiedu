/* ═══════════════════════════════════════════════════════════════════════════
 * Kiosk behaviour for the robot's own screens (Surface Pro tablets, Edge).
 * The real lock is Windows' kiosk mode (Assigned Access running Edge on the
 * pairing page), which keeps students out of other apps and the desktop;
 * this script makes the page itself hard to mess up:
 *   - keeps the screen awake (no auto-lock mid-lesson)
 *   - goes full screen on the first tap and, while full screen, keeps
 *     Esc, Alt+Tab and the Windows key inside the page (hold Esc to leave);
 *     not when a signed-in teacher opens the page to have a look
 *   - no zooming (pinch, Ctrl+wheel, Ctrl +/-), text selection, press-and-hold
 *     or right-click menus, swipe back/forward, print, find or save
 *   - the Back button/gesture stays on the current screen
 * Drag-and-drop answers (long-press on a draggable bubble) and text inputs
 * keep working. Also included in the pages shown inside the belly's frame.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function() {
  var isTopPage = window.top === window;
  // Pages that are also opened on their own by teachers (e.g. the face editor
  // from Robot Tools) only act as kiosk screens inside the belly.
  var frameOnly = document.currentScript && document.currentScript.hasAttribute('data-frame-only');
  if (frameOnly && isTopPage) return;
  // The teacher page's live preview (?preview=1) is not a kiosk screen.
  if (new URLSearchParams(window.location.search).get('preview') === '1') return;

  // ── No zoom, selection, long-press menus or pull-to-refresh ──────────────
  var style = document.createElement('style');
  style.textContent =
    'html, body { overscroll-behavior: none; touch-action: pan-x pan-y;' +
    ' -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }' +
    'input, textarea, [contenteditable] { -webkit-user-select: text; user-select: text; }';
  document.head.appendChild(style);

  var viewport = document.querySelector('meta[name="viewport"]');
  if (!viewport) {
    viewport = document.createElement('meta');
    viewport.name = 'viewport';
    document.head.appendChild(viewport);
  }
  viewport.content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no';

  document.addEventListener('contextmenu', function(e) {
    if (e.target.closest && e.target.closest('[draggable="true"], input, textarea')) return;
    e.preventDefault();
  });
  // Two-finger pinch
  document.addEventListener('touchmove', function(e) {
    if (e.touches && e.touches.length > 1) e.preventDefault();
  }, { passive: false });
  // Touchpad pinch and Ctrl+mouse wheel arrive as wheel events with ctrlKey
  document.addEventListener('wheel', function(e) {
    if (e.ctrlKey) e.preventDefault();
  }, { passive: false });

  // ── Type Cover shortcuts: zoom, print, find, save, open ───────────────────
  var BLOCKED_CTRL_KEYS = ['+', '=', '-', '_', '0', 'p', 'f', 'g', 's', 'o', 'u', 'j', 'h'];
  document.addEventListener('keydown', function(e) {
    var key = (e.key || '').toLowerCase();
    if ((e.ctrlKey || e.metaKey) && BLOCKED_CTRL_KEYS.indexOf(key) !== -1) e.preventDefault();
    if (key === 'f3' || key === 'f7' || key === 'contextmenu') e.preventDefault();
  });

  if (!isTopPage) {
    // Taps on a page inside the belly's frame count for the belly page too,
    // so let it go full screen from here.
    document.addEventListener('click', function() {
      try { if (window.top.flexiGoFullScreen) window.top.flexiGoFullScreen(); } catch (e) {}
    }, true);
    return;  // the rest only works for the page that owns the screen
  }

  // ── Back gesture stays here ────────────────────────────────────────────────
  history.pushState(null, '', location.href);
  window.addEventListener('popstate', function() {
    history.pushState(null, '', location.href);
  });

  // ── Full screen, keys kept inside the page ─────────────────────────────────
  // Browsers only allow full screen after a tap. In Windows' kiosk mode Edge
  // already fills the screen, but this also hides Edge's own bar and, with
  // the keyboard lock, keeps Alt+Tab / Windows key / Esc from leaving.
  // Robot screens use an anonymous sign-in; a teacher's account means
  // someone is previewing the page on their own computer.
  function isTeacherBrowser() {
    try {
      var user = firebase.auth().currentUser;
      return !!(user && !user.isAnonymous);
    } catch (e) {
      return false;  // Firebase not ready yet: treat as a robot screen
    }
  }

  function goFullScreen() {
    var el = document.documentElement;
    if (document.fullscreenElement || !el.requestFullscreen || isTeacherBrowser()) return;
    el.requestFullscreen({ navigationUI: 'hide' }).then(function() {
      if (navigator.keyboard && navigator.keyboard.lock)
        navigator.keyboard.lock().catch(function() {});
    }).catch(function() { /* not allowed here; try on the next tap */ });
  }
  // 'click', not 'pointerdown': a finger only counts as a tap once lifted
  document.addEventListener('click', goFullScreen, true);
  window.flexiGoFullScreen = goFullScreen;

  // ── Keep the screen awake ──────────────────────────────────────────────────
  // The browser drops the lock whenever the page is hidden, so ask again
  // each time it comes back.
  var wakeLock = null;
  function keepAwake() {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible' || wakeLock) return;
    navigator.wakeLock.request('screen').then(function(lock) {
      wakeLock = lock;
      lock.addEventListener('release', function() { wakeLock = null; });
    }).catch(function() { /* not allowed yet (e.g. before a tap); try again later */ });
  }
  keepAwake();
  document.addEventListener('visibilitychange', keepAwake);
  document.addEventListener('pointerdown', keepAwake);
})();

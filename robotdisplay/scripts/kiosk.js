/* ═══════════════════════════════════════════════════════════════════════════
 * Kiosk behaviour for the robot's own screens (face phone, belly tablet).
 * The real lock is Android's Screen pinning, which the teacher turns on and
 * off with the device PIN; this script makes the page itself hard to mess
 * up while pinned:
 *   - keeps the screen awake (no auto-lock mid-lesson)
 *   - no zooming, text selection, long-press menus or pull-to-refresh
 *   - the Back gesture stays on the current screen
 * Drag-and-drop answers (long-press on a draggable bubble) and text inputs
 * keep working. Also included in the pages shown inside the belly's frame.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function() {
  var isTopPage = window.top === window;
  // Pages that are also opened on their own by teachers (e.g. the face editor
  // from Robot Tools) only act as kiosk screens inside the belly.
  var frameOnly = document.currentScript && document.currentScript.hasAttribute('data-frame-only');
  if (frameOnly && isTopPage) return;

  // ── No zoom, selection, long-press menus or pull-to-refresh ──────────────
  var style = document.createElement('style');
  style.textContent =
    'html, body { overscroll-behavior: none; touch-action: manipulation;' +
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

  if (!isTopPage) return;  // the rest only works for the page that owns the screen

  // ── Back gesture stays here ────────────────────────────────────────────────
  history.pushState(null, '', location.href);
  window.addEventListener('popstate', function() {
    history.pushState(null, '', location.href);
  });

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

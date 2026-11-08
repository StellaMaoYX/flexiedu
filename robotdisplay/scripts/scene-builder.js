/* ═══════════════════════════════════════════════════════════════════════════
 * Scene builder — the belly screen for a lesson's "Design a Scene" step
 * (e.g. design a playground), driven by sentence-student.js.
 *   - drag a picture from the tray onto the scene (each one can be used
 *     many times); drag placed pictures to move them; tap one for ➖ ➕ 🗑
 *   - ✏️ Draw: finger drawing in a few colours, ↶ Undo and Clear
 * The scene keeps a 16:9 shape so positions mean the same on any screen.
 * Its state is plain data – stickers {image, x, y, scale} with x/y as
 * fractions of the scene, strokes {colour, points: [x0, y0, x1, y1, …]} –
 * which the lesson stores so a reloaded screen carries on.
 *   SceneBuilder.open(step, savedState, onChange) / .getState() / .close()
 * ═══════════════════════════════════════════════════════════════════════════ */
var SceneBuilder = (function() {
  var ASPECT = 16 / 9;
  var COLOURS = ['#222831', '#e63946', '#ff9f1c', '#ffd23f', '#4caf50', '#1a56a0', '#8e5bd6', '#ffffff'];
  var STICKER_WIDTH = { normal: 0.12, large: 0.16, xlarge: 0.22 };  // of the scene's width
  var MIN_SCALE = 0.5, MAX_SCALE = 3, SCALE_STEP = 1.25;
  var LINE_WIDTH = 0.007;   // of the scene's width
  var TAP_MOVE_PX = 6;      // moving less than this is a tap, not a drag

  var step = null, state = null, onChange = null;
  var mode = 'move', penColour = COLOURS[0], selected = null;
  var changeTimer = null, isOpen = false;

  function $(id) { return document.getElementById(id); }

  function list(v) {
    if (Array.isArray(v)) return v;
    return v && typeof v === 'object' ? Object.keys(v).sort(function(a, b) { return a - b; }).map(function(k) { return v[k]; }) : [];
  }

  function round(n) { return Math.round(n * 1000) / 1000; }
  function clamp01(n) { return Math.max(0, Math.min(1, n)); }

  // ── Open / close ───────────────────────────────────────────────────────────
  function open(theStep, saved, changed) {
    step = theStep;
    onChange = changed;
    state = {
      stickers: list(saved && saved.stickers).filter(Boolean),
      strokes: list(saved && saved.strokes).filter(Boolean).map(function(s) {
        return { colour: s.colour, points: list(s.points) };
      }),
    };
    mode = 'move';
    selected = null;
    isOpen = true;

    $('sceneBg').style.backgroundImage = step.background ? 'url("' + step.background.replace(/"/g, '%22') + '")' : '';
    $('sceneDrawTools').style.display = step.allowDrawing === false ? 'none' : '';
    renderPalette();
    renderTray();
    renderMode();
    window.addEventListener('resize', fit);
    // the screen is already shown, so its size is known
    fit();
    renderStickers();
  }

  function close() {
    isOpen = false;
    clearTimeout(changeTimer);
    window.removeEventListener('resize', fit);
  }

  function getState() {
    return JSON.parse(JSON.stringify(state || { stickers: [], strokes: [] }));
  }

  // Tell the lesson about a change, at most about once a second.
  function changed() {
    clearTimeout(changeTimer);
    changeTimer = setTimeout(function() { if (isOpen && onChange) onChange(getState()); }, 800);
  }

  // ── Size: the largest 16:9 scene that fits ────────────────────────────────
  function fit() {
    var wrap = $('sceneWrap');
    var w = Math.min(wrap.clientWidth, wrap.clientHeight * ASPECT);
    var h = w / ASPECT;
    var scene = $('scene');
    scene.style.width = w + 'px';
    scene.style.height = h + 'px';
    var canvas = $('sceneCanvas');
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    redrawStrokes();
  }

  function sceneRect() { return $('scene').getBoundingClientRect(); }

  // ── Pictures ───────────────────────────────────────────────────────────────
  function stickerWidth(scale) {
    return (STICKER_WIDTH[step.imageSize] || STICKER_WIDTH.normal) * (scale || 1);
  }

  function renderTray() {
    var tray = $('sceneTray');
    tray.innerHTML = '';
    list(step.stickers).forEach(function(s) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'tray-item';
      b.innerHTML = '<img alt="" draggable="false"><span></span>';
      b.querySelector('img').src = s.image;
      b.querySelector('span').textContent = s.name || '';
      b.addEventListener('pointerdown', function(e) { dragNew(e, s); });
      tray.appendChild(b);
    });
    tray.style.display = tray.children.length ? '' : 'none';
  }

  function renderStickers() {
    var layer = $('sceneStickers');
    layer.innerHTML = '';
    state.stickers.forEach(function(s, i) {
      var img = document.createElement('img');
      img.className = 'scene-sticker' + (i === selected ? ' selected' : '');
      img.src = s.image;
      img.alt = '';
      img.draggable = false;
      img.style.left = (s.x * 100) + '%';
      img.style.top = (s.y * 100) + '%';
      img.style.width = (stickerWidth(s.scale) * 100) + '%';
      img.addEventListener('pointerdown', function(e) { dragPlaced(e, i); });
      layer.appendChild(img);
    });
    $('sceneSelection').style.display = selected === null ? 'none' : '';
  }

  // From the tray: a copy follows the finger and lands where it's let go.
  function dragNew(e, sticker) {
    if (mode !== 'move') setMode('move');
    e.preventDefault();
    var ghost = document.createElement('img');
    ghost.className = 'sticker-ghost';
    ghost.src = sticker.image;
    ghost.style.width = (stickerWidth(1) * sceneRect().width) + 'px';
    document.body.appendChild(ghost);
    var move = function(ev) {
      ghost.style.left = ev.clientX + 'px';
      ghost.style.top = ev.clientY + 'px';
    };
    move(e);
    track(e, move, function(ev) {
      ghost.remove();
      var r = sceneRect();
      if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) return;
      state.stickers.push({
        image: sticker.image,
        x: round((ev.clientX - r.left) / r.width),
        y: round((ev.clientY - r.top) / r.height),
        scale: 1,
      });
      selected = state.stickers.length - 1;
      renderStickers();
      changed();
    });
  }

  // A placed picture: drag to move it, tap to select it.
  function dragPlaced(e, i) {
    if (mode !== 'move') return;
    e.preventDefault();
    var startX = e.clientX, startY = e.clientY, moved = false;
    var s = state.stickers[i];
    var startPos = { x: s.x, y: s.y };
    var img = e.currentTarget;
    track(e, function(ev) {
      if (!moved && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < TAP_MOVE_PX) return;
      moved = true;
      var r = sceneRect();
      s.x = round(clamp01(startPos.x + (ev.clientX - startX) / r.width));
      s.y = round(clamp01(startPos.y + (ev.clientY - startY) / r.height));
      img.style.left = (s.x * 100) + '%';
      img.style.top = (s.y * 100) + '%';
    }, function() {
      selected = moved ? i : (selected === i ? null : i);
      renderStickers();
      if (moved) changed();
    });
  }

  // Follows one finger/mouse until it's lifted.
  function track(e, onMove, onEnd) {
    var id = e.pointerId;
    var move = function(ev) { if (ev.pointerId === id) onMove(ev); };
    var end = function(ev) {
      if (ev.pointerId !== id) return;
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', end);
      document.removeEventListener('pointercancel', end);
      onEnd(ev);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
  }

  function resizeSelected(factor) {
    if (selected === null) return;
    var s = state.stickers[selected];
    s.scale = round(Math.max(MIN_SCALE, Math.min(MAX_SCALE, (s.scale || 1) * factor)));
    renderStickers();
    changed();
  }

  function removeSelected() {
    if (selected === null) return;
    state.stickers.splice(selected, 1);
    selected = null;
    renderStickers();
    changed();
  }

  // ── Drawing ────────────────────────────────────────────────────────────────
  function setMode(m) {
    mode = m;
    selected = null;
    renderMode();
    renderStickers();
  }

  function renderMode() {
    $('sceneMoveBtn').classList.toggle('active', mode === 'move');
    $('sceneDrawBtn').classList.toggle('active', mode === 'draw');
    $('scenePalette').style.display = mode === 'draw' ? '' : 'none';
    $('sceneCanvas').style.pointerEvents = mode === 'draw' ? 'auto' : 'none';
  }

  function renderPalette() {
    var palette = $('scenePalette');
    palette.innerHTML = '';
    COLOURS.forEach(function(c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'pen-colour' + (c === penColour ? ' selected' : '');
      b.style.background = c;
      b.setAttribute('aria-label', 'Pen colour ' + c);
      b.onclick = function() { penColour = c; renderPalette(); };
      palette.appendChild(b);
    });
  }

  function drawStroke(ctx, stroke) {
    var p = stroke.points, w = ctx.canvas.width, h = ctx.canvas.height;
    if (p.length < 2) return;
    ctx.strokeStyle = stroke.colour;
    ctx.lineWidth = LINE_WIDTH * w;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(p[0] * w, p[1] * h);
    if (p.length === 2) ctx.lineTo(p[0] * w + 0.1, p[1] * h);  // a dot
    for (var i = 2; i < p.length; i += 2) ctx.lineTo(p[i] * w, p[i + 1] * h);
    ctx.stroke();
  }

  function redrawStrokes() {
    var canvas = $('sceneCanvas');
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    state.strokes.forEach(function(s) { drawStroke(ctx, s); });
  }

  function startStroke(e) {
    if (mode !== 'draw') return;
    e.preventDefault();
    var r = sceneRect();
    var point = function(ev) { return [round(clamp01((ev.clientX - r.left) / r.width)), round(clamp01((ev.clientY - r.top) / r.height))]; };
    var stroke = { colour: penColour, points: point(e) };
    state.strokes.push(stroke);
    redrawStrokes();
    track(e, function(ev) {
      var p = point(ev), n = stroke.points.length;
      if (Math.abs(p[0] - stroke.points[n - 2]) + Math.abs(p[1] - stroke.points[n - 1]) < 0.003) return;
      stroke.points.push(p[0], p[1]);
      redrawStrokes();
    }, changed);
  }

  function undoStroke() {
    state.strokes.pop();
    redrawStrokes();
    changed();
  }

  function clearDrawing() {
    if (!state.strokes.length) return;
    state.strokes = [];
    redrawStrokes();
    changed();
  }

  document.addEventListener('DOMContentLoaded', function() {
    if (!$('scene')) return;
    $('sceneCanvas').addEventListener('pointerdown', startStroke);
    $('sceneMoveBtn').onclick = function() { setMode('move'); };
    $('sceneDrawBtn').onclick = function() { setMode('draw'); };
    $('sceneUndoBtn').onclick = undoStroke;
    $('sceneClearBtn').onclick = clearDrawing;
    $('sceneSmallerBtn').onclick = function() { resizeSelected(1 / SCALE_STEP); };
    $('sceneBiggerBtn').onclick = function() { resizeSelected(SCALE_STEP); };
    $('sceneRemoveBtn').onclick = removeSelected;
    // tapping empty scene clears the selection
    $('sceneBg').addEventListener('pointerdown', function() {
      if (selected !== null) { selected = null; renderStickers(); }
    });
  });

  return { open: open, close: close, getState: getState };
})();

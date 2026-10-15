/* ═══════════════════════════════════════════════════════════════════════════
 * render-face-sentence-activity.js
 * Drives the robot face SVG for the sentence ordering activity.
 *
 * Three states:
 *   working – smiling, looking around, gentle blink (default)
 *   correct – big green smile, fast blink, sparkle overlay
 *   stuck   – sad frown, eyes down, animated teardrops
 *
 * Switches state by listening to Firebase:
 *   /robots/{id}/flexi/result   → correct or stuck
 *   /robots/{id}/flexi/pushed   → back to working (new activity loaded)
 *   /robots/{id}/flexi/command  → reset / tryAgain → back to working
 * ═══════════════════════════════════════════════════════════════════════════ */

(function () {

  // ── State constants ────────────────────────────────────────────────────────
  const STATE_WORKING = 'working';
  const STATE_CORRECT = 'correct';
  const STATE_STUCK   = 'stuck';

  let currentFaceState = null;
  let customFaceParams = null; // editor-shaped {key:{type,current,...}} pushed from face-editor.html, layered onto PARAMS_WORKING

  // ── Shared eye geometry ────────────────────────────────────────────────────
  const EYE_BASE = {
    eyeCenterDistPercent:  22,
    eyeYPercent:           40,
    eyeOuterRadiusPercent: 10,
    eyeShapeRatio:         1.5,
    eyeOutlineThickness:   3,
    eyeOutlineColor:       '#0d1a2e',
    eyeInnerRadiusPercent: 72,   // iris ~7% screen width
    eyePupilRadiusPercent: 55,   // pupil ~4% screen width
    hasReflection:         1,
    hasEyeLines:           0,
    hasEyelid:             1,
    avgLookaroundTime:     3000,
    minLookaroundTime:     1500,
  };

  // ── Face parameter presets ─────────────────────────────────────────────────
  const PARAMS_WORKING = Object.assign({}, EYE_BASE, {
    isHorizontal:          1,
    backgroundColor:       '#1a56a0',
    eyeOuterColor:         '#cfe2ff',
    eyeInnerColor:         '#0d2550',
    eyePupilColor:         '#3a6fcc',
    eyelidOffset:          28,          // raised eyelid — open alert eyes
    hasBlinking:           1,
    avgBlinkTime:          5000,
    hasMouth:              1,
    mouthWPercent:         3,
    mouthYPercent:         76,
    mouthH:                14,
    mouthColor:            '#cfe2ff',
    mouthStrokeWidth:      7,
    mouthSlope:            12,
    hasNose:               0,
    hasText:               0,
  });

  const PARAMS_CORRECT = Object.assign({}, EYE_BASE, {
    isHorizontal:          1,
    backgroundColor:       '#146e3c',
    eyeOuterColor:         '#b7f5d1',
    eyeInnerColor:         '#063d1e',
    eyePupilColor:         '#2ecc71',
    eyelidOffset:          35,          // wide open excited eyes
    hasBlinking:           1,
    avgBlinkTime:          1200,
    hasMouth:              1,
    mouthWPercent:         4,
    mouthYPercent:         76,
    mouthH:                18,
    mouthColor:            '#b7f5d1',
    mouthStrokeWidth:      7,
    mouthSlope:            14,
    hasNose:               0,
    hasText:               0,
  });

  const PARAMS_STUCK = Object.assign({}, EYE_BASE, {
    isHorizontal:          1,
    backgroundColor:       '#46465a',
    eyeOuterColor:         '#c8c8d8',
    eyeInnerColor:         '#222233',
    eyePupilColor:         '#6666aa',
    eyelidOffset:          12,          // droopy but not blocking iris
    hasBlinking:           0,
    avgBlinkTime:          99999,
    hasMouth:              1,
    mouthWPercent:         3,
    mouthYPercent:         76,
    mouthH:                14,
    mouthColor:            '#9090a8',
    mouthStrokeWidth:      7,
    mouthSlope:            12,
    hasNose:               0,
    hasText:               0,
  });

  // ── State transitions ──────────────────────────────────────────────────────
  function applyState(state) {
    if (state === currentFaceState) return;
    currentFaceState = state;

    stopSparkles();
    removeTears();

    if (state === STATE_CORRECT) {
      Object.assign(Face.parameters, PARAMS_CORRECT);
      Face.isMouthInverted  = false;
      Face.isMouthExtended  = true;
      Eyes.isLookingAround  = true;
      Face.draw();
      startSparkles();
      setLabel('Correct! ✅');

    } else if (state === STATE_STUCK) {
      Object.assign(Face.parameters, PARAMS_STUCK);
      Face.isMouthInverted  = true;
      Face.isMouthExtended  = true;
      Eyes.isLookingAround  = false;
      Eyes.currentLookAt    = 'none';
      Face.draw();
      addTears();
      setLabel("Uh-oh… let's try again");

    } else {
      renderWorking();
    }
  }

  // Renders the working look: base preset, then any custom face pushed from
  // face-editor.html layered on top. Split out from applyState so a live
  // push can re-render immediately without fighting its "same state, skip" guard.
  function renderWorking() {
    Object.assign(Face.parameters, PARAMS_WORKING);
    Face.isMouthInverted  = false;
    Face.isMouthExtended  = true;
    Eyes.isLookingAround  = true;
    if (customFaceParams) {
      Face.updateParameters(customFaceParams); // overrides pushed keys + redraws
    } else {
      Face.draw();
    }
    setLabel('Thinking… 🤔');
  }

  function setLabel(text) {
    const el = document.getElementById('stateLabel');
    if (el) el.textContent = text;
  }

  // ── Resize handler – redraw without re-triggering state guards ─────────────
  function redraw() {
    Face.draw();
    if (currentFaceState === STATE_STUCK) {
      removeTears();
      addTears();
    }
  }

  // ── Sparkles (correct state) ───────────────────────────────────────────────
  const SPARKLE_CHARS = ['⭐', '✨', '🌟', '💫', '🎉', '🎊', '⚡'];

  function startSparkles() {
    const layer = document.getElementById('sparkleLayer');
    layer.innerHTML = '';
    layer.style.display = 'block';
    for (let i = 0; i < 14; i++) {
      const el = document.createElement('div');
      el.className    = 'sparkle';
      el.textContent  = SPARKLE_CHARS[Math.floor(Math.random() * SPARKLE_CHARS.length)];
      el.style.left   = (5 + Math.random() * 88) + '%';
      el.style.top    = (30 + Math.random() * 50) + '%';
      el.style.setProperty('--dur',   (2.2 + Math.random() * 2.4).toFixed(1) + 's');
      el.style.setProperty('--delay', (i * 0.35 + Math.random() * 0.5).toFixed(2) + 's');
      layer.appendChild(el);
    }
  }

  function stopSparkles() {
    const layer = document.getElementById('sparkleLayer');
    if (layer) { layer.style.display = 'none'; layer.innerHTML = ''; }
  }

  // ── Animated teardrops (stuck state) ──────────────────────────────────────
  function addTears() {
    const svg = document.getElementById('faceSVG');
    const w   = svg.clientWidth;
    const h   = svg.clientHeight;

    [['tearLeft', 0.34], ['tearRight', 0.66]].forEach(([id, xFrac]) => {
      const cx    = w * xFrac;
      const startY = h * 0.60;
      const rx    = w * 0.013;
      const ry    = w * 0.020;

      const drop = document.createElementNS(svgNS, 'ellipse');
      drop.setAttribute('id',   id);
      drop.setAttribute('cx',   cx);
      drop.setAttribute('cy',   startY);
      drop.setAttribute('rx',   rx);
      drop.setAttribute('ry',   ry);
      drop.setAttribute('fill', '#89CFF0');

      // Fall downward
      const fall = document.createElementNS(svgNS, 'animateTransform');
      fall.setAttribute('attributeName', 'transform');
      fall.setAttribute('type',          'translate');
      fall.setAttribute('values',        '0 0; 0 ' + Math.round(h * 0.22));
      fall.setAttribute('dur',           '1.6s');
      fall.setAttribute('repeatCount',   'indefinite');
      fall.setAttribute('calcMode',      'spline');
      fall.setAttribute('keySplines',    '0.3 0.7 0.8 1');
      drop.appendChild(fall);

      // Fade in then out
      const fade = document.createElementNS(svgNS, 'animate');
      fade.setAttribute('attributeName', 'opacity');
      fade.setAttribute('values',        '0; 0.85; 0');
      fade.setAttribute('dur',           '1.6s');
      fade.setAttribute('repeatCount',   'indefinite');
      drop.appendChild(fade);

      svg.appendChild(drop);
    });
  }

  function removeTears() {
    ['tearLeft', 'tearRight'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.remove();
    });
  }

  // ── Firebase listeners ─────────────────────────────────────────────────────
  let lastResultTs  = 0;
  let lastPushedTs  = 0;
  let lastCommandTs = 0;

  function startListening(robotId) {
    const db        = firebase.database();
    const initTime  = Date.now();

    // Student result → correct or stuck (ignore stale results from previous sessions)
    db.ref(`/robots/${robotId}/flexi/result`).on('value', snap => {
      const data = snap.val();
      if (!data || data.timestamp <= lastResultTs || data.timestamp < initTime) return;
      lastResultTs = data.timestamp;
      applyState(data.isCorrect ? STATE_CORRECT : STATE_STUCK);
    });

    // New activity pushed → return to working (ignore stale)
    db.ref(`/robots/${robotId}/flexi/pushed`).on('value', snap => {
      const data = snap.val();
      if (!data || !data._pushedAt || data._pushedAt < initTime) return;
      applyState(STATE_WORKING);
    });

    // Lesson moved to a new step → working; lesson finished → happy (ignore stale)
    // (attempt counts also change the lesson, so only react to a new step)
    let lastLessonStep = null;
    db.ref(`/robots/${robotId}/flexi/lesson`).on('value', snap => {
      const lesson = snap.val();
      if (!lesson || !lesson.stepStartedAt || lesson.stepStartedAt < initTime) return;
      const step = lesson.status + ':' + lesson.stepStartedAt;
      if (step === lastLessonStep) return;
      lastLessonStep = step;
      applyState(lesson.status === 'finished' ? STATE_CORRECT : STATE_WORKING);
    });

    // Teacher command reset / tryAgain → return to working (ignore stale)
    db.ref(`/robots/${robotId}/flexi/command`).on('value', snap => {
      const cmd = snap.val();
      if (!cmd || !cmd.timestamp || cmd.timestamp < initTime) return;
      if (cmd.type === 'reset' || cmd.type === 'tryAgain') applyState(STATE_WORKING);
    });

    // Student clicked Try Again → return to working (ignore stale)
    db.ref(`/robots/${robotId}/flexi/studentStatus`).on('value', snap => {
      const data = snap.val();
      if (!data || !data.timestamp || data.timestamp < initTime) return;
      if (data.status === 'answering') applyState(STATE_WORKING);
    });

    // Face pushed live from face-editor.html → re-render immediately if
    // currently showing (or about to show) the working look
    db.ref(`/robots/${robotId}/flexi/customFace`).on('value', snap => {
      customFaceParams = snap.val() || null;
      if (currentFaceState === STATE_WORKING || currentFaceState === null) renderWorking();
    });
  }

  // ── Demo mode (cycles through all states when Firebase is unavailable) ─────
  function runDemo() {
    const cycle = [STATE_WORKING, STATE_CORRECT, STATE_STUCK];
    let i = 0;
    applyState(cycle[i]);
    setInterval(() => {
      i = (i + 1) % cycle.length;
      applyState(cycle[i]);
    }, 4000);
  }

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  function init() {
    new Face();
    window.addEventListener('resize', redraw);

    const robotId = Number(new URLSearchParams(window.location.search).get('robot') || 0);

    applyState(STATE_WORKING);

    try {
      if (typeof Config !== 'undefined' && typeof Database !== 'undefined') {
        new Database(new Config().config, () => startListening(robotId));
      } else {
        runDemo();
      }
    } catch (e) {
      console.warn('Firebase unavailable — running demo mode:', e);
      runDemo();
    }
  }

  document.addEventListener('DOMContentLoaded', init);

})();

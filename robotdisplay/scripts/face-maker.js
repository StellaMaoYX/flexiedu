/* ═══════════════════════════════════════════════════════════════════════════
 * Face maker — the students' face designer in a lesson's "Design FLEXI's
 * Face" step (shown inside sentence-student.html). A simpler, safer version
 * of the teachers' face editor:
 *   - students change their own copy; existing faces are only "Start from"
 *     templates and can't be changed or deleted here
 *   - big controls: colour swatches, shape choices, − / + buttons, plus
 *     Start again and Surprise me
 *   - FLEXI's face follows along live (/robots/{id}/flexi/customFace)
 *   - Save adds the face to /robots/{id}/faces, tagged with the lesson step
 *     (?key=), so a reloaded screen carries on with the same face; FLEXI
 *     says something nice about it
 * ═══════════════════════════════════════════════════════════════════════════ */
var config = new Config();
var currentRobot = Number(Config.getURLParameter('robot') || 0);
var lessonKey = Config.getURLParameter('key') || '';
var db = new Database(config.config, initFaceMaker);

var PALETTE = ['#1a56a0', '#2bb3a3', '#4caf50', '#ffd23f', '#ff9f1c', '#ef476f',
               '#e63946', '#8e5bd6', '#8d5524', '#ffffff', '#cfe2ff', '#222831'];

var COLOR_TARGETS = [
  { key: 'backgroundColor', label: 'Face' },
  { key: 'eyeOuterColor',   label: 'Eyes' },
  { key: 'eyeInnerColor',   label: 'Eye centres' },
  { key: 'eyePupilColor',   label: 'Pupils' },
  { key: 'mouthColor',      label: 'Mouth' },
];

var EYE_SHAPES = [
  { label: 'Round', ratio: 1.0 },
  { label: 'Oval',  ratio: 1.5 },
  { label: 'Wide',  ratio: 2.3 },
];

var MOUTH_SHAPES = [
  { label: 'Straight',  curve: 0 },
  { label: 'Smile',     curve: 14 },
  { label: 'Big smile', curve: 32 },
];

// − / + controls. "less"/"more" are the button labels for lowering/raising
// the value (e.g. ⬆ moves the eyes up, which is a smaller Y).
var STEPPERS = {
  eyes: [
    { key: 'eyeOuterRadiusPercent', label: 'Eye size',   step: 2,  min: 4,  max: 22 },
    { key: 'eyeCenterDistPercent',  label: 'Eye gap',    step: 3,  min: 10, max: 40 },
    { key: 'eyeYPercent',           label: 'Eyes',       step: 4,  min: 24, max: 60, less: '⬆', more: '⬇' },
    { key: 'eyePupilRadiusPercent', label: 'Pupil size', step: 10, min: 20, max: 100 },
  ],
  mouth: [
    { key: 'mouthWPercent',    label: 'Mouth width', step: 2, min: 2,  max: 18 },
    { key: 'mouthStrokeWidth', label: 'Mouth line',  step: 2, min: 2,  max: 16 },
    { key: 'mouthYPercent',    label: 'Mouth',       step: 4, min: 60, max: 92, less: '⬆', more: '⬇' },
  ],
};

var TOGGLES = {
  eyes:  [ { key: 'hasEyelid', label: 'Eyelids' }, { key: 'hasBlinking', label: 'Blinking' } ],
  mouth: [ { key: 'hasMouth',  label: 'Show mouth' } ],
};

var SAVED_PHRASES = [
  'I love my new face! Thank you!',
  'Wow, I look amazing! Thank you!',
  'This is my favourite face! Thank you!',
];

var faces = {};             // all of this robot's saved faces
var newParameters = null;   // the face being designed
var startParameters = null; // what "Start again" goes back to
var selectedFace = null;    // this face's key in /faces once saved
var isDirty = false;        // changed since the last save (read by sentence-student.js)
var currentTab = 'colours';

function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

function initFaceMaker() {
  firebase.database().ref('/robots/' + currentRobot + '/faces/').on('value', function(snapshot) {
    faces = snapshot.val() || {};
    if (!newParameters) startDesigning();
    renderTemplates();
  });
}

// Carry on with this lesson step's face if it was saved before (e.g. the
// screen reloaded); otherwise start from FLEXI's usual face.
function startDesigning() {
  var own = Object.keys(faces).filter(function(k) {
    return lessonKey && faces[k] && faces[k].lessonKey === lessonKey;
  })[0];
  if (own !== undefined) {
    selectedFace = own;
    newParameters = fromTemplate(faces[own]);
  } else {
    newParameters = fromTemplate(defaultTemplate());
  }
  startParameters = clone(newParameters);
  render();
  livePush();
}

function defaultTemplate() {
  var keys = Object.keys(faces).filter(function(k) { return faces[k] && !faces[k].lessonKey; });
  var flexi = keys.filter(function(k) { return /flexi/i.test(faces[k].name || ''); })[0];
  var key = flexi !== undefined ? flexi : keys[0];
  return key !== undefined ? faces[key] : DEFAULT_FACE_PARAMS;
}

// A copy of a face to design from, with every setting present.
function fromTemplate(template) {
  var p = clone(template);
  delete p.thumbSVG;
  delete p.lessonKey;
  for (var key in DEFAULT_FACE_PARAMS) {
    if (p[key] === undefined || p[key] === null) p[key] = clone(DEFAULT_FACE_PARAMS[key]);
  }
  p.name = 'My face';
  return p;
}

function value(key) {
  var p = newParameters[key];
  return p && p.current !== undefined ? p.current : DEFAULT_FACE_PARAMS[key].current;
}

function setValue(key, v) {
  if (!newParameters[key]) newParameters[key] = clone(DEFAULT_FACE_PARAMS[key]);
  newParameters[key].current = v;
  isDirty = true;
  renderPanel();
  livePush();
}

// ── Live: FLEXI's face follows every change (throttled) ─────────────────────
var livePushTimer = null;
function livePush() {
  if (livePushTimer || !newParameters) return;
  livePushTimer = setTimeout(function() {
    livePushTimer = null;
    firebase.database().ref('robots/' + currentRobot + '/flexi/customFace/').set(newParameters)
      .catch(function(err) { console.warn('Live push failed:', err); });
  }, 150);
}

// ── Save ─────────────────────────────────────────────────────────────────────
function saveFace(silent) {
  if (!newParameters) return;
  silent = silent === true;  // onclick passes an Event
  if (selectedFace === null) {
    var keys = Object.keys(faces).map(Number).filter(function(n) { return !isNaN(n); });
    selectedFace = String(keys.length ? Math.max.apply(null, keys) + 1 : 0);
  }
  var record = clone(newParameters);
  record.name = 'My face ' + new Date().toLocaleDateString();
  if (lessonKey) record.lessonKey = lessonKey;

  isDirty = false;
  firebase.database().ref('robots/' + currentRobot + '/faces/' + selectedFace + '/').set(record)
    .then(function() {
      if (silent) return;
      showSaved();
      var phrase = SAVED_PHRASES[Math.floor(Math.random() * SAVED_PHRASES.length)];
      try { if (window.parent.speakText) window.parent.speakText(phrase); } catch (e) {}
    })
    .catch(function(err) {
      isDirty = true;
      console.warn('Could not save face:', err);
      if (!silent) showSaved('Could not save – try again');
    });
}

function showSaved(text) {
  var btn = document.getElementById('saveBtn');
  btn.textContent = text || '✅ Saved!';
  setTimeout(function() { btn.textContent = '💾 Save my face'; }, 2000);
}

// ── Start again / Surprise me ───────────────────────────────────────────────
function startAgain() {
  newParameters = clone(startParameters);
  isDirty = true;
  render();
  livePush();
}

function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

function surpriseMe() {
  var face = pick(PALETTE);
  var eyes = pick(PALETTE.filter(function(c) { return c !== face; }));
  var middle = pick(PALETTE.filter(function(c) { return c !== eyes; }));
  set('backgroundColor', face);
  set('eyeOuterColor', eyes);
  set('eyeInnerColor', middle);
  set('eyePupilColor', pick(PALETTE.filter(function(c) { return c !== middle; })));
  set('mouthColor', pick(PALETTE.filter(function(c) { return c !== face; })));
  set('eyeShapeRatio', pick(EYE_SHAPES).ratio);
  set('mouthH', pick(MOUTH_SHAPES).curve);
  STEPPERS.eyes.concat(STEPPERS.mouth).forEach(function(s) {
    var steps = Math.floor((s.max - s.min) / s.step);
    set(s.key, s.min + s.step * Math.floor(Math.random() * (steps + 1)));
  });
  set('hasMouth', 1);
  isDirty = true;
  renderPanel();
  livePush();

  function set(key, v) {
    if (!newParameters[key]) newParameters[key] = clone(DEFAULT_FACE_PARAMS[key]);
    newParameters[key].current = v;
  }
}

// ── Drawing the controls ────────────────────────────────────────────────────
function render() {
  renderTemplates();
  renderTabs();
  renderPanel();
}

// Existing faces to start from (not this lesson's own saved face).
function renderTemplates() {
  var row = document.getElementById('templates');
  if (!row || !newParameters) return;
  row.innerHTML = '';
  Object.keys(faces).forEach(function(k) {
    var f = faces[k];
    if (!f || f.lessonKey) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'template';
    btn.title = 'Start from ' + (f.name || 'this face');
    btn.innerHTML = f.thumbSVG ? stripSvgIds(f.thumbSVG) : faceThumbSVG(f);
    btn.onclick = function() {
      newParameters = fromTemplate(f);
      isDirty = true;
      renderPanel();
      livePush();
    };
    row.appendChild(btn);
  });
  document.getElementById('templatesRow').style.display = row.children.length ? '' : 'none';
}

function renderTabs() {
  document.querySelectorAll('.tab').forEach(function(tab) {
    tab.classList.toggle('active', tab.dataset.tab === currentTab);
  });
}

function showTab(name) {
  currentTab = name;
  renderTabs();
  renderPanel();
}

function renderPanel() {
  var panel = document.getElementById('panel');
  if (!newParameters) return;
  panel.innerHTML = '';
  if (currentTab === 'colours') {
    COLOR_TARGETS.forEach(function(t) { panel.appendChild(colourRow(t)); });
  } else if (currentTab === 'eyes') {
    panel.appendChild(choiceRow('Shape', EYE_SHAPES, function(s) {
      return Math.abs(Number(value('eyeShapeRatio')) - s.ratio) < 0.01;
    }, function(s) { setValue('eyeShapeRatio', s.ratio); }, eyeIcon));
    STEPPERS.eyes.forEach(function(s) { panel.appendChild(stepperRow(s)); });
    TOGGLES.eyes.forEach(function(t) { panel.appendChild(toggleRow(t)); });
  } else {
    panel.appendChild(choiceRow('Shape', MOUTH_SHAPES, function(s) {
      return Number(value('mouthH')) === s.curve;
    }, function(s) { setValue('mouthH', s.curve); setValue('hasMouth', 1); }, mouthIcon));
    STEPPERS.mouth.forEach(function(s) { panel.appendChild(stepperRow(s)); });
    TOGGLES.mouth.forEach(function(t) { panel.appendChild(toggleRow(t)); });
  }
}

function row(label) {
  var div = document.createElement('div');
  div.className = 'control-row';
  div.innerHTML = '<div class="control-label">' + label + '</div><div class="control-body"></div>';
  return div;
}

function colourRow(target) {
  var div = row(target.label);
  var body = div.querySelector('.control-body');
  var current = String(value(target.key)).toLowerCase();
  PALETTE.forEach(function(c) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch' + (c.toLowerCase() === current ? ' selected' : '');
    b.style.background = c;
    b.setAttribute('aria-label', target.label + ' ' + c);
    b.onclick = function() { setValue(target.key, c); };
    body.appendChild(b);
  });
  return div;
}

function choiceRow(label, options, isSelected, choose, icon) {
  var div = row(label);
  var body = div.querySelector('.control-body');
  options.forEach(function(o) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'choice' + (isSelected(o) ? ' selected' : '');
    b.innerHTML = icon(o) + '<span>' + o.label + '</span>';
    b.onclick = function() { choose(o); };
    body.appendChild(b);
  });
  return div;
}

function stepperRow(s) {
  var div = row(s.label);
  var body = div.querySelector('.control-body');
  var v = Number(value(s.key));
  var less = document.createElement('button');
  less.type = 'button';
  less.className = 'step-btn';
  less.textContent = s.less || '−';
  less.disabled = v <= s.min;
  less.onclick = function() { setValue(s.key, Math.max(s.min, v - s.step)); };
  var more = document.createElement('button');
  more.type = 'button';
  more.className = 'step-btn';
  more.textContent = s.more || '+';
  more.disabled = v >= s.max;
  more.onclick = function() { setValue(s.key, Math.min(s.max, v + s.step)); };
  var bar = document.createElement('div');
  bar.className = 'step-bar';
  var fill = Math.max(0, Math.min(1, (v - s.min) / (s.max - s.min)));
  bar.innerHTML = '<div style="width:' + Math.round(fill * 100) + '%"></div>';
  body.appendChild(less);
  body.appendChild(bar);
  body.appendChild(more);
  return div;
}

function toggleRow(t) {
  var div = row(t.label);
  var body = div.querySelector('.control-body');
  var on = Number(value(t.key)) === 1;
  [['On', 1], ['Off', 0]].forEach(function(o) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'choice small' + ((o[1] === 1) === on ? ' selected' : '');
    b.textContent = o[0];
    b.onclick = function() { setValue(t.key, o[1]); };
    body.appendChild(b);
  });
  return div;
}

function eyeIcon(shape) {
  var rx = 16, ry = rx / shape.ratio;
  return '<svg width="44" height="34" viewBox="0 0 44 34"><ellipse cx="22" cy="17" rx="' + rx +
    '" ry="' + ry + '" fill="#cfe2ff" stroke="#0d1a2e" stroke-width="2"/><ellipse cx="22" cy="17" rx="' +
    (rx * 0.45) + '" ry="' + (ry * 0.45) + '" fill="#0d2550"/></svg>';
}

function mouthIcon(shape) {
  return '<svg width="44" height="34" viewBox="0 0 44 34"><path d="M 8 12 Q 22 ' + (12 + shape.curve * 0.8) +
    ' 36 12" fill="none" stroke="#1a56a0" stroke-width="4" stroke-linecap="round"/></svg>';
}

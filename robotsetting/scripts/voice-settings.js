/* ═══════════════════════════════════════════════════════════════════════════
 * Teacher control for the robot's voice and speaking speed, saved to
 * /robots/{id}/voice and used by both robot screens (robot-voice.js).
 * The voice list is what the robot's paired screens reported in
 * /robots/{id}/voiceOptions, since the teacher's computer has other voices.
 *   VoiceSettings.mount(containerId, robotId)
 * "Test" goes to the belly tablet (as a 'say' command on /flexi/command),
 * the screen that speaks during lessons.
 * ═══════════════════════════════════════════════════════════════════════════ */
var VoiceSettings = (function() {
  var DEFAULT_RATE = 0.9;
  var TEST_SENTENCE = "Hi! This is how I sound when I talk to you.";
  var SCREEN_NAMES = { face: 'face screen', belly: 'belly screen' };

  var STYLE =
    '.vs-row { margin-bottom: 12px; }' +
    '.vs-label { display: block; font-size: 0.8rem; font-weight: bold; color: #555; margin-bottom: 4px; }' +
    '.vs-select { width: 100%; padding: 7px 8px; border: 2px solid #dde; border-radius: 8px; font-size: 0.9rem; background: white; }' +
    '.vs-rate { display: flex; align-items: center; gap: 10px; }' +
    '.vs-rate input { flex: 1; }' +
    '.vs-rate-value { min-width: 9.5em; font-size: 0.85rem; color: #333; }' +
    '.vs-hint { font-size: 0.78rem; color: #999; line-height: 1.4; margin-top: 4px; }' +
    '.vs-actions { display: flex; align-items: center; gap: 10px; }' +
    '.vs-test { padding: 7px 14px; border: 2px solid #1a56a0; border-radius: 8px; background: white; color: #1a56a0; font-weight: bold; cursor: pointer; }' +
    '.vs-test:hover { background: #f0f4ff; }' +
    '.vs-status { font-size: 0.8rem; color: #1e7a4a; }';

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function rateLabel(rate) {
    var words = rate <= 0.8 ? 'slow, for young kids'
              : rate < 0.95 ? 'a little slow'
              : rate <= 1.05 ? 'normal'
              : 'fast';
    return rate.toFixed(2) + '× – ' + words;
  }

  function mount(containerId, robotId) {
    var box = document.getElementById(containerId);
    if (!box) return;

    if (!document.getElementById('voiceSettingsStyle')) {
      var style = document.createElement('style');
      style.id = 'voiceSettingsStyle';
      style.textContent = STYLE;
      document.head.appendChild(style);
    }

    box.innerHTML =
      '<div class="vs-row">' +
        '<label class="vs-label" for="vsVoice">Voice</label>' +
        '<select class="vs-select" id="vsVoice"></select>' +
        '<div class="vs-hint" id="vsVoiceHint"></div>' +
      '</div>' +
      '<div class="vs-row">' +
        '<label class="vs-label" for="vsRate">Speaking speed</label>' +
        '<div class="vs-rate">' +
          '<input type="range" id="vsRate" min="0.5" max="1.3" step="0.05">' +
          '<span class="vs-rate-value" id="vsRateValue"></span>' +
        '</div>' +
      '</div>' +
      '<div class="vs-actions">' +
        '<button type="button" class="vs-test" id="vsTest">&#128266; Test on robot</button>' +
        '<span class="vs-status" id="vsStatus"></span>' +
      '</div>';

    var select = document.getElementById('vsVoice');
    var hint = document.getElementById('vsVoiceHint');
    var rateInput = document.getElementById('vsRate');
    var rateValue = document.getElementById('vsRateValue');
    var status = document.getElementById('vsStatus');
    var voiceRef = firebase.database().ref('/robots/' + robotId + '/voice');

    var saved = { name: '', rate: DEFAULT_RATE };
    var options = {};
    var statusTimer = null;

    function showStatus(text) {
      status.textContent = text;
      clearTimeout(statusTimer);
      statusTimer = setTimeout(function() { status.textContent = ''; }, 2500);
    }

    function save(updates) {
      voiceRef.update(updates)
        .then(function() { showStatus('Saved'); })
        .catch(function(e) {
          console.error('Could not save voice setting:', e);
          showStatus('Could not save – are you signed in?');
        });
    }

    function renderVoices() {
      // voice name -> { lang, screens: ['face', 'belly'] }
      var voices = {};
      var automatic = [];
      Object.keys(options).forEach(function(screen) {
        var list = options[screen].voices || [];
        list.forEach(function(v) {
          if (!voices[v.name]) voices[v.name] = { lang: v.lang, screens: [] };
          voices[v.name].screens.push(screen);
        });
        if (options[screen].automatic)
          automatic.push(options[screen].automatic + ' on the ' + SCREEN_NAMES[screen]);
      });
      var screenCount = Object.keys(options).length;

      var html = '<option value="">Automatic – most natural voice on each screen</option>';
      Object.keys(voices).sort().forEach(function(name) {
        var v = voices[name];
        var where = screenCount > 1 && v.screens.length < screenCount
          ? ' – ' + SCREEN_NAMES[v.screens[0]] + ' only' : '';
        html += '<option value="' + esc(name) + '">' + esc(name + ' (' + v.lang + ')' + where) + '</option>';
      });
      if (saved.name && !voices[saved.name])
        html += '<option value="' + esc(saved.name) + '">' + esc(saved.name) + ' – not on the robot\'s screens</option>';
      select.innerHTML = html;
      select.value = saved.name;

      if (!screenCount)
        hint.textContent = 'Turn on the robot\'s screens to see the voices they have.';
      else if (!saved.name)
        hint.textContent = 'Now using ' + automatic.join(' and ') + '.';
      else
        hint.textContent = 'A screen that doesn\'t have this voice uses its most natural one.';
    }

    function renderRate() {
      rateInput.value = saved.rate;
      rateValue.textContent = rateLabel(saved.rate);
    }

    voiceRef.on('value', function(snap) {
      var v = snap.val() || {};
      saved.name = v.name || '';
      saved.rate = Number(v.rate) || DEFAULT_RATE;
      renderVoices();
      renderRate();
    });

    firebase.database().ref('/robots/' + robotId + '/voiceOptions').on('value', function(snap) {
      options = snap.val() || {};
      renderVoices();
    });

    select.addEventListener('change', function() {
      saved.name = select.value;
      renderVoices();
      save({ name: saved.name });
    });

    rateInput.addEventListener('input', function() {
      rateValue.textContent = rateLabel(Number(rateInput.value));
    });
    rateInput.addEventListener('change', function() {
      saved.rate = Number(rateInput.value);
      save({ rate: saved.rate });
    });

    document.getElementById('vsTest').addEventListener('click', function() {
      firebase.database().ref('/robots/' + robotId + '/flexi/command')
        .set({ type: 'say', text: TEST_SENTENCE, timestamp: Date.now() })
        .then(function() { showStatus('Sent to robot'); })
        .catch(function() { showStatus('Could not reach the robot'); });
    });
  }

  return { mount: mount };
})();

/* ═══════════════════════════════════════════════════════════════════════════
 * How the robot's screens speak (face phone and belly tablet).
 *   /robots/{id}/voice – the teacher's choice: { name, rate }. An empty name
 *     means "the most natural-sounding English voice this device has".
 *   /robots/{id}/voiceOptions/{face|belly} – the English voices each paired
 *     screen really has, and lastSpoken: which voice it really used for its
 *     last sentence and what the browser reported (start/end/error). Voices
 *     differ by device and browser (Edge on Windows has "Microsoft Clara
 *     Online (Natural)", Chrome has Google's), so the teacher's dropdown
 *     lists these instead of the teacher's own voices.
 * A chosen voice a screen doesn't have falls back to its automatic pick.
 * Online voices (like Clara) need the internet. Without it the device's own
 * voice is used (e.g. Zira on Windows): picked up front when the device knows
 * it's offline, or as a single retry when an online voice clearly fails
 * before saying anything. A sentence is never heard twice: the failed one is
 * stopped first, a late error doesn't count, and a newer sentence wins.
 * ═══════════════════════════════════════════════════════════════════════════ */
var RobotVoice = (function() {
  var DEFAULT_RATE = 0.9;
  var settings = { name: '', rate: DEFAULT_RATE };
  var robotId = null;
  var role = null;
  var isPairedDevice = false;
  var lastReport = '';

  var FAILED_END_MS = 400;              // "ended" sooner than this: nothing was said
  var FAILED_ERROR_MS = 1500;           // a later error may come after speech was heard
  var ONLINE_RETRY_AFTER_MS = 60000;    // after a failure, use local voices this long
  var onlineFailedAt = 0;
  var latestUtterance = null;           // the sentence that should be heard now

  // macOS joke and old formant voices: English, but nobody wants them.
  var NOVELTY = /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Eddy|Flo|Fred|Good News|Grandma|Grandpa|Jester|Junior|Kathy|Organ|Ralph|Reed|Rocko|Sandy|Shelley|Superstar|Trinoids|Whisper|Wobble|Zarvox)\b/i;

  function clampRate(rate) {
    rate = Number(rate);
    if (!rate) return DEFAULT_RATE;
    return Math.min(1.5, Math.max(0.5, rate));
  }

  function englishVoices() {
    if (!('speechSynthesis' in window)) return [];
    return window.speechSynthesis.getVoices().filter(function(v) {
      return /^en/i.test(v.lang);
    });
  }

  // Higher sounds more natural. Neural/online voices first, and Clara, the
  // classroom favourite from Edge, ahead of the other natural ones.
  function naturalScore(v) {
    var s = 0;
    if (/natural|neural/i.test(v.name)) s += 100;
    if (/enhanced|premium|siri/i.test(v.name)) s += 60;
    if (/clara/i.test(v.name)) s += 50;
    if (/google|network/i.test(v.name)) s += 40;
    if (!v.localService) s += 10;
    if (/^en[-_](us|ca)/i.test(v.lang)) s += 5;
    if (NOVELTY.test(v.name)) s -= 200;
    return s;
  }

  function onlineVoicesWork() {
    return navigator.onLine !== false &&
      Date.now() - onlineFailedAt > ONLINE_RETRY_AFTER_MS;
  }

  function usableVoices(localOnly) {
    var online = !localOnly && onlineVoicesWork();
    return englishVoices().filter(function(v) {
      return v.localService || online;
    });
  }

  function automaticVoice(localOnly) {
    return usableVoices(localOnly).sort(function(a, b) {
      return naturalScore(b) - naturalScore(a);
    })[0] || null;
  }

  function currentVoice(localOnly) {
    if (settings.name) {
      var chosen = usableVoices(localOnly).filter(function(v) {
        return v.name === settings.name;
      })[0];
      if (chosen) return chosen;
    }
    return automaticVoice(localOnly);
  }

  function utterance(text, localOnly, switchedFrom) {
    var utt = new SpeechSynthesisUtterance(text);
    var voice = currentVoice(localOnly);
    if (voice) {
      utt.voice = voice;
      utt.lang = voice.lang;
    } else {
      utt.lang = 'en-US';
    }
    utt.rate = settings.rate;
    latestUtterance = utt;
    noteWhatHappens(utt, voice, switchedFrom);
    if (voice && !voice.localService) retryLocallyIfSilent(utt, text);
    return utt;
  }

  // When an online voice clearly fails before saying anything (an early
  // error, or "ending" at once), stop it and say the sentence once with a
  // local voice. Anything less clear is left alone, so nothing overlaps.
  function retryLocallyIfSilent(utt, text) {
    var createdAt = Date.now();
    var started = false;
    var retried = false;
    function retry(reason) {
      // it spoke, already retried, or a newer sentence has taken over
      if (started || retried || latestUtterance !== utt) return;
      retried = true;
      onlineFailedAt = Date.now();
      console.warn('Online voice failed (' + reason + '), using a voice on this device');
      window.speechSynthesis.cancel();
      var local = utterance(text, true, utt.voice.name + ' – ' + reason);
      if (local.voice && local.voice.localService) window.speechSynthesis.speak(local);
    }
    utt.addEventListener('start', function() { started = true; });
    utt.addEventListener('boundary', function() { started = true; });
    utt.addEventListener('end', function() {
      if (Date.now() - createdAt < FAILED_END_MS) retry('ended without a sound');
    });
    utt.addEventListener('error', function(e) {
      // interrupted/canceled: a newer sentence replaced this one;
      // not-allowed: needs a tap first (the page asks for it), not a new voice
      if (['interrupted', 'canceled', 'not-allowed'].indexOf(e.error) === -1 &&
          Date.now() - createdAt < FAILED_ERROR_MS) retry('error: ' + e.error);
    });
  }

  // Tell the teacher's page what this screen really said, with which voice,
  // and the events the browser sent – so "it sounds wrong" can be explained.
  function noteWhatHappens(utt, voice, switchedFrom) {
    if (!isPairedDevice || !role) return;
    var createdAt = Date.now();
    var events = [];
    function add(name) { events.push(name + ' ' + (Date.now() - createdAt) + 'ms'); }
    function save() {
      firebase.database().ref('/robots/' + robotId + '/voiceOptions/' + role + '/lastSpoken').set({
        text: utt.text.slice(0, 80),
        voice: voice ? voice.name : '(browser default)',
        online: !!(voice && !voice.localService),
        switchedFrom: switchedFrom || '',
        events: events.join(', '),
        at: firebase.database.ServerValue.TIMESTAMP
      }).catch(function() {});
    }
    utt.addEventListener('start', function() { add('start'); });
    utt.addEventListener('end', function() { add('end'); save(); });
    utt.addEventListener('error', function(e) { add('error:' + e.error); save(); });
  }

  // Stop whatever is being said; it doesn't count as a failed voice.
  function cancel() {
    latestUtterance = null;
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }

  // Browser voices when the device has any; otherwise, or when the browser
  // refuses to speak before anyone has touched the screen, ResponsiveVoice's
  // recorded fallback voice (what the face used before).
  function speak(text) {
    var fallback = function() {
      if (window.responsiveVoice)
        responsiveVoice.speak(text, 'Fallback UK Female', { rate: settings.rate });
    };
    if (!englishVoices().length) return fallback();
    var utt = utterance(text);
    utt.onerror = function(e) {
      if (e.error === 'not-allowed') fallback();
    };
    window.speechSynthesis.speak(utt);
  }

  function report() {
    if (!isPairedDevice || !role) return;
    var voices = englishVoices().map(function(v) {
      return { name: v.name, lang: v.lang };
    });
    var auto = automaticVoice();
    var key = JSON.stringify(voices);
    if (!voices.length || key === lastReport) return;
    lastReport = key;
    firebase.database().ref('/robots/' + robotId + '/voiceOptions/' + role).update({
      voices: voices,
      automatic: auto ? auto.name : '',
      updatedAt: firebase.database.ServerValue.TIMESTAMP
    }).catch(function(e) {
      console.warn('Could not report voices:', e);
    });
  }

  // Follow the teacher's setting; a paired screen (anonymous sign-in) also
  // tells the teacher's page which voices it has.
  function watch(id, deviceRole) {
    robotId = id;
    role = deviceRole;
    firebase.database().ref('/robots/' + id + '/voice').on('value', function(snap) {
      var v = snap.val() || {};
      settings.name = v.name || '';
      settings.rate = clampRate(v.rate);
    });
    firebase.auth().onAuthStateChanged(function(user) {
      isPairedDevice = !!(user && user.isAnonymous);
      report();
    });
    if ('speechSynthesis' in window) {
      // Chrome fills in the voice list a moment after the page loads.
      if (window.speechSynthesis.addEventListener)
        window.speechSynthesis.addEventListener('voiceschanged', report);
      else
        window.speechSynthesis.onvoiceschanged = report;
    }
  }

  return {
    DEFAULT_RATE: DEFAULT_RATE,
    clampRate: clampRate,
    watch: watch,
    speak: speak,
    cancel: cancel,
    utterance: utterance
  };
})();

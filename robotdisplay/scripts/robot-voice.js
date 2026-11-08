/* ═══════════════════════════════════════════════════════════════════════════
 * How the robot's screens speak (face phone and belly tablet).
 *   /robots/{id}/voice – the teacher's choice: { name, rate }. An empty name
 *     means "the most natural-sounding English voice this device has".
 *   /robots/{id}/voiceOptions/{face|belly} – the English voices each paired
 *     screen really has. Voices differ by device and browser (Edge on Windows
 *     has "Microsoft Clara Online (Natural)", Android Chrome has Google's), so
 *     the teacher's dropdown lists these instead of the teacher's own voices.
 * A chosen voice a screen doesn't have falls back to its automatic pick.
 * Online voices (Edge's "Online (Natural)" ones, like Clara) need the
 * internet: when one clearly fails, the sentence is said again with
 * the best voice installed on the device (e.g. Zira on Windows).
 * ═══════════════════════════════════════════════════════════════════════════ */
var RobotVoice = (function() {
  var DEFAULT_RATE = 0.9;
  var settings = { name: '', rate: DEFAULT_RATE };
  var robotId = null;
  var role = null;
  var isPairedDevice = false;
  var lastReport = '';

  var FAILED_END_MS = 400;              // "ended" sooner than this: nothing was said
  var ONLINE_RETRY_AFTER_MS = 60000;    // after a failure, stay local this long
  var onlineFailedAt = 0;
  var latestUtterance = null;

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

  function utterance(text, localOnly) {
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
    if (voice && !voice.localService) retryLocallyIfSilent(utt, text);
    return utt;
  }

  // An online voice can fail without the internet: it reports an error, or
  // "ends" at once without a sound. Then say the same sentence again with a
  // local voice. Only clear failures count – a slow start or a missing
  // 'start' event is not one, or the sentence would be said twice.
  function retryLocallyIfSilent(utt, text) {
    var createdAt = Date.now();
    var started = false;
    var retried = false;
    function retry() {
      // stopped on purpose, or a newer sentence has taken over: leave it
      if (started || retried || latestUtterance !== utt) return;
      retried = true;
      onlineFailedAt = Date.now();
      console.warn('Online voice failed, using a voice on this device');
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance(text, true));
    }
    utt.addEventListener('start', function() { started = true; });
    utt.addEventListener('boundary', function() { started = true; });
    utt.addEventListener('end', function() {
      if (Date.now() - createdAt < FAILED_END_MS) retry();
    });
    utt.addEventListener('error', function(e) {
      // interrupted/canceled: a newer sentence replaced this one;
      // not-allowed: no voice may speak yet, a local one won't either
      if (['interrupted', 'canceled', 'not-allowed'].indexOf(e.error) === -1) retry();
    });
  }

  // Stop whatever is being said, without it counting as a failed voice.
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
    firebase.database().ref('/robots/' + robotId + '/voiceOptions/' + role).set({
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

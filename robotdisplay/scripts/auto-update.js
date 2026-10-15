/* ═══════════════════════════════════════════════════════════════════════════
 * Keeps the robot's own screens (face phone, belly tablet, pairing page) on
 * the latest version of FLEXI. GitHub Pages lets browsers reuse files for 10
 * minutes, so after an update a screen could keep running old code and
 * silently ignore new features.
 *
 * On load and every 2 minutes this compares the version (ETag) of the page,
 * its scripts and its iframe page with what the server has now. If anything
 * is newer, it re-downloads those files into the browser cache and reloads.
 * Lessons live in the database, so a reload picks up where the student was.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function() {
  var CHECK_EVERY_MS = 2 * 60 * 1000;
  var LOOP_GUARD_KEY = 'flexiAutoUpdateTried';
  var baseline = {};  // url -> ETag of the version this screen is running

  // This page, its same-site scripts, and the same for an embedded page.
  function trackedUrls() {
    var urls = [location.href.split('#')[0]];
    function addScripts(doc) {
      Array.prototype.forEach.call(doc.scripts, function(s) {
        if (s.src && s.src.indexOf(location.origin + '/') === 0) urls.push(s.src);
      });
    }
    addScripts(document);
    Array.prototype.forEach.call(document.querySelectorAll('iframe'), function(frame) {
      try {
        if (frame.contentWindow.location.origin !== location.origin) return;
        urls.push(frame.contentWindow.location.href.split('#')[0]);
        addScripts(frame.contentDocument);
      } catch (e) { /* not loaded yet, or another site */ }
    });
    return urls.filter(function(url, i) { return urls.indexOf(url) === i; });
  }

  function etagOf(url, cacheMode, method) {
    return fetch(url, { method: method || 'GET', cache: cacheMode })
      .then(function(r) { return r.ok ? r.headers.get('ETag') : null; })
      .catch(function() { return null; });
  }

  // Re-download every tracked file into the cache, then reload. Each set of
  // versions is only tried once per tab, so a browser that ignores the cache
  // hints can't get stuck reloading.
  function updateTo(latest) {
    var marker = JSON.stringify(latest);
    try {
      if (sessionStorage.getItem(LOOP_GUARD_KEY) === marker) return;
      sessionStorage.setItem(LOOP_GUARD_KEY, marker);
    } catch (e) {}
    var urls = Object.keys(latest);
    Promise.all(urls.map(function(url) {
      return fetch(url, { cache: 'reload' }).catch(function() {});
    })).then(function() { location.reload(); });
  }

  function latestVersions(urls) {
    return Promise.all(urls.map(function(url) { return etagOf(url, 'no-store', 'HEAD'); }))
      .then(function(tags) {
        var latest = {};
        urls.forEach(function(url, i) { latest[url] = tags[i]; });
        return latest;
      });
  }

  function isNewer(latest) {
    return Object.keys(latest).some(function(url) {
      return latest[url] && baseline[url] && latest[url] !== baseline[url];
    });
  }

  // Record what this screen is running (the cached copy it loaded) and fix
  // it right away if the server already has something newer.
  function startUp() {
    var urls = trackedUrls();
    Promise.all(urls.map(function(url) { return etagOf(url, 'force-cache'); })).then(function(tags) {
      urls.forEach(function(url, i) { baseline[url] = tags[i]; });
      return latestVersions(urls);
    }).then(function(latest) {
      if (isNewer(latest)) updateTo(latest);
    });
  }

  function check() {
    var urls = trackedUrls();
    // Files that appeared since start-up (e.g. the belly switched pages):
    // whatever is loaded now is the baseline.
    var fresh = urls.filter(function(url) { return !(url in baseline); });
    Promise.all(fresh.map(function(url) { return etagOf(url, 'force-cache'); })).then(function(tags) {
      fresh.forEach(function(url, i) { baseline[url] = tags[i]; });
      return latestVersions(urls);
    }).then(function(latest) {
      if (isNewer(latest)) updateTo(latest);
    });
  }

  window.flexiCheckForUpdate = check;  // for checking by hand from the console

  if (!window.fetch) return;
  // Let an embedded page finish loading so its files are tracked too.
  window.addEventListener('load', function() {
    setTimeout(startUp, 3000);
    setInterval(check, CHECK_EVERY_MS);
  });
})();

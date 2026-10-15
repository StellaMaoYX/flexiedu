/*
* Teacher pages load this script with a data-require-access attribute. On
* those pages only an admin, or a teacher assigned a robot in /idEmails, may
* stay; a teacher is always pinned to their own robot whatever the URL says.
* The page stays hidden until that check passes.
*/
var DATABASE_REQUIRE_ACCESS = !!(document.currentScript &&
  document.currentScript.hasAttribute('data-require-access'));
if (DATABASE_REQUIRE_ACCESS) {
  document.documentElement.style.visibility = 'hidden';
  // If Firebase never loads, the check never runs; say so instead of
  // leaving a blank page.
  setTimeout(function() {
    if (document.documentElement.style.visibility !== 'hidden') return;
    document.body.innerHTML =
      '<div style="font-family:sans-serif;max-width:480px;margin:80px auto;padding:24px;text-align:center;">' +
      '<h2>Could not check your account</h2>' +
      '<p style="color:#555;">Please check your internet connection and reload the page.</p></div>';
    document.documentElement.style.visibility = '';
  }, 15000);
}

/*
* Database class for interfacing with the Firebase realtime database
*/
function Database(config, readyCallback) {
  
  Database.isAnonymous = false;
  Database.uid = null;
  Database.userEmail = null;
  Database.isLogging = true;

  /*
  * If somethings need to be initialized only after the database connection 
  * has been established, the Database.readyCallback static variable should be
  * set to the initialization function. If it is not null, it will be called
  * when successful sign in happens.
  */
  Database.readyCallback = readyCallback;

  /* 
  * Firebase configuration information obntained from the Firebase console
  */
  Database.config = config;

  /*
  * Function to initialize firebase and sign in anonymously
  */
  Database.initialize = async function() {
    Database.app = await firebase.initializeApp(Database.config);
    // The access check gets its own listener, registered first: several
    // pages replace handleAuthStateChange with their own, which must not
    // skip the check.
    if (DATABASE_REQUIRE_ACCESS) firebase.auth().onAuthStateChanged(Database.accessGuard);
    firebase.auth().onAuthStateChanged(Database.handleAuthStateChange);
    // Handle the result after returning from Google redirect sign-in
    firebase.auth().getRedirectResult().catch(Database.handleError);
  }
  
  /*
  * Callback function for when a library is dynamically loaded
  * Will need to wait for all libraries to be loaded before
  * initializing the database.
  */
  Database.nLibrariesLoaded = 0;
  Database.libraryLoadCallback = function(){
    Database.nLibrariesLoaded++;
    if (Database.nLibrariesLoaded == 4) { // All Firebase scripts loaded
      Database.initialize();
    }
  }
  
  Database.loadJSLibrary = async function(path) {
      var js = document.createElement("script");
      js.type = "text/javascript";
      js.src = path;
      js.onreadystatechange = Database.libraryLoadCallback;
      js.onload = Database.libraryLoadCallback;
      document.head.appendChild(js);
  }

  Database.loadJSLibrary(src="https://www.gstatic.com/firebasejs/6.3.0/firebase-app.js");
  Database.loadJSLibrary(src="https://www.gstatic.com/firebasejs/6.3.0/firebase-auth.js");
  Database.loadJSLibrary(src="https://www.gstatic.com/firebasejs/6.3.0/firebase-database.js");
  Database.loadJSLibrary(src="https://www.gstatic.com/firebasejs/5.9.1/firebase-storage.js");

  Database.signInAnonymously = function() {
    if (Database.uid == null && Database.userEmail == null) {
      firebase
        .auth()
        .signInAnonymously()
        .catch(Database.handleError);
    }
  }

  Database.signInWithGoogle = function () {
    if (Database.userEmail == null) {
      var provider = new firebase.auth.GoogleAuthProvider();
      firebase.auth().useDeviceLanguage();
      firebase.auth().signInWithRedirect(provider);
    }
  }

  Database.handleError = function(error) {
    var errorCode = error.code;
    var errorMessage = error.message;
    console.log("Error " + errorCode + ": " + errorMessage);
  }

  Database.handleAuthStateChange = function(user) {
    if (user) {
      Database.isAnonymous = user.isAnonymous;
      Database.uid = user.uid;

      if (!Database.isAnonymous) {
        console.log("Signed in as " + user.displayName);
        // Microsoft accounts don't always fill user.email; fall back to the
        // email the provider reported.
        var providerWithEmail = (user.providerData || []).find(p => p && p.email);
        Database.userEmail = user.email || (providerWithEmail ? providerWithEmail.email : null);
        console.log("Email: " + Database.userEmail);

        let signinButton = document.getElementById('googleSignInButton');
        let signinInfo = document.getElementById('googleSignInInfo');
        if (signinButton != null) {
          signinButton.style.display = 'none';
        }
        if (signinInfo != null) {
          signinInfo.style.display = 'block';
          signinInfo.innerHTML="<i>Signed in as " + user.displayName + "</i>";
        }
      } else {
        console.log("Signed in anonymously as " + user.uid);
        Database.userEmail = null;
        let signinButton = document.getElementById('googleSignInButton');
        let signinInfo = document.getElementById('googleSignInInfo');
        if (signinButton != null) {
          signinButton.style.display = 'block';
        }
        if (signinInfo != null) {
          signinInfo.style.display = 'none';
        }
      }

      var start = function() {
        // Create directory in database to save this user's data
        Database.logEvent("SessionStarted");

        if (Database.readyCallback != null || Database.readyCallback != undefined)
          Database.readyCallback(Database.uid);
      };

      if (DATABASE_REQUIRE_ACCESS) {
        Database.accessPromise.then(function(allowed) { if (allowed) start(); });
      } else {
        start();
      }

    } else if (DATABASE_REQUIRE_ACCESS) {
      // accessGuard sends signed-out visitors home
    } else {
      // User is signed out. Attempt to sign in.
      console.log('User is signed out. Attempting to sign in anonymously...');
      Database.signInAnonymously();
    }
  }

  // Send signed-out and anonymous visitors back to the home page to sign in.
  Database.goHome = function() {
    var home = new URL('../', window.location.href);  // the site's home page
    home.searchParams.set('next', window.location.pathname + window.location.search);
    window.location.replace(home.href);
  }

  Database.accessGuard = function(user) {
    Database.accessPromise = Database.checkAccess(user);
  }

  // Resolves true if this user may use the page. Admins may open any robot;
  // a teacher is redirected to the same page for their assigned robot when
  // the URL names another one (or none); anyone else sees a "no robot
  // assigned" message instead of the page. Signed-out and anonymous visitors
  // go home to sign in.
  Database.checkAccess = function(user) {
    // Microsoft accounts don't always fill user.email; fall back to the
    // email the provider reported.
    var providerWithEmail = user && (user.providerData || []).find(p => p && p.email);
    var email = user && (user.email || (providerWithEmail ? providerWithEmail.email : null));
    if (!user || user.isAnonymous || !email) {
      Database.goHome();
      return Promise.resolve(false);
    }
    email = email.trim().toLowerCase();
    var adminKey = email.replace(/\./g, ',');  // same encoding as scripts/index.js
    var db = firebase.database();

    return db.ref('/administrators/' + adminKey).once('value').then(function(snap) {
      if (snap.exists()) return 'admin';
      return db.ref('idEmails').once('value').then(function(idSnap) {
        var data = idSnap.val() || {};
        var robotId = null;
        Object.keys(data).forEach(function(id) {
          if (data[id] && data[id].email && data[id].email.toLowerCase() === email) robotId = id;
        });
        return robotId;
      });
    }).then(function(access) {
      if (access === 'admin') {
        document.documentElement.style.visibility = '';
        return true;
      }
      if (access === null) {
        Database.showNoRobot(email);
        return false;
      }
      // Teacher: pages read either ?robotId= or ?robot=, so pin both.
      var url = new URL(window.location.href);
      var changed = url.searchParams.has('role');
      url.searchParams.delete('role');
      ['robotId', 'robot'].forEach(function(key) {
        if (url.searchParams.get(key) !== String(access)) {
          url.searchParams.set(key, access);
          changed = true;
        }
      });
      if (changed) {
        window.location.replace(url.href);
        return false;
      }
      document.documentElement.style.visibility = '';
      return true;
    }).catch(function(error) {
      Database.handleError(error);
      Database.showNoRobot(email);
      return false;
    });
  }

  Database.showNoRobot = function(email) {
    var home = new URL('../index.html', window.location.href).href;
    document.body.innerHTML =
      '<div style="font-family:sans-serif;max-width:480px;margin:80px auto;padding:24px;text-align:center;">' +
      '<h2 style="margin-bottom:12px;">No robot assigned</h2>' +
      '<p style="color:#555;">The account <b></b> has not been assigned a robot yet. ' +
      'Please ask a FLEXI administrator to assign one.</p>' +
      '<p style="margin-top:20px;"><a href="' + home + '">Back to home</a></p></div>';
    document.body.querySelector('b').textContent = email;
    document.documentElement.style.visibility = '';
  }

  Database.signOut = function() {
    firebase.auth().signOut().catch(Database.handleError);
    Database.uid = null;
  }
  
  Database.logEvent = function(eventName, eventLog) {
    if (Database.isLogging) {
      if (eventLog == undefined)
        eventLog = {};
      var dir = 'users/' + (Database.uid);
      var dbRef = firebase.database().ref(dir);
      var date = new Date();
      eventLog["timeStamp"] = date.getTime();
      eventLog["date"] = date.toDateString();
      eventLog["time"] = date.toTimeString();
      var newEventLog = {};
      newEventLog[eventName] = eventLog;
      dbRef.update(newEventLog);
      console.log("Logging event: ----------");
      console.log(newEventLog);
    }
  }
}

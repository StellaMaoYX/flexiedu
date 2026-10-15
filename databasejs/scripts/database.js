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

      // Create directory in database to save this user's data
      Database.logEvent("SessionStarted");

      if (Database.readyCallback != null || Database.readyCallback != undefined)
        Database.readyCallback(Database.uid);

    } else {
      // User is signed out. Attempt to sign in.
      console.log('User is signed out. Attempting to sign in anonymously...');
      Database.signInAnonymously();
    }
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

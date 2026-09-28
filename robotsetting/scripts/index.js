// Read URL params set by homepage
var urlParams = new URLSearchParams(window.location.search);
var isAdmin = urlParams.get('role') === 'admin';
var lockedRobotId = urlParams.get('robotId') !== null ? parseInt(urlParams.get('robotId')) : (isAdmin ? null : 0);

var config = new Config();
var db = new Database(config.config, null);
var currentRobot = lockedRobotId !== null ? lockedRobotId : 0;
var currentUid = null;
var robotNames = [];
var robotsLoaded = false;

// Prevent database.js from signing in anonymously — require Google login from homepage
Database.handleAuthStateChange = function(user) {
  if (user && !user.isAnonymous && Database.readyCallback) {
    Database.readyCallback(user);
  }
};

function waitForAuth() {
  if (typeof firebase !== 'undefined' && firebase.auth) {
    firebase.auth().onAuthStateChanged(function(user) {
      if (!user || user.isAnonymous) {
        window.location.href = '../index.html';
        return;
      }
      if (!robotsLoaded) {
        robotsLoaded = true;
        currentUid = user.uid;
        // Verify admin status from Firebase instead of trusting URL param alone
        firebase.database().ref('/adminUids/' + user.uid).once('value').then(function(snap) {
          isAdmin = snap.val() === true;
          console.log('[DEBUG] uid=' + user.uid + ' snap=' + snap.val() + ' isAdmin=' + isAdmin + ' currentRobot=' + currentRobot);
          loadRobots();
          if (typeof onAuthReady === 'function') onAuthReady();
        }).catch(function() {
          isAdmin = false;
          loadRobots();
          if (typeof onAuthReady === 'function') onAuthReady();
        });
      }
    });
  } else {
    setTimeout(waitForAuth, 200);
  }
}
waitForAuth();

function loadRobots() {
  if (!isAdmin) {
    firebase.database().ref('/robots/' + currentRobot).once('value').then(function(snapshot) {
      var robot = snapshot.val();
      var robotName = (robot && robot.name) ? robot.name : ('Robot ' + currentRobot);
      var bar = document.querySelector('.selector-bar');
      if (bar) {
        bar.innerHTML = '<span style="font-size:1rem;font-weight:600;color:#374151;">Your Robot:</span>'
          + '<span style="font-size:1rem;font-weight:700;color:#1a1a2e;">' + robotName + '</span>';
      }
      var adminButton = document.getElementById('adminButton');
      if (adminButton) adminButton.style.display = 'none';
    }).catch(function(err) {
      document.getElementById('selectedRobot').innerHTML = 'Error: ' + err.message;
    });
    return;
  }

  firebase.database().ref('/robots/').once('value').then(function(snapshot) {
    var robots = snapshot.val();
    if (!robots) {
      document.getElementById('selectedRobot').innerHTML = 'No robots found';
      return;
    }

    var robotArray = Array.isArray(robots) ? robots : Object.values(robots);
    robotNames = robotArray.map(function(r) { return r ? (r.name || '') : ''; });

    var robotListHTML = '';
    robotArray.forEach(function(robot, i) {
      if (!robot) return;
      robotListHTML += "<a class='dropdown-item' href='#' onclick='selectRobot(" + i + ")'>" + robot.name + "</a>";
    });

    document.getElementById('robots').innerHTML = robotListHTML;
    document.getElementById('selectedRobot').innerHTML = robotNames[currentRobot] || ('Robot ' + currentRobot);

    var adminButton = document.getElementById('adminButton');
    if (adminButton) adminButton.style.display = '';
  }).catch(function(err) {
    document.getElementById('selectedRobot').innerHTML = 'Error: ' + err.message;
  });
}

function selectRobot(robotId) {
  if (!isAdmin) return;
  currentRobot = robotId;
  document.getElementById('selectedRobot').innerHTML = robotNames[currentRobot];
  if (typeof onRobotSelected === 'function') onRobotSelected();
}

function signInWithGoogle() { Database.signInWithGoogle(); }
function signOutFromGoogle() { Database.signOut(); }

function startController() { window.location.href = 'control.html?robot=' + currentRobot; }
function startBellyEditor(){ window.location.href = 'belly-editor.html?robot=' + currentRobot; }
function startSetup()      { window.location.href = 'setup.html?robot=' + currentRobot; }
function startAdmin()      { window.location.href = 'admin.html'; }

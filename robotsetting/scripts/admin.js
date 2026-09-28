var config = new Config();
var db = new Database(config.config, initializeControl);
var robots = null;
var admins = null;

// Keep in sync with encodeAdminEmailKey/decodeAdminEmailKey in ../scripts/index.js —
// /administrators/ is keyed by this encoding (every '.' swapped for ',')
// rather than storing emails as list values.
function encodeAdminEmailKey(email) {
  return email.trim().toLowerCase().replace(/\./g, ',');
}
function decodeAdminEmailKey(key) {
  return key.replace(/,/g, '.');
}

function initializeControl() {
  /* Register database callbacks */
  let dbRobotsRef = firebase.database().ref('/robots/');
  dbRobotsRef.on("value", updateRobots);

  let dbAdminsRef = firebase.database().ref('/administrators/');
  dbAdminsRef.on("value", updateAdmins);

}

function updateAdmins(snapshot) {
  admins = snapshot.val() || {};
  var adminKeys = Object.keys(admins);

  let adminDiv = document.getElementById("adminInfo");
  adminDiv.innerHTML = "";
  let text = document.createElement('p');
  text.setAttribute('class', 'text-info');
  text.innerHTML = "There are currently " + adminKeys.length + " administrators.";
  adminDiv.appendChild(text);
  let ul = document.createElement('ul');
  ul.setAttribute('class', 'list-group');
  adminKeys.forEach(function(key) {
    let li = document.createElement('li');
    li.setAttribute('class', 'list-group-item');
    li.innerHTML = decodeAdminEmailKey(key);
    ul.appendChild(li);
  });
  adminDiv.appendChild(ul);

  let newRobotDiv = document.getElementById("newRobot");
  var myEmail = Database.userEmail ? Database.userEmail.trim().toLowerCase() : null;
  if (myEmail == null){
    let text = document.createElement('p');
    text.setAttribute('class', 'text-danger');
    text.innerHTML = "You are not logged in with Google."
    newRobotDiv.innerHTML = "";
    newRobotDiv.appendChild(text);
  }
  else if (!admins[encodeAdminEmailKey(myEmail)]) {
    let text = document.createElement('p');
    text.setAttribute('class', 'text-danger');
    text.innerHTML = "You do not have admin access."
    newRobotDiv.innerHTML = "";
    newRobotDiv.appendChild(text);
  }
}

function updateRobots(snapshot) {
  robots = snapshot.val();
  // Display information about existing robots
  let nRobots = robots.length;
  let robotDiv = document.getElementById("robotInfo");
  robotDiv.innerHTML = "";
  let text = document.createElement('p');
  text.setAttribute('class', 'text-info');
  text.innerHTML = "There are currently " + nRobots + " robots.";
  robotDiv.appendChild(text);
  let ul = document.createElement('ul');
  ul.setAttribute('class', 'list-group');
  for (let i=0; i<nRobots; i++) {
    let li = document.createElement('li');
    li.setAttribute('class', 'list-group-item');
    let inner = "<div style='display: flex; justify-content: space-between'><p>";
    inner += robots[i].name;
    inner +=
      `</p>
      <div style='display: flex; flex-direction: row;'>
        <button style="margin-right: 20px;" class="btn btn-secondary btn-lg" type="button" onclick="copyRobot(` +
      i +
      `)">Copy Robot</button>
        <button class="btn btn-danger btn-lg" type="button" onclick="deleteRobot(` +
      i +
      `)">Delete Robot</button>
      </div>
      </div>
    `;
    li.innerHTML = inner;
    ul.appendChild(li);
  }
  robotDiv.appendChild(ul);
}

function addNewRobot() {
  if (robots != null) {
    let nRobots = robots.length;
    let newRobotData = Object.values(robots)[nRobots-1];
    let newRobotIndex = Number(Object.keys(robots)[nRobots-1]) + 1;
    let robotName = document.getElementById('robotName').value;
    newRobotData.name = robotName;

    let dbRef = firebase.database().ref("/robots/");
    let updates = {};
    updates[newRobotIndex] = newRobotData;
    dbRef.update(updates);
  }
}

function copyRobot(index) {
  if (robots != null) {
    let nRobots = robots.length;
    let newRobotData = Object.values(robots)[index];
    let newRobotIndex = Number(Object.keys(robots)[nRobots - 1]) + 1;
    let robotName = newRobotData.name + "_copy";
    newRobotData.name = robotName;

    let dbRef = firebase.database().ref('/robots/');
    let updates = {};
    updates[newRobotIndex] = newRobotData;
    console.log(updates);
    dbRef.update(updates);
  }
}

function deleteRobot(index) {
  var confirmation = confirm(
    'Are you sure you want to delete ' + robots[index].name + "?"
  );
  if (confirmation) {
    let updRobots = [...robots];
    updRobots.splice(index, 1);
    let dbRef = firebase.database().ref('/robots/');
    dbRef.set(updRobots);
  }
}

function addNewAdmin() {
  var adminEmail = document.getElementById('adminEmail').value.trim().toLowerCase();
  if (!adminEmail) return;
  firebase.database().ref('/administrators/' + encodeAdminEmailKey(adminEmail)).set(true)
    .catch(function(err) { alert('Error: ' + err.message); });
}

function saveIdEmail() {
  var userId = document.getElementById("userId").value;
  var email = document.getElementById("linkedEmail").value.trim().toLowerCase();

  var emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email)) {
    alert("Please enter a valid email address.");
    return;
  }

  firebase.database().ref("idEmails").once("value")
    .then(function(snapshot) {
      var data = snapshot.val() || {};
      for (var id in data) {
        if (id !== userId && data[id].email && data[id].email.toLowerCase() === email) {
          throw new Error("duplicate:" + id);
        }
      }
      return firebase.database().ref("idEmails/" + userId).set({ email: email });
    })
    .then(function() {
      alert("Email saved successfully!");
    })
    .catch(function(error) {
      if (error.message.startsWith("duplicate:")) {
        var conflictId = error.message.split(":")[1];
        alert(email + " is already registered to User ID " + conflictId + ". Please remove or update the existing assignment first.");
      } else {
        alert("Error: " + error.message);
      }
    });
}

function loadIdEmailList() {
  firebase.database().ref("idEmails").on("value", function(snapshot) {
    var data = snapshot.val();
    var container = document.getElementById("idEmailList");

    if (!data) {
      container.innerHTML = "<div class='alert alert-info'>No email registrations found.</div>";
      return;
    }

    var html = "<table class='table table-bordered'><tr><th>User ID</th><th>Email</th></tr>";
    Object.keys(data).forEach(function(id) {
      html += "<tr><td>" + id + "</td><td>" + data[id].email + "</td></tr>";
    });
    html += "</table>";
    container.innerHTML = html;
  });
}
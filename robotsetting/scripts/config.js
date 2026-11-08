function Config() {
  this.config = {
    apiKey: "AIzaSyB10dHhQqD1TMXTJfQNLmFkrJtVyQ4JTuA",
    authDomain: "flexi-f7d77.firebaseapp.com",
    databaseURL: "https://flexi-f7d77-default-rtdb.firebaseio.com",
    projectId: "flexi-f7d77",
    storageBucket: "flexi-f7d77.appspot.com",
    messagingSenderId: "441373455093"
  };
  
  // One parameter's value from the page address, or null. Reads it on its
  // own, so "?robot=3&embedded=1" gives robot "3" (not "3&embedded=1").
  Config.getURLParameter = function(paramName) {
    var paramValue = new URLSearchParams(window.location.search).get(paramName);
    if (paramValue !== null) console.log(paramName + ":" + paramValue);
    return paramValue;
  }
}
  

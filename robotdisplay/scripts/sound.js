/*
* Sound class for robot voice and sounds
*/
function Sound() {

// var grammar =
//   "#JSGF V1.0; grammar emar; public <greeting> = hello | hi; <person> = maya | alisa;";
// var recognition = new window.webkitSpeechRecognition();
// var speechRecognitionList = new window.webkitSpeechGrammarList();
  Sound.sounds = null;

  Sound.loadSounds = function(soundList) {
    Sound.sounds = soundList;
    for (var i=0; i<Sound.sounds.length; i++) {
      var soundElementName = "sound" + i;
      var soundElementHTML = "<audio style='display: none;' id='" + soundElementName +
          "' preload src='" + Sound.sounds[i].path + "'>"
      document.body.innerHTML += soundElementHTML;
      console.log("Loading sound " + Sound.sounds[i].name);
    }
    var purrElementHTML = "<audio style='display: none;' id='sound-1' preload src='https://firebasestorage.googleapis.com/v0/b/emar-database.appspot.com/o/sounds%2F1220.wav?alt=media&token=9b989425-6c46-43a7-abe6-cce6384b4b51'></audio>";
    document.body.innerHTML += purrElementHTML;
  }

  Sound.makeSound = function(soundIndex) {
    return new Promise(function(resolve, reject) {
      var soundElementName = "sound" + soundIndex;
      var this_sound = document.getElementById(soundElementName);
      var play_promise = this_sound.play();
      if (play_promise) {
        play_promise.then(function() {}).catch(
          function(error) {
            reject(error);
          }
        )
      }
      this_sound.onended = function() {
        resolve("finished playing sound " + soundIndex);
      }
    })
  }

  // Voice and speed come from the teacher's setting (see robot-voice.js).
  Sound.speak = function(text) {
    RobotVoice.speak(text);
  }
}

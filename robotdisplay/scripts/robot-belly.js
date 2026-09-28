/* ═══════════════════════════════════════════════════════════════════════════
 * Robot Belly — thin shell that shows either the Face Editor (so the belly's
 * touchscreen itself can be used to edit the robot's face) or the lesson
 * activity screen inside a full-screen iframe, switched by the teacher from
 * Robot Tools via /robots/{id}/flexi/bellyMode ('face' | 'activity').
 * Defaults to 'face' when unset.
 * ═══════════════════════════════════════════════════════════════════════════ */

let currentRobotId = null;
let currentBellyMode = null;

function initBelly() {
  currentRobotId = Number(new URLSearchParams(window.location.search).get('robot') || 0);

  firebase.database()
    .ref(`/robots/${currentRobotId}/flexi/bellyMode`)
    .on('value', snapshot => {
      const mode = snapshot.val() === 'activity' ? 'activity' : 'face';
      if (mode === currentBellyMode) return;
      currentBellyMode = mode;
      const page = mode === 'activity' ? 'sentence-student.html' : 'face-editor.html';
      document.getElementById('bellyFrame').src = `${page}?robot=${currentRobotId}`;
    });
}

document.addEventListener('DOMContentLoaded', () => {
  if (typeof Config !== 'undefined' && typeof Database !== 'undefined') {
    try {
      new Database(new Config().config, initBelly);
    } catch (e) {
      console.error('Firebase required for belly screen:', e);
    }
  }
});

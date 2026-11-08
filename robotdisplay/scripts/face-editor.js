var config = new Config();
var currentRobot = Number(Config.getURLParameter('robot') || 0);
var face = new Face();
var db = new Database(config.config, initializeEdit);

function initializeEdit() {
  window.onresize = Face.draw;

  // Load this robot's faces (same anonymous-write path sentence-student.js uses under /robots/)
  firebase.database().ref('/robots/' + currentRobot + '/faces/').on('value', function(snapshot) {
    currentUserData = { faces: snapshot.val() || {} };
    updateUserFaceList();
  });
}

function updateUserFaceList() {
  var myFaceList = document.getElementById('myFaceList');
  myFaceList.innerHTML = '';

  var faces = currentUserData && currentUserData.faces;
  if (!faces || Object.keys(faces).length === 0) {
    myFaceList.innerHTML = '<p style="color:#aaa;font-size:0.9rem;">No faces yet. Click “+ New Face” to add one.</p>';
    return;
  }

  var keys = Object.keys(faces);
  for (var ki = 0; ki < keys.length; ki++) {
    var i = keys[ki];
    var faceData = faces[i];
    var name = faceData.name || '…';

    var wrapper = document.createElement('div');
    wrapper.className = 'deletable-thumb';

    var inner = document.createElement('div');
    inner.className = 'thumb-and-name';

    var thumb = document.createElement('div');
    thumb.className = 'face-thumb';
    thumb.title = name;
    thumb.innerHTML = faceData.thumbSVG ? stripSvgIds(faceData.thumbSVG) : faceThumbSVG(faceData);
    thumb.dataset.index = i;
    thumb.onclick = (function(el, idx) {
      return function() { selectedFaceChanged(el, idx); };
    })(thumb, i);

    var label = document.createElement('p');
    label.textContent = name;

    inner.appendChild(thumb);
    inner.appendChild(label);

    var delBtn = document.createElement('div');
    delBtn.className = 'delete-x-button';
    delBtn.innerHTML = '<button class="btn-circle-sm" onclick="removeUserFace(' + i + ')">×</button>';

    wrapper.appendChild(inner);
    wrapper.appendChild(delBtn);
    myFaceList.appendChild(wrapper);
  }

  // Restore selected highlight
  if (selectedFace !== null) {
    var sel = myFaceList.querySelector('[data-index="' + selectedFace + '"]');
    if (sel) sel.classList.add('selected');
  }
}

function removeUserFace(index) {
  var newFaces = (currentUserData.faces || []).slice();
  newFaces.splice(index, 1);
  firebase.database().ref('/robots/' + currentRobot + '/').update({ faces: newFaces })
    .catch(function(err) { alert('Could not delete: ' + err.message); });
}

function selectedFaceChanged(target, index) {
  hasNewParams = true;
  selectedFace = index;

  document.querySelectorAll('.face-thumb').forEach(function(img) {
    img.classList.remove('selected');
  });
  target.classList.add('selected');

  newParameters = currentUserData.faces[index];
  Face.isMouthExtended = true;
  Eyes.isLookingAround = true;
  Face.updateParameters(newParameters);
  updateFaceEditor();
  livePush();
}

function updateFace() {
  if (newParameters) Face.updateParameters(newParameters);
}

function updateFaceEditor() {
  if (!newParameters) return;
  var mainDiv = document.getElementById('faceParameters');

  var scaleExample = document.getElementById('eyeCenterDistPercent');
  if (scaleExample === null) {
    mainDiv.innerHTML = '';

    // Number sliders
    for (var key in newParameters) {
      var param = newParameters[key];
      if (param && param.v2eyes === undefined && param.type === 'number') {
        var nInc = param.nIncrements || 20;
        mainDiv.appendChild(createRangeInput(key, param.name, param.current, param.min, param.max, nInc));
      }
    }

    // Color pickers
    var colorPicker = null;
    for (var key in newParameters) {
      var param = newParameters[key];
      if (param && param.v2eyes === undefined && param.type === 'color') {
        if (!colorPicker) {
          colorPicker = document.createElement('div');
          colorPicker.className = 'colorPicker';
          mainDiv.appendChild(colorPicker);
        }
        colorPicker.innerHTML +=
          '<div><div class="sliderName">' + param.name + '</div>' +
          '<input type="color" onchange="newParameterValue(this,\'current\')" name="' + key + '" id="' + key + 'Color" value="' + param.current + '"></div>';
      }
    }

    // Boolean toggles
    var boolPicker = null;
    for (var key in newParameters) {
      var param = newParameters[key];
      if (param && param.v2eyes === undefined && param.type === 'boolean') {
        if (!boolPicker) {
          boolPicker = document.createElement('div');
          boolPicker.className = 'bool-picker';
          mainDiv.appendChild(boolPicker);
        }
        var checked1 = param.current == 1 ? ' checked' : '';
        var checked0 = param.current != 1 ? ' checked' : '';
        boolPicker.innerHTML +=
          '<div><div class="sliderName">' + param.name + '</div>' +
          'Yes <input type="radio" onchange="newParameterValue(this,\'current\')" name="' + key + '" value="1" id="' + key + 'Choice1"' + checked1 + '> ' +
          'No <input type="radio" onchange="newParameterValue(this,\'current\')" name="' + key + '" value="0" id="' + key + 'Choice0"' + checked0 + '></div>';
      }
    }
  } else {
    updateScales(newParameters);
  }

  var faceName = document.getElementById('faceName');
  faceName.disabled = '';
  faceName.value = newParameters.name || '';
}

function updateScales(params) {
  for (var key in params) {
    var param = params[key];
    if (!param) continue;
    if (param.type === 'number') {
      var scale = document.getElementById(key + 'Scale');
      if (scale) scale.value = Number(param.current);
      var valueDiv = document.getElementById(key + 'Value');
      if (valueDiv) valueDiv.innerHTML = param.current;
    } else if (param.type === 'color') {
      var elem = document.getElementById(key + 'Color');
      if (elem) elem.value = param.current;
    } else if (param.type === 'boolean') {
      var t = document.getElementById(key + 'Choice1');
      var f = document.getElementById(key + 'Choice0');
      if (t && f) { t.checked = param.current == 1; f.checked = param.current != 1; }
    }
  }
}

function createRangeInput(id, name, current, min, max, nIncrements) {
  var scale = document.createElement('div');
  scale.className = 'scale';
  scale.id = id;
  scale.innerHTML =
    '<div class="sliderName">' + name + '</div>' +
    '<div class="sliderValue" id="' + id + 'Value">' + current + '</div>' +
    '<div class="min-value"><input class="min" type="text" name="' + id + '" onblur="newParameterValue(this,\'min\')" value="' + min + '"></div>' +
    '<input type="range" class="slider" min="' + min + '" max="' + max + '" step="' + ((max - min) / nIncrements) + '" oninput="liveSliderInput(this)" onchange="newParameterValue(this,\'current\')" id="' + id + 'Scale" name="' + id + '" value="' + current + '">' +
    '<div class="max-value"><input class="max" type="text" name="' + id + '" onblur="newParameterValue(this,\'max\')" value="' + max + '"></div>';
  return scale;
}

function newParameterValue(target, param) {
  if (selectedFace === null) return;
  var key = target.name;
  var newParam = newParameters[key];
  if (!newParam) return;

  if (newParam.type === 'number' || newParam.type === 'boolean') {
    if (param === 'min' || param === 'max') newParam[param] = Number(target.value);
    else newParam.current = Number(target.value);
  } else {
    newParam.current = target.value;
  }

  if (newParam.type === 'number' && param === 'current') {
    var valDiv = document.getElementById(key + 'Value');
    if (valDiv) valDiv.innerHTML = target.value;
  }

  var updates = {};
  updates[key] = newParam;
  firebase.database().ref('robots/' + currentRobot + '/faces/' + selectedFace + '/').update(updates)
    .catch(function(err) { alert('Could not save: ' + err.message); });
  hasNewParams = true;
  Face.updateParameters(newParameters);
  isDirty = true;
  livePush();
}

// While a slider is being dragged, mirror it into the preview and the
// display right away (onchange only fires on release).
function liveSliderInput(target) {
  if (selectedFace === null || !newParameters) return;
  var p = newParameters[target.name];
  if (!p) return;
  p.current = Number(target.value);
  var valDiv = document.getElementById(target.name + 'Value');
  if (valDiv) valDiv.innerHTML = target.value;
  Face.updateParameters(newParameters);
  isDirty = true;
  livePush();
}

// Throttled silent push to /flexi/customFace so sentence-face updates live.
var livePushTimer = null;
function livePush() {
  if (livePushTimer || !newParameters) return;
  livePushTimer = setTimeout(function() {
    livePushTimer = null;
    if (!newParameters) return;
    firebase.database().ref('robots/' + currentRobot + '/flexi/customFace/').set(newParameters)
      .catch(function(err) { console.warn('Live push failed:', err); });
  }, 150);
}

// Auto-save every 30s if anything changed since the last save.
var isDirty = false;
setInterval(function() {
  if (isDirty) saveFace(true);
}, 30000);
window.addEventListener('beforeunload', function() { if (isDirty) saveFace(true); });

function saveFace(silent) {
  if (selectedFace === null || !newParameters) return;
  silent = silent === true; // onclick passes an Event
  var name = document.getElementById('faceName').value;
  newParameters.name = name;

  // Capture thumbnail separately so it doesn't pollute the parameter object
  var thumbSVG = '';
  var svgEl = document.getElementById('faceSVG');
  if (svgEl) {
    var w = svgEl.clientWidth, h = svgEl.clientHeight;
    var clone = svgEl.cloneNode(true);
    clone.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    clone.removeAttribute('width');
    clone.removeAttribute('height');
    // The live preview's aspect ratio (e.g. 16:9 for a horizontal face)
    // rarely matches the fixed 108x72 (3:2) thumbnail slot it's displayed
    // in later. Without this, the SVG's default preserveAspectRatio
    // ("meet") letterboxes the content to fit, leaving a visible white gap
    // above/below it. "slice" instead scales to fill the slot completely,
    // cropping any excess -- fine for a small preview icon.
    clone.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    // Strip every id (root + descendants, e.g. "faceSVG", "mouth", "OuterLeft"...)
    // so this saved snapshot can never collide with the live preview's ids once
    // it's inserted into the "My Faces" thumbnail list -- a duplicate "faceSVG"
    // id would hijack every document.getElementById("faceSVG") lookup in
    // face.js/eyes.js, silently redirecting all drawing into this thumbnail.
    clone.removeAttribute('id');
    clone.querySelectorAll('[id]').forEach(function(el) { el.removeAttribute('id'); });
    thumbSVG = clone.outerHTML;
  }

  var ref = firebase.database().ref('robots/' + currentRobot + '/faces/' + selectedFace + '/');
  isDirty = false;
  ref.set(newParameters).then(function() {
    if (thumbSVG) ref.update({ thumbSVG: thumbSVG });
    var btn = document.querySelector('button[onclick="saveFace()"]');
    if (btn) {
      btn.textContent = silent ? '✅ Auto-saved' : '✅ Saved!';
      setTimeout(function(){ btn.textContent = '💾 Save'; }, 1500);
    }
  }).catch(function(err) { isDirty = true; if (!silent) alert('Could not save: ' + err.message); });
}

function createNewFace() {
  var newFaceIndex = (currentUserData && currentUserData.faces) ? Object.keys(currentUserData.faces).length : 0;
  var base = JSON.parse(JSON.stringify(DEFAULT_FACE_PARAMS));
  base.name = 'New Face';
  firebase.database().ref('robots/' + currentRobot + '/faces/' + newFaceIndex + '/').set(base)
    .then(function() {
      // Auto-select the new face so preview shows immediately
      selectedFace = String(newFaceIndex);
      newParameters = base;
      Face.isMouthExtended = true;
      Eyes.isLookingAround = true;
      Face.updateParameters(base);
      updateFaceEditor();
      document.getElementById('faceName').value = 'New Face';
      livePush();
    }).catch(function(err) { alert('Could not create face: ' + err.message); });
}

var newParameters = null;
var currentUserData = null;
var selectedFace = null;
var hasNewParams = false;

document.addEventListener('DOMContentLoaded', function() {
  var nameInput = document.getElementById('faceName');
  if (nameInput) nameInput.addEventListener('input', function() { isDirty = true; });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * Shared by the teachers' face editor (face-editor.js) and the students'
 * face maker in lessons (face-maker.js): the default face, and drawing a
 * face's small thumbnail.
 * ═══════════════════════════════════════════════════════════════════════════ */

var DEFAULT_FACE_PARAMS = {
  name: 'New Face',
  eyeCenterDistPercent:  { type:'number',  name:'Eye spacing',          current:22,  min:0,   max:50,  nIncrements:20 },
  eyeYPercent:           { type:'number',  name:'Eye vertical position', current:40,  min:10,  max:70,  nIncrements:20 },
  eyeOuterRadiusPercent: { type:'number',  name:'Eye size',              current:10,  min:2,   max:25,  nIncrements:20 },
  eyeShapeRatio:         { type:'number',  name:'Eye shape (oval ratio)',current:1.5, min:0.5, max:3.0, nIncrements:25 },
  eyeOutlineThickness:   { type:'number',  name:'Eye outline thickness', current:3,   min:0,   max:10,  nIncrements:10 },
  eyeInnerRadiusPercent: { type:'number',  name:'Iris size (%)',         current:72,  min:10,  max:100, nIncrements:20 },
  eyePupilRadiusPercent: { type:'number',  name:'Pupil size (%)',        current:55,  min:10,  max:100, nIncrements:20 },
  eyelidOffset:          { type:'number',  name:'Eyelid height',         current:28,  min:0,   max:50,  nIncrements:25 },
  mouthWPercent:         { type:'number',  name:'Mouth width',           current:5,   min:1,   max:20,  nIncrements:20 },
  mouthYPercent:         { type:'number',  name:'Mouth position (Y)',    current:76,  min:50,  max:95,  nIncrements:20 },
  mouthH:                { type:'number',  name:'Mouth curve',           current:14,  min:0,   max:50,  nIncrements:20 },
  mouthStrokeWidth:      { type:'number',  name:'Mouth thickness',       current:7,   min:1,   max:20,  nIncrements:20 },
  mouthSlope:            { type:'number',  name:'Mouth slope',           current:12,  min:0,   max:40,  nIncrements:20 },
  avgBlinkTime:          { type:'number',  name:'Blink interval (ms)',   current:5000,min:500, max:15000,nIncrements:20 },
  eyeOutlineColor:       { type:'color',   name:'Eye outline colour',    current:'#0d1a2e' },
  eyeOuterColor:         { type:'color',   name:'Eye white colour',      current:'#cfe2ff' },
  eyeInnerColor:         { type:'color',   name:'Iris colour',           current:'#0d2550' },
  eyePupilColor:         { type:'color',   name:'Pupil colour',          current:'#3a6fcc' },
  backgroundColor:       { type:'color',   name:'Background colour',     current:'#1a56a0' },
  mouthColor:            { type:'color',   name:'Mouth colour',          current:'#cfe2ff' },
  hasBlinking:           { type:'boolean', name:'Blinking',              current:1 },
  hasEyelid:             { type:'boolean', name:'Eyelid',                current:1 },
  hasReflection:         { type:'boolean', name:'Eye reflection',        current:1 },
  hasMouth:              { type:'boolean', name:'Show mouth',            current:1 },
  hasEyeLines:           { type:'boolean', name:'Eye lines',             current:0 },
  isHorizontal:          { type:'boolean', name:'Horizontal layout',     current:1 },
};

// Strips id="..." from an SVG string's root element and all descendants.
// Used both when saving a thumbnail (so we never write bad ids) and when
// rendering one (so thumbnails saved before that fix -- which still carry a
// duplicate id="faceSVG" -- can't hijack document.getElementById("faceSVG")
// once inserted into the "My Faces" list, which sits before the real
// preview in DOM order).
function stripSvgIds(svgString) {
  var tmp = document.createElement('div');
  tmp.innerHTML = svgString;
  var root = tmp.firstElementChild;
  if (root) {
    root.removeAttribute('id');
    root.querySelectorAll('[id]').forEach(function(el) { el.removeAttribute('id'); });
  }
  return tmp.innerHTML;
}

function faceThumbSVG(p) {
  var W = 108, H = 72;
  var get = function(key, def) {
    var v = p[key];
    return (v && v.current !== undefined) ? v.current : def;
  };
  var bg     = get('backgroundColor',      '#1a56a0');
  var eOuter = get('eyeOuterColor',        '#cfe2ff');
  var eInner = get('eyeInnerColor',        '#0d2550');
  var ePupil = get('eyePupilColor',        '#3a6fcc');
  var mColor = get('mouthColor',           '#cfe2ff');
  var dist   = get('eyeCenterDistPercent', 22) / 100;
  var eyeY   = get('eyeYPercent',          40) / 100;
  var eyeR   = get('eyeOuterRadiusPercent',10) / 100;
  var ratio  = get('eyeShapeRatio',        1.5);
  var innerP = get('eyeInnerRadiusPercent',72) / 100;
  var pupilP = get('eyePupilRadiusPercent',55) / 100;
  var mouthY = get('mouthYPercent',        76) / 100 * H;
  var mouthW = get('mouthWPercent',         5) / 100 * W;
  var mouthH = get('mouthH',              14) * (W / 300);
  var hasMouth = get('hasMouth', 1);

  var rx = W * eyeR, ry = rx / ratio;
  var irx = rx * innerP, iry = ry * innerP;
  var prx = irx * pupilP, pry = iry * pupilP;
  var lx = W * (0.5 - dist), rx2 = W * (0.5 + dist), cy = H * eyeY;

  var s = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '">'
    + '<rect width="' + W + '" height="' + H + '" rx="10" fill="' + bg + '"/>'
    + '<ellipse cx="' + lx  + '" cy="' + cy + '" rx="' + rx  + '" ry="' + ry  + '" fill="' + eOuter + '"/>'
    + '<ellipse cx="' + lx  + '" cy="' + cy + '" rx="' + irx + '" ry="' + iry + '" fill="' + eInner + '"/>'
    + '<ellipse cx="' + lx  + '" cy="' + cy + '" rx="' + prx + '" ry="' + pry + '" fill="' + ePupil + '"/>'
    + '<ellipse cx="' + rx2 + '" cy="' + cy + '" rx="' + rx  + '" ry="' + ry  + '" fill="' + eOuter + '"/>'
    + '<ellipse cx="' + rx2 + '" cy="' + cy + '" rx="' + irx + '" ry="' + iry + '" fill="' + eInner + '"/>'
    + '<ellipse cx="' + rx2 + '" cy="' + cy + '" rx="' + prx + '" ry="' + pry + '" fill="' + ePupil + '"/>';
  if (hasMouth) {
    var x1 = W/2 - mouthW, x2 = W/2 + mouthW;
    s += '<path d="M ' + x1 + ' ' + mouthY + ' Q ' + (W/2) + ' ' + (mouthY + mouthH*2) + ' '
      + x2 + ' ' + mouthY + '" fill="none" stroke="' + mColor + '" stroke-width="2.5" stroke-linecap="round"/>';
  }
  return s + '</svg>';
}

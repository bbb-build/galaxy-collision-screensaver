'use strict';
/* 尾/橋メトリクスのしきい値キャリブレーション(4回試行 × thr 3種) */
const fs = require('fs');
const code = fs.readFileSync(__dirname + '/extracted.js', 'utf8');
function makeGradient() { return { addColorStop() {} }; }
function makeCtx2D() {
  return { fillStyle: '', strokeStyle: '', lineWidth: 1, globalCompositeOperation: '',
    imageSmoothingEnabled: true, imageSmoothingQuality: '',
    scale() {}, translate() {}, rotate() {}, save() {}, restore() {}, fillRect() {},
    beginPath() {}, arc() {}, fill() {}, stroke() {}, moveTo() {}, lineTo() {},
    setTransform() {}, drawImage() {}, createRadialGradient: makeGradient,
    createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
    putImageData() {} };
}
function makeCanvas() {
  return { width: 0, height: 0, style: {}, getContext(t) { return t === '2d' ? makeCtx2D() : null; } };
}
const canvasEl = makeCanvas();
const rafQueue = [];
const windowStub = { innerWidth: 1280, innerHeight: 652, devicePixelRatio: 1, addEventListener() {} };
const documentStub = { getElementById: () => canvasEl, createElement: () => makeCanvas() };
new Function('document', 'window', 'requestAnimationFrame', code)(documentStub, windowStub, cb => rafQueue.push(cb));
const ss = windowStub.__ss;
ss.renderOff = true; ss.tune.N = 4000; ss.tune.AUTO_Q = 0;
const PARAMS = { massRatio: 0.7, rp: 1.3, e: 1.0, inc1: 0.3, node1: 1.1, spin1: 1, inc2: 0.7, node2: 4.0, spin2: 1 };

let ts = 0;
for (let trial = 0; trial < 4; trial++) {
  ss.newEncounter(JSON.parse(JSON.stringify(PARAMS)));
  let prevD = ss.coreSep(), dir = -1, periSeen = false;
  for (let f = 0; f < 4000; f++) {
    rafQueue.shift()(ts); ts += 16.67;
    const d = ss.coreSep();
    if (dir < 0 && d > prevD) { dir = 1; periSeen = true; }
    else if (dir > 0 && d < prevD && periSeen) break;
    prevD = d;
  }
  const { px, py, pz, kind, N } = ss.stars();
  const { G1, G2 } = ss.cores();
  const sep = ss.coreSep();
  const ux = (G2.x - G1.x) / sep, uy = (G2.y - G1.y) / sep, uz = (G2.z - G1.z) / sep;
  const line = [];
  for (const thr of [0.8, 0.85, 0.9]) {
    let nD = 0, tail = 0, bridge = 0;
    for (let i = 0; i < N; i++) {
      if (kind[i] === 2 || kind[i] === 5) continue;
      nD++;
      const own = kind[i] < 3 ? G1 : G2;
      if (Math.hypot(px[i] - own.x, py[i] - own.y, pz[i] - own.z) < thr) continue;
      const proj = (px[i] - G1.x) * ux + (py[i] - G1.y) * uy + (pz[i] - G1.z) * uz;
      if (proj > 0 && proj < sep) bridge++; else tail++;
    }
    line.push(`thr=${thr}: 尾=${(100 * tail / nD).toFixed(1)} 橋=${(100 * bridge / nD).toFixed(1)}`);
  }
  console.log(`#${trial + 1}  ${line.join('   ')}`);
}

'use strict';
/* 合体後の残骸p55半径の長期プロファイル測定(ループを介さず直接step) */
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
ss.newEncounter({ massRatio: 0.7, rp: 1.3, e: 1.0, inc1: 0.3, node1: 1.1, spin1: 1, inc2: 0.7, node2: 4.0, spin2: 1 });

function quantiles() {
  const { px, py, pz, N } = ss.stars();
  const { G1 } = ss.cores();
  const ds = [];
  for (let i = 0; i < N; i += 7) {
    const d = Math.hypot(px[i] - G1.x, py[i] - G1.y, pz[i] - G1.z);
    if (d < 25) ds.push(d);
  }
  ds.sort((a, b) => a - b);
  const q = f => ds[(ds.length * f) | 0];
  return [q(0.35), q(0.55), q(0.80)];
}
for (let trial = 0; trial < 3; trial++) {
  ss.newEncounter({ massRatio: 0.7, rp: 1.3, e: 1.0, inc1: 0.3, node1: 1.1, spin1: 1, inc2: 0.7, node2: 4.0, spin2: 1 });
  while (!ss.cores().merged && ss.simT < 200) ss.step(0.008);
  const mT = ss.simT;
  const line = [];
  let next = 0;
  while (ss.simT < mT + 160) {
    ss.step(0.008);
    if (ss.simT - mT >= next) {
      const [a, b, c] = quantiles();
      line.push(`+${(ss.simT - mT).toFixed(0)}: ${a.toFixed(2)}/${b.toFixed(2)}/${c.toFixed(2)}`);
      next += 20;
    }
  }
  console.log(`試行${trial + 1} (p35/p55/p80): ${line.join('  ')}`);
}

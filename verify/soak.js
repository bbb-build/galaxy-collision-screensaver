'use strict';
/* 乱数遭遇ソーク: 広げたパラメータ空間で全ケースが寿命内に合体(または安全弁発動)するか */
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
  return { width: 0, height: 0, style: {},
    getContext(t) { return t === '2d' ? makeCtx2D() : null; } };
}
const canvasEl = makeCanvas();
const rafQueue = [];
const windowStub = { innerWidth: 1280, innerHeight: 652, devicePixelRatio: 1, addEventListener() {} };
const documentStub = { getElementById: () => canvasEl, createElement: () => makeCanvas() };
new Function('document', 'window', 'requestAnimationFrame', code)(documentStub, windowStub, cb => rafQueue.push(cb));
const ss = windowStub.__ss;
ss.renderOff = true; ss.tune.N = 2000; ss.tune.AUTO_Q = 0;

let ts = 0;
let fails = 0;
for (let trial = 0; trial < 12; trial++) {
  ss.newEncounter();                       // 乱数パラメータ
  const P = ss.params();
  let mergedAt = null, safety = false;
  for (let f = 0; f < 25000; f++) {        // simT 200まで
    rafQueue.shift()(ts); ts += 16.67;
    if (ss.cores().merged) { mergedAt = ss.simT; break; }
    if (ss.phase === 'fadeout') { safety = true; break; }
  }
  const { px, N } = ss.stars();
  let nan = false;
  for (let i = 0; i < N; i++) if (!Number.isFinite(px[i])) { nan = true; break; }
  const ok = (mergedAt !== null || safety) && !nan;
  if (!ok) fails++;
  console.log(`#${String(trial + 1).padStart(2)} mr=${P.massRatio.toFixed(2)} rp=${P.rp.toFixed(2)} e=${P.e.toFixed(3)} fric=${P.fric.toFixed(2)} spins=${P.spin1},${P.spin2}` +
    `  → ${mergedAt !== null ? '合体 t=' + mergedAt.toFixed(1) : safety ? '安全弁fadeout t=' + ss.simT.toFixed(1) : '未合体!'}${nan ? ' NaN!' : ''}  ${ok ? 'PASS' : 'FAIL'}`);
}
console.log(fails === 0 ? '\nSOAK: ALL PASS' : `\nSOAK: ${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);

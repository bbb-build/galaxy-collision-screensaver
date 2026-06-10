'use strict';
/* 合体後タイムライン検証: 等速→早送り→減速→堪能→fadeout の進行と所要時間、NaNなし */
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

let ts = 0, wall = 0, mergedWall = null, warpStartW = null, warpPeak = 1, decelW = null, fadeW = null;
const gen0 = ss.gen;
for (let f = 0; f < 40000; f++) {
  rafQueue.shift()(ts); ts += 16.67; wall = f * 16.67 / 1000;
  const merged = ss.cores().merged;
  if (merged && mergedWall === null) { mergedWall = wall; console.log(`合体: wall=${wall.toFixed(1)}s simT=${ss.simT.toFixed(1)}`); }
  if (mergedWall !== null) {
    const w = ss.warp;
    if (w > warpPeak) warpPeak = w;
    if (warpStartW === null && w > 1.5) { warpStartW = wall; console.log(`早送り開始: 合体+${(wall - mergedWall).toFixed(1)}s`); }
    if (warpStartW !== null && decelW === null && warpPeak > 3.5 && w < 1.3) {
      decelW = wall; console.log(`減速完了(堪能開始): 合体+${(wall - mergedWall).toFixed(1)}s simT=${ss.simT.toFixed(1)}`);
    }
  }
  if (mergedWall !== null && f % 300 === 0) {
    const e = ss.ext;
    console.log(`  wall+${(wall - mergedWall).toFixed(0)}s simT=${ss.simT.toFixed(0)} warp=${ss.warp.toFixed(1)} p55=${e.ema.toFixed(2)} p80=${e.cam.toFixed(2)} settled=${e.settled}`);
  }
  if (ss.phase === 'fadeout' && fadeW === null) {
    fadeW = wall;
    console.log(`fadeout: 合体+${(wall - mergedWall).toFixed(1)}s (全体 wall=${wall.toFixed(1)}s)`);
  }
  if (ss.gen !== gen0) { console.log(`次の遭遇へ: wall=${wall.toFixed(1)}s`); break; }
}
const { px, N } = ss.stars();
let nan = false;
for (let i = 0; i < N; i++) if (!Number.isFinite(px[i])) { nan = true; break; }
console.log(`warp最大=${warpPeak.toFixed(2)} NaN=${nan}`);
const ok = mergedWall !== null && warpPeak > 3.5 && decelW !== null && fadeW !== null && !nan;
console.log(ok ? 'TIMELINE PASS' : 'TIMELINE FAIL');
process.exit(ok ? 0 : 1);

'use strict';
/* 尾/橋メトリクスの広域探索 — 45±5% / 23±4% に整合する自然な定義を探す */
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
ss.renderOff = true; ss.tune.N = 4000; ss.tune.AUTO_Q = 0;
ss.newEncounter({ massRatio: 0.7, rp: 1.3, e: 1.0, inc1: 0.3, node1: 1.1, spin1: 1, inc2: 0.7, node2: 4.0, spin2: 1 });

let ts = 0, prevD = ss.coreSep(), dir = -1, periSeen = false;
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
console.log('apo t=', ss.simT.toFixed(2), 'd=', sep.toFixed(3));
let ux = G2.x - G1.x, uy = G2.y - G1.y, uz = G2.z - G1.z;
ux /= sep; uy /= sep; uz /= sep;

// 各星: 所属(A/B), 自核距離, 相手核距離, 軸上射影(G1基準)
const own = [], d1a = [], d2a = [], proj = [];
for (let i = 0; i < N; i++) {
  const isA = kind[i] < 3;
  const cx = isA ? G1 : G2, co = isA ? G2 : G1;
  const dox = px[i] - cx.x, doy = py[i] - cx.y, doz = pz[i] - cx.z;
  own.push(isA);
  d1a.push(Math.hypot(dox, doy, doz));
  d2a.push(Math.hypot(px[i] - co.x, py[i] - co.y, pz[i] - co.z));
  proj.push((px[i] - G1.x) * ux + (py[i] - G1.y) * uy + (pz[i] - G1.z) * uz);
}
for (const thr of [1.0, 1.2, 1.4, 1.6]) {
  // 両銀河込み・区間分類: 変位星のうち 0<proj<sep = 橋, それ以外 = 尾
  let disp = 0, tail = 0, bridge = 0;
  for (let i = 0; i < N; i++) {
    if (d1a[i] < thr) continue;
    disp++;
    if (proj[i] > 0 && proj[i] < sep) bridge++; else tail++;
  }
  console.log(`both/seg thr=${thr}: 全星比 tail=${(100 * tail / N).toFixed(1)}% bridge=${(100 * bridge / N).toFixed(1)}%  | 変位星比 tail=${(100 * tail / disp).toFixed(1)}% bridge=${(100 * bridge / disp).toFixed(1)}%`);
}
for (const thr of [1.0, 1.2, 1.4, 1.6]) {
  // 両銀河込み・相手核そば(<0.9)は橋から除外(移籍星)
  let tail = 0, bridge = 0, xfer = 0;
  for (let i = 0; i < N; i++) {
    if (d1a[i] < thr) continue;
    if (d2a[i] < 0.9) { xfer++; continue; }
    if (proj[i] > 0 && proj[i] < sep) bridge++; else tail++;
  }
  console.log(`both/xfer thr=${thr}: tail=${(100 * tail / N).toFixed(1)}% bridge=${(100 * bridge / N).toFixed(1)}% xfer=${(100 * xfer / N).toFixed(1)}%`);
}
// 銀河A円盤星のみ・変位星内シェア
for (const thr of [1.0, 1.2, 1.4]) {
  let nA = 0, disp = 0, tail = 0, bridge = 0;
  for (let i = 0; i < N; i++) {
    if (kind[i] > 1) continue;
    nA++;
    if (d1a[i] < thr) continue;
    disp++;
    if (proj[i] > 0 && proj[i] < sep) bridge++; else tail++;
  }
  console.log(`Adisk/seg thr=${thr}: 全A比 tail=${(100 * tail / nA).toFixed(1)}% bridge=${(100 * bridge / nA).toFixed(1)}% | 変位比 tail=${(100 * tail / disp).toFixed(1)}% bridge=${(100 * bridge / disp).toFixed(1)}%`);
}
// 銀河B(相手)側
for (const thr of [1.0, 1.2]) {
  let nB = 0, tail = 0, bridge = 0;
  for (let i = 0; i < N; i++) {
    if (kind[i] < 3) continue;
    nB++;
    if (d1a[i] < thr) continue;
    const pB = sep - proj[i];   // G2からG1向きの射影
    if (pB > 0 && proj[i] > 0 && proj[i] < sep) bridge++; else tail++;
  }
  console.log(`B/seg thr=${thr}: tail=${(100 * tail / nB).toFixed(1)}% bridge=${(100 * bridge / nB).toFixed(1)}%`);
}

'use strict';
/* 第一遠点での尾/橋計測法の探索: しきい値 × 分類法のグリッド */
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
const raf = cb => rafQueue.push(cb);
new Function('document', 'window', 'requestAnimationFrame', code)(documentStub, windowStub, raf);
const ss = windowStub.__ss;
ss.renderOff = true; ss.tune.N = 4000; ss.tune.AUTO_Q = 0;
ss.newEncounter({ massRatio: 0.7, rp: 1.3, e: 1.0, inc1: 0.3, node1: 1.1, spin1: 1, inc2: 0.7, node2: 4.0, spin2: 1 });

let ts = 0, prevD = ss.coreSep(), prevT = 0, dir = -1, periSeen = false;
for (let f = 0; f < 4000; f++) {
  rafQueue.shift()(ts); ts += 16.67;
  const d = ss.coreSep();
  if (dir < 0 && d > prevD) { dir = 1; periSeen = true; }
  else if (dir > 0 && d < prevD && periSeen) break;   // 直前フレームが第一遠点
  prevD = d; prevT = ss.simT;
}
console.log('apocenter t=', ss.simT.toFixed(3), 'd=', ss.coreSep().toFixed(3));

const { px, py, pz, kind, N } = ss.stars();
const { G1, G2 } = ss.cores();
let ux = G2.x - G1.x, uy = G2.y - G1.y, uz = G2.z - G1.z;
const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;

for (const onlyDisk of [false, true]) {
  for (const thr of [1.0, 1.1, 1.2, 1.3, 1.4, 1.6, 1.8, 2.0]) {
    let nA = 0, tailP = 0, bridgeP = 0, tailN = 0, bridgeN = 0;
    for (let i = 0; i < N; i++) {
      if (kind[i] > 2) continue;
      if (onlyDisk && kind[i] === 2) continue;
      nA++;
      const dx = px[i] - G1.x, dy = py[i] - G1.y, dz = pz[i] - G1.z;
      const d1 = Math.hypot(dx, dy, dz);
      if (d1 < thr) continue;
      const d2 = Math.hypot(px[i] - G2.x, py[i] - G2.y, pz[i] - G2.z);
      const proj = dx * ux + dy * uy + dz * uz;
      if (proj > 0) bridgeP++; else tailP++;       // 分類a: 核間軸への射影の符号
      if (d2 < d1) bridgeN++; else tailN++;        // 分類b: どちらの核に近いか
    }
    console.log(`${onlyDisk ? 'disk' : 'all '} thr=${thr.toFixed(1)}  ` +
      `proj: tail=${(100 * tailP / nA).toFixed(1)}% bridge=${(100 * bridgeP / nA).toFixed(1)}%   ` +
      `near: tail=${(100 * tailN / nA).toFixed(1)}% bridge=${(100 * bridgeN / nA).toFixed(1)}%`);
  }
}

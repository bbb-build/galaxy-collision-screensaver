'use strict';
/* エネルギー基準の尾/橋分類: 尾=自核から非束縛化した脱出星, 橋=相手核に束縛された移籍星 */
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
const { px, py, pz, vx, vy, vz, kind, N } = ss.stars();
const { G1, G2 } = ss.cores();
console.log('apo t=', ss.simT.toFixed(2), 'd=', ss.coreSep().toFixed(3));
const a1 = G1.soft * G1.soft, a2 = G2.soft * G2.soft;
function E(i, g, asq) {
  const dvx = vx[i] - g.vx, dvy = vy[i] - g.vy, dvz = vz[i] - g.vz;
  const dx = px[i] - g.x, dy = py[i] - g.y, dz = pz[i] - g.z;
  return 0.5 * (dvx * dvx + dvy * dvy + dvz * dvz) - g.M / Math.sqrt(dx * dx + dy * dy + dz * dz + asq);
}
// 銀河A星のみ / 両銀河 それぞれで: 自核非束縛(E_own>0) → 相手核束縛なら橋, それも非束縛なら尾
for (const scope of ['A', 'both']) {
  let n = 0, tail = 0, bridge = 0, boundOther = 0;
  for (let i = 0; i < N; i++) {
    const isA = kind[i] < 3;
    if (scope === 'A' && !isA) continue;
    n++;
    const gOwn = isA ? G1 : G2, aOwn = isA ? a1 : a2;
    const gOth = isA ? G2 : G1, aOth = isA ? a2 : a1;
    if (E(i, gOwn, aOwn) <= 0) continue;        // まだ自核に束縛
    if (E(i, gOth, aOth) < 0) { bridge++; boundOther++; }
    else tail++;
  }
  console.log(`energy/${scope}: tail=${(100 * tail / n).toFixed(1)}%  bridge(移籍)=${(100 * bridge / n).toFixed(1)}%  n=${n}`);
}
// 参考: A円盤星のみ
{
  let n = 0, tail = 0, bridge = 0;
  for (let i = 0; i < N; i++) {
    if (kind[i] > 1) continue;
    n++;
    if (E(i, G1, a1) <= 0) continue;
    if (E(i, G2, a2) < 0) bridge++; else tail++;
  }
  console.log(`energy/Adisk: tail=${(100 * tail / n).toFixed(1)}%  bridge=${(100 * bridge / n).toFixed(1)}%  n=${n}`);
}

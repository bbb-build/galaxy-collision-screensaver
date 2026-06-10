'use strict';
/* N=70000 での step() 1回あたりのCPUコスト実測 */
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
ss.renderOff = true; ss.tune.AUTO_Q = 0;   // N=70000のまま
ss.newEncounter({ massRatio: 0.7, rp: 1.3, e: 1.0, inc1: 0.3, node1: 1.1, spin1: 1, inc2: 0.7, node2: 4.0, spin2: 1 });
// 合体まで進めてから計測(mergedの分岐 = 早送り時の実コスト)
while (!ss.cores().merged && ss.simT < 200) ss.step(0.008);
for (let i = 0; i < 200; i++) ss.step(0.008);   // ウォームアップ
const t0 = process.hrtime.bigint();
const REP = 600;
for (let i = 0; i < REP; i++) ss.step(0.008);
const ms = Number(process.hrtime.bigint() - t0) / 1e6 / REP;
console.log(`step(0.008) @N=70000 merged: ${ms.toFixed(3)} ms/回`);
console.log(`サブステップ数ごとのフレーム物理コスト: n=2:${(ms*2).toFixed(1)}ms n=4:${(ms*4).toFixed(1)}ms n=6:${(ms*6).toFixed(1)}ms n=8:${(ms*8).toFixed(1)}ms n=12:${(ms*12).toFixed(1)}ms`);

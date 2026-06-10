'use strict';
/* ヘッドレス物理検証ハーネス
   canvasスタブ + requestAnimationFrameポンプで extracted.js を実行し、
   規準遭遇の軌道・保存量・潮汐構造を計測する */
const fs = require('fs');
const code = fs.readFileSync(__dirname + '/extracted.js', 'utf8');

/* ---- スタブ ---- */
function makeGradient() { return { addColorStop() {} }; }
function makeCtx2D() {
  return {
    fillStyle: '', strokeStyle: '', lineWidth: 1,
    globalCompositeOperation: 'source-over',
    imageSmoothingEnabled: true, imageSmoothingQuality: 'high',
    scale() {}, translate() {}, rotate() {}, save() {}, restore() {},
    fillRect() {}, beginPath() {}, arc() {}, fill() {}, stroke() {},
    moveTo() {}, lineTo() {}, setTransform() {}, drawImage() {},
    createRadialGradient: makeGradient,
    createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
    putImageData() {}
  };
}
function makeCanvas() {
  return {
    width: 0, height: 0, style: {},
    getContext(type) { return type === '2d' ? makeCtx2D() : null; }  // webgl2 → null = Canvas2D退避
  };
}
const canvasEl = makeCanvas();
const rafQueue = [];
const windowStub = {
  innerWidth: 1280, innerHeight: 652, devicePixelRatio: 1,
  addEventListener() {}
};
const documentStub = {
  getElementById() { return canvasEl; },
  createElement() { return makeCanvas(); }
};
const raf = cb => { rafQueue.push(cb); return rafQueue.length; };

new Function('document', 'window', 'requestAnimationFrame', code)(documentStub, windowStub, raf);
const ss = windowStub.__ss;
if (!ss) { console.error('FAIL: __ss not found'); process.exit(1); }
ss.renderOff = true;
ss.tune.N = 4000;
ss.tune.AUTO_Q = 0;

/* ---- 規準遭遇 ---- */
const PARAMS = { massRatio: 0.7, rp: 1.3, e: 1.0,
                 inc1: 0.3, node1: 1.1, spin1: 1,
                 inc2: 0.7, node2: 4.0, spin2: 1 };

function medianDiskRadius() {
  const { px, py, pz, kind, N } = ss.stars();
  const { G1 } = ss.cores();
  const rs = [];
  for (let i = 0; i < N; i++) {
    if (kind[i] > 1) continue;          // 銀河Aの円盤星(kind 0/1)のみ
    rs.push(Math.hypot(px[i] - G1.x, py[i] - G1.y, pz[i] - G1.z));
  }
  rs.sort((a, b) => a - b);
  return rs[(rs.length / 2) | 0];
}
function momentum() {
  const { G1, G2, merged } = ss.cores();
  if (merged) return [G1.M * G1.vx, G1.M * G1.vy, G1.M * G1.vz];
  return [G1.M * G1.vx + G2.M * G2.vx,
          G1.M * G1.vy + G2.M * G2.vy,
          G1.M * G1.vz + G2.M * G2.vz];
}
function tailBridge() {
  // 両銀河の円盤星(核球除く): 自核から1.0超変位した星を核間軸の区間で分類
  //   橋 = 2核の間(0 < proj < sep), 尾 = 区間外(自核の裏側 or 相手核の向こう)
  const { px, py, pz, kind, N } = ss.stars();
  const c = ss.cores();
  const G1 = c.G1, G2 = c.G2;
  const sep = ss.coreSep();
  let ux = (G2.x - G1.x) / sep, uy = (G2.y - G1.y) / sep, uz = (G2.z - G1.z) / sep;
  let nDisk = 0, tail = 0, bridge = 0;
  for (let i = 0; i < N; i++) {
    if (kind[i] === 2 || kind[i] === 5) continue;   // 核球は除外
    nDisk++;
    const own = kind[i] < 3 ? G1 : G2;
    const dOwn = Math.hypot(px[i] - own.x, py[i] - own.y, pz[i] - own.z);
    if (dOwn < 0.8) continue;
    const proj = (px[i] - G1.x) * ux + (py[i] - G1.y) * uy + (pz[i] - G1.z) * uz;
    if (proj > 0 && proj < sep) bridge++; else tail++;
  }
  return { tailPct: 100 * tail / nDisk, bridgePct: 100 * bridge / nDisk, nDisk };
}
function hasNaN() {
  const { px, py, pz, vx, vy, vz, N } = ss.stars();
  for (let i = 0; i < N; i++) {
    if (!Number.isFinite(px[i] + py[i] + pz[i] + vx[i] + vy[i] + vz[i])) return true;
  }
  const c = ss.cores();
  return !Number.isFinite(c.G1.x + c.G1.vx);
}

function runOnce(runIdx) {
  ss.newEncounter(JSON.parse(JSON.stringify(PARAMS)));
  const r0 = medianDiskRadius();
  let ts = 0;
  let rPre = null;                       // t≈4(接近前)の円盤半径
  let peri = null, apo = null, mergeT = null, apoStats = null;
  let pMax = 0;
  let prevD = ss.coreSep(), prevT = 0, dir = -1;  // dir: -1 接近中, +1 後退中
  const maxFrames = 7000;
  for (let f = 0; f < maxFrames; f++) {
    const cb = rafQueue.shift();
    cb(ts); ts += 16.67;
    const t = ss.simT;
    const c = ss.cores();
    if (rPre === null && t >= 4.0) rPre = medianDiskRadius();
    const p = momentum();
    const pn = Math.hypot(p[0], p[1], p[2]);
    if (!c.merged && pn > pMax) pMax = pn;     // 合体時は星への運動量移譲なしでも核Pは保存
    if (!c.merged) {
      const d = ss.coreSep();
      if (dir < 0 && d > prevD && peri === null) {
        peri = { t: prevT, d: prevD }; dir = 1;
      } else if (dir > 0 && d < prevD && apo === null) {
        apo = { t: prevT, d: prevD };
        apoStats = tailBridge();
        dir = -1;
      }
      prevD = d; prevT = t;
    } else if (mergeT === null) {
      mergeT = t;
      break;
    }
  }
  const drift = Math.abs(rPre - r0) / r0 * 100;
  const nan = hasNaN();
  const res = { r0, rPre, driftPct: drift, peri, apo, mergeT, pMax, apoStats, nan };
  // 合格判定
  const within = (v, target, pct) => Math.abs(v - target) <= target * pct / 100;
  const checks = [
    ['円盤半径ドリフト<6%', drift < 6, `${drift.toFixed(2)}%`],
    ['第一近点 d≈1.29 (±1%)', peri && within(peri.d, 1.29, 1), peri && peri.d.toFixed(4)],
    ['第一近点 t≈5.1 (±1%)', peri && within(peri.t, 5.1, 1), peri && peri.t.toFixed(3)],
    ['第一遠点 d≈4.48 (±1%)', apo && within(apo.d, 4.48, 1), apo && apo.d.toFixed(4)],
    ['第一遠点 t≈16.5 (±1%)', apo && within(apo.t, 16.5, 1), apo && apo.t.toFixed(3)],
    ['合体 t≈36.9 (±1%)', mergeT && within(mergeT, 36.9, 1), mergeT && mergeT.toFixed(3)],
    ['運動量ドリフト<1e-12', pMax < 1e-12, pMax.toExponential(2)],
    ['潮汐尾 45±5%', apoStats && Math.abs(apoStats.tailPct - 45) <= 5, apoStats && apoStats.tailPct.toFixed(1) + '%'],
    ['橋 23±4%', apoStats && Math.abs(apoStats.bridgePct - 23) <= 4, apoStats && apoStats.bridgePct.toFixed(1) + '%'],
    ['NaNなし', !nan, nan ? 'NaN!' : 'ok']
  ];
  let pass = true;
  console.log(`\n=== Run ${runIdx} ===`);
  for (const [name, ok, val] of checks) {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}  →  ${val}`);
    if (!ok) pass = false;
  }
  return pass;
}

const p1 = runOnce(1);
const p2 = runOnce(2);
console.log(`\nRESULT: ${p1 && p2 ? 'ALL PASS (2 consecutive)' : 'FAILED'}`);
process.exit(p1 && p2 ? 0 : 1);

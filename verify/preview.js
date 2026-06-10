'use strict';
/* オフラインPNGプレビュー: GPUと同じ射影・パス式・v3現像をCPUで再現
   ガスは1/3解像度配列に積んで双線形拡大、星はフル解像度 */
const fs = require('fs');
const { PNG } = require('pngjs');
const code = fs.readFileSync(__dirname + '/extracted.js', 'utf8');

const W = 1280, H = 652;
const GAS_RES = 3;
const GW = Math.round(W / GAS_RES), GH = Math.round(H / GAS_RES);
const F_FOV = 1.45;
const EXPOSURE = 1.45, SAT = 1.25, GLOWK = 1.0, DUSTK = 1.0;

/* ---- スタブ ---- */
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
const windowStub = { innerWidth: W, innerHeight: H, devicePixelRatio: 1, addEventListener() {} };
const documentStub = { getElementById: () => canvasEl, createElement: () => makeCanvas() };
new Function('document', 'window', 'requestAnimationFrame', code)(documentStub, windowStub, cb => rafQueue.push(cb));
const ss = windowStub.__ss;
ss.renderOff = true;
ss.tune.AUTO_Q = 0;        // N=70000(本番値)のまま
ss.newEncounter({ massRatio: 0.7, rp: 1.3, e: 1.0, inc1: 0.3, node1: 1.1, spin1: 1, inc2: 0.7, node2: 4.0, spin2: 1 });

/* ---- 共有恒星パレット(本体と同一) ---- */
function starColor(t) {
  const P = [
    [0.00, 1.00, 0.52, 0.26], [0.30, 1.00, 0.76, 0.50], [0.55, 1.00, 0.92, 0.78],
    [0.75, 0.98, 0.97, 0.97], [1.00, 0.66, 0.78, 1.00]];
  let j = 1;
  while (j < P.length - 1 && t > P[j][0]) j++;
  const a = P[j - 1], b = P[j];
  const f = Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0])));
  return [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f];
}
/* ---- パフアトラス(本体makePuffAtlasと同一ロジック、αのみ) ---- */
const PUFF_S = 512, PUFF_C = 256;
const puff = new Float32Array(PUFF_S * PUFF_S);
(function () {
  const h2 = (ix, iy) => { const s = Math.sin(ix * 127.1 + iy * 311.7) * 43758.5453123; return s - Math.floor(s); };
  const vn2 = (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    let fx = x - ix, fy = y - iy;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = h2(ix, iy), b = h2(ix + 1, iy), c = h2(ix, iy + 1), d = h2(ix + 1, iy + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  for (let cell = 0; cell < 4; cell++) {
    const ox = (cell % 2) * PUFF_C, oy = (cell >> 1) * PUFF_C, seed = cell * 37.7;
    for (let y = 0; y < PUFF_C; y++) for (let x = 0; x < PUFF_C; x++) {
      const u = (x + 0.5) / PUFF_C - 0.5, v = (y + 0.5) / PUFF_C - 0.5;
      const fall = Math.max(0, 1 - Math.sqrt(u * u + v * v) * 2);
      let nn = 0, amp = 1, f = 3.5, tot = 0;
      for (let o = 0; o < 3; o++) { nn += amp * vn2(u * f + seed, v * f + seed * 1.7); tot += amp; amp *= 0.55; f *= 2.1; }
      nn /= tot;
      puff[(oy + y) * PUFF_S + ox + x] = Math.max(0, Math.min(1, Math.pow(fall, 1.5) * (0.35 + 0.65 * nn)));
    }
  }
})();
function puffSample(u, v) {   // LINEAR
  const x = Math.min(PUFF_S - 1.001, Math.max(0, u * PUFF_S - 0.5));
  const y = Math.min(PUFF_S - 1.001, Math.max(0, v * PUFF_S - 0.5));
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
  const a = puff[y0 * PUFF_S + x0], b = puff[y0 * PUFF_S + x0 + 1];
  const c = puff[(y0 + 1) * PUFF_S + x0], d = puff[(y0 + 1) * PUFF_S + x0 + 1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/* ---- 1パス分の点描画(FS_POINTS/VS_POINTSの式をそのまま) ---- */
function renderPass(bufR, bufG, bufB, bw, bh, mode, sizeMul, intScale, kg, maxPs, useTex, youngAmp, texMix, sizeExp, bufA, starMin, gasMax) {
  const { px, py, pz, kind, bri, temp, N } = ss.stars();
  const c = ss.cores();
  const CB = ss.view;
  const cam = ss.cam;
  const sb = ss.sb;
  const merged = c.merged;
  const G2 = c.G2;
  const uPX = 2 * F_FOV * bh / bw, uPY = 2 * F_FOV;
  const ptScale = bh * F_FOV * 0.020;
  const ps0 = ptScale / Math.max(2, cam.R);
  const ps0sq = Math.max(2.0, ps0 * ps0);
  const refD2 = cam.R * cam.R;
  const sRes = bh / 1080;
  const psMax = maxPs * sRes;
  const burstOn = !merged && sb > 0.02;
  for (let i = 0; i < N; i++) {
    const k = kind[i];
    const propX = ((k === 2 || k === 5) ? 2.4 : (k === 1 || k === 4) ? 1.25 : 1.0) * bri[i];
    const propY = (k === 1 || k === 4) ? 1 : (k === 2 || k === 5) ? -1 : 0;
    if (mode < 0.5 && propX < (starMin || 0)) continue;   // 暗い星は面の光に沈む
    if (mode > 0.5 && (gasMax || 0) > 0 && propX >= gasMax) continue;   // 明るい星は点のみ(暈なし)
    const dx = px[i] - CB.ex, dy = py[i] - CB.ey, dz = pz[i] - CB.ez;
    const zc = dx * CB.fx + dy * CB.fy + dz * CB.fz;
    if (zc < 0.4) continue;
    const ndcX = (dx * CB.rx + dy * CB.ry + dz * CB.rz) / zc * uPX;
    const ndcY = (dx * CB.ux + dy * CB.uy + dz * CB.uz) / zc * uPY;
    const xs = (ndcX * 0.5 + 0.5) * bw, ys = (ndcY * 0.5 + 0.5) * bh;  // GL座標(y上向き)
    let w = mode > 0.5 ? Math.min(propX, 2.6) : propX;
    const young = Math.min(1, Math.max(0, propY));
    const bulge = propY < -0.5 ? 1 : 0;
    if ((mode < 1.5 || mode > 2.5) && burstOn) {
      const ddx = px[i] - G2.x, ddy = py[i] - G2.y, ddz = pz[i] - G2.z;
      const bst = sb * (0.5 + (3.0 - 0.5) * young) * Math.exp(-(ddx * ddx + ddy * ddy + ddz * ddz) * 0.7);
      w *= 1 + bst * (mode < 0.5 ? 1.0 : mode > 2.5 ? 2.2 : 0.55);
    }
    const df = Math.min(2.2, Math.max(0.22, refD2 * 0.9 / (zc * zc + 0.5)));
    const ps = Math.min(psMax, Math.max(1.3, ptScale * Math.pow(propX, sizeExp) / zc * sizeMul));
    const norm = mode < 0.5 ? Math.min(1, ps0sq / (ps * ps)) : 1;
    let vI = 0.30 * w * df * norm * intScale;
    let cr, cg, cb2;
    if (mode > 2.5) {
      vI *= young * (1 - bulge);
      cr = 1.0; cg = 0.34; cb2 = 0.30;
    } else if (mode > 1.5) {
      vI *= (0.10 + 0.75 * young) * (1 - bulge);   // τはbufAへ蓄積(吸収は現像時)
      cr = 0; cg = 0; cb2 = 0;
    } else {
      const col = starColor(temp[i]);
      if (mode > 0.5) {
        vI *= Math.max(0.1, 1.0 + youngAmp * young);
        cr = col[0] + (1.0 - col[0]) * 0.28 * young;
        cg = col[1] + (0.60 - col[1]) * 0.28 * young;
        cb2 = col[2] + (0.64 - col[2]) * 0.28 * young;
      } else { cr = col[0]; cg = col[1]; cb2 = col[2]; }
    }
    if (vI === 0) continue;
    const hh = (propX * 53.731) % 1;
    const cell = Math.floor(hh * 4);
    const toffX = (cell % 2) * 0.5, toffY = Math.floor(cell / 2) * 0.5;
    const ang = hh * 18.85, ca = Math.cos(ang), sa = Math.sin(ang);
    // 点スプライトのラスタライズ
    const half = ps * 0.5;
    const x0 = Math.max(0, Math.ceil(xs - half - 0.5)), x1 = Math.min(bw - 1, Math.floor(xs + half - 0.5));
    const y0 = Math.max(0, Math.ceil(ys - half - 0.5)), y1 = Math.min(bh - 1, Math.floor(ys + half - 0.5));
    for (let yy = y0; yy <= y1; yy++) {
      const pcy = ((yy + 0.5) - (ys - half)) / ps;        // gl_PointCoord相当(向きは等方なので符号差は無視)
      const qy = pcy - 0.5;
      const row = yy * bw;
      for (let xx = x0; xx <= x1; xx++) {
        const pcx = ((xx + 0.5) - (xs - half)) / ps;
        const qx = pcx - 0.5;
        const qrx = qx * ca - qy * sa, qry = qx * sa + qy * ca;
        let g = Math.exp(-(qrx * qrx + qry * qry) * kg);
        if (useTex) {
          const su = toffX + Math.min(1, Math.max(0, qrx + 0.5)) * 0.5;
          const sv = toffY + Math.min(1, Math.max(0, qry + 0.5)) * 0.5;
          const tx = 0.25 + 1.5 * puffSample(su, sv);
          g *= 1 + (tx - 1) * texMix;
        }
        const e = vI * g;
        if (mode > 1.5 && mode < 2.5) { bufA[row + xx] += e; }
        else { bufR[row + xx] += cr * e; bufG[row + xx] += cg * e; bufB[row + xx] += cb2 * e; }
      }
    }
  }
}

function projectFull(x, y, z) {
  const CB = ss.view;
  const dx = x - CB.ex, dy = y - CB.ey, dz = z - CB.ez;
  const zc = dx * CB.fx + dy * CB.fy + dz * CB.fz;
  if (zc < 0.4) return null;
  const F = H * F_FOV;
  return [W * 0.5 + F * (dx * CB.rx + dy * CB.ry + dz * CB.rz) / zc,
          H * 0.5 - F * (dx * CB.ux + dy * CB.uy + dz * CB.uz) / zc, zc];
}
function coreUniform(g) {
  const sb = ss.sb;
  const p = projectFull(g.x, g.y, g.z);
  if (!p) return [0, 0, 0, 0];
  const R = Math.min(320, (40 + 36 * g.M) * 3.6 / p[2]) * (1 + 0.55 * sb);
  return [p[0], H - p[1], R, (0.9 + 0.6 * sb) * 1.05];   // y上向き(GL fragcoord)
}
function glowAdd(fx, fy, c, tint, out) {
  if (c[3] <= 0) return;
  const ddx = fx - c[0], ddy = fy - c[1];
  const d = Math.sqrt(ddx * ddx + ddy * ddy) / Math.max(c[2], 1);
  const g = Math.exp(-d * d * 4.5) * 0.85 + 0.16 / (1 + d * d * 9);
  const nuc = Math.exp(-d * d * 240) * 2.2;
  out[0] += tint[0] * c[3] * g + 1.00 * c[3] * nuc;
  out[1] += tint[1] * c[3] * g + 0.99 * c[3] * nuc;
  out[2] += tint[2] * c[3] * g + 0.95 * c[3] * nuc;
}

function snapshot(name) {
  const c = ss.cores();
  const merged = c.merged;
  console.log(`render ${name}: t=${ss.simT.toFixed(2)} merged=${merged} sb=${ss.sb.toFixed(3)} camR=${ss.cam.R.toFixed(2)}`);
  const starR = new Float32Array(W * H), starG = new Float32Array(W * H), starB = new Float32Array(W * H);
  const gasR = new Float32Array(GW * GH), gasG = new Float32Array(GW * GH), gasB = new Float32Array(GW * GH);
  const gasA = new Float32Array(GW * GH);
  // ガス5パス(1/3解像度) — renderGLと同じ係数、SPLIT=1.2で点と完全分離
  const SPLIT = 1.2;
  renderPass(gasR, gasG, gasB, GW, GH, 2, 4.0, DUSTK * 0.074, 5.0, 72, 1, 0.0, 1.0, 0.5, gasA, 0, SPLIT);
  renderPass(gasR, gasG, gasB, GW, GH, 1, 4.0, GLOWK * 0.036, 7.0, 48, 1, 0.25, 0.65, 0.5, null, 0, SPLIT);
  renderPass(gasR, gasG, gasB, GW, GH, 1, 5.5, GLOWK * 0.038, 5.5, 64, 1, 0.25, 0.55, 0.5, null, 0, SPLIT);
  renderPass(gasR, gasG, gasB, GW, GH, 1, 11.0, GLOWK * 0.021, 6.0, 90, 1, -0.55, 0.45, 0.5, null, 0, SPLIT);
  // 星パス(フル解像度) — 明るい星(propX≥SPLIT)だけ暈なしの鋭い点
  renderPass(starR, starG, starB, W, H, 0, 1.0, 2.4, 52.0, 8, 0, 0.0, 0.0, 0.28, null, SPLIT, 0);
  renderPass(starR, starG, starB, W, H, 3, 1.0, 1.0, 52.0, 8, 0, 0.0, 0.0, 0.28, null, 0, 0);   // HII=赤い星(同サイズ)
  // 現像v3
  const coreA = coreUniform(c.G1);
  const coreB = merged ? [0, 0, 0, 0] : coreUniform(c.G2);
  const tintA = [1.0, 0.80, 0.55], tintB = [0.96, 0.92, 0.84];
  const uExp = EXPOSURE * (merged ? 1.22 : 1.0);
  const png = new PNG({ width: W, height: H });
  const gasSample = (buf, gx, gy) => {
    const x = Math.min(GW - 1.001, Math.max(0, gx)), y = Math.min(GH - 1.001, Math.max(0, gy));
    const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
    const a = buf[y0 * GW + x0], b = buf[y0 * GW + x0 + 1];
    const cc = buf[(y0 + 1) * GW + x0], dd = buf[(y0 + 1) * GW + x0 + 1];
    return a + (b - a) * fx + (cc - a) * fy + (a - b - cc + dd) * fx * fy;
  };
  for (let gy = 0; gy < H; gy++) {       // gy: GL座標(y上向き)
    const pngRow = (H - 1 - gy) * W;
    const gasY = (gy + 0.5) / H * GH - 0.5;
    for (let x = 0; x < W; x++) {
      const idx = gy * W + x;
      const gasX = (x + 0.5) / W * GW - 0.5;
      let g0 = Math.max(0, gasSample(gasR, gasX, gasY));
      let g1 = Math.max(0, gasSample(gasG, gasX, gasY));
      let g2 = Math.max(0, gasSample(gasB, gasX, gasY));
      const tau = Math.max(0, gasSample(gasA, gasX, gasY));
      g0 *= Math.exp(-tau * 0.50); g1 *= Math.exp(-tau * 0.75); g2 *= Math.exp(-tau * 1.05);
      const knee = 1 + 0.35 * (0.30 * g0 + 0.45 * g1 + 0.25 * g2);
      g0 /= knee; g1 /= knee; g2 /= knee;
      const h = [
        Math.max(0, starR[idx]) + g0,
        Math.max(0, starG[idx]) + g1,
        Math.max(0, starB[idx]) + g2];
      glowAdd(x + 0.5, gy + 0.5, coreA, tintA, h);
      glowAdd(x + 0.5, gy + 0.5, coreB, tintB, h);
      let m0 = h[0] * uExp, m1 = h[1] * uExp, m2 = h[2] * uExp;
      m0 = m0 / (1 + m0); m1 = m1 / (1 + m1); m2 = m2 / (1 + m2);
      const av = (m0 + m1 + m2) / 3;
      const t = Math.min(1, Math.max(0, (av - 0.05) / 0.80));
      const sm = t * t * (3 - 2 * t);
      const satL = SAT * (1.75 - 1.6 * sm);
      m0 = av + (m0 - av) * satL; m1 = av + (m1 - av) * satL; m2 = av + (m2 - av) * satL;
      const o = (pngRow + x) * 4;
      png.data[o] = Math.min(255, Math.max(0, m0 * 255));
      png.data[o + 1] = Math.min(255, Math.max(0, m1 * 255));
      png.data[o + 2] = Math.min(255, Math.max(0, m2 * 255));
      png.data[o + 3] = 255;
    }
  }
  fs.writeFileSync(__dirname + '/' + name, PNG.sync.write(png));
  console.log('  wrote', name);
}

/* ---- ポンプして3スナップショット ---- */
let ts = 0, mergeT = null;
const targets = [
  { t: 1.2, name: 'preview-t1.2.png', done: false },
  { t: 5.2, name: 'preview-t5.2.png', done: false },
  { t: 16.5, name: 'preview-t16.5.png', done: false }
];
for (let f = 0; f < 12000; f++) {
  rafQueue.shift()(ts); ts += 16.67;
  const t = ss.simT;
  for (const tg of targets) {
    if (!tg.done && t >= tg.t) { snapshot(tg.name); tg.done = true; }
  }
  if (mergeT === null && ss.cores().merged) mergeT = t;
  if (mergeT !== null && t >= mergeT + 5) { snapshot('preview-merge+5.png'); break; }
}
console.log('done');


'use strict';
/* =====================================================================
   数理の風景 No.11 「銀河衝突」
   Toomre & Toomre (1972) の制限N体法 — アンテナ銀河の潮汐尾を
   初めて説明した、その計算法そのもの。
     ・2つの銀河核(バルジ+ハローのPlummerポテンシャル)は
       互いの重力で運動し、重なると力学的摩擦で軌道エネルギーを失う
     ・数千の恒星は両方の核の重力場の中を運動する(リープフロッグ積分)
   第一近接で潮汐の尾と橋が伸び、振り戻して二度目の遭遇、合体、
   残骸は殻を巻きながら楕円銀河へ静まってゆく。
   近接時のスターバースト(若い星の青い燃焼)は潮汐力 M/d³ に連動。
   恒星の色は出身銀河と星種族を保持する — 尾の二色は来歴の記録。
   ===================================================================== */

const canvas = document.getElementById('cv');
let ctx = null;   // Canvas2D退避時のみ初期化(同一canvasは1種類のコンテキストのみ)
const DPR = Math.min(window.devicePixelRatio || 1, 2);
let W = 0, H = 0;

const TUNE = {
  N: 60000,        // 恒星の数
  SPEED: 1.0,      // 時間の速さ
  EXPOSURE: 1.45,  // 露出
  SAT: 1.25,       // 彩度(フィルムの濃さ)
  GLOW: 1.0,       // 拡散光(分解できない星々とガスの面の光)
  DUST: 1.0,       // 星間塵(腕を刻む暗黒帯)
  SSAA: 1,         // スーパーサンプリング(GPUに余裕があれば1.25〜1.5)
  GAS_RES: 3,      // ガスバッファの縮小率(フィルレート対策、AUTO_Qが3⇔4を切替)
  BUDGET: 1700000, // 星バッファの画素予算(画質)
  AUTO_Q: 1,       // 端末性能に合わせた自動画質調整
  FRICTION: 0.22,  // 力学的摩擦(近点1回で軌道エネルギーを約1割ずつ失う強さ)
  WARP: 7,         // 合体後の早送りの最大倍率(刻み幅0.012×5分割=物理5.5ms/フレームが上限の目安)
  SAVOR_S: 30,     // 固まった巨大銀河を通常速度で堪能する時間
  RELAX_S: 240     // 合体後フェーズ全体の安全上限(秒)
};
const DT = 0.004;
const SUBSTEP_SEP = 2.4;             // 適応サブステップ: 核間距離がこれより遠いと1ステップに粗くする

const rand = (a, b) => a + Math.random() * (b - a);
function randn() {
  let s = 0;
  for (let i = 0; i < 6; i++) s += Math.random();
  return (s - 3) / Math.sqrt(0.5);
}

/* ---------------- 銀河と遭遇のパラメータ ---------------- */
let G1, G2, merged, mergeT, gen = 0, simT = 0;
let N = 0;
let px, py, pz, vx, vy, vz, kind, bri, temp;  // kind: 0=A古 1=A若 2=A核球 3=B古 4=B若 5=B核球
let sb = 0;                           // スターバースト強度(平滑)
let phase = 'encounter', fade = 1, relaxT = 0;
let warp = 1, savorT = 0;             // 合体後の早送りと堪能タイム
let encounterParams = null;

function plummerAccel(x, y, z, cx, cy, cz, M, a2) {
  const dx = cx - x, dy = cy - y, dz = cz - z;
  const r2 = dx * dx + dy * dy + dz * dz + a2;
  const inv = M / (r2 * Math.sqrt(r2));
  return [dx * inv, dy * inv, dz * inv];
}
function vCirc(r, M, a2) {
  const r2 = r * r;
  return Math.sqrt(M * r2 / Math.pow(r2 + a2, 1.5));
}

/* 円盤銀河を1つ組み立てる(傾き・スピン・速度分散つき) */
function buildGalaxy(n, M, soft, inc, node, spin, cx, cy, cz, cvx, cvy, cvz, baseKind, out, o0, armPh, yf, tBias) {
  const ci = Math.cos(inc), si = Math.sin(inc);
  const cn = Math.cos(node), sn = Math.sin(node);
  const a2 = soft * soft;
  const TAN_PITCH = 0.31;                   // 渦状腕のピッチ角 ≈ 17°
  // 星団サイト: 若い星は腕の稜線上のクラスターから生まれる
  const sites = [];
  for (let s = 0; s < 22; s++) {
    const rs = 0.28 + 0.85 * Math.pow(Math.random(), 0.7);
    const armBranch = Math.random() < 0.5 ? 0 : Math.PI;
    const ts = Math.log(rs + 0.2) / TAN_PITCH - armPh / 2 + armBranch + rand(-0.16, 0.16);
    sites.push([rs, ts]);
  }
  for (let k = 0; k < n; k++) {
    const i = o0 + k;
    const isBulge = k < n * 0.16;
    let r, z0, th, cosArm = 0;
    if (isBulge) {
      r = 0.04 + 0.24 * Math.pow(Math.random(), 1.4);
      z0 = r * rand(-0.55, 0.55);
      th = rand(0, Math.PI * 2);
    } else if (Math.random() < yf * 0.55) {
      // 若い星: 星団サイトのまわりに塊で生まれる
      const st = sites[(Math.random() * sites.length) | 0];
      r = Math.max(0.12, st[0] + randn() * 0.04);
      th = st[1] + randn() * 0.04 / Math.max(st[0], 0.3);
      z0 = randn() * 0.02;
      cosArm = 2;                               // クラスター印
    } else {
      r = 0.16 + 1.05 * Math.pow(Math.random(), 0.62);
      z0 = rand(-1, 1) * 0.035 * (1 + r * 0.5);
      // 2本腕の対数螺旋を初期密度に刻む(腕間は暗く — 実写の渦巻のコントラスト)
      let tries = 0;
      do {
        th = rand(0, Math.PI * 2);
        cosArm = Math.cos(2 * (th - Math.log(r + 0.2) / TAN_PITCH) + armPh);
      } while (Math.random() > 0.40 + 0.60 * Math.max(0, cosArm) && ++tries < 9);
    }
    // 円盤面内の位置と円軌道速度(+小さな速度分散 — 完全に冷たい円盤は嘘くさい)
    const xp = r * Math.cos(th), yp = r * Math.sin(th);
    const vc = vCirc(r, M, a2) * spin;
    const disp = vCirc(1, M, a2) * 0.035;
    let vxp = -vc * Math.sin(th) + rand(-disp, disp);
    let vyp =  vc * Math.cos(th) + rand(-disp, disp);
    let vzp = rand(-disp, disp) * 0.6;
    // 傾け(x軸まわり inc → z軸まわり node)
    let X = xp, Y = yp * ci - z0 * si, Z = yp * si + z0 * ci;
    let VX = vxp, VY = vyp * ci - vzp * si, VZ = vyp * si + vzp * ci;
    const Xr = X * cn - Y * sn, Yr = X * sn + Y * cn;
    const VXr = VX * cn - VY * sn, VYr = VX * sn + VY * cn;
    out.px[i] = cx + Xr; out.py[i] = cy + Yr; out.pz[i] = cz + Z;
    out.vx[i] = cvx + VXr; out.vy[i] = cvy + VYr; out.vz[i] = cvz + VZ;
    out.kind[i] = isBulge ? baseKind + 2 : (cosArm > 1.5 ? baseKind + 1 : baseKind);
    // 星の温度(共有ランプ上の位置): 種族 + 半径勾配 + 銀河の統計的な偏り + 個体差
    let tt;
    if (isBulge) tt = 0.28 + 0.12 * Math.random();   // バルジはクリーム色(実写のM51準拠)
    else if (cosArm > 1.5) tt = 0.84 + tBias * 0.4 + randn() * 0.06;
    else tt = (0.34 + tBias * 1.3) + 0.38 * Math.min(1, r / 1.15) + randn() * 0.10;
    out.temp[i] = Math.min(1, Math.max(0, tt));
    // 星ごとの光度: べき分布 — 少数の輝星が視覚を支配し、大多数は面の光に沈む
    let b = Math.min(26, Math.pow(Math.random(), -0.55)) / 2.2;
    if (cosArm > 1.5) b *= 1.5;
    if (!isBulge) b *= 0.75 + 0.9 * Math.exp(-r / 0.6);  // 実在円盤の指数関数的な輝度勾配(控えめ)
    out.bri[i] = b;
  }
}

function newEncounter(params) {
  encounterParams = params || {
    massRatio: rand(0.3, 1.0),
    rp: rand(0.75, 1.9),          // 近点距離(深い直撃〜浅いかすめ)
    e: rand(0.90, 1.0),           // 離心率(ほぼ放物線・束縛側)
    fric: rand(0.16, 0.30),       // 力学的摩擦も遭遇ごとに変える(合体の速さのパターン)
    inc1: rand(0.05, 1.3), node1: rand(0, 6.28), spin1: Math.random() < 0.6 ? 1 : -1,
    inc2: rand(0.1, 1.5), node2: rand(0, 6.28), spin2: Math.random() < 0.6 ? 1 : -1
  };
  const P = encounterParams;
  const M1 = 1.0, M2 = P.massRatio;
  const Mt = M1 + M2;
  G1 = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, M: M1, soft: 0.22 };
  G2 = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, M: M2, soft: 0.20 };
  merged = false; mergeT = 0; sb = 0; simT = 0;
  phase = 'encounter'; relaxT = 0; warp = 1; savorT = 0;
  extChk = 0; extChkT = 0; extSettled = false; extCam = 3.5;

  // 2体軌道(近点 rp・離心率 e)を距離 D0 から開始
  const D0 = 4.8;
  const p = P.rp * (1 + P.e);
  const v2 = Mt * (2 / D0 - (1 - P.e * P.e) / p);
  const L = Math.sqrt(Mt * p);
  const vt = L / D0;
  const vr = -Math.sqrt(Math.max(0, v2 - vt * vt));
  // 相対ベクトルを質量比で2体に配分
  const f1 = M2 / Mt, f2 = M1 / Mt;
  G1.x = -D0 * f1; G2.x = D0 * f2;
  G1.vx = -vr * f1; G2.vx = vr * f2;
  G1.vy = -vt * f1; G2.vy = vt * f2;

  // 恒星
  N = TUNE.N;
  px = new Float32Array(N); py = new Float32Array(N); pz = new Float32Array(N);
  vx = new Float32Array(N); vy = new Float32Array(N); vz = new Float32Array(N);
  kind = new Uint8Array(N);
  bri = new Float32Array(N);
  temp = new Float32Array(N);
  const n1 = Math.round(N * M1 / Mt), n2 = N - n1;
  const out = { px, py, pz, vx, vy, vz, kind, bri, temp };
  buildGalaxy(n1, M1, G1.soft, P.inc1, P.node1, P.spin1,
              G1.x, G1.y, G1.z, G1.vx, G1.vy, G1.vz, 0, out, 0, rand(0, 6.28), 0.32, -0.12);
  buildGalaxy(n2, M2, G2.soft, P.inc2, P.node2, P.spin2,
              G2.x, G2.y, G2.z, G2.vx, G2.vy, G2.vz, 3, out, n1, rand(0, 6.28), 0.58, 0.27);
  glDirty = true;
  gen++;
}

/* ---------------- 力学 ---------------- */
function coreSep() {
  if (merged) return 0;
  return Math.hypot(G2.x - G1.x, G2.y - G1.y, G2.z - G1.z);
}

function stepCores(h) {
  if (merged) return;
  const dx = G2.x - G1.x, dy = G2.y - G1.y, dz = G2.z - G1.z;
  const d2 = dx * dx + dy * dy + dz * dz;
  const soft2 = 0.5 * (G1.soft * G1.soft + G2.soft * G2.soft);
  const d = Math.sqrt(d2);
  const inv = 1 / Math.pow(d2 + soft2, 1.5);
  // 相互重力
  let ax1 = G2.M * dx * inv, ay1 = G2.M * dy * inv, az1 = G2.M * dz * inv;
  let ax2 = -G1.M * dx * inv, ay2 = -G1.M * dy * inv, az2 = -G1.M * dz * inv;
  // 力学的摩擦(ハローが重なると軌道エネルギーを失う)
  // t>70で漸増 — 浅いかすめ遭遇でも眺めの寿命内に必ず合体へ向かわせる安全弁
  const rvx = G2.vx - G1.vx, rvy = G2.vy - G1.vy, rvz = G2.vz - G1.vz;
  const fricBase = (encounterParams && encounterParams.fric) || TUNE.FRICTION;
  const kf = fricBase * (1 + Math.max(0, (simT - 70) * 0.05)) * Math.exp(-(d / 1.2) * (d / 1.2));
  const Mt = G1.M + G2.M;
  ax1 += kf * rvx * G2.M / Mt; ay1 += kf * rvy * G2.M / Mt; az1 += kf * rvz * G2.M / Mt;
  ax2 -= kf * rvx * G1.M / Mt; ay2 -= kf * rvy * G1.M / Mt; az2 -= kf * rvz * G1.M / Mt;
  G1.vx += ax1 * h; G1.vy += ay1 * h; G1.vz += az1 * h;
  G2.vx += ax2 * h; G2.vy += ay2 * h; G2.vz += az2 * h;
  G1.x += G1.vx * h; G1.y += G1.vy * h; G1.z += G1.vz * h;
  G2.x += G2.vx * h; G2.y += G2.vy * h; G2.z += G2.vz * h;
  // 合体判定
  const vrel = Math.hypot(rvx, rvy, rvz);
  if (d < 0.30 && vrel * vrel < Mt / Math.sqrt(d2 + soft2)) {
    const M = Mt;
    G1.x = (G1.x * G1.M + G2.x * G2.M) / M; G1.y = (G1.y * G1.M + G2.y * G2.M) / M;
    G1.z = (G1.z * G1.M + G2.z * G2.M) / M;
    G1.vx = (G1.vx * G1.M + G2.vx * G2.M) / M; G1.vy = (G1.vy * G1.M + G2.vy * G2.M) / M;
    G1.vz = (G1.vz * G1.M + G2.vz * G2.M) / M;
    G1.M = M; G1.soft = 0.52;   // 合体銀河は親より広がった楕円体(暴力的緩和)
    merged = true; mergeT = simT;
    phase = 'relax';
    warp = 1; savorT = 0;
    extChk = 0; extChkT = simT; extSettled = false;
  }
}

function stepStars(h) {
  const a1 = G1.soft * G1.soft;
  const c1x = G1.x, c1y = G1.y, c1z = G1.z, M1 = G1.M;
  let c2x = 0, c2y = 0, c2z = 0, M2 = 0, a2 = 1;
  if (!merged) { c2x = G2.x; c2y = G2.y; c2z = G2.z; M2 = G2.M; a2 = G2.soft * G2.soft; }
  for (let i = 0; i < N; i++) {
    let dx = c1x - px[i], dy = c1y - py[i], dz = c1z - pz[i];
    let r2 = dx * dx + dy * dy + dz * dz + a1;
    let inv = M1 / (r2 * Math.sqrt(r2));
    let ax = dx * inv, ay = dy * inv, az = dz * inv;
    if (!merged) {
      dx = c2x - px[i]; dy = c2y - py[i]; dz = c2z - pz[i];
      r2 = dx * dx + dy * dy + dz * dz + a2;
      inv = M2 / (r2 * Math.sqrt(r2));
      ax += dx * inv; ay += dy * inv; az += dz * inv;
    }
    vx[i] += ax * h; vy[i] += ay * h; vz[i] += az * h;
    px[i] += vx[i] * h; py[i] += vy[i] * h; pz[i] += vz[i] * h;
  }
}

function step(h) {
  stepCores(h);
  stepStars(h);
  simT += h;
  // スターバースト: 潮汐力 M/d³ に連動
  let target = 0;
  if (!merged) {
    const d = coreSep();
    target = Math.min(1, 1.35 / (d * d * d + 0.45));
  } else {
    target = Math.max(0, 1 - (simT - mergeT) / 4);
  }
  sb += (target - sb) * 0.04;
}

/* ---------------- カメラ(ドキュメンタリーの呼吸) ---------------- */
const cam = { yaw: 0.6, pitch: 0.50, R: 11, roll: 0, yawRate: 0.05,
              look: { x: 0, y: 0, z: 0 }, shx: 0, shy: 0 };
let CB = null;
let sepPrev = null, sepTrend = 0, extEMA = 2.5, extCam = 3.5, extTick = 0;
let extChk = 0, extChkT = 0, extSettled = false;   // 残骸の広がりの収束判定
let camT = 0;                                      // カメラ用の実時間(早送りの影響を受けない)
const extDs = new Float32Array(1024);              // 分位計算用スクラッチ(毎フレームの割り当てを避ける)
function updateCamera(dt) {
  camT += dt;
  const sep = merged ? 0 : coreSep();
  if (sepPrev !== null && dt > 0 && !merged) {
    sepTrend += ((sep - sepPrev) / dt - sepTrend) * Math.min(1, 4 * dt);
  }
  sepPrev = merged ? null : sep;

  // 演出のムード: 接近 / 激突 / 漂流(尾を見せる) / 余韻
  let tYawR, tPitch, want;
  if (merged) {
    if (++extTick >= 10) {                      // 残骸の広がりに枠を合わせる(本体=55%分位、破片ハロー=80%分位)
      extTick = 0;
      const stride = Math.max(1, (N / 800) | 0);   // 約800サンプル(N非依存の推定精度)
      let m = 0;
      for (let i = 0; i < N && m < 1024; i += stride) {
        const dx = px[i] - G1.x, dy = py[i] - G1.y, dz = pz[i] - G1.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < 25) extDs[m++] = d;
      }
      const sub = extDs.subarray(0, m);
      sub.sort();                                  // TypedArrayのsortは数値順・追加割り当てなし
      const p55 = m ? sub[(m * 0.55) | 0] : extEMA;
      const p80 = m ? sub[(m * 0.80) | 0] : extCam;
      extEMA += (p55 - extEMA) * 0.2;
      extCam += (p80 - extCam) * 0.12;          // カメラ用はさらにゆっくり追従
    }
    tYawR = 0.045;
    tPitch = 0.48 + 0.16 * Math.sin(camT * 0.015);
    // 破片ハロー(p80)全体が収まる引きの構図のまま、ズームインせずに見届ける
    want = Math.min(14.0, Math.max(4.2, extCam * 3.4 + 1.0));
    want *= 1 + 0.05 * Math.sin(camT * 0.026);   // 呼吸するドリー
  } else if (sep < 1.5) {            // 激突 — 旋回で巻き込む(急進的にならない範囲で)
    tYawR = 0.12; tPitch = 0.38;
    want = Math.max(4.6, 2.1 * (sep * 0.5 + 1.30));
  } else if (sepTrend > 0.04) {      // 漂流 — 引いて尾と橋を見せる
    tYawR = 0.06; tPitch = 0.64;
    want = Math.min(11.0, 2.7 * (sep * 0.5 + 1.30));
  } else {                            // 接近
    tYawR = 0.05; tPitch = 0.50;
    want = Math.min(11.5, Math.max(4.3, 2.45 * (sep * 0.5 + 1.30)));
  }
  cam.yawRate += (tYawR - cam.yawRate) * Math.min(1, 0.45 * dt);
  cam.yaw += cam.yawRate * dt;
  cam.pitch += (tPitch - cam.pitch) * Math.min(1, 0.30 * dt);
  // ズームは毎秒8%を上限になめらかに(急なズームイン/アウトを物理的に禁止)
  let dR = (want - cam.R) * Math.min(1, 0.40 * dt);
  const dRlim = cam.R * 0.08 * dt;
  if (dR > dRlim) dR = dRlim; else if (dR < -dRlim) dR = -dRlim;
  cam.R += dR;

  // 旋回の速さに応じた機体のバンクと、手持ちの微揺れ(OU)
  const tRoll = Math.max(-0.085, Math.min(0.085, -(cam.yawRate - 0.05) * 0.55));
  cam.roll += (tRoll - cam.roll) * Math.min(1, 0.8 * dt);
  cam.shx += -1.2 * cam.shx * dt + 0.16 * Math.sqrt(dt) * randn();
  cam.shy += -1.2 * cam.shy * dt + 0.16 * Math.sqrt(dt) * randn();

  const Mt = G1.M + (merged ? 0 : G2.M);
  const cx = merged ? G1.x : (G1.x * G1.M + G2.x * G2.M) / Mt;
  const cy = merged ? G1.y : (G1.y * G1.M + G2.y * G2.M) / Mt;
  const cz = merged ? G1.z : (G1.z * G1.M + G2.z * G2.M) / Mt;
  cam.look.x += (cx + cam.shx * 0.06 - cam.look.x) * Math.min(1, 1.2 * dt);
  cam.look.y += (cy + cam.shy * 0.06 - cam.look.y) * Math.min(1, 1.2 * dt);
  cam.look.z += (cz - cam.look.z) * Math.min(1, 1.2 * dt);

  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const cy2 = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
  const ex = cam.look.x + cam.R * cp * cy2;
  const ey = cam.look.y + cam.R * cp * sy;
  const ez = cam.look.z + cam.R * sp;
  let fx = cam.look.x - ex, fy = cam.look.y - ey, fz = cam.look.z - ez;
  const fl = Math.hypot(fx, fy, fz); fx /= fl; fy /= fl; fz /= fl;
  let rx = fy, ry = -fx;
  const rl = Math.hypot(rx, ry) || 1; rx /= rl; ry /= rl;
  const ux = ry * fz, uy = -rx * fz, uz = rx * fy - ry * fx;
  // ロール適用
  const crr = Math.cos(cam.roll), srr = Math.sin(cam.roll);
  CB = { ex, ey, ez, fx, fy, fz,
         rx: rx * crr + ux * srr, ry: ry * crr + uy * srr, rz: uz * srr,
         ux: ux * crr - rx * srr, uy: uy * crr - ry * srr, uz: uz * crr };
}

/* ---------------- 天体写真レンダラ(HDR加算 → トーンマップ) ---------------- */
let bw = 0, bh = 0, accR, accG, accB, bufCanvas, bufCtx, bufImg;
let bgCanvas = null;
const COLS = [            // Canvas2D退避用の代表色(WebGL本則は星ごとの温度ランプ)
  [1.00, 0.80, 0.58],   // A 古い星
  [0.85, 0.88, 1.00],   // A 若い星
  [1.00, 0.66, 0.38],   // A 核球
  [0.96, 0.93, 0.88],   // B 古い星
  [0.72, 0.82, 1.00],   // B 若い星
  [1.00, 0.70, 0.44]    // B 核球
];
// 共有恒星パレット(黒体風ランプ): 暖橙 → 金 → 乳白 → 白 → 青白
function starColor(t) {
  const P = [
    [0.00, 1.00, 0.52, 0.26],
    [0.30, 1.00, 0.76, 0.50],
    [0.55, 1.00, 0.92, 0.78],
    [0.75, 0.98, 0.97, 0.97],
    [1.00, 0.66, 0.78, 1.00]
  ];
  let j = 1;
  while (j < P.length - 1 && t > P[j][0]) j++;
  const a = P[j - 1], b = P[j];
  const f = Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0])));
  return [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f];
}

/* ガウス点像のLUT(16サブピクセル × 4タップ) — 星を丸く、なめらかに灯す */
const GLUT = new Float32Array(16 * 4);
(function () {
  const s2 = 2 * 0.72 * 0.72;
  for (let sub = 0; sub < 16; sub++) {
    let sum = 0;
    for (let t = 0; t < 4; t++) {
      const dd = (t - 1) - sub / 16;
      const g = Math.exp(-dd * dd / s2);
      GLUT[sub * 4 + t] = g; sum += g;
    }
    for (let t = 0; t < 4; t++) GLUT[sub * 4 + t] /= sum;
  }
})();
/* 暗部の縞を消す微小ディザ(Bayer 4×4) */
const DITHER = new Float32Array(16);
[0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].forEach((v, i) => DITHER[i] = (v / 15 - 0.5) * 2.2);

function setupBuffers() {
  const pw = Math.max(64, Math.round(W * DPR)), ph = Math.max(64, Math.round(H * DPR));
  const s = Math.min(1, Math.sqrt(TUNE.BUDGET / (pw * ph)));
  bw = Math.max(64, Math.round(pw * s));
  bh = Math.max(64, Math.round(ph * s));
  accR = new Float32Array(bw * bh);
  accG = new Float32Array(bw * bh);
  accB = new Float32Array(bw * bh);
  bufCanvas = document.createElement('canvas');
  bufCanvas.width = bw; bufCanvas.height = bh;
  bufCtx = bufCanvas.getContext('2d');
  bufImg = bufCtx.createImageData(bw, bh);
}

function buildBackground() {
  bgCanvas = document.createElement('canvas');
  bgCanvas.width = W * DPR; bgCanvas.height = H * DPR;
  const s = bgCanvas.getContext('2d');
  s.scale(DPR, DPR);
  s.fillStyle = '#020308';
  s.fillRect(0, 0, W, H);
  const n = Math.round(W * H / 6500);
  for (let i = 0; i < n; i++) {
    const a = Math.pow(Math.random(), 2.2) * 0.45 + 0.03;
    s.fillStyle = `rgba(210,222,250,${a.toFixed(3)})`;
    const r = Math.random() < 0.92 ? rand(0.3, 0.7) : rand(0.8, 1.3);
    s.beginPath(); s.arc(Math.random() * W, Math.random() * H, r, 0, 7); s.fill();
  }
  // 天の川のかすかな帯
  s.save();
  s.translate(W * 0.5, H * 0.5); s.rotate(-0.55);
  for (let i = -1; i <= 1; i++) {
    s.save(); s.translate(i * W * 0.3, 0); s.scale(1, 0.22);
    const g = s.createRadialGradient(0, 0, 0, 0, 0, W * 0.42);
    g.addColorStop(0, 'rgba(96,108,150,0.055)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    s.fillStyle = g;
    s.beginPath(); s.arc(0, 0, W * 0.42, 0, 7); s.fill();
    s.restore();
  }
  s.restore();
  // 微光の背景銀河(本物の空は遠い銀河で埋まっている)
  const ngal = Math.round(W * H / 6000);
  for (let i = 0; i < ngal; i++) {
    const x = Math.random() * W, y = Math.random() * H;
    const r = rand(1.2, 4.5), tilt = rand(0, 3.14);
    const hue = Math.random();
    const cR = 200 + 55 * (hue < 0.5 ? 1 : 0.4), cG = 205, cB = 200 + 55 * (hue < 0.5 ? 0.4 : 1);
    s.save(); s.translate(x, y); s.rotate(tilt); s.scale(1, rand(0.28, 0.7));
    const g = s.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, `rgba(${cR | 0},${cG},${cB | 0},${rand(0.05, 0.16).toFixed(3)})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    s.fillStyle = g;
    s.beginPath(); s.arc(0, 0, r, 0, 7); s.fill();
    s.restore();
  }
  // 輝星・大きな銀河の滲みは置かない — 固定光は主役の銀河衝突の邪魔になる
}

const F_FOV = 1.45;
function splatStars() {
  // 残光(わずかな映像的な尾)
  for (let i = 0, n = bw * bh; i < n; i++) { accR[i] *= 0.22; accG[i] *= 0.22; accB[i] *= 0.22; }
  const F = bh * F_FOV;
  const cxs = bw * 0.5, cys = bh * 0.5;
  const refD2 = cam.R * cam.R;
  const burstOn = !merged && sb > 0.02;
  const bx = burstOn ? G2.x : 0, by = burstOn ? G2.y : 0, bz = burstOn ? G2.z : 0;
  for (let i = 0; i < N; i++) {
    const dx = px[i] - CB.ex, dy = py[i] - CB.ey, dz = pz[i] - CB.ez;
    const zc = dx * CB.fx + dy * CB.fy + dz * CB.fz;
    if (zc < 0.4) continue;
    const xs = cxs + F * (dx * CB.rx + dy * CB.ry + dz * CB.rz) / zc;
    const ys = cys - F * (dx * CB.ux + dy * CB.uy + dz * CB.uz) / zc;
    if (xs < 1 || xs >= bw - 2 || ys < 1 || ys >= bh - 2) continue;
    const k = kind[i];
    let w = ((k === 2 || k === 5) ? 2.4 : (k === 1 || k === 4) ? 1.25 : 1.0) * bri[i];
    // 近接時、相手核のそば(潮汐圧縮域)だけ若い星が燃え上がる
    if (burstOn) {
      const ddx = px[i] - bx, ddy = py[i] - by, ddz = pz[i] - bz;
      const q = (ddx * ddx + ddy * ddy + ddz * ddz) * 0.7;
      w *= 1 + sb * ((k === 1 || k === 4) ? 3.0 : 0.5) * Math.exp(-q);
    }
    // 奥行きの陰影(カメラ距離に対する相対 — 絶対距離での減光は誤り)
    let df = refD2 * 0.9 / (zc * zc + 0.5);
    if (df > 2.2) df = 2.2; else if (df < 0.22) df = 0.22;
    w *= TUNE.EXPOSURE * df;
    const c = COLS[k];
    const x0 = xs | 0, y0 = ys | 0;
    // ガウス点像(サブピクセル位置で4×4タップ) — 星が丸く、なめらかに灯る
    const gx = (((xs - x0) * 16) | 0) * 4, gy = (((ys - y0) * 16) | 0) * 4;
    let base = (y0 - 1) * bw + (x0 - 1);
    for (let ty = 0; ty < 4; ty++) {
      const wy = GLUT[gy + ty] * w;
      const r0 = base + ty * bw;
      for (let tx = 0; tx < 4; tx++) {
        const ww = GLUT[gx + tx] * wy;
        accR[r0 + tx] += c[0] * ww;
        accG[r0 + tx] += c[1] * ww;
        accB[r0 + tx] += c[2] * ww;
      }
    }
    // 明るい星はにじむ(ブルーム)
    if (w > 5 && xs > 3 && xs < bw - 5 && ys > 3 && ys < bh - 5) {
      const wb = w * 0.085;
      base = (y0 - 3) * bw + (x0 - 3);
      for (let ty = 0; ty < 4; ty++) {
        const wy = GLUT[gy + ty] * wb;
        const r0 = base + ty * 2 * bw;
        for (let tx = 0; tx < 4; tx++) {
          const ww = GLUT[gx + tx] * wy;
          const o = r0 + tx * 2;
          accR[o] += c[0] * ww; accG[o] += c[1] * ww; accB[o] += c[2] * ww;
        }
      }
    }
  }
  // 現像: Reinhardトーンマップ + 彩度 + 微小ディザ(縞を消す)
  const d = bufImg.data, kk = 0.42, SAT = TUNE.SAT;
  let i = 0;
  for (let y = 0; y < bh; y++) {
    const dy = (y & 3) * 4;
    for (let x = 0; x < bw; x++, i++) {
      const o = i * 4;
      const di = DITHER[dy + (x & 3)];
      if (accR[i] + accG[i] + accB[i] < 0.01) {       // 暗部の高速パス
        const v = di > 0 ? di : 0;
        d[o] = v; d[o + 1] = v; d[o + 2] = v; d[o + 3] = 255;
        continue;
      }
      const tr = kk * accR[i], tg = kk * accG[i], tb = kk * accB[i];
      let r = 255 * tr / (1 + tr) + di;
      let g = 255 * tg / (1 + tg) + di;
      let b = 255 * tb / (1 + tb) + di;
      const av = (r + g + b) * 0.3333;
      r = av + (r - av) * SAT; g = av + (g - av) * SAT; b = av + (b - av) * SAT;
      d[o]     = r < 0 ? 0 : r > 255 ? 255 : r;
      d[o + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
      d[o + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
      d[o + 3] = 255;
    }
  }
  bufCtx.putImageData(bufImg, 0, 0);
}

function projectFull(x, y, z) {
  const dx = x - CB.ex, dy = y - CB.ey, dz = z - CB.ez;
  const zc = dx * CB.fx + dy * CB.fy + dz * CB.fz;
  if (zc < 0.4) return null;
  const F = H * F_FOV;
  return [W * 0.5 + F * (dx * CB.rx + dy * CB.ry + dz * CB.rz) / zc,
          H * 0.5 - F * (dx * CB.ux + dy * CB.uy + dz * CB.uz) / zc, zc];
}

function drawCoreGlow(g) {
  const p = projectFull(g.x, g.y, g.z);
  if (!p) return;
  const R = Math.min(300, (40 + 36 * g.M) * 6.2 / p[2]) * (1 + 0.55 * sb);
  let grad = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], R);
  grad.addColorStop(0, `rgba(255,238,205,${(0.62 + 0.3 * sb).toFixed(3)})`);
  grad.addColorStop(0.22, `rgba(255,196,110,${(0.30 + 0.2 * sb).toFixed(3)})`);
  grad.addColorStop(0.55, 'rgba(255,150,60,0.10)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(p[0], p[1], R, 0, 7); ctx.fill();
  const r2 = Math.max(2.5, R * 0.055);
  grad = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], r2);
  grad.addColorStop(0, 'rgba(255,255,248,0.95)');
  grad.addColorStop(1, 'rgba(255,224,160,0)');
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(p[0], p[1], r2, 0, 7); ctx.fill();
}

function draw() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.drawImage(bgCanvas, 0, 0, W, H);
  ctx.globalCompositeOperation = 'lighter';
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bufCanvas, 0, 0, W, H);
  drawCoreGlow(G1);
  if (!merged) drawCoreGlow(G2);
  ctx.globalCompositeOperation = 'source-over';
  if (fade > 0.002) {
    ctx.fillStyle = `rgba(2,3,8,${Math.min(1, fade).toFixed(3)})`;
    ctx.fillRect(0, 0, W, H);
  }
}


/* ---------------- WebGL2 シネマレンダラ(初期化失敗時はCanvas2Dへ自動退避) ---------------- */
let GLOK = false, gl = null, glDirty = true, RENDER_OFF = false;
let glW = 0, glH = 0, gasW = 0, gasH = 0, frameNo = 0;
let pPoints, pDecay, pTone, vaoPoints, vaoQuad;
let texA, texB, fboA, fboB, texGA, texGB, fboGA, fboGB, texBg, texPuff;
let bufPos, bufCol, bufProp, posStage = null;
const U = {};

const VS_POINTS = `#version 300 es
precision highp float;
in vec3 aPos; in vec3 aCol; in vec2 aProp;
uniform vec3 uEye, uF, uR, uU, uG2;
uniform float uPX, uPY, uPtScale, uRefD2, uSb, uMerged, uPs0sq;
uniform float uMode, uSizeMul, uIntScale, uMaxPs, uYoungAmp, uSizeExp, uStarMin, uGasMax;
out vec3 vCol; out float vI; out vec2 vTexOff; out vec2 vCS;
void main(){
  vec3 d = aPos - uEye;
  float zc = dot(d, uF);
  // 完全分離: 明るい星は鋭い点としてだけ、暗い星は面の光(ガス)としてだけ描く。
  // 同じ星が点と暈の両方を描くと「全光点がぼやけたリング」になる — 実写の見え方はこの分離
  if ((zc < 0.4) || (uMode < 0.5 && aProp.x < uStarMin) ||
      (uMode > 0.5 && uGasMax > 0.0 && aProp.x >= uGasMax)) {
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0); gl_PointSize = 0.0; vCol = vec3(0.0); vI = 0.0; return;
  }
  gl_Position = vec4(dot(d, uR) / zc * uPX, dot(d, uU) / zc * uPY, 0.0, 1.0);
  float w = uMode > 0.5 ? min(aProp.x, 2.6) : aProp.x;
  float young = clamp(aProp.y, 0.0, 1.0);
  float bulge = aProp.y < -0.5 ? 1.0 : 0.0;
  if ((uMode < 1.5 || uMode > 2.5) && uSb > 0.02 && uMerged < 0.5) {
    vec3 dd = aPos - uG2;
    float bst = uSb * mix(0.5, 3.0, young) * exp(-dot(dd, dd) * 0.7);
    w *= 1.0 + bst * (uMode < 0.5 ? 1.0 : uMode > 2.5 ? 2.2 : 0.55);
  }
  float df = clamp(uRefD2 * 0.9 / (zc * zc + 0.5), 0.22, 2.2);
  float ps = clamp(uPtScale * pow(aProp.x, uSizeExp) / zc * uSizeMul, 1.3, uMaxPs);
  gl_PointSize = ps;
  float norm = uMode < 0.5 ? min(1.0, uPs0sq / (ps * ps)) : 1.0;
  vI = 0.30 * w * df * norm * uIntScale;
  if (uMode > 2.5) {                 // HII領域: 若い星団を縁取る電離水素の赤(スターバーストで燃え上がる)
    vI *= young * (1.0 - bulge);
    vCol = vec3(1.0, 0.34, 0.30);
  } else if (uMode > 1.5) {          // ダスト: 光学的厚みτをαに積む(吸収は現像時に乗算)
    vI *= (0.10 + 0.75 * young) * (1.0 - bulge);
    vCol = vec3(0.0);
  } else if (uMode > 0.5) {          // 拡散光: 若い星はHIIのピンクを帯びる
    vI *= max(0.1, 1.0 + uYoungAmp * young);
    vCol = mix(aCol, vec3(1.0, 0.60, 0.64), 0.28 * young);
  } else {
    vCol = aCol;
  }
  float hh = fract(aProp.x * 53.731);
  float cell = floor(hh * 4.0);
  vTexOff = vec2(mod(cell, 2.0), floor(cell * 0.5)) * 0.5;
  float ang = hh * 18.85;
  vCS = vec2(cos(ang), sin(ang));
}`;
const FS_POINTS = `#version 300 es
precision highp float;
in vec3 vCol; in float vI; in vec2 vTexOff; in vec2 vCS;
uniform float uKg, uUseTex, uTexMix, uDustA;
uniform sampler2D uPuff;
out vec4 o;
void main(){
  vec2 q = gl_PointCoord - 0.5;
  vec2 qr = vec2(q.x * vCS.x - q.y * vCS.y, q.x * vCS.y + q.y * vCS.x);
  float g = exp(-dot(qr, qr) * uKg);
  if (uUseTex > 0.5) {
    float a = texture(uPuff, vTexOff + clamp(qr + 0.5, 0.0, 1.0) * 0.5).a;
    g *= mix(1.0, 0.25 + 1.5 * a, uTexMix);   // 粒立ちの強さ — 弱いほど滑らかな面の光
  }
  float e = vI * g;
  o = mix(vec4(vCol * e, 0.0), vec4(0.0, 0.0, 0.0, e), uDustA);   // ダストはαへ(τの蓄積)
}`;
const VS_QUAD = `#version 300 es
precision highp float;
const vec2 P[3] = vec2[3](vec2(-1., -1.), vec2(3., -1.), vec2(-1., 3.));
out vec2 vUv;
void main(){ vec2 p = P[gl_VertexID]; vUv = p * 0.5 + 0.5; gl_Position = vec4(p, 0., 1.); }`;
const FS_DECAY = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uPrev; uniform float uDecay;
void main(){ o = texture(uPrev, vUv) * uDecay; }`;
const FS_TONE = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uHdr, uBg, uGas;
uniform vec2 uRes;
uniform vec4 uCoreA, uCoreB;
uniform vec3 uTintA, uTintB;
uniform float uExp, uSat, uFade, uT;
vec3 glow(vec2 p, vec4 c, vec3 tint){
  if (c.w <= 0.0) return vec3(0.0);
  float d = length(p - c.xy) / max(c.z, 1.0);
  float g = exp(-d * d * 4.5) * 0.85 + 0.16 / (1.0 + d * d * 9.0);
  float nuc = exp(-d * d * 240.0) * 2.2;
  return tint * (c.w * g) + vec3(1.0, 0.99, 0.95) * (c.w * nuc);
}
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec2 fpx = vUv * uRes;
  vec4 gt = texture(uGas, vUv);
  vec3 gas = max(gt.rgb, 0.0);
  gas *= exp(-max(gt.a, 0.0) * vec3(0.50, 0.75, 1.05));   // ダスト吸収 — 青ほど強く、赤茶の暗黒帯になる
  gas /= 1.0 + 0.35 * dot(gas, vec3(0.30, 0.45, 0.25));   // 銀河面のHDR圧縮 — 中心は飛ばさず淡部は素通し
  vec3 h = max(texture(uHdr, vUv).rgb, 0.0) + gas;
  h += glow(fpx, uCoreA, uTintA);
  h += glow(fpx, uCoreB, uTintB);
  h *= uExp;
  vec3 m = h / (1.0 + h);
  float av = (m.r + m.g + m.b) / 3.0;
  float satL = uSat * (1.75 - 1.6 * smoothstep(0.05, 0.85, av));
  m = av + (m - av) * satL;
  vec3 col = clamp(texture(uBg, vUv).rgb + m, 0.0, 1.0);
  col += (hash(fpx + uT) - 0.5) * (1.6 / 255.0);
  o = vec4(col * uFade, 1.0);
}`;

function makePuffAtlas() {
  const S = 512, C = 256;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const c2 = cv.getContext('2d');
  const img = c2.createImageData(S, S);
  const h2 = (ix, iy) => { const s = Math.sin(ix * 127.1 + iy * 311.7) * 43758.5453123; return s - Math.floor(s); };
  const vn2 = (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    let fx = x - ix, fy = y - iy;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = h2(ix, iy), b = h2(ix + 1, iy), c = h2(ix, iy + 1), d = h2(ix + 1, iy + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  for (let cell = 0; cell < 4; cell++) {
    const ox = (cell % 2) * C, oy = (cell >> 1) * C, seed = cell * 37.7;
    for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) {
      const u = (x + 0.5) / C - 0.5, v = (y + 0.5) / C - 0.5;
      const fall = Math.max(0, 1 - Math.sqrt(u * u + v * v) * 2);
      let nn = 0, amp = 1, f = 3.5, tot = 0;
      for (let o = 0; o < 3; o++) {
        nn += amp * vn2(u * f + seed, v * f + seed * 1.7);
        tot += amp; amp *= 0.55; f *= 2.1;
      }
      nn /= tot;
      const a = Math.pow(fall, 1.5) * (0.35 + 0.65 * nn);
      const i = ((oy + y) * S + ox + x) * 4;
      img.data[i] = 255; img.data[i + 1] = 255; img.data[i + 2] = 255;
      img.data[i + 3] = Math.max(0, Math.min(255, a * 255));
    }
  }
  c2.putImageData(img, 0, 0);
  return cv;
}
function glCompile(type, s) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, s);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
    throw new Error('shader: ' + gl.getShaderInfoLog(sh));
  return sh;
}
function glProgram(vs, fs, binds) {
  const p = gl.createProgram();
  gl.attachShader(p, glCompile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, glCompile(gl.FRAGMENT_SHADER, fs));
  if (binds) for (const [i, n] of binds) gl.bindAttribLocation(p, i, n);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error('link: ' + gl.getProgramInfoLog(p));
  return p;
}
function uloc(p, names, tag) {
  U[tag] = {};
  gl.useProgram(p);
  for (const n of names) U[tag][n] = gl.getUniformLocation(p, n);
}
function mkTarget(w, h, linear) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
  const filt = linear ? gl.LINEAR : gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filt);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filt);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const f = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, f);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('fbo');
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { t, f };
}
function glResize() {
  glW = Math.max(2, Math.round(W * DPR * (TUNE.SSAA || 1)));
  glH = Math.max(2, Math.round(H * DPR * (TUNE.SSAA || 1)));
  if (texA) {
    gl.deleteTexture(texA); gl.deleteFramebuffer(fboA);
    gl.deleteTexture(texB); gl.deleteFramebuffer(fboB);
  }
  const A = mkTarget(glW, glH), B = mkTarget(glW, glH);
  texA = A.t; fboA = A.f; texB = B.t; fboB = B.f;
  glResizeGas();
  gl.bindTexture(gl.TEXTURE_2D, texBg);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bgCanvas);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.viewport(0, 0, glW, glH);
}
function glResizeGas() {
  const gr = TUNE.GAS_RES || 3;
  gasW = Math.max(2, Math.round(glW / gr));
  gasH = Math.max(2, Math.round(glH / gr));
  if (texGA) {
    gl.deleteTexture(texGA); gl.deleteFramebuffer(fboGA);
    gl.deleteTexture(texGB); gl.deleteFramebuffer(fboGB);
  }
  const GA = mkTarget(gasW, gasH, true), GB = mkTarget(gasW, gasH, true);
  texGA = GA.t; fboGA = GA.f; texGB = GB.t; fboGB = GB.f;
}
function initGL() {
  try {
    gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, preserveDrawingBuffer: false });
    if (!gl) return false;
    if (!gl.getExtension('EXT_color_buffer_float')) { gl = null; return false; }
    pPoints = glProgram(VS_POINTS, FS_POINTS, [[0, 'aPos'], [1, 'aCol'], [2, 'aProp']]);
    uloc(pPoints, ['uEye', 'uF', 'uR', 'uU', 'uG2', 'uPX', 'uPY', 'uPtScale', 'uRefD2', 'uSb', 'uMerged', 'uPs0sq', 'uMode', 'uSizeMul', 'uIntScale', 'uMaxPs', 'uKg', 'uUseTex', 'uPuff', 'uYoungAmp', 'uSizeExp', 'uTexMix', 'uDustA', 'uStarMin', 'uGasMax'], 'pt');
    pDecay = glProgram(VS_QUAD, FS_DECAY, null);
    uloc(pDecay, ['uPrev', 'uDecay'], 'dk');
    pTone = glProgram(VS_QUAD, FS_TONE, null);
    uloc(pTone, ['uHdr', 'uBg', 'uGas', 'uRes', 'uCoreA', 'uCoreB', 'uTintA', 'uTintB', 'uExp', 'uSat', 'uFade', 'uT'], 'tn');
    vaoQuad = gl.createVertexArray();
    vaoPoints = gl.createVertexArray();
    bufPos = gl.createBuffer(); bufCol = gl.createBuffer(); bufProp = gl.createBuffer();
    texBg = gl.createTexture();
    texPuff = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texPuff);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, makePuffAtlas());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.disable(gl.DEPTH_TEST);
    glResize();
    return true;
  } catch (e) {
    console.error('WebGL2の初期化に失敗 — Canvas2Dへ退避します:', e);
    gl = null;
    return false;
  }
}
function glUpload() {
  if (!posStage || posStage.length !== N * 3) posStage = new Float32Array(N * 3);
  const col = new Float32Array(N * 3), prop = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    const k = kind[i], c = starColor(temp[i]);
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    prop[i * 2] = ((k === 2 || k === 5) ? 2.4 : (k === 1 || k === 4) ? 1.25 : 1.0) * bri[i];
    prop[i * 2 + 1] = (k === 1 || k === 4) ? 1 : (k === 2 || k === 5) ? -1 : 0;
  }
  gl.bindVertexArray(vaoPoints);
  gl.bindBuffer(gl.ARRAY_BUFFER, bufPos);
  gl.bufferData(gl.ARRAY_BUFFER, N * 12, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, bufCol);
  gl.bufferData(gl.ARRAY_BUFFER, col, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, bufProp);
  gl.bufferData(gl.ARRAY_BUFFER, prop, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  glDirty = false;
}
function setCoreUniform(loc, g) {
  const p = projectFull(g.x, g.y, g.z);
  if (!p) { gl.uniform4f(loc, 0, 0, 0, 0); return; }
  const RS = DPR * (TUNE.SSAA || 1);
  const R = Math.min(320, (40 + 36 * g.M) * 3.6 / p[2]) * (1 + 0.55 * sb) * RS;
  gl.uniform4f(loc, p[0] * RS, (H - p[1]) * RS, R, (0.9 + 0.6 * sb) * 1.05);
}
const SPLIT = 1.2;   // 点とガスの分離しきい値(propX) — 低いほど点が増えガスとの分離が顕著に
let sResCur = 1;
function setTarget(w, h) {           // 射影と点サイズ系は描画先バッファの高さ基準
  gl.uniform1f(U.pt.uPX, 2 * F_FOV * h / w);
  gl.uniform1f(U.pt.uPY, 2 * F_FOV);
  const ptScale = h * F_FOV * 0.020;
  gl.uniform1f(U.pt.uPtScale, ptScale);
  const ps0 = ptScale / Math.max(2, cam.R);
  gl.uniform1f(U.pt.uPs0sq, Math.max(2.0, ps0 * ps0));
  sResCur = h / 1080;
}
function drawPass(mode, sizeMul, intScale, kg, maxPs, useTex, youngAmp, texMix, sizeExp, dustA, starMin, gasMax) {
  gl.uniform1f(U.pt.uMode, mode);
  gl.uniform1f(U.pt.uSizeMul, sizeMul);
  gl.uniform1f(U.pt.uIntScale, intScale);
  gl.uniform1f(U.pt.uKg, kg);
  gl.uniform1f(U.pt.uMaxPs, maxPs * sResCur);
  gl.uniform1f(U.pt.uUseTex, useTex);
  gl.uniform1f(U.pt.uYoungAmp, youngAmp);
  gl.uniform1f(U.pt.uTexMix, texMix);
  gl.uniform1f(U.pt.uSizeExp, sizeExp);
  gl.uniform1f(U.pt.uDustA, dustA || 0);
  gl.uniform1f(U.pt.uStarMin, starMin || 0);
  gl.uniform1f(U.pt.uGasMax, gasMax || 0);
  gl.drawArrays(gl.POINTS, 0, N);
}
function renderGL() {
  if (glDirty) glUpload();
  for (let i = 0; i < N; i++) {
    posStage[i * 3] = px[i]; posStage[i * 3 + 1] = py[i]; posStage[i * 3 + 2] = pz[i];
  }
  gl.bindVertexArray(vaoPoints);
  gl.bindBuffer(gl.ARRAY_BUFFER, bufPos);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, posStage);
  frameNo++;
  // 1) 星バッファはクリア(残光なし=完全に締まった点、フル解像度の減衰パス分のGPUも節約)
  gl.disable(gl.BLEND);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fboB);
  gl.viewport(0, 0, glW, glH);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  // ガスバッファのみ残光の減衰: prev → curr(低解像度なので安価)
  gl.useProgram(pDecay);
  gl.bindVertexArray(vaoQuad);
  gl.activeTexture(gl.TEXTURE0);
  gl.uniform1i(U.dk.uPrev, 0);
  gl.uniform1f(U.dk.uDecay, 0.22);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fboGB);
  gl.viewport(0, 0, gasW, gasH);
  gl.bindTexture(gl.TEXTURE_2D, texGA);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  // 2) 光の層をHDR加算: ガス4層は低解像度バッファへ、星のみフル解像度へ
  gl.useProgram(pPoints);
  gl.bindVertexArray(vaoPoints);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);
  gl.uniform3f(U.pt.uEye, CB.ex, CB.ey, CB.ez);
  gl.uniform3f(U.pt.uF, CB.fx, CB.fy, CB.fz);
  gl.uniform3f(U.pt.uR, CB.rx, CB.ry, CB.rz);
  gl.uniform3f(U.pt.uU, CB.ux, CB.uy, CB.uz);
  gl.uniform1f(U.pt.uRefD2, cam.R * cam.R);
  gl.uniform1f(U.pt.uSb, sb);
  gl.uniform1f(U.pt.uMerged, merged ? 1 : 0);
  if (merged) gl.uniform3f(U.pt.uG2, 0, 0, 0);
  else gl.uniform3f(U.pt.uG2, G2.x, G2.y, G2.z);
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, texPuff);
  gl.uniform1i(U.pt.uPuff, 2);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fboGB);
  gl.viewport(0, 0, gasW, gasH);
  setTarget(gasW, gasH);
  drawPass(2, 4.0, TUNE.DUST * 0.074, 5.0, 72, 1, 0.0, 1.0, 0.5, 1, 0, SPLIT);    // ダスト(τ蓄積→乗算吸収)
  drawPass(1, 4.0, TUNE.GLOW * 0.036, 7.0, 48, 1, 0.25, 0.65, 0.5, 0, 0, SPLIT);  // 中間構造(広く薄く — 点のカビ化防止)
  drawPass(1, 5.5, TUNE.GLOW * 0.038, 5.5, 64, 1, 0.25, 0.55, 0.5, 0, 0, SPLIT);  // 構造の拡散光(雲の濃淡)
  drawPass(1, 11.0, TUNE.GLOW * 0.021, 6.0, 90, 1, -0.55, 0.45, 0.5, 0, 0, SPLIT);// 淡いハロー(古い星の光)
  gl.bindFramebuffer(gl.FRAMEBUFFER, fboB);
  gl.viewport(0, 0, glW, glH);
  setTarget(glW, glH);
  drawPass(0, 1.0, 2.4, 52.0, 8, 0, 0.0, 0.0, 0.28, 0, SPLIT, 0); // 星(暈なしの鋭い点光源)
  drawPass(3, 1.0, 1.0, 52.0, 8, 0, 0.0, 0.0, 0.28, 0, 0, 0);     // HII=赤い星(白い星と同サイズの鋭い点)
  gl.disable(gl.BLEND);
  // 3) 現像して画面へ(星フル解像度 + ガスLINEARアップサンプル)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, glW, glH);
  gl.useProgram(pTone);
  gl.bindVertexArray(vaoQuad);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texB);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, texBg);
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, texGB);
  gl.uniform1i(U.tn.uHdr, 0);
  gl.uniform1i(U.tn.uBg, 1);
  gl.uniform1i(U.tn.uGas, 2);
  gl.uniform2f(U.tn.uRes, glW, glH);
  setCoreUniform(U.tn.uCoreA, G1);
  if (merged) gl.uniform4f(U.tn.uCoreB, 0, 0, 0, 0);
  else setCoreUniform(U.tn.uCoreB, G2);
  gl.uniform3f(U.tn.uTintA, 1.0, 0.80, 0.55);
  gl.uniform3f(U.tn.uTintB, 0.96, 0.92, 0.84);
  gl.uniform1f(U.tn.uExp, TUNE.EXPOSURE * (merged ? 1.22 : 1.0));
  gl.uniform1f(U.tn.uSat, TUNE.SAT);
  gl.uniform1f(U.tn.uFade, Math.max(0, 1 - fade));
  gl.uniform1f(U.tn.uT, frameNo % 977);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  // ピンポン交換(星・ガスの両対)
  let tt = texA; texA = texB; texB = tt;
  tt = fboA; fboA = fboB; fboB = tt;
  tt = texGA; texGA = texGB; texGB = tt;
  tt = fboGA; fboGA = fboGB; fboGB = tt;
}

/* ---------------- ループ ---------------- */
let lastTs = null, dtEMA = 16, qCool = 0, dtS = 1 / 60;
function loop(ts) {
  if (lastTs === null) lastTs = ts;
  const dt = Math.min(0.05, Math.max(0, (ts - lastTs) / 1000));
  lastTs = ts;
  dtS += (dt - dtS) * 0.12;   // 平滑化した実効dt — rAFのジッタを運動に乗せない
  // 画質ガバナ: 端末性能に合わせて星バッファの解像度を自動調整
  dtEMA += (Math.min(80, Math.max(1, dt * 1000)) - dtEMA) * 0.05;
  if (TUNE.AUTO_Q && ++qCool > 300) {
    qCool = 0;
    if (GLOK) {
      // 早送り中は切替を凍結(解像度ポップがカクつきに見える)。ヒステリシスも広め
      if (warp < 1.5) {
        if (dtEMA > 24 && TUNE.GAS_RES !== 4) { TUNE.GAS_RES = 4; glResizeGas(); }
        else if (dtEMA < 12 && TUNE.GAS_RES !== 3) { TUNE.GAS_RES = 3; glResizeGas(); }
      }
    } else if (dtEMA > 26 && TUNE.BUDGET > 900000) { TUNE.BUDGET *= 0.72; setupBuffers(); }
    else if (dtEMA < 12.5 && TUNE.BUDGET < 2300000) { TUNE.BUDGET *= 1.18; setupBuffers(); }
  }

  if (fade < 1 || phase !== 'fadeout') {
    // 実時間比例の前進(0.48時間単位/秒 × warp): fpsが揺れても体感速度は一定
    // 刻み幅は上限を守って分割(リープフロッグなので分割は等価)
    const total = 2 * DT * 60 * TUNE.SPEED * dtS * (merged ? warp : 1);
    const hmax = !merged ? (coreSep() > SUBSTEP_SEP ? 0.008 : 0.004)
                         : (warp > 1.5 ? 0.012 : 0.004);
    const n = Math.max(1, Math.round(total / hmax));
    const h = total / n;
    for (let s = 0; s < n; s++) step(h);
  }
  if (phase === 'relax') {
    relaxT += dt;
    // 収束ゲート(シミュレーション時間基準): 破片ハロー(80%分位)が落下しきって変化が止まったら「1つの銀河」
    // (実測: p80は合体+20で最大12〜14 → +80〜120で4.5〜5.5に収束、その後は微振動が物理的な実態)
    if (simT - extChkT > 12) {
      extSettled = extChk > 0 && Math.abs(extCam - extChk) / extChk < 0.15;
      extChk = extCam; extChkT = simT;
    }
    // 演出: 激動8秒(等速) → 漸進加速の早送りで収縮 → 1つの銀河に固まったら漸進減速 → 堪能 → 終了
    let wTarget = 1;
    if (savorT > 0) {
      savorT += dt;
      if (savorT > TUNE.SAVOR_S) phase = 'fadeout';
    } else if (relaxT > 8) {
      const compact = extSettled && extCam < 6.0;
      if (compact || simT - mergeT > 150) {
        if (warp < 1.25) savorT = dt;
      } else {
        wTarget = TUNE.WARP;
      }
    }
    if (relaxT > TUNE.RELAX_S) phase = 'fadeout';   // 安全上限
    // 漸進的な加減速: 指数漸近のみ(階段状の変化を作らない)
    if (wTarget > warp) warp += (wTarget - warp) * Math.min(1, 0.15 * dt);
    else warp += (wTarget - warp) * Math.min(1, 0.35 * dt);
  } else if (phase === 'encounter' && simT > 160) {
    phase = 'fadeout';               // 万一合体に至らない軌道は静かに次の遭遇へ
  }
  if (phase === 'fadeout') {
    fade += dt / 2.4;
    if (fade >= 1) { fade = 1; newEncounter(); }
  } else if (fade > 0) fade = Math.max(0, fade - dt / 1.8);

  if (!Number.isFinite(px[0]) || !Number.isFinite(G1.x)) newEncounter();

  updateCamera(dtS);
  if (GLOK) renderGL();
  else if (!RENDER_OFF) { splatStars(); draw(); }
  requestAnimationFrame(loop);
}

function resize() {
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = W * DPR; canvas.height = H * DPR;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  setupBuffers();
  buildBackground();
  if (GLOK) glResize();
}
window.addEventListener('resize', resize);

resize();
GLOK = initGL();
if (!GLOK) ctx = canvas.getContext('2d');
newEncounter();
requestAnimationFrame(loop);

/* 検証用フック */
window.__ss = {
  cores: () => ({ G1, G2: merged ? null : G2, merged }),
  stars: () => ({ px, py, pz, vx, vy, vz, kind, bri, temp, N }),
  coreSep, step, newEncounter,
  params: () => encounterParams,
  vCirc,
  get sb() { return sb; },
  get simT() { return simT; },
  get gen() { return gen; },
  get phase() { return phase; },
  get warp() { return warp; },
  get ext() { return { ema: extEMA, cam: extCam, settled: extSettled }; },
  rebuild: setupBuffers,
  get renderer() { return GLOK ? 'webgl2' : 'canvas2d'; },
  get view() { return CB; },
  cam,
  set renderOff(v) { RENDER_OFF = !!v; },
  tune: TUNE
};

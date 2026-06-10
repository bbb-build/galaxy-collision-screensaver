'use strict';
/* file:// と https:// で同一ファイルの fps/ジッタを比較測定 (ヘッドレスEdge + CDP) */
const { spawn } = require('child_process');
const http = require('http');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 19223;
const TARGETS = [
  ['file://', 'file:///C:/Users/tajim/galaxy-collision-screensaver/galaxy-collision.html'],
  ['https://', 'https://bbb-build.github.io/galaxy-collision-screensaver/galaxy-collision.html'],
];

function getJson(path) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path }, r => {
      let b = ''; r.on('data', d => b += d); r.on('end', () => res(JSON.parse(b)));
    }).on('error', rej);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function measure(label, url) {
  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu-sandbox', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=C:\\Users\\tajim\\galaxy-collision-screensaver\\verify\\edge-profile-' + (url.startsWith('file') ? 'f' : 'h'),
    '--window-size=1920,1080', '--enable-unsafe-swiftshader',
    `--remote-debugging-port=${PORT}`, url
  ], { stdio: 'ignore' });
  try {
    let targets = null;
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      try { targets = await getJson('/json'); if (targets.find(t => t.type === 'page' && t.url.includes('galaxy-collision'))) break; } catch (e) {}
    }
    const page = targets && targets.find(t => t.type === 'page' && t.url.includes('galaxy-collision'));
    if (!page) { console.error(label, 'FAIL: page target not found'); return null; }
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    const call = (method, params) => new Promise((res, rej) => {
      const i = ++id;
      pending.set(i, res);
      ws.send(JSON.stringify({ id: i, method, params }));
      setTimeout(() => rej(new Error('timeout ' + method)), 30000);
    });
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    };
    await new Promise(r => ws.onopen = r);
    await sleep(4000);   // 起動・初期化待ち
    const ev = async expr => {
      const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      return r.result && r.result.value;
    };
    const renderer = await ev(`window.__ss && window.__ss.renderer`);
    const stats = await ev(`new Promise(res => {
      const dts = []; let last = performance.now(); const t0 = last;
      const tick = () => {
        const now = performance.now(); dts.push(now - last); last = now;
        if (now - t0 < 8000) requestAnimationFrame(tick);
        else {
          dts.sort((a, b) => a - b);
          const q = p => dts[Math.min(dts.length - 1, (dts.length * p) | 0)];
          res({ fps: dts.length / (now - t0) * 1000, p50: q(0.5), p95: q(0.95), p99: q(0.99),
                long25: dts.filter(d => d > 25).length, frames: dts.length });
        }
      };
      requestAnimationFrame(tick);
    })`);
    const glInfo = await ev(`(() => { try {
      const g = document.createElement('canvas').getContext('webgl2');
      const d = g.getExtension('WEBGL_debug_renderer_info');
      return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : g ? 'webgl2 (no debug info)' : 'none';
    } catch (e) { return 'err: ' + e.message; } })()`);
    console.log(`== ${label}`);
    console.log('  renderer =', renderer, '| GPU =', glInfo);
    if (stats) console.log(`  fps(8s) = ${stats.fps.toFixed(1)} | dt p50/p95/p99 = ${stats.p50.toFixed(1)}/${stats.p95.toFixed(1)}/${stats.p99.toFixed(1)} ms | >25ms frames = ${stats.long25}/${stats.frames}`);
    ws.close();
    return stats;
  } finally { edge.kill(); await sleep(800); }
}

(async () => {
  for (const [label, url] of TARGETS) await measure(label, url);
  process.exit(0);
})().catch(e => { console.error('ERROR', e.message); process.exit(1); });

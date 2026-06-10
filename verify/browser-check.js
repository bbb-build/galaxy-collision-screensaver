'use strict';
/* ヘッドレスEdge + CDP で __ss.renderer と fps を実測 */
const { spawn } = require('child_process');
const http = require('http');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 19222;
const URL = 'file:///C:/Users/tajim/Downloads/galaxy-collision%20(6).html';

const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu-sandbox', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=C:\\Users\\tajim\\Downloads\\galaxy-verify\\edge-profile',
  '--window-size=1920,1080', '--enable-unsafe-swiftshader',
  `--remote-debugging-port=${PORT}`, URL
], { stdio: 'ignore' });

function getJson(path) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path }, r => {
      let b = ''; r.on('data', d => b += d); r.on('end', () => res(JSON.parse(b)));
    }).on('error', rej);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let targets = null;
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    try { targets = await getJson('/json'); break; } catch (e) {}
  }
  const page = targets && targets.find(t => t.type === 'page' && t.url.includes('galaxy-collision'));
  if (!page) { console.error('FAIL: page target not found'); edge.kill(); process.exit(1); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const call = (method, params) => new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => rej(new Error('timeout ' + method)), 20000);
  });
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  };
  await new Promise(r => ws.onopen = r);
  await sleep(3000);   // 起動・初期化待ち
  const ev = async expr => {
    const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result.value;
  };
  const renderer = await ev(`window.__ss && window.__ss.renderer`);
  const tune = await ev(`window.__ss && JSON.stringify({N: __ss.tune.N, GAS_RES: __ss.tune.GAS_RES, EXPOSURE: __ss.tune.EXPOSURE})`);
  const fps = await ev(`new Promise(res => {
    let n = 0; const t0 = performance.now();
    const tick = () => { n++; if (performance.now() - t0 < 4000) requestAnimationFrame(tick); else res((n / (performance.now() - t0) * 1000)); };
    requestAnimationFrame(tick);
  })`);
  const glInfo = await ev(`(() => { try {
    const g = document.createElement('canvas').getContext('webgl2');
    const d = g.getExtension('WEBGL_debug_renderer_info');
    return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : g ? 'webgl2 (no debug info)' : 'none';
  } catch (e) { return 'err: ' + e.message; } })()`);
  console.log('__ss.renderer =', renderer);
  console.log('tune =', tune);
  console.log('fps(4s平均) =', fps && fps.toFixed(1));
  console.log('GPU =', glInfo);
  ws.close(); edge.kill();
  process.exit(renderer === 'webgl2' ? 0 : 1);
})().catch(e => { console.error('ERROR', e.message); edge.kill(); process.exit(1); });

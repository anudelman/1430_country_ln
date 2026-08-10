import { chromium } from 'playwright-core';
import { startServer } from './serve.mjs';
const srv = await startServer({ root: new URL('..', import.meta.url).pathname, port: 0 });
const base = typeof srv === 'string' ? srv : (srv.url || `http://127.0.0.1:${srv.port}`);
const b = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader'] });
const p = await b.newPage();
p.on('console', (m) => { if (m.type() === 'error') console.log('[page]', m.text()); });
await p.goto(`${base}/app/index.html?preset=exterior_view_of_front_door&shot=1&quality=high&w=1526&h=1017`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true||window.__BOOT_ERROR__', null, { timeout: 300000 });
const pts = JSON.parse(process.env.PROBE_PTS || '[[1035,521],[900,470],[1300,510],[772,600],[1440,400]]');
const out = await p.evaluate(async (pts) => {
  const THREE = await import('three');
  const app = window.__APP__;
  const size = app.size();
  const rc = new THREE.Raycaster();
  const res = [];
  for (const [x, y] of pts) {
    rc.setFromCamera(new THREE.Vector2((x / size.width) * 2 - 1, -(y / size.height) * 2 + 1), app.camera);
    const hit = rc.intersectObjects(app.scene.children, true).filter((h) => h.object.visible);
    const first = hit.slice(0, 4).map((h) => {
      let n = h.object.name, o = h.object;
      while (!n && o.parent) { o = o.parent; n = o.name; }
      return `${n || '?'} d=${h.distance.toFixed(1)} @${h.point.x.toFixed(2)},${h.point.y.toFixed(2)},${h.point.z.toFixed(2)}`;
    });
    res.push({ px: [x, y], hits: first });
  }
  const lights=[];
  app.scene.traverse((o)=>{ if(o.isLight) lights.push(`${o.type} ${o.name||''} i=${o.intensity} cast=${o.castShadow} pos=${o.position.toArray().map(v=>+v.toFixed(1))}`); });
  const r = app.renderer;
  return { size, camPos: app.camera.position.toArray().map((v) => +v.toFixed(2)),
    shadow: { enabled: r.shadowMap.enabled, type: r.shadowMap.type, exposure: r.toneMappingExposure },
    lights, res };
}, pts);
console.log(JSON.stringify(out, null, 1));
await b.close(); process.exit(0);

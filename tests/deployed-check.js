const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({
    executablePath: '/home/jlbroughton/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(process.env.APP_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => !!(window.__app && window.__app.terrain && window.__app.player),
    null, { timeout: 120000 });
  await page.waitForTimeout(3000);
  const r = await page.evaluate(() => {
    const A = window.__app, t = A.terrain;
    // dig a hole, place the spoil, pack it, check the physics ran
    const x = 12, z = 4;
    let litres = 0;
    for (let i = 0; i < 90; i++) litres += t.dig(x, z, 0.6, { power: 1, hardBias: -0.5, loosen: 1, digMark: 1 }, 1 / 60);
    for (let i = 0; i < 60; i++) t.slump(8);
    const hole = t.heightAt(x, z);
    const base = t.h0[t.idx(Math.round(t.colOf(x)), Math.round(t.rowOf(z)))];
    let used = 0;
    for (let i = 0; i < 8; i++) { used += t.pour(x + 3, z + 3, 0.5, 200, {}); for (let k = 0; k < 6; k++) t.slump(8); }
    for (let i = 0; i < 240; i++) t.pack(x + 3, z + 3, 0.7, { packRate: 285, packMark: 3 }, 1 / 60);
    for (let i = 0; i < 60; i++) t.slump(8);
    t.refreshGeometry();
    const moundTop = t.heightAt(x + 3, z + 3);
    const mBase = t.h0[t.idx(Math.round(t.colOf(x + 3)), Math.round(t.rowOf(z + 3)))];
    // plan round trip
    A.plan.add('lip', 0, 0, 0); A.plan.add('landing', 8, 0, 0);
    const saved = A.save(); const loaded = A.load();
    return { url: location.href, verts: t.posAttr.count, trees: A.treeData.length,
      calls: A.renderer.info.render.calls, tris: A.renderer.info.render.triangles,
      litres, hole: base - hole, mound: moundTop - mBase,
      packed: A.terrain.packedAt(x + 3, z + 3), plan: A.plan.features.length,
      saved, loaded, drawCallsNow: A.renderer.info.render.calls };
  });
  await b.close();
  console.log(JSON.stringify(r, null, 1));
  console.log('errors:', errs.length ? errs.slice(0, 3) : 'none');
  const ok = r.verts > 60000 && r.litres > 20 && r.hole > 0.1 && r.mound > 0.2
    && r.packed > 200 && r.plan === 2 && r.saved && r.loaded && r.drawCallsNow > 0 && errs.length === 0;
  console.log(ok ? 'DEPLOYED BUILD: PASS' : 'DEPLOYED BUILD: FAIL');
  process.exit(ok ? 0 : 1);
})();

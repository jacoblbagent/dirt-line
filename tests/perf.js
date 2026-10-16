const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({
    executablePath: '/home/jlbroughton/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('http://127.0.0.1:5187/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.__app && window.__app.terrain), null, { timeout: 90000 });
  await page.waitForTimeout(4000);
  const r = await page.evaluate(() => {
    const A = window.__app;
    const info = A.renderer.info;
    let sceneryVerts = 0, meshes = 0, instanced = 0;
    A.world.traverse(o => {
      if (o.isMesh || o.isInstancedMesh) {
        meshes++;
        const n = o.geometry.getAttribute('position').count;
        const c = o.isInstancedMesh ? o.count : 1;
        if (o.isInstancedMesh) instanced++;
        sceneryVerts += n * c;
      }
    });
    return {
      renderTris: info.render.triangles, renderCalls: info.render.calls,
      memory: Object.fromEntries(Object.entries(info.memory).map(([k, v]) => [k, v])),
      worldMeshes: meshes, instancedMeshes: instanced, worldVerts: sceneryVerts,
      trees: A.treeData.length,
    };
  });
  console.log(JSON.stringify(r, null, 1));
  await b.close();
})();

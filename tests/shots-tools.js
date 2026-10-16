const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({
    executablePath: '/home/jlbroughton/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await b.newPage({ viewport: { width: 1000, height: 640 } });
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  await page.goto('http://127.0.0.1:5187/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.__app && window.__app.player), null, { timeout: 60000 });
  await page.evaluate(() => {
    document.getElementById('intro').classList.remove('show');
    document.getElementById('hint').classList.remove('show');
    const A = window.__app, t = A.terrain, p = A.player;
    p.pos.set(-4, t.heightAt(-4, 20) + 0.02, 20);
    p.yaw = Math.PI; p.pitch = -0.18;
    // a mound right in front so the tool reads against dirt
    for (let i = 0; i < 10; i++) { t.pour(-4, 15, 1.2, 300, {}); for (let k = 0; k < 4; k++) t.slump(6); }
    for (let i = 0; i < 90; i++) t.pack(-4, 15, 1.5, { packRate: 285, packMark: 3 }, 1 / 60);
    for (let i = 0; i < 90; i++) t.slump(8);
    t.refreshGeometry();
  });
  for (const [i, tool] of ['spade', 'flathead', 'pickaxe', 'rake'].entries()) {
    await page.evaluate((tool) => {
      const A = window.__app;
      A.player.toolIdx = ['spade', 'flathead', 'pickaxe', 'rake'].indexOf(tool);
      // hold the tool mid-swing so the animation pose is visible
      A.state.input.lmb = true;
      A.player.working = true;
      A.state.ready = true;
    }, tool);
    await page.waitForTimeout(1300);
    await page.screenshot({ path: `/tmp/verify/tool-${i}-${tool}.png` });
    await page.evaluate(() => { window.__app.state.input.lmb = false; });
    await page.waitForTimeout(500);
  }
  await b.close();
  console.log('tool shots written');
})();

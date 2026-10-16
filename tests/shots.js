// Capture gameplay screenshots for visual review.
const { chromium } = require('playwright-core');
const CHROME = '/home/jlbroughton/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const URL = process.env.APP_URL || 'http://127.0.0.1:5187/index.html';

const BUILD = `() => {
  const A = window.__app, t = A.terrain;
  // a lip, a table, a landing and a pit — dug and packed like a real build
  const mound = (x, z, r, litres, pack) => {
    const steps = 20;
    for (let i = 0; i < steps; i++) {
      t.pour(x, z, r, litres / steps, {});
      for (let k = 0; k < 3; k++) t.slump(6);
      if (pack) for (let k = 0; k < 30; k++) t.pack(x, z, r * 1.25, { packRate: 285, packMark: 3 }, 1 / 60);
    }
  };
  mound(0, 4, 1.6, 7000, true);          // lip
  for (let i = 0; i < 200; i++) t.slump(10);
  mound(0, -4, 2.6, 6000, true);         // landing
  for (let i = 0; i < 260; i++) t.slump(10);
  mound(-10, 0, 1.3, 2200, false);       // loose spoil heap (not packed yet)
  for (let i = 0; i < 160; i++) t.slump(10);
  // borrow pit
  for (let i = 0; i < 420; i++) {
    t.dig(-6, 9, 1.8, { power: 1.3, hardBias: 0.35, loosen: 2, digMark: 6 }, 1 / 60);
    t.dig(-9, 6.5, 1.6, { power: 1.0, hardBias: -0.4, loosen: 1, digMark: 1 }, 1 / 60);
  }
  for (let i = 0; i < 260; i++) t.slump(10);
  for (let i = 0; i < 40; i++) t.rake(0, 1, 2.4, 1 / 60);
  t.refreshGeometry();
  A.plan.add('lip', 0, 4, 0);
  A.plan.add('landing', 0, -3, 0);
  const f = A.plan.add('pit', -7, 7, 0);
  A.plan.update(0, t, A.player.pos, true);
  t.refreshGeometry();
}`;

(async () => {
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--no-sandbox', '--disable-dev-shm-usage',
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window.__app && window.__app.terrain), null, { timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    document.getElementById('intro').classList.remove('show');
    document.getElementById('hint').classList.remove('show');
  });
  await page.evaluate(eval(BUILD));
  await page.waitForTimeout(2500);

  const look = async (x, z, yaw, pitch, file, tool) => {
    await page.evaluate(({ x, z, yaw, pitch, tool }) => {
      const A = window.__app, p = A.player;
      p.pos.set(x, A.terrain.heightAt(x, z) + 0.02, z);
      p.yaw = yaw; p.pitch = pitch;
      p.toolIdx = Math.max(0, ['spade', 'flathead', 'pickaxe', 'rake'].indexOf(tool || 'spade'));
      A.state.ready = true;
    }, { x, z, yaw, pitch, tool });
    await page.waitForTimeout(1400);
    await page.screenshot({ path: file });
  };

  // standing on the line, lip + landing in front
  await look(0, 12, 0, -0.12, '/tmp/verify/shot-1-line.png', 'flathead');
  // the borrow pit and the loose spoil heap it produced
  await look(-1, 14, -0.45, -0.22, '/tmp/verify/shot-2-pit.png', 'spade');
  // up close on the lip face with the flat head
  await look(3.4, 6.2, -0.85, -0.22, '/tmp/verify/shot-3-lip-face.png', 'flathead');
  // plan mode from above
  await page.keyboard.press('KeyP');
  await page.evaluate(() => { window.__app.planCam.position.set(-6, 30, 26); });
  await page.mouse.move(720, 420);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: '/tmp/verify/shot-4-plan.png' });
  await browser.close();
  console.log('shots written');
})().catch(e => { console.error(e); process.exit(1); });

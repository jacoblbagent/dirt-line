const { chromium } = require('playwright-core');
const CHROME = '/home/jlbroughton/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const OUT = process.env.OUT || '/tmp/verify';
const views = process.argv[2] ? process.argv[2].split(',') : ['one0','one1','one2','one3','one4'];
(async () => {
  const b = await chromium.launch({
    executablePath: CHROME,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await b.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('ERR ' + m.text().slice(0, 160)); });
  await page.goto('http://127.0.0.1:5187/tests/gallery.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!window.__gallery, null, { timeout: 90000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => { window.__report(false); window.__labels(false); });
  for (const v of views) {
    await page.evaluate(v => window.setView(v), v);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/m-${v}.png` });
  }
  console.log(errs.length ? [...new Set(errs)].slice(0, 4).join('\n') : 'no errors');
  await b.close();
})();

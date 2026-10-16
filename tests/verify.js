// Headless verification for Dirt Line: real mechanics through the app's debug handle.
const { chromium } = require('playwright-core');

const CHROME = '/home/jlbroughton/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const URL = process.env.APP_URL || 'http://127.0.0.1:5187/index.html';

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  → ' + detail : ''));
};

// shared in-page measurement of a built pile. Uses volume-equivalent radius so
// the shape metric is immune to a bit of spoil running off downhill.
const MEASURE = `(t, x, z, litres) => {
  const base = t.h0[t.idx(Math.round(t.colOf(x)), Math.round(t.rowOf(z)))];
  const lift = t.heightAt(x, z) - base;
  const V = litres / 1000 / 1.25;
  const effR = Math.sqrt(V / (Math.PI * Math.max(lift, 0.01)));
  // steepest angle of the pile's own surface (only where we actually added dirt)
  let maxSlope = 0;
  for (let dz = -4; dz <= 4; dz += 0.25) for (let dx = -4; dx <= 4; dx += 0.25) {
    const hx = x + dx, hz = z + dz;
    const b2 = t.h0[t.idx(Math.round(t.colOf(hx)), Math.round(t.rowOf(hz)))];
    if (t.heightAt(hx, hz) - b2 > 0.05) maxSlope = Math.max(maxSlope, t.slopeAt(hx, hz));
  }
  return { lift, effR, steep: lift / effR, maxSlope };
}`;

(async () => {
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--no-sandbox', '--disable-dev-shm-usage',
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const logs = [];
  page.on('console', m => { if (m.type() === 'error') logs.push(`[error] ${m.text()}`); });
  page.on('pageerror', e => logs.push(`[PAGEERROR] ${e.message}`));
  page.on('requestfailed', r => logs.push(`[REQFAIL] ${r.url()} ${r.failure() && r.failure().errorText}`));

  await page.goto(URL, { waitUntil: 'load' });
  // Playwright's locator actionability check gets confused by #hud's
  // pointer-events:none, so drive the buttons with real mouse clicks at their
  // centre — which is what a user actually does, and what the app must handle.
  const clickSel = async (sel) => {
    const box = await page.$eval(sel, el => {
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await page.mouse.click(box.x, box.y);
    await page.waitForTimeout(180);
  };

  await page.waitForFunction(() => !!(window.__app && window.__app.terrain && window.__app.player), null,
    { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2000);

  const boot = await page.evaluate(() => {
    const box = [...document.querySelectorAll('div')].find(d => d.style && d.style.background === 'rgb(179, 38, 30)');
    return {
      hasApp: !!window.__app,
      three: typeof window.THREE,
      rev: window.THREE && window.THREE.REVISION,
      meta: !!window.__app.THREE,
      verts: window.__app.terrain ? window.__app.terrain.posAttr.count : 0,
      trees: window.__app.treeData ? window.__app.treeData.length : 0,
      errbox: box ? box.textContent.slice(0, 400) : null,
      drawCalls: window.__app.renderer ? window.__app.renderer.info.render.calls : 0,
      tris: window.__app.renderer ? window.__app.renderer.info.render.triangles : 0,
      mode: window.__app.mode,
      loadingGone: document.getElementById('loading').classList.contains('gone'),
    };
  });
  check('app booted with no error overlay', boot.hasApp && !boot.errbox, boot.errbox || '');
  check('THREE loaded as an ES module', boot.three === 'object' && boot.rev === '160', 'r' + boot.rev);
  check('terrain heightfield built', boot.verts > 60000, boot.verts + ' verts');
  check('trees scattered, room left for lines', boot.trees > 60 && boot.trees < 900, boot.trees + ' trees');
  check('loading screen clears', boot.loadingGone);
  check('renderer draws the world', boot.drawCalls > 0 && boot.tris > 10000,
    `${boot.drawCalls} calls / ${boot.tris} tris`);

  // ---------- digging ----------
  const dig = await page.evaluate(() => {
    const A = window.__app, t = A.terrain, p = A.player;
    const x = 0, z = 10;
    const before = t.heightAt(x, z);
    p.load = 0;
    let litres = 0;
    for (let i = 0; i < 60; i++) litres += t.dig(x, z, 0.55, { power: 1, hardBias: -0.5, loosen: 1, digMark: 1 }, 1 / 60);
    t.slump(30); t.refreshGeometry();
    const soft = t.heightAt(x, z);
    // same effort on compacted ground with the pick axe (hardBias) vs the spade
    const hard = t.hd[t.idx(t.colOf(x + 4), t.rowOf(z + 4))];
    return { before, soft, litres, packed: t.packedAt(x, z), hard, digsNow: t.mk[t.idx(t.colOf(x), t.rowOf(z))] };
  });
  check('spade digs a hole', dig.soft < dig.before - 0.05,
    `${dig.before.toFixed(3)} → ${dig.soft.toFixed(3)} m`);
  check('excavated spoil is accounted for', dig.litres > 8, dig.litres.toFixed(1) + ' L recovered');
  check('digging disturbs (unpacks) the ground', dig.packed < 90, 'packed ' + dig.packed);
  check('dug ground carries the spade mark', dig.digsNow === 1, 'mark ' + dig.digsNow);

  // pick axe should out-dig the flat head in compacted ground
  const toolBias = await page.evaluate(() => {
    const A = window.__app, t = A.terrain;
    const run = (tool, x, z) => {
      // make sure that spot is hard, untouched ground
      const i = t.idx(t.colOf(x), t.rowOf(z));
      t.hd[i] = 230; t.p[i] = 200;
      let h0 = t.h[i], total = 0;
      for (let k = 0; k < 40; k++) total += t.dig(x, z, 0.5, tool, 1 / 60);
      return { drop: h0 - t.h[i], total };
    };
    const pick = run({ power: 1.6, hardBias: 0.95, loosen: 2.6, digMark: 6 }, 14, 6);
    const flat = run({ power: 0.45, hardBias: -0.3, loosen: 0.4, digMark: 1 }, 16, 6);
    const spade = run({ power: 1.0, hardBias: -0.5, loosen: 1, digMark: 1 }, 18, 6);
    t.refreshGeometry();
    return { pick: pick.drop, flat: flat.drop, spade: spade.drop };
  });
  check('pick axe breaks hard ground faster than flat head',
    toolBias.pick > toolBias.flat * 3 && toolBias.pick > toolBias.spade,
    `pick ${toolBias.pick.toFixed(3)} m vs spade ${toolBias.spade.toFixed(3)} vs flat ${toolBias.flat.toFixed(3)}`);

  // ---------- loose dirt slumps; volume conserved ----------
  const slump = await page.evaluate(() => {
    const A = window.__app, t = A.terrain;
    const x = 20, z = 20;
    const sum = () => { let s = 0; for (let i = 0; i < t.h.length; i++) s += t.h[i]; return s; };
    const s0 = sum();
    t.pour(x, z, 0.45, 900, { mark: 2 });
    const peak = t.heightAt(x, z);
    for (let i = 0; i < 500; i++) t.slump(20);
    const s1 = sum();
    let maxSlope = 0;
    for (let dz = -6; dz <= 6; dz += 0.5) for (let dx = -6; dx <= 6; dx += 0.5)
      maxSlope = Math.max(maxSlope, t.slopeAt(x + dx, z + dz));
    t.refreshGeometry();
    return { peak, settled: t.heightAt(x, z), vol: (s1 - s0) * t.cell * t.cell, maxSlope };
  });
  check('loose spoil falls under gravity', slump.settled < slump.peak - 0.05,
    `peak ${slump.peak.toFixed(2)} → settled ${slump.settled.toFixed(2)} m`);
  check('slumping conserves volume exactly', Math.abs(slump.vol - 900 / 1000 / 1.25) < 0.02,
    slump.vol.toFixed(4) + ' m³ placed (expected ' + (0.9 / 1.25).toFixed(4) + ')');
  check('loose spoil comes to rest at its angle of repose',
    slump.maxSlope < 0.95 && slump.maxSlope > 0.5, 'max slope tan ' + slump.maxSlope.toFixed(2));

  // ---------- packing beats gravity: same volume, steeper stack ----------
  const tower = await page.evaluate((measureSrc) => {
    const A = window.__app, t = A.terrain;
    const measure = eval(measureSrc);
    const LITRES = 330;
    // one narrow dump on the crest of a lip-in-progress, dropped all at once so
    // we can watch gravity take it
    const drop = (x, z) => { t.pour(x, z, 0.38, LITRES, {}); };
    // A: leave it alone — gravity keeps pulling the spoil down
    const ax = -22, az = 22;
    drop(ax, az);
    const fresh = measure(t, ax, az, LITRES);
    for (let i = 0; i < 300; i++) t.slump(10);
    const loose = measure(t, ax, az, LITRES);
    // B: same dump, then pack it in with the flat head — it should hold
    const bx = -27, bz = 22;
    drop(bx, bz);
    for (let i = 0; i < 300; i++) t.pack(bx, bz, 0.65, { packRate: 285, packMark: 3 }, 1 / 60);
    for (let i = 0; i < 300; i++) t.slump(10);
    const packed = measure(t, bx, bz, LITRES);
    t.refreshGeometry();
    return { fresh, loose, packed, packPct: t.packedAt(bx, bz), loosePct: t.packedAt(ax, az),
      mark: t.mk[t.idx(t.colOf(bx), t.rowOf(bz))] };
  }, MEASURE);
  check('loose spoil keeps falling until it finds its repose',
    tower.loose.lift < tower.fresh.lift * 0.92,
    `fresh +${tower.fresh.lift.toFixed(2)} m → slumped +${tower.loose.lift.toFixed(2)} m`);
  check('packing the same dump keeps it standing',
    tower.packed.lift > tower.loose.lift * 1.25,
    `packed +${tower.packed.lift.toFixed(2)} m vs left loose +${tower.loose.lift.toFixed(2)} m (same 330 L)`);
  check('packed dirt holds a much steeper shape than loose spoil',
    tower.packed.steep > tower.loose.steep * 1.25,
    `packed face ${tower.packed.steep.toFixed(2)}:1 vs loose ${tower.loose.steep.toFixed(2)}:1`);
  check('the flat head marks and firms what it packs',
    tower.packPct > 200 && tower.loosePct < 60 && tower.mark === 3,
    `packed ${tower.packPct}%, the one left alone ${tower.loosePct}%, mark ${tower.mark}`);

  // ---------- precision: dump radius controls the shape ----------
  const precision = await page.evaluate((measureSrc) => {
    const A = window.__app, t = A.terrain;
    const measure = eval(measureSrc);
    // same litres, two radii
    for (let i = 0; i < 4; i++) t.pour(-34, -6, 0.25, 120, {});
    for (let i = 0; i < 40; i++) t.slump(15);
    const tight = measure(t, -34, -6, 480);
    for (let i = 0; i < 4; i++) t.pour(-38, -6, 1.5, 120, {});
    for (let i = 0; i < 40; i++) t.slump(15);
    const wide = measure(t, -38, -6, 480);
    t.refreshGeometry();
    return { tight, wide };
  }, MEASURE);
  check('dump radius gives precise control of the mound',
    precision.tight.lift > precision.wide.lift * 1.5 && precision.tight.effR < precision.wide.effR,
    `r0.25 → +${precision.tight.lift.toFixed(2)} m over ~${precision.tight.effR.toFixed(2)} m · ` +
    `r1.5 → +${precision.wide.lift.toFixed(2)} m over ~${precision.wide.effR.toFixed(2)} m`);

  // ---------- shave ----------
  const shave = await page.evaluate(() => {
    const A = window.__app, t = A.terrain;
    const x = 30, z = -30;
    for (let i = 0; i < 3; i++) t.pour(x, z, 1.0, 400, { mark: 2 });
    for (let i = 0; i < 40; i++) t.slump(30);
    const before = t.heightAt(x, z), pBefore = t.packedAt(x, z);
    const litres = t.shave(x, z, 0.8, 0.055, {});
    t.refreshGeometry();
    return { before, after: t.heightAt(x, z), litres, pBefore, pAfter: t.packedAt(x, z),
      mark: t.mk[t.idx(t.colOf(x), t.rowOf(z))] };
  });
  check('shave takes a thin flat cut', shave.after < shave.before && (shave.before - shave.after) < 0.09,
    `cut ${(shave.before - shave.after).toFixed(3)} m, ${shave.litres.toFixed(1)} L`);
  check('shaving leaves a firmed flat face', shave.pAfter > shave.pBefore && shave.mark === 7,
    `packed ${shave.pBefore} → ${shave.pAfter}, mark ${shave.mark}`);

  // ---------- rake ----------
  const rake = await page.evaluate(() => {
    const A = window.__app, t = A.terrain;
    const x = -30, z = -30;
    const rough = () => {
      const vals = []; let m = 0;
      for (let dz = -2; dz <= 2; dz += 0.5) for (let dx = -2; dx <= 2; dx += 0.5) {
        const v = t.heightAt(x + dx, z + dz); vals.push(v); m += v;
      }
      m /= vals.length;
      let s = 0; for (const v of vals) s += (v - m) * (v - m);
      return Math.sqrt(s / vals.length);
    };
    for (let i = 0; i < 6; i++) t.pour(x + (i % 3) * 1.1 - 1.1, z + ((i / 3) | 0) * 1.1 - 0.5, 0.35, 220, {});
    for (let i = 0; i < 20; i++) t.slump(20);
    const r0 = rough();
    for (let i = 0; i < 90; i++) t.rake(x, z, 1.6, 1 / 60);
    const r1 = rough();
    t.refreshGeometry();
    return { r0, r1, mark: t.mk[t.idx(t.colOf(x), t.rowOf(z))] };
  });
  check('rake levels the surface', rake.r1 < rake.r0 * 0.8,
    `roughness ${rake.r0.toFixed(3)} → ${rake.r1.toFixed(3)} m`);
  check('rake leaves grooming grooves', rake.mark === 5, 'mark ' + rake.mark);

  // ---------- planning ----------
  const plan = await page.evaluate(() => {
    const A = window.__app, pl = A.plan, t = A.terrain;
    const f1 = pl.add('lip', 4, -4, 0);
    const f2 = pl.add('landing', 12, -4, 0);
    pl.update(0, t, A.player.pos, true);
    const prog = pl.progress(t);
    const clone = pl.serialize();
    pl.deserialize(clone);
    const ok = pl.features.length === clone.length &&
      pl.features.every((f, i) => f.type === clone[i].t && Math.abs(f.x - clone[i].x) < 1e-6);
    const ring = f1.ring.geometry.attributes.position;
    // ring must drape over real ground, not sit at y = 0
    const ys = [];
    for (let i = 0; i < ring.count; i++) ys.push(ring.getY(i));
    return { count: pl.features.length, ghosts: pl.group.children.length, progLen: prog.length,
      ok, minY: Math.min(...ys), maxY: Math.max(...ys), maxH: Math.max(...prog.map(p => p.hProg)),
      types: pl.features.map(f => f.type).join(',') };
  });
  check('plan features place with ghost footprints on the ground',
    plan.count >= 2 && plan.ghosts >= 2 && plan.maxY > 0.5,
    `${plan.count} features, draped ring y ${plan.minY.toFixed(2)}..${plan.maxY.toFixed(2)}`);
  check('plan progress evaluates every feature', plan.progLen === plan.count, plan.progLen + ' rows');
  check('plan round-trips through save data', plan.ok, plan.types);
  check('unbuilt features read as 0% built', plan.maxH < 0.2, 'max ' + plan.maxH.toFixed(2));

  // building toward the plan should register progress
  const prog2 = await page.evaluate(() => {
    const A = window.__app, t = A.terrain, pl = A.plan;
    const f = pl.features[0];
    for (let i = 0; i < 12; i++) {
      t.pour(f.x, f.z, 0.8, 260, {});
      for (let i2 = 0; i2 < 40; i2++) t.pack(f.x, f.z, 0.9, { packRate: 285, packMark: 3 }, 1 / 60);
      for (let i2 = 0; i2 < 20; i2++) t.slump(15);
    }
    t.refreshGeometry();
    const prog = pl.progress(t);
    return { h: prog[0].rise, target: prog[0].target, hp: prog[0].hProg, done: prog[0].done };
  });
  check('built dirt registers against the plan',
    prog2.hp > 0.5, `+${prog2.h.toFixed(2)} of ${prog2.target.toFixed(2)} m planned (${(prog2.hp * 100).toFixed(0)}%)`);

  // ---------- player ----------
  const walk = await page.evaluate(() => {
    const A = window.__app, p = A.player;
    p.pos.set(0, A.terrain.heightAt(0, 10) + 0.05, 10);
    p.vel.set(0, 0, 0); p.yaw = Math.PI; p.pitch = 0;
    const start = { x: p.pos.x, z: p.pos.z };
    A.state.input.keys = { KeyW: true };
    for (let i = 0; i < 120; i++) p.update(1 / 60, A.state.input, A.treeData);
    A.state.input.keys = {};
    const eye = p.camY - p.pos.y;
    A.state.input.keys = { Space: true };
    p.update(1 / 60, A.state.input, A.treeData);
    const vy = p.vel.y;
    A.state.input.keys = {};
    return { start, afterW: { x: p.pos.x, z: p.pos.z }, eye, vy };
  });
  const travelled = Math.hypot(walk.afterW.x - walk.start.x, walk.afterW.z - walk.start.z);
  check('walking forward moves the digger', travelled > 1.5, travelled.toFixed(2) + ' m in 2 s');
  check('eye height is a 6 ft human', Math.abs(walk.eye - 1.83) < 0.12, walk.eye.toFixed(2) + ' m');
  check('jumping leaves the ground', walk.vy > 3, 'vy ' + walk.vy.toFixed(2));

  // trees must block the player — pick one well inside the walkable woods
  const collide = await page.evaluate(() => {
    const A = window.__app, p = A.player;
    let tr = null, bd = 1e9;
    for (const t of A.treeData) {
      if (Math.abs(t.x) > 45 || Math.abs(t.z) > 45) continue;   // stay off the map edge
      const d = Math.hypot(t.x - 18, t.z + 14);
      if (d < bd) { bd = d; tr = t; }
    }
    const start = { x: tr.x + 3.0, z: tr.z };
    p.pos.set(start.x, A.terrain.heightAt(start.x, start.z) + 0.05, start.z);
    p.vel.set(0, 0, 0);
    p.yaw = Math.PI / 2;                 // forward = (-1,0,0): straight at the trunk
    A.state.input.keys = { KeyW: true };
    let minD = 1e9, crossed = false;
    for (let i = 0; i < 300; i++) {
      p.update(1 / 60, A.state.input, A.treeData);
      const d = Math.hypot(p.pos.x - tr.x, p.pos.z - tr.z);
      minD = Math.min(minD, d);
      if (p.pos.x < tr.x) crossed = true;
    }
    A.state.input.keys = {};
    return { trunkR: tr.trunkR, minD, crossed, endX: p.pos.x, treeX: tr.x,
      travelled: Math.abs(p.pos.x - start.x) };
  });
  check('trees are solid — you cannot walk through a trunk',
    collide.minD > collide.trunkR + 0.15 && !collide.crossed && collide.travelled < 2.6,
    `stopped ${collide.minD.toFixed(2)} m from the trunk after ${collide.travelled.toFixed(2)} m of pushing`);

  // ---------- carrying dirt the whole way ----------
  const loop = await page.evaluate(() => {
    const A = window.__app, t = A.terrain, p = A.player;
    const x = 6, z = 6;
    p.load = 0; p.stamina = 100;
    p.pos.set(x, t.heightAt(x, z), z);
    p.yaw = Math.PI; p.pitch = -1.3;
    p.brushRadius = 0.6;
    const inp = A.state.input;
    inp.keys = {}; inp.lmb = true; inp.rmb = false; inp.dx = 0; inp.dy = 0;
    for (let i = 0; i < 180; i++) { p.update(1 / 60, inp, A.treeData); p.useTools(1 / 60, inp, null); }
    const dug = p.load;
    t.slump(30); t.refreshGeometry();
    // deepest drop within reach of where the digger stood
    let hole = 0;
    for (let dx = -1.6; dx <= 1.6; dx += 0.2) for (let dz = -1.6; dz <= 1.6; dz += 0.2) {
      const hx = x + dx, hz = z + dz;
      const b2 = t.h0[t.idx(Math.round(t.colOf(hx)), Math.round(t.rowOf(hz)))];
      hole = Math.max(hole, b2 - t.heightAt(hx, hz));
    }
    p.pourRadius = 0.6;
    const tx = x + 3, tz = z + 3;
    p.pos.set(tx, t.heightAt(tx, tz), tz);
    const before = t.heightAt(tx, tz);
    const base = t.h0[t.idx(t.colOf(tx), t.rowOf(tz))];
    p.aim.point.set(tx, t.heightAt(tx, tz), tz); p.aim.hit = true;
    // RMB is the one and only "place dirt" control now
    inp.lmb = false; inp.rmb = true;
    for (let i = 0; i < 400; i++) p.useTools(1 / 60, inp, null);
    for (let i = 0; i < 60; i++) t.slump(20);
    t.refreshGeometry();
    const left = p.load;
    inp.rmb = false;
    return { dug, left, hole, mound: t.heightAt(tx, tz), base, before, stats: p.stats.litresDug };
  });
  check('digging fills the digger\'s load', loop.dug > 30, loop.dug.toFixed(1) + ' L');
  check('pouring empties the load', loop.left < 5, `${loop.dug.toFixed(0)} → ${loop.left.toFixed(1)} L`);
  check('a real hole is left behind', loop.hole > 0.12, loop.hole.toFixed(2) + ' m deep');
  check('placed dirt builds a mound above original ground', loop.mound > loop.base + 0.05,
    `+${(loop.mound - loop.base).toFixed(3)} m`);

  // ---------- wheelbarrow ----------
  const barrow = await page.evaluate(() => {
    const A = window.__app, t = A.terrain, p = A.player;
    const b = p.barrow;
    b.placed = true; b.x = 10; b.z = 30; b.fill = 0;
    p.updateBarrowMesh();
    p.load = 0; p.stamina = 100;
    p.pos.set(10, t.heightAt(10, 30), 30);
    p.yaw = Math.PI; p.pitch = -1.3;
    const inp = A.state.input;
    inp.keys = {}; inp.lmb = true;
    for (let i = 0; i < 240; i++) { p.update(1 / 60, inp, A.treeData); p.useTools(1 / 60, inp, null); }
    inp.lmb = false;
    const fill = b.fill, load = p.load;
    // walk away and pick the barrow up / set it down
    p.pos.set(40, t.heightAt(40, 40), 40);
    p.toggleBarrow();            // out of range → message only
    const stillPlaced = b.placed;
    // load the barrow then tip it out
    b.fill = 300;
    const heightBefore = t.heightAt(10, 30);
    p.pos.set(10, t.heightAt(10, 30), 30);
    p.aim.point.set(10, t.heightAt(10, 30), 30); p.aim.hit = true;
    p.toggleBarrow();
    for (let i = 0; i < 40; i++) t.slump(20);
    t.refreshGeometry();
    let lift = 0;
    for (let dx = -1.5; dx <= 1.5; dx += 0.3) for (let dz = -1.5; dz <= 1.5; dz += 0.3)
      lift = Math.max(lift, t.heightAt(10 + dx, 30 + dz) - heightBefore);
    return { fill, load, stillPlaced, tipped: b.fill, mound: lift };
  });
  check('shovelling near the barrow loads the barrow, not your hands',
    barrow.fill > 100 && barrow.fill > barrow.load, `barrow ${barrow.fill.toFixed(0)} L, hands ${barrow.load.toFixed(1)} L`);
  check('barrow cannot be picked up out of reach', barrow.stillPlaced);
  check('tipping the barrow dumps its load where you aim',
    barrow.tipped < 5 && barrow.mound > 0.05, `${barrow.tipped.toFixed(1)} L left, +${barrow.mound.toFixed(2)} m`);

  // ---------- plan mode camera + render (mouse-driven: the Plan button) ----------
  // the intro overlay is never clicked away in this harness, so clear it first
  await page.evaluate(() => document.getElementById('intro').classList.remove('show'));
  await clickSel('#btnPlan');
  await page.waitForTimeout(900);
  const planMode = await page.evaluate(() => ({
    mode: window.__app.mode,
    calls: window.__app.renderer.info.render.calls,
    camY: window.__app.planCam.position.y,
    uiVisible: document.getElementById('planUI').classList.contains('show'),
    palette: document.querySelectorAll('#planPalette .pt').length,
  }));
  check('the Plan button opens plan mode with the overhead camera',
    planMode.mode === 'plan' && planMode.uiVisible && planMode.camY > 10 && planMode.palette === 6,
    `cam y ${planMode.camY.toFixed(0)} m, ${planMode.palette} feature types`);
  check('plan mode still renders', planMode.calls > 0, planMode.calls + ' draw calls');
  await clickSel('#btnPlanDone');
  await page.waitForTimeout(500);
  const back = await page.evaluate(() => window.__app.mode);
  check('the Done button returns to first person', back === 'play', back);

  // ---------- live frame loop with keyboard input ----------
  await page.evaluate(() => {
    const A = window.__app;
    A.player.pos.set(-4, A.terrain.heightAt(-4, 14), 14);
    A.player.vel.set(0, 0, 0);
    window.__start = { x: A.player.pos.x, z: A.player.pos.z };
  });
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1600);
  await page.keyboard.up('KeyW');
  const live = await page.evaluate(() => {
    const A = window.__app;
    return { moved: Math.hypot(A.player.pos.x - window.__start.x, A.player.pos.z - window.__start.z),
      calls: A.renderer.info.render.calls };
  });
  // software rasterisation runs at a few fps headless, so assert movement at all
  // rather than a distance that assumes 60 fps
  check('the live rAF loop walks the player with real key input', live.moved > 0.005,
    live.moved.toFixed(3) + ' m at a few fps of software raster (not a perf figure)');

  // ---------- plan sheet + help, both driven by buttons ----------
  // exiting plan mode re-locks the pointer; a real player presses Esc to free it
  // for the button bar, so do exactly that before clicking
  await page.evaluate(() => document.exitPointerLock && document.exitPointerLock());
  await page.waitForTimeout(200);
  await clickSel('#btnSheet');
  await page.waitForTimeout(250);
  const sheet = await page.evaluate(() => ({
    shown: document.getElementById('planSheet').classList.contains('show'),
    rows: document.querySelectorAll('#planRows tr').length,
  }));
  check('Plan sheet opens populated from the button', sheet.shown && sheet.rows >= 2, sheet.rows + ' rows');
  // the sheet is click-through, so the button bar is still reachable with it open
  await clickSel('#btnSheetClose');
  await page.waitForTimeout(150);
  const sheetClosed = await page.evaluate(() => document.getElementById('planSheet').classList.contains('show'));
  check('the sheet closes again', !sheetClosed);

  await clickSel('#btnHelp');
  await page.waitForTimeout(250);
  const overlays = await page.evaluate(() => ({
    help: document.getElementById('help').classList.contains('show'),
    hudText: document.getElementById('hudSoil').textContent,
    brush: document.getElementById('hudBrush').textContent,
    mode: document.getElementById('hudMode').textContent,
  }));
  check('Help opens the controls list from the button', overlays.help);
  check('HUD reports live soil state', overlays.hudText.length > 4 && overlays.brush.includes('m'),
    `soil "${overlays.hudText}" · brush ${overlays.brush}`);
  check('HUD spells out what the two mouse buttons do', /LMB/.test(overlays.mode) && /RMB/.test(overlays.mode),
    `"${overlays.mode}"`);
  await clickSel('#help .btns button');
  await page.waitForTimeout(150);

  // ---------- the keyboard is only movement + tool picks ----------
  const keys = await page.evaluate(() => {
    const A = window.__app;
    return { before: A.player.toolIdx };
  });
  await page.keyboard.press('Digit3');
  const toolKey = await page.evaluate(() => window.__app.player.toolIdx);
  check('1-4 still pick tools (the only tool keys left)', toolKey === 2 && keys.before !== toolKey,
    `toolIdx ${keys.before} → ${toolKey}`);
  await page.keyboard.press('Digit1');
  // nothing else on the keyboard should do anything any more
  const dead = await page.evaluate(() => {
    const A = window.__app;
    return { barrow: A.player.barrow.placed, mode: A.mode, help: document.getElementById('help').classList.contains('show') };
  });
  await page.keyboard.press('KeyB');
  await page.keyboard.press('KeyE');
  await page.keyboard.press('KeyP');
  await page.keyboard.press('KeyH');
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => {
    const A = window.__app;
    return { barrow: A.player.barrow.placed, mode: A.mode, help: document.getElementById('help').classList.contains('show') };
  });
  check('the old hotkeys (B/E/P/H) are gone — no stray key does anything',
    after.barrow === dead.barrow && after.mode === dead.mode && after.help === dead.help,
    `barrow ${after.barrow}, mode ${after.mode}, help ${after.help}`);

  // ---------- save / load round trip ----------
  const saveres = await page.evaluate(() => {
    const A = window.__app, t = A.terrain;
    const x = 2, z = 2;
    for (let i = 0; i < 40; i++) t.dig(x, z, 0.6, { power: 1.4, hardBias: 0.5, loosen: 2, digMark: 6 }, 1 / 60);
    t.slump(30); t.refreshGeometry();
    const h1 = t.heightAt(x, z), p1 = t.packedAt(x, z), n = A.plan.features.length;
    const ok = A.save();
    const loaded = A.load();
    return { ok, loaded, h1, h2: A.terrain.heightAt(x, z), n1: n, n2: A.plan.features.length,
      p1, p2: A.terrain.packedAt(x, z) };
  });
  check('save writes the build to storage', saveres.ok);
  check('load restores dig locations exactly', Math.abs(saveres.h1 - saveres.h2) < 0.02,
    `${saveres.h1.toFixed(3)} vs ${saveres.h2.toFixed(3)} m`);
  check('load restores soil state and the plan',
    saveres.n1 === saveres.n2 && Math.abs(saveres.p1 - saveres.p2) < 4,
    `${saveres.n2} features, packed ${saveres.p2}`);
  await page.waitForTimeout(600);
  const afterLoad = await page.evaluate(() => window.__app.renderer.info.render.calls > 0);
  check('keeps rendering after a world reload', afterLoad);

  const uniq = [...new Set(logs.map(l => l.slice(0, 180)))];
  check('no console / page / request errors', uniq.length === 0, uniq.slice(0, 4).join('  ||  '));

  await page.screenshot({ path: '/tmp/verify/dirtline.png' });
  await browser.close();

  const failed = results.filter(r => !r.ok);
  console.log(`==== ${results.length - failed.length}/${results.length} checks passed ====`);
  if (failed.length) console.log('failed: ' + failed.map(f => f.name).join(' | '));
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });

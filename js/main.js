// Dirt Line — first-person trail/jump building sim.
// Bootstrap: scene, procedural world, digger, tools, planning, main loop.
import { CFG, MK, clamp } from './config.js';
import { Terrain } from './terrain.js';
import { TOOLS, ViewModel } from './tools.js';
import { Player } from './player.js';
import { Plan, BuildZone, drawMinimap, FEATURE_TYPES, setShowVolume } from './plan.js';
import { buildLogs, buildStaging, buildRocks } from './props.js';
import { makeMaterials, groupFromParts } from './materials.js';
import { buildPine, buildBroadleaf, buildSnag } from './models-plants.js';
import { xform, mergeGeos } from './geo.js';
import { SFX } from './sfx.js';
import { UI } from './ui.js';

const THREE = window.THREE;

// ---------------------------------------------------------------- helpers
function b64(u8) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  return btoa(s);
}
function unb64(str) {
  const bin = atob(str);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

// march a ray against the heightfield at an arbitrary step/tolerance
function marchTerrain(terrain, origin, dir, maxD, step = 0.12) {
  let lo = 0;
  for (let d = step; d <= maxD; d += step) {
    const x = origin.x + dir.x * d, y = origin.y + dir.y * d, z = origin.z + dir.z * d;
    if (!terrain.inWorld(x, z)) return null;
    const diff = y - terrain.heightAt(x, z);
    if (diff <= 0) {
      let a = lo, b = d;
      for (let i = 0; i < 10; i++) {
        const m = (a + b) / 2;
        const my = origin.y + dir.y * m;
        const mx = origin.x + dir.x * m, mz = origin.z + dir.z * m;
        if (my - terrain.heightAt(mx, mz) > 0) a = m; else b = m;
      }
      return new THREE.Vector3(origin.x + dir.x * b, origin.y + dir.y * b, origin.z + dir.z * b);
    }
    lo = d;
  }
  return null;
}

function skyTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0.00, '#3f6fa8');
  g.addColorStop(0.30, '#7ba7cf');
  g.addColorStop(0.52, '#cfe0ea');
  g.addColorStop(0.62, '#e6ecef');
  g.addColorStop(0.70, '#b9c3ad');
  g.addColorStop(1.00, '#6f7358');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 512);
  // soft sun glow (upper-left of the sky dome)
  const sg = ctx.createRadialGradient(300, 150, 4, 300, 150, 200);
  sg.addColorStop(0, 'rgba(255,250,230,0.95)');
  sg.addColorStop(0.25, 'rgba(255,245,215,0.35)');
  sg.addColorStop(1, 'rgba(255,245,215,0)');
  ctx.fillStyle = sg;
  ctx.fillRect(0, 0, 1024, 512);
  // a few distant clouds
  for (let i = 0; i < 22; i++) {
    const x = (i * 137.5) % 1024;
    const y = 60 + ((i * 61) % 150);
    const r = 30 + (i % 5) * 22;
    const cg = ctx.createRadialGradient(x, y, 2, x, y, r);
    cg.addColorStop(0, 'rgba(255,255,255,0.55)');
    cg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.ellipse(x, y, r * 1.5, r * 0.5, 0, 0, Math.PI * 2); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function facet(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.computeVertexNormals();
  return g;
}

function disposeTree(o) {
  o.traverse(c => {
    if (c.geometry) c.geometry.dispose();
    if (c.material) {
      const mats = Array.isArray(c.material) ? c.material : [c.material];
      mats.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
    }
  });
}

// ---------------------------------------------------------------- state
const state = {
  mode: 'play',
  ready: false,
  paused: false,
  input: { keys: {}, dx: 0, dy: 0, lmb: false, rmb: false, wheel: 0 },
  mouseX: 0, mouseY: 0,
  seed: 1337,
  showMinimap: true,
  showVolume: true,
  planType: 'lip',
  planAngle: 0,
};

let renderer, scene, world, camera, planCam, terrain, plan, player, vm, sfx, ringMesh, sun;
let materials = null, treeVariants = null;
let trees = [], treeData = [];
let uiTimer = 0, mapTimer = 0, saveTimer = 0, fpsFrames = 0, fpsLast = performance.now();
let fpsEl;

// ---------------------------------------------------------------- world build
function buildWorld(seed, opts = {}) {
  // clear old world content (lights / sky live on the scene, not here)
  while (world.children.length) disposeTree(world.children.pop());
  // the view model rides on the camera, so clear that too
  while (camera.children.length) disposeTree(camera.children.pop());
  plan = null;

  terrain = new Terrain();
  terrain.generate(seed);
  world.add(terrain.buildMesh());

  const zone = new BuildZone(-6, -10, 64, 46);
  treeData = terrain.generateTrees(seed, zone);
  buildScenery(treeData, seed);

  plan = new Plan(zone);
  world.add(plan.group);

  player = new Player(world, terrain, materials);
  vm = new ViewModel(camera, materials);
  ringMesh = makeRing();
  world.add(ringMesh);

  if (opts.plan) plan.deserialize(opts.plan);
  state.ready = true;
}

// Detailed procedural trees: a set of unique variants generated once, then every
// placement is baked into one merged mesh per material — all 180-odd trees in
// the world cost two draw calls.
function buildTreeVariants(seed) {
  const out = [];
  for (let i = 0; i < 6; i++) out.push({ kind: 'pine', parts: buildPine(seed + i * 31) });
  for (let i = 0; i < 5; i++) out.push({ kind: 'broad', parts: buildBroadleaf(seed + 100 + i * 37) });
  out.push({ kind: 'broad', parts: buildBroadleaf(seed + 200, { pale: true }) });
  for (let i = 0; i < 2; i++) out.push({ kind: 'snag', parts: buildSnag(seed + 300 + i * 41) });
  return out;
}

function buildScenery(list, seed) {
  // ---------- trees: instanced per variant (14 unique trees, ~180 placements)
  const variants = treeVariants = buildTreeVariants(seed);
  const snagIdx = [], liveIdx = [];
  variants.forEach((v, i) => (v.kind === 'snag' ? snagIdx : liveIdx).push(i));
  const buckets = variants.map(() => []);
  const o = new THREE.Object3D();
  list.forEach((t, i) => {
    const vi = t.dead ? snagIdx[i % snagIdx.length] : liveIdx[i % liveIdx.length];
    const height = (5.2 + t.scale * 4.4) * (t.hMul || 1);
    o.position.set(t.x, terrain.heightAt(t.x, t.z) - 0.15, t.z);
    o.rotation.set(t.lean * 2.5, t.rot, t.lean * 1.5);
    o.scale.setScalar(height);
    o.updateMatrix();
    buckets[vi].push(o.matrix.clone());
  });
  variants.forEach((v, vi) => {
    const mats = buckets[vi];
    if (!mats.length) return;
    for (const [key, geo] of v.parts) {
      const mesh = new THREE.InstancedMesh(geo, materials[key] || materials.bark, mats.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mats.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.instanceMatrix.needsUpdate = true;
      world.add(mesh);
    }
  });

  // ---------- fallen logs + stumps through the woods ----------
  const logList = [];
  for (let i = 0; i < 34; i++) {
    const x = -CFG.HALF + 5 + ((i * 41.3) % (CFG.WORLD - 10));
    const z = -CFG.HALF + 5 + ((i * 67.7) % (CFG.WORLD - 10));
    const inZone = Math.abs(x + 6) < 34 && Math.abs(z + 10) < 25;
    if (inZone) continue;
    if (i % 4 === 0) logList.push({ x, z, r: 0.17 + (i % 5) * 0.04, stump: true, ang: (i * 1.3) % Math.PI });
    else logList.push({ x, z, r: 0.10 + (i % 4) * 0.035, len: 1.6 + (i % 6) * 0.5, ang: (i * 1.7) % Math.PI });
  }
  world.add(buildLogs(terrain, logList, materials));

  // ---------- rocks ----------
  const rockList = [];
  for (let i = 0; i < 170; i++) {
    const x = -CFG.HALF + 4 + (i * 37.7 % (CFG.WORLD - 8));
    const z = -CFG.HALF + 4 + (i * 61.3 % (CFG.WORLD - 8));
    rockList.push({ x, z, s: 0.16 + ((i * 13) % 100) / 100 * 0.55 });
  }
  world.add(buildRocks(terrain, rockList, materials));

  // ---------- staging gear + tools left in the dirt ----------
  world.add(buildStaging(terrain, materials));
}

function makeRing() {
  const SEG = 64;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SEG + 1) * 3), 3));
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false,
  }));
  line.frustumCulled = false;
  line.renderOrder = 70;
  return line;
}

function updateRing() {
  if (!ringMesh) return;
  const aim = player.aim;
  const SEG = 64;
  const r = state.mode === 'play'
    ? (player.mode === 'pour' ? player.pourRadius : player.brushRadius) : state.planBrushR || 0;
  const visible = aim.hit && (state.mode === 'play');
  ringMesh.visible = visible && r > 0;
  if (!ringMesh.visible) return;
  const pos = ringMesh.geometry.attributes.position;
  for (let i = 0; i <= SEG; i++) {
    const a = i / SEG * Math.PI * 2;
    const x = aim.point.x + Math.cos(a) * r;
    const z = aim.point.z + Math.sin(a) * r;
    pos.setXYZ(i, x, terrain.heightAt(x, z) + 0.045, z);
  }
  pos.needsUpdate = true;
  ringMesh.geometry.computeBoundingSphere();
  const mat = ringMesh.material;
  if (player.mode === 'pour') mat.color.setHex(0xffd166);
  else if (player.tool.id === 'flathead') mat.color.setHex(0x9fe8ff);
  else if (player.tool.id === 'rake') mat.color.setHex(0xd8ff9f);
  else if (player.tool.id === 'pickaxe') mat.color.setHex(0xffb3a0);
  else mat.color.setHex(0xffffff);
}

// ---------------------------------------------------------------- save / load
function save() {
  const n = terrain.N * terrain.N;
  const hi = new Int16Array(n);
  for (let i = 0; i < n; i++) hi[i] = Math.round(terrain.h[i] * 200);
  const obj = {
    v: 1, seed: state.seed,
    h: b64(new Uint8Array(hi.buffer)),
    p: b64(terrain.p), g: b64(terrain.g), mk: b64(terrain.mk), hd: b64(terrain.hd),
    plan: plan.serialize(),
    player: { x: player.pos.x, y: player.pos.y, z: player.pos.z, yaw: player.yaw, pitch: player.pitch, load: player.load },
    barrow: { placed: player.barrow.placed, x: player.barrow.x, z: player.barrow.z, fill: player.barrow.fill },
    stats: player.stats,
  };
  try {
    localStorage.setItem('dirtline.save', JSON.stringify(obj));
    player.say('Saved build', 2.2);
    return true;
  } catch (e) { player.say('Save failed (storage full?)'); return false; }
}

function load() {
  const raw = localStorage.getItem('dirtline.save');
  if (!raw) { player.say('No saved build found'); return false; }
  let o;
  try { o = JSON.parse(raw); } catch (e) { player.say('Save file corrupt'); return false; }
  state.seed = o.seed;
  buildWorld(o.seed, { plan: o.plan });
  const n = terrain.N * terrain.N;
  const hBytes = unb64(o.h);
  const hi = new Int16Array(hBytes.buffer, hBytes.byteOffset, n);
  for (let i = 0; i < n; i++) terrain.h[i] = hi[i] / 200;
  terrain.p.set(unb64(o.p)); terrain.g.set(unb64(o.g));
  terrain.mk.set(unb64(o.mk)); terrain.hd.set(unb64(o.hd));
  // mark existing firm ground as already settled (packing is one-time per bit of dirt)
  for (let i = 0; i < n; i++) {
    const c = i % terrain.N, r = (i / terrain.N) | 0;
    const minN = Math.min(terrain.h[Math.max(0, i - 1)], terrain.h[Math.min(n - 1, i + 1)],
      terrain.h[Math.max(0, i - terrain.N)], terrain.h[Math.min(n - 1, i + terrain.N)]);
    terrain.cp[i] = Math.max(0, terrain.h[i] - minN) * 0.07 * (terrain.p[i] / 255);
  }
  terrain.refreshColors();
  terrain.dirtyLo = 0; terrain.dirtyHi = n - 1;
  terrain.refreshGeometry();
  player.pos.set(o.player.x, o.player.y, o.player.z);
  player.yaw = o.player.yaw; player.pitch = o.player.pitch; player.load = o.player.load;
  Object.assign(player.barrow, o.barrow);
  player.updateBarrowMesh();
  if (o.stats) player.stats = o.stats;
  plan.update(0, terrain, player.pos, true);
  player.say('Build loaded', 2.2);
  return true;
}

// ---------------------------------------------------------------- input
function bindInput() {
  const canvas = renderer.domElement;
  const keys = () => state.input.keys;

  window.addEventListener('keydown', e => {
    const k = e.code;
    state.input.keys[k] = true;
    if (['Tab', 'Space', 'KeyP', 'KeyB', 'KeyE', 'KeyH'].includes(k)) e.preventDefault();

    if (k === 'Tab') {
      const sheet = document.getElementById('planSheet');
      UI.showSheet(!sheet.classList.contains('show'));
      UI.renderSheet(plan.progress(terrain));
    }
    if (k === 'KeyH') { state.helpOpen = !state.helpOpen; UI.showHelp(state.helpOpen); }
    if (k === 'KeyP') togglePlanMode();
    if (k === 'KeyE' && state.mode === 'play') { player.cycleMode(); }
    if (k === 'KeyB' && state.mode === 'play') player.toggleBarrow();
    if (k === 'KeyK') save();
    if (k === 'KeyL') load();
    if (k === 'KeyM') state.showMinimap = !state.showMinimap;
    if (k === 'KeyV') { state.showVolume = !state.showVolume; setShowVolume(state.showVolume); }
    if (state.mode === 'play') {
      if (k === 'Digit1') player.toolIdx = 0;
      if (k === 'Digit2') player.toolIdx = 1;
      if (k === 'Digit3') player.toolIdx = 2;
      if (k === 'Digit4') player.toolIdx = 3;
      if (k === 'KeyQ') player.toolIdx = (player.toolIdx + 3) % 4;
      if (k === 'KeyR') player.toolIdx = (player.toolIdx + 1) % 4;
      vm && vm.setTool(player.tool.id);
    } else {
      if (k.startsWith('Digit')) {
        const i = parseInt(k.slice(5), 10) - 1;
        if (FEATURE_TYPES[i]) { state.planType = FEATURE_TYPES[i].id; refreshPalette(); }
      }
      if (k === 'KeyQ') state.planAngle -= 0.18;
      if (k === 'KeyR') state.planAngle += 0.18;
    }
  });
  window.addEventListener('keyup', e => { state.input.keys[e.code] = false; });
  window.addEventListener('blur', () => { state.input.keys = {}; });

  canvas.addEventListener('mousedown', e => {
    if (state.mode === 'play') {
      if (document.pointerLockElement !== canvas) { canvas.requestPointerLock(); sfx.start(); sfx.resume(); return; }
      if (e.button === 0) state.input.lmb = true;
      if (e.button === 2) state.input.rmb = true;
    } else {
      if (e.button === 0) placeFeature();
      if (e.button === 2) {
        if (!plan.removeNearest(state.cursor ? state.cursor.x : 0, state.cursor ? state.cursor.z : 0, 3.2))
          UI.toast('Nothing to remove there');
      }
    }
  });
  window.addEventListener('mouseup', e => {
    if (e.button === 0) state.input.lmb = false;
    if (e.button === 2) state.input.rmb = false;
  });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  window.addEventListener('mousemove', e => {
    if (document.pointerLockElement === canvas && state.mode === 'play') {
      state.input.dx += e.movementX || 0;
      state.input.dy += e.movementY || 0;
    }
    state.mouseX = e.clientX; state.mouseY = e.clientY;
  });
  window.addEventListener('wheel', e => {
    e.preventDefault();
    if (state.mode === 'play') {
      const step = 0.12;
      if (player.mode === 'pour') player.pourRadius = clamp(player.pourRadius + (e.deltaY > 0 ? -step : step), 0.15, 3.2);
      else player.brushRadius = clamp(player.brushRadius + (e.deltaY > 0 ? -step : step) * 1.2, 0.22, 2.6);
    } else {
      const f = state.hovered;
      const target = f || { r: FEATURE_TYPES.find(t => t.id === state.planType).r, h: FEATURE_TYPES.find(t => t.id === state.planType).h };
      if (e.shiftKey) {
        const d = (e.deltaY > 0 ? -0.15 : 0.15);
        target.h = clamp(target.h + d, -4, 4);
      } else {
        const d = (e.deltaY > 0 ? -0.2 : 0.2);
        target.r = clamp(target.r + d, 0.6, 9);
      }
      if (f) { f.dome.scale.set(f.r, f.h < 0 ? 0.001 : f.h, f.r); }
      else { state.planBrushR = target.r; }
      plan.update(0, terrain, player.pos, true);
    }
  }, { passive: false });
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === renderer.domElement;
    document.getElementById('hint').classList.toggle('show', !state.locked && state.mode === 'play');
  });
  window.addEventListener('resize', onResize);
}

function refreshPalette() {
  document.querySelectorAll('#planPalette .pt').forEach(el => {
    el.classList.toggle('sel', el.dataset.type === state.planType);
  });
}

function placeFeature() {
  if (!state.cursor) { UI.toast('Point at the ground first'); return; }
  const f = plan.add(state.planType, state.cursor.x, state.cursor.z, state.planAngle);
  plan.update(0, terrain, player.pos, true);
  const def = plan.typeDef(f.type);
  UI.toast(`${def.name} placed — drag the wheel for radius, Shift+wheel for height, or click a downslope for a landing`);
}

function togglePlanMode() {
  if (state.mode === 'play') {
    state.mode = 'plan';
    document.exitPointerLock();
    UI.showPlanUI(true);
    refreshPalette();
    planCam.position.set(player.pos.x, 62, player.pos.z + 6);
    planCam.lookAt(player.pos.x, terrain.heightAt(player.pos.x, player.pos.z), player.pos.z);
    UI.toast('PLAN MODE — lay out the whole line before you dig. Press P to go back to work.');
    state.planBrushR = undefined;
  } else {
    state.mode = 'play';
    UI.showPlanUI(false);
    renderer.domElement.requestPointerLock();
  }
}

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  planCam.aspect = w / h; planCam.updateProjectionMatrix();
}

// ---------------------------------------------------------------- plan cursor
function updatePlanCursor() {
  const rect = renderer.domElement.getBoundingClientRect();
  const nx = ((state.mouseX - rect.left) / rect.width) * 2 - 1;
  const ny = -((state.mouseY - rect.top) / rect.height) * 2 + 1;
  const origin = planCam.position.clone();
  const dir = new THREE.Vector3(nx, ny, 0.5).unproject(planCam).sub(origin).normalize();
  const hit = marchTerrain(terrain, origin, dir, 260, 0.6);
  state.cursor = hit;
  // hovered feature?
  let hov = null, bd = 1e9;
  if (hit) {
    for (const f of plan.features) {
      const d = Math.hypot(f.x - hit.x, f.z - hit.z);
      if (d < Math.max(2, f.r) && d < bd) { bd = d; hov = f; }
    }
  }
  state.hovered = hov;
  const def = hov ? plan.typeDef(hov.type) : FEATURE_TYPES.find(t => t.id === state.planType);
  const r = hov ? hov.r : (state.planBrushR || def.r);
  const hh = hov ? hov.h : def.h;
  if (state.mode === 'plan') {
    document.getElementById('planInfo').innerHTML =
      (hov ? `<b>${def.name} #${hov.id}</b> — wheel: radius · Shift+wheel: height · Q/R: rotate · RMB: delete`
        : `<b>${def.name}</b> — click to place · wheel: radius · Shift+wheel: height · Q/R: rotate`) +
      `<br><span>r ${r.toFixed(1)} m · h ${Math.abs(hh).toFixed(1)} m · heading ${(state.planAngle * 180 / Math.PI).toFixed(0)}°</span>`;
  }
  // brush ring preview in plan mode
  const SEG = 64;
  const vis = !!hit && state.mode === 'plan';
  ringMesh.visible = vis;
  if (vis) {
    const posAttr = ringMesh.geometry.attributes.position;
    for (let i = 0; i <= SEG; i++) {
      const a = i / SEG * Math.PI * 2;
      const x = hit.x + Math.cos(a) * r;
      const z = hit.z + Math.sin(a) * r;
      posAttr.setXYZ(i, x, terrain.heightAt(x, z) + 0.08, z);
    }
    posAttr.needsUpdate = true;
    ringMesh.geometry.computeBoundingSphere();
    ringMesh.material.color.setHex(def.color);
  }
}

// ---------------------------------------------------------------- main loop
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (!state.ready || !terrain || !player || !plan || !vm) return;

  if (state.mode === 'plan') {
    // pan / zoom the overhead plan camera; cursor (mouse) works without pointer lock
    if (document.pointerLockElement) document.exitPointerLock();
    const k = state.input.keys;
    const sp = (k['ShiftLeft'] ? 46 : 22) * dt;
    if (k['KeyW'] || k['ArrowUp']) planCam.position.z -= sp;
    if (k['KeyS'] || k['ArrowDown']) planCam.position.z += sp;
    if (k['KeyA'] || k['ArrowLeft']) planCam.position.x -= sp;
    if (k['KeyD'] || k['ArrowRight']) planCam.position.x += sp;
    planCam.position.y = clamp(planCam.position.y + (k['Space'] ? 30 * dt : 0) - (k['ControlLeft'] ? 30 * dt : 0), 8, 130);
    planCam.position.x = clamp(planCam.position.x, -CFG.HALF + 6, CFG.HALF - 6);
    planCam.position.z = clamp(planCam.position.z, -CFG.HALF + 6, CFG.HALF - 6);
    planCam.lookAt(planCam.position.x, terrain.heightAt(planCam.position.x, planCam.position.z), planCam.position.z);
    updatePlanCursor();
  } else {
    player.update(dt, state.input, treeData);
    player.useTools(dt, state.input, sfx);
    vm.setTool(player.tool.id);
    vm.update(dt, {
      speed: Math.hypot(player.vel.x, player.vel.z),
      working: player.working,
      period: player.tool.swing,
    });
    camera.position.set(player.pos.x, player.camY, player.pos.z);
    camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
    updateRing();
    if (player.messageT > 0 && player.message) UI.toast(player.message, 0.6);
  }

  // soil physics + GPU sync
  terrain.slump(CFG.SLUMP_MS);
  terrain.refreshGeometry();
  plan.update(dt, terrain, state.mode === 'plan' ? planCam.position : player.pos);

  // sun follows for stable shadows over the play area
  const cx = state.mode === 'plan' ? planCam.position.x : player.pos.x;
  const cz = state.mode === 'plan' ? planCam.position.z : player.pos.z;
  sun.position.set(cx + 62, 58, cz + 50);
  sun.target.position.set(cx, 0, cz);
  sun.target.updateMatrixWorld();

  uiTimer += dt; mapTimer += dt; saveTimer += dt;
  if (uiTimer > 0.1) {
    uiTimer = 0;
    const prog = plan.progress(terrain);
    UI.update({ player, planProgress: prog, terrain, mode: state.mode });
    if (document.getElementById('planSheet').classList.contains('show')) UI.renderSheet(prog);
  }
  if (mapTimer > 0.09 && state.showMinimap) {
    mapTimer = 0;
    const mc = document.getElementById('minimap');
    mc.style.display = '';
    drawMinimap(mc, terrain, plan, player, treeData, player.barrow);
  } else if (!state.showMinimap) {
    document.getElementById('minimap').style.display = 'none';
  }

  renderer.render(scene, state.mode === 'plan' ? planCam : camera);

  fpsFrames++;
  if (now - fpsLast > 1000) {
    fpsEl.textContent = `${fpsFrames} fps`;
    fpsFrames = 0; fpsLast = now;
  }
}

// ---------------------------------------------------------------- boot
function init() {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  document.getElementById('app').appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = skyTexture();
  scene.fog = new THREE.FogExp2(0xcbd8dd, 0.0042);
  world = new THREE.Group();
  scene.add(world);

  camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 500);
  camera.rotation.order = 'YXZ';
  scene.add(camera);
  planCam = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 1, 600);
  planCam.up.set(0, 0, -1);

  const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x5d4d38, 0.50);
  scene.add(hemi);
  sun = new THREE.DirectionalLight(0xfff0d4, 1.15);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -48; sc.right = 48; sc.top = 48; sc.bottom = -48; sc.near = 1; sc.far = 260;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.05;
  scene.add(sun);
  scene.add(sun.target);
  const fill = new THREE.DirectionalLight(0x9fb6d8, 0.22);
  fill.position.set(-40, 40, -30);
  scene.add(fill);

  sfx = new SFX();
  materials = makeMaterials();
  UI.init();
  UI.setLoading('Carving the dirt…', 0.2);

  // build world on the next tick so the loading bar paints
  requestAnimationFrame(() => {
    setTimeout(() => {
      buildWorld(state.seed);
      UI.setLoading('Scattering trees…', 0.8);
      bindInputOnce();
      UI.setLoading('Ready', 1);
      setTimeout(() => {
        UI.hideLoading();
        UI.showIntro(true);
        document.getElementById('begin').addEventListener('click', () => {
          UI.showIntro(false);
          sfx.start(); sfx.resume();
          renderer.domElement.requestPointerLock();
        });
        UI.toast('Press H for controls · P to plan your line first', 6);
      }, 120);
    }, 60);
  });

  fpsEl = document.createElement('div');
  fpsEl.id = 'fps';
  document.body.appendChild(fpsEl);

  if (localStorage.getItem('dirtline.save')) {
    document.getElementById('resume').style.display = '';
  }
  document.getElementById('resume').addEventListener('click', () => {
    UI.showIntro(false);
    load();
    sfx.start(); sfx.resume();
    renderer.domElement.requestPointerLock();
  });
  document.getElementById('newWorld').addEventListener('click', () => {
    state.seed = (Math.random() * 100000) | 0;
    UI.showIntro(false);
    buildWorld(state.seed);
    bindInputOnce();
    sfx.start(); sfx.resume();
    renderer.domElement.requestPointerLock();
  });
  renderer.domElement.addEventListener('click', () => sfx.start());

  requestAnimationFrame(frame);
}

// avoid double-binding listeners when starting a fresh world
let boundOnce = false;
const _bind = bindInput;
function bindInputOnce() { if (boundOnce) return; boundOnce = true; _bind(); }

window.addEventListener('DOMContentLoaded', init);

// debug handle (stable getters — values are rebuilt when a world loads)
window.__app = {
  get THREE() { return THREE; },
  get state() { return state; },
  get terrain() { return terrain; },
  get player() { return player; },
  get plan() { return plan; },
  get treeData() { return treeData; },
  get scene() { return scene; },
  get world() { return world; },
  get renderer() { return renderer; },
  get camera() { return camera; },
  get planCam() { return planCam; },
  get mode() { return state.mode; },
  save, load, buildWorld, marchTerrain,
};

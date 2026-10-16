// Detailed procedural props: wheelbarrow, bucket, cooler, water jug, trash bag,
// planks, and loose dirt heaps. Built from lofts/lathes/tapered tubes — shaped
// cross-sections, rolled rims, tread lugs, spokes, seams, handles and knots.
import { v3, tube, loft, lathe, mergeGeos, assemble, colorize, xform, hash, snoise, roundedRect, plate, facet } from './geo.js';

const THREE = window.THREE;

// A closed 2D outline (list of Vector2) revolved/lofted as a solid of revolution.
function revolved(profile, opts = {}) {
  return lathe(profile, opts);
}

// ---------------------------------------------------------------- dirt heaps
// An irregular heap of loose spoil (in a barrow, bucket, or on the ground).
export function buildDirtHeap(r, seed, opts = {}) {
  const sides = 14, rings = 5;
  const sections = [];
  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1);
    const prof = Math.pow(Math.sin(Math.PI * (0.18 + 0.82 * t)), 0.6);
    const ring = [];
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      const nz = 1 + 0.22 * snoise(j * 1.7 + seed, i * 1.8, seed) + 0.10 * snoise(j * 4.1, i * 3.2, seed + 5);
      const rr = r * prof * nz;
      ring.push(new THREE.Vector3(Math.cos(a) * rr, t * r * (opts.height || 0.55), Math.sin(a) * rr));
    }
    sections.push(ring);
  }
  const g = facet(loft(sections, { capStart: true, capEnd: true }));
  colorize(g, opts.color || 0x5f4b39, { variance: 0.14, grain: 0.08, byHeight: h => 0.8 + h * 0.35 });
  return g;
}

// ---------------------------------------------------------------- wheelbarrow
function ringTorus(R, outline, around, lugFn) {
  const sections = [];
  for (let i = 0; i <= around; i++) {
    const a = (i / around) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const ring = [];
    for (const [ax, rad] of outline) {
      let rr = rad;
      if (lugFn) rr *= lugFn(a);
      ring.push(new THREE.Vector3(ax, (R + rr) * ca, (R + rr) * sa));
    }
    sections.push(ring);
  }
  return loft(sections, { capStart: false, capEnd: false });
}

export function buildWheelbarrow() {
  const parts = [];
  // --- tray: rounded rectangular sections lofted from base to a flared rim
  const base = roundedRect(0.60, 0.94, 0.14, 4);
  const steps = [
    { y: 0.00, sx: 0.62, sy: 0.60 },   // floor
    { y: 0.05, sx: 0.80, sy: 0.78 },
    { y: 0.16, sx: 0.96, sy: 0.94 },   // pressed rib
    { y: 0.24, sx: 1.00, sy: 1.00 },
    { y: 0.30, sx: 1.04, sy: 1.03 },   // rolled rim
    { y: 0.325, sx: 1.01, sy: 1.005 },
  ];
  const trayGeo = loft(steps.map(s => base.map(p => new THREE.Vector3(
    p.y * s.sy, s.y, p.x * s.sx
  ))), { capStart: true, capEnd: true });
  colorize(trayGeo, 0xc4552c, { byHeight: h => 0.86 + h * 0.3, variance: 0.05, grain: 0.04 });
  parts.push({ geo: trayGeo, mat: 'painted' });
  // tray ribs / stiffening creases
  for (const s of [-1, 1]) {
    const rib = tube([
      new THREE.Vector3(s * 0.28, 0.06, 0.30),
      new THREE.Vector3(s * 0.30, 0.16, 0.28),
      new THREE.Vector3(s * 0.29, 0.26, 0.26),
    ], 0.012, { sides: 6 });
    colorize(rib, 0xa5461f, { variance: 0.06 });
    parts.push({ geo: rib, mat: 'painted' });
  }
  // --- handles: two wooden shafts under the tray running back to grips
  for (const s of [-1, 1]) {
    const path = [
      new THREE.Vector3(s * 0.30, 0.16, 0.30),
      new THREE.Vector3(s * 0.34, 0.20, 0.05),
      new THREE.Vector3(s * 0.36, 0.30, -0.35),
      new THREE.Vector3(s * 0.36, 0.44, -0.72),
      new THREE.Vector3(s * 0.35, 0.50, -0.88),
    ];
    const h = tube(path, (t) => 0.022 - 0.002 * t, { sides: 9, squashX: 0.9 });
    colorize(h, 0x9a7443, { grain: 0.07, byHeight: (hh) => 0.85 + hh * 0.3, variance: 0.04 });
    parts.push({ geo: h, mat: 'wood' });
    // rubber grip
    const grip = tube([
      new THREE.Vector3(s * 0.355, 0.455, -0.76),
      new THREE.Vector3(s * 0.352, 0.485, -0.85),
      new THREE.Vector3(s * 0.35, 0.50, -0.92),
    ], 0.030, { sides: 10 });
    colorize(grip, 0x26272b, { variance: 0.05 });
    parts.push({ geo: grip, mat: 'rubber' });
    // steel leg / foot
    const foot = tube([
      new THREE.Vector3(s * 0.24, 0.16, -0.24),
      new THREE.Vector3(s * 0.20, 0.05, -0.30),
      new THREE.Vector3(s * 0.19, 0.012, -0.34),
    ], (t) => 0.019 - t * 0.003, { sides: 8 });
    colorize(foot, 0x8d9298, { variance: 0.05 });
    parts.push({ geo: foot, mat: 'metal' });
    // frame brace to the wheel fork
    const brace = tube([
      new THREE.Vector3(s * 0.30, 0.16, 0.30),
      new THREE.Vector3(s * 0.12, 0.12, 0.42),
      new THREE.Vector3(s * 0.055, 0.10, 0.47),
    ], 0.013, { sides: 7 });
    colorize(brace, 0x8d9298, { variance: 0.05 });
    parts.push({ geo: brace, mat: 'metal' });
  }
  // --- wheel: tire with tread lugs, dish rim, hub, spokes, axle+nuts
  const R = 0.235, halfW = 0.042;
  const tireOutline = [
    [halfW, 0.0], [halfW, 0.016], [halfW * 0.82, 0.045], [halfW * 0.35, 0.062],
    [-halfW * 0.35, 0.062], [-halfW * 0.82, 0.045], [-halfW, 0.016], [-halfW, 0.0],
    [-halfW * 0.6, -0.012], [0, -0.018], [halfW * 0.6, -0.012],
  ];
  const tire = ringTorus(R, tireOutline, 30, a => 1 + 0.045 * Math.pow(Math.max(0, Math.sin(a * 15)), 0.5));
  colorize(tire, 0x1b1c1f, { variance: 0.06, grain: 0.05 });
  parts.push({ geo: tire, mat: 'rubber' });
  const rim = revolved([[0.055, -0.012], [0.150, -0.012], [0.166, 0.004], [0.150, 0.016], [0.055, 0.016]], { sides: 20 });
  xform(rim, { rot: [0, 0, Math.PI / 2], pos: [0, 0.235, 0.47] });
  colorize(rim, 0xb5babf, { variance: 0.05, grain: 0.03 });
  parts.push({ geo: rim, mat: 'metal' });
  const hub = revolved([[0.020, -0.030], [0.036, -0.030], [0.040, -0.014], [0.038, 0.014], [0.036, 0.030], [0.020, 0.030]], { sides: 12 });
  xform(hub, { rot: [0, 0, Math.PI / 2], pos: [0, 0.235, 0.47] });
  colorize(hub, 0x9ba0a6, { variance: 0.05 });
  parts.push({ geo: hub, mat: 'metal' });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const sp = tube([
      new THREE.Vector3(0, 0.235 + Math.cos(a) * 0.040, 0.47 + Math.sin(a) * 0.040),
      new THREE.Vector3(0, 0.235 + Math.cos(a) * 0.150, 0.47 + Math.sin(a) * 0.150),
    ], 0.0055, { sides: 5 });
    colorize(sp, 0xc3c8cd, { variance: 0.06 });
    parts.push({ geo: sp, mat: 'metal' });
  }
  const axle = tube([
    new THREE.Vector3(-0.085, 0.235, 0.47),
    new THREE.Vector3(0.085, 0.235, 0.47),
  ], 0.010, { sides: 8 });
  colorize(axle, 0xa8adb3, { variance: 0.05 });
  parts.push({ geo: axle, mat: 'metal' });
  for (const s of [-1, 1]) {
    const nut = revolved([[0.008, 0], [0.017, 0], [0.017, 0.014], [0.008, 0.014]], { sides: 6 });
    xform(nut, { rot: [0, 0, Math.PI / 2], pos: [s * 0.082, 0.235, 0.47] });
    colorize(nut, 0x8d9298, { variance: 0.05 });
    parts.push({ geo: nut, mat: 'metal' });
  }
  // a loose load of dirt in the tray
  const heap = buildDirtHeap(0.22, 7);
  xform(heap, { scale: [1.25, 1, 1.7], pos: [0, 0.02, 0] });
  parts.push({ geo: heap, mat: 'bark' });
  return assemble(parts);
}

// ---------------------------------------------------------------- bucket
export function buildBucket() {
  const parts = [];
  const rib = y => 1 + 0.035 * Math.exp(-Math.pow((y - 0.105) * 26, 2)) + 0.03 * Math.exp(-Math.pow((y - 0.235) * 26, 2));
  const profile = [
    [0.055, 0.004], [0.150, 0.012], [0.196, 0.022],      // base
    [0.208, 0.05], [0.222, 0.10], [0.236, 0.17], [0.250, 0.24], [0.262, 0.300],
    [0.268, 0.318], [0.272, 0.330],                     // rolled rim
    [0.264, 0.336], [0.256, 0.322],
    [0.248, 0.300], [0.236, 0.24], [0.222, 0.17], [0.208, 0.10], [0.196, 0.05],
    [0.184, 0.026], [0.070, 0.020],
  ];
  const body = lathe(profile, { sides: 22, noise: (a, y) => rib(y) * (1 + 0.006 * Math.sin(a * 9)) });
  colorize(body, 0xcf5520, {
    byHeight: h => 0.82 + h * 0.4,
    variance: 0.05, grain: 0.04,
  });
  parts.push({ geo: body, mat: 'painted' });
  // bail handle with flattened ears
  const bail = [];
  for (const s of [-1, 1]) {
    const ear = plate(roundedRect(0.05, 0.042, 0.014, 3), 0.006, { bevel: 0.002 });
    xform(ear, { rot: [0, Math.PI / 2, 0.1 * s], pos: [s * 0.265, 0.295, 0] });
    colorize(ear, 0xb0451a, { variance: 0.05 });
    bail.push(ear);
  }
  const half = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const a = Math.PI * t;
    half.push(new THREE.Vector3(Math.cos(a) * 0.265, 0.320 + Math.sin(a) * 0.175, 0));
  }
  const handle = tube(half, 0.008, { sides: 7 });
  colorize(handle, 0x9aa0a6, { variance: 0.06, grain: 0.03 });
  const g = mergeGeos([...bail, handle]);
  parts.push({ geo: g, mat: 'metal' });
  const dirt = buildDirtHeap(0.20, 13, { color: 0x5a4634 });
  xform(dirt, { pos: [0, 0.018, 0] });
  parts.push({ geo: dirt, mat: 'bark' });
  return assemble(parts);
}

// ---------------------------------------------------------------- cooler
export function buildCooler() {
  const parts = [];
  const outline = roundedRect(0.50, 0.33, 0.055, 4);
  const steps = [
    { y: 0.000, sx: 0.90, sy: 0.88 },
    { y: 0.014, sx: 1.00, sy: 1.00 },
    { y: 0.170, sx: 1.01, sy: 1.01 },
    { y: 0.196, sx: 1.05, sy: 1.05 },
    { y: 0.222, sx: 1.07, sy: 1.06 },
    { y: 0.286, sx: 1.06, sy: 1.05 },
    { y: 0.310, sx: 1.00, sy: 1.00 },
    { y: 0.320, sx: 0.90, sy: 0.90 },
  ];
  const body = loft(steps.map(s => outline.map(p => new THREE.Vector3(p.y * s.sy, s.y, p.x * s.sx))),
    { capStart: true, capEnd: true });
  colorize(body, 0xe6e8e3, { variance: 0.04, grain: 0.03, byHeight: h => 0.92 + h * 0.14 });
  parts.push({ geo: body, mat: 'plastic' });
  // dark seam between body and lid
  const seamSteps = [{ y: 0.196, sx: 1.055, sy: 1.052 }, { y: 0.222, sx: 1.072, sy: 1.062 }];
  const seam = loft(seamSteps.map(s => outline.map(p => new THREE.Vector3(p.y * s.sy, s.y, p.x * s.sx))),
    { capStart: false, capEnd: false });
  colorize(seam, 0x6b6f72, { variance: 0.05 });
  parts.push({ geo: seam, mat: 'rubber' });
  // latches + hinges
  for (const s of [-1, 1]) {
    const latch = plate(roundedRect(0.050, 0.075, 0.014, 3), 0.010, { bevel: 0.003 });
    xform(latch, { rot: [0, 0, 0], pos: [s * 0.13, 0.215, 0.168] });
    colorize(latch, 0x5f6467, { variance: 0.05 });
    parts.push({ geo: latch, mat: 'rubber' });
    const hinge = tube([
      new THREE.Vector3(s * 0.20, 0.245, -0.150),
      new THREE.Vector3(s * 0.10, 0.252, -0.160),
    ], 0.010, { sides: 7 });
    colorize(hinge, 0x5f6467, { variance: 0.05 });
    parts.push({ geo: hinge, mat: 'rubber' });
  }
  // moulded handle
  const handle = tube([
    new THREE.Vector3(-0.17, 0.300, -0.170),
    new THREE.Vector3(-0.12, 0.340, -0.230),
    new THREE.Vector3(0, 0.352, -0.250),
    new THREE.Vector3(0.12, 0.340, -0.230),
    new THREE.Vector3(0.17, 0.300, -0.170),
  ], (t) => 0.018 + 0.008 * Math.exp(-Math.pow((t - 0.5) * 4, 2)), { sides: 10 });
  colorize(handle, 0xd8dad5, { variance: 0.04, grain: 0.03 });
  parts.push({ geo: handle, mat: 'plastic' });
  // drain plug
  const plug = revolved([[0.010, 0], [0.030, 0.004], [0.032, 0.016], [0.022, 0.022], [0.010, 0.024]], { sides: 12 });
  xform(plug, { rot: [Math.PI / 2, 0, 0], pos: [0, 0.070, 0.172] });
  colorize(plug, 0x9aa0a6, { variance: 0.06 });
  parts.push({ geo: plug, mat: 'metal' });
  return assemble(parts);
}

// ---------------------------------------------------------------- water jug
export function buildJug() {
  const parts = [];
  const rib = y => 1 + 0.05 * Math.exp(-Math.pow((y - 0.075) * 30, 2)) + 0.035 * Math.exp(-Math.pow((y - 0.155) * 30, 2));
  const body = lathe([
    [0.030, 0.000], [0.082, 0.006], [0.098, 0.020], [0.104, 0.055],
    [0.102, 0.110], [0.098, 0.160], [0.090, 0.200], [0.070, 0.238],
    [0.050, 0.262], [0.038, 0.278], [0.036, 0.300],
  ], { sides: 20, noise: (a, y) => rib(y) * (1 + 0.004 * Math.sin(a * 12)) });
  colorize(body, 0xdfe3e4, { byHeight: h => 0.88 + h * 0.22, variance: 0.04, grain: 0.03 });
  parts.push({ geo: body, mat: 'plastic' });
  // blue cap with grip ribs
  const cap = lathe([
    [0.030, 0.298], [0.044, 0.300], [0.046, 0.330], [0.042, 0.344], [0.030, 0.346],
  ], { sides: 16, noise: (a) => 1 + 0.03 * Math.abs(Math.sin(a * 10)) });
  colorize(cap, 0x3f6bb5, { variance: 0.05, grain: 0.04 });
  parts.push({ geo: cap, mat: 'plastic' });
  // handle: an arch plus a lower strut, both capped so the mesh stays closed
  const arch = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10, a = Math.PI * t;
    arch.push(new THREE.Vector3(0.095 + Math.cos(a) * 0.020, 0.215 + Math.sin(a) * 0.085, 0));
  }
  const hTop = tube(arch, (t) => 0.014 - t * 0.002, { sides: 8, squashX: 0.7 });
  colorize(hTop, 0xdadedf, { variance: 0.04 });
  parts.push({ geo: hTop, mat: 'plastic' });
  const strut = tube([
    new THREE.Vector3(0.100, 0.110, 0.020),
    new THREE.Vector3(0.108, 0.150, 0.016),
    new THREE.Vector3(0.106, 0.185, 0.012),
  ], 0.013, { sides: 8, squashX: 0.7 });
  colorize(strut, 0xdadedf, { variance: 0.04 });
  parts.push({ geo: strut, mat: 'plastic' });
  return assemble(parts);
}

// ---------------------------------------------------------------- trash bag
export function buildTrashBag() {
  const parts = [];
  const sides = 14, rings = 7;
  const sections = [];
  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1);
    const prof = [0.16, 0.24, 0.28, 0.29, 0.26, 0.14, 0.06][i];
    const ring = [];
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      const crinkle = 1
        + 0.17 * snoise(j * 2.3 + 4, i * 2.1, 11)
        + 0.10 * snoise(j * 5.1, i * 4.4, 3);
      const bulge = 1 + 0.06 * Math.sin(a * 3 + i);
      const rr = prof * crinkle * bulge;
      ring.push(new THREE.Vector3(Math.cos(a) * rr, t * 0.44, Math.sin(a) * rr * (1 + 0.1 * Math.sin(a * 2))));
    }
    sections.push(ring);
  }
  // tie the neck: pull the last rings in and add a twist
  const body = loft(sections, { capStart: true, capEnd: true });
  colorize(body, 0x1c1e23, { variance: 0.10, grain: 0.05, byHeight: h => 0.85 + h * 0.4 });
  parts.push({ geo: body, mat: 'fabric' });
  const tie = lathe([
    [0.055, 0.000], [0.075, 0.010], [0.072, 0.026], [0.050, 0.034],
  ], { sides: 14 });
  xform(tie, { pos: [0, 0.400, 0] });
  colorize(tie, 0x111318, { variance: 0.06 });
  parts.push({ geo: tie, mat: 'fabric' });
  // knotted ears above the tie
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.5;
    const ear = tube([
      new THREE.Vector3(Math.cos(a) * 0.04, 0.425, Math.sin(a) * 0.04),
      new THREE.Vector3(Math.cos(a) * 0.065, 0.470, Math.sin(a) * 0.065),
      new THREE.Vector3(Math.cos(a) * 0.045, 0.505, Math.sin(a) * 0.045),
    ], (t) => 0.020 * (1 - t * 0.55), { sides: 7 });
    colorize(ear, 0x181a1f, { variance: 0.12 });
    parts.push({ geo: ear, mat: 'fabric' });
  }
  return assemble(parts);
}

// ---------------------------------------------------------------- plan ghosts
// The intended shape of a planned feature as a lofted solid: a real take-off
// face / tabletop / roller curve / landing slope / berm bank / bowl, not a dome.
function profileH(type, t) {
  const s = Math.min(1, Math.max(0, t));
  switch (type) {
    case 'lip': {
      // parabolic take-off face, short flat top, steep backside
      if (s < 0.44) { const u = s / 0.44; return Math.pow(Math.sin(u * Math.PI / 2), 1.7) * 1.0; }
      if (s < 0.66) return 1.0;
      const u = (s - 0.66) / 0.34;
      return 1.0 - Math.pow(u, 0.85);
    }
    case 'table': {
      if (s < 0.26) { const u = s / 0.26; return Math.pow(Math.sin(u * Math.PI / 2), 1.8); }
      if (s < 0.74) return 1.0;
      const u = (s - 0.74) / 0.26;
      return Math.cos(u * Math.PI / 2) ** 0.8;
    }
    case 'roller': {
      const u = s * Math.PI;
      return Math.pow(Math.sin(u), 1.5);
    }
    case 'landing': {
      // you land on the top and ride down a concave face
      return Math.pow(Math.cos(s * Math.PI / 2), 1.35);
    }
    case 'berm': {
      const u = s * Math.PI;
      return Math.pow(Math.sin(u), 0.9) * (0.72 + 0.46 * s);   // banked: higher on one side
    }
    case 'pit': {
      const u = s * Math.PI;
      return -Math.pow(Math.sin(u), 0.8);
    }
    default: return Math.pow(Math.sin(s * Math.PI), 1.4);
  }
}

export function buildJumpProfile(type) {
  const N = 22, M = 14;
  const sections = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = (t - 0.5) * 2;
    const h = profileH(type, t);
    const frac = Math.sqrt(Math.max(0.10, Math.abs(h)));
    const halfW = 0.66 * frac + 0.05;
    const ring = [];
    for (let j = 0; j <= M; j++) {
      const u = j / M;
      const z = -halfW + 2 * halfW * u;
      const dome = Math.cos((u - 0.5) * Math.PI);
      const bevel = Math.min(1, Math.abs(h) * 4);
      const y = h * (0.80 + 0.20 * dome) + (1 - bevel) * 0.02;
      ring.push(new THREE.Vector3(x, y, z));
    }
    const yBot = h >= 0 ? -0.14 : 0.0;
    for (let j = M; j >= 0; j--) {
      const u = j / M;
      const z = -halfW + 2 * halfW * u;
      ring.push(new THREE.Vector3(x, yBot, z * 0.99));
    }
    sections.push(ring);
  }
  const g = loft(sections, { capStart: true, capEnd: true });
  return g;
}

export function buildPlank(len = 1.9, wid = 0.24, thick = 0.035, seed = 1, opts = {}) {
  const parts = [];
  const steps = 10;
  const sections = [];
  const outline = roundedRect(wid, thick, 0.006, 2);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = (t - 0.5) * len;
    // slight cup along the length, rounded tapering ends, a chamfer at the tips
    const sy = (t < 0.06 || t > 0.94) ? 0.86 : 1;
    const sx = (t < 0.04 || t > 0.96) ? 0.9 : 1;
    const cup = -0.010 * Math.sin(Math.PI * t) - 0.012 * Math.pow((t - 0.5) * 2, 2);
    const waver = 0.004 * Math.sin(t * 9 + seed);
    sections.push(outline.map(p => new THREE.Vector3(
      x,
      (p.y * sx) * sy + cup * 0.35 + waver,
      p.x * sy + cup + 0.008 * Math.sin(p.x * 12 + t * 4)
    )));
  }
  const body = loft(sections, { capStart: true, capEnd: true });
  colorize(body, opts.color || 0x9d7a4f, {
    byHeight: (h, x, y) => 0.82 + 0.3 * hash(Math.floor(x * 42), Math.floor(y * 260), seed),
    grain: 0.08, variance: 0.05,
  });
  parts.push({ geo: body, mat: 'wood' });
  // nail holes (shallow recessed dimples with darkened rims)
  const nails = 2 + Math.floor(hash(seed, 2, 3) * 2);
  for (let i = 0; i < nails; i++) {
    const t = 0.12 + hash(i, seed, 5) * 0.76;
    const off = (hash(i, seed, 7) - 0.5) * (wid - 0.05);
    const n = lathe([[0.002, 0], [0.008, 0.002], [0.010, 0.006], [0.004, 0.009]], { sides: 8 });
    xform(n, { rot: [Math.PI / 2, 0, 0], pos: [(t - 0.5) * len, 0.004, off] });
    colorize(n, 0x4a3a28, { variance: 0.08 });
    parts.push({ geo: n, mat: 'wood' });
  }
  // a split splintered end for the broken variant
  if (opts.broken) {
    for (let i = 0; i < 5; i++) {
      const a = (hash(i, seed, 11) - 0.5) * wid;
      const l = 0.06 + hash(i, seed, 13) * 0.13;
      const sp = tube([
        new THREE.Vector3(len / 2 - 0.01, 0, a),
        new THREE.Vector3(len / 2 + l * 0.6, 0.004 * (hash(i, seed, 17) - 0.5), a * 0.9),
        new THREE.Vector3(len / 2 + l, 0.006 * (hash(i, seed, 19) - 0.5), a * 0.7),
      ], (t) => 0.010 * (1 - t * 0.85), { sides: 5, squashX: 0.5 });
      colorize(sp, 0xd8c49c, { variance: 0.1 });
      parts.push({ geo: sp, mat: 'wood' });
    }
  }
  return assemble(parts);
}

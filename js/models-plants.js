// Detailed procedural models: trees, rocks, logs, stumps.
// Unit space: trees are 1.0 tall with the base at y = 0 and are scaled per
// instance; rocks/logs are unit radius. Everything is real geometry — tapered
// trunks with root flare and bark ridges, recursive limbs, needle sprays and
// leaf clusters, fractured rock faces, knot-bulged logs with sawn end grain.
import { v3, tube, loft, lathe, mergeGeos, assemble, colorize, facet, xform, hash, snoise, ensureAttrs } from './geo.js';

const THREE = window.THREE;

// ---------------------------------------------------------------- foliage bits
// A tapered leaf with a folded midrib (non-indexed so it shades crisply from
// both sides).
export function leafCard(len, wid, curl = 0.25) {
  const segs = 2, pos = [];
  const halfW = i => wid * 0.5 * Math.pow(Math.sin(Math.PI * (0.16 + 0.84 * (i / segs))), 0.6);
  const y = i => (i / segs) * len;
  const z = i => curl * Math.sin(Math.PI * (i / segs));
  for (let i = 0; i < segs; i++) {
    const m0 = [0, y(i), 0], m1 = [0, y(i + 1), 0];
    const l0 = [-halfW(i), y(i), z(i)], l1 = [-halfW(i + 1), y(i + 1), z(i + 1)];
    const r0 = [halfW(i), y(i), z(i)], r1 = [halfW(i + 1), y(i + 1), z(i + 1)];
    pos.push(...m0, ...l0, ...l1, ...m0, ...l1, ...m1);
    pos.push(...m0, ...r1, ...r0, ...m0, ...m1, ...r1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// A needle strip — narrow, tapered, slightly drooped.
export function needleStrip(len, wid) {
  const segs = 1, pos = [];
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs;
    const w0 = wid * (1 - t0 * 0.75), w1 = wid * (1 - t1 * 0.75);
    const y0 = len * t0, y1 = len * t1;
    const d0 = -0.10 * t0 * t0 * len, d1 = -0.10 * t1 * t1 * len;
    pos.push(0, y0, 0, -w0, y0, d0, -w1, y1, d1);
    pos.push(0, y0, 0, -w1, y1, d1, 0, y1, 0);
    pos.push(0, y0, 0, w1, y1, d1, w0, y0, d0);
    pos.push(0, y0, 0, 0, y1, 0, w1, y1, d1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

const GREENS = [0x5b8a42, 0x6d9a4e, 0x4e7c3c, 0x7ba55c, 0x577f45, 0x678f4a];

// Needle spray for conifers: a fan of strips around a short stem.
export function needleSpray(seed, size) {
  const parts = [];
  const n = 11;
  for (let i = 0; i < n; i++) {
    const len = size * (0.55 + hash(i, seed, 3) * 0.55);
    const wid = size * 0.11 * (0.8 + hash(i, seed, 7) * 0.5);
    const g = needleStrip(len, wid);
    const yaw = (i / n) * Math.PI * 2 + hash(seed, i, 11) * 0.9;
    const tilt = 0.9 + hash(i, seed, 13) * 0.5;
    xform(g, { rot: [tilt, yaw, 0], pos: [0, size * 0.05, 0] });
    colorize(g, GREENS[(i + seed) % GREENS.length], { variance: 0.22, grain: 0.05 });
    parts.push(g);
  }
  // a few shorter needles near the base of the spray
  for (let i = 0; i < 5; i++) {
    const g = needleStrip(size * 0.35, size * 0.08);
    xform(g, { rot: [1.5 + hash(i, seed, 17) * 0.5, (i / 5) * Math.PI * 2, 0] });
    colorize(g, GREENS[(i * 2 + seed) % GREENS.length], { variance: 0.2 });
    parts.push(g);
  }
  return mergeGeos(parts);
}

// Leaf cluster for broadleaf trees: a ball of overlapping leaf cards.
export function leafCluster(seed, size) {
  const parts = [];
  const n = 8;
  for (let i = 0; i < n; i++) {
    const s = size * (0.7 + hash(i, seed, 5) * 0.7);
    const g = leafCard(s, s * 0.62, s * 0.28);
    const a = hash(i, seed, 9) * Math.PI * 2;
    const b = 0.6 + hash(i, seed, 15) * 1.5;
    xform(g, {
      rot: [b, a, hash(i, seed, 21) * 1.2],
      pos: [Math.cos(a) * size * 0.35, (hash(i, seed, 23) - 0.4) * size * 0.5, Math.sin(a) * size * 0.35],
    });
    colorize(g, GREENS[(i * 3 + seed) % GREENS.length], { variance: 0.24, grain: 0.06 });
    parts.push(g);
  }
  return mergeGeos(parts);
}

// ---------------------------------------------------------------- tree builders
function trunkRadiusFn(base, top, flare) {
  return (t) => (base - (base - top) * Math.pow(t, 0.75)) * (1 + flare * Math.exp(-t * 14));
}

function barkNoise(seed, ridges = 7, amt = 0.05) {
  return (a, t) => 1 + amt * Math.sin(a * ridges + seed) * (1 - t * 0.5)
    + amt * 0.6 * snoise(a * 3.1, t * 21, seed)
    + amt * 0.9 * Math.exp(-t * 6) * Math.max(0, Math.cos(a * 3 + seed)) ** 2;
}

// Recursive limb: a curved tapered tube, optionally forking.
function limb(start, dir, len, r0, r1, seed, depth, out, opts = {}) {
  const steps = 4;
  const path = [];
  let p = start.clone();
  const d = dir.clone().normalize();
  const curl = opts.curl === undefined ? 0.22 : opts.curl;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    path.push(p.clone());
    d.y += curl * 0.35;                 // limbs curve upward then flatten
    d.normalize();
    p = p.clone().addScaledVector(d, len / steps);
  }
  const geo = tube(path, (t) => r0 + (r1 - r0) * Math.pow(t, 0.8), {
    sides: depth > 0 ? 6 : 8,
    noise: (a, t) => 1 + 0.06 * Math.sin(a * 4 + seed) * (1 - t),
  });
  colorize(geo, 0x6e5a45, { byHeight: () => 0.85 + hash(seed, depth, 3) * 0.3, grain: 0.05 });
  out.bark.push(geo);
  if (depth > 0) {
    const n = opts.fork || 2;
    for (let i = 0; i < n; i++) {
      const at = 0.55 + 0.35 * (i / Math.max(1, n - 1));
      const idx = Math.min(steps, Math.floor(at * steps));
      const base = path[idx];
      const nd = d.clone()
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), (hash(i, seed, 31) - 0.5) * 2.2)
        .normalize();
      nd.y += 0.2;
      limb(base, nd, len * (0.55 + hash(i, seed, 37) * 0.25), r1 * 0.85, r1 * 0.32 * 0.6,
        seed + i * 17, depth - 1, out,
        { curl: curl * 1.2, tip: true, spray: opts.spray, leaf: opts.leaf });
    }
  } else if (out.foliage) {
    // foliage at the tips
    const tip = path[path.length - 1];
    if (opts.tip) {
      const size = opts.spray || opts.leaf || 0.08;
      const cl = opts.spray ? needleSpray(seed, size) : leafCluster(seed, size);
      xform(cl, { pos: [tip.x, tip.y, tip.z] });
      out.foliage.push(cl);
    }
  }
}

function buildBarkTrunk(seed, opts) {
  const steps = opts.steps || 16;
  const path = [];
  const lean = opts.lean || 0;
  const curve = opts.curve || 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    path.push(new THREE.Vector3(
      lean * t * t * 0.6 + Math.sin(t * 2.2) * curve * 0.12,
      t * opts.height,
      lean * t * 0.4 + Math.cos(t * 1.7) * curve * 0.1
    ));
  }
  const rFn = trunkRadiusFn(opts.rBase, opts.rTop, opts.flare === undefined ? 0.9 : opts.flare);
  const geo = tube(path, (t) => rFn(t), {
    sides: opts.sides || 12,
    noise: barkNoise(seed, opts.ridges || 7, opts.ridgeAmt || 0.055),
  });
  colorize(geo, opts.barkColor || 0x6e5a45, {
    byHeight: (h, x, y) => (opts.pale ? 1.05 + 0.18 * (hash(Math.floor(x * 60), Math.floor(h * 26), 5) > 0.72 ? -1 : 0.4)
      : 0.72 + h * 0.5 + 0.2 * hash(Math.floor(x * 30), Math.floor(h * 40), 2)),
    grain: 0.05,
  });
  return { geo, path };
}

// --- conifer ---------------------------------------------------------------
export function buildPine(seed) {
  const out = { bark: [], foliage: [] };
  const H = 1.0;
  const { geo, path } = buildBarkTrunk(seed, {
    height: H, rBase: 0.0120, rTop: 0.0035, flare: 1.2, sides: 13, ridges: 8, ridgeAmt: 0.05,
  });
  out.bark.push(geo);
  // whorls of limbs from 32% up to the top, spreading as they go
  const whorls = 9;
  for (let w = 0; w < whorls; w++) {
    const t = 0.32 + 0.66 * (w / whorls);
    const idx = Math.min(path.length - 1, Math.round(t * (path.length - 1)));
    const base = path[idx];
    const perWhorl = w < 2 ? 5 : 3;
    for (let i = 0; i < perWhorl; i++) {
      const a = (i / perWhorl) * Math.PI * 2 + w * 1.1 + hash(w, seed, 3) * 0.8;
      const spread = 0.30 - 0.22 * t + 0.05 * hash(i, w, seed);
      const dir = new THREE.Vector3(Math.cos(a) * spread, 0.32, Math.sin(a) * spread);
      limb(base, dir, 0.20 + 0.16 * hash(i, w * 3, seed), 0.0030, 0.0011, seed + w * 7 + i,
        t > 0.75 ? 0 : 1, out, { curl: 0.05, fork: 2, spray: 0.115 + 0.04 * hash(i, seed, 9), tip: true });
    }
  }
  // leader crown: sprays clustered at the top so the canopy reads as a mass
  const topPos = path[path.length - 1];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + seed;
    const spriteSize = 0.10 + hash(i, seed, 61) * 0.06;
    const cl = needleSpray(seed + i * 9, spriteSize);
    xform(cl, {
      pos: [topPos.x + Math.cos(a) * 0.03, topPos.y - 0.02 - hash(i, seed, 67) * 0.10, topPos.z + Math.sin(a) * 0.03],
      rot: [0, hash(i, seed, 71) * 3, 0],
    });
    out.foliage.push(cl);
  }
  return assemble([
    { geo: mergeGeos(out.bark), mat: 'bark' },
    { geo: mergeGeos(out.foliage), mat: 'foliage' },
  ]);
}

// --- broadleaf (maple / oak / birch) ---------------------------------------
export function buildBroadleaf(seed, opts = {}) {
  const pale = !!opts.pale;
  const out = { bark: [], foliage: [] };
  const { geo, path } = buildBarkTrunk(seed, {
    height: 1.0, rBase: pale ? 0.0100 : 0.0160, rTop: pale ? 0.0035 : 0.0048,
    flare: pale ? 0.6 : 1.2, sides: 11, ridges: pale ? 5 : 7,
    ridgeAmt: pale ? 0.03 : 0.06, lean: (hash(seed, 1, 1) - 0.5) * 0.7,
    curve: 1, barkColor: pale ? 0xcfcdc0 : 0x6a5540, pale,
  });
  out.bark.push(geo);
  const primaries = 4 + Math.floor(hash(seed, 2, 5) * 2);
  for (let i = 0; i < primaries; i++) {
    const t = 0.34 + 0.42 * (i / primaries) + hash(i, seed, 7) * 0.06;
    const idx = Math.min(path.length - 1, Math.round(t * (path.length - 1)));
    const base = path[idx];
    const a = (i / primaries) * Math.PI * 2 + seed * 0.7;
    const spread = 0.55 + hash(i, seed, 11) * 0.35;
    const dir = new THREE.Vector3(Math.cos(a) * spread, 0.55, Math.sin(a) * spread);
    limb(base, dir, 0.30 + 0.16 * hash(i, seed, 13), 0.0050, 0.0014, seed + i * 23, 1, out,
      { curl: 0.16, fork: 2, leaf: (pale ? 0.065 : 0.10) + hash(i, seed, 17) * 0.025, tip: true });
  }
  // a crown of clusters near the top so the silhouette reads as a tree, not a stick
  const top = path[path.length - 1];
  const crownN = pale ? 12 : 18;
  for (let i = 0; i < crownN; i++) {
    const a = (i / crownN) * Math.PI * 2 + seed;
    // spread the crown down the upper trunk so the canopy is a mass, not a cap
    const t2 = i / crownN;
    const rr = (pale ? 0.13 : 0.20) * (0.35 + hash(i, seed, 29) * 1.1) * (0.55 + t2 * 0.75);
    const drop = (pale ? 0.22 : 0.34) * (1 - t2);
    const cl = leafCluster(seed + i * 13, (pale ? 0.07 : 0.115) * (0.75 + hash(i, seed, 31) * 0.6));
    xform(cl, {
      pos: [top.x + Math.cos(a) * rr, top.y - drop - hash(i, seed, 37) * (pale ? 0.08 : 0.14),
        top.z + Math.sin(a) * rr],
    });
    out.foliage.push(cl);
  }
  return assemble([
    { geo: mergeGeos(out.bark), mat: 'bark' },
    { geo: mergeGeos(out.foliage), mat: 'foliage' },
  ]);
}

// --- dead snag -------------------------------------------------------------
export function buildSnag(seed) {
  const out = { bark: [] };
  const breakT = 0.55 + hash(seed, 3, 4) * 0.25;
  const steps = Math.round(14 * breakT);
  const path = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    path.push(new THREE.Vector3(
      (hash(seed, 5, 1) - 0.5) * 0.5 * t * t,
      t * breakT,
      (hash(seed, 6, 2) - 0.5) * 0.35 * t * t
    ));
  }
  const geo = tube(path, (t) => (0.0140 - 0.0090 * t) * (1 + 1.3 * Math.exp(-t * 12)), {
    sides: 11, noise: barkNoise(seed, 9, 0.075),
  });
  colorize(geo, 0x584a3c, { byHeight: h => 0.7 + h * 0.5, grain: 0.06 });
  out.bark.push(geo);
  // splintered broken top
  const top = path[path.length - 1];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const h = 0.03 + hash(i, seed, 9) * 0.075;
    const sp = tube([
      top.clone(),
      top.clone().add(new THREE.Vector3(Math.cos(a) * 0.012, h * 0.6, Math.sin(a) * 0.012)),
      top.clone().add(new THREE.Vector3(Math.cos(a) * 0.02, h, Math.sin(a) * 0.02)),
    ], (t) => 0.0040 * (1 - t * 0.9), { sides: 4 });
    colorize(sp, 0x8a7355, { byHeight: () => 1.0 + hash(i, seed, 11) * 0.3 });
    out.bark.push(sp);
  }
  // bare limbs, some broken short
  const n = 3 + Math.floor(hash(seed, 12, 3) * 3);
  for (let i = 0; i < n; i++) {
    const idx = Math.max(1, Math.round((0.25 + 0.7 * (i / n)) * (path.length - 1)));
    const base = path[idx];
    const a = (i / n) * Math.PI * 2 + seed;
    const broken = hash(i, seed, 15) < 0.4;
    const dir = new THREE.Vector3(Math.cos(a) * 0.85, broken ? 0.1 : 0.4, Math.sin(a) * 0.85);
    limb(base, dir, broken ? 0.10 + hash(i, seed, 17) * 0.06 : 0.22 + hash(i, seed, 19) * 0.1,
      0.0036, 0.0012, seed + i * 5, 0, out, { curl: -0.1 });
  }
  return assemble([{ geo: mergeGeos(out.bark), mat: 'bark' }]);
}

// ---------------------------------------------------------------- rocks
export function buildRock(seed, kind = 'boulder') {
  const sides = 11, rings = 6;
  const flat = kind === 'flat';
  const sections = [];
  for (let r = 0; r < rings; r++) {
    const t = r / (rings - 1);
    const prof = Math.pow(Math.sin(Math.PI * (0.10 + 0.90 * t)), 0.5);
    const ring = [];
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      let nz = 1
        + 0.26 * snoise(j * 1.9 + seed * 3, r * 1.4, seed)
        + 0.13 * snoise(j * 4.7, r * 3.3, seed + 9);
      if (kind === 'shard') nz *= 1 + 0.2 * Math.sin(a * 3 + seed);
      const rr = prof * nz;
      ring.push(new THREE.Vector3(
        Math.cos(a) * rr * (flat ? 1.25 : 1.0),
        (r / (rings - 1)) * (flat ? 0.42 : 0.95) - (flat ? 0.10 : 0.42),
        Math.sin(a) * rr * (flat ? 1.05 : 0.85)
      ));
    }
    sections.push(ring);
  }
  let geo = loft(sections, { capStart: true, capEnd: true });
  // shear vertices past two fracture planes so faces go angular
  const planes = [];
  for (let k = 0; k < 2; k++) {
    const n = new THREE.Vector3(snoise(seed + k * 7, 1, 2), 0.35, snoise(seed + k * 3, 5, 1)).normalize();
    planes.push({ n, d: 0.55 + hash(seed, k, 3) * 0.35 });
  }
  const p = geo.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i));
    for (const pl of planes) {
      const dist = v.dot(pl.n) - pl.d;
      if (dist > 0) v.addScaledVector(pl.n, -dist);
    }
    v.x += snoise(i * 0.7, seed, 1) * 0.03;
    v.z += snoise(i * 1.3, seed, 2) * 0.03;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo = facet(geo);
  ensureAttrs(geo);
  // grey stone with strata bands and moss on the upward faces
  const c = geo.getAttribute('color');
  const nrm = geo.getAttribute('normal');
  const base = new THREE.Color(0x8d8b83);
  const tmp = new THREE.Color();
  for (let i = 0; i < c.count; i++) {
    const y = p.getY(i);
    const strata = 0.82 + 0.16 * Math.sin(y * 26 + seed) + 0.10 * snoise(i * 0.3, seed, 4);
    tmp.copy(base).multiplyScalar(strata);
    const up = nrm.getY(i);
    if (up > 0.45) {
      const m = (up - 0.45) / 0.55 * 0.55;
      tmp.lerp(new THREE.Color(0x4a5c34), m * (0.4 + 0.6 * hash(seed, Math.floor(y * 9), 7)));
    }
    c.setXYZ(i, tmp.r, tmp.g, tmp.b);
  }
  c.needsUpdate = true;
  return assemble([{ geo, mat: 'bark' }]);
}

// ---------------------------------------------------------------- logs, stumps
export function buildLog(seed, len = 2.6, r = 0.16, opts = {}) {
  const steps = 12;
  const path = [];
  const bend = (hash(seed, 1, 1) - 0.5) * 0.5;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    path.push(new THREE.Vector3(
      (t - 0.5) * len,
      r * 0.95 + Math.sin(t * Math.PI) * 0.02 + t * (hash(seed, 4, 2) - 0.5) * 0.05,
      bend * Math.sin(t * Math.PI) * 0.18
    ));
  }
  const knots = [0.25 + hash(seed, 7, 3) * 0.2, 0.6 + hash(seed, 8, 4) * 0.25];
  const barkGeo = tube(path, (t) => r * (1 - 0.12 * t) * (opts.torn ? (1 - Math.pow(Math.max(0, t - 0.55) / 0.45, 1.6) * 0.55) : 1), {
    sides: 12,
    noise: (a, t) => 1
      + 0.055 * Math.sin(a * 7 + seed)
      + 0.03 * snoise(a * 3, t * 18, seed)
      + knots.reduce((acc, k) => acc + 0.22 * Math.exp(-Math.pow((t - k) * 16, 2)) * Math.max(0, Math.cos(a * 2 + seed)) ** 2, 0),
    capStart: true,
    capEnd: opts.torn ? false : true,
  });
  colorize(barkGeo, 0x63503d, { byHeight: (h, x) => 0.75 + 0.35 * hash(Math.floor(h * 30), Math.floor(x * 20), 9), grain: 0.07 });
  const parts = [{ geo: barkGeo, mat: 'bark' }];
  // sawn end grain rings
  const endR = r * (opts.torn ? 0.21 : 0.88);
  const end = lathe([[endR * 0.04, 0], [endR * 0.55, 0], [endR * 0.9, 0.008], [endR, 0.004]], { sides: 12 });
  xform(end, { rot: [0, 0, Math.PI / 2], pos: [(opts.torn ? len * 0.22 : len / 2) - 0.002, r * 0.95, 0] });
  ensureAttrs(end);
  const ec = end.getAttribute('color');
  const ep = end.getAttribute('position');
  const tmp = new THREE.Color();
  for (let i = 0; i < ec.count; i++) {
    const d = Math.hypot(ep.getY(i) - r * 0.95, ep.getZ(i));
    const rings = 0.78 + 0.22 * Math.sin(d * 62 + seed) * 0.5 + 0.12 * Math.sin(d * 140);
    tmp.setHex(0xc0a271).multiplyScalar(rings + (d < endR * 0.35 ? 0.10 : 0));
    ec.setXYZ(i, tmp.r, tmp.g, tmp.b);
  }
  ec.needsUpdate = true;
  parts.push({ geo: end, mat: 'wood' });
  // branch stubs
  for (let i = 0; i < 3; i++) {
    const t = 0.18 + i * 0.28 + hash(i, seed, 11) * 0.1;
    const idx = Math.round(t * steps);
    const base = path[idx];
    const a = hash(i, seed, 13) * Math.PI * 2;
    const stub = tube([
      base.clone(),
      base.clone().add(new THREE.Vector3(Math.cos(a) * r * 0.7, r * 0.6, Math.sin(a) * r * 0.7)),
      base.clone().add(new THREE.Vector3(Math.cos(a) * r * 1.2, r * 1.1, Math.sin(a) * r * 1.2)),
    ], (tt) => r * 0.28 * (1 - tt * 0.6), { sides: 6 });
    colorize(stub, 0x6b5744, { byHeight: () => 1 + hash(i, seed, 17) * 0.3 });
    parts.push({ geo: stub, mat: 'bark' });
  }
  return assemble(parts);
}

export function buildStump(seed, r = 0.3, h = 0.42) {
  const steps = 4;
  const path = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    path.push(new THREE.Vector3(t * 0.03, t * h, t * 0.02));
  }
  const barkGeo = tube(path, (t) => r * (1 - 0.14 * t) * (1 + 0.9 * Math.exp(-t * 7)), {
    sides: 13,
    noise: (a, t) => 1 + 0.05 * Math.sin(a * 8 + seed) + 0.05 * snoise(a * 2.5, t * 9, seed)
      + 0.55 * Math.exp(-t * 5) * Math.max(0, Math.cos(a * 5 + seed)) ** 3,
  });
  colorize(barkGeo, 0x5d4b3a, { byHeight: (hh) => 0.7 + hh * 0.5, grain: 0.08 });
  const parts = [{ geo: barkGeo, mat: 'bark' }];
  // cut top with growth rings
  const top = lathe([[r * 0.03, 0], [r * 0.5, 0.004], [r * 0.85, 0.010], [r * 0.98, 0.004], [r, -0.004]], { sides: 16 });
  xform(top, { pos: [0.03 * 0, h - 0.002, 0.02 * 0] });
  ensureAttrs(top);
  const tc = top.getAttribute('color');
  const tp = top.getAttribute('position');
  const tmp = new THREE.Color();
  for (let i = 0; i < tc.count; i++) {
    const d = Math.hypot(tp.getX(i), tp.getZ(i)) / r;
    const rings = 0.80 + 0.20 * Math.sin(d * 34 + seed * 2) * 0.5 + 0.10 * Math.sin(d * 80);
    tmp.setHex(0xc4a778).multiplyScalar(rings);
    tc.setXYZ(i, tmp.r, tmp.g, tmp.b);
  }
  tc.needsUpdate = true;
  parts.push({ geo: top, mat: 'wood' });
  // exposed roots
  const n = 4 + Math.floor(hash(seed, 3, 5) * 3);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + seed;
    const rootGeo = tube([
      new THREE.Vector3(Math.cos(a) * r * 0.8, h * 0.12, Math.sin(a) * r * 0.8),
      new THREE.Vector3(Math.cos(a) * r * 1.5, h * 0.10, Math.sin(a) * r * 1.5),
      new THREE.Vector3(Math.cos(a) * r * 2.1, 0.01, Math.sin(a) * r * 2.1),
    ], (t) => r * 0.30 * (1 - t * 0.65), { sides: 7, noise: (aa) => 1 + 0.07 * Math.sin(aa * 5 + seed) });
    colorize(rootGeo, 0x6a5642, { byHeight: () => 1 + hash(i, seed, 7) * 0.25 });
    parts.push({ geo: rootGeo, mat: 'bark' });
  }
  return assemble(parts);
}

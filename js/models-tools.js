// Detailed hand-tool models (metres, origin at the grip, +Y along the shaft)
// and the gloved hand that holds them. Built from lathed shafts, forged collars,
// curved blade shells with real thickness and rolled edges, tapered tines and
// wrapping fingers — no box/sphere/cylinder primitives.
import { v3, tube, loft, lathe, mergeGeos, assemble, colorize, xform, hash, arcProfile, roundedRect, plate, snoise } from './geo.js';

const THREE = window.THREE;
const WOOD = 0xa8794a, WOOD2 = 0x8e6238, STEEL = 0xc6cbd0, DARKSTEEL = 0x7c8288, ORANGE = 0xc95a24;

function shaft(y0, y1, r0, r1, opts = {}) {
  const steps = 10;
  const path = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    path.push(new THREE.Vector3(
      (opts.bend || 0) * t * t,
      y0 + (y1 - y0) * t,
      (opts.bow || 0) * Math.sin(t * Math.PI)
    ));
  }
  return tube(path, (t) => r0 + (r1 - r0) * Math.pow(t, opts.taperPow || 1), {
    sides: opts.sides || 12,
    squashX: opts.squashX || 1,
    noise: (a, t) => 1 + 0.02 * Math.sin(a * 3 + (opts.seed || 0)) + 0.012 * snoise(a * 2, t * 12, opts.seed || 1),
  });
}

// Wooden shaft with visible grain and a rubbed finish.
function woodShaft(y0, y1, r0, r1, opts = {}) {
  const g = shaft(y0, y1, r0, r1, opts);
  colorize(g, opts.color || WOOD, {
    byHeight: (h, x, y) => 0.82 + 0.3 * hash(Math.floor(y * 260), Math.floor(x * 180), 3) + 0.08 * Math.sin(y * 90),
    grain: 0.06,
  });
  return g;
}

// A forged collar / socket: lathed with a shoulder and a rivet bump.
function socket(y0, y1, r0, r1, opts = {}) {
  const steps = 7;
  const profile = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    let r = r0 + (r1 - r0) * t;
    if (opts.shoulder) r *= 1 + 0.32 * Math.exp(-Math.pow((t - opts.shoulder) * 6, 2));
    profile.push(r);
  }
  const sections = [];
  const sides = opts.sides || 12;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = y0 + (y1 - y0) * t;
    const ring = [];
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      const rr = profile[i] * (opts.round ? 1 : 1) * (1 + 0.02 * Math.sin(a * 5));
      ring.push(new THREE.Vector3(Math.cos(a) * rr, y, Math.sin(a) * rr));
    }
    sections.push(ring);
  }
  const g = loft(sections, { capStart: true, capEnd: true });
  colorize(g, opts.color || STEEL, { variance: 0.06, grain: 0.03 });
  return g;
}

function knob(y, r, h, color) {
  const g = lathe([
    [r * 0.45, 0], [r * 0.95, h * 0.25], [r, h * 0.55], [r * 0.88, h * 0.85], [r * 0.4, h],
  ], { sides: 14 });
  xform(g, { pos: [0, y, 0] });
  colorize(g, color || WOOD2, { grain: 0.05 });
  return g;
}

// Curved blade shell: an arc cross-section swept with taper, real thickness,
// rolled top edge and a slightly drawn tip.
function bladeShell({ w, h, sag, thick, tipW, sections = 7, curveDrop = 0 }) {
  const rings = [];
  const seg = 10;
  for (let i = 0; i <= sections; i++) {
    const t = i / sections;
    const narrow = 1 - (1 - tipW) * Math.pow(t, 2.0);
    const roundOff = t > 0.88 ? Math.sqrt(Math.max(0.05, 1 - Math.pow((t - 0.88) / 0.12, 2) * 0.82)) : 1;
    const ww = w * narrow * roundOff;
    const arc = arcProfile(ww, sag * (1 - t * 0.55), seg);
    const y = -t * h - curveDrop * t * t;
    const ring = [];
    for (let k = 0; k <= seg; k++) ring.push(new THREE.Vector3(arc[k].x, y, arc[k].y + thick / 2));
    for (let k = seg; k >= 0; k--) ring.push(new THREE.Vector3(arc[k].x, y, arc[k].y - thick / 2));
    rings.push(ring);
  }
  return loft(rings, { capStart: true, capEnd: true });
}

// Rolled lip along an edge (the bit you press with your boot, or the stepped
// shoulder of a flat head).
function rolledEdge(w, y, z, r, color) {
  const path = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    path.push(new THREE.Vector3(-w / 2 + w * t, y + Math.sin(t * Math.PI) * 0.004, z));
  }
  const g = tube(path, r, { sides: 8 });
  colorize(g, color || STEEL, { variance: 0.05 });
  return g;
}

// ---------------------------------------------------------------- spade
export function buildSpade() {
  const parts = [];
  parts.push({ geo: woodShaft(-0.30, 0.80, 0.024, 0.021, { squashX: 0.92, seed: 3 }), mat: 'wood' });
  // D-grip: two struts and a crossbar
  for (const s of [-1, 1]) {
    const strut = tube([
      new THREE.Vector3(0, 0.78, 0),
      new THREE.Vector3(s * 0.035, 0.86, 0),
      new THREE.Vector3(s * 0.052, 0.95, 0),
    ], (t) => 0.017 - t * 0.003, { sides: 8 });
    colorize(strut, WOOD, { grain: 0.05 });
    parts.push({ geo: strut, mat: 'wood' });
  }
  const bar = tube([
    new THREE.Vector3(-0.062, 0.955, 0),
    new THREE.Vector3(0, 0.985, 0),
    new THREE.Vector3(0.062, 0.955, 0),
  ], 0.019, { sides: 10 });
  colorize(bar, WOOD2, { grain: 0.07, variance: 0.05 });
  parts.push({ geo: bar, mat: 'wood' });
  // socket + rivet
  parts.push({ geo: socket(-0.30, -0.42, 0.028, 0.020, { shoulder: 0.15, sides: 12 }), mat: 'metal' });
  const rivet = lathe([[0.004, 0], [0.012, 0.006], [0.014, 0.012], [0.010, 0.016]], { sides: 8 });
  xform(rivet, { rot: [0, 0, Math.PI / 2], pos: [0.026, -0.345, 0] });
  colorize(rivet, DARKSTEEL, { variance: 0.1 });
  parts.push({ geo: rivet, mat: 'metal' });
  // blade
  const blade = bladeShell({ w: 0.235, h: 0.30, sag: 0.028, thick: 0.006, tipW: 0.72, sections: 8, curveDrop: 0.01 });
  xform(blade, { pos: [0, -0.42, 0] });
  colorize(blade, STEEL, { byHeight: h => 0.92 + h * 0.14, variance: 0.05, grain: 0.03 });
  parts.push({ geo: blade, mat: 'metal' });
  parts.push({ geo: rolledEdge(0.225, -0.418, 0, 0.011), mat: 'metal' });
  return assemble(parts);
}

// ---------------------------------------------------------------- flat head
export function buildFlathead() {
  const parts = [];
  parts.push({ geo: woodShaft(-0.20, 0.86, 0.025, 0.022, { squashX: 0.95, seed: 11 }), mat: 'wood' });
  parts.push({ geo: knob(0.86, 0.034, 0.055, WOOD2), mat: 'wood' });
  // long orange socket with the stepped shoulders you stand on
  parts.push({ geo: socket(-0.20, -0.40, 0.030, 0.024, { shoulder: 0.2, sides: 13, color: ORANGE }), mat: 'painted' });
  for (const s of [-1, 1]) {
    const step = plate(roundedRect(0.085, 0.055, 0.012, 3), 0.012, { bevel: 0.004 });
    xform(step, { rot: [0, 0, s * 0.25], pos: [s * 0.052, -0.30, 0.008] });
    colorize(step, ORANGE, { variance: 0.05 });
    parts.push({ geo: step, mat: 'painted' });
  }
  // wide flat blade with a drawn cutting edge
  const blade = bladeShell({ w: 0.345, h: 0.28, sag: 0.010, thick: 0.005, tipW: 0.94, sections: 6, curveDrop: 0 });
  xform(blade, { pos: [0, -0.40, 0] });
  colorize(blade, STEEL, { byHeight: h => 0.9 + h * 0.16, variance: 0.04, grain: 0.03 });
  parts.push({ geo: blade, mat: 'metal' });
  parts.push({ geo: rolledEdge(0.34, -0.398, 0.004, 0.010), mat: 'metal' });
  // bevel strip down each side edge
  for (const s of [-1, 1]) {
    const bev = tube([
      new THREE.Vector3(s * 0.170, -0.408, 0.006),
      new THREE.Vector3(s * 0.172, -0.50, 0.005),
      new THREE.Vector3(s * 0.160, -0.60, 0.004),
    ], 0.006, { sides: 6 });
    colorize(bev, DARKSTEEL, { variance: 0.05 });
    parts.push({ geo: bev, mat: 'metal' });
  }
  return assemble(parts);
}

// ---------------------------------------------------------------- pick axe
export function buildPickaxe() {
  const parts = [];
  parts.push({ geo: woodShaft(-0.16, 0.90, 0.027, 0.023, { squashX: 0.94, seed: 21 }), mat: 'wood' });
  parts.push({ geo: knob(0.90, 0.036, 0.05, WOOD2), mat: 'wood' });
  // forged eye around the shaft
  parts.push({ geo: socket(-0.055, 0.055, 0.040, 0.040, { sides: 13, color: DARKSTEEL }), mat: 'metal' });
  // spike: long tapered loft curving slightly down
  const spikePath = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    spikePath.push(new THREE.Vector3(0.04 + 0.34 * t, 0.012 - 0.045 * t * t, 0));
  }
  const spike = tube(spikePath, (t) => 0.030 * (1 - t * 0.94) + 0.0015, { sides: 8, squashX: 0.62 });
  colorize(spike, STEEL, { byHeight: (h, x) => 0.88 + 0.2 * hash(Math.floor(x * 90), 0, 5), variance: 0.07 });
  parts.push({ geo: spike, mat: 'metal' });
  // chisel / adze end: widens to a forged flat edge
  const adzePath = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    adzePath.push(new THREE.Vector3(-0.04 - 0.16 * t, 0.008 + 0.02 * t, 0));
  }
  const adze = tube(adzePath, (t) => 0.024 - 0.006 * t + 0.008 * Math.exp(-Math.pow((t - 0.75) * 4, 2)), {
    sides: 8, squashX: 0.5,
  });
  colorize(adze, STEEL, { variance: 0.07, grain: 0.03 });
  parts.push({ geo: adze, mat: 'metal' });
  // wedge in the eye
  const wedge = lathe([[0.014, 0], [0.016, 0.03], [0.008, 0.055]], { sides: 8 });
  xform(wedge, { pos: [0.02, 0.045, 0] });
  colorize(wedge, DARKSTEEL, { variance: 0.08 });
  parts.push({ geo: wedge, mat: 'metal' });
  return assemble(parts);
}

// ---------------------------------------------------------------- rake
export function buildRake() {
  const parts = [];
  parts.push({ geo: woodShaft(-0.12, 0.98, 0.023, 0.020, { squashX: 0.94, seed: 31 }), mat: 'wood' });
  parts.push({ geo: knob(0.98, 0.030, 0.045, WOOD2), mat: 'wood' });
  parts.push({ geo: socket(-0.12, -0.30, 0.026, 0.022, { shoulder: 0.3, sides: 11, color: ORANGE }), mat: 'painted' });
  // bowed head bar
  const barPath = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const x = -0.21 + 0.42 * t;
    barPath.push(new THREE.Vector3(x, -0.30 - Math.cos((t - 0.5) * Math.PI) * 0.012, Math.sin((t - 0.5) * Math.PI) * 0.018));
  }
  const bar = tube(barPath, 0.012, { sides: 8 });
  colorize(bar, DARKSTEEL, { variance: 0.06 });
  parts.push({ geo: bar, mat: 'metal' });
  // tines: tapered, bent at the top, forged shoulders
  const n = 12;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const x = -0.20 + 0.40 * t;
    const z = Math.sin((t - 0.5) * Math.PI) * 0.017;
    const len = 0.105 - Math.abs(t - 0.5) * 0.012;
    const tinePath = [
      new THREE.Vector3(x, -0.30, z),
      new THREE.Vector3(x, -0.30 - len * 0.35, z + 0.012),   // forged bend
      new THREE.Vector3(x, -0.30 - len * 0.72, z + 0.006),
      new THREE.Vector3(x, -0.30 - len, z - 0.004),
    ];
    const tine = tube(tinePath, (tt) => 0.0085 * (1 - tt * 0.55), { sides: 7 });
    colorize(tine, DARKSTEEL, { byHeight: () => 0.95 + hash(i, 3, 7) * 0.15, variance: 0.05 });
    parts.push({ geo: tine, mat: 'metal' });
  }
  return assemble(parts);
}

// ---------------------------------------------------------------- gloved hand
// Canonical pose: gripping a shaft that runs along Y through the origin — the
// palm wraps the +x side, four fingers curl around the far side, the thumb comes
// over the top, with a flared fabric cuff at the wrist.
export function buildGloveHand(side = 1) {
  const S = side;
  const shaftR = 0.024;
  const parts = [];
  const leather = 0xb98a5e;

  // ---- palm: rounded cross-sections offset from the shaft, fat on the back
  const sections = [];
  const rows = 7, N = 14;
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;                         // 0 = wrist, 1 = knuckles
    const y = -0.126 + t * 0.158;
    const cx = S * (0.029 + 0.009 * t);
    const w = 0.0095 + 0.0055 * t;              // palm THICKNESS (away from the shaft)
    const d = 0.019 + 0.019 * t;                // palm width across the shaft
    const ring = [];
    for (let j = 0; j < N; j++) {
      const a = (j / N) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const rx = w * (1 + 0.45 * Math.max(0, S * ca));      // slight bulge on the back of the hand
      const rz = d * (1 + 0.10 * Math.cos(a * 2));
      const cup = -0.004 * Math.max(0, -S * ca) * (1 - t * 0.5);   // cupped palm
      ring.push(new THREE.Vector3(cx + ca * rx, y, sa * rz + cup));
    }
    sections.push(ring);
  }
  const palm = loft(sections, { capStart: true, capEnd: true });
  colorize(palm, leather, { variance: 0.045, grain: 0.03, byHeight: h => 0.88 + h * 0.24 });
  parts.push({ geo: palm, mat: 'leather' });

  // ---- four fingers wrapping around the far side of the shaft
  for (let f = 0; f < 4; f++) {
    const yBase = 0.030 - f * 0.023;
    const wrap = 2.95 - f * 0.12;               // radians of curl
    const a0 = 0.95;                            // emerge from the palm's front edge
    const rr = shaftR + 0.015;
    const path = [];
    const steps = 6;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const a = a0 + t * wrap;
      const r = rr + 0.005 * Math.sin(Math.PI * t);
      path.push(new THREE.Vector3(
        Math.cos(a) * r * S,
        yBase - t * 0.004 + Math.sin(Math.PI * t) * 0.003,
        Math.sin(a) * r
      ));
    }
    const finger = tube(path, (t) => 0.0150 * (1 - t * 0.32)
      * (1 + 0.16 * Math.exp(-Math.pow((t - 0.34) * 6, 2)) + 0.16 * Math.exp(-Math.pow((t - 0.68) * 6, 2))),
      { sides: 8 });
    colorize(finger, leather, { byHeight: () => 0.92 + hash(f, 5, 2) * 0.16, variance: 0.04 });
    parts.push({ geo: finger, mat: 'leather' });
  }

  // ---- thumb, laid over the top of the shaft
  const thumbPath = [];
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    const a = 0.60 + t * 1.35;
    const r = shaftR + 0.026 - t * 0.004;
    thumbPath.push(new THREE.Vector3(
      Math.cos(a) * r * S,
      0.048 + t * 0.026,
      Math.sin(a) * r * 0.95
    ));
  }
  const thumb = tube(thumbPath, (t) => 0.0180 * (1 - t * 0.28) * (1 + 0.12 * Math.exp(-Math.pow((t - 0.45) * 4, 2))), { sides: 8 });
  colorize(thumb, leather, { variance: 0.04, byHeight: () => 1.0 });
  parts.push({ geo: thumb, mat: 'leather' });

  // ---- knuckle pads so the back of the hand does not read as a slab
  for (let f = 0; f < 4; f++) {
    const y = 0.032 - f * 0.023;
    const pad = lathe([[0.004, 0], [0.012, 0.004], [0.013, 0.012], [0.005, 0.016]], { sides: 8 });
    xform(pad, { rot: [0, 0, -S * Math.PI / 2], pos: [S * 0.039, y, 0.006] });
    colorize(pad, leather, { variance: 0.05, byHeight: () => 0.94 });
    parts.push({ geo: pad, mat: 'leather' });
  }

  // ---- flared fabric cuff at the wrist
  const cuff = lathe([
    [0.022, -0.086], [0.030, -0.074], [0.034, -0.056], [0.037, -0.038], [0.039, -0.020], [0.036, -0.004], [0.030, 0.008],
  ], { sides: 14, noise: (a, y) => 1 + 0.016 * Math.sin(a * 7) });
  xform(cuff, { pos: [S * 0.031, -0.070, 0.000], rot: [0.06 * S, 0, 0.06 * S] });
  colorize(cuff, 0x4e5c48, { variance: 0.05, grain: 0.04, byHeight: h => 0.86 + h * 0.28 });
  parts.push({ geo: cuff, mat: 'cloth' });

  return assemble(parts);
}

// ---------------------------------------------------------------- registry
export const TOOL_MODELS = {
  spade: buildSpade,
  flathead: buildFlathead,
  pickaxe: buildPickaxe,
  rake: buildRake,
};

// y of the lowest point of each tool in grip space (for burying it in the dirt)
export const TOOL_TIP_Y = {
  spade: -0.73, flathead: -0.70, pickaxe: -0.18, rake: -0.42,
};

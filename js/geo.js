// Procedural geometry toolkit for building detailed models — lofts, tapered
// tubes along curves, lathes, beveled plates, displacement and merging.
// Everything produced here is real geometry: bevelled edges, varied silhouettes,
// tapered profiles. No primitives are used for visible objects.
const THREE = window.THREE;

export const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------- utilities
export function ensureAttrs(geo) {
  const n = geo.getAttribute('position').count;
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();
  if (!geo.getAttribute('uv')) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (!geo.getAttribute('color')) {
    const c = new Float32Array(n * 3).fill(1);
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }
  return geo;
}

// Merge geometries with identical attribute sets (position/normal/uv/color).
export function mergeGeos(list) {
  const geos = list.filter(Boolean).map(ensureAttrs);
  if (!geos.length) return null;
  if (geos.length === 1) return geos[0];
  let total = 0, idxTotal = 0;
  for (const g of geos) {
    total += g.getAttribute('position').count;
    idxTotal += g.index ? g.index.count : g.getAttribute('position').count;
  }
  const pos = new Float32Array(total * 3);
  const nrm = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  const col = new Float32Array(total * 3);
  const idx = new Uint32Array(idxTotal);
  let vo = 0, io = 0;
  for (const g of geos) {
    const p = g.getAttribute('position'), nA = g.getAttribute('normal');
    const u = g.getAttribute('uv'), c = g.getAttribute('color');
    pos.set(p.array, vo * 3);
    nrm.set(nA.array, vo * 3);
    uv.set(u.array, vo * 2);
    col.set(c.array, vo * 3);
    const count = p.count;
    if (g.index) {
      const gi = g.index.array;
      for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
      io += gi.length;
    } else {
      for (let i = 0; i < count; i++) idx[io + i] = i + vo;
      io += count;
    }
    vo += count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

// Assemble parts into { materialKey: geometry } so a model costs one draw call
// per material it actually uses.
export function assemble(parts) {
  const byMat = new Map();
  for (const part of parts) {
    if (!part || !part.geo) continue;
    const key = part.mat || 'default';
    if (!byMat.has(key)) byMat.set(key, []);
    byMat.get(key).push(part.geo);
  }
  const out = new Map();
  for (const [key, list] of byMat) out.set(key, mergeGeos(list));
  return out;
}

// Signed-volume test — flips indices if the mesh is inside-out.
export function autoOrient(geo) {
  if (!geo.index) return geo;
  const p = geo.getAttribute('position');
  const idx = geo.index;
  let vol = 0;
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
    const ax = p.getX(a), ay = p.getY(a), az = p.getZ(a);
    const bx = p.getX(b), by = p.getY(b), bz = p.getZ(b);
    const cx = p.getX(c), cy = p.getY(c), cz = p.getZ(c);
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  if (vol < 0) {
    const arr = idx.array;
    for (let i = 0; i < arr.length; i += 3) {
      const t = arr[i + 1]; arr[i + 1] = arr[i + 2]; arr[i + 2] = t;
    }
    geo.index.needsUpdate = true;
  }
  geo.computeVertexNormals();
  return geo;
}

export function displace(geo, fn) {
  const p = geo.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const d = fn(x, y, z, i);
    if (typeof d === 'number') { p.setXYZ(i, x * d, y * d, z * d); }
    else if (d) { p.setXYZ(i, x + d.x, y + d.y, z + d.z); }
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

export function colorize(geo, color, opts = {}) {
  ensureAttrs(geo);
  const c = geo.getAttribute('color');
  const base = new THREE.Color(color);
  const tmp = new THREE.Color();
  const p = geo.getAttribute('position');
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const span = Math.max(1e-6, bb.max.y - bb.min.y);
  for (let i = 0; i < c.count; i++) {
    let k = 1;
    if (opts.byHeight) k = opts.byHeight((p.getY(i) - bb.min.y) / span, p.getX(i), p.getZ(i));
    if (opts.grain) {
      const g = 1 + (opts.grain * (Math.sin(p.getX(i) * 41.3 + p.getY(i) * 17.7 + p.getZ(i) * 29.1)));
      k *= g;
    }
    if (opts.variance) {
      const n = (Math.sin(i * 12.9898) * 43758.5453) % 1;
      k *= 1 + opts.variance * ((n < 0 ? n + 1 : n) - 0.5);
    }
    tmp.copy(base).multiplyScalar(k);
    c.setXYZ(i, tmp.r, tmp.g, tmp.b);
  }
  c.needsUpdate = true;
  return geo;
}

export function xform(geo, { pos, rot, scale, quat } = {}) {
  const m = new THREE.Matrix4();
  const q = quat ? quat : new THREE.Quaternion();
  if (rot) q.setFromEuler(new THREE.Euler(rot[0] || 0, rot[1] || 0, rot[2] || 0));
  m.compose(
    new THREE.Vector3(pos ? pos[0] : 0, pos ? pos[1] : 0, pos ? pos[2] : 0),
    q,
    new THREE.Vector3(scale ? scale[0] : 1, scale ? scale[1] : (scale ? scale[0] : 1), scale ? scale[2] : (scale ? scale[0] : 1))
  );
  geo.applyMatrix4(m);
  return geo;
}

export function facet(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- profiles
// Rounded rectangle outline in 2D (used for trays, coolers, boards, blades).
export function roundedRect(w, h, r, seg = 3) {
  const pts = [];
  const hw = w / 2, hh = h / 2;
  r = Math.min(r, hw - 1e-4, hh - 1e-4);
  const corners = [[hw - r, hh - r, 0], [-hw + r, hh - r, Math.PI / 2],
    [-hw + r, -hh + r, Math.PI], [hw - r, -hh + r, -Math.PI / 2]];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (Math.PI / 2);
      pts.push(new THREE.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
    }
  }
  return pts;
}

// Arc cross-section (blade scoop): width w, sag depth s, thickness t.
export function arcProfile(w, sag, seg = 8) {
  const out = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const x = (t - 0.5) * w;
    const y = sag * (1 - Math.pow((t - 0.5) * 2, 2));
    out.push(new THREE.Vector2(x, y));
  }
  return out;
}

// ---------------------------------------------------------------- builders
// Loft a list of closed rings (arrays of Vector3, equal length) into a surface.
export function loft(sections, opts = {}) {
  const n = sections[0].length;
  const rings = sections.length;
  const verts = [];
  for (const s of sections) for (const p of s) verts.push(p.x, p.y, p.z);
  const idx = [];
  for (let r = 0; r < rings - 1; r++) {
    for (let j = 0; j < n; j++) {
      const j2 = (j + 1) % n;
      const a = r * n + j, b = (r + 1) * n + j, c = (r + 1) * n + j2, d = r * n + j2;
      idx.push(a, b, c, a, c, d);
    }
  }
  const addCap = (ringIdx, flip) => {
    const centre = new THREE.Vector3();
    for (const p of sections[ringIdx]) centre.add(p);
    centre.multiplyScalar(1 / n);
    const ci = verts.length / 3;
    verts.push(centre.x, centre.y, centre.z);
    const base = ringIdx * n;
    for (let j = 0; j < n; j++) {
      const j2 = (j + 1) % n;
      if (flip) idx.push(ci, base + j2, base + j);
      else idx.push(ci, base + j, base + j2);
    }
  };
  if (opts.capStart) addCap(0, true);
  if (opts.capEnd) addCap(rings - 1, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (opts.orient !== false) autoOrient(g);
  return g;
}

// Parallel-transport frames along a path so tubes do not twist.
export function pathFrames(path, up = new THREE.Vector3(0, 1, 0)) {
  const frames = [];
  let nrm = null;
  for (let i = 0; i < path.length; i++) {
    const t = new THREE.Vector3();
    if (i === 0) t.subVectors(path[1], path[0]);
    else if (i === path.length - 1) t.subVectors(path[i], path[i - 1]);
    else t.subVectors(path[i + 1], path[i - 1]);
    t.normalize();
    if (!nrm) {
      nrm = new THREE.Vector3().crossVectors(up, t);
      if (nrm.lengthSq() < 1e-6) nrm.set(1, 0, 0);
      nrm.normalize();
    } else {
      // project previous normal onto the plane perpendicular to t
      nrm.addScaledVector(t, -nrm.dot(t)).normalize();
    }
    const bin = new THREE.Vector3().crossVectors(t, nrm).normalize();
    frames.push({ pos: path[i].clone(), t, n: nrm.clone(), b: bin });
  }
  return frames;
}

// Tapered tube along a path. radius(t) may return a number or an object
// {rx, ry}. noise(angle, t) multiplies the radius (bark ridges, knots).
export function tube(path, radius, opts = {}) {
  const sides = opts.sides || 8;
  const frames = pathFrames(path, opts.up);
  const sections = [];
  for (let i = 0; i < frames.length; i++) {
    const t = i / (frames.length - 1);
    let r = typeof radius === 'function' ? radius(t, i) : radius;
    const f = frames[i];
    const ring = [];
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      let rr = r;
      if (opts.noise) rr *= opts.noise(a, t, i, j);
      const off = 0.5 * (opts.squash ? 1 - opts.squash : 0);
      ring.push(f.pos.clone()
        .addScaledVector(f.n, Math.cos(a) * rr * (opts.squashX || 1))
        .addScaledVector(f.b, Math.sin(a) * rr));
    }
    sections.push(ring);
  }
  return loft(sections, { capStart: opts.capStart !== false, capEnd: opts.capEnd !== false });
}

// Revolve a 2D profile [[radius, height], ...] around Y.
export function lathe(profile, opts = {}) {
  const sides = opts.sides || 20;
  const sections = [];
  for (const [r, y] of profile) {
    const ring = [];
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      let rr = r;
      if (opts.noise) rr *= opts.noise(a, y);
      ring.push(new THREE.Vector3(Math.cos(a) * rr, y, Math.sin(a) * rr));
    }
    sections.push(ring);
  }
  return loft(sections, { capStart: opts.capStart !== false, capEnd: opts.capEnd !== false });
}

// Beveled extruded plate from a 2D outline — real chamfers on every edge.
export function plate(outline, thickness, opts = {}) {
  const shape = new THREE.Shape(outline);
  const bevel = opts.bevel === undefined ? Math.min(thickness * 0.6, 0.012) : opts.bevel;
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(1e-4, thickness - bevel * 2),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: opts.bevelSegments || 2,
    curveSegments: opts.curveSegments || 6,
    steps: 1,
  });
  g.translate(0, 0, -thickness / 2);
  g.computeVertexNormals();
  return g;
}

// Loft a 2D outline through a stack of transforms (for trays, cooler bodies,
// bags — anything with a shaped cross-section that changes up the body).
export function loftOutline(outline, steps) {
  const sections = steps.map(s => outline.map(p => {
    const x = p.x * (s.sx === undefined ? 1 : s.sx);
    const y = p.y * (s.sy === undefined ? 1 : s.sy);
    return new THREE.Vector3(x, s.y, y);
  }));
  return loft(sections, { capStart: true, capEnd: true });
}

// ---------------------------------------------------------------- noise
export function hash(x, y = 0, z = 0) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}
export function snoise(x, y = 0, z = 0) { return hash(x, y, z) * 2 - 1; }

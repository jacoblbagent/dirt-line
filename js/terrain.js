// Dirt Jumps — deformable dirt heightfield with soil state, angle-of-repose
// slumping, compaction (packing), and a paintable surface-mark texture.
import { CFG, MK, clamp } from './config.js';
import { fbm, rnd } from './noise.js';

const THREE = window.THREE;

const DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

export class Terrain {
  constructor() {
    const N = this.N = CFG.GRID;
    this.cell = CFG.CELL;
    this.half = CFG.HALF;
    this.world = CFG.WORLD;
    const n = N * N;
    this.h = new Float32Array(n);
    this.h0 = new Float32Array(n);
    this.p = new Uint8Array(n);   // packed 0..255
    this.g = new Uint8Array(n);   // grass coverage
    this.hd = new Uint8Array(n);  // soil hardness (natural resistance)
    this.mk = new Uint8Array(n);  // last mark left on the cell
    this.cp = new Float32Array(n); // metres already settled out by packing
    this.active = new Uint8Array(n);
    this.queue = [];
    this.qhead = 0;
    this.dirtyLo = Infinity;
    this.dirtyHi = -Infinity;
    this.texDirty = false;
    this.loosePainted = 0;
  }

  // ---------- indexing ----------
  idx(c, r) { return r * this.N + c; }
  colOf(x) { return (x + this.half) / this.cell; }
  rowOf(z) { return (z + this.half) / this.cell; }
  xOf(c) { return -this.half + c * this.cell; }
  zOf(r) { return -this.half + r * this.cell; }
  inWorld(x, z) { return x > -this.half + 1 && x < this.half - 1 && z > -this.half + 1 && z < this.half - 1; }

  heightAt(x, z) {
    const fc = clamp(this.colOf(x), 0, this.N - 1.001);
    const fr = clamp(this.rowOf(z), 0, this.N - 1.001);
    const c0 = Math.floor(fc), r0 = Math.floor(fr);
    const tx = fc - c0, tz = fr - r0;
    const i = r0 * this.N + c0;
    const h00 = this.h[i], h10 = this.h[i + 1];
    const h01 = this.h[i + this.N], h11 = this.h[i + this.N + 1];
    const a = h00 + (h10 - h00) * tx;
    const b = h01 + (h11 - h01) * tx;
    return a + (b - a) * tz;
  }

  slopeAt(x, z) {
    const d = this.cell;
    const hx = this.heightAt(x + d, z) - this.heightAt(x - d, z);
    const hz = this.heightAt(x, z + d) - this.heightAt(x, z - d);
    return Math.sqrt(hx * hx + hz * hz) / (2 * d);
  }

  packedAt(x, z) {
    const c = clamp(Math.round(this.colOf(x)), 0, this.N - 1);
    const r = clamp(Math.round(this.rowOf(z)), 0, this.N - 1);
    return this.p[r * this.N + c];
  }

  normalAt(x, z, out) {
    const d = this.cell;
    const hx = this.heightAt(x + d, z) - this.heightAt(x - d, z);
    const hz = this.heightAt(x, z + d) - this.heightAt(x, z - d);
    const v = out || new THREE.Vector3();
    return v.set(-hx / (2 * d), 1, -hz / (2 * d)).normalize();
  }

  mark(i) {
    const lo = this.dirtyLo, hi = this.dirtyHi;
    if (i < lo) this.dirtyLo = i;
    if (i > hi) this.dirtyHi = i;
  }

  activate(i) {
    if (this.active[i]) return;
    this.active[i] = 1;
    this.queue.push(i);
  }

  activateAround(c, r, rad) {
    const c0 = Math.max(0, c - rad), c1 = Math.min(this.N - 1, c + rad);
    const r0 = Math.max(0, r - rad), r1 = Math.min(this.N - 1, r + rad);
    for (let rr = r0; rr <= r1; rr++) {
      const base = rr * this.N;
      for (let cc = c0; cc <= c1; cc++) this.activate(base + cc);
    }
  }

  // ---------- world generation ----------
  generate(seed) {
    const N = this.N, S = seed | 0;
    // low rolling base + a long ridge on the far side, gentle enough that
    // natural ground (slightly consolidated) never slumps on its own.
    for (let r = 0; r < N; r++) {
      const z = this.zOf(r);
      for (let c = 0; c < N; c++) {
        const x = this.xOf(c);
        const i = r * N + c;
        let h = 0;
        h += 3.1 * fbm((x + 400) / 62, (z + 400) / 62, S, 3);
        h += 1.35 * fbm((x + 900) / 21, (z + 900) / 21, S + 11, 3) - 0.6;
        h += 0.42 * fbm((x + 55) / 6.5, (z + 55) / 6.5, S + 29, 2) - 0.2;
        h += 2.4 * fbm((x + 30) / 150, (z + 30) / 150, S + 71, 3);
        this.h[i] = h;
      }
    }
    // Flatten the working dirt zone so there is room for jump lines.
    const zx = -6, zz = -10, zw = 64, zd = 46, margin = 7;
    let avg = 0, cnt = 0;
    for (let r = 0; r < N; r++) {
      const z = this.zOf(r);
      if (Math.abs(z - zz) > zd / 2) continue;
      for (let c = 0; c < N; c++) {
        const x = this.xOf(c);
        if (Math.abs(x - zx) > zw / 2) continue;
        avg += this.h[r * N + c]; cnt++;
      }
    }
    avg = cnt ? avg / cnt : 0;
    const inside = (x, z) => {
      const dx = Math.abs(x - zx) - zw / 2, dz = Math.abs(z - zz) - zd / 2;
      const d = Math.max(dx, dz);
      return d < 0 ? 1 : clamp(1 - d / margin, 0, 1);
    };
    for (let r = 0; r < N; r++) {
      const z = this.zOf(r);
      for (let c = 0; c < N; c++) {
        const x = this.xOf(c), i = r * N + c;
        const t = inside(x, z);
        // flatten the working zone, but keep some natural roll in it
        this.h[i] = this.h[i] * (1 - 0.82 * t) + avg * 0.82 * t;
        this.p[i] = 140; // natural ground is partly consolidated
        const slopeNoise = fbm((x + 21) / 14, (z + 21) / 14, S + 5, 3);
        this.hd[i] = clamp(55 + 150 * slopeNoise, 30, 235) | 0;
        const grassNoise = fbm((x + 300) / 17, (z + 300) / 17, S + 3, 3);
        let gc = clamp((grassNoise * 1.75 - 0.38) * 300, 0, 255);
        gc *= 1 - 0.45 * t;
        this.g[i] = gc | 0;
      }
    }
    // kill grass on steep natural slopes
    for (let r = 1; r < N - 1; r++) {
      for (let c = 1; c < N - 1; c++) {
        const i = r * N + c;
        const slope = this.slopeAt(this.xOf(c), this.zOf(r));
        if (slope > 0.62) this.g[i] = (this.g[i] * 0.25) | 0;
      }
    }
    this.h0.set(this.h);
    this.cp.fill(0);
  }

  // Scattered trees: jittered grid + noise density, kept out of the dirt zone
  // and off steep ground so jump lines stay clear.
  generateTrees(seed, zone) {
    const S = (seed | 0) + 501, out = [];
    // keep every trunk comfortably inside the walkable area (the player is
    // clamped to ±(HALF-2)), so no tree ever sits in the dead margin
    const edge = this.half - 5, step = 4.2, N = this.N;
    for (let z = -edge; z < edge; z += step) {
      for (let x = -edge; x < edge; x += step) {
        const jx = (rnd((x * 71 + z * 13) | 0, S) - 0.5) * step * 0.9;
        const jz = (rnd((x * 17 - z * 37) | 0, S + 3) - 0.5) * step * 0.9;
        const px = x + jx, pz = z + jz;
        const dens = fbm((px + 50) / 34, (pz + 50) / 34, S, 3);
        const near = fbm((px + 12) / 9, (pz + 12) / 9, S + 9, 2);
        const chance = clamp((dens * 1.5 - 0.55) + near * 0.22, 0, 1);
        if (rnd(((px * 131) ^ (pz * 977)) | 0, S + 77) > chance * 0.95) continue;
        if (zone && zone.contains(px, pz, 5)) continue;
        if (this.slopeAt(px, pz) > 0.55) continue;
        let ok = true;
        for (const t of out) {
          const dx = t.x - px, dz = t.z - pz;
          if (dx * dx + dz * dz < 13.5) { ok = false; break; }
        }
        if (!ok) continue;
        const r1 = rnd((px * 3 + pz * 7) | 0, S + 41);
        const r2 = rnd((px * 19 - pz * 5) | 0, S + 53);
        const r3 = rnd((px * 11 + pz * 29) | 0, S + 59);
        out.push({
          x: px, z: pz,
          scale: 0.72 + r1 * 0.85,
          hMul: 0.78 + r3 * 0.75,          // height varies a lot tree to tree
          crownMul: 0.78 + r2 * 0.5,
          rot: r2 * Math.PI * 2,
          lean: (r1 - 0.5) * 0.08,
          trunkR: 0.09 + r1 * 0.10,
          dead: r2 < 0.11,
        });
      }
    }
    return out;
  }

  // ---------- mesh + surface texture ----------
  buildMesh() {
    const N = this.N, n = N * N;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const i = r * N + c;
        pos[i * 3] = this.xOf(c);
        pos[i * 3 + 1] = this.h[i];
        pos[i * 3 + 2] = this.zOf(r);
        uv[i * 2] = c / (N - 1);
        uv[i * 2 + 1] = 1 - r / (N - 1);
        col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 1;
      }
    }
    const idx = new Uint32Array((N - 1) * (N - 1) * 6);
    let k = 0;
    for (let r = 0; r < N - 1; r++) {
      for (let c = 0; c < N - 1; c++) {
        const a = r * N + c, b = a + 1, cc = a + N, d = cc + 1;
        // winding: a,c,b / c,d,b -> faces +Y (up) for a camera above
        idx[k++] = a; idx[k++] = cc; idx[k++] = b;
        idx[k++] = cc; idx[k++] = d; idx[k++] = b;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    this.texCanvas = document.createElement('canvas');
    this.texCanvas.width = this.texCanvas.height = CFG.TEX;
    this.texCtx = this.texCanvas.getContext('2d');
    this.paintBaseTexture();
    const tex = new THREE.CanvasTexture(this.texCanvas);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.anisotropy = 4;
    this.texture = tex;

    const mat = new THREE.MeshStandardMaterial({
      map: tex, vertexColors: true, roughness: 0.94, metalness: 0.0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.mesh = mesh;
    this.geo = geo;
    this.posAttr = geo.getAttribute('position');
    this.colAttr = geo.getAttribute('color');
    this.normAttr = geo.getAttribute('normal');
    this.refreshColors();
    return mesh;
  }

  // pixel coords for a world position on the paint canvas
  px(x) { return (x + this.half) / this.world * CFG.TEX; }
  py(z) { return (z + this.half) / this.world * CFG.TEX; }

  paintBaseTexture() {
    const ctx = this.texCtx, T = CFG.TEX, S = 4021;
    const img = ctx.createImageData(T, T);
    const d = img.data;
    const pxPerM = T / this.world;
    for (let y = 0; y < T; y++) {
      const wz = y / pxPerM - this.half;
      for (let x = 0; x < T; x++) {
        const wx = x / pxPerM - this.half;
        const o = (y * T + x) * 4;
        const grain = fbm((wx + 700) / 1.35, (wz + 700) / 1.35, S, 2);
        const litter = fbm((wx + 60) / 3.1, (wz + 60) / 3.1, S + 5, 2);
        const clod = fbm((wx + 400) / 0.55, (wz + 400) / 0.55, S + 17, 2);
        // base soil — pale clay under dark topsoil, like a fresh dig
        let R = 116 + grain * 42 + clod * 18, G = 98 + grain * 34 + clod * 14,
            B = 74 + grain * 26 + clod * 10;
        // leaf / pine-needle litter mottling
        const lit = clamp((litter - 0.50) * 2.6, 0, 1);
        R += lit * 28; G += lit * 10; B -= lit * 6;
        // grass coverage from the grid
        const i = this.idx(clamp(Math.round(this.colOf(wx)), 0, this.N - 1),
                           clamp(Math.round(this.rowOf(wz)), 0, this.N - 1));
        const gc = this.g[i] / 255;
        if (gc > 0.01) {
          const patch = 0.55 + 0.45 * fbm((wx + 3) / 1.1, (wz + 3) / 1.1, S + 13, 2);
          const g1 = gc * patch;
          const gR = 60 + grain * 34, gG = 84 + grain * 42, gB = 42 + grain * 22;
          R = R * (1 - g1) + gR * g1;
          G = G * (1 - g1) + gG * g1;
          B = B * (1 - g1) + gB * g1;
        }
        d[o] = R; d[o + 1] = G; d[o + 2] = B; d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // twig / stick litter streaks, like the reference photos
    ctx.globalAlpha = 0.62;
    const litterN = Math.round(2600 * (CFG.TEX / 1024) ** 2);
    for (let i = 0; i < litterN; i++) {
      const wx = -this.half + rnd(i * 13, S + 61) * this.world;
      const wz = -this.half + rnd(i * 29, S + 67) * this.world;
      const gi = this.idx(clamp(Math.round(this.colOf(wx)), 0, this.N - 1),
                          clamp(Math.round(this.rowOf(wz)), 0, this.N - 1));
      if (this.g[gi] > 150) continue;
      const a = rnd(i * 7, S + 71) * Math.PI * 2;
      const len = 3 + rnd(i * 5, S + 73) * 12;
      ctx.save();
      ctx.translate(this.px(wx), this.py(wz));
      ctx.rotate(a);
      ctx.strokeStyle = rnd(i, S + 79) > 0.45
        ? `rgba(${92 + rnd(i, S + 83) * 34 | 0},${58 + rnd(i, S + 87) * 22 | 0},34,0.6)`
        : `rgba(${60 + rnd(i, S + 79) * 40 | 0},${48 + rnd(i, S + 83) * 30 | 0},34,0.5)`;
      ctx.lineWidth = 0.8 + rnd(i * 3, S + 89) * 1.6;
      ctx.beginPath(); ctx.moveTo(-len / 2, 0); ctx.lineTo(len / 2, 0); ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    // moss patches in the damp, grassy corners of the woods
    ctx.globalAlpha = 0.30;
    for (let i = 0; i < Math.round(700 * (CFG.TEX / 1024) ** 2); i++) {
      const wx = -this.half + rnd(i * 31, S + 131) * this.world;
      const wz = -this.half + rnd(i * 53, S + 137) * this.world;
      const gi = this.idx(clamp(Math.round(this.colOf(wx)), 0, this.N - 1),
                          clamp(Math.round(this.rowOf(wz)), 0, this.N - 1));
      if (this.g[gi] < 110) continue;
      const r = 3 + rnd(i * 19, S + 139) * 9;
      ctx.fillStyle = 'rgba(52,70,36,1)';
      ctx.beginPath();
      ctx.ellipse(this.px(wx), this.py(wz), r, r * 0.7, rnd(i * 7, S + 149) * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // pebbles / clods so the ground has something to read up close
    const pebN = Math.round(1400 * (CFG.TEX / 1024) ** 2);
    for (let i = 0; i < pebN; i++) {
      const wx = -this.half + rnd(i * 23, S + 101) * this.world;
      const wz = -this.half + rnd(i * 41, S + 103) * this.world;
      const r = 1.2 + rnd(i * 17, S + 107) * 3.6;
      ctx.fillStyle = rnd(i, S + 109) > 0.5
        ? 'rgba(168,148,120,0.45)' : 'rgba(74,60,44,0.38)';
      ctx.beginPath();
      ctx.ellipse(this.px(wx), this.py(wz), r, r * 0.75, rnd(i * 3, S + 113) * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Repaint a patch of ground as disturbed soil (digging / pouring).
  paintSoil(x, z, r, dark) {
    const ctx = this.texCtx;
    const cx = this.px(x), cy = this.py(z), pr = Math.max(2, r / this.world * CFG.TEX);
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath();
    ctx.arc(cx, cy, pr, 0, Math.PI * 2);
    const grd = ctx.createRadialGradient(cx, cy, pr * 0.1, cx, cy, pr);
    const base = dark ? [96, 73, 54] : [126, 103, 79];
    grd.addColorStop(0, `rgba(${base[0]},${base[1]},${base[2]},0.95)`);
    grd.addColorStop(0.72, `rgba(${base[0] + 6},${base[1] + 6},${base[2] + 4},0.8)`);
    grd.addColorStop(1, 'rgba(120,98,76,0)');
    ctx.fillStyle = grd;
    ctx.fill();
    ctx.restore();
    this.texDirty = true;
  }

  // Stamp a tool mark. angle = heading of the stroke (radians).
  paintMark(x, z, r, type, angle) {
    const ctx = this.texCtx, S = 9137;
    const pr = Math.max(2.5, r / this.world * CFG.TEX);
    const cx = this.px(x), cy = this.py(z);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.globalCompositeOperation = 'source-over';
    if (type === MK.FLAT || type === MK.SHAVE) {
      // wide, smooth, light packed face — flat-head is the preferred packer
      const g = ctx.createRadialGradient(0, 0, pr * 0.15, 0, 0, pr * 1.15);
      g.addColorStop(0, 'rgba(206,188,163,0.85)');
      g.addColorStop(0.6, 'rgba(186,167,142,0.6)');
      g.addColorStop(1, 'rgba(170,150,126,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(0, 0, pr * 1.15, pr * 0.92, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = 'rgba(150,132,110,1)';
      ctx.lineWidth = Math.max(1, pr * 0.1);
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.ellipse(0, i * pr * 0.34, pr * 0.95, pr * 0.16, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (type === MK.SPADE) {
      // back-of-spade slap: narrower, with parallel impact ridges
      ctx.globalAlpha = 0.6;
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, pr);
      g.addColorStop(0, 'rgba(178,157,132,0.75)');
      g.addColorStop(1, 'rgba(160,140,118,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(0, 0, pr * 0.72, pr, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.3;
      ctx.strokeStyle = 'rgba(120,101,80,1)';
      ctx.lineWidth = Math.max(1, pr * 0.09);
      for (let i = -2; i <= 2; i++) {
        const yy = i * pr * 0.3;
        ctx.beginPath();
        ctx.moveTo(-pr * 0.55, yy);
        ctx.quadraticCurveTo(0, yy + pr * 0.08, pr * 0.55, yy);
        ctx.stroke();
      }
    } else if (type === MK.RAKE) {
      // grooming grooves
      ctx.globalAlpha = 0.3;
      ctx.strokeStyle = 'rgba(92,74,55,1)';
      ctx.lineWidth = Math.max(1, pr * 0.07);
      const n = 7;
      for (let i = 0; i < n; i++) {
        const yy = (i - (n - 1) / 2) * pr * 0.24;
        ctx.beginPath();
        ctx.moveTo(-pr * 0.95, yy);
        ctx.lineTo(pr * 0.95, yy + pr * 0.12);
        ctx.stroke();
      }
    } else if (type === MK.PICK) {
      // scattered pocks / broken ground
      ctx.globalAlpha = 0.55;
      const n = 9;
      for (let i = 0; i < n; i++) {
        const a = rnd(i * 3 + (x * 91 | 0), S) * Math.PI * 2;
        const rr = rnd(i * 7 + (z * 37 | 0), S + 3) * pr * 0.95;
        const s = pr * (0.13 + rnd(i * 11, S + 5) * 0.16);
        ctx.fillStyle = i % 2 ? 'rgba(76,60,44,0.85)' : 'rgba(156,136,112,0.6)';
        ctx.beginPath(); ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr, s, 0, Math.PI * 2); ctx.fill();
      }
    } else if (type === MK.DIG || type === MK.LOOSE) {
      this.paintSoilRotated(ctx, pr, type === MK.DIG ? 1 : 0);
    }
    ctx.restore();
    this.texDirty = true;
  }

  paintSoilRotated(ctx, pr, dark) {
    const base = dark ? [96, 73, 54] : [128, 105, 81];
    ctx.globalAlpha = 0.9;
    const g = ctx.createRadialGradient(0, 0, pr * 0.1, 0, 0, pr);
    g.addColorStop(0, `rgba(${base[0]},${base[1]},${base[2]},0.95)`);
    g.addColorStop(0.7, `rgba(${base[0] + 4},${base[1] + 4},${base[2] + 2},0.75)`);
    g.addColorStop(1, 'rgba(122,100,78,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, pr, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.35;
    for (let i = 0; i < 6; i++) {
      const a = i * 1.05, rr = pr * 0.5;
      ctx.fillStyle = i % 2 ? 'rgba(78,60,44,0.7)' : 'rgba(148,127,102,0.6)';
      ctx.beginPath();
      ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr, pr * 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---------- brushes ----------
  cellRange(x, z, r) {
    const c0 = clamp(Math.floor(this.colOf(x - r)), 0, this.N - 1);
    const c1 = clamp(Math.ceil(this.colOf(x + r)), 0, this.N - 1);
    const r0 = clamp(Math.floor(this.rowOf(z - r)), 0, this.N - 1);
    const r1 = clamp(Math.ceil(this.rowOf(z + r)), 0, this.N - 1);
    return [c0, c1, r0, r1];
  }

  resist(i) { return 0.42 + this.hd[i] / 255 * 1.15 + this.p[i] / 255 * 0.72; }

  // Excavate. Returns litres of loose spoil collected.
  dig(x, z, r, tool, dt, out) {
    const [c0, c1, r0, r1] = this.cellRange(x, z, r);
    const cellArea = this.cell * this.cell;
    let litres = 0, bites = 0;
    const power = tool.power * (tool.hardBias
      ? 1 + tool.hardBias * (this.hd[this.idx(clamp(Math.round(this.colOf(x)), 0, this.N - 1),
        clamp(Math.round(this.rowOf(z)), 0, this.N - 1))] / 255)
      : 1);
    for (let rr = r0; rr <= r1; rr++) {
      const wz = this.zOf(rr);
      for (let cc = c0; cc <= c1; cc++) {
        const wx = this.xOf(cc);
        const dx = wx - x, dz = wz - z;
        const d2 = dx * dx + dz * dz;
        if (d2 > r * r) continue;
        const d = Math.sqrt(d2);
        const prof = Math.pow(1 - d / r, 0.75) * (1 + 0.5 * (1 - d / r));
        const i = rr * this.N + cc;
        let amt = power * CFG.DIG_RATE * dt * prof / this.resist(i);
        amt = Math.min(amt, 0.05);
        if (this.h[i] - amt < -3.6) amt = Math.max(0, this.h[i] + 3.6);
        if (amt <= 0) continue;
        const loose = this.h[i] < this.h0[i] - 0.02;
        const frag = loose ? 1.0 : 0.82;
        this.h[i] -= amt * frag;
        litres += amt * frag * cellArea * 1000 * CFG.BULK;
        bites++;
        this.p[i] = Math.max(0, this.p[i] - amt * 420) | 0;
        this.g[i] = Math.max(0, this.g[i] - amt * 1400) | 0;
        this.hd[i] = Math.max(22, this.hd[i] - amt * 220 * (tool.loosen ?? 1)) | 0;
        this.cp[i] = Math.max(0, this.cp[i] - amt);
        this.mk[i] = tool.digMark;
        this.mark(i);
        this.activateAround(cc, rr, 2);
      }
    }
    if (bites) {
      this.paintMark(x, z, r * 1.05, tool.digMark, tool.angle || 0);
      if (out) { out.posture = 1; }
    }
    return litres;
  }

  // Pour loose spoil back onto the ground. Returns litres used.
  pour(x, z, r, litres, opts) {
    const [c0, c1, r0, r1] = this.cellRange(x, z, r);
    const cellArea = this.cell * this.cell;
    let area = 0, count = 0;
    const profs = [];
    for (let rr = r0; rr <= r1; rr++) {
      const wz = this.zOf(rr);
      for (let cc = c0; cc <= c1; cc++) {
        const wx = this.xOf(cc);
        const dx = wx - x, dz = wz - z;
        const d2 = dx * dx + dz * dz;
        if (d2 > r * r) { profs.push(0); continue; }
        const d = Math.sqrt(d2);
        // rounded pile profile — centre receives far more, giving a peak
        const p = Math.pow(1 - d / r, 0.55);
        profs.push(p); area += p * cellArea; count++;
      }
    }
    if (area <= 0) return 0;
    const vol = litres / 1000 / CFG.BULK;             // in-situ cubic metres
    let used = 0, ci = 0;
    for (let rr = r0; rr <= r1; rr++) {
      for (let cc = c0; cc <= c1; cc++) {
        const p = profs[ci++];
        if (p <= 0) continue;
        const dh = (vol * p / area);
        const i = rr * this.N + cc;
        this.h[i] += dh;
        used += dh * cellArea * 1000 * CFG.BULK;
        this.p[i] = Math.min(this.p[i], opts && opts.keepPacked ? this.p[i] : 6) | 0;
        // freshly placed dirt is unsettled again
        this.cp[i] = Math.max(0, this.cp[i] - dh * 0.5);
        if (!(opts && opts.keepGrass)) this.g[i] = Math.max(0, this.g[i] - 900) | 0;
        this.mk[i] = opts && opts.mark !== undefined ? opts.mark : MK.LOOSE;
        this.mark(i);
        this.activateAround(cc, rr, 3);
      }
    }
    this.paintSoil(x, z, r * 1.1, false);
    if (opts && opts.paint) this.paintMark(x, z, r, opts.paint, (opts.angle || 0));
    return used;
  }

  // Compact dirt. flat-head is the strongest packer; spade slaps ridged marks.
  pack(x, z, r, tool, dt) {
    const [c0, c1, r0, r1] = this.cellRange(x, z, r);
    let any = false;
    const strength = (tool.packRate || 90) * dt;
    for (let rr = r0; rr <= r1; rr++) {
      const wz = this.zOf(rr);
      for (let cc = c0; cc <= c1; cc++) {
        const wx = this.xOf(cc);
        const dx = wx - x, dz = wz - z;
        const d2 = dx * dx + dz * dz;
        if (d2 > r * r) continue;
        const d = Math.sqrt(d2);
        // handle / blade footprint: broad in the middle, feathered edge
        const prof = (1 - 0.85 * (d / r)) ;
        const i = rr * this.N + cc;
        const before = this.p[i];
        const dp = strength * prof;
        if (dp <= 0.02) continue;
        this.p[i] = Math.min(255, before + dp) | 0;
        // Compaction is a ONE-TIME settle per bit of dirt, capped by how firm the
        // cell has become — so slapping the same face a hundred times firms it
        // without slowly flattening the jump you just built.
        const minN = Math.min(this.h[i - 1], this.h[i + 1],
          this.h[i - this.N], this.h[i + this.N]);
        const raise = Math.max(0, this.h[i] - minN);
        const want = raise * 0.07 * (this.p[i] / 255) - this.cp[i];
        if (want > 0) {
          this.h[i] -= want;
          this.cp[i] += want;
          this.activateAround(cc, rr, 1);
        }
        this.mk[i] = tool.packMark;
        this.mark(i);
        any = true;
        this.activateAround(cc, rr, 2);
      }
    }
    if (any) {
      this.paintMark(x, z, r * 1.02, tool.packMark, tool.angle || 0);
      this.texDirty = true;
    }
    return any;
  }

  // Precision flat cut (shave the lip / landing face). Returns litres removed.
  shave(x, z, r, thickness, tool) {
    const [c0, c1, r0, r1] = this.cellRange(x, z, r);
    const cellArea = this.cell * this.cell;
    let litres = 0, any = false;
    for (let rr = r0; rr <= r1; rr++) {
      const wz = this.zOf(rr);
      for (let cc = c0; cc <= c1; cc++) {
        const wx = this.xOf(cc);
        const dx = wx - x, dz = wz - z;
        const d2 = dx * dx + dz * dz;
        if (d2 > r * r) continue;
        const d = Math.sqrt(d2);
        const prof = 1 - Math.pow(d / r, 2);
        const i = rr * this.N + cc;
        const cut = Math.min(thickness * prof, Math.max(0, this.h[i] + 3.6));
        if (cut <= 0.0005) continue;
        this.h[i] -= cut;
        litres += cut * cellArea * 1000 * CFG.BULK;
        this.p[i] = Math.min(255, this.p[i] + cut * 300) | 0;
        this.mk[i] = MK.SHAVE;
        this.mark(i);
        any = true;
        this.activateAround(cc, rr, 2);
      }
    }
    if (any) this.paintMark(x, z, r * 1.05, MK.SHAVE, tool.angle || 0);
    return litres;
  }

  // Rake: level and groom — pulls high spots down into hollows, grooves the top.
  rake(x, z, r, dt) {
    const [c0, c1, r0, r1] = this.cellRange(x, z, r);
    let any = false, delta = 0;
    const N = this.N;
    const snapshot = [];
    for (let rr = r0; rr <= r1; rr++) {
      for (let cc = c0; cc <= c1; cc++) {
        const wx = this.xOf(cc), wz = this.zOf(rr);
        const dx = wx - x, dz = wz - z;
        const d2 = dx * dx + dz * dz;
        if (d2 > r * r) { snapshot.push(null); continue; }
        const i = rr * N + cc;
        let sum = 0, wsum = 0;
        for (let oy = -2; oy <= 2; oy++) {
          const ry = clamp(rr + oy, 0, N - 1);
          for (let ox = -2; ox <= 2; ox++) {
            const rx = clamp(cc + ox, 0, N - 1);
            const w = 1 / (1 + ox * ox + oy * oy);
            sum += this.h[ry * N + rx] * w; wsum += w;
          }
        }
        snapshot.push({ i, avg: sum / wsum, prof: 1 - d2 / (r * r) });
      }
    }
    for (const s of snapshot) {
      if (!s) continue;
      const k = Math.min(0.85, 3.0 * dt * s.prof);
      const d = (s.avg - this.h[s.i]) * k;
      this.h[s.i] += d;
      delta += Math.abs(d);
      this.mk[s.i] = MK.RAKE;
      this.p[s.i] = Math.max(0, this.p[s.i] - 40 * dt) | 0;
      this.g[s.i] = Math.max(0, this.g[s.i] - 260 * dt) | 0;
      this.mark(s.i);
      this.activateAround(s.i % N, (s.i / N) | 0, 2);
      any = true;
    }
    if (any) {
      this.paintMark(x, z, r * 1.05, MK.RAKE, this._rakeAngle || 0);
      this.texDirty = true;
    }
    return any;
  }

  // ---------- gravity / angle of repose ----------
  slump(budgetMs) {
    const t0 = performance.now();
    const N = this.N;
    let processed = 0;
    while (this.qhead < this.queue.length) {
      const i = this.queue[this.qhead++];
      this.active[i] = 0;
      processed++;
      const c = i % N, r = (i / N) | 0;
      const h = this.h[i];
      const pk = this.p[i];
      const tanMax = CFG.LOOSE_TAN + (pk / 255) * CFG.PACK_GAIN;
      let best = -1, bestExc = 0.004, bestDist = 0;
      for (let k = 0; k < 8; k++) {
        const cc = c + DIRS[k][0], rr = r + DIRS[k][1];
        if (cc < 1 || rr < 1 || cc >= N - 1 || rr >= N - 1) continue;
        const j = rr * N + cc;
        const dist = (k < 4 ? 1 : Math.SQRT2) * this.cell;
        const exc = (h - this.h[j]) - tanMax * dist;
        if (exc > bestExc) { bestExc = exc; best = j; bestDist = dist; }
      }
      if (best >= 0) {
        let move = bestExc * 0.30;
        if (move > 0.35 * this.cell) move = 0.35 * this.cell;
        this.h[i] -= move;
        this.h[best] += move;
        // moved material is loose; it also cannot stay grass-covered
        this.p[best] = Math.max(0, this.p[best] - move * 260) | 0;
        this.g[best] = Math.max(0, this.g[best] - move * 900) | 0;
        if (this.mk[best] === MK.FLAT || this.mk[best] === MK.SHAVE) this.mk[best] = MK.LOOSE;
        this.mark(i); this.mark(best);
        this.activate(i);
        const bc = best % N, br = (best / N) | 0;
        this.activateAround(bc, br, 1);
      }
      if (processed % 512 === 0 && performance.now() - t0 > budgetMs) break;
    }
    if (this.qhead > 4096 && this.qhead * 2 > this.queue.length) {
      this.queue = this.queue.slice(this.qhead);
      this.qhead = 0;
    }
  }

  // ---------- per-frame GPU sync ----------
  refreshColors() {
    this.updateVertexColors(0, this.N * this.N - 1);
    this._colorsFullDirty = false;
  }

  // Loose spoil is dark and muddy; ground you have packed reads pale and firm.
  updateVertexColors(lo, hi) {
    const col = this.colAttr.array;
    for (let i = lo; i <= hi; i++) {
      const p = this.p[i] / 255;
      const sun = this.g[i] / 255;
      const tone = 0.56 + 0.62 * p;
      let r = tone, g = tone * 0.97, b = tone * 0.92;
      const pit = Math.max(0, this.h0[i] - this.h[i]);
      const dark = clamp(1 - pit * 0.20, 0.42, 1);
      r *= dark; g *= dark; b *= dark;
      const lift = Math.max(0, this.h[i] - this.h0[i]);
      const light = clamp(1 + lift * 0.05, 1, 1.16);
      r *= light; g *= light; b *= light;
      r *= 1 - 0.07 * sun; g *= 1 + 0.03 * sun; b *= 1 - 0.11 * sun;
      // very firm faces pick up a faint dry sheen
      if (p > 0.78) { const k = (p - 0.78) / 0.22 * 0.10; r += k; g += k; b += k; }
      col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = b;
    }
  }

  refreshGeometry() {
    if (this.dirtyLo > this.dirtyHi) { this.flushTexture(); return; }
    const lo = this.dirtyLo, hi = this.dirtyHi;
    const N = this.N;
    const pos = this.posAttr.array, nrm = this.normAttr.array;
    const c0 = lo % N, r0 = (lo / N) | 0;
    const c1 = hi % N, r1 = (hi / N) | 0;
    const gx0 = Math.max(0, c0 - 1), gx1 = Math.min(N - 1, c1 + 1);
    const gz0 = Math.max(0, r0 - 1), gz1 = Math.min(N - 1, r1 + 1);
    const inv = 1 / (2 * this.cell);
    for (let r = gz0; r <= gz1; r++) {
      for (let c = gx0; c <= gx1; c++) {
        const i = r * N + c;
        pos[i * 3 + 1] = this.h[i];
        const hL = this.h[i - (c > 0 ? 1 : 0)];
        const hR = this.h[i + (c < N - 1 ? 1 : 0)];
        const hU = this.h[i - (r > 0 ? N : 0)];
        const hD = this.h[i + (r < N - 1 ? N : 0)];
        let nx = -(hR - hL) * inv, ny = 1, nz = -(hD - hU) * inv;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        nrm[i * 3] = nx / len; nrm[i * 3 + 1] = ny / len; nrm[i * 3 + 2] = nz / len;
      }
    }
    this.updateVertexColors(lo, hi);
    this.posAttr.needsUpdate = true;
    this.normAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.geo.computeBoundingSphere();
    this.dirtyLo = Infinity; this.dirtyHi = -Infinity;
    this.flushTexture();
  }

  flushTexture() {
    if (this.texDirty && this.texture) {
      this.texture.needsUpdate = true;
      this.texDirty = false;
    }
  }
}

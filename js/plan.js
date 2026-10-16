// Pre-build planning: lay out the jump line, keep it as a visible reference
// (ghost footprints on the ground, a plan sheet, and a minimap) while digging.
import { CFG, clamp } from './config.js';
const THREE = window.THREE;

export const FEATURE_TYPES = [
  { id: 'lip', name: 'Lip', r: 2.3, h: 1.5, len: 4.0, color: 0x62d0ff },
  { id: 'landing', name: 'Landing', r: 3.4, h: 1.3, len: 6.5, color: 0x7dffb0 },
  { id: 'roller', name: 'Roller', r: 1.7, h: 0.9, len: 3.0, color: 0xffd166 },
  { id: 'table', name: 'Table', r: 2.1, h: 1.2, len: 5.0, color: 0xff9f6e },
  { id: 'berm', name: 'Berm', r: 2.2, h: 1.4, len: 4.0, color: 0xd39cff },
  { id: 'pit', name: 'Dirt Hole', r: 2.6, h: -1.1, len: 4.0, color: 0xff7b7b },
];

export class BuildZone {
  constructor(x, z, w, d) { this.x = x; this.z = z; this.w = w; this.d = d; }
  contains(x, z, m = 0) {
    return Math.abs(x - this.x) <= this.w / 2 + m && Math.abs(z - this.z) <= this.d / 2 + m;
  }
}

export class Plan {
  constructor(zone) {
    this.zone = zone;
    this.features = [];
    this.nextId = 1;
    this.group = new THREE.Group();
    this.group.frustumCulled = false;
    this.visible = true;
    this._t = 0;
  }

  typeDef(id) { return FEATURE_TYPES.find(t => t.id === id) || FEATURE_TYPES[0]; }

  add(typeId, x, z, angle = 0) {
    const d = this.typeDef(typeId);
    const f = {
      id: this.nextId++, type: typeId, x, z, angle,
      r: d.r, h: d.h, len: d.len, ghost: null,
    };
    this.features.push(f);
    this.buildGhost(f);
    return f;
  }

  removeById(id) {
    const i = this.features.findIndex(f => f.id === id);
    if (i < 0) return false;
    const f = this.features[i];
    if (f.ghost) this.disposeGhost(f.ghost);
    this.features.splice(i, 1);
    return true;
  }

  removeNearest(x, z, maxD = 3.0) {
    let best = null, bd = maxD * maxD;
    for (const f of this.features) {
      const dx = f.x - x, dz = f.z - z;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = f; }
    }
    return best ? this.removeById(best.id) : false;
  }

  disposeGhost(g) {
    this.group.remove(g);
    g.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    });
  }

  labelSprite(text, color) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(8,14,20,0.62)';
    const w = 40 + text.length * 15;
    ctx.beginPath(); ctx.roundRect((512 - w) / 2, 26, w, 74, 14); ctx.fill();
    ctx.strokeStyle = '#' + new THREE.Color(color).getHexString();
    ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = '#e8f6ff';
    ctx.font = 'bold 44px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 64);
    const tex = new THREE.CanvasTexture(c);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    spr.scale.set(2.6, 0.65, 1);
    spr.renderOrder = 100;
    return spr;
  }

  buildGhost(f) {
    const def = this.typeDef(f.type);
    const g = new THREE.Group();

    // draped footprint ring (follows the ground)
    const ringGeo = new THREE.BufferGeometry();
    const SEG = 56;
    ringGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SEG + 1) * 3), 3));
    const ring = new THREE.Line(ringGeo, new THREE.LineBasicMaterial({
      color: def.color, transparent: true, opacity: 0.95, depthTest: false,
    }));
    ring.renderOrder = 60;
    ring.frustumCulled = false;
    g.add(ring);
    const innerGeo = new THREE.BufferGeometry();
    innerGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SEG + 1) * 3), 3));
    const inner = new THREE.Line(innerGeo, new THREE.LineBasicMaterial({
      color: def.color, transparent: true, opacity: 0.5, depthTest: false,
    }));
    inner.renderOrder = 60; inner.frustumCulled = false;
    g.add(inner);

    // translucent target volume
    const isPit = f.h < 0;
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: def.color, transparent: true, opacity: 0.13,
        side: THREE.DoubleSide, depthWrite: false, wireframe: true,
      })
    );
    dome.scale.set(f.r, Math.abs(f.h), f.r);
    dome.position.y = isPit ? 0 : 0;
    dome.renderOrder = 55;
    g.add(dome);

    const label = this.labelSprite(`${def.name}  r${f.r.toFixed(1)}m  h${Math.abs(f.h).toFixed(1)}m`,
      def.color);
    label.position.y = Math.max(1.6, Math.abs(f.h) + 1.0);
    g.add(label);

    f.ghost = g;
    f.ring = ring; f.inner = inner; f.dome = dome;
    this.group.add(g);
    this.updateGhost(f, null);
  }

  updateGhost(f, terrain) {
    if (!f.ghost) return;
    const SEG = 56;
    for (let i = 0; i <= SEG; i++) {
      const a = i / SEG * Math.PI * 2;
      const x = f.x + Math.cos(a) * f.r;
      const z = f.z + Math.sin(a) * f.r;
      const y = terrain ? terrain.heightAt(x, z) + 0.07 : 0;
      f.ring.geometry.attributes.position.setXYZ(i, x, y, z);
      const x2 = f.x + Math.cos(a) * f.r * 0.62;
      const z2 = f.z + Math.sin(a) * f.r * 0.62;
      const y2 = terrain ? terrain.heightAt(x2, z2) + 0.07 : 0;
      f.inner.geometry.attributes.position.setXYZ(i, x2, y2, z2);
    }
    f.ring.geometry.attributes.position.needsUpdate = true;
    f.inner.geometry.attributes.position.needsUpdate = true;
    f.ring.geometry.computeBoundingSphere();
    f.inner.geometry.computeBoundingSphere();
    const cy = terrain ? terrain.heightAt(f.x, f.z) : 0;
    f.ghost.position.set(0, 0, 0);
    f.dome.position.set(f.x, cy, f.z);
    f.dome.scale.set(f.r, f.h < 0 ? 0.001 : f.h, f.r);
    f.ghost.children[f.ghost.children.length - 1].position.set(f.x, cy + Math.max(1.7, Math.abs(f.h) + 1.1), f.z);
    f.ghost.children[f.ghost.children.length - 1].visible = this.visible;
    f.ring.visible = this.visible;
    f.inner.visible = this.visible;
    f.dome.visible = this.visible && F_showVolume;
  }

  // How close has the digger got to the plan? (0..1 per feature)
  progress(terrain) {
    const out = [];
    for (const f of this.features) {
      let rise = 0, target = Math.abs(f.h);
      if (f.h < 0) {
        rise = terrain.h0[terrain.idx(clamp(Math.round(terrain.colOf(f.x)), 0, terrain.N - 1),
          clamp(Math.round(terrain.rowOf(f.z)), 0, terrain.N - 1))] - terrain.heightAt(f.x, f.z);
      } else {
        rise = terrain.heightAt(f.x, f.z) - terrain.h0[terrain.idx(
          clamp(Math.round(terrain.colOf(f.x)), 0, terrain.N - 1),
          clamp(Math.round(terrain.rowOf(f.z)), 0, terrain.N - 1))];
      }
      // measured footprint radius: furthest ring sample that still rises/falls
      let measR = 0;
      for (let i = 0; i < 24; i++) {
        const a = i / 24 * Math.PI * 2;
        for (let d = 0.4; d <= f.r * 1.7; d += 0.3) {
          const x = f.x + Math.cos(a) * d, z = f.z + Math.sin(a) * d;
          const base = terrain.h0[terrain.idx(clamp(Math.round(terrain.colOf(x)), 0, terrain.N - 1),
            clamp(Math.round(terrain.rowOf(z)), 0, terrain.N - 1))];
          const diff = Math.abs(terrain.heightAt(x, z) - base);
          if (diff > target * 0.18) { if (d > measR) measR = d; }
          else break;
        }
      }
      const hProg = clamp(rise / Math.max(0.05, target), 0, 1.2);
      const rProg = clamp(measR / Math.max(0.2, f.r), 0, 1.2);
      out.push({ id: f.id, type: f.type, name: this.typeDef(f.type).name,
        hProg, rProg, rise, target, measR, r: f.r, h: f.h, x: f.x, z: f.z,
        done: hProg > 0.9 && rProg > 0.75 });
    }
    return out;
  }

  update(dt, terrain, camPos, force) {
    this._t += dt;
    const near = this.features.filter(f => {
      const dx = f.x - camPos.x, dz = f.z - camPos.z;
      return dx * dx + dz * dz < 90 * 90;
    });
    if (!force && this._t < 0.18) return;
    this._t = 0;
    for (const f of near) this.updateGhost(f, terrain);
  }

  serialize() {
    return this.features.map(f => ({ t: f.type, x: f.x, z: f.z, a: f.angle, r: f.r, h: f.h, l: f.len }));
  }

  deserialize(arr) {
    for (const f of this.features.slice()) this.removeById(f.id);
    for (const s of arr || []) {
      const f = this.add(s.t, s.x, s.z, s.a || 0);
      f.r = s.r; f.h = s.h; f.len = s.l;
      f.dome.scale.set(f.r, f.h < 0 ? 0.001 : f.h, f.r);
    }
  }
}

// module flag toggled by the UI for the wireframe target volumes
export let F_showVolume = true;
export function setShowVolume(v) { F_showVolume = v; }

// ---- minimap ----
export function drawMinimap(canvas, terrain, plan, player, trees, barrow) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const sx = W / CFG.WORLD, sz = H / CFG.WORLD;
  const px = x => (x + CFG.HALF) * sx;
  const py = z => (z + CFG.HALF) * sz;
  ctx.clearRect(0, 0, W, H);
  // ground base
  const img = ctx.getImageData ? null : null;
  ctx.fillStyle = 'rgba(28,26,20,0.92)';
  ctx.fillRect(0, 0, W, H);
  // build zone
  const z = plan.zone;
  ctx.strokeStyle = 'rgba(140,220,255,0.45)';
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  ctx.strokeRect(px(z.x - z.w / 2), py(z.z - z.d / 2), z.w * sx, z.d * sz);
  ctx.setLineDash([]);
  // trees
  ctx.fillStyle = 'rgba(74,120,64,0.75)';
  for (const t of trees) {
    ctx.beginPath();
    ctx.arc(px(t.x), py(t.z), 1.6 * t.scale + 0.7, 0, Math.PI * 2);
    ctx.fill();
  }
  // plan features + line
  ctx.strokeStyle = 'rgba(255,235,140,0.55)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  plan.features.forEach((f, i) => {
    const X = px(f.x), Y = py(f.z);
    if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
  });
  ctx.stroke();
  for (const f of plan.features) {
    const def = plan.typeDef(f.type);
    const X = px(f.x), Y = py(f.z);
    ctx.strokeStyle = '#' + new THREE.Color(def.color).getHexString();
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(X, Y, Math.max(2.2, f.r * sx), 0, Math.PI * 2);
    ctx.stroke();
    // heading tick (take-off direction)
    ctx.beginPath();
    ctx.moveTo(X, Y);
    ctx.lineTo(X + Math.sin(f.angle) * f.r * 1.5 * sx, Y + Math.cos(f.angle) * f.r * 1.5 * sz);
    ctx.stroke();
  }
  // wheelbarrow
  if (barrow && barrow.placed) {
    ctx.fillStyle = '#e8734a';
    ctx.beginPath(); ctx.arc(px(barrow.x), py(barrow.z), 2.6, 0, Math.PI * 2); ctx.fill();
  }
  // player + view cone
  const pxx = px(player.pos.x), pyy = py(player.pos.z);
  const dirx = -Math.sin(player.yaw), dirz = -Math.cos(player.yaw);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath();
  ctx.moveTo(pxx, pyy);
  const a0 = Math.atan2(dirz, dirx);
  ctx.arc(pxx, pyy, 26, a0 - 0.45, a0 + 0.45);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(pxx, pyy, 2.8, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#7fd6ff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(pxx, pyy);
  ctx.lineTo(pxx + dirx * 11, pyy + dirz * 11); ctx.stroke();
  // compass
  ctx.fillStyle = 'rgba(230,240,255,0.75)';
  ctx.font = 'bold 11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('N', W / 2, 13);
}

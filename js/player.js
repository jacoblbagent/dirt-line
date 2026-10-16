// First-person digger: 6 ft eye height, walk/run/jump, terrain-following,
// tool use, dirt carrying, wheelbarrow logistics and soil physics coupling.
import { CFG, MK, clamp, lerp } from './config.js';
import { TOOLS } from './tools.js';
import { groupFromParts } from './materials.js';
import { buildWheelbarrow, buildDirtHeap } from './models-props.js';
import { xform } from './geo.js';

const THREE = window.THREE;
const GRAV = 21.0;

export class Player {
  constructor(scene, terrain, materials) {
    this.terrain = terrain;
    this.materials = materials;
    this.pos = new THREE.Vector3(-4, 0, 20);
    this.vel = new THREE.Vector3();
    this.yaw = 0;            // looking north (-Z), into the dirt zone
    this.pitch = -0.12;
    this.radius = 0.34;
    this.onGround = true;
    this.stamina = 100;
    this.load = 0;           // litres of loose spoil carried
    this.loadMax = CFG.PLAYER_LOAD;
    this.toolIdx = 0;
    this.brushRadius = 0.55; // working brush — also drives the dump radius
    this.pourRadius = 0.77;  // deposit brush, derived from the working brush
    this.crouch = false;
    this.bob = 0;
    this.aim = { hit: false, point: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0), dist: 0 };
    this.working = false;
    this.action = 'idle';
    this.message = '';
    this.messageT = 0;
    this.barrow = { placed: true, x: 8, z: 22, fill: 0, mesh: null };
    this.stats = { litresDug: 0, litresPlaced: 0, litresPacked: 0 };
    this._tmp = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this.pos.y = terrain.heightAt(this.pos.x, this.pos.z) + 0.1;
    this.buildBarrow(scene);
  }

  buildBarrow(parent) {
    const g = groupFromParts(buildWheelbarrow(), this.materials);
    this.barrowMesh = g;
    parent.add(g);
    // a loose load of spoil in the tray, scaled to how full the barrow is
    const heap = xform(buildDirtHeap(0.22, 7), { pos: [0, 0.03, -0.02] });
    this.barrowLoad = new THREE.Mesh(heap, this.materials.bark);
    this.barrowLoad.castShadow = true;
    g.add(this.barrowLoad);
    this.updateBarrowMesh();
  }

  updateBarrowMesh() {
    const b = this.barrow;
    this.barrowMesh.visible = b.placed;
    if (!b.placed) return;
    const y = this.terrain.heightAt(b.x, b.z);
    this.barrowMesh.position.set(b.x, y, b.z);
    this.barrowMesh.rotation.y = b.yaw || 0;
    const f = clamp(b.fill / CFG.BARROW_MAX, 0, 1);
    this.barrowLoad.visible = f > 0.02;
    this.barrowLoad.scale.set(1.25, Math.max(0.05, f * 0.9), 1.75);
  }

  get tool() { return TOOLS[this.toolIdx]; }

  // one wheel drives both the working brush and the (slightly wider) dump brush,
  // so there is nothing extra to press for precise placement
  setRadius(v) {
    this.brushRadius = clamp(v, 0.22, 2.6);
    this.pourRadius = clamp(v * 1.4, 0.25, 3.2);
  }

  barrowDist() {
    if (!this.barrow.placed) return Infinity;
    const dx = this.barrow.x - this.pos.x, dz = this.barrow.z - this.pos.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  say(msg, t = 2.4) { this.message = msg; this.messageT = t; }

  // ---------- aim ----------
  cameraDir(out) {
    const p = this.pitch, y = this.yaw;
    return out.set(-Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p));
  }

  // March a ray against the heightfield; returns ground contact if any.
  rayMarch(origin, dir, maxD, target) {
    const t = target || { hit: false, point: new THREE.Vector3(), normal: new THREE.Vector3(), dist: 0 };
    t.hit = false;
    let prev = origin.y - this.terrain.heightAt(origin.x, origin.z);
    let px = origin.x, py = origin.y, pz = origin.z;
    const step = 0.08;
    let d = step;
    while (d < maxD) {
      const x = origin.x + dir.x * d, y = origin.y + dir.y * d, z = origin.z + dir.z * d;
      if (!this.terrain.inWorld(x, z)) break;
      const diff = y - this.terrain.heightAt(x, z);
      if (diff <= 0) {
        // bisect for a clean contact point
        let a = d - step, b = d;
        for (let i = 0; i < 8; i++) {
          const m = (a + b) / 2;
          const my = origin.y + dir.y * m;
          const mx = origin.x + dir.x * m, mz = origin.z + dir.z * m;
          if (my - this.terrain.heightAt(mx, mz) > 0) a = m; else b = m;
        }
        const ft = b;
        t.point.set(origin.x + dir.x * ft, origin.y + dir.y * ft, origin.z + dir.z * ft);
        this.terrain.normalAt(t.point.x, t.point.z, t.normal);
        t.dist = ft;
        t.hit = true;
        return t;
      }
      prev = diff; px = x; py = y; pz = z;
      d += step;
    }
    // fall back: project onto the ground ahead (lets you pour "into" a face)
    const fx = origin.x + dir.x * maxD, fz = origin.z + dir.z * maxD;
    if (this.terrain.inWorld(fx, fz)) {
      t.point.set(fx, this.terrain.heightAt(fx, fz), fz);
      this.terrain.normalAt(fx, fz, t.normal);
      t.dist = maxD;
      t.hit = true;
    }
    return t;
  }

  // ---------- physics / locomotion ----------
  update(dt, input, trees, plan) {
    const t = this.terrain;
    // look
    const sens = 0.0022;
    this.yaw -= input.dx * sens;
    this.pitch = clamp(this.pitch - input.dy * sens, -1.45, 1.35);
    input.dx = 0; input.dy = 0;

    const sprint = !!input.keys['ShiftLeft'] || !!input.keys['ShiftRight'];
    this.crouch = !!input.keys['ControlLeft'] || !!input.keys['ControlRight'];
    const speedTarget = (this.crouch ? 1.5 : sprint ? 5.9 : 3.3) * (0.55 + 0.45 * clamp(this.stamina / 70, 0, 1));

    let fx = 0, fz = 0;
    if (input.keys['KeyW'] || input.keys['ArrowUp']) fz += 1;
    if (input.keys['KeyS'] || input.keys['ArrowDown']) fz -= 1;
    if (input.keys['KeyA'] || input.keys['ArrowLeft']) fx -= 1;
    if (input.keys['KeyD'] || input.keys['ArrowRight']) fx += 1;
    const len = Math.hypot(fx, fz);
    if (len > 0) { fx /= len; fz /= len; }

    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    // forward = (-sin yaw, -cos yaw); right = (cos yaw, -sin yaw)
    const wx = -sy * fz + cy * fx;
    const wz = -cy * fz - sy * fx;

    const accel = this.onGround ? 34 : 7;
    this.vel.x += wx * accel * dt;
    this.vel.z += wz * accel * dt;
    const drag = this.onGround ? 12.0 : 0.7;
    this.vel.x -= this.vel.x * drag * dt;
    this.vel.z -= this.vel.z * drag * dt;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (hs > speedTarget) {
      this.vel.x *= speedTarget / hs; this.vel.z *= speedTarget / hs;
    }

    // gravity + jump
    this.vel.y -= GRAV * dt;
    if (this.onGround && input.keys['Space']) {
      this.vel.y = 6.4;
      this.onGround = false;
      this.stamina = Math.max(0, this.stamina - 2.5);
    }

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.x = clamp(this.pos.x, -CFG.HALF + 2, CFG.HALF - 2);
    this.pos.z = clamp(this.pos.z, -CFG.HALF + 2, CFG.HALF - 2);

    // ground collision
    const gy = this.terrain.heightAt(this.pos.x, this.pos.z);
    if (this.pos.y <= gy + 0.001) {
      this.pos.y = gy;
      if (this.vel.y < 0) this.vel.y = 0;
      this.onGround = true;
      // steep faces: you slide off the unfinished lip
      const slope = this.terrain.slopeAt(this.pos.x, this.pos.z);
      if (slope > 1.05) {
        const n = this.terrain.normalAt(this.pos.x, this.pos.z, this._tmp);
        this.vel.x += n.x * 7.5 * dt * (slope - 1.0);
        this.vel.z += n.z * 7.5 * dt * (slope - 1.0);
      }
    } else if (this.pos.y > gy + 0.06) {
      this.onGround = false;
    }

    // tree collision
    if (trees) {
      for (const tr of trees) {
        const dx = this.pos.x - tr.x, dz = this.pos.z - tr.z;
        const rr = this.radius + tr.trunkR + 0.10;
        const d2 = dx * dx + dz * dz;
        if (d2 < rr * rr && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const push = (rr - d) / d;
          this.pos.x += dx * push;
          this.pos.z += dz * push;
        }
      }
    }

    // head bob (calm, vertical only)
    const moving = hs > 0.3 && this.onGround;
    this.bob += dt * (moving ? (sprint ? 9.5 : 6.6) : 0);
    const bobAmt = moving ? (sprint ? 0.035 : 0.022) : 0;

    // stamina
    const working = this.working;
    if (working) this.stamina -= this.tool.effort * dt * (1 + this.load / this.loadMax * 0.5);
    else this.stamina += 9.5 * dt;
    this.stamina = clamp(this.stamina, 0, 100);

    if (this.messageT > 0) this.messageT -= dt;

    // aim
    this._fwd.copy(this.cameraDir(this._tmp));
    const eye = this.eyePos(this._aimOrigin || new THREE.Vector3());
    this.rayMarch(eye, this._fwd, this.tool.reach + (this.mode === 'pour' ? 1.6 : 0.6), this.aim);

    this.camY = this.pos.y + (this.crouch ? 1.28 : CFG.EYE) + Math.sin(this.bob) * bobAmt;
  }

  eyePos(out) {
    return out.set(this.pos.x, this.camY || this.pos.y + CFG.EYE, this.pos.z);
  }

  // ---------- work ----------
  // Three rules, no modes:
  //   LMB        work the ground with the current tool
  //   RMB        place the dirt you carry (or tip the barrow out)
  //   Shift+LMB  shave a clean flat face; Shift+RMB trickles
  useTools(dt, input, sfx) {
    this.working = false;
    if (!this.aim.hit) return;
    const t = this.terrain;
    const TL = this.tool;
    const x = this.aim.point.x, z = this.aim.point.z;
    const angle = this.yaw;
    TL.angle = angle;
    const fine = !!input.keys['ShiftLeft'] || !!input.keys['ShiftRight'];

    // ---- RMB, whatever tool is in hand: put dirt where you are looking ----
    if (input.rmb) {
      const src = this.barrow.placed && this.barrowDist() < 3.4 && this.barrow.fill > 0.5
        ? 'barrow' : 'load';
      const have = src === 'barrow' ? this.barrow.fill : this.load;
      if (have < 0.4) {
        this.say('Nothing to place — dig some dirt first');
      } else {
        let rate = CFG.POUR_RATE * (src === 'barrow' ? 1.9 : 1.0);
        if (fine) rate *= CFG.TRICKLE;
        const litres = Math.min(rate * dt, have);
        const used = t.pour(x, z, this.pourRadius, litres, { mark: MK.LOOSE, angle });
        if (src === 'barrow') this.barrow.fill -= used; else this.load -= used;
        this.stats.litresPlaced += used;
        this.working = true;
        this.action = fine ? 'trickle' : 'place dirt';
        if (sfx) sfx.pour(dt);
      }
      return;
    }

    if (!input.lmb) return;

    // ---- Shift + LMB: precision flat cut — lips, landings, face trimming ----
    if (fine && TL.id !== 'pickaxe') {
      const litres = t.shave(x, z, this.brushRadius, 0.055, TL);
      const nearBarrow = this.barrow.placed && this.barrowDist() < 3.0 && this.barrow.fill < CFG.BARROW_MAX;
      if (nearBarrow) this.barrow.fill = Math.min(CFG.BARROW_MAX, this.barrow.fill + litres);
      else this.load = Math.min(this.loadMax, this.load + litres);
      this.stats.litresDug += litres;
      this.working = true; this.action = 'shave';
      if (sfx) sfx.shave(dt);
      return;
    }

    // ---- LMB: the tool's own job ----
    if (TL.id === 'spade') {
      // firm ground cuts; loose dirt gets slapped down with the back of the blade
      const loose = t.packedAt(x, z) < 120;
      if (loose) {
        const any = t.pack(x, z, this.brushRadius * 1.05, Object.assign({}, TL, { packMark: MK.SPADE }), dt);
        if (any) { this.working = true; this.action = 'slap'; this.stats.litresPacked += dt * 12; if (sfx) sfx.pack(dt); }
      } else if (!this.roomFor()) {
        this.say('Hands full — place the dirt or drop it in the barrow');
      } else {
        const l = t.dig(x, z, this.brushRadius, TL, dt);
        this.takeDirt(l);
        this.working = true; this.action = 'dig';
        if (sfx && l > 0.02) sfx.dig(dt);
      }
    } else if (TL.id === 'flathead') {
      const any = t.pack(x, z, this.brushRadius, TL, dt);
      if (any) { this.working = true; this.action = 'pack'; this.stats.litresPacked += dt * 14; if (sfx) sfx.pack(dt); }
    } else if (TL.id === 'pickaxe') {
      if (!this.roomFor()) { this.say('Hands full — place the dirt first'); }
      else {
        const l = t.dig(x, z, this.brushRadius, TL, dt);
        this.takeDirt(l);
        this.working = true; this.action = 'break';
        if (sfx && l > 0.02) sfx.pick(dt);
      }
    } else if (TL.id === 'rake') {
      const any = t.rake(x, z, this.brushRadius * 1.25, dt);
      if (any) { this.working = true; this.action = 'rake'; if (sfx && Math.random() < 0.12) sfx.rake(); }
    }
  }

  roomFor() {
    const loadSpace = this.loadMax - this.load;
    const near = this.barrow.placed && this.barrowDist() < 3.0;
    const barrowSpace = near ? CFG.BARROW_MAX - this.barrow.fill : 0;
    return loadSpace + barrowSpace > 0.6;
  }

  takeDirt(litres) {
    if (litres <= 0) return;
    const near = this.barrow.placed && this.barrowDist() < 3.0;
    const barrowSpace = near ? CFG.BARROW_MAX - this.barrow.fill : 0;
    let rest = litres;
    if (barrowSpace > 0) {
      const into = Math.min(barrowSpace, rest);
      this.barrow.fill += into;
      rest -= into;
      this.updateBarrowMesh();
    }
    const into = Math.min(this.loadMax - this.load, rest);
    this.load += into;
    this.stats.litresDug += litres;
  }

  toggleBarrow() {
    const near = this.barrowDist() < 3.2;
    if (this.barrow.placed && near) {
      // empty it onto the ground in front of you, or pick it up if empty
      if (this.barrow.fill > 0.5) {
        const p = this.aim.hit ? this.aim.point : this.pos;
        const used = this.terrain.pour(p.x, p.z, 0.9, this.barrow.fill, { mark: MK.LOOSE });
        this.barrow.fill -= used;
        this.say(`Tipped the barrow out — ${(used).toFixed(0)} L placed`);
      } else {
        this.barrow.placed = false;
        this.say('Wheelbarrow picked up — use the Barrow button to set it down');
      }
    } else if (!this.barrow.placed) {
      const p = this.aim.hit ? this.aim.point : this.pos;
      const d = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
      const fx = this.pos.x + (-Math.sin(this.yaw)) * 1.5;
      const fz = this.pos.z + (-Math.cos(this.yaw)) * 1.5;
      this.barrow.x = d < 3 ? p.x : fx;
      this.barrow.z = d < 3 ? p.z : fz;
      this.barrow.placed = true;
      this.updateBarrowMesh();
      this.say('Wheelbarrow set down');
    } else {
      this.say('Walk up to the wheelbarrow first');
    }
    this.updateBarrowMesh();
  }
}

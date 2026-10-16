// Tool definitions + first-person tool models.
import { MK } from './config.js';
const THREE = window.THREE;

export const TOOLS = [
  {
    id: 'spade', name: 'Spade', key: '1',
    tip: 'Dig soft ground. Back of the blade slaps a face firm (ridged marks).',
    power: 1.00, hardBias: -0.50, loosen: 1.0, digMark: MK.DIG,
    packRate: 130, packMark: MK.SPADE, swing: 0.56, effort: 6.0, reach: 1.5,
  },
  {
    id: 'flathead', name: 'Flat Head', key: '2',
    tip: 'Best packer — smooth flat face. Slap or shave a lip clean.',
    power: 0.45, hardBias: -0.30, loosen: 0.4, digMark: MK.DIG,
    packRate: 285, packMark: MK.FLAT, swing: 0.30, effort: 5.0, reach: 1.6,
  },
  {
    id: 'pickaxe', name: 'Pick Axe', key: '3',
    tip: 'Break hard / compacted ground. Loosens soil so digging gets easier.',
    power: 1.60, hardBias: 0.95, loosen: 2.6, digMark: MK.PICK,
    packRate: 70, packMark: MK.PICK, swing: 0.62, effort: 9.0, reach: 1.7,
  },
  {
    id: 'rake', name: 'Rake', key: '4',
    tip: 'Level and groom — drags high spots into hollows, grooves the finish.',
    power: 0.30, hardBias: -0.40, loosen: 0.6, digMark: MK.DIG,
    packRate: 60, packMark: MK.RAKE, swing: 0.42, effort: 4.0, reach: 1.9,
  },
];

const wood = () => new THREE.MeshStandardMaterial({ color: 0xb98a52, roughness: 0.85 });
const orange = () => new THREE.MeshStandardMaterial({ color: 0xd4682c, roughness: 0.7 });
// metals need an environment to reflect; keep metalness low or they render black
const steel = () => new THREE.MeshStandardMaterial({ color: 0xc3c8cd, roughness: 0.42, metalness: 0.15 });
const dark = () => new THREE.MeshStandardMaterial({ color: 0x6d7176, roughness: 0.55, metalness: 0.15 });

function handle(len, r, mat) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.15, len, 10), mat);
  m.position.y = len / 2;
  m.castShadow = true;
  g.add(m);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.6, r * 1.6, 0.16, 10), orange());
  grip.position.y = len * 0.42;
  g.add(grip);
  return g;
}

export function buildToolModels() {
  const out = {};
  // --- spade: long handle + flat scoop blade ---
  {
    const g = new THREE.Group();
    g.add(handle(0.98, 0.022, wood()));
    const bladeGrp = new THREE.Group();
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.30, 0.018), steel());
    b.position.set(0, 0.13, 0);
    bladeGrp.add(b);
    // shallow side walls hint at the scoop without a stray shell
    for (const s of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.28, 0.055), steel());
      w.position.set(s * 0.10, 0.13, 0.028);
      w.rotation.x = -0.12;
      bladeGrp.add(w);
    }
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.045, 0.02), dark());
    tip.position.set(0, -0.015, 0.004);
    bladeGrp.add(tip);
    const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.032, 0.13, 8), dark());
    sock.position.y = 0.31;
    bladeGrp.add(sock);
    bladeGrp.rotation.x = 0.10;
    g.add(bladeGrp);
    out.spade = g;
  }
  // --- flat head: wide flat rectangular blade (orange socket) ---
  {
    const g = new THREE.Group();
    const inner = new THREE.Group();
    inner.position.y = 0.40;      // blade hangs below the grip on a real one
    inner.add(handle(0.92, 0.023, wood()));
    const socket = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.20, 0.045), orange());
    socket.position.y = -0.10; inner.add(socket);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.28, 0.016), steel());
    blade.position.y = -0.33; inner.add(blade);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 0.03), dark());
    lip.position.y = -0.46; inner.add(lip);
    const step = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.02, 0.05), dark());
    step.position.set(0, -0.19, 0.02); inner.add(step);
    g.add(inner);
    out.flathead = g;
  }
  // --- pick axe ---
  {
    const g = new THREE.Group();
    g.add(handle(1.02, 0.024, wood()));
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.07), dark());
    head.position.y = 0.02; g.add(head);
    const p1 = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.42, 8), steel());
    p1.scale.set(1, 1, 0.5);
    p1.rotation.z = Math.PI / 2; p1.position.set(0.20, 0.02, 0);
    g.add(p1);
    const p2 = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.20, 8), steel());
    p2.scale.set(1, 1, 0.5);
    p2.rotation.z = -Math.PI / 2; p2.position.set(-0.09, 0.02, 0);
    g.add(p2);
    out.pickaxe = g;
  }
  // --- rake ---
  {
    const g = new THREE.Group();
    g.add(handle(1.05, 0.021, wood()));
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.035, 0.035), steel());
    bar.position.y = 0.02; g.add(bar);
    for (let i = 0; i < 9; i++) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.006, 0.14, 6), dark());
      t.position.set(-0.17 + i * 0.0425, -0.06, 0.0);
      t.rotation.x = 0.22;
      g.add(t);
    }
    out.rake = g;
  }
  for (const k of Object.keys(out)) {
    out[k].traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  }
  return out;
}

// First-person view model: holds a tool in the right hand, swings it on use.
export class ViewModel {
  constructor(camera) {
    this.models = buildToolModels();
    this.groups = {};
    this.root = new THREE.Group();
    this.root.frustumCulled = false;
    this.pivot = new THREE.Group();          // rotates for the swing
    this.root.add(this.pivot);

    // gloved arm reaching in from off-screen to the grip. Kept in the root (not
    // the pivot) so it does not swing with the tool.
    const skin = new THREE.MeshStandardMaterial({ color: 0xc98f63, roughness: 0.8 });
    const sleeve = new THREE.MeshStandardMaterial({ color: 0x5c6b52, roughness: 0.92 });
    const elbow = new THREE.Vector3(0.60, -0.78, 0.46);
    const dir = elbow.clone().negate().normalize();
    const len = elbow.length();
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.040, 0.062, len, 8), sleeve);
    arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    arm.position.copy(elbow).addScaledVector(dir, len / 2);
    this.root.add(arm);

    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), skin);
    hand.position.set(0.0, -0.035, 0.0);
    hand.scale.set(1, 1.15, 0.9);
    this.pivot.add(hand);

    for (const [id, m] of Object.entries(this.models)) {
      m.visible = false;
      this.groups[id] = m;
      this.pivot.add(m);
    }
    this.root.position.set(0.36, -0.36, -0.82);
    this.root.rotation.set(0.04, -0.44, 0.14);
    this.root.scale.setScalar(0.66);
    // parented to the camera so the tool rides in view like real hands
    camera.add(this.root);

    this.swing = 0;         // 0..1 animation phase
    this.active = false;
    this.bob = 0;
    this.kick = 0;
    this.setTool('spade');
  }

  setTool(id) {
    for (const [k, m] of Object.entries(this.groups)) m.visible = (k === id);
    this.toolId = id;
  }

  update(dt, opts) {
    const speed = opts.speed || 0;
    this.bob += dt * (3.0 + speed * 1.3);
    const amp = Math.min(1, speed / 5.0) * 0.022;
    const swayX = Math.sin(this.bob) * amp;
    const swayY = Math.abs(Math.cos(this.bob)) * amp;

    const period = opts.period || 0.5;
    if (opts.working) {
      this.swing += dt / period;
      if (this.swing > 1) this.swing -= 1;
      this.active = true;
    } else if (this.swing > 0) {
      // recover to rest
      this.swing += dt / (period * 0.8);
      if (this.swing > 1) this.swing = 0;
      if (this.swing < 0.05) this.swing = 0;
    }
    const s = this.swing;
    // rest pose ~0.10 (tool carried upright); the swing drives it down and
    // forward into the ground, then it recovers to rest.
    const a = Math.sin(s * Math.PI);
    let rx = 0.10, rz = 0, ty = 0, tz = 0;
    if (this.toolId === 'rake') {
      const sw = Math.sin(s * Math.PI * 2);
      rz = sw * 0.5;
      tz = -Math.abs(sw) * 0.08;
      rx = 0.16 - Math.abs(sw) * 0.10;
    } else if (this.toolId === 'flathead') {
      // short hard tamp
      rx = 0.10 - a * 0.72;
      ty = -a * 0.13;
      tz = -a * 0.06;
    } else if (this.toolId === 'pickaxe') {
      // longer, heavier drive
      rx = 0.12 - a * 1.05;
      tz = -a * 0.12;
      ty = -a * 0.05;
    } else {
      // spade scoop
      rx = 0.10 - a * 0.95;
      tz = -a * 0.14;
      ty = -a * 0.04;
    }
    this.pivot.rotation.x = rx;
    this.pivot.rotation.z = rz;
    this.pivot.position.set(swayX, ty, tz);

    // subtle vertical float, calmed
    this.root.position.x = 0.36 + swayX * 0.4;
    this.root.position.y = -0.36 + swayY;
  }
}

// Tool definitions (gameplay behaviour) + the first-person view model built
// from the detailed procedural tool and glove models.
import { MK } from './config.js';
import { groupFromParts } from './materials.js';
import { TOOL_MODELS, buildGloveHand, TOOL_TIP_Y } from './models-tools.js';

const THREE = window.THREE;

export { TOOL_TIP_Y };

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

// Where along its own shaft the hand grips, per tool. Most tools are modelled
// with the origin already at a sensible grip; the pick axe has the head AT the
// origin, so its mesh slides down its own axis until the hand is out at the end
// of the handle — which is how you actually hold a pick, head away from you.
const GRIP_SLIDE = { pickaxe: -0.72, rake: -0.14 };

// A tool as a mesh group (used for the held view model and for tools left
// standing in the dirt as scenery).
export function buildToolMesh(id, materials, opts = {}) {
  const builder = TOOL_MODELS[id] || TOOL_MODELS.spade;
  return groupFromParts(builder(), materials, { castShadow: opts.shadows !== false, receiveShadow: false });
}

// First-person view model: a gloved hand holding the tool, swinging on use.
//
// Model convention (js/models-tools.js): origin at the grip, +Y along the shaft
// toward the handle end, -Y toward the head. Held the way a person actually
// carries a tool — shaft running diagonally across the view with the head out in
// front and down where you can see it working, handle heading back off the
// right edge. `pose` holds every number so the hold can be tuned without
// hunting through the animation.
export class ViewModel {
  constructor(camera, materials) {
    this.materials = materials;
    this.groups = {};
    this.root = new THREE.Group();
    this.root.frustumCulled = false;
    this.pivot = new THREE.Group();
    this.root.add(this.pivot);

    for (const id of Object.keys(TOOL_MODELS)) {
      const g = buildToolMesh(id, materials, { shadows: false });
      g.position.y = GRIP_SLIDE[id] || 0;
      g.visible = false;
      g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
      this.groups[id] = g;
      this.pivot.add(g);
    }
    // the gloved hand gripping the shaft at the origin
    const hand = groupFromParts(buildGloveHand(1), materials, { castShadow: false, receiveShadow: false });
    hand.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    this.pivot.add(hand);
    this.hand = hand;

    // grip point in camera space, rig orientation, and the rest tilt of the tool
    this.pose = {
      hold: new THREE.Vector3(0.28, -0.16, -0.74),
      rot: new THREE.Euler(0.0, 0.02, 0.0),
      rest: new THREE.Euler(0.72, 0.04, -0.72),
      scale: 0.64,
    };
    this.applyPose();
    camera.add(this.root);

    this.swing = 0;
    this.active = false;
    this.bob = 0;
    this.kick = 0;
    this.setTool('spade');
  }

  applyPose() {
    const p = this.pose;
    this.root.position.copy(p.hold);
    this.root.rotation.copy(p.rot);
    this.root.scale.setScalar(p.scale);
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
      this.swing += dt / (period * 0.8);
      if (this.swing > 1) this.swing = 0;
      if (this.swing < 0.05) this.swing = 0;
    }
    const s = this.swing;
    const rest = this.pose.rest;
    // at rest the tool is carried head-forward-down; the swing drives the head
    // down and forward into the dirt ahead, then it recovers to rest.
    const a = Math.sin(s * Math.PI);
    let rx = rest.x, ry = rest.y, rz = rest.z, ty = 0, tz = 0;
    if (this.toolId === 'rake') {
      // tines sweep side to side and drag back toward the player
      const sw = Math.sin(s * Math.PI * 2);
      rz = rest.z + sw * 0.34;
      tz = -Math.abs(sw) * 0.10;
      rx = rest.x - Math.abs(sw) * 0.16;
      ry = rest.y + sw * 0.10;
    } else if (this.toolId === 'flathead') {
      rx = rest.x - a * 0.34;
      ry = rest.y + a * 0.10;
      ty = -a * 0.08;
      tz = -a * 0.08;
    } else if (this.toolId === 'pickaxe') {
      // over-the-shoulder swing: head lifts up and back, then drives down
      rx = rest.x - a * 0.56;
      ry = rest.y + a * 0.16;
      ty = -a * 0.07;
      tz = -a * 0.11;
    } else {
      rx = rest.x - a * 0.44;
      ry = rest.y + a * 0.12;
      ty = -a * 0.08;
      tz = -a * 0.10;
    }
    this.pivot.rotation.set(rx, ry, rz);
    this.pivot.position.set(swayX, ty, tz);

    this.root.position.x = this.pose.hold.x + swayX * 0.4;
    this.root.position.y = this.pose.hold.y + swayY;
  }
}

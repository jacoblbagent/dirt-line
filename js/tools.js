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

// A tool as a mesh group (used for the held view model and for tools left
// standing in the dirt as scenery).
export function buildToolMesh(id, materials, opts = {}) {
  const builder = TOOL_MODELS[id] || TOOL_MODELS.spade;
  return groupFromParts(builder(), materials, { castShadow: opts.shadows !== false, receiveShadow: false });
}

// First-person view model: a gloved hand holding the tool, swinging on use.
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

    this.root.position.set(0.36, -0.36, -0.82);
    this.root.rotation.set(0.04, -0.44, 0.14);
    this.root.scale.setScalar(0.66);
    camera.add(this.root);

    this.swing = 0;
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
      rx = 0.10 - a * 0.72;
      ty = -a * 0.13;
      tz = -a * 0.06;
    } else if (this.toolId === 'pickaxe') {
      rx = 0.12 - a * 1.05;
      tz = -a * 0.12;
      ty = -a * 0.05;
    } else {
      rx = 0.10 - a * 0.95;
      tz = -a * 0.14;
      ty = -a * 0.04;
    }
    this.pivot.rotation.x = rx;
    this.pivot.rotation.z = rz;
    this.pivot.position.set(swayX, ty, tz);

    this.root.position.x = 0.36 + swayX * 0.4;
    this.root.position.y = -0.36 + swayY;
  }
}

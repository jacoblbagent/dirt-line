// Scene dressing built from the detailed prop models: staging gear at the edge
// of the dirt zone, tools left standing in the dirt, fallen logs, stumps.
import { mergeGeos, xform, colorize, facet } from './geo.js';
import { groupFromParts } from './materials.js';
import {
  buildBucket, buildCooler, buildJug, buildTrashBag, buildPlank, buildDirtHeap,
} from './models-props.js';
import { TOOL_MODELS, TOOL_TIP_Y } from './models-tools.js';
import { buildLog, buildStump, buildRock } from './models-plants.js';
import { hash } from './geo.js';

const THREE = window.THREE;

// Bake a list of { parts, transform } into one merged geometry per material.
function bakeAll(items) {
  const byMat = new Map();
  for (const it of items) {
    let parts = it.parts;
    if (it.transform) {
      const baked = new Map();
      for (const [k, geo] of parts) baked.set(k, xform(geo, it.transform));
      parts = baked;
    }
    for (const [k, geo] of parts) {
      if (!geo) continue;
      if (!byMat.has(k)) byMat.set(k, []);
      byMat.get(k).push(geo);
    }
  }
  const out = new Map();
  for (const [k, list] of byMat) out.set(k, mergeGeos(list));
  return out;
}

// A tool standing in the dirt, blade buried. Returns baked parts (already in
// world space).
export function stuckTool(id, x, z, groundY, yaw, tilt = 0.30) {
  const parts = TOOL_MODELS[id]();
  const depth = 0.16;
  const m = {
    pos: [x, groundY - TOOL_TIP_Y[id] - depth - 0.0, z],
    rot: [tilt, yaw, -0.20],
  };
  const out = new Map();
  for (const [k, geo] of parts) out.set(k, xform(geo, m));
  return out;
}

export function buildStaging(terrain, materials) {
  const items = [];
  const put = (parts, x, z, yaw, extraY = 0) => {
    items.push({
      parts,
      transform: { pos: [x, terrain.heightAt(x, z) + extraY, z], rot: [0, yaw, 0], scale: [1, 1, 1] },
    });
  };

  // staged where the digger spawns, so the gear is the first thing you see
  put(buildBucket(), -7.4, 16.6, 0.4);
  put(buildCooler(), -6.1, 17.7, -0.7);
  put(buildJug(), -8.4, 17.8, 1.2);
  put(buildTrashBag(), -5.6, 15.6, 2.4);
  put(buildBucket(), 2.9, 17.0, -1.1);
  put(buildCooler(), 4.2, 18.0, 0.2);
  for (let i = 0; i < 4; i++) {
    const p = buildPlank(1.7 + hash(i, 3, 1) * 0.6, 0.24, 0.032, 10 + i, { broken: i === 3 });
    put(p, -3.6 + hash(i, 7, 2) * 0.22, 18.2 + hash(i, 11, 3) * 0.22, 0.9 + (hash(i, 13, 4) - 0.5) * 0.5, 0.02 + i * 0.036);
  }
  for (let i = 0; i < 3; i++) {
    const p = buildPlank(1.5 + hash(i, 5, 9) * 0.5, 0.22, 0.03, 20 + i, { broken: i === 2 });
    put(p, 6.6 + hash(i, 17, 5) * 0.2, 16.4 + hash(i, 19, 6) * 0.2, -0.35 + (hash(i, 23, 7) - 0.5) * 0.6, 0.02 + i * 0.034);
  }
  // tools left where work stopped
  items.push({ parts: stuckTool('spade', -3.2, 12.4, terrain.heightAt(-3.2, 12.4), 0.6) });
  items.push({ parts: stuckTool('flathead', 12.4, 3.6, terrain.heightAt(12.4, 3.6), -1.4) });
  items.push({ parts: stuckTool('pickaxe', -11.5, 8.2, terrain.heightAt(-11.5, 8.2), 2.2, 0.42) });
  // a rake laid flat on the ground
  items.push({
    parts: TOOL_MODELS.rake(),
    transform: { pos: [3.1, terrain.heightAt(3.1, 9.4) + 0.05, 9.4], rot: [Math.PI / 2 - 0.08, 1.1, 0], scale: [1, 1, 1] },
  });
  // a heap of spoil next to the pit
  const heap = buildDirtHeap(0.62, 41);
  items.push({ parts: new Map([['bark', heap]]), transform: { pos: [-6.6, terrain.heightAt(-6.6, 13.2) - 0.05, 13.2] } });
  return groupFromParts(bakeAll(items), materials);
}

// Fallen logs and stumps, merged into single draw calls.
export function buildLogs(terrain, list, materials) {
  const items = [];
  list.forEach((d, i) => {
    const y = terrain.heightAt(d.x, d.z);
    if (d.stump) {
      const parts = buildStump(i * 7 + 3, d.r * 2.2, 0.30 + d.r * 1.4);
      items.push({ parts, transform: { pos: [d.x, y - 0.04, d.z], rot: [0, d.ang || 0, 0] } });
    } else {
      const parts = buildLog(i * 13 + 5, d.len * 1.5, d.r * 1.5, { torn: i % 3 === 0 });
      items.push({
        parts,
        transform: {
          pos: [d.x, y + d.r * 0.55, d.z],
          rot: [0, d.ang || 0, 0],
        },
      });
    }
  });
  return groupFromParts(bakeAll(items), materials);
}

// Rocks, each generated with its own fracture pattern.
export function buildRocks(terrain, list, materials) {
  const kinds = ['boulder', 'flat', 'shard'];
  const items = list.map((d, i) => ({
    parts: buildRock(i * 17 + 11, kinds[i % kinds.length]),
    transform: {
      pos: [d.x, terrain.heightAt(d.x, d.z) + d.s * 0.18, d.z],
      rot: [(hash(i, 3, 1) - 0.5) * 0.6, hash(i, 5, 2) * Math.PI * 2, (hash(i, 7, 3) - 0.5) * 0.6],
      scale: [d.s, d.s * (0.7 + hash(i, 11, 4) * 0.5), d.s * (0.85 + hash(i, 13, 5) * 0.3)],
    },
  }));
  return groupFromParts(bakeAll(items), materials);
}

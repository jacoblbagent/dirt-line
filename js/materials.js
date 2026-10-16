// Shared material set. Every material uses vertex colours so a model can carry
// wood/metal/rubber shading detail in a single draw call per material.
const THREE = window.THREE;

export const MAT_DEFS = {
  bark:      { color: 0x6e5a45, roughness: 0.95, metalness: 0.0, flatShading: false },
  foliage:   { color: 0x5f8b47, roughness: 0.90, metalness: 0.0, side: THREE.DoubleSide, flatShading: true },
  wood:      { color: 0xa8834f, roughness: 0.82, metalness: 0.0 },
  metal:     { color: 0xb9bec4, roughness: 0.36, metalness: 0.55 },
  painted:   { color: 0xc4552c, roughness: 0.62, metalness: 0.08 },
  rubber:    { color: 0x1b1c1f, roughness: 0.95, metalness: 0.0 },
  plastic:   { color: 0xe4e6e1, roughness: 0.62, metalness: 0.02 },
  fabric:    { color: 0x1a1c21, roughness: 0.78, metalness: 0.0 },
  leather:   { color: 0xb98a5e, roughness: 0.80, metalness: 0.0 },
  cloth:     { color: 0x4e5c48, roughness: 0.95, metalness: 0.0 },
};

export function makeMaterials() {
  const out = {};
  for (const [k, d] of Object.entries(MAT_DEFS)) {
    out[k] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0xffffff),
      vertexColors: true,
      roughness: d.roughness,
      metalness: d.metalness,
      side: d.side || THREE.FrontSide,
      flatShading: !!d.flatShading,
    });
  }
  return out;
}

// Build a THREE.Group from { materialKey: mergedGeometry } parts.
export function groupFromParts(parts, materials, opts = {}) {
  const g = new THREE.Group();
  for (const [key, geo] of parts) {
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, materials[key] || materials.wood);
    mesh.castShadow = opts.castShadow !== false;
    mesh.receiveShadow = opts.receiveShadow !== false;
    g.add(mesh);
  }
  return g;
}

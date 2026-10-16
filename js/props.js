// Scene dressing: the gear that piles up around a dig (bucket, cooler, jug,
// trash bag, boards, a shovel left stuck in the dirt) and fallen logs.
import { CFG } from './config.js';
import { rnd } from './noise.js';
const THREE = window.THREE;

function mat(color, rough = 0.85, metal = 0.05, flat = false) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  if (flat) m.flatShading = true;
  return m;
}

// A spade left standing in the dirt — the signature shot of every build photo.
export function stuckShovel(x, z, y, yaw) {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 1.15, 8), mat(0xb98a52));
  shaft.position.y = 0.52;
  g.add(shaft);
  const sock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.17, 0.04), mat(0xd4682c, 0.7));
  sock.position.y = -0.06;
  g.add(sock);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.28, 0.016), mat(0x9ea4aa, 0.45, 0.2));
  blade.position.y = -0.28;
  g.add(blade);
  g.position.set(x, y, z);
  g.rotation.set(0.30, yaw, -0.22);
  return g;
}

export function bucket(x, z, y, yaw) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.165, 0.125, 0.30, 14, 1, true), mat(0xd0521c, 0.65));
  body.material.side = THREE.DoubleSide;
  body.position.y = 0.15;
  g.add(body);
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.125, 14), mat(0xa83f14, 0.7));
  bottom.rotation.x = -Math.PI / 2;
  bottom.position.y = 0.005;
  g.add(bottom);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.165, 0.012, 6, 16), mat(0xe06228, 0.6));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.30;
  g.add(rim);
  const handle = new THREE.Mesh(
    new THREE.TorusGeometry(0.16, 0.01, 5, 14, Math.PI * 1.05), mat(0x9aa0a6, 0.5, 0.2));
  handle.rotation.set(Math.PI / 2, 0, 0);
  handle.position.y = 0.30;
  g.add(handle);
  // a bit of spoil in the bottom
  const dirt = new THREE.Mesh(new THREE.CircleGeometry(0.135, 14), mat(0x6b5946, 0.95));
  dirt.rotation.x = -Math.PI / 2;
  dirt.position.y = 0.07;
  g.add(dirt);
  g.position.set(x, y, z);
  g.rotation.y = yaw;
  return g;
}

export function cooler(x, z, y, yaw) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.26, 0.32), mat(0xe6e7e2, 0.7));
  body.position.y = 0.15;
  g.add(body);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.53, 0.05, 0.35), mat(0xdfe0da, 0.65));
  lid.position.y = 0.305;
  g.add(lid);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 0.03), mat(0xb9bdb8, 0.6));
  handle.position.set(0, 0.33, 0.18);
  g.add(handle);
  g.position.set(x, y, z);
  g.rotation.y = yaw;
  return g;
}

export function jug(x, z, y, yaw) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.10, 0.28, 12), mat(0xd7dbdd, 0.5));
  body.position.y = 0.14;
  g.add(body);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.06, 0.07, 10), mat(0xc9cdd0, 0.5));
  neck.position.y = 0.31;
  g.add(neck);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.04, 10), mat(0x3f6bb5, 0.6));
  cap.position.y = 0.355;
  g.add(cap);
  g.position.set(x, y, z);
  g.rotation.y = yaw;
  return g;
}

export function trashBag(x, z, y, yaw) {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const g = new THREE.Group();
  const bag = new THREE.Mesh(geo, mat(0x181a1f, 0.55, 0.0, true));
  bag.scale.set(0.26, 0.20, 0.24);
  bag.position.y = 0.19;
  g.add(bag);
  const tie = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.10, 7), mat(0x101216, 0.6, 0, true));
  tie.position.y = 0.42;
  g.add(tie);
  g.position.set(x, y, z);
  g.rotation.set(0, yaw, 0.06);
  return g;
}

// Planks / boards stacked or laid on the ground (every build has some).
export function boards(x, z, y, yaw, n = 3) {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const len = 1.5 + rnd(i * 7, 33) * 1.1;
    const b = new THREE.Mesh(new THREE.BoxGeometry(len, 0.035, 0.24), mat(0x9d7a52, 0.92));
    b.position.set(rnd(i * 11, 51) * 0.18 - 0.09, 0.02 + i * 0.045,
      rnd(i * 5, 71) * 0.22 - 0.11);
    b.rotation.y = (rnd(i * 3, 91) - 0.5) * 0.4;
    b.rotation.z = (rnd(i * 13, 17) - 0.5) * 0.03;
    g.add(b);
  }
  g.position.set(x, y, z);
  g.rotation.y = yaw;
  return g;
}

// Fallen logs + stumps scattered through the woods.
export function buildLogs(terrain, list) {
  const geo = new THREE.CylinderGeometry(1, 1, 1, 7);
  const geoStump = new THREE.CylinderGeometry(0.9, 1.1, 1, 8);
  const logs = new THREE.InstancedMesh(geo, mat(0x8b7355, 0.95, 0, true), list.length);
  const stumps = new THREE.InstancedMesh(geoStump, mat(0x7d6a50, 0.95, 0, true), list.length);
  logs.castShadow = true; logs.receiveShadow = true;
  stumps.castShadow = true; stumps.receiveShadow = true;
  const o = new THREE.Object3D();
  const up = new THREE.Vector3(0, 1, 0);
  let li = 0, si = 0;
  list.forEach((d, i) => {
    const y = terrain.heightAt(d.x, d.z);
    if (d.stump) {
      o.position.set(d.x, y + d.r * 0.55, d.z);
      o.quaternion.identity();
      o.scale.set(d.r, d.r * 1.1, d.r);
      o.updateMatrix();
      stumps.setMatrixAt(si++, o.matrix);
    } else {
      const dir = new THREE.Vector3(Math.cos(d.ang), 0.06, Math.sin(d.ang)).normalize();
      o.quaternion.setFromUnitVectors(up, dir);
      o.scale.set(d.r, d.len, d.r);
      o.position.set(d.x + dir.x * d.len * 0.5, y + d.r * 0.85, d.z + dir.z * d.len * 0.5);
      o.updateMatrix();
      logs.setMatrixAt(li++, o.matrix);
    }
  });
  logs.count = li; stumps.count = si;
  logs.instanceMatrix.needsUpdate = true;
  stumps.instanceMatrix.needsUpdate = true;
  const g = new THREE.Group();
  g.add(logs); g.add(stumps);
  return g;
}

// Everything a digger drags out to the woods, staged at the edge of the dirt zone.
export function buildStaging(terrain, rngSeed = 7) {
  const g = new THREE.Group();
  const spots = [
    { f: bucket, x: -17.5, z: 16.5, yaw: 0.4 },
    { f: cooler, x: -16.2, z: 17.4, yaw: -0.7 },
    { f: jug, x: -18.6, z: 17.6, yaw: 1.2 },
    { f: trashBag, x: -15.1, z: 15.6, yaw: 2.4 },
    { f: bucket, x: 6.4, z: 17.2, yaw: -1.1 },
    { f: cooler, x: 7.6, z: 18.1, yaw: 0.2 },
    { f: boards, x: -13.4, z: 18.6, yaw: 0.9, n: 4 },
    { f: boards, x: 9.8, z: 16.2, yaw: -0.35, n: 3 },
  ];
  for (const s of spots) {
    const y = terrain.heightAt(s.x, s.z);
    g.add(s.f(s.x, s.z, y, s.yaw, s.n));
  }
  // two shovels left standing in the dirt where work stopped
  g.add(stuckShovel(-3.2, 12.4, terrain.heightAt(-3.2, 12.4), 0.6));
  g.add(stuckShovel(12.4, 3.6, terrain.heightAt(12.4, 3.6), -1.4));
  g.traverse(o => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });
  return g;
}

// Map layouts, building helpers and the van model
// Rectangles are [x1, x2, z1, z2]

export function room(x1, x2, z1, z2, door) {
  const t = 0.3, cx = (x1 + x2) / 2, cz = (z1 + z2) / 2, g = 1;
  const out = [];
  if (door === 'N') out.push([x1, cx - g, z1, z1 + t], [cx + g, x2, z1, z1 + t]);
  else out.push([x1, x2, z1, z1 + t]);
  if (door === 'S') out.push([x1, cx - g, z2 - t, z2], [cx + g, x2, z2 - t, z2]);
  else out.push([x1, x2, z2 - t, z2]);
  if (door === 'W') out.push([x1, x1 + t, z1, cz - g], [x1, x1 + t, cz + g, z2]);
  else out.push([x1, x1 + t, z1, z2]);
  if (door === 'E') out.push([x2 - t, x2, z1, cz - g], [x2 - t, x2, cz + g, z2]);
  else out.push([x2 - t, x2, z1, z2]);
  return out;
}

function outer(x1, x2, z1, z2) {
  return [
    [x1 - 0.3, x2 + 0.3, z1 - 0.3, z1], [x1 - 0.3, x2 + 0.3, z2, z2 + 0.3],
    [x1 - 0.3, x1, z1, z2], [x2, x2 + 0.3, z1, z2]
  ];
}

export const LAYOUTS = {
  school: {
    bounds: [-20, 20, -15, 15], floor: 0x3b3a33, wall: 0x6b6a70, furniture: 0x6b4b2a,
    lights: [[-10, -8], [10, 8], [0, 6]], outdoor: false,
    walls: [
      ...outer(-20, 20, -15, 15),
      [-20, -3, -0.2, 0.2], [3, 20, -0.2, 0.2],
      [-8.2, -7.8, -15, -9], [-8.2, -7.8, -7, -0.2], [-8.2, -7.8, 0.2, 7], [-8.2, -7.8, 9, 15],
      [7.8, 8.2, -15, -11], [7.8, 8.2, -9, -0.2], [7.8, 8.2, 0.2, 2], [7.8, 8.2, 4, 15]
    ],
    furniture: [
      [-18, -16, -12, -10], [-14, -12, -6, -4], [-4, -2, -12, -10], [12, 14, -12, -10],
      [16, 18, -4, -2], [-18, -16, 4, 6], [-6, -4, 10, 12], [10, 12, 10, 12], [14, 18, 8, 10],
      [0, 2, -8, -6], [-19.7, -19, -14, -10], [-19.7, -19, 10, 14], [18.9, 19.7, -14, -10]
    ],
    trees: [],
    spawn: { x: 0, z: 5 }, ghostStart: { x: -14, z: 10 }
  },

  camp: {
    bounds: [-30, 30, -30, 30], floor: 0x2a3a22, wall: 0x6b5a3a, furniture: 0x7a5a32,
    lights: [], outdoor: true,
    walls: [
      ...outer(-30, 30, -30, 30),
      ...room(-24, -14, -22, -12, 'E'), ...room(-24, -14, -6, 4, 'E'),
      ...room(12, 22, -22, -12, 'W'), ...room(12, 22, 6, 16, 'W'),
      ...room(-6, 4, 18, 26, 'N'), ...room(-4, 6, -26, -18, 'S')
    ],
    furniture: [[-4, 0, -4, -2], [8, 12, -10, -8], [0, 2, 10, 12]],
    trees: [[-10, -12], [-8, -2], [-16, 10], [-4, -12], [6, -6], [18, 0], [-20, -29],
            [20, 18], [8, 24], [-2, 28], [24, -22], [-26, 24], [24, -2], [-12, -28]],
    spawn: { x: 0, z: 15 }, ghostStart: { x: -18, z: -17 }
  },

  hostel: {
    bounds: [-16, 16, -23, 23], floor: 0x3a2e33, wall: 0x5a4a5e, furniture: 0x4a3a2e,
    lights: [[0, 0], [-9, -3], [9, -3]], outdoor: false,
    walls: [
      ...outer(-16, 16, -23, 23),
      ...room(-15, -3, -20, -10, 'E'), ...room(-15, -3, -8, 2, 'E'),
      ...room(-15, -3, 4, 14, 'E'), ...room(-15, -3, 16, 22, 'E'),
      ...room(3, 15, -20, -10, 'W'), ...room(3, 15, -8, 2, 'W'),
      ...room(3, 15, 4, 14, 'W'), ...room(3, 15, 16, 22, 'W')
    ],
    furniture: [
      [-14, -10, -19, -17], [-6, -4, -14, -12], [-14, -10, -7, -5], [-6, -4, -1, 1],
      [4, 8, -19, -17], [10, 14, -7, -5], [4, 8, 11, 13], [10, 14, 19, 21],
      [-14, -10, 17, 19], [-14, -10, 11, 13]
    ],
    trees: [],
    spawn: { x: 0, z: 0 }, ghostStart: { x: -9, z: -3 }
  }
};

// Pushes a point out of walls and furniture, and keeps it inside the map bounds
export function pushOut(world, x, z, r) {
  const [bx1, bx2, bz1, bz2] = world.bounds;
  x = Math.max(bx1 + r, Math.min(bx2 - r, x));
  z = Math.max(bz1 + r, Math.min(bz2 - r, z));
  for (const s of world.solids) {
    const minX = s.x1 - r, maxX = s.x2 + r, minZ = s.z1 - r, maxZ = s.z2 + r;
    if (x > minX && x < maxX && z > minZ && z < maxZ) {
      const dl = x - minX, dr = maxX - x, dn = z - minZ, df = maxZ - z;
      const m = Math.min(dl, dr, dn, df);
      if (m === dl) x = minX;
      else if (m === dr) x = maxX;
      else if (m === dn) z = minZ;
      else z = maxZ;
    }
  }
  return { x, z };
}

function addBlock(scene, meshes, [x1, x2, z1, z2], h, material) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(x2 - x1, h, z2 - z1), material);
  m.position.set((x1 + x2) / 2, h / 2, (z1 + z2) / 2);
  m.castShadow = true;
  m.receiveShadow = true;
  scene.add(m);
  meshes.push(m);
  return { x1, x2, z1, z2 };
}

// Builds a map and returns its collision data plus every object so it can be removed later
export function buildWorld(scene, mapId) {
  const L = LAYOUTS[mapId];
  const [bx1, bx2, bz1, bz2] = L.bounds;
  const meshes = [];
  const solids = [];

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(bx2 - bx1, bz2 - bz1),
    new THREE.MeshStandardMaterial({ color: L.floor, roughness: 1 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((bx1 + bx2) / 2, 0, (bz1 + bz2) / 2);
  floor.receiveShadow = true;
  scene.add(floor);
  meshes.push(floor);

  const wallMat = new THREE.MeshStandardMaterial({ color: L.wall, roughness: 0.9 });
  for (const r of L.walls) solids.push(addBlock(scene, meshes, r, 3, wallMat));

  const furMat = new THREE.MeshStandardMaterial({ color: L.furniture, roughness: 0.8 });
  for (const r of L.furniture) solids.push(addBlock(scene, meshes, r, 1.1, furMat));

  const trunk = new THREE.MeshStandardMaterial({ color: 0x4a3524 });
  const leaf = new THREE.MeshStandardMaterial({ color: 0x1d3d24 });
  for (const [x, z] of L.trees) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 2.4, 8), trunk);
    t.position.set(x, 1.2, z);
    t.castShadow = true;
    scene.add(t);
    meshes.push(t);
    const c = new THREE.Mesh(new THREE.ConeGeometry(1.6, 3.6, 10), leaf);
    c.position.set(x, 3.6, z);
    c.castShadow = true;
    scene.add(c);
    meshes.push(c);
    solids.push({ x1: x - 0.5, x2: x + 0.5, z1: z - 0.5, z2: z + 0.5 });
  }

  for (const [x, z] of L.lights) {
    const l = new THREE.PointLight(0xffd7a0, 0.9, 12);
    l.position.set(x, 2.6, z);
    scene.add(l);
    meshes.push(l);
  }
  if (L.outdoor) {
    const moon = new THREE.DirectionalLight(0x9fb8ff, 0.5);
    moon.position.set(-10, 20, 8);
    scene.add(moon);
    meshes.push(moon);
  }

  return { solids, meshes, bounds: L.bounds, spawn: L.spawn, ghostStart: L.ghostStart };
}

// The van model shown in the menu
export function buildVan() {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: 0x3b4a6b, roughness: 0.5, metalness: 0.2 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1a2a3a, roughness: 0.1, metalness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
  const stripe = new THREE.MeshStandardMaterial({ color: 0xffcc00 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.0, 4.6), paint);
  body.position.y = 1.4;
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.2, 1.3), paint);
  cab.position.set(0, 1.2, -2.6);
  const windshield = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.7, 0.06), glass);
  windshield.position.set(0, 1.5, -3.27);
  const rear = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.0, 0.08), paint);
  rear.position.set(0, 1.4, 2.3);
  const band = new THREE.Mesh(new THREE.BoxGeometry(2.44, 0.25, 4.64), stripe);
  band.position.y = 1.0;
  g.add(body, cab, windshield, rear, band);

  const wheelGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.45, 16);
  wheelGeo.rotateZ(Math.PI / 2);
  [[-1.2, -1.6], [1.2, -1.6], [-1.2, 1.6], [1.2, 1.6]].forEach(([x, z]) => {
    const w = new THREE.Mesh(wheelGeo, dark);
    w.position.set(x, 0.55, z);
    g.add(w);
  });

  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

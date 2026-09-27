// The static VR scene: sky, sun, ground, ATL runways, the Atlanta skyline, and the rooftop at
// Georgia Tech the viewer stands on. World: x = east, y = up, z = -north (meters).

import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { ATL_RUNWAYS } from './scenario';
import { toLocal } from './local';

/** Viewer eye height: on a ~40 m campus rooftop. */
export const EYE_HEIGHT_M = 42;

/** Sun direction: late-afternoon, from the west-southwest (backlights planes to the east nicely). */
const SUN_ELEVATION_DEG = 22;
const SUN_AZIMUTH_DEG = 245;

const HAZE = new THREE.Color(0xb9cbe0);

export type World = {
  scene: THREE.Scene;
  sky: Sky;
  /** Animate clouds. */
  update: (timeMs: number) => void;
};

/** Small deterministic PRNG so the skyline is the same every run. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const world = (eastKm: number, northKm: number, y = 0) => new THREE.Vector3(eastKm * 1000, y, -northKm * 1000);

export function createWorld(): World {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(HAZE, 6_000, 70_000);

  // Sky (physically based scattering + drifting clouds).
  const sky = new Sky();
  sky.scale.setScalar(450_000);
  const u = sky.material.uniforms;
  u.turbidity.value = 3;
  u.rayleigh.value = 1.2;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.8;
  u.cloudCoverage.value = 0.35;
  u.cloudDensity.value = 0.35;
  const phi = THREE.MathUtils.degToRad(90 - SUN_ELEVATION_DEG);
  // Azimuth is clockwise from north; world north is -z.
  const theta = THREE.MathUtils.degToRad(SUN_AZIMUTH_DEG);
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, phi, Math.PI - theta);
  u.sunPosition.value.copy(sunDir);
  scene.add(sky);

  // Lighting.
  scene.add(new THREE.HemisphereLight(0xdbe9ff, 0x5a6a4c, 1.4));
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
  sun.position.copy(sunDir).multiplyScalar(10_000);
  scene.add(sun);

  // Ground.
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(160_000, 64),
    new THREE.MeshStandardMaterial({ color: 0x6f8660, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // Faint 5 km grid, for a sense of scale and distance.
  const grid = new THREE.GridHelper(120_000, 24, 0x7c8c70, 0x66765c);
  grid.position.y = 1;
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.35;
  scene.add(grid);

  addAirport(scene);
  addCity(scene);
  addRooftop(scene);

  return {
    scene,
    sky,
    update(timeMs) {
      u.time.value = timeMs / 1000;
    },
  };
}

function addAirport(scene: THREE.Scene) {
  // Airfield grass/apron area, then the five parallel runways with centerline dashes.
  const field = new THREE.Mesh(
    new THREE.PlaneGeometry(7_000, 5_200),
    new THREE.MeshStandardMaterial({ color: 0x6f7a63, roughness: 1 }),
  );
  field.rotation.x = -Math.PI / 2;
  field.position.copy(world(-2.9, -15.5, 1.5));
  scene.add(field);

  const asphalt = new THREE.MeshStandardMaterial({ color: 0x2e3034, roughness: 0.9 });
  const paint = new THREE.MeshBasicMaterial({ color: 0xe8e8e8 });
  for (const [e1, e2, n] of ATL_RUNWAYS) {
    const len = (e2 - e1) * 1000;
    const rw = new THREE.Mesh(new THREE.PlaneGeometry(len, 60), asphalt);
    rw.rotation.x = -Math.PI / 2;
    rw.position.copy(world((e1 + e2) / 2, n, 2));
    scene.add(rw);
    for (let x = 30; x < len - 30; x += 90) {
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(40, 1.5), paint);
      dash.rotation.x = -Math.PI / 2;
      dash.position.copy(world(e1 + x / 1000, n, 2.5));
      scene.add(dash);
    }
    // Approach lights east of each threshold (arrivals come from the east).
    for (let i = 1; i <= 8; i++) {
      const l = new THREE.Mesh(new THREE.SphereGeometry(6, 6, 4), new THREE.MeshBasicMaterial({ color: 0xfff2b0 }));
      l.position.copy(world(e2 + i * 0.06, n, 6));
      scene.add(l);
    }
  }

  // Terminal buildings between the runway pairs, and a control tower.
  const concourse = new THREE.MeshStandardMaterial({ color: 0xc9ccd1, roughness: 0.7 });
  for (let i = 0; i < 6; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(260, 22, 1_300), concourse);
    b.position.copy(world(-3.9 + i * 0.5, -14.8, 11));
    scene.add(b);
  }
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(9, 12, 120, 12), concourse);
  tower.position.copy(world(-2.2, -14.95, 60));
  const cab = new THREE.Mesh(new THREE.CylinderGeometry(16, 13, 12, 12), new THREE.MeshStandardMaterial({ color: 0x1d2a3a, metalness: 0.6, roughness: 0.2 }));
  cab.position.copy(world(-2.2, -14.95, 126));
  scene.add(tower, cab);
}

function addCity(scene: THREE.Scene) {
  const rand = rng(42);
  type Cluster = { eastKm: number; northKm: number; radiusKm: number; count: number; minH: number; maxH: number };
  const clusters: Cluster[] = [
    // Downtown (~1.4 km E, 2.6 km S) and Midtown (~1 km E, 1 km N) towers.
    { eastKm: 1.4, northKm: -2.6, radiusKm: 1.1, count: 70, minH: 40, maxH: 260 },
    { eastKm: 1.05, northKm: 1.05, radiusKm: 0.8, count: 50, minH: 30, maxH: 230 },
    // Buckhead further north.
    { eastKm: 1.5, northKm: 8.5, radiusKm: 0.9, count: 30, minH: 30, maxH: 180 },
    // Low-rise sprawl everywhere else.
    { eastKm: 0, northKm: 0, radiusKm: 12, count: 700, minH: 8, maxH: 30 },
  ];
  const total = clusters.reduce((n, c) => n + c.count, 0);
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.2 }),
    total,
  );
  const m = new THREE.Matrix4();
  const color = new THREE.Color();
  let i = 0;
  for (const c of clusters) {
    for (let k = 0; k < c.count; k++) {
      const r = c.radiusKm * Math.sqrt(rand());
      const a = rand() * Math.PI * 2;
      let e = c.eastKm + r * Math.sin(a);
      let n = c.northKm + r * Math.cos(a);
      // Keep the sprawl off the viewer's rooftop and the airfield.
      if (Math.hypot(e, n) < 0.25) e += 0.4;
      if (n < -13.2 && n > -18 && e > -5.5 && e < -0.4) n += 6;
      const h = c.minH + (c.maxH - c.minH) * Math.pow(rand(), 2);
      const w = h > 60 ? 30 + rand() * 30 : 18 + rand() * 30;
      m.compose(world(e, n, h / 2), new THREE.Quaternion(), new THREE.Vector3(w, h, w * (0.7 + rand() * 0.6)));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, color.setHSL(0.58 + rand() * 0.06, 0.08 + rand() * 0.1, 0.45 + rand() * 0.25));
      i++;
    }
  }
  scene.add(mesh);

  // Grady Memorial Hospital helipad marker (the medevac's destination).
  const grady = toLocal(33.7522, -84.3806);
  const pad = new THREE.Mesh(new THREE.BoxGeometry(80, 45, 80), new THREE.MeshStandardMaterial({ color: 0xe8e2d6 }));
  pad.position.copy(world(grady.east / 1000, grady.north / 1000, 22));
  const h = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 1, 20), new THREE.MeshBasicMaterial({ color: 0xd21f2c }));
  h.position.copy(world(grady.east / 1000, grady.north / 1000, 46));
  scene.add(pad, h);
}

function addRooftop(scene: THREE.Scene) {
  // The rooftop you stand on: close-up geometry gives real stereo depth.
  const roofH = EYE_HEIGHT_M - 1.7;
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(24, roofH, 24),
    new THREE.MeshStandardMaterial({ color: 0x9a938a, roughness: 0.95 }),
  );
  roof.position.set(0, roofH / 2, 0);
  scene.add(roof);
  const rail = new THREE.MeshStandardMaterial({ color: 0xb8a36a, metalness: 0.6, roughness: 0.4 }); // GT gold
  for (const [x, z, w, d] of [
    [0, -12, 24, 0.12],
    [0, 12, 24, 0.12],
    [-12, 0, 0.12, 24],
    [12, 0, 0.12, 24],
  ]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, d), rail);
    bar.position.set(x, roofH + 1.05, z);
    scene.add(bar);
  }
  for (let k = -12; k <= 12; k += 3) {
    for (const [x, z] of [
      [k, -12],
      [k, 12],
      [-12, k],
      [12, k],
    ]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.05, 0.08), rail);
      post.position.set(x, roofH + 0.52, z);
      scene.add(post);
    }
  }
}

export { HAZE };

import { loadHradyBoard } from '@hrady/board';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/** Board footprint in world units; the board graph is normalised 0..1. */
const BOARD_W = 8.76;
const BOARD_H = 12;

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9cc3d8);
scene.fog = new THREE.Fog(0x9cc3d8, 25, 45);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(0, 14, 10);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.45;
controls.minDistance = 5;
controls.maxDistance = 30;

scene.add(new THREE.HemisphereLight(0xfff4dd, 0x3a5a2a, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.position.set(-6, 12, 6);
sun.castShadow = true;
sun.shadow.camera.left = -8;
sun.shadow.camera.right = 8;
sun.shadow.camera.top = 8;
sun.shadow.camera.bottom = -8;
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.BoxGeometry(BOARD_W, 0.2, BOARD_H),
  new THREE.MeshStandardMaterial({ color: 0x5f8f3e, flatShading: true }),
);
ground.position.y = -0.1;
ground.receiveShadow = true;
scene.add(ground);

/** Maps normalised board coordinates to the board's top surface. */
const toWorld = (x: number, y: number) =>
  new THREE.Vector3((x - 0.5) * BOARD_W, 0, (y - 0.5) * BOARD_H);

// Placeholder pieces from the board graph: coins, start pads and towers.
const board = loadHradyBoard();
const markerGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.06, 12);
const markerMat = new THREE.MeshStandardMaterial({ color: 0xe0b43c, flatShading: true });
const startGeo = new THREE.BoxGeometry(0.5, 0.06, 0.6);
const startMat = new THREE.MeshStandardMaterial({ color: 0xf2ead3, flatShading: true });
const towerMat = new THREE.MeshStandardMaterial({ color: 0xb9a68a, flatShading: true });
const roofMat = new THREE.MeshStandardMaterial({ color: 0xa8452f, flatShading: true });

for (const node of board.data.nodes) {
  const pos = toWorld(node.x, node.y);
  if (node.type === 'castle') {
    const height = 0.4 + node.value * 0.25;
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, height, 6), towerMat);
    tower.position.copy(pos).setY(height / 2);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.4, 6), roofMat);
    roof.position.copy(pos).setY(height + 0.2);
    for (const mesh of [tower, roof]) {
      mesh.castShadow = true;
      scene.add(mesh);
    }
  } else {
    const mesh = new THREE.Mesh(
      node.type === 'start' ? startGeo : markerGeo,
      node.type === 'start' ? startMat : markerMat,
    );
    mesh.position.copy(pos).setY(0.03);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
}

const edgePoints = board.data.edges.flatMap(([a, b]) => {
  const na = board.nodes.get(a)!;
  const nb = board.nodes.get(b)!;
  return [toWorld(na.x, na.y).setY(0.01), toWorld(nb.x, nb.y).setY(0.01)];
});
scene.add(
  new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(edgePoints),
    new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.06, gapSize: 0.08 }),
  ).computeLineDistances(),
);

function resize() {
  const { clientWidth: w, clientHeight: h } = canvas;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

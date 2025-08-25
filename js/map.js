// map.js — updated, fully patched version
// - uses mergeGeometries (rename)
// - robust BVH creation: prefers computeBoundsTree prototype helper, falls back to new MeshBVH()
// - typed index creation for geometries that lack an index
// - defensive ordering: attach three-mesh-bvh prototypes before any BVH call
// - merges visuals by material optionally to reduce draw calls
// Drop this in place of your previous map.js

import { Loader } from './Loader.js';
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  computeBoundsTree,
  disposeBoundsTree,
  acceleratedRaycast,
  MeshBVH,
  MeshBVHHelper,
  StaticGeometryGenerator
} from 'https://cdn.jsdelivr.net/npm/three-mesh-bvh@0.9.1/+esm';

// --- Attach BVH helpers to THREE prototypes (must run before computeBoundsTree calls) ---
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// Utility: use mergeGeometries (new name) but fall back if environment exports only the old name
const mergeGeometries = BufferGeometryUtils.mergeGeometries || BufferGeometryUtils.mergeBufferGeometries;

// --- Config flags ---
const MERGE_VISUALS = true; // set false to keep original GLTF graph for visuals
const BVH_OPTIONS = { maxLeafTris: 10, lazyGeneration: false };
const SHADOW_MAP_SIZE = 1024;

// --- Helpers: typed index generator & ensure indexed geometry ---
function generateSequentialIndices(vertexCount) {
  const use32 = vertexCount > 65535;
  const idx = use32 ? new Uint32Array(vertexCount) : new Uint16Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) idx[i] = i;
  return idx;
}

function ensureIndexed(geometry) {
  if (!geometry || geometry.index) return;
  const count = geometry.attributes.position.count;
  geometry.setIndex(generateSequentialIndices(count));
  geometry.index.needsUpdate = true;
}

// Robust BVH builder: prefer geometry.computeBoundsTree() (prototype helper), fallback to MeshBVH constructor
function safeBuildBVH(geometry, options = BVH_OPTIONS) {
  if (!geometry) throw new Error('safeBuildBVH: geometry is null/undefined');
  ensureIndexed(geometry);
  // If prototype helper is attached, use it
  if (typeof geometry.computeBoundsTree === 'function') {
    geometry.computeBoundsTree(options);
    return geometry.boundsTree;
  }
  // Fallback: construct MeshBVH explicitly and attach
  geometry.boundsTree = new MeshBVH(geometry, options);
  return geometry.boundsTree;
}

// Merge visual meshes by material to reduce draw calls (returns array of merged meshes)
function mergeVisualMeshesByMaterial(gltfGroup) {
  const groups = new Map(); // materialUUID -> array of geometries
  const materialLookup = new Map();
  const toRemove = [];

  gltfGroup.traverse(child => {
    if (!child.isMesh) return;
    // skip skinned or morph target meshes (not safe to merge)
    if (child.isSkinnedMesh || child.morphTargetInfluences) return;

    const material = child.material || new THREE.MeshStandardMaterial();
    const key = material.uuid;
    materialLookup.set(key, material);

    if (!child.geometry) return;
    ensureIndexed(child.geometry);

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(child.geometry);

    toRemove.push(child);
  });

  if (groups.size === 0) return [];

  const mergedMeshes = [];
  for (const [matUUID, geoms] of groups.entries()) {
    try {
      const merged = mergeGeometries(geoms, true);
      if (!merged) continue;
      ensureIndexed(merged);
      if (!merged.boundingBox) merged.computeBoundingBox();
      if (!merged.boundingSphere) merged.computeBoundingSphere();
      const mat = materialLookup.get(matUUID) || new THREE.MeshStandardMaterial();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mergedMeshes.push(mesh);
      gltfGroup.add(mesh);
    } catch (e) {
      console.warn('mergeVisualMeshesByMaterial: merge failed for group', matUUID, e);
    }
  }

  // remove original meshes from scene graph (do not dispose automatically; leave for explicit lifecycle handling)
  toRemove.forEach(m => {
    if (m.parent) m.parent.remove(m);
  });

  return mergedMeshes;
}

// Lantern class (unchanged behavior but ensures indexed geometry)
export class Lantern {
  constructor(parent, position, scale = 1, lightOptions = {}) {
    this.container = new THREE.Object3D();
    this.container.position.copy(position);
    parent.add(this.container);

    const url = 'https://raw.githubusercontent.com/thearthd/3d-models/refs/heads/main/uploads_files_2887463_Lantern.obj';
    const loader = new OBJLoader();

    loader.load(
      url,
      lanternGroup => {
        lanternGroup.scale.set(scale, scale, scale);
        lanternGroup.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(lanternGroup);
        lanternGroup.position.y = -box.min.y;

        lanternGroup.traverse(child => {
          if (!child.isMesh) return;
          if (child.geometry && !child.geometry.index) {
            child.geometry.setIndex(generateSequentialIndices(child.geometry.attributes.position.count));
            child.geometry.index.needsUpdate = true;
          }
          child.material = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: 0.8,
            metalness: 0.7,
            side: THREE.DoubleSide
          });
          child.castShadow = child.receiveShadow = true;
        });

        this.container.add(lanternGroup);

        const {
          color = 0xffffff,
          intensity = 1,
          distance = 10,
          angle = Math.PI / 8,
          penumbra = 0.5,
          decay = 2
        } = lightOptions;

        const spot = new THREE.SpotLight(color, intensity, distance, angle, penumbra, decay);
        spot.position.set(0, (box.max.y - box.min.y) * 0.75, 0);
        spot.target.position.set(0, -20, 0);
        spot.castShadow = true;
        spot.shadow.mapSize.set(512, 512);
        spot.shadow.camera.near = 0.5;
        spot.shadow.camera.far = distance;
        this.container.add(spot, spot.target);
      },
      null,
      err => console.error('Error loading lantern model:', err)
    );
  }
}

// Shared loader for GLB maps
async function loadAndPrepareGLB({ scene, glbUrl, scale = 1, physicsController, loaderUI, loaderLabel = 'Map' }) {
  let gltfGroup = null;
  let onGLBProgress = () => {};

  const mapLoadPromise = new Promise((resolve, reject) => {
    new GLTFLoader().load(
      glbUrl,
      async gltf => {
        try {
          gltfGroup = gltf.scene;
          gltfGroup.scale.set(scale, scale, scale);
          gltfGroup.updateMatrixWorld(true);
          scene.add(gltfGroup);

          window.envMeshes = window.envMeshes || [];

          gltfGroup.traverse(child => {
            if (!child.isMesh) return;
            child.castShadow = true;
            child.receiveShadow = true;
            if (child.material && child.material.map) {
              try { child.material.map.anisotropy = 4; } catch (e) { /* ignore */ }
            }
            if (child.geometry && !child.geometry.index) {
              child.geometry.setIndex(generateSequentialIndices(child.geometry.attributes.position.count));
              child.geometry.index.needsUpdate = true;
            }
            if (child.geometry) {
              if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
              if (!child.geometry.boundingSphere) child.geometry.computeBoundingSphere();
            }
            window.envMeshes.push(child);
          });

          // Optionally merge visuals to reduce draw calls
          if (MERGE_VISUALS) {
            try {
              const mergedMeshes = mergeVisualMeshesByMaterial(gltfGroup);
              if (mergedMeshes.length > 0) {
                console.log(`Merged ${mergedMeshes.length} visual mesh groups to reduce draw calls.`);
              }
            } catch (e) {
              console.warn('Visual merge failed; continuing with original meshes.', e);
            }
          }

          // Build merged geometry for BVH using StaticGeometryGenerator (collision-only)
          const staticGenerator = new StaticGeometryGenerator(gltfGroup);
          staticGenerator.attributes = ['position']; // only position required for collision
          const mergedGeometry = staticGenerator.generate();

          if (!mergedGeometry) {
            throw new Error('StaticGeometryGenerator returned null/undefined geometry.');
          }

          // Ensure indexed
          ensureIndexed(mergedGeometry);

          // Build BVH robustly
          try {
            safeBuildBVH(mergedGeometry, BVH_OPTIONS);
          } catch (bvhErr) {
            console.error('Failed to build BVH on merged geometry:', bvhErr);
            throw bvhErr;
          }

          // Create collider mesh and hand to physics controller
          const collider = new THREE.Mesh(mergedGeometry, new THREE.MeshBasicMaterial({
            wireframe: true,
            transparent: true,
            opacity: 0.5
          }));
          collider.visible = false;
          collider.castShadow = false;
          collider.receiveShadow = false;
          scene.add(collider);

          // Optional debug helper (hidden by default)
          const helper = new MeshBVHHelper(collider, 10);
          helper.visible = false;
          scene.add(helper);

          if (physicsController && typeof physicsController.setCollider === 'function') {
            physicsController.setCollider(collider);
            physicsController.worldBVH = mergedGeometry.boundsTree;
          } else {
            console.warn('physicsController missing setCollider — collider created but not assigned.');
          }

          console.log(`✔️ ${loaderLabel} GLB loaded and BVH collider built.`);
          resolve(gltfGroup);
        } catch (err) {
          console.error(`${loaderLabel}: processing error`, err);
          reject(err);
        }
      },
      // progress
      evt => { if (evt.lengthComputable) onGLBProgress(evt); },
      err => {
        console.error(`${loaderLabel} load error:`, err);
        reject(err);
      }
    );
  });

  loaderUI.track(1.0, mapLoadPromise, cb => { onGLBProgress = cb; });
  await mapLoadPromise;
  loaderUI.onComplete(() => {
    window.mapReady = true;
    console.log('🗺️ Map + BVH Collider fully ready!');
  });

  return gltfGroup;
}

// Exported map creators (returns spawn points array)
export async function createCrocodilosConstruction(scene, physicsController) {
  window.envMeshes = [];
  window.mapReady = false;

  const loaderUI = new Loader();
  loaderUI.show('Loading CrocodilosConstruction Map...', [1.0]);

  const SCALE = 5;
  const rawSpawnPoints = [
    new THREE.Vector3(-14, 7, -36),
    new THREE.Vector3(-2, 2, 37),
    new THREE.Vector3(0, 2, 0),
    new THREE.Vector3(2, 7, 34),
    new THREE.Vector3(-5, 2, -38),
    new THREE.Vector3(-18, 2, 12),
    new THREE.Vector3(11, 2, 23),
    new THREE.Vector3(-7, 7, -1),
  ];
  const spawnPoints = rawSpawnPoints.map(p => p.clone().multiplyScalar(SCALE / 5));

  // sunlight
  const sunLight = new THREE.DirectionalLight(0xffffff, 1);
  sunLight.position.set(50, 100, 50);
  sunLight.target.position.set(0, 0, 0);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  const d = 100;
  sunLight.shadow.camera.left = -d;
  sunLight.shadow.camera.right = d;
  sunLight.shadow.camera.top = d;
  sunLight.shadow.camera.bottom = -d;
  sunLight.shadow.camera.near = 0.1;
  sunLight.shadow.camera.far = 200;
  scene.add(sunLight, sunLight.target);

  const GLB_MODEL_URL = 'https://raw.githubusercontent.com/thearthd/3d-models/main/croccodilosconstruction.glb';
  await loadAndPrepareGLB({
    scene,
    glbUrl: GLB_MODEL_URL,
    scale: SCALE,
    physicsController,
    loaderUI,
    loaderLabel: 'CrocodilosConstruction'
  });

  return spawnPoints;
}

export async function createSigmaCity(scene, physicsController) {
  window.envMeshes = [];
  window.mapReady = false;

  const loaderUI = new Loader();
  loaderUI.show('Loading SigmaCity Map...', [1.0]);

  const SCALE = 2;
  const rawSpawnPoints = [
    new THREE.Vector3(-1, 3, -4),
    new THREE.Vector3(-55, -1, -6),
    new THREE.Vector3(13, 5, 47),
    new THREE.Vector3(1, 5, -66),
    new THREE.Vector3(21, 5, -45),
    new THREE.Vector3(0, 10, 22),
    new THREE.Vector3(43, 1, -35),
    new THREE.Vector3(24, 3, -14),
  ];
  const spawnPoints = rawSpawnPoints.map(p => p.clone().multiplyScalar(SCALE / 2));

  // sunlight
  const sunLight = new THREE.DirectionalLight(0xffffff, 1);
  sunLight.position.set(50, 100, 50);
  sunLight.target.position.set(0, 0, 0);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  const d = 100;
  sunLight.shadow.camera.left = -d;
  sunLight.shadow.camera.right = d;
  sunLight.shadow.camera.top = d;
  sunLight.shadow.camera.bottom = -d;
  sunLight.shadow.camera.near = 0.1;
  sunLight.shadow.camera.far = 200;
  scene.add(sunLight, sunLight.target);

  const GLB_MODEL_URL = 'https://raw.githubusercontent.com/thearthd/3d-models/main/sigmacityupdated.glb';
  await loadAndPrepareGLB({
    scene,
    glbUrl: GLB_MODEL_URL,
    scale: SCALE,
    physicsController,
    loaderUI,
    loaderLabel: 'SigmaCity'
  });

  return spawnPoints;
}

export async function createDiddyDunes(scene, physicsController) {
  window.envMeshes = [];
  window.mapReady = false;

  const loaderUI = new Loader();
  loaderUI.show('Loading diddyDunes Map...', [1.0]);

  const SCALE = 2;
  const rawSpawnPoints = [
    new THREE.Vector3(34, 3, 0),
    new THREE.Vector3(62, 1, -37),
    new THREE.Vector3(26, 3, -30),
    new THREE.Vector3(-27, 3, -74),
    new THREE.Vector3(12, 3, -20),
    new THREE.Vector3(-58, 8, 2),
    new THREE.Vector3(55, 1, -55),
    new THREE.Vector3(-20, 8, -13),
  ];
  const spawnPoints = rawSpawnPoints.map(p => p.clone().multiplyScalar(SCALE / 2));

  // sunlight
  const sunLight = new THREE.DirectionalLight(0xffffff, 1);
  sunLight.position.set(50, 100, 50);
  sunLight.target.position.set(0, 0, 0);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  const d = 100;
  sunLight.shadow.camera.left = -d;
  sunLight.shadow.camera.right = d;
  sunLight.shadow.camera.top = d;
  sunLight.shadow.camera.bottom = -d;
  sunLight.shadow.camera.near = 0.1;
  sunLight.shadow.camera.far = 200;
  scene.add(sunLight, sunLight.target);

  const GLB_MODEL_URL = 'https://raw.githubusercontent.com/thearthd/3d-models/main/didddydunes.glb';
  await loadAndPrepareGLB({
    scene,
    glbUrl: GLB_MODEL_URL,
    scale: SCALE,
    physicsController,
    loaderUI,
    loaderLabel: 'diddyDunes'
  });

  return spawnPoints;
}

// map.js — updated version (spawn points, sizing, and collider fixes)
//
// Key points:
// - Looks for named GLTF spawn nodes (node.name startsWith 'spawn' or 'Spawn') and uses them if present.
// - Otherwise transforms provided rawSpawnPoints by gltf.scene.matrixWorld (correct scale/rotation/translation).
// - Builds BVH on merged collision geometry and transforms geometry into gltfGroup local space so collider
//   aligns with visual geometry (fixes orientation/scale issues).
// - Computes sunLight shadow camera extents from the map bounding box for correct shadow coverage.
//
// Usage: same exports as before: createCrocodilosConstruction(scene, physicsController) etc.
// Each returns spawnPoints (world-space THREE.Vector3) ready to use.

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

// Attach BVH helpers to THREE prototypes (must run before computeBoundsTree calls)
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// Utility: use mergeGeometries but fall back if only the old name exists
const mergeGeometries = BufferGeometryUtils.mergeGeometries || BufferGeometryUtils.mergeBufferGeometries;

// Config
const MERGE_VISUALS = true;
const BVH_OPTIONS = { maxLeafTris: 10, lazyGeneration: false };
const SHADOW_MAP_SIZE = 1024;

// Helpers
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

// safe BVH builder (uses prototype helper if available, otherwise constructor)
function safeBuildBVH(geometry, options = BVH_OPTIONS) {
  if (!geometry) throw new Error('safeBuildBVH: geometry is null/undefined');
  ensureIndexed(geometry);
  if (typeof geometry.computeBoundsTree === 'function') {
    geometry.computeBoundsTree(options);
    return geometry.boundsTree;
  }
  geometry.boundsTree = new MeshBVH(geometry, options);
  return geometry.boundsTree;
}

// merge visual meshes by material to reduce draw calls (returns merged meshes)
function mergeVisualMeshesByMaterial(gltfGroup) {
  const groups = new Map();
  const materialLookup = new Map();
  const toRemove = [];

  gltfGroup.traverse(child => {
    if (!child.isMesh) return;
    if (child.isSkinnedMesh || child.morphTargetInfluences) return; // skip animated/skinned
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

  toRemove.forEach(m => { if (m.parent) m.parent.remove(m); });
  return mergedMeshes;
}

// Helper: collect spawn points — prefer named nodes in GLTF, otherwise transform rawSpawnPoints
function collectSpawnPoints(gltfGroup, rawSpawnPoints = []) {
  const found = [];
  gltfGroup.traverse(node => {
    if (!node.isObject3D) return;
    const name = node.name || '';
    if (name.toLowerCase().startsWith('spawn')) {
      // use world position of that node
      node.updateMatrixWorld(true);
      const p = new THREE.Vector3().setFromMatrixPosition(node.matrixWorld);
      found.push(p);
    }
  });
  if (found.length > 0) return found;

  // fallback: transform provided rawSpawnPoints by gltfGroup.matrixWorld
  const world = gltfGroup.matrixWorld.clone();
  return rawSpawnPoints.map(p => p.clone().applyMatrix4(world));
}

// Main loader & preparer — returns an object with { gltfGroup, spawnPoints }
async function loadAndPrepareGLB({
  scene,
  glbUrl,
  scale = 1,
  physicsController,
  loaderUI,
  loaderLabel = 'Map',
  rawSpawnPoints = []
}) {
  let gltfGroup = null;
  let onGLBProgress = () => {};

  const mapLoadPromise = new Promise((resolve, reject) => {
    new GLTFLoader().load(
      glbUrl,
      async gltf => {
        try {
          gltfGroup = gltf.scene;
          gltfGroup.scale.set(scale, scale, scale);
          // ensure transforms are up to date
          gltfGroup.updateMatrixWorld(true);

          // add visuals
          scene.add(gltfGroup);

          // per-mesh prep (shadows / indexing / bounds)
          window.envMeshes = window.envMeshes || [];
          gltfGroup.traverse(child => {
            if (!child.isMesh) return;
            child.castShadow = true;
            child.receiveShadow = true;
            if (child.material && child.material.map) {
              try { child.material.map.anisotropy = 4; } catch (e) {}
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

          // Optionally merge visuals for drawcall reduction
          if (MERGE_VISUALS) {
            try {
              const mergedMeshes = mergeVisualMeshesByMaterial(gltfGroup);
              if (mergedMeshes.length > 0) {
                console.log(`Merged ${mergedMeshes.length} visual mesh groups to reduce draw calls.`);
              }
            } catch (e) {
              console.warn('Visual merge failed; continuing with original mesh graph.', e);
            }
          }

          // compute world bounding box and set sun/shadow extents later in the creator
          const worldBBox = new THREE.Box3().setFromObject(gltfGroup);

          // Build merged geometry for collisions using StaticGeometryGenerator
          const staticGenerator = new StaticGeometryGenerator(gltfGroup);
          staticGenerator.attributes = ['position']; // only position needed for collision
          const mergedGeometry = staticGenerator.generate();

          if (!mergedGeometry) {
            throw new Error('StaticGeometryGenerator returned null/undefined geometry.');
          }

          // The StaticGeometryGenerator may produce geometry in world coordinates.
          // Convert geometry into the local space of the gltfGroup so the collider can be added as a child of gltfGroup
          // This keeps the collider transforms aligned with visuals and fixes orientation/scale mismatches.
          // Compute inverse world matrix:
          const invWorld = new THREE.Matrix4().copy(gltfGroup.matrixWorld).invert();
          mergedGeometry.applyMatrix4(invWorld);

          // Ensure index & build BVH robustly
          ensureIndexed(mergedGeometry);
          try {
            safeBuildBVH(mergedGeometry, BVH_OPTIONS);
          } catch (bvhErr) {
            console.error('Failed to build BVH on merged geometry:', bvhErr);
            throw bvhErr;
          }

          // Create collider mesh that is in the same local space as gltfGroup
          const collider = new THREE.Mesh(mergedGeometry, new THREE.MeshBasicMaterial({
            wireframe: true, transparent: true, opacity: 0.5
          }));
          collider.visible = false;
          collider.castShadow = false;
          collider.receiveShadow = false;

          // Add collider as a child of gltfGroup so it inherits the group's transform (scale/rotation/translation).
          // This ensures collider.matrixWorld lines up with the visual geometry.
          gltfGroup.add(collider);
          collider.updateMatrixWorld(true);

          // Optional helper
          const helper = new MeshBVHHelper(collider, 10);
          helper.visible = false;
          gltfGroup.add(helper);

          // Assign collider to physicsController (ensure setCollider is called after collider.matrixWorld valid)
          if (physicsController && typeof physicsController.setCollider === 'function') {
            physicsController.setCollider(collider);
            physicsController.worldBVH = mergedGeometry.boundsTree;
          } else {
            console.warn('physicsController missing setCollider — collider created but not assigned.');
          }

          // Compute spawn points (prefer named spawn nodes, otherwise transform rawSpawnPoints)
          const spawnPoints = collectSpawnPoints(gltfGroup, rawSpawnPoints);

          // Return processed group + spawnPoints + bounding box (so caller can set light extents)
          resolve({ gltfGroup, spawnPoints, worldBBox });
        } catch (err) {
          console.error(`${loaderLabel}: processing error`, err);
          reject(err);
        }
      },
      // progress
      evt => { if (evt.lengthComputable) onGLBProgress(evt); },
      err => { console.error(`${loaderLabel} load error:`, err); reject(err); }
    );
  });

  loaderUI.track(1.0, mapLoadPromise, cb => { onGLBProgress = cb; });
  const result = await mapLoadPromise;
  loaderUI.onComplete(() => {
    window.mapReady = true;
    console.log('🗺️ Map + BVH Collider fully ready!');
  });

  return result;
}

// Helpers to setup sunLight extents based on map bbox
function configureSunLightForBBox(scene, bbox) {
  const sunLight = new THREE.DirectionalLight(0xffffff, 1);
  // place above the bbox center
  const center = bbox.getCenter(new THREE.Vector3());
  const size = bbox.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.z);
  const distance = Math.max(50, maxDim * 1.5);
  sunLight.position.set(center.x + distance, center.y + distance, center.z + distance);
  sunLight.target.position.copy(center);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);

  // set shadow camera extents to encompass the bbox plus margin
  const margin = Math.max(size.x, size.z) * 0.6 + 10;
  sunLight.shadow.camera.left = -margin;
  sunLight.shadow.camera.right = margin;
  sunLight.shadow.camera.top = margin;
  sunLight.shadow.camera.bottom = -margin;
  sunLight.shadow.camera.near = 0.1;
  sunLight.shadow.camera.far = distance * 3;
  scene.add(sunLight, sunLight.target);
  return sunLight;
}

// Exported map creators (use loadAndPrepareGLB and configure light/shadows)
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

  const GLB_MODEL_URL = 'https://raw.githubusercontent.com/thearthd/3d-models/main/croccodilosconstruction.glb';
  const { gltfGroup, spawnPoints, worldBBox } = await loadAndPrepareGLB({
    scene, glbUrl: GLB_MODEL_URL, scale: SCALE, physicsController, loaderUI, loaderLabel: 'CrocodilosConstruction', rawSpawnPoints
  });

  // configure sun/light based on bbox
  configureSunLightForBBox(scene, worldBBox);

  // spawnPoints are already in world coords
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

  const GLB_MODEL_URL = 'https://raw.githubusercontent.com/thearthd/3d-models/main/sigmacityupdated.glb';
  const { gltfGroup, spawnPoints, worldBBox } = await loadAndPrepareGLB({
    scene, glbUrl: GLB_MODEL_URL, scale: SCALE, physicsController, loaderUI, loaderLabel: 'SigmaCity', rawSpawnPoints
  });

  configureSunLightForBBox(scene, worldBBox);
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

  const GLB_MODEL_URL = 'https://raw.githubusercontent.com/thearthd/3d-models/main/didddydunes.glb';
  const { gltfGroup, spawnPoints, worldBBox } = await loadAndPrepareGLB({
    scene, glbUrl: GLB_MODEL_URL, scale: SCALE, physicsController, loaderUI, loaderLabel: 'diddyDunes', rawSpawnPoints
  });

  configureSunLightForBBox(scene, worldBBox);
  return spawnPoints;
}

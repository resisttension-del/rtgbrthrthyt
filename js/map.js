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

// ─── BVH Setup ────────────────────────────────────────────────────────────
// Attach helpers to Three.js prototypes for three-mesh-bvh
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// ─── Configuration flags & defaults ───────────────────────────────────────
const MERGE_VISUALS = true; // set to false to keep original GLTF mesh graph for visuals
const BVH_OPTIONS = { maxLeafTris: 10, lazyGeneration: false }; // tune as needed
const SHADOW_MAP_SIZE = 1024; // lowered from 2048 to reduce GPU cost

// ─── Helper: build typed sequential indices if none present ────────────────
function generateSequentialIndices(vertexCount) {
    const use32 = vertexCount > 65535;
    const idx = use32 ? new Uint32Array(vertexCount) : new Uint16Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) idx[i] = i;
    return idx;
}

// ─── Helper: ensure geometry has index (typed) ────────────────────────────
function ensureIndexed(geometry) {
    if (!geometry || geometry.index) return;
    const count = geometry.attributes.position.count;
    geometry.setIndex(generateSequentialIndices(count));
    geometry.index.needsUpdate = true;
}

// ─── Helper: Merge visual meshes by material to reduce draw calls ────────
// This will remove original mesh nodes from gltfGroup and add merged meshes.
// Warning: If meshes are skinned/animated, do NOT merge them.
function mergeVisualMeshesByMaterial(gltfGroup) {
    const groups = new Map(); // materialUUID -> array of geometries
    const materialLookup = new Map(); // materialUUID -> material reference
    const toRemove = [];

    gltfGroup.traverse(child => {
        if (!child.isMesh) return;
        // don't merge skinned/animated or morph targets
        if (child.isSkinnedMesh || child.morphTargetInfluences) return;

        const material = child.material || new THREE.MeshStandardMaterial();
        const key = material.uuid;
        materialLookup.set(key, material);

        // clone geometry reference (we won't change original attributes directly),
        // but ensure it's indexed first.
        if (!child.geometry) return;
        ensureIndexed(child.geometry);

        // If geometry shares buffers with others, merging uses the same buffers;
        // that's usually OK for static geometry.
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(child.geometry);

        // mark child for removal once we replace visuals
        toRemove.push(child);
    });

    // If nothing to merge, return empty array
    if (groups.size === 0) return [];

    // Create merged meshes and add them to the gltfGroup root
    const mergedMeshes = [];
    for (const [matUUID, geometries] of groups.entries()) {
        // mergeBufferGeometries expects BufferGeometry instances
        const merged = BufferGeometryUtils.mergeBufferGeometries(geometries, true);
        if (!merged) continue;

        // ensure index exists
        ensureIndexed(merged);
        merged.computeBoundingBox();
        merged.computeBoundingSphere();

        const material = materialLookup.get(matUUID) || new THREE.MeshStandardMaterial();
        const mergedMesh = new THREE.Mesh(merged, material);

        // Copy important flags from one of the original geometries' meshes:
        // find a representative mesh to copy shadow settings (cheap approach)
        // Note: to get a representative, search the scene for a mesh using one of these geometries
        mergedMesh.castShadow = true;
        mergedMesh.receiveShadow = true;

        mergedMeshes.push(mergedMesh);
        gltfGroup.add(mergedMesh);
    }

    // Remove the original meshes we merged (they remain in GPU until disposed if you call .dispose())
    toRemove.forEach(m => {
        if (!m.parent) return;
        m.parent.remove(m);
        // NOTE: we do not dispose geometries/materials automatically here because
        // you might still want to keep them elsewhere. If you are certain, call dispose.
        // m.geometry.dispose();
        // if (m.material && m.material.dispose) m.material.dispose();
    });

    return mergedMeshes;
}

// ─── Lantern class (minor additions: ensure indexed geometry if needed) ───
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

                    // Ensure geometry is indexed for any downstream ops
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

// ─── Shared map loading utilities ─────────────────────────────────────────
async function loadAndPrepareGLB({
    scene,
    glbUrl,
    scale = 1,
    physicsController,
    loaderUI,
    loaderLabel = 'Loading Map...'
}) {
    let gltfGroup = null;
    let onGLBProgress = () => {};
    const mapLoadPromise = new Promise((resolve, reject) => {
        new GLTFLoader().load(
            glbUrl,
            gltf => {
                gltfGroup = gltf.scene;
                gltfGroup.scale.set(scale, scale, scale);
                gltfGroup.updateMatrixWorld(true);

                // Add visuals to the scene (we may merge later)
                scene.add(gltfGroup);

                // Collect env meshes and ensure indexing for BVH if needed
                window.envMeshes = window.envMeshes || [];
                gltfGroup.traverse(child => {
                    if (!child.isMesh) return;
                    child.castShadow = true;
                    child.receiveShadow = true;
                    if (child.material && child.material.map) {
                        // if texture exists, reduce anisotropy slightly
                        try {
                            if (child.material.map) child.material.map.anisotropy = 4;
                        } catch (e) { /* ignore if not supported */ }
                    }

                    // Ensure geometry has index for BVH
                    if (child.geometry && !child.geometry.index) {
                        child.geometry.setIndex(generateSequentialIndices(child.geometry.attributes.position.count));
                        child.geometry.index.needsUpdate = true;
                    }

                    // compute bounds for frustum culling correctness
                    if (child.geometry) {
                        if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
                        if (!child.geometry.boundingSphere) child.geometry.computeBoundingSphere();
                    }

                    window.envMeshes.push(child);
                });

                // Optionally merge visual meshes to reduce draw calls
                if (MERGE_VISUALS) {
                    try {
                        const merged = mergeVisualMeshesByMaterial(gltfGroup);
                        if (merged.length > 0) {
                            // compute bounds for merged meshes
                            merged.forEach(m => {
                                if (m.geometry) {
                                    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
                                    if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
                                }
                            });
                            console.log(`Merged ${merged.length} visual mesh groups to reduce draw calls.`);
                        }
                    } catch (e) {
                        console.warn('Visual merge failed (continuing with original meshes):', e);
                    }
                }

                // --- Build a merged geometry for collisions using StaticGeometryGenerator ---
                try {
                    const staticGenerator = new StaticGeometryGenerator(gltfGroup);
                    staticGenerator.attributes = ['position']; // only position needed for collisions
                    const mergedGeometry = staticGenerator.generate();

                    // ensure index exists on merged geometry
                    ensureIndexed(mergedGeometry);

                    // compute BVH on merged geometry using the proto helper (recommended)
                    mergedGeometry.computeBoundsTree(BVH_OPTIONS);

                    // create collider mesh (invisible) and add to scene
                    const collider = new THREE.Mesh(
                        mergedGeometry,
                        new THREE.MeshBasicMaterial({ wireframe: true, transparent: true, opacity: 0.5 })
                    );
                    collider.visible = false;
                    // Optional: don't cast/receive shadows for collider
                    collider.castShadow = false;
                    collider.receiveShadow = false;
                    scene.add(collider);

                    // Optional visual helper (hidden by default)
                    const helper = new MeshBVHHelper(collider, 10);
                    helper.visible = false;
                    scene.add(helper);

                    // hand collider to physics controller
                    if (physicsController && typeof physicsController.setCollider === 'function') {
                        physicsController.setCollider(collider);
                        physicsController.worldBVH = collider.geometry.boundsTree;
                    } else {
                        console.warn('physicsController missing setCollider - collider created but not assigned.');
                    }

                    console.log('✔️ GLB loaded and BVH collider built.');
                } catch (e) {
                    console.error('Failed to generate BVH collider:', e);
                }

                resolve(gltfGroup);
            },
            // progress
            evt => {
                if (evt.lengthComputable) onGLBProgress(evt);
            },
            err => {
                console.error(`${loaderLabel} load error:`, err);
                reject(err);
            }
        );
    });

    // hook map loader UI tracking
    loaderUI.track(1.0, mapLoadPromise, cb => {
        onGLBProgress = cb;
    });

    await mapLoadPromise;
    loaderUI.onComplete(() => {
        window.mapReady = true;
        console.log('🗺️ Map + BVH Collider fully ready!');
    });

    return gltfGroup;
}

// ─── Map creators ────────────────────────────────────────────────────────
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

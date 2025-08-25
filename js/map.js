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

// ─── BVH Setup ──────f──────────────────────────────────────────────────────
// Attach BVH helpers (must run before any computeBoundsTree calls)
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// ─── Helper: build typed sequential indices if none present ─────────────────
function generateSequentialIndices(vertexCount) {
    // prefer Uint16 unless we need 32-bit
    const use32 = vertexCount > 65535;
    const idx = use32 ? new Uint32Array(vertexCount) : new Uint16Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) idx[i] = i;
    return idx;
}
function ensureIndexed(geometry) {
    if (!geometry || geometry.index) return;
    geometry.setIndex(generateSequentialIndices(geometry.attributes.position.count));
    geometry.index.needsUpdate = true;
}

// ─── Safe BVH builder (prefer prototype helper, fallback to constructor) ──
function safeBuildBVH(geometry, options = {}) {
    ensureIndexed(geometry);
    if (typeof geometry.computeBoundsTree === 'function') {
        geometry.computeBoundsTree(options);
        return geometry.boundsTree;
    } else {
        // fallback
        geometry.boundsTree = new MeshBVH(geometry, options);
        return geometry.boundsTree;
    }
}

// ─── Lantern class (unchanged aside from ensuring indices) ────────────────
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

// --- helper: configure sunlight bounds from a bbox
function configureSunLight(scene, bbox, shadowMapSize = 1024) {
    const sunLight = new THREE.DirectionalLight(0xffffff, 1);
    const center = bbox.getCenter(new THREE.Vector3());
    const size = bbox.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.z);
    const distance = Math.max(50, maxDim * 1.5);

    sunLight.position.set(center.x + distance, center.y + distance, center.z + distance);
    sunLight.target.position.copy(center);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(shadowMapSize, shadowMapSize);

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

// --- Shared loader logic (keeps shape of your original functions) ----------
async function loadGLBAndPrepare(scene, physicsController, GLB_MODEL_URL, SCALE, loaderUI, rawSpawnPoints = []) {
    window.envMeshes = [];
    window.mapReady = false;

    let gltfGroup = null;
    let onGLBProgress = () => {};

    const mapLoadPromise = new Promise((resolve, reject) => {
        new GLTFLoader().load(
            GLB_MODEL_URL,
            gltf => {
                try {
                    gltfGroup = gltf.scene;
                    gltfGroup.scale.set(SCALE, SCALE, SCALE);
                    gltfGroup.updateMatrixWorld(true);

                    // add visuals
                    scene.add(gltfGroup);

                    // per-mesh prep: shadows, anisotropy, indices, bounds
                    gltfGroup.traverse(child => {
                        if (!child.isMesh) return;
                        child.castShadow = true;
                        child.receiveShadow = true;
                        if (child.material && child.material.map) {
                            try { child.material.map.anisotropy = 4; } catch (e) {}
                        }
                        if (child.geometry && !child.geometry.index) {
                            child.geometry.setIndex(generateSequentialIndices(child.geometry.attributes.position.count));
                        }
                        if (child.geometry) {
                            if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
                            if (!child.geometry.boundingSphere) child.geometry.computeBoundingSphere();
                        }
                        window.envMeshes.push(child);
                    });

                    // Build merged geometry for collisions using StaticGeometryGenerator
                    const staticGenerator = new StaticGeometryGenerator(gltfGroup);
                    staticGenerator.attributes = ['position']; // only position needed for collision
                    const mergedGeometry = staticGenerator.generate();

                    if (!mergedGeometry) {
                        throw new Error('StaticGeometryGenerator returned null/undefined geometry.');
                    }

                    // transform merged geometry into the gltfGroup's local space so collider lines up with visuals
                    const invWorld = new THREE.Matrix4().copy(gltfGroup.matrixWorld).invert();
                    mergedGeometry.applyMatrix4(invWorld);

                    // ensure index and build BVH robustly
                    ensureIndexed(mergedGeometry);
                    try {
                        safeBuildBVH(mergedGeometry, { maxLeafTris: 10, lazyGeneration: false });
                    } catch (bvhErr) {
                        console.error('Failed to generate BVH for merged geometry:', bvhErr);
                        throw bvhErr;
                    }

                    // create collider and add as child of gltfGroup (so transforms match)
                    const collider = new THREE.Mesh(mergedGeometry, new THREE.MeshBasicMaterial());
                    collider.material.wireframe = true;
                    collider.material.opacity = 0.5;
                    collider.material.transparent = true;
                    collider.visible = false;
                    collider.castShadow = false;
                    collider.receiveShadow = false;

                    // add collider to group (important: not scene directly)
                    gltfGroup.add(collider);
                    // ensure world transforms are updated before handing to physics controller
                    collider.updateMatrixWorld(true);

                    // optional visualizer (hidden)
                    const visualizer = new MeshBVHHelper(collider, 10);
                    visualizer.visible = false;
                    gltfGroup.add(visualizer);

                    // hand to physics controller
                    if (physicsController && typeof physicsController.setCollider === 'function') {
                        physicsController.setCollider(collider);
                        physicsController.worldBVH = mergedGeometry.boundsTree;
                    } else {
                        console.warn('physicsController missing setCollider - collider created but not assigned.');
                    }

                    // compute spawnPoints:
                    // prefer named nodes starting with "spawn" if present
                    const foundSpawns = [];
                    gltfGroup.traverse(node => {
                        if (!node.isObject3D) return;
                        const n = (node.name || '').toLowerCase();
                        if (n.startsWith('spawn')) {
                            node.updateMatrixWorld(true);
                            foundSpawns.push(new THREE.Vector3().setFromMatrixPosition(node.matrixWorld));
                        }
                    });
                    let spawnPoints;
                    if (foundSpawns.length) {
                        spawnPoints = foundSpawns;
                    } else {
                        // transform raw spawn templates by group world matrix
                        const world = gltfGroup.matrixWorld.clone();
                        spawnPoints = rawSpawnPoints.map(p => p.clone().applyMatrix4(world));
                    }

                    // compute world bbox for light setup
                    const worldBBox = new THREE.Box3().setFromObject(gltfGroup);

                    console.log('✔️ GLB mesh loaded and BVH collider built.');
                    resolve({ gltfGroup, spawnPoints, worldBBox });
                } catch (err) {
                    console.error('Error processing GLTF:', err);
                    reject(err);
                }
            },
            evt => { if (evt.lengthComputable) onGLBProgress(evt); },
            err => {
                console.error('Error loading GLB:', err);
                reject(err);
            }
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

// ─── Map creators (minimal changes to original signatures) ──────────────

export async function createCrocodilosConstruction(scene, physicsController) {
    window.envMeshes = [];
    window.mapReady = false;

    const loaderUI = new Loader();
    const mapLoadPercentages = [1.0];
    loaderUI.show('Loading CrocodilosConstruction Map...', mapLoadPercentages);

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

    const { gltfGroup, spawnPoints, worldBBox } = await loadGLBAndPrepare(scene, physicsController, GLB_MODEL_URL, SCALE, loaderUI, rawSpawnPoints);

    // configure sunlight using world bbox for correct extents
    configureSunLight(scene, worldBBox, 1024);

    return spawnPoints;
}

export async function createSigmaCity(scene, physicsController) {
    window.envMeshes = [];
    window.mapReady = false;

    const loaderUI = new Loader();
    const mapLoadPercentages = [1.0];
    loaderUI.show('Loading SigmaCity Map...', mapLoadPercentages);

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

    const { gltfGroup, spawnPoints, worldBBox } = await loadGLBAndPrepare(scene, physicsController, GLB_MODEL_URL, SCALE, loaderUI, rawSpawnPoints);

    configureSunLight(scene, worldBBox, 1024);

    return spawnPoints;
}

export async function createDiddyDunes(scene, physicsController) {
    window.envMeshes = [];
    window.mapReady = false;

    const loaderUI = new Loader();
    const mapLoadPercentages = [1.0];
    loaderUI.show('Loading diddyDunes Map...', mapLoadPercentages);

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

    const { gltfGroup, spawnPoints, worldBBox } = await loadGLBAndPrepare(scene, physicsController, GLB_MODEL_URL, SCALE, loaderUI, rawSpawnPoints);

    configureSunLight(scene, worldBBox, 1024);

    return spawnPoints;
}

import { Loader } from './Loader.js';
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
    computeBoundsTree,
    disposeBoundsTree,
    acceleratedRaycast,
    MeshBVH, // <--- Added MeshBVH import
    MeshBVHHelper,
    StaticGeometryGenerator
} from 'https://cdn.jsdelivr.net/npm/three-mesh-bvh@0.9.1/+esm';

// ─── BVH Setup ────────────────────────────────────────────────────────────
// Extend THREE.BufferGeometry and THREE.Mesh prototypes for BVH functionality
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;


// ─── Helper: build sequential indices if none present ────────────────────────
// This function ensures that geometries have an index buffer, which is often
// required for BVH computations and other Three.js operations.
function generateSequentialIndices(vertexCount) {
    const idx = [];
    for (let i = 0; i < vertexCount; i++) idx.push(i);
    return idx;
}

// ─── Lantern class ─────────────────────────────────────────────────────────
// This class handles loading and placing a 3D lantern model with an associated spotlight.
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
                // Scale and position the lantern model
                lanternGroup.scale.set(scale, scale, scale);
                lanternGroup.updateMatrixWorld(true);
                const box = new THREE.Box3().setFromObject(lanternGroup);
                lanternGroup.position.y = -box.min.y;

                // Apply material and shadow properties to all meshes in the lantern group
                lanternGroup.traverse(child => {
                    if (!child.isMesh) return;
                    child.material = new THREE.MeshStandardMaterial({
                        color: 0xffffff,
                        roughness: 0.8,
                        metalness: 0.7,
                        side: THREE.DoubleSide
                    });
                    child.castShadow = child.receiveShadow = true;
                });

                this.container.add(lanternGroup);

                // Configure and add a spotlight to the lantern
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
            null, // Progress callback (not used here, but kept for signature)
            err => console.error('Error loading lantern model:', err)
        );
    }
}

/**
 * Loads the CrocodilosConstruction map, sets up lighting, and creates a MeshBVH collider.
 * @param {THREE.Scene} scene The Three.js scene to add the map to.
 * @param {object} physicsController An object with a `setCollider` method to receive the collision mesh.
 * @returns {Promise<THREE.Vector3[]>} A promise that resolves with an array of spawn points.
 */
export async function createCrocodilosConstruction(scene, physicsController) {
    // Track loaded meshes and readiness status
    window.envMeshes = [];
    window.mapReady = false;

    // Initialize loader UI with a single milestone for GLB loading
    const loaderUI = new Loader();
    const mapLoadPercentages = [1.0]; // GLB loading is 100% of the map load
    loaderUI.show('Loading CrocodilosConstruction Map...', mapLoadPercentages);

    // Define scaling and initial spawn points for the map
    const SCALE = 2;
    const rawSpawnPoints = [
        new THREE.Vector3(0, 7, 0),
     //  new THREE.Vector3(-14, 7, -36), // 1
      //  new THREE.Vector3(-2, 2, 37), // 2
     //  new THREE.Vector3(0, 2, 0), // 3
      //  new THREE.Vector3(2, 7, 34), // 4
      //  new THREE.Vector3(-5, 2, -38), // 5
     //   new THREE.Vector3(-18, 2, 12), // 6
    //    new THREE.Vector3(11, 2, 23), // 7
     //   new THREE.Vector3(-7, 7, -1), // 8
    ];
    const spawnPoints = rawSpawnPoints.map(p => p.clone().multiplyScalar(SCALE / 5));

    // Set up sunlight and shadows for the scene
    const sunLight = new THREE.DirectionalLight(0xffffff, 1);
    sunLight.position.set(50, 100, 50);
    sunLight.target.position.set(0, 0, 0);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048, 2048);
    const d = 100;
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    sunLight.shadow.camera.near = 0.1;
    sunLight.shadow.camera.far = 200;
    scene.add(sunLight, sunLight.target);

    // URL of the GLB model for the map
  //  const GLB_MODEL_URL = 'https://raw.githubusercontent.com/thearthd/3d-models/main/Map/voidffa_temp_map.glb';
const GLB_MODEL_URL = 'https://raw.githubusercontent.com/thearthd/3d-models/main/Map/croccodilosconstruction.glb';
    // 1) Load the GLB model into the scene and process it for collision detection
    let gltfGroup = null;
    let onGLBProgress = () => {};
    const mapLoadPromise = new Promise((resolve, reject) => {
        new GLTFLoader().load(
            GLB_MODEL_URL,
            gltf => {
                gltfGroup = gltf.scene;
                gltfGroup.scale.set(SCALE, SCALE, SCALE);
                gltfGroup.updateMatrixWorld(true); // Crucial for correct vertex transformation

                // Add the visual GLTF group to the scene
                scene.add(gltfGroup);

                // Enable shadows and anisotropy on all meshes in the GLTF group
                gltfGroup.traverse(child => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;
                        if (child.material.map) {
                            child.material.map.anisotropy = 4;
                        }
                        // Mark for CPU renderer: static environment mesh
                        child.userData = child.userData || {};
                        child.userData.cpuStatic = true;
                        child.userData.cpuRenderable = true;

                        window.envMeshes.push(child); // Store reference to environment meshes
                        // Ensure geometries have indices for BVH computation if missing
                        if (child.geometry && !child.geometry.index) {
                            child.geometry.setIndex(generateSequentialIndices(child.geometry.attributes.position.count));
                        }
                    }
                });

                // --- MeshBVH Collider Setup ---
                // Create a StaticGeometryGenerator from the loaded GLTF scene to merge geometries
                const staticGenerator = new StaticGeometryGenerator(gltfGroup);
                staticGenerator.attributes = ['position']; // Only position is needed for collision

                // Generate the merged geometry from the static generator
                const mergedGeometry = staticGenerator.generate();

                // Compute the BVH on the merged geometry using the MeshBVH constructor directly
                mergedGeometry.boundsTree = new MeshBVH(mergedGeometry); // <--- Changed here

                // Create the collider mesh using the merged geometry and a basic material
                const collider = new THREE.Mesh(mergedGeometry, new THREE.MeshBasicMaterial());
                collider.material.wireframe = true; // For visualization during development
                collider.material.opacity = 0.5;
                collider.material.transparent = true;
                collider.visible = false; // Hide the collider by default in production

                // Add the collider to the scene
                scene.add(collider);

                // Optional: Add MeshBVHHelper for visual debugging of the BVH structure
                const visualizer = new MeshBVHHelper(collider, 10); // 10 is an example depth
                visualizer.visible = false; // Hide by default
                scene.add(visualizer);

                // Pass the created collider mesh to the physics controller
                // Assumes physicsController has a method like setCollider(mesh)
                physicsController.setCollider(collider);
                physicsController.worldBVH = collider.geometry.boundsTree;
                console.log('✔️ GLB mesh loaded and BVH collider built.');
                resolve(gltfGroup); // Resolve the promise once loading and BVH setup are complete
            },
            // Progress callback for GLB loading
            evt => {
                if (evt.lengthComputable) onGLBProgress(evt);
            },
            err => {
                console.error('❌ Error loading CrocodilosConstruction GLB:', err);
                reject(err);
            }
        );
    });

    // Track GLB load progress with the loader UI
    loaderUI.track(mapLoadPercentages[0], mapLoadPromise, cb => {
        onGLBProgress = cb;
    });

    // Wait for the map loading to complete
    await mapLoadPromise;

    // NEW: If a CPU renderer with a scan/upload API exists, upload the scene meshes now.
    if (window.renderer && typeof window.renderer.scanAndUploadScene === 'function') {
        try {
            await window.renderer.scanAndUploadScene(scene);
            console.log('✔️ Scene scanned and uploaded to CPU renderer.');
        } catch (e) {
            console.warn('⚠️ renderer.scanAndUploadScene failed:', e);
        }
    }

    // When fully done, update readiness status and hide loader UI
    loaderUI.onComplete(() => {
        window.mapReady = true;
        console.log('🗺️ Map + BVH Collider fully ready!');
    });

    return spawnPoints;
}

/**
 * Loads the SigmaCity map, sets up lighting, and creates a MeshBVH collider.
 * @param {THREE.Scene} scene The Three.js scene to add the map to.
 * @param {object} physicsController An object with a `setCollider` method to receive the collision mesh.
 * @returns {Promise<THREE.Vector3[]>} A promise that resolves with an array of spawn points.
 */
export async function createSigmaCity(scene, physicsController) {
    // Track loaded meshes and readiness status
    window.envMeshes = [];
    window.mapReady = false;

    // Initialize loader UI with a single milestone for GLB loading
    const loaderUI = new Loader();
    const mapLoadPercentages = [1.0]; // GLB loading is 100% of the map load
    loaderUI.show('Loading SigmaCity Map...', mapLoadPercentages);

    // Define scaling and initial spawn points for the map
    const SCALE = 2;
    const rawSpawnPoints = [
        new THREE.Vector3(-1, 3, -4), // 1
        new THREE.Vector3(-55, -1, -6), // 2
        new THREE.Vector3(13, 5, 47), // 3
        new THREE.Vector3(1, 5, -66), // 4
        new THREE.Vector3(21, 5, -45), // 5
        new THREE.Vector3(0, 10, 22), // 6
        new THREE.Vector3(43, 1, -35), // 7
        new THREE.Vector3(24, 3, -14), // 8
    ];
    const spawnPoints = rawSpawnPoints.map(p => p.clone().multiplyScalar(SCALE / 2));

    // Set up sunlight and shadows for the scene
    const sunLight = new THREE.DirectionalLight(0xffffff, 1);
    sunLight.position.set(50, 100, 50);
    sunLight.target.position.set(0, 0, 0);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048, 2048);
    const d = 100;
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    sunLight.shadow.camera.near = 0.1;
    sunLight.shadow.camera.far = 200;
    scene.add(sunLight, sunLight.target);

    // URL of the GLB model for the map
    const GLB_MODEL_URL = 'https://raw.githubusercontent.com/thearthd/3d-models/main/sigmacityupdated.glb';

    // 1) Load the GLB model into the scene and process it for collision detection
    let gltfGroup = null;
    let onGLBProgress = () => {};
    const mapLoadPromise = new Promise((resolve, reject) => {
        new GLTFLoader().load(
            GLB_MODEL_URL,
            gltf => {
                gltfGroup = gltf.scene;
                gltfGroup.scale.set(SCALE, SCALE, SCALE);
                gltfGroup.updateMatrixWorld(true); // Crucial for correct vertex transformation

                // Add the visual GLTF group to the scene
                scene.add(gltfGroup);

                // Enable shadows and anisotropy on all meshes in the GLTF group
                gltfGroup.traverse(child => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;
                        if (child.material.map) {
                            child.material.map.anisotropy = 4;
                        }
                        // Mark for CPU renderer: static environment mesh
                        child.userData = child.userData || {};
                        child.userData.cpuStatic = true;
                        child.userData.cpuRenderable = true;

                        window.envMeshes.push(child); // Store reference to environment meshes
                        // Ensure geometries have indices for BVH computation if missing
                        if (child.geometry && !child.geometry.index) {
                            child.geometry.setIndex(generateSequentialIndices(child.geometry.attributes.position.count));
                        }
                    }
                });

                // --- MeshBVH Collider Setup ---
                // Create a StaticGeometryGenerator from the loaded GLTF scene to merge geometries
                const staticGenerator = new StaticGeometryGenerator(gltfGroup);
                staticGenerator.attributes = ['position']; // Only position is needed for collision

                // Generate the merged geometry from the static generator
                const mergedGeometry = staticGenerator.generate();

                // Compute the BVH on the merged geometry using the MeshBVH constructor directly
                mergedGeometry.boundsTree = new MeshBVH(mergedGeometry); // <--- Changed here

                // Create the collider mesh using the merged geometry and a basic material
                const collider = new THREE.Mesh(mergedGeometry, new THREE.MeshBasicMaterial());
                collider.material.wireframe = true; // For visualization during development
                collider.material.opacity = 0.5;
                collider.material.transparent = true;
                collider.visible = false; // Hide the collider by default in production

                // Add the collider to the scene
                scene.add(collider);

                // Optional: Add MeshBVHHelper for visual debugging of the BVH structure
                const visualizer = new MeshBVHHelper(collider, 10); // 10 is an example depth
                visualizer.visible = false; // Hide by default
                scene.add(visualizer);

                // Pass the created collider mesh to the physics controller
                // Assumes physicsController has a method like setCollider(mesh)
                physicsController.setCollider(collider);
                physicsController.worldBVH = collider.geometry.boundsTree;
                console.log('✔️ GLB mesh loaded and BVH collider built.');
                resolve(gltfGroup); // Resolve the promise once loading and BVH setup are complete
            },
            // Progress callback for GLB loading
            evt => {
                if (evt.lengthComputable) onGLBProgress(evt);
            },
            err => {
                console.error('❌ Error loading SigmaCity GLB:', err);
                reject(err);
            }
        );
    });

    // Track GLB load progress with the loader UI
    loaderUI.track(mapLoadPercentages[0], mapLoadPromise, cb => {
        onGLBProgress = cb;
    });

    // Wait for the map loading to complete
    await mapLoadPromise;

    // NEW: If a CPU renderer with a scan/upload API exists, upload the scene meshes now.
    if (window.renderer && typeof window.renderer.scanAndUploadScene === 'function') {
        try {
            await window.renderer.scanAndUploadScene(scene);
            console.log('✔️ Scene scanned and uploaded to CPU renderer.');
        } catch (e) {
            console.warn('⚠️ renderer.scanAndUploadScene failed:', e);
        }
    }

    // When fully done, update readiness status and hide loader UI
    loaderUI.onComplete(() => {
        window.mapReady = true;
        console.log('🗺️ Map + BVH Collider fully ready!');
    });

    return spawnPoints;
}

export async function createDiddyDunes(scene, physicsController) {
    // Track loaded meshes and readiness status
    window.envMeshes = [];
    window.mapReady = false;

    // Initialize loader UI with a single milestone for GLB loading
    const loaderUI = new Loader();
    const mapLoadPercentages = [1.0]; // GLB loading is 100% of the map load
    loaderUI.show('Loading diddyDunes Map...', mapLoadPercentages);

    // Define scaling and initial spawn points for the map
    const SCALE = 2;
    const rawSpawnPoints = [
        new THREE.Vector3(34, 3, 0), // 1
        new THREE.Vector3(62, 1, -37), // 2
        new THREE.Vector3(26, 3, -30), // 3
        new THREE.Vector3(-27, 3, -74), // 4
        new THREE.Vector3(12, 3, -20), // 5
        new THREE.Vector3(-58, 8, 2), // 6
        new THREE.Vector3(55, 1, -55), // 7
        new THREE.Vector3(-20, 8, -13), // 8
    ];
    const spawnPoints = rawSpawnPoints.map(p => p.clone().multiplyScalar(SCALE / 2));

    // Set up sunlight and shadows for the scene
    const sunLight = new THREE.DirectionalLight(0xffffff, 1);
    sunLight.position.set(50, 100, 50);
    sunLight.target.position.set(0, 0, 0);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048, 2048);
    const d = 100;
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    sunLight.shadow.camera.near = 0.1;
    sunLight.shadow.camera.far = 200;
    scene.add(sunLight, sunLight.target);

    // URL of the GLB model for the map
    const GLB_MODEL_URL = 'https://raw.githubusercontent.com/thearthd/3d-models/main/didddydunes.glb';

    // 1) Load the GLB model into the scene and process it for collision detection
    let gltfGroup = null;
    let onGLBProgress = () => {};
    const mapLoadPromise = new Promise((resolve, reject) => {
        new GLTFLoader().load(
            GLB_MODEL_URL,
            gltf => {
                gltfGroup = gltf.scene;
                gltfGroup.scale.set(SCALE, SCALE, SCALE);
                gltfGroup.updateMatrixWorld(true); // Crucial for correct vertex transformation

                // Add the visual GLTF group to the scene
                scene.add(gltfGroup);

                // Enable shadows and anisotropy on all meshes in the GLTF group
                gltfGroup.traverse(child => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;
                        if (child.material.map) {
                            child.material.map.anisotropy = 4;
                        }
                        // Mark for CPU renderer: static environment mesh
                        child.userData = child.userData || {};
                        child.userData.cpuStatic = true;
                        child.userData.cpuRenderable = true;

                        window.envMeshes.push(child); // Store reference to environment meshes
                        // Ensure geometries have indices for BVH computation if missing
                        if (child.geometry && !child.geometry.index) {
                            child.geometry.setIndex(generateSequentialIndices(child.geometry.attributes.position.count));
                        }
                    }
                });

                // --- MeshBVH Collider Setup ---
                // Create a StaticGeometryGenerator from the loaded GLTF scene to merge geometries
                const staticGenerator = new StaticGeometryGenerator(gltfGroup);
                staticGenerator.attributes = ['position']; // Only position is needed for collision

                // Generate the merged geometry from the static generator
                const mergedGeometry = staticGenerator.generate();

                // Compute the BVH on the merged geometry using the MeshBVH constructor directly
                mergedGeometry.boundsTree = new MeshBVH(mergedGeometry); // <--- Changed here

                // Create the collider mesh using the merged geometry and a basic material
                const collider = new THREE.Mesh(mergedGeometry, new THREE.MeshBasicMaterial());
                collider.material.wireframe = true; // For visualization during development
                collider.material.opacity = 0.5;
                collider.material.transparent = true;
                collider.visible = false; // Hide the collider by default in production

                // Add the collider to the scene
                scene.add(collider);

                // Optional: Add MeshBVHHelper for visual debugging of the BVH structure
                const visualizer = new MeshBVHHelper(collider, 10); // 10 is an example depth
                visualizer.visible = false; // Hide by default
                scene.add(visualizer);

                // Pass the created collider mesh to the physics controller
                // Assumes physicsController has a method like setCollider(mesh)
                physicsController.setCollider(collider);
                physicsController.worldBVH = collider.geometry.boundsTree;
                console.log('✔️ GLB mesh loaded and BVH collider built.');
                resolve(gltfGroup); // Resolve the promise once loading and BVH setup are complete
            },
            // Progress callback for GLB loading
            evt => {
                if (evt.lengthComputable) onGLBProgress(evt);
            },
            err => {
                console.error('❌ Error loading diddyDunes GLB:', err);
                reject(err);
            }
        );
    });

    // Track GLB load progress with the loader UI
    loaderUI.track(mapLoadPercentages[0], mapLoadPromise, cb => {
        onGLBProgress = cb;
    });

    // Wait for the map loading to complete
    await mapLoadPromise;

    // NEW: If a CPU renderer with a scan/upload API exists, upload the scene meshes now.
    if (window.renderer && typeof window.renderer.scanAndUploadScene === 'function') {
        try {
            await window.renderer.scanAndUploadScene(scene);
            console.log('✔️ Scene scanned and uploaded to CPU renderer.');
        } catch (e) {
            console.warn('⚠️ renderer.scanAndUploadScene failed:', e);
        }
    }

    // When fully done, update readiness status and hide loader UI
    loaderUI.onComplete(() => {
        window.mapReady = true;
        console.log('🗺️ Map + BVH Collider fully ready!');
    });

    return spawnPoints;
}

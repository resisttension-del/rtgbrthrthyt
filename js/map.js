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
// Replace your existing createCrocodilosConstruction with this function.
export async function createCrocodilosConstruction(targetScene, physicsController) {
  // Detect environment
  const isThreeScene = targetScene && typeof targetScene.add === "function";
  const pcApp = window.playcanvasApp || null;
  const isPlayCanvasRoot = !!pcApp && (targetScene === pcApp.root || targetScene === window.playcanvasApp?.root);

  // Track loaded meshes and readiness
  window.envMeshes = [];
  window.mapReady = false;

  // Loader UI
  const loaderUI = new Loader();
  // We'll have two steps (1) GLB for Three (BVH) (2) GLB for PlayCanvas visuals (optional)
  const stepWeights = isPlayCanvasRoot ? [0.5, 0.5] : [1.0];
  loaderUI.show("Loading CrocodilosConstruction Map...", stepWeights);

  // Spawn points converted to simple objects for portability
  const SCALE = 1;
  const rawSpawnPoints = [
    new THREE.Vector3(0, 50, 0)
    // add more spawn vectors if you want
  ];
  const spawnPoints = rawSpawnPoints.map(p => {
    const scaled = p.clone().multiplyScalar(SCALE / 5);
    return { x: scaled.x, y: scaled.y, z: scaled.z };
  });

  const GLB_MODEL_URL = "https://raw.githubusercontent.com/thearthd/3d-models/main/newmaptest.glb";

  // Promise A: load GLB with THREE.GLTFLoader -> build BVH collider and collect env meshes.
  const threeLoadPromise = new Promise((resolve, reject) => {
    if (typeof THREE === "undefined" || typeof GLTFLoader === "undefined") {
      const err = new Error("Three.js or GLTFLoader not available in this environment.");
      console.error(err);
      return reject(err);
    }

    const loader = new GLTFLoader();
    let onProgress = () => {};
    loader.load(
      GLB_MODEL_URL,
      gltf => {
        try {
          const gltfGroup = gltf.scene;
          gltfGroup.scale.set(SCALE, SCALE, SCALE);
          gltfGroup.updateMatrixWorld(true);

          // If a Three scene was passed, add the visual group to it so Three rendering (if any) still works
          if (isThreeScene) {
            targetScene.add(gltfGroup);
          } else {
            // Keep a ref for debugging / CPU upload
            window.__threeMapGroup = gltfGroup;
          }

          // Collect meshes and ensure geometry indices exist
          gltfGroup.traverse(child => {
            if (child.isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;
              if (child.material && child.material.map) {
                try { child.material.map.anisotropy = 4; } catch (e) {}
              }
              child.userData = child.userData || {};
              child.userData.cpuStatic = true;
              child.userData.cpuRenderable = true;

              window.envMeshes.push(child);

              // Ensure geometry index exists for BVH
              if (child.geometry && !child.geometry.index) {
                child.geometry.setIndex(generateSequentialIndices(child.geometry.attributes.position.count));
              }
            }
          });

          // Build merged geometry via your StaticGeometryGenerator (same as original)
          const staticGenerator = new StaticGeometryGenerator(gltfGroup);
          staticGenerator.attributes = ["position"];
          const mergedGeometry = staticGenerator.generate();

          // Build BVH
          mergedGeometry.boundsTree = new MeshBVH(mergedGeometry);

          // Create collider mesh (THREE.Mesh) - physics uses this
          const collider = new THREE.Mesh(mergedGeometry, new THREE.MeshBasicMaterial());
          collider.material.wireframe = true;
          collider.material.opacity = 0.5;
          collider.material.transparent = true;
          collider.visible = false;

          // If Three scene present, add collider / visualizer there for debugging
          if (isThreeScene) {
            targetScene.add(collider);
            const visualizer = new MeshBVHHelper(collider, 10);
            visualizer.visible = false;
            targetScene.add(visualizer);
          } else {
            window.__threeCollider = collider;
          }

          // Attach collider to physics controller
          if (physicsController && typeof physicsController.setCollider === "function") {
            physicsController.setCollider(collider);
            physicsController.worldBVH = collider.geometry.boundsTree;
          } else {
            console.warn("physicsController.setCollider not available; collider built but not attached.");
          }

          console.log("Three: GLB loaded and BVH collider built.");
          resolve({ gltfGroup, collider, onProgressSetter: cb => (onProgress = cb) });
        } catch (err) {
          console.error("Error during GLTF (Three) processing:", err);
          reject(err);
        }
      },
      // progress
      evt => {
        // Map progress to first step weight (index 0)
        // We'll let loaderUI.track handle callbacks; expose setter in resolved object
        // For now if loaderUI provided a callback system we can call it later if needed
      },
      err => {
        console.error("Error loading GLB for BVH:", err);
        reject(err);
      }
    );
  });

  // Promise B (optional): if PlayCanvas is running, also load GLB into PlayCanvas as a container asset
  let pcLoadPromise = Promise.resolve(null);
  if (isPlayCanvasRoot) {
    pcLoadPromise = new Promise((resolve, reject) => {
      // ensure app available
      if (!pcApp || !pcApp.assets || typeof pcApp.assets.loadFromUrl !== "function") {
        console.warn("PlayCanvas app or asset loader not available; skipping PlayCanvas visual import.");
        return resolve(null);
      }

      // progress helper
      let lastPercent = 0;
      // create an asset and load as 'container'
      pcApp.assets.loadFromUrl(GLB_MODEL_URL, "container", (err, asset) => {
        if (err) {
          console.error("PlayCanvas: failed to load GLB container:", err);
          return reject(err);
        }
        try {
          // instantiate model entity (retains hierarchy, materials, animations)
          // prefer instantiateModelEntity if available for animated skinned models, otherwise instantiateRenderEntity
          let entity = null;
          if (asset.resource && typeof asset.resource.instantiateModelEntity === "function") {
            entity = asset.resource.instantiateModelEntity({ castShadows: true, receiveShadows: true });
          } else if (asset.resource && typeof asset.resource.instantiateRenderEntity === "function") {
            entity = asset.resource.instantiateRenderEntity({ castShadows: true, receiveShadows: true });
          } else {
            // fallback: use generic container instantiate (older/newer engine differences)
            if (asset.resource && typeof asset.resource.instantiate === "function") {
              entity = asset.resource.instantiate();
            } else {
              throw new Error("PlayCanvas container resource has no instantiate helper.");
            }
          }

          // scale & position as your Three group expects
          try {
            entity.setLocalScale(SCALE, SCALE, SCALE);
            entity.setLocalPosition(0, 0, 0);
          } catch (e) {
            // if entity API differs, ignore and continue
          }

          // Add to PlayCanvas root so it renders
          pcApp.root.addChild(entity);
          entity.name = entity.name || "CrocodilosConstructionMap";

          // If animations exist, expose them in case you want to drive them
          const animComp = entity.anim;
          if (animComp) {
            // user can start animations via animComp.play(...)
            console.log("PlayCanvas map entity has animations available.");
          }

          console.log("PlayCanvas: GLB imported and instantiated into scene.");
          resolve(entity);
        } catch (err) {
          console.error("PlayCanvas instantiate error:", err);
          reject(err);
        }
      }, null, (xhr) => {
        // Optional progress callback from loadFromUrl (not always available in older engine)
        // Map to step index 1 for loaderUI if present
        if (xhr && xhr.loaded && xhr.total) {
          const percent = Math.min(1, xhr.loaded / xhr.total);
          if (loaderUI && typeof loaderUI.track === "function") {
            // We will call loaderUI.track later with promises; for now just log
          }
          lastPercent = percent;
        }
      });
    });
  }

  // Wire loaderUI tracking:
  // If loaderUI.track expects individual promises per step, pass them accordingly.
  try {
    if (isPlayCanvasRoot) {
      // First half -> threeLoadPromise, second half -> pcLoadPromise
      loaderUI.track(stepWeights[0], threeLoadPromise, cb => {
        // no-op: GLTFLoader's progress handler not easily hooked here; left for future improvement
      });
      loaderUI.track(stepWeights[1], pcLoadPromise, cb => {
        // pc asset loader progress hooking not directly exposed; left as-is
      });
    } else {
      loaderUI.track(1.0, threeLoadPromise, cb => {});
    }
  } catch (e) {
    // loaderUI may have different API; ignore if it fails but continue
    console.warn("loaderUI.track failed or is incompatible:", e);
  }

  // Await both promises (pcLoadPromise may be immediately resolved if PlayCanvas not present)
  const [threeResult, pcEntity] = await Promise.all([threeLoadPromise, pcLoadPromise.catch(e => { console.warn("PlayCanvas load failed:", e); return null; })]);

  // If you have a CPU renderer that can scan and upload scene, pass it the Three group (BVH/collider based on the Three group)
  if (window.renderer && typeof window.renderer.scanAndUploadScene === "function") {
    try {
      const maybeScene = (isThreeScene ? targetScene : window.__threeMapGroup || targetScene);
      await window.renderer.scanAndUploadScene(maybeScene);
      console.log("Renderer: scene scanned and uploaded.");
    } catch (e) {
      console.warn("renderer.scanAndUploadScene failed:", e);
    }
  }

  // Mark ready once loader UI completes/steps finished
  loaderUI.onComplete(() => {
    window.mapReady = true;
    console.log("Map + BVH Collider fully ready!");
  });

  // Return spawn points (in the same structure you expect)
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

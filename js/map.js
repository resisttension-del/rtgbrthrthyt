import { Loader } from './Loader.js';
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function generateSequentialIndices(vertexCount) {
    const idx = [];
    for (let i = 0; i < vertexCount; i++) idx.push(i);
    return idx;
}

// Lantern class unchanged
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

/**
 * Loads the CrocodilosConstruction map and returns {spawnPoints, colliderMesh}
 */
export async function createCrocodilosConstruction(scene) {
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
        new THREE.Vector3(-7, 7, -1)
    ];
    const spawnPoints = rawSpawnPoints.map(p => p.clone().multiplyScalar(SCALE / 5));
    const GLB_MODEL_URL = 'https://raw.githubusercontent.com/thearthd/3d-models/main/croccodilosconstruction.glb';

    let gltfGroup = null;
    let collider = null;

    await new Promise((resolve, reject) => {
        new GLTFLoader().load(
            GLB_MODEL_URL,
            gltf => {
                gltfGroup = gltf.scene;
                gltfGroup.scale.set(SCALE, SCALE, SCALE);
                gltfGroup.updateMatrixWorld(true);
                scene.add(gltfGroup);
                window.envMeshes = [];
                gltfGroup.traverse(child => {
                    if (child.isMesh) window.envMeshes.push(child);
                });

                let geometries = [];
                gltfGroup.traverse(child => {
                    if (child.isMesh) {
                        if (child.geometry && !child.geometry.index) {
                            child.geometry.setIndex(generateSequentialIndices(child.geometry.attributes.position.count));
                        }
                        geometries.push(child.geometry);
                    }
                });
                let mergedGeometry = BufferGeometryUtils.mergeBufferGeometries(geometries, false);
                collider = new THREE.Mesh(mergedGeometry, new THREE.MeshBasicMaterial());
                collider.material.wireframe = true;
                collider.material.opacity = 0.5;
                collider.material.transparent = true;
                collider.visible = false;
                scene.add(collider);
                resolve();
            },
            undefined,
            err => { console.error('Error loading CrocodilosConstruction GLB:', err); reject(err); }
        );
    });

    loaderUI.onComplete(() => {
        window.mapReady = true;
        console.log('Map loaded and collider built!');
    });

    return { spawnPoints, collider };
}

export async function createSigmaCity(scene) {
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
    const GLB_MODEL_URL = 'https://raw.githubusercontent.com/thearthd/3d-models/main/sigmacityupdated.glb';

    let gltfGroup = null;
    let collider = null;

    await new Promise((resolve, reject) => {
        new GLTFLoader().load(
            GLB_MODEL_URL,
            gltf => {
                gltfGroup = gltf.scene;
                gltfGroup.scale.set(SCALE, SCALE, SCALE);
                gltfGroup.updateMatrixWorld(true);
                scene.add(gltfGroup);
                window.envMeshes = [];
                gltfGroup.traverse(child => {
                    if (child.isMesh) window.envMeshes.push(child);
                });

                let geometries = [];
                gltfGroup.traverse(child => {
                    if (child.isMesh) {
                        if (child.geometry && !child.geometry.index) {
                            child.geometry.setIndex(generateSequentialIndices(child.geometry.attributes.position.count));
                        }
                        geometries.push(child.geometry);
                    }
                });
                let mergedGeometry = BufferGeometryUtils.mergeBufferGeometries(geometries, false);
                collider = new THREE.Mesh(mergedGeometry, new THREE.MeshBasicMaterial());
                collider.material.wireframe = true;
                collider.material.opacity = 0.5;
                collider.material.transparent = true;
                collider.visible = false;
                scene.add(collider);
                resolve();
            },
            undefined,
            err => { console.error('Error loading SigmaCity GLB:', err); reject(err); }
        );
    });

    loaderUI.onComplete(() => {
        window.mapReady = true;
        console.log('SigmaCity loaded and collider built!');
    });

    return { spawnPoints, collider };
}

export async function createDiddyDunes(scene) {
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
    const GLB_MODEL_URL = 'https://raw.githubusercontent.com/thearthd/3d-models/main/didddydunes.glb';

    let gltfGroup = null;
    let collider = null;

    await new Promise((resolve, reject) => {
        new GLTFLoader().load(
            GLB_MODEL_URL,
            gltf => {
                gltfGroup = gltf.scene;
                gltfGroup.scale.set(SCALE, SCALE, SCALE);
                gltfGroup.updateMatrixWorld(true);
                scene.add(gltfGroup);
                window.envMeshes = [];
                gltfGroup.traverse(child => {
                    if (child.isMesh) window.envMeshes.push(child);
                });

                let geometries = [];
                gltfGroup.traverse(child => {
                    if (child.isMesh) {
                        if (child.geometry && !child.geometry.index) {
                            child.geometry.setIndex(generateSequentialIndices(child.geometry.attributes.position.count));
                        }
                        geometries.push(child.geometry);
                    }
                });
                let mergedGeometry = BufferGeometryUtils.mergeBufferGeometries(geometries, false);
                collider = new THREE.Mesh(mergedGeometry, new THREE.MeshBasicMaterial());
                collider.material.wireframe = true;
                collider.material.opacity = 0.5;
                collider.material.transparent = true;
                collider.visible = false;
                scene.add(collider);
                resolve();
            },
            undefined,
            err => { console.error('Error loading diddyDunes GLB:', err); reject(err); }
        );
    });

    loaderUI.onComplete(() => {
        window.mapReady = true;
        console.log('DiddyDunes loaded and collider built!');
    });

    return { spawnPoints, collider };
}

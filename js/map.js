import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as RAPIER from "https://cdn.skypack.dev/@dimforge/rapier3d-compat";

function generateSequentialIndices(vertexCount) {
    const idx = [];
    for (let i = 0; i < vertexCount; i++) idx.push(i);
    return idx;
}

function createRapierColliderFromGLTF(gltfGroup) {
    let geometries = [];
    gltfGroup.traverse(child => {
        if (child.isMesh) {
            if (child.geometry && !child.geometry.index) {
                child.geometry.setIndex(generateSequentialIndices(child.geometry.attributes.position.count));
            }
            geometries.push(child.geometry);
        }
    });
    let mergedGeometry = BufferGeometryUtils.mergeGeometries(geometries, false);
    let vertices = mergedGeometry.attributes.position.array;
    let indices = mergedGeometry.index.array;
    return RAPIER.ColliderDesc.trimesh(vertices, indices);
}

export async function createCrocodilosConstruction(scene) {
    const SCALE = 5;
    const rawSpawnPoints = [
        new THREE.Vector3(-14, 7, -36), new THREE.Vector3(-2, 2, 37),
        new THREE.Vector3(0, 2, 0), new THREE.Vector3(2, 7, 34),
        new THREE.Vector3(-5, 2, -38), new THREE.Vector3(-18, 2, 12),
        new THREE.Vector3(11, 2, 23), new THREE.Vector3(-7, 7, -1)
    ];
    const spawnPoints = rawSpawnPoints.map(p => p.clone().multiplyScalar(SCALE / 5));
    const GLB_MODEL_URL = 'https://raw.githubusercontent.com/thearthd/3d-models/main/croccodilosconstruction.glb';

    let gltfGroup = null;
    let rapierColliderDesc = null;

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
                rapierColliderDesc = createRapierColliderFromGLTF(gltfGroup);
                resolve();
            },
            undefined,
            err => { console.error('Error loading CrocodilosConstruction GLB:', err); reject(err); }
        );
    });

    window.mapReady = true;
    return { spawnPoints, rapierColliderDesc };
}

export async function createSigmaCity(scene) {
    const SCALE = 2;
    const rawSpawnPoints = [
        new THREE.Vector3(-1, 3, -4), new THREE.Vector3(-55, -1, -6),
        new THREE.Vector3(13, 5, 47), new THREE.Vector3(1, 5, -66),
        new THREE.Vector3(21, 5, -45), new THREE.Vector3(0, 10, 22),
        new THREE.Vector3(43, 1, -35), new THREE.Vector3(24, 3, -14)
    ];
    const spawnPoints = rawSpawnPoints.map(p => p.clone().multiplyScalar(SCALE / 2));
    const GLB_MODEL_URL = 'https://raw.githubusercontent.com/thearthd/3d-models/main/sigmacityupdated.glb';

    let gltfGroup = null;
    let rapierColliderDesc = null;

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
                rapierColliderDesc = createRapierColliderFromGLTF(gltfGroup);
                resolve();
            },
            undefined,
            err => { console.error('Error loading SigmaCity GLB:', err); reject(err); }
        );
    });

    window.mapReady = true;
    return { spawnPoints, rapierColliderDesc };
}

export async function createDiddyDunes(scene) {
    const SCALE = 2;
    const rawSpawnPoints = [
        new THREE.Vector3(34, 3, 0), new THREE.Vector3(62, 1, -37),
        new THREE.Vector3(26, 3, -30), new THREE.Vector3(-27, 3, -74),
        new THREE.Vector3(12, 3, -20), new THREE.Vector3(-58, 8, 2),
        new THREE.Vector3(55, 1, -55), new THREE.Vector3(-20, 8, -13)
    ];
    const spawnPoints = rawSpawnPoints.map(p => p.clone().multiplyScalar(SCALE / 2));
    const GLB_MODEL_URL = 'https://raw.githubusercontent.com/thearthd/3d-models/main/didddydunes.glb';

    let gltfGroup = null;
    let rapierColliderDesc = null;

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
                rapierColliderDesc = createRapierColliderFromGLTF(gltfGroup);
                resolve();
            },
            undefined,
            err => { console.error('Error loading diddyDunes GLB:', err); reject(err); }
        );
    });

    window.mapReady = true;
    return { spawnPoints, rapierColliderDesc };
}

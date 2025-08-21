import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshBVH, acceleratedRaycast, computeBoundsTree } from 'three-mesh-bvh';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// Helper for merging and building collider mesh for PhysicsController
function buildColliderMeshFromGLTF(gltfGroup) {
    let geometries = [];
    gltfGroup.traverse(child => {
        if (child.isMesh) {
            // Ensure indexed geometry for merging
            if (child.geometry && !child.geometry.index) {
                const idx = [];
                for (let i = 0; i < child.geometry.attributes.position.count; i++) idx.push(i);
                child.geometry.setIndex(idx);
            }
            geometries.push(child.geometry);
        }
    });

    let mergedGeometry = BufferGeometryUtils.mergeGeometries(geometries, false);
    mergedGeometry.computeBoundsTree();
    console.log('Merged geometry vertex count:', mergedGeometry.attributes.position.count);
    console.log('Merged geometry index count:', mergedGeometry.index ? mergedGeometry.index.count : 'NO INDEX');
    let colliderMesh = new THREE.Mesh(
        mergedGeometry,
        new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true, visible: false })
    );
    colliderMesh.visible = false; // Make true for debugging!
    colliderMesh.matrixWorldAutoUpdate = true;
    colliderMesh.updateMatrixWorld(true);
    return colliderMesh;
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
    let colliderMesh = null;

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
                colliderMesh = buildColliderMeshFromGLTF(gltfGroup);
                colliderMesh.scale.copy(gltfGroup.scale);
                colliderMesh.position.copy(gltfGroup.position);
                colliderMesh.updateMatrixWorld(true);
                scene.add(colliderMesh); // For debugging, make visible if needed
                resolve();
            },
            undefined,
            err => { console.error('Error loading CrocodilosConstruction GLB:', err); reject(err); }
        );
    });

    window.mapReady = true;
    return { spawnPoints, colliderMesh };
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
    let colliderMesh = null;

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
                colliderMesh = buildColliderMeshFromGLTF(gltfGroup);
                colliderMesh.scale.copy(gltfGroup.scale);
                colliderMesh.position.copy(gltfGroup.position);
                colliderMesh.updateMatrixWorld(true);
                scene.add(colliderMesh);
                resolve();
            },
            undefined,
            err => { console.error('Error loading SigmaCity GLB:', err); reject(err); }
        );
    });

    window.mapReady = true;
    return { spawnPoints, colliderMesh };
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
    let colliderMesh = null;

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
                colliderMesh = buildColliderMeshFromGLTF(gltfGroup);
                colliderMesh.scale.copy(gltfGroup.scale);
                colliderMesh.position.copy(gltfGroup.position);
                colliderMesh.updateMatrixWorld(true);
                scene.add(colliderMesh);
                resolve();
            },
            undefined,
            err => { console.error('Error loading diddyDunes GLB:', err); reject(err); }
        );
    });

    window.mapReady = true;
    return { spawnPoints, colliderMesh };
}


import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js';
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";

export class Lantern {
  /**
   * @param {THREE.Scene|THREE.Object3D} parent
   * @param {THREE.Vector3} position – world‑space top‑center for the lantern
   * @param {number} [scale=1]
   * @param {object} [lightOptions]
   */
  constructor(parent, position, scale=1, lightOptions={}) {
    this.container = new THREE.Object3D();
    this.container.position.copy(position);
    parent.add(this.container);

    const url = 'https://raw.githubusercontent.com/thearthd/3d-models/refs/heads/main/uploads_files_2887463_Lantern.obj';
    const loader = new OBJLoader();

    loader.load(
      url,
      (lanternGroup) => {
        // scale & recenter so top sits at y=0
        lanternGroup.scale.set(scale,scale,scale);
        lanternGroup.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(lanternGroup);
        const height = box.max.y - box.min.y;
        lanternGroup.position.y = -box.max.y;

        // apply standard material
        lanternGroup.traverse(child => {
          if (child.isMesh) {
            child.material = new THREE.MeshStandardMaterial({
              roughness: 0.8,
              metalness: 0.7,
              side: THREE.DoubleSide
            });
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });

        this.container.add(lanternGroup);

        // spot light
        const {
          color=0xffffff,
          intensity=1,
          distance=10,
          angle=Math.PI/8,
          penumbra=0.5,
          decay=2
        } = lightOptions;
        const spot = new THREE.SpotLight(color,intensity,distance,angle,penumbra,decay);
        spot.position.set(0, -height/2, 0);
        spot.target.position.set(0, -height, 0);
        spot.castShadow = true;
        spot.shadow.mapSize.set(512,512);
        spot.shadow.camera.near = 0.5;
        spot.shadow.camera.far = distance;

        this.container.add(spot, spot.target);
      },
      null,
      err => console.error('Error loading lantern model:', err)
    );
  }
}

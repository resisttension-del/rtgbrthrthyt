// HitboxOBJLoader.js
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import * as THREE from "three";

export class HitboxOBJLoader extends OBJLoader {
  load(url, onLoad, onProgress, onError) {
    super.load(
      url,
      (group) => {
        // Precompute each mesh’s local boundingBox
        group.traverse((child) => {
          if (!child.isMesh) return;
          child.geometry.computeBoundingBox();
          child.userData.hitbox = child.geometry.boundingBox.clone();
        });
        onLoad(group);
      },
      onProgress,
      onError
    );
  }
}

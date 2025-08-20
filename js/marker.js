// marker.js
// Exportable MarkerManager for Three.js
// Requirements: THREE is available globally or imported.
import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";

// marker.js
// Exportable MarkerManager for Three.js
// Requirements: THREE is available globally or imported.

export class MarkerManager {
  /**
   * scene - THREE.Scene
   * camera - THREE.Camera (player camera)
   * options:
   *  - unitsPerMeter: number (how many world-units == 1 meter). Default 1 (i.e. 1 unit = 1 meter).
   *      NOTE: If your world uses centimeters, set unitsPerMeter = 100.
   *  - lifetimeMs: marker lifetime in ms (default 10000)
   *  - maxRange: raycast max range in world units (default 2000)
   *  - worldObjects: array of meshes to raycast against (optional)
   *  - playerObjects: array of meshes representing players (optional)
   *  - checkBulletPenetration: optional function(origin, direction, maxPen) -> result
   *        (If provided it will be used in preference to raw raycast for better parity with your shooting code.)
   */
  constructor(scene, camera, options = {}) {
    this.scene = scene;
    this.camera = camera;
    this.unitsPerMeter = options.unitsPerMeter ?? 1;
    this.lifetimeMs = options.lifetimeMs ?? 10000;
    this.maxRange = options.maxRange ?? 2000;
    this.worldObjects = options.worldObjects ?? null;
    this.playerObjects = options.playerObjects ?? null;
    this.checkBulletPenetration = options.checkBulletPenetration ?? null;

    this._ray = new THREE.Raycaster();
    this._ray.camera = camera;
    this._markers = new Set();

    // bind handlers
    this._onKey = this._onKey.bind(this);

    window.addEventListener("keydown", this._onKey);
  }

  dispose() {
    window.removeEventListener("keydown", this._onKey);
    for (const m of Array.from(this._markers)) this._removeMarker(m);
  }

  _onKey(e) {
    // require the player to press "y" (case-insensitive)
    if (e.key && e.key.toLowerCase() === "y") {
      this.createMarkerFromCamera();
    }
  }

  /**
   * Create a marker where the camera is pointing.
   * If your project has a penetration-aware raycast function, pass it to the constructor as checkBulletPenetration
   */
  createMarkerFromCamera() {
    if (!this.camera) return;

    // origin & direction
    this.camera.updateMatrixWorld();
    const origin = new THREE.Vector3().setFromMatrixPosition(this.camera.matrixWorld);
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();

    // If user provided a bullet-penetration function (their existing code), use it:
    if (typeof this.checkBulletPenetration === "function") {
      try {
        // ask for 0 penetrations so we just find the first hit (keep parity with their code)
        const traj = this.checkBulletPenetration(origin, direction, 0);
        if (traj.playerHitResult) {
          const p = traj.playerHitResult.intersection.clone();
          this.createMarkerAt(p);
          return;
        } else if (traj.allWorldHits && traj.allWorldHits.length) {
          const p = traj.allWorldHits[traj.allWorldHits.length - 1].point.clone();
          this.createMarkerAt(p);
          return;
        }
        // fallthrough to broad raycast (in case checkBulletPenetration returned nothing)
      } catch (err) {
        console.warn("checkBulletPenetration threw:", err);
      }
    }

    // Fallback: basic raycast against provided worldObjects/playerObjects or entire scene
    const ray = this._ray;
    ray.set(origin, direction);

    let candidates = [];
    if (this.playerObjects && this.playerObjects.length) candidates = candidates.concat(this.playerObjects);
    if (this.worldObjects && this.worldObjects.length) candidates = candidates.concat(this.worldObjects);

    // If no candidates were supplied, raycast against scene.children (not ideal for huge scenes).
    if (!candidates.length) {
      candidates = this.scene.children;
    }

    const hits = ray.intersectObjects(candidates, true);
    if (hits && hits.length) {
      const hit = hits[0];
      const point = hit.point.clone();
      this.createMarkerAt(point);
    } else {
      // no hit, place at maxRange along direction for feedback
      const fallback = origin.clone().add(direction.clone().multiplyScalar(this.maxRange));
      this.createMarkerAt(fallback);
    }
  }

  /**
   * createMarkerAt(position: THREE.Vector3)
   */
  createMarkerAt(position) {
    // root container so we can rotate/scale both icon+label easily
    const root = new THREE.Object3D();
    root.position.copy(position);

    // tiny arrow indicator (a cone pointing up in local space)
    const coneGeo = new THREE.ConeGeometry(0.08, 0.25, 8);
    coneGeo.translate(0, -0.125, 0); // put tip at origin so cone sits above the point
    const coneMat = new THREE.MeshStandardMaterial({ emissive: 0x88ccff, emissiveIntensity: 0.6, metalness: 0.2, roughness: 0.6 });
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.rotation.x = Math.PI; // point down towards the surface (adjust visually)
    root.add(cone);

    // label sprite that shows distance in meters and optionally coordinates
    const label = this._makeLabelSprite("…"); // placeholder
    label.position.set(0, 0.35, 0);
    root.add(label);

    // small billboard background (optional)
    // add to scene and to set for update
    this.scene.add(root);
    const marker = {
      root,
      label,
      createdAt: performance.now(),
      removeHandle: null
    };
    this._markers.add(marker);

    // schedule removal after lifetime
    marker.removeHandle = setTimeout(() => {
      this._removeMarker(marker);
    }, this.lifetimeMs);

    // immediately set a proper label value (distance)
    this._updateMarkerLabel(marker);

    return marker;
  }

  _removeMarker(marker) {
    if (!marker) return;
    if (marker.removeHandle) {
      clearTimeout(marker.removeHandle);
      marker.removeHandle = null;
    }
    if (marker.root) {
      this.scene.remove(marker.root);
      // dispose textures & geometries where appropriate to avoid leaks
      marker.root.traverse((o) => {
        if (o.material) {
          if (Array.isArray(o.material)) {
            o.material.forEach(m => m.dispose && m.dispose());
          } else {
            o.material.dispose && o.material.dispose();
          }
        }
        if (o.geometry) o.geometry.dispose && o.geometry.dispose();
        if (o.texture) o.texture.dispose && o.texture.dispose();
      });
    }
    this._markers.delete(marker);
  }

  /**
   * Call once per frame from your animate() loop
   * - updates label text (distance -> meters)
   * - makes sure icons/labels face the camera
   */
  update() {
    if (!this.camera) return;
    for (const marker of this._markers) {
      this._updateMarkerLabel(marker);
      // Make sure the label always faces the camera
      // If label is a Sprite it will auto-face; otherwise we explicitly lookAt
      if (marker.label && !(marker.label.material && marker.label.material.isSpriteMaterial)) {
        marker.label.lookAt(this.camera.position);
      }
      // small pulsing or scale-by-distance can be added here if you want
    }
  }

  _updateMarkerLabel(marker) {
    // compute distance in world units, convert to meters using unitsPerMeter:
    const distWorld = this.camera.position.distanceTo(marker.root.position);
    const meters = distWorld / this.unitsPerMeter;
    const metersStr = meters >= 10 ? Math.round(meters) + " m" : meters.toFixed(2) + " m";

    // Optionally show coordinates in meters
    const coords = marker.root.position;
    const xM = (coords.x / this.unitsPerMeter).toFixed(2);
    const yM = (coords.y / this.unitsPerMeter).toFixed(2);
    const zM = (coords.z / this.unitsPerMeter).toFixed(2);

    const text = `${metersStr}\n(${xM}, ${yM}, ${zM})`;

    // If label is a sprite with a canvas texture, replace the texture
    if (marker.label && marker.label.material && marker.label.material.map && marker.label.material.map.image && marker.label.material.map.image.getContext) {
      this._updateCanvasTexture(marker.label.material.map, text);
      marker.label.material.map.needsUpdate = true;
    } else if (marker.label && marker.label.material && marker.label.material.map && marker.label.material.map.image == null) {
      // fallback
      // recreate label
      const newLabel = this._makeLabelSprite(text);
      newLabel.position.copy(marker.label.position);
      marker.root.remove(marker.label);
      marker.root.add(newLabel);
      marker.label = newLabel;
    } else if (marker.label && marker.label.material && marker.label.material.isSpriteMaterial) {
      // sprite without canvas (unlikely) - recreate
      const newLabel = this._makeLabelSprite(text);
      newLabel.position.copy(marker.label.position);
      marker.root.remove(marker.label);
      marker.root.add(newLabel);
      marker.label = newLabel;
    }
  }

  _makeLabelSprite(text) {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");

    // draw background
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(10,10,10,0.65)";
    roundRect(ctx, 4, 4, canvas.width - 8, canvas.height - 8, 8);
    ctx.fill();

    // draw text
    ctx.font = "28px sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // support multi-line
    const lines = (text || "").split("\n");
    const startY = canvas.height / 2 - (lines.length - 1) * 16;
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], canvas.width / 2, startY + i * 32);
    }

    // create texture
    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 16;
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: true, depthWrite: false, sizeAttenuation: true });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.8, 0.4, 1); // tweak as needed
    // store reference to canvas for updates
    mat.map.image = canvas;
    return sprite;

    function roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }
  }

  _updateCanvasTexture(texture, text) {
    // texture.image is the canvas we created earlier
    const canvas = texture.image;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // draw background
    ctx.fillStyle = "rgba(10,10,10,0.65)";
    roundRect(ctx, 4, 4, canvas.width - 8, canvas.height - 8, 8);
    ctx.fill();

    ctx.font = "28px sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const lines = (text || "").split("\n");
    const startY = canvas.height / 2 - (lines.length - 1) * 16;
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], canvas.width / 2, startY + i * 32);
    }

    function roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }
  }
}

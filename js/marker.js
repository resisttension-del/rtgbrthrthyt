// marker.js
// Exportable MarkerManager for Three.js
// Requirements: THREE is available globally or imported.
import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";

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
  // ensure ray has camera set initially and again before each cast
  this._ray.camera = this.camera;
  this._markers = new Set();

  // bind handlers
  this._onKey = this._onKey.bind(this);

  // prefer document for key events (more reliable with canvas/pointerlock)
  document.addEventListener("keydown", this._onKey);
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
  try {
    // keep matrices fresh
    this.camera.updateMatrixWorld();
    if (this.scene) this.scene.updateMatrixWorld(true);

    const origin = new THREE.Vector3().setFromMatrixPosition(this.camera.matrixWorld);
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();

    // prefer setFromCamera for screen-center accuracy (uncomment if desired)
    // this._ray.setFromCamera(new THREE.Vector2(0, 0), this.camera);

    const ray = this._ray;
    ray.camera = this.camera;
    ray.set(origin, direction);
    ray.near = 0.01;
    ray.far = this.maxRange;

    // --- debug visuals: keep them separate so they won't be included in candidates ---
    if (!this._debugGroup) {
      this._debugGroup = new THREE.Group();
      this._debugGroup.name = "__marker_debug_group";
      // do not include debug group in worldObjects; it's purely scene-helper
      this.scene.add(this._debugGroup);
    }
    // clear previous debug children
    while (this._debugGroup.children.length) {
      const c = this._debugGroup.children.pop();
      c.geometry && c.geometry.dispose && c.geometry.dispose();
      c.material && c.material.dispose && c.material.dispose();
    }
    // add a short debug line+arrow (not part of scene.children root)
    const dbgLen = Math.min(this.maxRange, 200);
    const pts = [origin.clone(), origin.clone().add(direction.clone().multiplyScalar(dbgLen))];
    const geom = new THREE.BufferGeometry().setFromPoints(pts);
    const lineMat = new THREE.LineBasicMaterial({ linewidth: 2 });
    const line = new THREE.Line(geom, lineMat);
    line.name = "__marker_debug_line";
    this._debugGroup.add(line);
    const arrow = new THREE.ArrowHelper(direction.clone(), origin.clone(), dbgLen, 0xff0000);
    arrow.name = "__marker_debug_arrow";
    this._debugGroup.add(arrow);
    // auto-remove after 3s
    setTimeout(() => {
      if (!this._debugGroup) return;
      this._debugGroup.remove(line);
      this._debugGroup.remove(arrow);
      geom.dispose(); lineMat.dispose();
    }, 3000);

    // build candidate list (prefer explicit arrays if supplied)
    let candidates = [];
    if (this.playerObjects && this.playerObjects.length) candidates = candidates.concat(this.playerObjects);
    if (this.worldObjects && this.worldObjects.length) candidates = candidates.concat(this.worldObjects);
    if (!candidates.length) candidates = this.scene.children.slice();

    // filter out debug group + non-raycastable objects
    const isDebug = (o) => (o.name && o.name.startsWith("__marker_debug")) || (o === this._debugGroup);
    const hasRaycast = (o) => (typeof o.raycast === "function") || o.isMesh || o.isInstancedMesh || o.isSkinnedMesh;
    // Also include parents that contain meshes by counting children meshes (helpful for Group)
    const childMeshCount = (o) => {
      let c = 0;
      o.traverse && o.traverse((n) => { if (n.isMesh) c++; });
      return c;
    };

    const filtered = candidates.filter(o => {
      if (!o) return false;
      if (isDebug(o)) return false;
      if (o.visible === false) return false;
      if (hasRaycast(o)) return true;
      // allow groups that actually contain meshes
      return childMeshCount(o) > 0;
    });

    console.log("[MarkerManager DEBUG] original candidates:", candidates.length, "filtered:", filtered.length);
    // optional: log candidate mesh counts for quick inspection
    filtered.forEach((o, i) => {
      console.log(`[MarkerManager DEBUG] candidate[${i}] type=${o.type} name=${o.name||'(noname)'} meshes=${childMeshCount(o)}`);
    });

    // now intersect only against filtered list
    const hits = ray.intersectObjects(filtered, true);
    if (hits && hits.length) {
      const hit = hits[0];
      console.log("[MarkerManager] ray hit:", hit.object.name || hit.object.type || hit.object.id, hit.point);
      this.createMarkerAt(hit.point.clone());
      return;
    } else {
      const fallback = origin.clone().add(direction.clone().multiplyScalar(this.maxRange));
      console.log("[MarkerManager] no hit, placing fallback at", fallback);
      this.createMarkerAt(fallback);
      return;
    }
  } catch (err) {
    console.error("MarkerManager.createMarkerFromCamera threw:", err);
  }
}

  /**
   * createMarkerAt(position: THREE.Vector3)
   */
createMarkerAt(position) {
  const root = new THREE.Object3D();
  root.position.copy(position);

  // use MeshBasicMaterial for visibility even if there are no lights
  const coneGeo = new THREE.ConeGeometry(0.08, 0.25, 8);
  coneGeo.translate(0, -0.125, 0);
  const coneMat = new THREE.MeshBasicMaterial({ color: 0x88ccff });
  const cone = new THREE.Mesh(coneGeo, coneMat);
  cone.rotation.x = Math.PI;
  root.add(cone);

  const label = this._makeLabelSprite("…");
  label.position.set(0, 0.35, 0);

  // make label render on top while debugging
  label.renderOrder = 999;
  if (label.material) {
    label.material.depthTest = false;
    label.material.depthWrite = false;
  }

  root.add(label);

  this.scene.add(root);
  const marker = { root, label, createdAt: performance.now(), removeHandle: null };
  this._markers.add(marker);

  marker.removeHandle = setTimeout(() => this._removeMarker(marker), this.lifetimeMs);
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
  const mat = new THREE.SpriteMaterial({
    map: tex,
    depthTest: true,  // keep true normally, but we override per-sprite at runtime if needed
    depthWrite: false,
    sizeAttenuation: true
  });
  const sprite = new THREE.Sprite(mat);
  // make slightly bigger for easier debugging
  sprite.scale.set(1.2, 0.6, 1);
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

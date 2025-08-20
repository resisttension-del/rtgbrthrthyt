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
   *  - lifetimeMs: marker lifetime in ms (default 10000)
   *  - maxRange: raycast max range in world units (default 2000)
   *  - worldObjects: array of meshes to raycast against (optional)
   *  - playerObjects: array of meshes representing players (optional)
   *  - checkBulletPenetration: optional function(origin, direction, maxPen) -> result
   *  - renderer: optional THREE.WebGLRenderer instance — when provided the manager will compute exact
   *      world-scale for a desired pixel size so sprites are pixel-perfect.
   *  - spritePixelHeight: desired sprite height in screen pixels (default 80)
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

    // optional renderer used to compute world scale from pixel size
    this.renderer = options.renderer ?? null;
    this.spritePixelHeight = options.spritePixelHeight ?? 80; // pixels

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

  createMarkerFromCamera() {
    if (!this.camera) return;

    this.camera.updateMatrixWorld();
    const origin = new THREE.Vector3().setFromMatrixPosition(this.camera.matrixWorld);
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();

    if (typeof this.checkBulletPenetration === "function") {
      try {
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
      } catch (err) {
        console.warn("checkBulletPenetration threw:", err);
      }
    }

    const ray = this._ray;
    ray.set(origin, direction);

    let candidates = [];
    if (this.playerObjects && this.playerObjects.length) candidates = candidates.concat(this.playerObjects);
    if (this.worldObjects && this.worldObjects.length) candidates = candidates.concat(this.worldObjects);

    if (!candidates.length) {
      candidates = this.scene.children;
    }

    const hits = ray.intersectObjects(candidates, true);
    if (hits && hits.length) {
      const hit = hits[0];
      const point = hit.point.clone();
      this.createMarkerAt(point);
    } else {
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
    // ensure it renders on top
    root.renderOrder = 999999;

    // small icon sprite (arrow)
    const icon = this._makeIconSprite(this.spritePixelHeight * 0.6); // pixel height for icon
    icon.position.set(0, 0.0, 0); // centered at the location
    root.add(icon);

    // label sprite that shows distance in meters and optionally coordinates
    const label = this._makeLabelSprite("…", this.spritePixelHeight); // placeholder
    label.position.set(0, 0.35, 0);
    root.add(label);

    // add to scene and to set for update
    this.scene.add(root);
    const marker = {
      root,
      icon,
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
        // if sprite map is a CanvasTexture, dispose it
        if (o.material && o.material.map && o.material.map.dispose) {
          o.material.map.dispose();
        }
      });
    }
    this._markers.delete(marker);
  }

  /**
   * Call once per frame from your animate() loop
   * - updates label text (distance -> meters)
   * - makes sure sprites face the camera and remain constant screen size
   */
  update() {
    if (!this.camera) return;
    for (const marker of this._markers) {
      this._updateMarkerLabel(marker);

      // sprites will face the camera automatically; ensure renderOrder and depthTest settings
      marker.root.renderOrder = 999999;

      // update scale so the sprite is exactly the desired pixel height on screen (if renderer provided)
      if (marker.label) this._updateSpriteScale(marker.label);
      if (marker.icon) this._updateSpriteScale(marker.icon);
    }
  }

  _updateMarkerLabel(marker) {
    const distWorld = this.camera.position.distanceTo(marker.root.position);
    const meters = distWorld / this.unitsPerMeter;
    const metersStr = meters >= 10 ? Math.round(meters) + " m" : meters.toFixed(2) + " m";

    const coords = marker.root.position;
    const xM = (coords.x / this.unitsPerMeter).toFixed(2);
    const yM = (coords.y / this.unitsPerMeter).toFixed(2);
    const zM = (coords.z / this.unitsPerMeter).toFixed(2);

    const text = `${metersStr}\n(${xM}, ${yM}, ${zM})`;

    if (marker.label && marker.label.material && marker.label.material.map && marker.label.material.map.image && marker.label.material.map.image.getContext) {
      this._updateCanvasTexture(marker.label.material.map, text);
      marker.label.material.map.needsUpdate = true;
    } else {
      // fallback: recreate label sprite with text
      const newLabel = this._makeLabelSprite(text, this.spritePixelHeight);
      newLabel.position.copy(marker.label.position);
      marker.root.remove(marker.label);
      marker.root.add(newLabel);
      marker.label = newLabel;
    }
  }

  /**
   * Create a label sprite from canvas.
   * text: string (can contain newlines)
   * pixelHeight: desired screen height in pixels for the sprite (used later to compute world scale)
   */
  _makeLabelSprite(text, pixelHeight = 80) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");

    // draw background
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(10,10,10,0.65)";
    roundRect(ctx, 8, 8, canvas.width - 16, canvas.height - 16, 12);
    ctx.fill();

    // draw text
    ctx.font = "28px sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const lines = (text || "").split("\n");
    const startY = canvas.height / 2 - (lines.length - 1) * 16;
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], canvas.width / 2, startY + i * 32);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 16;

    const mat = new THREE.SpriteMaterial({
      map: tex,
      depthTest: false,    // render on top
      depthWrite: false,
      sizeAttenuation: false, // do not scale with perspective
      transparent: true
    });

    const sprite = new THREE.Sprite(mat);

    // initially set a reasonable aspect-preserving scale (will be corrected each frame if renderer provided)
    const aspect = canvas.width / canvas.height;
    sprite.scale.set((pixelHeight * aspect) / 100, pixelHeight / 100, 1); // heuristic fallback
    // store useful metadata for update
    sprite.userData.pixelHeight = pixelHeight;
    // store canvas so we can update it later
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

  /**
   * Small arrow icon as sprite (canvas-drawn).
   * pixelHeight: desired pixel height for screen size.
   */
  _makeIconSprite(pixelHeight = 48) {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // draw a downward triangle arrow centered
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2, 12);
    ctx.lineTo(canvas.width - 18, canvas.height - 18);
    ctx.lineTo(18, canvas.height - 18);
    ctx.closePath();
    ctx.fillStyle = "rgba(136,204,255,0.95)";
    ctx.fill();

    // small inner stroke
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(20,20,30,0.7)";
    ctx.stroke();

    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 16;

    const mat = new THREE.SpriteMaterial({
      map: tex,
      depthTest: false,
      depthWrite: false,
      sizeAttenuation: false,
      transparent: true
    });

    const sprite = new THREE.Sprite(mat);
    // heuristic fallback scale:
    const aspect = canvas.width / canvas.height;
    sprite.scale.set((pixelHeight * aspect) / 100, pixelHeight / 100, 1);
    sprite.userData.pixelHeight = pixelHeight;
    mat.map.image = canvas;

    return sprite;
  }

  _updateCanvasTexture(texture, text) {
    const canvas = texture.image;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "rgba(10,10,10,0.65)";
    roundRect(ctx, 8, 8, canvas.width - 16, canvas.height - 16, 12);
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

  /**
   * Update sprite.scale such that the sprite is sprite.userData.pixelHeight pixels tall on screen.
   * Requires this.renderer to be set for pixel-perfect sizing. Otherwise uses a fallback scale.
   */
  _updateSpriteScale(sprite) {
    if (!sprite || !sprite.material) return;
    const pixelHeight = sprite.userData.pixelHeight ?? this.spritePixelHeight;

    if (this.renderer && this.renderer.domElement) {
      const dom = this.renderer.domElement;
      const cam = this.camera;

      // compute world-space height that corresponds to `pixelHeight` at the sprite's distance
      const spriteWorldPos = new THREE.Vector3();
      sprite.getWorldPosition(spriteWorldPos);
      const distance = this.camera.position.distanceTo(spriteWorldPos);

      if (cam.isPerspectiveCamera) {
        const vFOV = THREE.MathUtils.degToRad(cam.fov); // vertical fov in radians
        const worldHeightAtDist = 2 * distance * Math.tan(vFOV / 2);
        const pixelToWorld = worldHeightAtDist / dom.clientHeight;
        const desiredWorldHeight = pixelHeight * pixelToWorld;

        // keep original aspect ratio of the canvas texture
        let aspect = 1;
        if (sprite.material.map && sprite.material.map.image) {
          const img = sprite.material.map.image;
          aspect = (img.width / img.height) || 1;
        }

        sprite.scale.set(desiredWorldHeight * aspect, desiredWorldHeight, 1);
      } else if (cam.isOrthographicCamera) {
        // for orthographic, camera height is (top - bottom)
        const camHeight = cam.top - cam.bottom;
        const pixelToWorld = camHeight / dom.clientHeight;
        const desiredWorldHeight = pixelHeight * pixelToWorld;
        let aspect = 1;
        if (sprite.material.map && sprite.material.map.image) {
          const img = sprite.material.map.image;
          aspect = (img.width / img.height) || 1;
        }
        sprite.scale.set(desiredWorldHeight * aspect, desiredWorldHeight, 1);
      } else {
        // unknown camera type: fallback to heuristic
        sprite.scale.set((pixelHeight / 100), (pixelHeight / 100), 1);
      }
    } else {
      // no renderer available: use the heuristic fallback and ensure it's not distance-attenuated
      sprite.scale.set((pixelHeight / 100), (pixelHeight / 100), 1);
      // material should already have sizeAttenuation=false and depthTest=false in creation funcs
    }

    // ensure material is rendered on top
    sprite.renderOrder = 999999;
    if (sprite.material) {
      sprite.material.depthTest = false;
      sprite.material.depthWrite = false;
    }
  }
}

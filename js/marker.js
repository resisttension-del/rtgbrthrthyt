/**
 * Minimal standalone range marker (self-contained raycast logic).
 *
 * This version places a 3D THREE.Mesh in the world but ensures it always
 * rotates to face the player's camera.
 *
 * Usage:
 * import RangeMarker from './RangeMarker.js';
 * const rm = new RangeMarker({
 * camera,           // THREE.Camera (required)
 * renderer,         // THREE.WebGLRenderer (required)
 * scene,            // THREE.Scene (required for raycasting)
 * unitsPerMeter: 1,  // game units per meter - default 1
 * autoListenKey: true, // listen for 't' automatically
 * defaultDistance: 1000, // max ray distance (world units)
 * THREE,            // Pass THREE from your project's import
 * });
 *
 * // in your RAF loop:
 * rm.update();
 *
 * // cleanup:
 * rm.dispose();
 */
export default class RangeMarker {
  constructor(opts = {}) {
    if (!opts.camera) throw new Error('RangeMarker: camera required');
    if (!opts.renderer) throw new Error('RangeMarker: renderer required');
    if (!opts.scene) throw new Error('RangeMarker: scene required for raycasting');

    this.camera = opts.camera;
    this.renderer = opts.renderer;
    this.scene = opts.scene;
    this.unitsPerMeter = (opts.unitsPerMeter && Number(opts.unitsPerMeter) > 0) ? Number(opts.unitsPerMeter) : 1;
    this.autoListenKey = (opts.autoListenKey === undefined) ? true : Boolean(opts.autoListenKey);
    this.defaultDistance = (opts.defaultDistance && Number(opts.defaultDistance) > 0) ? Number(opts.defaultDistance) : 1000;

    this._THREE = opts.THREE || (typeof THREE !== 'undefined' ? THREE : null);
    if (!this._THREE) {
      console.warn('RangeMarker: THREE not found; marker will be disabled.');
    }

    this._marker = null; // THREE.Mesh
    this._markerStartTime = 0; // for fade animation

    this._onKeyDown = this._onKeyDown.bind(this);
    if (this.autoListenKey) window.addEventListener('keydown', this._onKeyDown);

    if (this._THREE && this._THREE.Raycaster) {
      this._raycaster = new this._THREE.Raycaster();
      this._raycaster.near = 0.0001;
      this._raycaster.far = this.defaultDistance;
    } else {
      this._raycaster = null;
    }
  }

  _onKeyDown(ev) {
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
    if (ev.repeat) return;
    if (ev.key === 't' || ev.key === 'T') {
      this.placeMarker();
    }
  }

  _collectCandidates() {
    const candidates = [];
    if (!this.scene || !this._THREE) return candidates;
    this.scene.traverse((o) => {
      if ((o.isMesh || o.isInstancedMesh) && o.visible && o.geometry) {
        if (o.userData && o.userData.ignoreRangeMarker) return;
        candidates.push(o);
      }
    });
    return candidates;
  }

  _checkPlayerHit(origin, direction) {
    let closest = null;
    if (!window.remotePlayers) return null;

    for (const rp of Object.values(window.remotePlayers)) {
      const meshes = [];
      if (rp.bodyMesh) meshes.push(rp.bodyMesh);
      if (rp.headMesh) meshes.push(rp.headMesh);

      for (const mesh of meshes) {
        const hits = this._raycaster.intersectObject(mesh, true);
        if (!hits.length) continue;
        const hit = hits[0];
        if (!closest || hit.distance < closest.distance) {
          closest = {
            mesh,
            isHead: mesh.userData.isPlayerHead === true,
            intersection: hit.point.clone(),
            distance: hit.distance
          };
        }
      }
    }
    return closest;
  }

  placeMarker() {
    if (!this._THREE || !this._raycaster || !this.scene) {
      return;
    }

    this.camera.updateMatrixWorld();

    const origin = new this._THREE.Vector3().setFromMatrixPosition(this.camera.matrixWorld);
    const direction = new this._THREE.Vector3();
    this.camera.getWorldDirection(direction);

    this._raycaster.set(origin, direction);
    this._raycaster.far = Number.isFinite(this.defaultDistance) ? this.defaultDistance : this._raycaster.far;

    const playerHit = this._checkPlayerHit(origin, direction);

    let chosen = null;
    let hitPoint = null;

    if (playerHit) {
      chosen = playerHit;
      hitPoint = playerHit.intersection;
    } else {
      const candidates = this._collectCandidates();
      if (!candidates.length) return;

      const hits = this._raycaster.intersectObjects(candidates, true);
      if (!hits || !hits.length) {
        return;
      }

      for (let i = 0; i < hits.length; i++) {
        const h = hits[i];
        if (!h) continue;
        if (!isFinite(h.distance) || !h.point) continue;
        const p = h.point;
        if (!isFinite(p.x) || !isFinite(p.y) || !isFinite(p.z)) continue;
        if (h.object && h.object.userData && h.object.userData.ignoreRangeMarker) continue;
        chosen = h;
        hitPoint = chosen.point.clone();
        break;
      }
    }
    
    if (!chosen) return;

    this._clearMarkerImmediate();

    const distUnits = origin.distanceTo(hitPoint);
    const meters = distUnits / this.unitsPerMeter;
    let text = `${meters.toFixed(2)} m`;
    if (playerHit) {
      text += ' (PLAYER)';
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 512;
    canvas.height = 128;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = '64px monospace';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    const texture = new this._THREE.CanvasTexture(canvas);
    texture.minFilter = this._THREE.LinearFilter;
    texture.magFilter = this._THREE.LinearFilter;

    const markerGeometry = new this._THREE.PlaneGeometry(1, 0.25);
    const markerMaterial = new this._THREE.MeshBasicMaterial({
      map: texture,
      side: this._THREE.DoubleSide,
      transparent: true,
      opacity: 0.8
    });
    const marker = new this._THREE.Mesh(markerGeometry, markerMaterial);

    // Position the marker at the hit point in world space
    marker.position.copy(hitPoint);

    // Set its render order to render on top
    marker.renderOrder = 999;
    marker.onBeforeRender = (renderer) => renderer.clearDepth();

    // Add the marker to the scene
    this.scene.add(marker);

    this._marker = marker;
    this._markerStartTime = performance.now();
  }

  update() {
    if (!this._marker) return;

    // Make the marker always face the camera
    this.camera.updateMatrixWorld();
    this._marker.lookAt(this.camera.position);

    const fadeDuration = 5000;
    const elapsed = performance.now() - this._markerStartTime;

    if (elapsed >= fadeDuration) {
      this._clearMarkerImmediate();
      return;
    }

    const opacity = this._THREE.MathUtils.lerp(0.8, 0, elapsed / fadeDuration);
    if (this._marker.material.opacity !== opacity) {
      this._marker.material.opacity = opacity;
    }
  }

  _clearMarkerImmediate() {
    if (!this._marker) return;

    if (this._marker.parent) {
      this._marker.parent.remove(this._marker);
    }

    if (this._marker.geometry) this._marker.geometry.dispose();
    if (this._marker.material) {
        if (this._marker.material.map) this._marker.material.map.dispose();
        this._marker.material.dispose();
    }
    this._marker = null;
  }

  dispose() {
    if (this.autoListenKey) window.removeEventListener('keydown', this._onKeyDown);
    this._clearMarkerImmediate();
  }
}

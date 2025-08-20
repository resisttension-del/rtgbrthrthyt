/**
 * Minimal standalone range marker (self-contained raycast logic).
 *
 * This version creates a 3D THREE.Mesh in the scene, similar to a bullet hole.
 *
 * Usage:
 * import RangeMarker from './RangeMarker.js';
 * const rm = new RangeMarker({
 * camera,           // THREE.Camera (required)
 * renderer,         // THREE.WebGLRenderer (required)
 * scene,            // THREE.Scene (required for raycasting and adding marker)
 * unitsPerMeter: 1,  // game units per meter - default 1
 * autoListenKey: true, // listen for 't' automatically
 * defaultDistance: 1000, // max ray distance (world units)
 * THREE,            // Pass THREE from your project's import
 * });
 *
 * // Note: No need to call rm.update() in your RAF loop anymore.
 *
 * // cleanup:
 * rm.dispose();
 */
export default class RangeMarker {
  constructor(opts = {}) {
    if (!opts.camera) throw new Error('RangeMarker: camera required');
    if (!opts.renderer) throw new Error('RangeMarker: renderer required');
    if (!opts.scene) throw new Error('RangeMarker: scene required for 3D marker');

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

    // The marker is now a THREE.Object3D
    this._marker = null;

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
    let hitNormal = null;

    if (playerHit) {
      chosen = playerHit;
      hitPoint = playerHit.intersection;
      // You may need a more accurate normal calculation for player models
      hitNormal = direction.clone().negate();
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
        hitNormal = (chosen.face && chosen.object) ? chosen.face.normal.clone().transformDirection(chosen.object.matrixWorld).normalize() : direction.clone().negate();
        break;
      }
    }
    
    if (!chosen) return;

    // Remove any existing marker before creating a new one
    this._clearMarkerImmediate();

    // Create the 3D text/mesh for the marker
    const distUnits = origin.distanceTo(hitPoint);
    const meters = distUnits / this.unitsPerMeter;
    const text = `${meters.toFixed(2)} m`;

    const markerGeometry = new this._THREE.PlaneGeometry(1, 0.2); // Adjust size as needed
    const markerMaterial = new this._THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: this._THREE.DoubleSide,
      transparent: true,
      opacity: 0.8
    });
    const marker = new this._THREE.Mesh(markerGeometry, markerMaterial);

    // This part is the most critical: position and orient the marker
    marker.position.copy(hitPoint);
    marker.lookAt(new this._THREE.Vector3().addVectors(marker.position, hitNormal));
    marker.position.addScaledVector(hitNormal, 0.001); // Offset to avoid z-fighting

    // A simple way to add text. You'll need a way to render text as a texture.
    // This is a placeholder; you'd need to replace this with your actual text rendering logic.
    // For example, using THREE.TextGeometry, troika-three-text, or a canvas texture.
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 512;
    canvas.height = 64;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = '32px monospace';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    const texture = new this._THREE.CanvasTexture(canvas);
    marker.material.map = texture;
    marker.material.needsUpdate = true;
    
    // Add the marker to the scene
    this.scene.add(marker);
    this._marker = marker;

    // Use setTimeout for a delayed removal, similar to your bullet hole fade
    setTimeout(() => {
      this._clearMarkerImmediate();
    }, 5000);
  }

  // No longer needed since the marker is a static mesh
  update() {}

  _clearMarkerImmediate() {
    if (!this._marker) return;
    this.scene.remove(this._marker);
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

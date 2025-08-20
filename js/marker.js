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
      // approximate normal facing the camera
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

    // Prepare text (distance)
    const distUnits = origin.distanceTo(hitPoint);
    const meters = distUnits / this.unitsPerMeter;
    const text = `${meters.toFixed(2)} m`;

    // Create canvas texture for readable text
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = '32px monospace';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    const texture = new this._THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    texture.minFilter = this._THREE.LinearFilter;
    texture.generateMipmaps = false;

    // Plane for marker (aspect ratio matches canvas)
    const aspect = canvas.width / canvas.height;
    const baseHeight = 0.2; // adjust visual size
    const markerGeometry = new this._THREE.PlaneGeometry(baseHeight * aspect, baseHeight);

    const markerMaterial = new this._THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.95,
      side: this._THREE.DoubleSide,
      // the critical bits that force draw-on-top:
      depthTest: false,
      depthWrite: false,
    });

    const marker = new this._THREE.Mesh(markerGeometry, markerMaterial);

    // Position: slightly above the surface to avoid z-fighting
    const offset = hitNormal.clone().multiplyScalar(0.01); // small offset
    marker.position.copy(hitPoint).add(offset);

    // Keep the surface normal in userData (if you need it later)
    marker.userData.surfaceNormal = hitNormal.clone();

    // Ensure it's rendered last / on top
    marker.renderOrder = 0x7fffffff; // very large number

    // Keep references for closures
    const self = this;
    const THREE = this._THREE;

    // Make the marker always face the camera/player and ensure it's drawn on top.
    // We use onBeforeRender which runs every frame for this mesh.
    marker.onBeforeRender = function (renderer, scene, camera) {
      // compute unit vector from marker to camera
      const toCam = new THREE.Vector3().subVectors(camera.position, this.position).normalize();

      // Compute quaternion that rotates plane's +Z (0,0,1) to point toward camera
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), toCam);
      this.quaternion.copy(q);

      // Optionally, you might want the text always upright in Y (no roll).
      // To keep the marker upright (preserve Y axis up), zero out roll:
      const euler = new THREE.Euler().setFromQuaternion(this.quaternion, 'YXZ');
      euler.z = 0; // remove roll
      this.quaternion.setFromEuler(euler);

      // Ensure marker renders on top by clearing depth before it draws.
      // This is a small, localized trick; it keeps the rest of the scene's depth intact
      // because we clear depth just before rendering this mesh.
      renderer.clearDepth();
    };

    // Scale with distance a bit so text stays readable (tweak multiplier as desired)
    const scaleFactor = Math.max(0.6, meters * 0.03);
    marker.scale.setScalar(scaleFactor);

    // Add to scene and track
    this.scene.add(marker);
    this._marker = marker;

    // Auto remove after 5s (you can change)
    setTimeout(() => {
      this._clearMarkerImmediate();
    }, 5000);
  }

  // No longer needed since marker handles its own onBeforeRender billboarding
  update() {}

  _clearMarkerImmediate() {
    if (!this._marker) return;

    // Clear per-frame hook to avoid lingering functions
    try {
      this._marker.onBeforeRender = null;
    } catch (e) {}

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

/**
 * Minimal standalone range marker (self-contained raycast logic).
 *
 * Usage:
 * import RangeMarker from './RangeMarker.js';
 * const rm = new RangeMarker({
 * camera,           // THREE.Camera (required)
 * renderer,         // THREE.WebGLRenderer (required)
 * scene,            // THREE.Scene (required for raycasting)
 * unitsPerMeter: 1,  // game units per meter - default 1
 * domParent: document.body,
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

    this.camera = opts.camera;
    this.renderer = opts.renderer;
    this.scene = opts.scene || null;
    this.unitsPerMeter = (opts.unitsPerMeter && Number(opts.unitsPerMeter) > 0) ? Number(opts.unitsPerMeter) : 1;
    this.domParent = opts.domParent || document.body;
    this.autoListenKey = (opts.autoListenKey === undefined) ? true : Boolean(opts.autoListenKey);
    this.defaultDistance = (opts.defaultDistance && Number(opts.defaultDistance) > 0) ? Number(opts.defaultDistance) : 1000;

    // Accept THREE via opts (useful in some module setups) or fall back to global
    this._THREE = opts.THREE || (typeof THREE !== 'undefined' ? THREE : null);
    if (!this._THREE) {
      console.warn('RangeMarker: THREE not found; marker will be disabled.');
    }

    // internal marker state
    this._marker = null; // { dom, worldPos: Vector3, timeoutId }

    this._injectStyles();

    this._onKeyDown = this._onKeyDown.bind(this);
    if (this.autoListenKey) window.addEventListener('keydown', this._onKeyDown);

    // internal raycaster
    if (this._THREE && this._THREE.Raycaster) {
      this._raycaster = new this._THREE.Raycaster();
      this._raycaster.near = 0.0001;
      this._raycaster.far = this.defaultDistance;
    } else {
      this._raycaster = null;
    }
  }

  _injectStyles() {
    if (document.getElementById('rm-styles')) return;
    const s = document.createElement('style');
    s.id = 'rm-styles';
    s.textContent = `
      .rm-marker {
        position: absolute;
        pointer-events: none;
        transform: translate(-50%, -120%);
        background: rgba(0,0,0,0.72);
        color: #fff;
        padding: 6px 8px;
        border-radius: 6px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, "Roboto Mono", monospace;
        font-size: 13px;
        white-space: nowrap;
        z-index: 2147483647;
        box-shadow: 0 2px 6px rgba(0,0,0,0.45);
      }
      .rm-marker .val { font-weight: 700; }
      .rm-marker .unit { margin-left:6px; opacity:0.9; }
    `;
    document.head.appendChild(s);
  }

  _onKeyDown(ev) {
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
    if (ev.repeat) return;
    if (ev.key === 't' || ev.key === 'T') {
      this.placeMarker();
    }
  }

  /**
   * Build a conservative list of candidate meshes to raycast against.
   * We include visible Mesh/InstancedMesh objects that have geometry.
   * This avoids hitting common non-surface objects (helpers, cameras, lights).
   * Note: This is an internal helper and will not be used in the new logic,
   * but is kept for compatibility.
   */
  _collectCandidates() {
    const candidates = [];
    if (!this.scene || !this._THREE) return candidates;
    this.scene.traverse((o) => {
      // include Mesh and InstancedMesh only, and only if visible and has geometry
      if ((o.isMesh || o.isInstancedMesh) && o.visible && o.geometry) {
        // optional: skip explicit markers (allow user to add userData.ignoreRangeMarker = true)
        if (o.userData && o.userData.ignoreRangeMarker) return;
        candidates.push(o);
      }
    });
    return candidates;
  }
  
  /**
   * New logic to check for a hit against remote players, just like a bullet.
   */
  _checkPlayerHit(origin, direction) {
    let closest = null;
    if (!window.remotePlayers) return null;

    for (const rp of Object.values(window.remotePlayers)) {
      const meshes = [];
      if (rp.bodyMesh) meshes.push(rp.bodyMesh);
      if (rp.headMesh) meshes.push(rp.headMesh);

      for (const mesh of meshes) {
        // We'll skip the boundsTree check here for simplicity, assuming the raycaster
        // can handle standard geometry. If you use a BVH, you'll need to adapt this.
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

  /**
   * Place marker using camera + built-in raycast logic.
   * This version prioritizes player hits first, then falls back to the world.
   */
  placeMarker() {
    if (!this._THREE || !this._raycaster || !this.scene) {
      return;
    }

    this.camera.updateMatrixWorld();

    const origin = new this._THREE.Vector3().setFromMatrixPosition(this.camera.matrixWorld);
    const direction = new this._THREE.Vector3();
    this.camera.getWorldDirection(direction);

    // Set the raycaster with the camera's new origin and direction
    this._raycaster.set(origin, direction);
    this._raycaster.far = Number.isFinite(this.defaultDistance) ? this.defaultDistance : this._raycaster.far;

    // First, check for a hit on a remote player
    const playerHit = this._checkPlayerHit(origin, direction);

    let chosen = null;
    let markerWorldPos = null;
    let distUnits = null;

    if (playerHit) {
      chosen = playerHit;
      markerWorldPos = playerHit.intersection;
      distUnits = playerHit.distance;
    } else {
      // If no player hit, check against the general scene
      const candidates = this._collectCandidates();
      if (!candidates.length) return;

      const hits = this._raycaster.intersectObjects(candidates, true);
      if (!hits || !hits.length) {
        return;
      }

      // Find first valid hit
      for (let i = 0; i < hits.length; i++) {
        const h = hits[i];
        if (!h) continue;
        if (!isFinite(h.distance) || !h.point) continue;
        const p = h.point;
        if (!isFinite(p.x) || !isFinite(p.y) || !isFinite(p.z)) continue;
        if (h.object && h.object.userData && h.object.userData.ignoreRangeMarker) continue;
        chosen = h;
        markerWorldPos = chosen.point.clone();
        distUnits = origin.distanceTo(markerWorldPos);
        break;
      }
    }
    
    if (!chosen) return;
    if (distUnits == null || !isFinite(distUnits)) return;

    // Remove existing marker
    if (this._marker) this._clearMarkerImmediate();

    const meters = distUnits / this.unitsPerMeter;

    // create DOM element
    const dom = document.createElement('div');
    dom.className = 'rm-marker';
    let textContent = `<span class="val">${meters.toFixed(2)}</span><span class="unit">m</span>`;
    if (playerHit) {
      // Add a special label for player hits
      textContent += `<span> (Player Hit)</span>`;
    }
    dom.innerHTML = textContent;
    this.domParent.appendChild(dom);

    this._marker = {
      dom,
      worldPos: markerWorldPos,
      timeoutId: null
    };

    // auto remove after 5 seconds
    this._marker.timeoutId = setTimeout(() => this._clearMarkerImmediate(), 5000);

    // position right away so it appears immediately
    this._positionMarkerDOM();
  }

  _clearMarkerImmediate() {
    if (!this._marker) return;
    if (this._marker.timeoutId) { clearTimeout(this._marker.timeoutId); this._marker.timeoutId = null; }
    if (this._marker.dom && this._marker.dom.parentNode) this._marker.dom.parentNode.removeChild(this._marker.dom);
    this._marker = null;
  }

  /**
   * Call every frame so the DOM marker follows the world point and updates distance.
   */
  update() {
    if (!this._marker) return;
    this._positionMarkerDOM();
  }

  _positionMarkerDOM() {
    if (!this._marker) return;
    const cam = this.camera;
    const renderer = this.renderer;
    const dom = this._marker.dom;
    const wp = this._marker.worldPos;
    if (!cam || !renderer || !dom || !wp || !this._THREE) return;

    // Project to NDC using THREE
    const worldPt = (wp.clone) ? wp.clone() : new this._THREE.Vector3(wp.x, wp.y, wp.z);
    const v = worldPt.clone();
    v.project(cam);

    // guard against invalid projections
    if (!isFinite(v.x) || !isFinite(v.y) || !isFinite(v.z)) {
      dom.style.display = 'none';
      return;
    }

    // compute camera position and forward direction (world space)
    let camPos;
    let camForward;
    try {
      camPos = new this._THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
      camForward = new this._THREE.Vector3();
      cam.getWorldDirection(camForward); // normalized forward
    } catch (e) {
      dom.style.display = 'none';
      return;
    }

    // hide if point is behind the camera
    const vecToPoint = worldPt.clone().sub(camPos);
    if (camForward.dot(vecToPoint) <= 0) {
      dom.style.display = 'none';
      return;
    }

    // hide if offscreen in X/Y NDC (allow small margin)
    if (v.x < -1.05 || v.x > 1.05 || v.y < -1.05 || v.y > 1.05) {
      dom.style.display = 'none';
      return;
    }

    const canvas = renderer.domElement;
    const cw = canvas.clientWidth || canvas.width || window.innerWidth;
    const ch = canvas.clientHeight || canvas.height || window.innerHeight;

    const sx = (v.x * 0.5 + 0.5) * cw;
    const sy = (-v.y * 0.5 + 0.5) * ch;

    dom.style.display = '';
    dom.style.left = `${sx}px`;
    dom.style.top = `${sy}px`;

    // update distance text live
    let camPosForDist;
    try {
      camPosForDist = new this._THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
    } catch (e) {
      camPosForDist = { x: 0, y: 0, z: 0, distanceTo() { return 0; } };
    }
    const distUnits = camPosForDist.distanceTo ? camPosForDist.distanceTo(worldPt) : Math.hypot(camPosForDist.x - worldPt.x, camPosForDist.y - worldPt.y, camPosForDist.z - worldPt.z);
    const meters = distUnits / this.unitsPerMeter;
    const val = dom.querySelector('.val');
    if (val) val.textContent = meters.toFixed(2);
  }

  dispose() {
    if (this.autoListenKey) window.removeEventListener('keydown', this._onKeyDown);
    this._clearMarkerImmediate();
  }
}

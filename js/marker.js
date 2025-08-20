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
 * // NOTE: No need to call rm.update() in your RAF loop anymore.
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

    this._THREE = opts.THREE || (typeof THREE !== 'undefined' ? THREE : null);
    if (!this._THREE) {
      console.warn('RangeMarker: THREE not found; marker will be disabled.');
    }

    this._marker = null;

    this._injectStyles();

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

    // The key change: The camera's matrix is only updated here, just before the raycast.
    this.camera.updateMatrixWorld();

    const origin = new this._THREE.Vector3().setFromMatrixPosition(this.camera.matrixWorld);
    const direction = new this._THREE.Vector3();
    this.camera.getWorldDirection(direction);

    this._raycaster.set(origin, direction);
    this._raycaster.far = Number.isFinite(this.defaultDistance) ? this.defaultDistance : this._raycaster.far;

    const playerHit = this._checkPlayerHit(origin, direction);

    let chosen = null;
    let markerWorldPos = null;
    let distUnits = null;

    if (playerHit) {
      chosen = playerHit;
      markerWorldPos = playerHit.intersection;
      distUnits = playerHit.distance;
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
        markerWorldPos = chosen.point.clone();
        distUnits = origin.distanceTo(markerWorldPos);
        break;
      }
    }
    
    if (!chosen) return;
    if (distUnits == null || !isFinite(distUnits)) return;

    if (this._marker) this._clearMarkerImmediate();

    const meters = distUnits / this.unitsPerMeter;

    const dom = document.createElement('div');
    dom.className = 'rm-marker';
    let textContent = `<span class="val">${meters.toFixed(2)}</span><span class="unit">m</span>`;
    if (playerHit) {
      textContent += `<span> (Player Hit)</span>`;
    }
    dom.innerHTML = textContent;
    this.domParent.appendChild(dom);

    this._marker = {
      dom,
      worldPos: markerWorldPos,
      timeoutId: null
    };

    this._marker.timeoutId = setTimeout(() => this._clearMarkerImmediate(), 5000);

    // Position the marker once, just like a bullet hole is created once.
    this._positionMarkerDOM();
  }

  _clearMarkerImmediate() {
    if (!this._marker) return;
    if (this._marker.timeoutId) { clearTimeout(this._marker.timeoutId); this._marker.timeoutId = null; }
    if (this._marker.dom && this._marker.dom.parentNode) this._marker.dom.parentNode.removeChild(this._marker.dom);
    this._marker = null;
  }

  // The update() method is now a no-op since the marker is static.
  update() {
    // We no longer update the marker's position every frame.
    // Its position is "baked" at the time of placement, just like a bullet hole.
  }

  _positionMarkerDOM() {
    if (!this._marker) return;
    const cam = this.camera;
    const renderer = this.renderer;
    const dom = this._marker.dom;
    const wp = this._marker.worldPos;
    if (!cam || !renderer || !dom || !wp || !this._THREE) return;

    // Get the camera's current state for this one-time projection.
    // This is the same logic as your bullet raycast.
    cam.updateMatrixWorld();

    const worldPt = (wp.clone) ? wp.clone() : new this._THREE.Vector3(wp.x, wp.y, wp.z);
    const v = worldPt.clone();
    v.project(cam);

    if (!isFinite(v.x) || !isFinite(v.y) || !isFinite(v.z)) {
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

    // The distance text is also calculated only once during placement.
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

// marker.js
/**
 * Minimal standalone range marker.
 *
 * Usage:
 *   import RangeMarker from './marker.js';
 *   const rm = new RangeMarker({
 *     camera,           // THREE.Camera (required)
 *     renderer,         // THREE.WebGLRenderer (required)
 *     scene,            // THREE.Scene (optional) used for raycast intersections
 *     unitsPerMeter: 1, // game units per meter (100 for Unreal) - default 1
 *     domParent: document.body,
 *     autoListenKey: true,   // listen for 't' automatically
 *     defaultDistance: 1000, // fallback distance (game units) when no hit
 *   });
 *
 *   // in your RAF loop:
 *   rm.update();
 *
 *   // cleanup:
 *   rm.dispose();
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
      console.warn('RangeMarker: THREE not found globally; pass { THREE } in options to avoid errors.');
    }

    // internal marker state
    this._marker = null; // { dom, worldPos: Vector3 plain or THREE.Vector3, timeoutId }

    this._injectStyles();

    this._onKeyDown = this._onKeyDown.bind(this);
    if (this.autoListenKey) window.addEventListener('keydown', this._onKeyDown);

    // raycaster if THREE available
    if (this._THREE && this._THREE.Raycaster) {
      this._raycaster = new this._THREE.Raycaster();
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
   * Place/replace the marker:
   * - Raycasts forward from camera (if scene + THREE available) and uses first hit.
   * - Otherwise places at camera forward * defaultDistance.
   */
/**
   * Place/replace the marker:
   * - Raycasts forward from camera (if scene + THREE available) and uses first hit.
   * - Otherwise places at camera forward * defaultDistance.
   */
  placeMarker() {
    // compute camera world position
    this.camera.updateMatrixWorld();

    let camPos;
    try {
      camPos = new this._THREE.Vector3().setFromMatrixPosition(this.camera.matrixWorld);
    } catch (e) {
      // fallback without THREE (unlikely): try reading matrixWorld elements or default zero
      camPos = { x: 0, y: 0, z: 0, clone() { return { x: this.x, y: this.y, z: this.z }; } };
      try {
        const e = this.camera.matrixWorld.elements;
        camPos.x = e[12]; camPos.y = e[13]; camPos.z = e[14];
      } catch (err) { /* leave zero */ }
    }

    // compute forward direction
    let dir;
    if (this._THREE && this._THREE.Vector3 && typeof this.camera.getWorldDirection === 'function') {
      dir = new this._THREE.Vector3();
      this.camera.getWorldDirection(dir); // normalized vector pointing -Z camera space -> world
    } else {
      // fallback: assume forward is -Z in camera space (not great)
      dir = { x: 0, y: 0, z: -1, clone() { return { x: this.x, y: this.y, z: this.z }; } };
      try {
        // attempt to read camera quaternion if present
        if (this.camera.quaternion && this._THREE && this._THREE.Vector3) {
          dir = new this._THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
        }
      } catch (e) {}
    }

    // Try raycast if we have scene and THREE
    let markerWorldPos = null;
    if (this._raycaster && this.scene) {
      try {
        this._raycaster.set(camPos, dir);
        const hits = this._raycaster.intersectObjects(this.scene.children, true);
        if (hits && hits.length) {
          markerWorldPos = hits[0].point.clone ? hits[0].point.clone() : { x: hits[0].point.x, y: hits[0].point.y, z: hits[0].point.z };
        }
      } catch (e) {
        // fall through to default placement
        markerWorldPos = null;
      }
    }
    
    // ----------------------
    // ADDED LOGIC: Check for a hit before proceeding
    if (!markerWorldPos) {
        // If there's no hit, clear any existing marker and do not place a new one.
        this._clearMarkerImmediate();
        return;
    }
    // ----------------------

    // Replace existing marker
    if (this._marker) this._clearMarkerImmediate();

    // compute distance (units -> meters)
    const distUnits = (typeof camPos.distanceTo === 'function')
      ? camPos.distanceTo(markerWorldPos)
      : Math.hypot(camPos.x - markerWorldPos.x, camPos.y - markerWorldPos.y, camPos.z - markerWorldPos.z);
    const meters = distUnits / this.unitsPerMeter;

    // create DOM element
    const dom = document.createElement('div');
    dom.className = 'rm-marker';
    dom.innerHTML = `<span class="val">${meters.toFixed(2)}</span><span class="unit">m</span>`;
    this.domParent.appendChild(dom);

    this._marker = {
      dom,
      worldPos: (markerWorldPos.clone ? markerWorldPos.clone() : { x: markerWorldPos.x, y: markerWorldPos.y, z: markerWorldPos.z }),
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
    if (!cam || !renderer || !dom || !wp) return;

    // Project to NDC using THREE if available
    if (this._THREE && this._THREE.Vector3) {
      // get world vector for point
      const worldPt = (wp.clone) ? wp.clone() : new this._THREE.Vector3(wp.x, wp.y, wp.z);

      // project point to normalized device coordinates
      const v = worldPt.clone();
      v.project(cam);

      // compute camera position and forward direction (world space)
      let camPos;
      let camForward;
      try {
        camPos = new this._THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
        camForward = new this._THREE.Vector3();
        cam.getWorldDirection(camForward); // normalized forward (points where camera looks)
      } catch (e) {
        // if we can't compute camera world data, hide
        dom.style.display = 'none';
        return;
      }

      // hide if point is actually behind the camera (use dot product on world vectors)
      const vecToPoint = worldPt.clone().sub(camPos);
      if (camForward.dot(vecToPoint) <= 0) {
        dom.style.display = 'none';
        return;
      }

      // hide if offscreen in X/Y NDC (allow a small margin)
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

      // update distance
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

    } else {
      // no THREE available — hide marker (can't project)
      dom.style.display = 'none';
    }
  }

  dispose() {
    if (this.autoListenKey) window.removeEventListener('keydown', this._onKeyDown);
    this._clearMarkerImmediate();
  }
}

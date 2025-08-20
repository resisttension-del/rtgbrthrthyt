

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
      // set a sensible near distance
      this._raycaster.near = 0.0001;
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
      this.camera.getWorldDirection(dir); // normalized vector pointing where the camera looks
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
    let hit = false;
    if (this._raycaster && this.scene) {
      try {
        // ensure scene world matrices are up-to-date (important!)
        if (typeof this.scene.updateMatrixWorld === 'function') {
          this.scene.updateMatrixWorld(true);
        }

        // Prepare origin and direction as THREE.Vector3
        const origin = (camPos && typeof camPos.clone === 'function') ? camPos.clone() : new this._THREE.Vector3(camPos.x || 0, camPos.y || 0, camPos.z || 0);
        let direction = (dir && typeof dir.clone === 'function') ? dir.clone() : new this._THREE.Vector3(dir.x || 0, dir.y || 0, dir.z || -1);

        // normalize direction (raycaster expects normalized direction)
        if (typeof direction.normalize === 'function') direction.normalize();

        // set the ray and limit its far distance to avoid extremely distant hits
        this._raycaster.set(origin, direction);
        if (Number.isFinite(this.defaultDistance)) {
          // defaultDistance is in world units; clamp to it
          this._raycaster.far = this.defaultDistance;
        } else {
          // safety fallback: large but finite number
          this._raycaster.far = 1e8;
        }

        // collect candidate objects - avoid testing sky / invisible / non-mesh huge things
        const candidates = [];
        this.scene.traverse((o) => {
          // include Mesh and InstancedMesh and only visible objects
          if ((o.isMesh || o.isInstancedMesh) && o.visible) candidates.push(o);
        });

        const hits = this._raycaster.intersectObjects(candidates, true);

        if (hits && hits.length) {
          // find the first valid hit within the far limit and with finite distance
          const good = hits.find(h => Number.isFinite(h.distance) && h.distance <= this._raycaster.far);
          if (good && good.point) {
            markerWorldPos = (good.point.clone) ? good.point.clone() : { x: good.point.x, y: good.point.y, z: good.point.z };
            hit = true;
          } else {
            hit = false;
          }
        } else {
          hit = false;
        }
      } catch (e) {
        // on any error, treat as no hit
        hit = false;
      }
    }

    // Now check if a hit occurred anywhere in the process
    if (!hit) {
      // No hit — do nothing (leave any existing marker in place) and do not add a new one.
      return;
    }

    // Replace existing marker
    if (this._marker) this._clearMarkerImmediate();

    // compute distance (units -> meters)
    const distUnits = (typeof camPos.distanceTo === 'function' && markerWorldPos && markerWorldPos.clone)
      ? camPos.distanceTo(markerWorldPos)
      : (markerWorldPos && typeof markerWorldPos.x === 'number'
          ? Math.hypot(camPos.x - markerWorldPos.x, camPos.y - markerWorldPos.y, camPos.z - markerWorldPos.z)
          : null);

    // if the distance can't be determined (null / NaN / Infinity), do not add a marker
    if (distUnits == null || !isFinite(distUnits)) return;

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

// three-range-marker-standalone.js
/**
 * Standalone RangeMarker module (ES module)
 *
 * Usage:
 *   import RangeMarker from './three-range-marker-standalone.js';
 *   const rm = new RangeMarker({
 *     camera,                 // THREE.Camera
 *     renderer,               // THREE.WebGLRenderer
 *     getSpreadDirection,     // function(spreadAngle, camera) -> THREE.Vector3
 *     checkBulletPenetration, // function(origin, direction, maxHits) -> traj (like your fireBullet)
 *     stats: { tracerLength },// optional fallback
 *     unitsPerMeter: 1,       // 100 for Unreal (100 units = 1m)
 *     domParent: document.body,// optional
 *     autoListenKey: true     // default true (listens for 'z' key)
 *   });
 *
 *   // In your main loop:
 *   rm.update(); // call each frame
 *
 *   // Manual place:
 *   rm.placeMarker(spreadAngle);
 *
 *   // Remove & stop listening:
 *   rm.dispose();
 */

export default class RangeMarker {
  constructor(opts = {}) {
    if (!opts.camera) throw new Error('RangeMarker: camera required');
    if (!opts.renderer) throw new Error('RangeMarker: renderer required');
    if (typeof opts.getSpreadDirection !== 'function') throw new Error('RangeMarker: getSpreadDirection required');
    if (typeof opts.checkBulletPenetration !== 'function') throw new Error('RangeMarker: checkBulletPenetration required');

    this.camera = opts.camera;
    this.renderer = opts.renderer;
    this.getSpreadDirection = opts.getSpreadDirection;
    this.checkBulletPenetration = opts.checkBulletPenetration;
    this.stats = opts.stats || {};
    this.unitsPerMeter = (opts.unitsPerMeter && Number(opts.unitsPerMeter) > 0) ? Number(opts.unitsPerMeter) : 1;
    this.domParent = opts.domParent || document.body;
    this.autoListenKey = (opts.autoListenKey === undefined) ? true : Boolean(opts.autoListenKey);
    this.placementSpread = opts.placementSpread || 0;
    this._THREE = opts.THREE || (typeof THREE !== 'undefined' ? THREE : null);
    if (!this._THREE) {
      console.warn('RangeMarker: THREE not found globally; pass { THREE } in options to avoid errors.');
    }

    this._marker = null; // { dom, worldPos: Vector3, timeoutId }

    this._injectStyles();

    this._onKeyDown = this._onKeyDown.bind(this);
    if (this.autoListenKey) window.addEventListener('keydown', this._onKeyDown);

    // small tmp vector for reuse
    this._tmpV = this._makeVec3();
  }

  _makeVec3(x=0,y=0,z=0){
    if (this._THREE && this._THREE.Vector3) return new this._THREE.Vector3(x,y,z);
    // minimal fallback
    return { x, y, z, clone(){ return { x:this.x,y:this.y,z:this.z }; },
      project(){ return this; },
      set(x2,y2,z2){ this.x=x2; this.y=y2; this.z=z2; return this; },
      distanceTo(o){ const dx=this.x-o.x, dy=this.y-o.y, dz=this.z-o.z; return Math.sqrt(dx*dx+dy*dy+dz*dz); }
    };
  }

  _injectStyles(){
    if (document.getElementById('rm-standalone-styles')) return;
    const s = document.createElement('style');
    s.id = 'rm-standalone-styles';
    s.textContent = `
      .rm-marker {
        position: absolute;
        pointer-events: none;
        transform: translate(-50%, -120%);
        background: rgba(0,0,0,0.7);
        color: #fff;
        padding: 6px 8px;
        border-radius: 6px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, "Roboto Mono", monospace;
        font-size: 13px;
        white-space: nowrap;
        z-index: 2147483647;
        box-shadow: 0 2px 6px rgba(0,0,0,0.5);
      }
      .rm-marker .val { font-weight: 700; }
      .rm-marker .unit { margin-left:6px; opacity:0.9; }
    `;
    document.head.appendChild(s);
  }

  _onKeyDown(ev){
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
    if (ev.repeat) return;
    if (ev.key === 'z' || ev.key === 'Z') {
      this.placeMarker(this.placementSpread);
    }
  }

  // Public: place marker using same selection logic as fireBullet
  placeMarker(spreadAngle = 0){
    // compute origin
    this.camera.updateMatrixWorld();
    let origin;
    try {
      origin = new this._THREE.Vector3().setFromMatrixPosition(this.camera.matrixWorld);
    } catch(e){
      // fallback to manual read from matrixWorld.elements
      origin = this._makeVec3();
      try {
        const e = this.camera.matrixWorld.elements;
        origin.set(e[12], e[13], e[14]);
      } catch(err){
        console.warn('RangeMarker: failed to get camera position; using zero origin.');
        origin.set(0,0,0);
      }
    }

    const direction = this.getSpreadDirection(spreadAngle, this.camera);
    if (!direction) {
      console.warn('RangeMarker: getSpreadDirection returned falsy');
      return;
    }

    // perform penetration check (your function)
    let traj = null;
    try {
      traj = this.checkBulletPenetration(origin.clone ? origin.clone() : origin, direction.clone ? direction.clone() : direction, 1);
    } catch (err) {
      console.error('RangeMarker: checkBulletPenetration threw', err);
      return;
    }

    // pick endpoint exactly like your fireBullet
    let markerWorldPos = null;
    if (traj && traj.playerHitResult) {
      markerWorldPos = traj.playerHitResult.intersection ? (traj.playerHitResult.intersection.clone ? traj.playerHitResult.intersection.clone() : Object.assign({}, traj.playerHitResult.intersection)) : null;
    }
    if (!markerWorldPos) {
      if (traj && Array.isArray(traj.allWorldHits) && traj.allWorldHits.length) {
        const last = traj.allWorldHits[traj.allWorldHits.length - 1];
        markerWorldPos = last.point ? (last.point.clone ? last.point.clone() : Object.assign({}, last.point)) : null;
      } else {
        const maxDist = (this.stats && this.stats.tracerLength) ? this.stats.tracerLength : 1000;
        markerWorldPos = origin.clone ? origin.clone().add(direction.clone().multiplyScalar(maxDist))
                                      : { x: origin.x + direction.x * maxDist, y: origin.y + direction.y * maxDist, z: origin.z + direction.z * maxDist };
      }
    }

    if (!markerWorldPos) {
      console.warn('RangeMarker: could not determine marker world position');
      return;
    }

    // replace existing marker
    if (this._marker) this._clearMarkerImmediate();

    // create DOM element
    const distUnits = (origin.distanceTo) ? origin.distanceTo(markerWorldPos) : Math.hypot(origin.x-markerWorldPos.x, origin.y-markerWorldPos.y, origin.z-markerWorldPos.z);
    const distMeters = distUnits / this.unitsPerMeter;
    const dom = document.createElement('div');
    dom.className = 'rm-marker';
    dom.innerHTML = `<span class="val">${distMeters.toFixed(2)}</span><span class="unit">m</span>`;
    this.domParent.appendChild(dom);

    this._marker = {
      dom,
      worldPos: markerWorldPos.clone ? markerWorldPos.clone() : { x: markerWorldPos.x, y: markerWorldPos.y, z: markerWorldPos.z },
      timeoutId: null
    };

    // auto remove after 5s
    this._marker.timeoutId = setTimeout(()=> this._clearMarkerImmediate(), 5000);

    // immediate position update (so it appears right away)
    this._positionMarkerDOM();
  }

  _clearMarkerImmediate(){
    if (!this._marker) return;
    if (this._marker.timeoutId) { clearTimeout(this._marker.timeoutId); this._marker.timeoutId = null; }
    if (this._marker.dom && this._marker.dom.parentNode) this._marker.dom.parentNode.removeChild(this._marker.dom);
    this._marker = null;
  }

  // Call each frame (e.g. inside your RAF loop) so the DOM marker follows the camera
  update(){
    if (!this._marker) return;
    this._positionMarkerDOM();
  }

  _positionMarkerDOM(){
    if (!this._marker) return;
    const cam = this.camera;
    const r = this.renderer;
    const dom = this._marker.dom;
    const wp = this._marker.worldPos;
    if (!cam || !r || !dom || !wp) return;

    // use THREE Vector3 projection if available
    let v;
    if (this._THREE && this._THREE.Vector3) {
      v = (wp.clone) ? wp.clone() : new this._THREE.Vector3(wp.x, wp.y, wp.z);
      v.project(cam);
    } else {
      v = this._makeVec3(wp.x, wp.y, wp.z);
      // fallback: skip projection (best-effort) — hide instead
      dom.style.display = 'none';
      return;
    }

    // hide if behind camera or offscreen
    if (v.z < -1 || v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) {
      dom.style.display = 'none';
      return;
    }

    const canvas = r.domElement;
    const cw = canvas.clientWidth || canvas.width || window.innerWidth;
    const ch = canvas.clientHeight || canvas.height || window.innerHeight;

    const sx = (v.x * 0.5 + 0.5) * cw;
    const sy = (-v.y * 0.5 + 0.5) * ch;

    dom.style.display = '';
    dom.style.left = `${sx}px`;
    dom.style.top = `${sy}px`;

    // update distance in case camera moved
    let camPos;
    try {
      camPos = new this._THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
    } catch(e) {
      camPos = this._makeVec3();
      try {
        const e = cam.matrixWorld.elements;
        camPos.set(e[12], e[13], e[14]);
      } catch(err) {}
    }
    const distUnits = camPos.distanceTo ? camPos.distanceTo(wp) : Math.hypot(camPos.x-wp.x, camPos.y-wp.y, camPos.z-wp.z);
    const meters = distUnits / this.unitsPerMeter;
    const val = dom.querySelector('.val');
    if (val) val.textContent = meters.toFixed(2);
  }

  // stop listening and remove marker immediately
  dispose(){
    if (this.autoListenKey) window.removeEventListener('keydown', this._onKeyDown);
    this._clearMarkerImmediate();
  }
}

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
    this.markerDuration = (opts.markerDuration !== undefined && Number(opts.markerDuration) >= 0) ? Number(opts.markerDuration) : 10000;

    this._markerTimeoutId = null;
    this._THREE = opts.THREE || (typeof THREE !== 'undefined' ? THREE : null);
    if (!this._THREE) {
      console.warn('RangeMarker: THREE not found; marker will be disabled.');
    }

    this._marker = null;

    this._onKeyDown = this._onKeyDown.bind(this);
    if (this.autoListenKey) {
      window.addEventListener('keydown', this._onKeyDown);
      console.log('RangeMarker: key listener added (autoListenKey=true)');
    } else {
      console.log('RangeMarker: key listener not added (autoListenKey=false)');
    }

    if (this._THREE && this._THREE.Raycaster) {
      this._raycaster = new this._THREE.Raycaster();
      this._raycaster.near = 0.0001;
      this._raycaster.far = this.defaultDistance;
    } else {
      this._raycaster = null;
    }

    console.log('RangeMarker constructed', {
      defaultDistance: this.defaultDistance,
      markerDuration: this.markerDuration,
      hasTHREE: !!this._THREE,
      hasRaycaster: !!this._raycaster
    });
  }

  _onKeyDown(ev) {
    console.log('_onKeyDown', ev.key);
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
      console.log('_onKeyDown - ignored because focus is input/textarea/contentEditable', active.tagName);
      return;
    }
    if (ev.repeat) {
      console.log('_onKeyDown - ignored repeat');
      return;
    }
    if (ev.key === 'y' || ev.key === 'Y') {
      console.log('_onKeyDown - triggering placeMarker()');
      this.placeMarker();
    }
  }

  _collectCandidates() {
    const candidates = [];
    if (!this.scene || !this._THREE) {
      console.log('_collectCandidates - no scene or THREE');
      return candidates;
    }
    this.scene.traverse((o) => {
      if ((o.isMesh || o.isInstancedMesh) && o.visible && o.geometry) {
        if (o.userData && o.userData.ignoreRangeMarker) return;
        candidates.push(o);
      }
    });
    console.log('_collectCandidates - found candidates:', candidates.length);
    return candidates;
  }

  _checkPlayerHit(origin, direction) {
    let closest = null;
    if (!window.remotePlayers) {
      console.log('_checkPlayerHit - no window.remotePlayers');
      return null;
    }

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
    console.log('_checkPlayerHit - result:', closest ? { distance: closest.distance } : null);
    return closest;
  }

  placeMarker() {
    console.log('placeMarker() called', {
      hasThree: !!this._THREE,
      hasRaycaster: !!this._raycaster,
      hasScene: !!this.scene
    });

    if (!this._THREE || !this._raycaster || !this.scene) {
      console.log('placeMarker - exiting early: missing THREE/raycaster/scene', {
        hasThree: !!this._THREE,
        hasRaycaster: !!this._raycaster,
        hasScene: !!this.scene
      });
      return;
    }

    if (this._markerTimeoutId) {
      console.log('placeMarker - clearing previous timeout', this._markerTimeoutId);
      clearTimeout(this._markerTimeoutId);
      this._markerTimeoutId = null;
    }

    // Ensure camera world matrices are up to date
    this.camera.updateMatrixWorld();

    // origin & direction in world space
    const origin = new this._THREE.Vector3().setFromMatrixPosition(this.camera.matrixWorld);
    const direction = new this._THREE.Vector3();
    this.camera.getWorldDirection(direction);

    console.log('placeMarker - origin/direction', { origin: origin.clone(), direction: direction.clone() });

    this._raycaster.set(origin, direction);
    this._raycaster.far = Number.isFinite(this.defaultDistance) ? this.defaultDistance : this._raycaster.far;
    console.log('placeMarker - raycaster.far set to', this._raycaster.far);

    const playerHit = this._checkPlayerHit(origin, direction);

    let chosen = null;
    let hitPoint = null;
    let hitNormal = null;

    if (playerHit) {
      chosen = playerHit;
      hitPoint = playerHit.intersection;
      hitNormal = direction.clone().negate().normalize();
      console.log('placeMarker - playerHit chosen', { distance: playerHit.distance });
    } else {
      const candidates = this._collectCandidates();
      if (!candidates.length) {
        console.log('placeMarker - no candidates -> returning');
        return;
      }

      const hits = this._raycaster.intersectObjects(candidates, true);
      if (!hits || !hits.length) {
        console.log('placeMarker - hits empty -> returning');
        return;
      }

      // We'll compute robust hitNormal here, considering InstancedMesh and BufferGeometry.
      const tmpMat4 = new this._THREE.Matrix4();
      const tmpMat3 = new this._THREE.Matrix3();

      for (let i = 0; i < hits.length; i++) {
        const h = hits[i];
        if (!h) continue;
        if (!isFinite(h.distance) || !h.point) continue;
        const p = h.point;
        if (!isFinite(p.x) || !isFinite(p.y) || !isFinite(p.z)) continue;
        if (h.object && h.object.userData && h.object.userData.ignoreRangeMarker) continue;

        chosen = h;
        hitPoint = chosen.point.clone();

        try {
          // Debug logging for hit entries (temporary)
          // console.log('hit:', {
          //   object: chosen.object && (chosen.object.name || chosen.object.type),
          //   isInstanced: chosen.object && chosen.object.isInstancedMesh,
          //   instanceId: chosen.instanceId,
          //   face: !!chosen.face,
          //   distance: chosen.distance,
          //   point: chosen.point.clone()
          // });

          // Primary: if face normal provided, transform to world (and include instance transform)
          if (chosen.face && chosen.face.normal) {
            if (typeof chosen.instanceId === 'number' && chosen.object.isInstancedMesh) {
              chosen.object.getMatrixAt(chosen.instanceId, tmpMat4);
              tmpMat4.premultiply(chosen.object.matrixWorld);
              tmpMat3.getNormalMatrix(tmpMat4);
              hitNormal = chosen.face.normal.clone().applyMatrix3(tmpMat3).normalize();
            } else {
              tmpMat3.getNormalMatrix(chosen.object.matrixWorld);
              hitNormal = chosen.face.normal.clone().applyMatrix3(tmpMat3).normalize();
            }
          } else {
            // If face missing, attempt to derive average vertex normal from attributes
            const geom = chosen.object.geometry;
            if (geom && geom.isBufferGeometry) {
              // If geometry has no normals, compute them (mutates geometry; optional)
              if (!geom.attributes.normal) {
                try {
                  geom.computeVertexNormals();
                } catch (e) {
                  // ignore compute failure
                }
              }

              const nAttr = geom.attributes.normal;
              if (nAttr && chosen.face && typeof chosen.face.a === 'number') {
                try {
                  const na = new this._THREE.Vector3().fromBufferAttribute(nAttr, chosen.face.a);
                  const nb = new this._THREE.Vector3().fromBufferAttribute(nAttr, chosen.face.b);
                  const nc = new this._THREE.Vector3().fromBufferAttribute(nAttr, chosen.face.c);
                  hitNormal = new this._THREE.Vector3().addVectors(na, nb).add(nc).multiplyScalar(1 / 3).normalize();

                  if (typeof chosen.instanceId === 'number' && chosen.object.isInstancedMesh) {
                    chosen.object.getMatrixAt(chosen.instanceId, tmpMat4);
                    tmpMat4.premultiply(chosen.object.matrixWorld);
                    tmpMat3.getNormalMatrix(tmpMat4);
                    hitNormal.applyMatrix3(tmpMat3).normalize();
                  } else {
                    tmpMat3.getNormalMatrix(chosen.object.matrixWorld);
                    hitNormal.applyMatrix3(tmpMat3).normalize();
                  }
                } catch (e) {
                  hitNormal = null;
                }
              }
            }
          }
        } catch (err) {
          console.warn('RangeMarker: error computing hit normal', err);
          hitNormal = null;
        }

        // fallback to ray direction if all else fails
        if (!hitNormal) {
          hitNormal = direction.clone().negate().normalize();
          console.warn('RangeMarker: falling back to ray direction for surface normal');
        }

        console.log('placeMarker - geometry hit chosen', {
          distance: chosen.distance,
          point: hitPoint.clone(),
          hitNormal: hitNormal.clone()
        });

        break;
      }
    }

    if (!chosen) {
      console.log('placeMarker - nothing chosen -> returning');
      return;
    }

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
    const baseHeight = 2.0;
    const markerGeometry = new this._THREE.PlaneGeometry(baseHeight * aspect, baseHeight);

    const markerMaterial = new this._THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.95,
      side: this._THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });

    const marker = new this._THREE.Mesh(markerGeometry, markerMaterial);

    // Offset along the surface normal (so it sits slightly above the face)
    const offsetWorld = hitNormal.clone().multiplyScalar(0.05);
    const worldPosWithOffset = hitPoint.clone().add(offsetWorld);
    marker.position.copy(worldPosWithOffset);

    marker.userData.surfaceNormal = hitNormal.clone();

    // Ensure it's rendered last / on top
    marker.renderOrder = 0x7fffffff;

    const THREE = this._THREE;

    // Billboard so marker faces camera; keep upright relative to world Y
    marker.onBeforeRender = function (renderer, scene, camera) {
      // marker world position
      const worldPos = new THREE.Vector3();
      this.getWorldPosition(worldPos);

      // camera world position (make sure to use world position)
      const camWorldPos = new THREE.Vector3();
      camera.getWorldPosition(camWorldPos);

      // optional debug
      if (window.__RM_DEBUG__) {
        const camQuat = new THREE.Quaternion();
        camera.getWorldQuaternion(camQuat);
        console.log('RangeMarker debug - camWorldPos', camWorldPos, 'camQuat', camQuat.toArray());
      }

      // vector from marker to camera
      const toCam = new THREE.Vector3().subVectors(camWorldPos, worldPos).normalize();
      if (!isFinite(toCam.x) || !isFinite(toCam.y) || !isFinite(toCam.z)) return;

      // construct stable orthonormal basis keeping marker upright relative to world Y
      const worldUp = new THREE.Vector3(0, 1, 0);
      let right = new THREE.Vector3().crossVectors(worldUp, toCam);
      if (right.lengthSq() < 1e-8) {
        right = new THREE.Vector3(1, 0, 0);
      } else {
        right.normalize();
      }
      const up = new THREE.Vector3().crossVectors(toCam, right).normalize();

      const m = new THREE.Matrix4();
      m.makeBasis(right, up, toCam); // X = right, Y = up, Z = forward
      this.quaternion.setFromRotationMatrix(m);

      // keep it upright by clearing roll (optional but often desired)
      const e = new THREE.Euler().setFromQuaternion(this.quaternion, 'YXZ');
      e.z = 0;
      this.quaternion.setFromEuler(e);

      // ensure marker renders on top
      renderer.clearDepth();
    };

    // Scale with distance a bit so text stays readable
    const scaleFactor = Math.max(0.6, meters * 0.03);
    marker.scale.setScalar(scaleFactor);

    this.scene.add(marker);
    this._marker = marker;

    console.log('placeMarker - marker added to scene', {
      markerPositionLocal: marker.position.clone(),
      markerPositionWorld: (function () { const v = new THREE.Vector3(); marker.getWorldPosition(v); return v; })(),
      parent: marker.parent ? (marker.parent.name || marker.parent.type) : '(none)'
    });

    try {
      console.log('RangeMarker debug - hitPoint (world):', hitPoint.clone());
      console.log('RangeMarker debug - offsetWorld:', offsetWorld.clone());
      console.log('RangeMarker debug - marker.position (local):', marker.position.clone());
      const wp = new THREE.Vector3();
      marker.getWorldPosition(wp);
      console.log('RangeMarker debug - marker.getWorldPosition():', wp);
      console.log('RangeMarker debug - marker.parent:', marker.parent ? (marker.parent.name || marker.parent.type) : '(none)');
      if (!isFinite(wp.x) || !isFinite(wp.y) || !isFinite(wp.z)) {
        console.warn('RangeMarker debug - marker world position contains non-finite values', wp);
      }
    } catch (e) {
      console.log('RangeMarker debug - logging failed', e);
    }

    if (this.markerDuration > 0) {
      this._markerTimeoutId = setTimeout(() => {
        console.log('marker timeout firing - clearing marker');
        this._clearMarkerImmediate();
        this._markerTimeoutId = null;
      }, this.markerDuration);
      console.log('placeMarker - marker timeout set', this._markerTimeoutId, 'duration(ms):', this.markerDuration);
    } else {
      console.log('placeMarker - markerDuration set to 0 => marker will persist until cleared manually');
    }
  }

  // No longer needed since marker handles its own onBeforeRender billboarding
  update() {}

  _clearMarkerImmediate() {
    console.log('_clearMarkerImmediate called');
    if (this._markerTimeoutId) {
      console.log('_clearMarkerImmediate - clearing timeout', this._markerTimeoutId);
      clearTimeout(this._markerTimeoutId);
      this._markerTimeoutId = null;
    }

    if (!this._marker) {
      console.log('_clearMarkerImmediate - no marker to clear');
      return;
    }

    try {
      this._marker.onBeforeRender = null;
    } catch (e) {
      console.log('_clearMarkerImmediate - failed clearing onBeforeRender', e);
    }

    this.scene.remove(this._marker);
    if (this._marker.geometry) this._marker.geometry.dispose();
    if (this._marker.material) {
      if (this._marker.material.map) this._marker.material.map.dispose();
      this._marker.material.dispose();
    }
    console.log('_clearMarkerImmediate - marker removed/disposed');
    this._marker = null;
  }

  dispose() {
    if (this.autoListenKey) window.removeEventListener('keydown', this._onKeyDown);
    this._clearMarkerImmediate();
    console.log('RangeMarker disposed');
  }
}

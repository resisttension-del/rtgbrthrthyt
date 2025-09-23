import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";

export function voidEngine({ width = 1280, height = 720 } = {}) {
  // --- MAIN 2D CANVAS (what your code expects) ---
  const canvas = document.createElement('canvas');
  canvas.style.position = 'relative';
  canvas.style.zIndex = '0';
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // --- scratch vars used throughout (similar to original) ---
  const proj = new THREE.Vector3();
  const tmpPos = new THREE.Vector3();
  const tmpVec = new THREE.Vector3();
  const tmpVec2 = new THREE.Vector3();
  const tmpMat = new THREE.Matrix4();

  // convex hull helper (Andrew monotone chain) - identical to your original
  function convexHull(points) {
    if (points.length <= 1) return points.slice();
    const pts = points.slice().sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower = [];
    for (let p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    lower.pop();
    upper.pop();
    return lower.concat(upper);
  }

  // --- GPU DEPTH-PASS SETUP (hidden WebGL canvas + depth render target) ---
  const _depthCanvas = document.createElement('canvas'); // hidden (not appended)
  _depthCanvas.width = canvas.width;
  _depthCanvas.height = canvas.height;

  const _depthRenderer = new THREE.WebGLRenderer({
    canvas: _depthCanvas,
    antialias: false,
    alpha: false,
    preserveDrawingBuffer: false,
  });
  _depthRenderer.autoClear = true;
  _depthRenderer.setSize(canvas.width, canvas.height, false);

  let _depthTarget = new THREE.WebGLRenderTarget(canvas.width, canvas.height, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: false,
    stencilBuffer: false,
  });

  // shader: pack linear depth into RGBA8
  const _packDepthMaterial = new THREE.ShaderMaterial({
    uniforms: {
      cameraNear: { value: 0.1 },
      cameraFar: { value: 1000.0 },
    },
    vertexShader: `
      varying float vViewZ;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewZ = -mv.z; // positive forward distance in view space
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      precision highp float;
      varying float vViewZ;
      uniform float cameraNear;
      uniform float cameraFar;

      // pack float (0..1) to RGBA8
      vec4 packFloatToRGBA(const in float v) {
        // classical packing using base-256 digits
        vec4 bitShift = vec4(256.0*256.0*256.0, 256.0*256.0, 256.0, 1.0);
        vec4 res = fract(v * bitShift);
        res -= res.xxyz * vec4(1.0/256.0, 1.0/256.0, 1.0/256.0, 0.0);
        return res;
      }

      void main() {
        float linearDepth = clamp((vViewZ - cameraNear) / max(1e-6, cameraFar - cameraNear), 0.0, 1.0);
        gl_FragColor = packFloatToRGBA(linearDepth);
      }
    `,
    depthTest: true,
    depthWrite: true,
    side: THREE.DoubleSide,
  });

  // helper to unpack an RGBA8 pixel read via readRenderTargetPixels -> Uint8Array(4)
  function unpackRGBAToFloat(bytes) {
    // bytes: Uint8Array([r,g,b,a])
    const r = bytes[0] / 255;
    const g = bytes[1] / 255;
    const b = bytes[2] / 255;
    const a = bytes[3] / 255;
    return r + g / 256.0 + b / 65536.0 + a / 16777216.0;
  }

  // small pixel read buffer
  const _pixelBuf = new Uint8Array(4);

  function _updateDepthTargetSize(w, h) {
    if (_depthTarget.width !== w || _depthTarget.height !== h) {
      _depthTarget.dispose();
      _depthTarget = new THREE.WebGLRenderTarget(w, h, {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        depthBuffer: false,
        stencilBuffer: false,
      });
      _depthRenderer.setSize(w, h, false);
      _depthCanvas.width = w; _depthCanvas.height = h;
    }
  }

  // sample depth at integer screen pixel coordinates (origin top-left like canvas).
  // readRenderTargetPixels uses bottom-left origin so convert Y.
  function sampleDepthAtScreenPixel(sx, sy) {
    const x = Math.max(0, Math.min(_depthTarget.width - 1, Math.floor(sx)));
    const y = Math.max(0, Math.min(_depthTarget.height - 1, Math.floor(_depthTarget.height - 1 - sy)));
    try {
      _depthRenderer.readRenderTargetPixels(_depthTarget, x, y, 1, 1, _pixelBuf);
      return unpackRGBAToFloat(_pixelBuf);
    } catch (err) {
      // read failed (security / GL context / unsupported) -> return null to signal fallback
      return null;
    }
  }

  // --- main API (keeps your original methods) ---
  const api = {
    domElement: canvas,
    options: {
      strictNearClip: true,
      gpuOcclusion: true,      // enable/disable the GPU occlusion check
      gpuSamplesPerDrawable: 3 // how many pixels to sample per drawable (1-5 recommended)
    },
    _clearColor: { hex: 0x000000, alpha: 1 },

    setSize(w, h, updateStyle = true) {
      canvas.width = w; canvas.height = h;
      if (updateStyle) {
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      _updateDepthTargetSize(w, h);
    },

    setClearColor(hex, alpha = 1) {
      this._clearColor = { hex, alpha };
    },

    // sample-world-points helper (same approach as your original code)
    _sampleWorldPointsFor(obj, geom) {
      const worldPoints = [];
      if (geom && geom.boundingBox) {
        const bb = geom.boundingBox;
        const min = bb.min, max = bb.max;
        const corners = [
          [min.x, min.y, min.z],
          [min.x, min.y, max.z],
          [min.x, max.y, min.z],
          [min.x, max.y, max.z],
          [max.x, min.y, min.z],
          [max.x, min.y, max.z],
          [max.x, max.y, min.z],
          [max.x, max.y, max.z],
        ];
        for (let c of corners) {
          tmpVec.set(c[0], c[1], c[2]).applyMatrix4(obj.matrixWorld);
          worldPoints.push(tmpVec.clone());
        }
      } else if (geom && geom.boundingSphere) {
        const bs = geom.boundingSphere;
        const center = bs.center.clone().applyMatrix4(obj.matrixWorld);
        const r = bs.radius * (obj.matrixWorld.getMaxScaleOnAxis ? obj.matrixWorld.getMaxScaleOnAxis() : 1);
        worldPoints.push(center.clone());
        worldPoints.push(center.clone().add(new THREE.Vector3(r, 0, 0)));
        worldPoints.push(center.clone().add(new THREE.Vector3(-r, 0, 0)));
        worldPoints.push(center.clone().add(new THREE.Vector3(0, r, 0)));
        worldPoints.push(center.clone().add(new THREE.Vector3(0, -r, 0)));
        worldPoints.push(center.clone().add(new THREE.Vector3(0, 0, r)));
        worldPoints.push(center.clone().add(new THREE.Vector3(0, 0, -r)));
      } else if (geom && geom.attributes && geom.attributes.position && geom.attributes.position.count > 0) {
        const posAttr = geom.attributes.position;
        for (let i = 0; i < Math.min(12, posAttr.count); i += Math.max(1, Math.floor(posAttr.count / 12))) {
          tmpVec.set(
            posAttr.getX(i),
            posAttr.getY(i),
            posAttr.getZ(i)
          ).applyMatrix4(obj.matrixWorld);
          worldPoints.push(tmpVec.clone());
        }
      } else {
        worldPoints.push(tmpPos.clone());
      }
      return worldPoints;
    },

    // Main render function (keeps your painting pipeline but integrates GPU occlusion)
    render(scene, camera) {
      // 1) clear 2D canvas with clear color (keeps parity with original)
      const c = api._clearColor;
      const r = (c.hex >> 16) & 0xff;
      const g = (c.hex >> 8) & 0xff;
      const b = c.hex & 0xff;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = `rgba(${r},${g},${b},${c.alpha})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();

      // 2) update camera matrices
      camera.updateMatrixWorld();
      if (camera.updateProjectionMatrix) camera.updateProjectionMatrix();

      // camera inverse matrix for camera space conversions
      const camInv = tmpMat.copy(camera.matrixWorld).invert();

      // --- collect drawables (mirrors your existing traversal logic) ---
      const drawables = [];
      scene.traverse((obj) => {
        if (!obj.visible) return;
        if (obj.isCamera || obj.isLight) return;

        // world center & projection
        obj.getWorldPosition(tmpPos);
        proj.copy(tmpPos).project(camera);
        const sx = (proj.x * 0.5 + 0.5) * canvas.width;
        const sy = (-proj.y * 0.5 + 0.5) * canvas.height;
        const centerDist = camera.position.distanceTo(tmpPos);
        const mapImage = obj.material && obj.material.map && obj.material.map.image ? obj.material.map.image : null;
        const alwaysRender = !!obj.userData?.alwaysRender;

        // Helper to generate projected points and hull like original
        function buildProjectedHullFor(obj, geom) {
          const worldPoints = api._sampleWorldPointsFor(obj, geom);
          const dcam = worldPoints.map(wp => camera.position.distanceTo(wp));
          const distNear = Math.min(...dcam);
          const distFar = Math.max(...dcam);

          // convert world points to camera space for near-plane tests
          const camSpacePts = worldPoints.map(wp => wp.clone().applyMatrix4(camInv));
          const nearZ = - (camera.near !== undefined ? camera.near : 0.1);
          const farZ = - (camera.far !== undefined ? camera.far : 1e12);

          const pts2d = [];
          for (let i = 0; i < worldPoints.length; i++) {
            const camPt = camSpacePts[i];
            const wp = worldPoints[i];
            if (camPt.z <= nearZ && camPt.z >= farZ) {
              proj.copy(wp).project(camera);
              const px = (proj.x * 0.5 + 0.5) * canvas.width;
              const py = (-proj.y * 0.5 + 0.5) * canvas.height;
              pts2d.push({ x: px, y: py, ndcZ: proj.z });
            }
          }

          // edges crossing near plane -> add intersection
          for (let i = 0; i < worldPoints.length; i++) {
            for (let j = i + 1; j < worldPoints.length; j++) {
              const z1 = camSpacePts[i].z;
              const z2 = camSpacePts[j].z;
              if ((z1 <= nearZ && z2 > nearZ) || (z2 <= nearZ && z1 > nearZ)) {
                const denom = (z2 - z1);
                if (Math.abs(denom) < 1e-9) continue;
                const t = (nearZ - z1) / denom;
                if (t < 0 || t > 1) continue;
                const ip = worldPoints[i].clone().lerp(worldPoints[j], t);
                proj.copy(ip).project(camera);
                const px = (proj.x * 0.5 + 0.5) * canvas.width;
                const py = (-proj.y * 0.5 + 0.5) * canvas.height;
                pts2d.push({ x: px, y: py, ndcZ: proj.z });
              }
            }
          }

          if (!api.options.strictNearClip && pts2d.length === 0) {
            proj.copy(tmpPos).project(camera);
            const px = (proj.x * 0.5 + 0.5) * canvas.width;
            const py = (-proj.y * 0.5 + 0.5) * canvas.height;
            pts2d.push({ x: px, y: py, ndcZ: proj.z });
          }

          if (pts2d.length === 0) {
            if (alwaysRender || obj.userData?.forceMarker) {
              const cx = Math.max(0, Math.min(canvas.width, sx));
              const cy = Math.max(0, Math.min(canvas.height, sy));
              return { fallbackRect: true, sx: cx, sy: cy, distNear: distNear, distFar: distFar };
            }
            return null;
          }

          const hull = convexHull(pts2d);
          if (hull.length >= 3) {
            return { hull, distNear, distFar };
          } else if (hull.length === 2) {
            return { line: hull, distNear, distFar };
          } else {
            const p = hull[0] || pts2d[0];
            if (alwaysRender || obj.userData?.forceMarker) {
              return { fallbackRect: true, sx: p.x, sy: p.y, distNear: distNear, distFar: distFar };
            }
            return null;
          }
        }

        // If sprite/image
        if (mapImage) {
          // approximate screen pos & bounding size
          let size;
          if (obj.geometry && obj.geometry.boundingBox) {
            const bb = obj.geometry.boundingBox;
            const corners = [
              [bb.min.x, bb.min.y, bb.min.z],
              [bb.max.x, bb.max.y, bb.max.z]
            ];
            const screenPts = [];
            for (let c of corners) {
              tmpVec.set(c[0], c[1], c[2]).applyMatrix4(obj.matrixWorld);
              const p = tmpVec.project(camera);
              screenPts.push({ x: (p.x * 0.5 + 0.5) * canvas.width, y: (-p.y * 0.5 + 0.5) * canvas.height });
            }
            const wPx = Math.abs(screenPts[0].x - screenPts[1].x);
            const hPx = Math.abs(screenPts[0].y - screenPts[1].y);
            size = Math.max(8, obj.userData?.sizePx ?? Math.max(wPx, hPx, 32));
          } else {
            const baseSize = obj.userData?.sizePx ?? 300;
            const avgDist = centerDist;
            size = Math.max(8, baseSize * (1 / Math.max(0.1, avgDist * 0.05)));
          }

          // build a minimal hull (we'll still occlusion-test)
          const pts = [
            { x: sx - size/2, y: sy - size/2 },
            { x: sx + size/2, y: sy - size/2 },
            { x: sx + size/2, y: sy + size/2 },
            { x: sx - size/2, y: sy + size/2 },
          ];
          // compute approximate distNear/distFar using geometry if possible
          let distNear = centerDist, distFar = centerDist;
          if (obj.geometry) {
            const worldPoints = api._sampleWorldPointsFor(obj, obj.geometry);
            const dcam = worldPoints.map(wp => camera.position.distanceTo(wp));
            distNear = Math.min(...dcam);
            distFar = Math.max(...dcam);
          }
          drawables.push({ type: 'image', obj, sx, sy, distNear, distFar, projZ: proj.z, mapImage, pts });
          return;
        } else if (obj.isMesh && obj.geometry) {
          const geom = obj.geometry;
          if (!geom.boundingBox) geom.computeBoundingBox && geom.computeBoundingBox();
          if (!geom.boundingSphere) geom.computeBoundingSphere && geom.computeBoundingSphere();

          const projected = buildProjectedHullFor(obj, geom);
          if (!projected) return;
          if (projected.hull) {
            drawables.push({ type: 'poly', obj, pts: projected.hull, distNear: projected.distNear, distFar: projected.distFar, projZ: proj.z });
          } else if (projected.line) {
            drawables.push({ type: 'line', obj, pts: projected.line, distNear: projected.distNear, distFar: projected.distFar });
          } else if (projected.fallbackRect) {
            drawables.push({ type: 'rect', obj, sx: projected.sx, sy: projected.sy, distNear: projected.distNear, distFar: projected.distFar, sizePx: obj.userData?.markerSizePx ?? 6 });
          }
          return;
        } else {
          // fallback marker only if forced
          if (obj.userData?.forceMarker) {
            drawables.push({ type: 'rect', obj, sx, sy, distNear: centerDist, distFar: centerDist, sizePx: obj.userData?.markerSizePx ?? 6 });
          }
        }
      }); // end traverse

      // --- GPU occlusion pass: render packed depth and optionally sample per-drawable ---
      if (api.options.gpuOcclusion) {
        _updateDepthTargetSize(canvas.width, canvas.height);
        const savedOverride = scene.overrideMaterial;
        const savedAutoClear = _depthRenderer.autoClear;

        _packDepthMaterial.uniforms.cameraNear.value = camera.near !== undefined ? camera.near : 0.1;
        _packDepthMaterial.uniforms.cameraFar.value = camera.far !== undefined ? camera.far : 100000.0;

        scene.overrideMaterial = _packDepthMaterial;
        _depthRenderer.setRenderTarget(_depthTarget);
        _depthRenderer.clear();
        _depthRenderer.render(scene, camera);
        _depthRenderer.setRenderTarget(null);
        scene.overrideMaterial = savedOverride;
        _depthRenderer.autoClear = savedAutoClear;

        // occlusion-test helper: returns true if occluded (all samples behind depth)
        function isDrawableOccludedByGPU(d, sampleCount = api.options.gpuSamplesPerDrawable, eps = 1e-4) {
          // get sample positions inside polygon/hull
          const pts = d.pts || (d.sx !== undefined ? [{ x: d.sx, y: d.sy }] : []);
          if (!pts || pts.length === 0) return false;

          // centroid sample
          let cx = 0, cy = 0;
          for (let p of pts) { cx += p.x; cy += p.y; }
          cx /= pts.length; cy /= pts.length;

          // pick centroid and up to (sampleCount-1) vertices spaced across hull
          const samples = [{ x: cx, y: cy }];
          for (let i = 0; i < pts.length && samples.length < sampleCount; i += Math.max(1, Math.floor(pts.length / (sampleCount - 1)))) {
            samples.push({ x: pts[i].x, y: pts[i].y });
          }

          // compute object's linear depth using its world-space center (camera-space)
          const worldCenter = new THREE.Vector3();
          d.obj.getWorldPosition(worldCenter);
          const camSpace = worldCenter.clone().applyMatrix4(camInv);
          const near = camera.near !== undefined ? camera.near : 0.1;
          const far = camera.far !== undefined ? camera.far : 100000.0;
          const linearDepthObj = Math.max(0, Math.min(1, ((-camSpace.z) - near) / (far - near)));

          // for each sample, compare to GPU depth
          let anyVisible = false;
          for (let s of samples) {
            const sd = sampleDepthAtScreenPixel(Math.round(s.x), Math.round(s.y));
            if (sd === null) {
              // can't read pixels — fail safe: treat as visible so CPU painter handles it
              return false;
            }
            // if object depth <= sampled depth + eps => visible at this sample
            if (linearDepthObj <= sd + eps) {
              anyVisible = true;
              break;
            }
          }
          return !anyVisible; // occluded if no sample is visible
        }

        // filter drawables: only remove ones that are fully occluded according to GPU
        const filtered = [];
        for (let d of drawables) {
          if ((d.type === 'poly' || d.type === 'image' || d.type === 'line') && d.obj) {
            const occluded = isDrawableOccludedByGPU(d);
            if (!occluded) filtered.push(d);
            else {
              // skip drawing occluded drawable
            }
          } else {
            filtered.push(d);
          }
        }
        // replace drawables with filtered set
        drawables.length = 0;
        Array.prototype.push.apply(drawables, filtered);
      }

      // Painter's order: sort by farthest sampled point first (same as original)
      drawables.sort((a, b) => {
        const aFar = (a.distFar !== undefined) ? a.distFar : (a.dist !== undefined ? a.dist : 0);
        const bFar = (b.distFar !== undefined) ? b.distFar : (b.dist !== undefined ? b.dist : 0);
        if (aFar === bFar) {
          const aNear = (a.distNear !== undefined) ? a.distNear : (a.dist !== undefined ? a.dist : 0);
          const bNear = (b.distNear !== undefined) ? b.distNear : (b.dist !== undefined ? b.dist : 0);
          return bNear - aNear;
        }
        return bFar - aFar;
      });

      // --- DRAW to 2D ctx (preserves your previous draw styles) ---
      for (let i = 0; i < drawables.length; i++) {
        const d = drawables[i];
        const { obj } = d;
        const avgDist = ((d.distNear ?? d.dist ?? 0) + (d.distFar ?? d.dist ?? 0)) * 0.5;

        // color resolution like original
        let color = obj.userData?.color;
        if (!color && obj.material && obj.material.color) {
          try {
            color = obj.material.color.getStyle ? obj.material.color.getStyle() : (`#${obj.material.color.getHexString()}`);
          } catch (e) {
            color = obj.userData?.color || 'white';
          }
        }
        color = color || obj.userData?.color || 'white';

        if (d.type === 'image' && d.mapImage && d.mapImage.width) {
          let size;
          if (obj.geometry && obj.geometry.boundingBox) {
            const bb = obj.geometry.boundingBox;
            const corners = [
              [bb.min.x, bb.min.y, bb.min.z],
              [bb.max.x, bb.max.y, bb.max.z]
            ];
            const screenPts = [];
            for (let c of corners) {
              tmpVec.set(c[0], c[1], c[2]).applyMatrix4(obj.matrixWorld);
              const p = tmpVec.project(camera);
              screenPts.push({ x: (p.x * 0.5 + 0.5) * canvas.width, y: (-p.y * 0.5 + 0.5) * canvas.height });
            }
            const wPx = Math.abs(screenPts[0].x - screenPts[1].x);
            const hPx = Math.abs(screenPts[0].y - screenPts[1].y);
            size = Math.max(8, obj.userData?.sizePx ?? Math.max(wPx, hPx, 32));
          } else {
            const baseSize = obj.userData?.sizePx ?? 300;
            size = Math.max(8, baseSize * (1 / Math.max(0.1, avgDist * 0.05)));
          }
          ctx.save();
          ctx.translate(d.sx, d.sy);
          const rot = obj.userData?.rotation ?? (obj.rotation?.z ?? 0);
          if (rot) ctx.rotate(rot);
          ctx.globalAlpha = obj.userData?.opacity ?? (obj.material?.opacity ?? 1);
          ctx.drawImage(d.mapImage, -size / 2, -size / 2, size, size);
          ctx.restore();
        } else if (d.type === 'poly' && d.pts) {
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(d.pts[0].x, d.pts[0].y);
          for (let j = 1; j < d.pts.length; j++) ctx.lineTo(d.pts[j].x, d.pts[j].y);
          ctx.closePath();
          ctx.globalAlpha = Math.max(0.2, Math.min(1, 1 - (avgDist * 0.002)));
          ctx.fillStyle = color;
          ctx.fill();
          ctx.globalAlpha = 0.6;
          ctx.lineWidth = Math.max(1, 2 - (avgDist * 0.001));
          ctx.strokeStyle = 'rgba(0,0,0,0.6)';
          ctx.stroke();
          ctx.restore();
        } else if (d.type === 'line' && d.pts && d.pts.length === 2) {
          ctx.beginPath();
          ctx.moveTo(d.pts[0].x, d.pts[0].y);
          ctx.lineTo(d.pts[1].x, d.pts[1].y);
          ctx.strokeStyle = color;
          ctx.lineWidth = obj.userData?.lineWidth ?? 3;
          ctx.globalAlpha = 1 - Math.min(0.9, avgDist * 0.002);
          ctx.stroke();
        } else if (d.type === 'rect') {
          const size = d.sizePx ?? Math.max(2, Math.round(12 * (1 / Math.max(0.1, avgDist * 0.05))));
          const x = (d.sx || d.sx === 0) ? d.sx : 0;
          const y = (d.sy || d.sy === 0) ? d.sy : 0;
          ctx.save();
          ctx.globalAlpha = Math.max(0.5, Math.min(1, 1 - (avgDist * 0.002)));
          ctx.fillStyle = color;
          ctx.fillRect(x - size / 2, y - size / 2, size, size);
          ctx.restore();
        }
      } // end draw loop
    }, // end render
  }; // end api

  // expose the depth renderer for debugging if user wants it
  api._depthRenderer = _depthRenderer;
  api._depthTarget = _depthTarget;
  api._packDepthMaterial = _packDepthMaterial;

  return api;
}

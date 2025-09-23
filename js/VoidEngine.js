import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";

export function voidEngine({ width = 1280, height = 720 } = {}) {
  // create canvas + 2D context
  const canvas = document.createElement('canvas');
  canvas.style.position = 'relative';
  canvas.style.zIndex = '0';
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  const ctx = canvas.getContext('2d', { alpha: true });

  // internal state
  let _clearColor = { hex: 0x000000, alpha: 1 };
  const tmpVec = new THREE.Vector3();
  const tmpMat = new THREE.Matrix4();
  const camInv = new THREE.Matrix4();

  // public API
  const api = {
    domElement: canvas,
    options: {
      strictNearClip: true,    // similar to your old option
      overlayDownsample: 1,    // 1 = native size, 2 = half res rasterization (faster)
      drawFilledBoxes: true,   // fill faces instead of wireframes
      maxRasterWidth: 2000,    // safety cap on downsampled width
    },
    setSize(w, h, updateStyle = true) {
      canvas.width = w;
      canvas.height = h;
      if (updateStyle) {
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
      }
    },
    setClearColor(hex, alpha = 1) {
      _clearColor = { hex, alpha };
    },

    // Main render: rasterize bounding-box faces (and sprites) with a software z-buffer
    render(scene, camera) {
      if (!camera || !scene) return;

      // update camera matrices
      camera.updateMatrixWorld();
      if (camera.updateProjectionMatrix) camera.updateProjectionMatrix();
      camInv.copy(camera.matrixWorld).invert();

      // clear canvas to clearColor
      const r = (_clearColor.hex >> 16) & 0xff;
      const g = (_clearColor.hex >> 8) & 0xff;
      const b = _clearColor.hex & 0xff;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = `rgba(${r},${g},${b},${_clearColor.alpha})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();

      // Prepare raster target (optionally downsample for performance)
      const down = Math.max(1, Math.floor(api.options.overlayDownsample) || 1);
      let rw = Math.ceil(canvas.width / down);
      let rh = Math.ceil(canvas.height / down);
      // safety cap
      if (rw > api.options.maxRasterWidth) {
        const scale = api.options.maxRasterWidth / rw;
        rw = Math.floor(rw * scale);
        rh = Math.floor(rh * scale);
      }

      // allocate image + depth buffers
      const imageData = ctx.createImageData(rw, rh);
      const buf = imageData.data; // Uint8ClampedArray
      const depth = new Float32Array(rw * rh);
      // initial clear: set to transparent or clear color? We'll composite over base clear, so set to transparent
      const defaultA = 0;
      for (let i = 0, n = rw * rh; i < n; i++) {
        const i4 = i * 4;
        buf[i4 + 0] = 0;
        buf[i4 + 1] = 0;
        buf[i4 + 2] = 0;
        buf[i4 + 3] = 0;
        depth[i] = Infinity;
      }

      // helper: project world point -> screen coords (in raster target pixels) and camera depth (positive in front)
      function projectToRaster(vWorld) {
        const w = vWorld.clone();
        // camera-space
        const cam = w.applyMatrix4(camInv);
        const camDepth = -cam.z; // positive if in front
        const ndc = vWorld.clone().project(camera); // -1..1
        const px = (ndc.x * 0.5 + 0.5) * rw;
        const py = (-ndc.y * 0.5 + 0.5) * rh;
        return { px, py, ndcZ: ndc.z, camDepth, camZ: cam.z };
      }

      // triangle rasterizer (barycentric interpolation, depth test, alpha blending)
      function rasterizeTri(a, b, c, rgba) {
        // a,b,c each: {px,py,camDepth}
        // compute integer bounding box
        let minX = Math.max(0, Math.floor(Math.min(a.px, b.px, c.px)));
        let maxX = Math.min(rw - 1, Math.ceil(Math.max(a.px, b.px, c.px)));
        let minY = Math.max(0, Math.floor(Math.min(a.py, b.py, c.py)));
        let maxY = Math.min(rh - 1, Math.ceil(Math.max(a.py, b.py, c.py)));
        if (maxX < 0 || maxY < 0 || minX > rw - 1 || minY > rh - 1) return;
        // edge function constants
        const x0 = a.px, y0 = a.py, z0 = a.camDepth;
        const x1 = b.px, y1 = b.py, z1 = b.camDepth;
        const x2 = c.px, y2 = c.py, z2 = c.camDepth;
        const area = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
        if (Math.abs(area) < 1e-6) return;
        const invArea = 1.0 / area;

        // loop pixels
        for (let y = minY; y <= maxY; y++) {
          for (let x = minX; x <= maxX; x++) {
            // barycentric weights (using edge functions)
            const w0 = ((x1 - x) * (y2 - y) - (y1 - y) * (x2 - x)) * invArea;
            const w1 = ((x2 - x) * (y0 - y) - (y2 - y) * (x0 - x)) * invArea;
            const w2 = 1 - w0 - w1;
            // allow small negatives due to edges
            if (w0 >= -1e-6 && w1 >= -1e-6 && w2 >= -1e-6) {
              const depthVal = w0 * z0 + w1 * z1 + w2 * z2;
              // skip invalid depths (behind camera)
              if (depthVal <= 0) continue;
              const idx = y * rw + x;
              if (depthVal < depth[idx]) {
                // write blended color (src over dst)
                const i4 = idx * 4;
                const srcA = rgba[3] / 255;
                if (srcA >= 0.9999) {
                  buf[i4 + 0] = rgba[0];
                  buf[i4 + 1] = rgba[1];
                  buf[i4 + 2] = rgba[2];
                  buf[i4 + 3] = 255;
                } else if (srcA <= 0.0001) {
                  // fully transparent - do nothing
                } else {
                  // standard "src over dst" blending
                  const dstR = buf[i4 + 0], dstG = buf[i4 + 1], dstB = buf[i4 + 2], dstA = buf[i4 + 3] / 255;
                  const outA = srcA + dstA * (1 - srcA);
                  if (outA > 1e-6) {
                    const outR = (rgba[0] * srcA + dstR * dstA * (1 - srcA)) / outA;
                    const outG = (rgba[1] * srcA + dstG * dstA * (1 - srcA)) / outA;
                    const outB = (rgba[2] * srcA + dstB * dstA * (1 - srcA)) / outA;
                    buf[i4 + 0] = outR | 0;
                    buf[i4 + 1] = outG | 0;
                    buf[i4 + 2] = outB | 0;
                    buf[i4 + 3] = Math.round(outA * 255);
                  }
                }
                depth[idx] = depthVal;
              }
            }
          }
        }
      }

      // Convert THREE.Color or userData color to rgba array
      function colorToRGBA(obj, defaultAlpha = 200) {
        let r = 255, g = 255, b = 255, a = defaultAlpha;
        if (obj && obj.userData && obj.userData.color) {
          try {
            const c = new THREE.Color(obj.userData.color);
            r = Math.round(c.r * 255);
            g = Math.round(c.g * 255);
            b = Math.round(c.b * 255);
            a = Math.round((obj.userData.opacity ?? 1) * 255);
          } catch (e) {}
        } else if (obj && obj.material && obj.material.color) {
          const c = obj.material.color;
          r = Math.round((c.r ?? c.x ?? 1) * 255);
          g = Math.round((c.g ?? c.y ?? 1) * 255);
          b = Math.round((c.b ?? c.z ?? 1) * 255);
          a = Math.round((obj.userData?.opacity ?? obj.material.opacity ?? 1) * 255);
        } else if (obj && obj.userData && obj.userData.rgba) {
          const arr = obj.userData.rgba;
          r = arr[0]; g = arr[1]; b = arr[2]; a = arr[3] ?? defaultAlpha;
        }
        return [r, g, b, a];
      }

      // Build box (8 world-space corners and face index list)
      function buildBoundingBoxTriangles(obj) {
        if (!obj.geometry) return null;
        const geom = obj.geometry;
        if (!geom.boundingBox) geom.computeBoundingBox && geom.computeBoundingBox();
        if (!geom.boundingBox) return null;
        const min = geom.boundingBox.min, max = geom.boundingBox.max;
        const corners = [
          new THREE.Vector3(min.x, min.y, min.z),
          new THREE.Vector3(min.x, min.y, max.z),
          new THREE.Vector3(min.x, max.y, min.z),
          new THREE.Vector3(min.x, max.y, max.z),
          new THREE.Vector3(max.x, min.y, min.z),
          new THREE.Vector3(max.x, min.y, max.z),
          new THREE.Vector3(max.x, max.y, min.z),
          new THREE.Vector3(max.x, max.y, max.z),
        ];
        for (let c of corners) c.applyMatrix4(obj.matrixWorld);
        const faces = [
          [0,2,6],[0,6,4], // -X
          [1,5,7],[1,7,3], // +X
          [0,1,3],[0,3,2], // -Y
          [4,6,7],[4,7,5], // +Y
          [0,4,5],[0,5,1], // -Z
          [2,3,7],[2,7,6], // +Z
        ];
        return { corners, faces };
      }

      // Create sprite quad (camera-facing), returns {corners, faces}
      function buildSpriteQuad(obj) {
        // world center
        const center = new THREE.Vector3();
        obj.getWorldPosition(center);
        // camera-facing axes
        const camDir = camera.getWorldDirection(new THREE.Vector3()).normalize();
        const up = new THREE.Vector3(0, 1, 0);
        // try to derive a decent up in world space (avoid degenerate)
        const camUp = new THREE.Vector3().copy(camera.up).applyMatrix4(camera.matrixWorld).sub(camera.position).normalize();
        const right = new THREE.Vector3().crossVectors(camUp, camDir).normalize();
        const realUp = new THREE.Vector3().crossVectors(camDir, right).normalize();
        const size = obj.userData?.sizeWorld ?? (obj.scale?.x ?? 1);
        const halfR = right.clone().multiplyScalar(size * 0.5);
        const halfU = realUp.clone().multiplyScalar(size * 0.5);
        const corners = [
          center.clone().sub(halfR).sub(halfU),
          center.clone().add(halfR).sub(halfU),
          center.clone().add(halfR).add(halfU),
          center.clone().sub(halfR).add(halfU),
        ];
        const faces = [[0,1,2],[0,2,3]];
        return { corners, faces };
      }

      // Traverse scene, collect objects to rasterize (meshes: bounding boxes; sprites: quads)
      const objects = [];
      scene.traverse((obj) => {
        if (!obj.visible) return;
        if (obj.isMesh && obj.geometry) objects.push({ type: 'mesh', obj });
        else if (obj.isSprite) objects.push({ type: 'sprite', obj });
        // optionally allow a userData flag to force marker: obj.userData.forceMarker
      });

      // Rasterize: for each object build triangles and rasterize
      for (const entry of objects) {
        if (entry.type === 'mesh') {
          const data = buildBoundingBoxTriangles(entry.obj);
          if (!data) continue;
          const rgba = colorToRGBA(entry.obj, 160);
          for (const f of data.faces) {
            // project vertices to raster pixels and get camDepth
            const p0 = projectToRaster(data.corners[f[0]]);
            const p1 = projectToRaster(data.corners[f[1]]);
            const p2 = projectToRaster(data.corners[f[2]]);
            // if all vertices are behind camera skip
            if (p0.camDepth <= 0 && p1.camDepth <= 0 && p2.camDepth <= 0) continue;
            // optional strict near clipping: if all ndcZ > 1 or < -1 skip? We rely on camDepth.
            // rasterize triangle
            rasterizeTri(p0, p1, p2, rgba);
          }
        } else if (entry.type === 'sprite') {
          const data = buildSpriteQuad(entry.obj);
          const rgba = colorToRGBA(entry.obj, 255);
          for (const f of data.faces) {
            const p0 = projectToRaster(data.corners[f[0]]);
            const p1 = projectToRaster(data.corners[f[1]]);
            const p2 = projectToRaster(data.corners[f[2]]);
            if (p0.camDepth <= 0 && p1.camDepth <= 0 && p2.camDepth <= 0) continue;
            rasterizeTri(p0, p1, p2, rgba);
          }
        }
      }

      // put raster result back onto the main canvas (scale up if downsampled)
      if (down === 1) {
        // direct copy: note canvas and imageData may have different sizes if clamped — but we used rw/rh to create imageData
        ctx.putImageData(imageData, 0, 0);
      } else {
        // create an offscreen canvas to transfer (faster than per-pixel scaling manually)
        const off = document.createElement('canvas');
        off.width = rw; off.height = rh;
        const offCtx = off.getContext('2d');
        offCtx.putImageData(imageData, 0, 0);
        // draw scaled up onto main ctx
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
        ctx.restore();
      }
    }, // end render
  }; // end api

  return api;
}

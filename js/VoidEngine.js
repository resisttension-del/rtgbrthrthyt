import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";

export function voidEngine({ width = 1280, height = 720 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.style.position = 'relative';
  canvas.style.zIndex = '0';
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // Scratch vars for projections & temp math (reuse for perf)
  const proj = new THREE.Vector3();
  const tmpPos = new THREE.Vector3();
  const tmpVec = new THREE.Vector3();
  const tmpVec2 = new THREE.Vector3();
  const tmpMat = new THREE.Matrix4();

  // helper: build convex hull (Andrew monotone chain) of 2D points
  function convexHull(points) {
    if (!points || points.length <= 1) return points ? points.slice() : [];
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
    lower.pop(); upper.pop();
    return lower.concat(upper);
  }

  // -------- API + defaults --------
  const api = {
    domElement: canvas,
    options: {
      // cheap painter fallback & strict near clip
      strictNearClip: true,
      // depth pass options
      useSoftwareDepth: true,          // enable the software depth pass
      depthDownsample: 8,              // 1 = full res, 2 = half res, 4 = quarter
      depthAutoThreshold: 40,          // if number of drawables < threshold, auto-enable depth pass
      maxSoftwareTriangles: 3000,      // limit triangulation; if exceeded, fallback to painters
      forcePainterIfManyObjects: true, // if objects > N, avoid depth pass to save CPU
      forcePainterThreshold: 250,
      // GPU assist: use ImageBitmap / OffscreenCanvas speedups when available
      gpuAssist: true
    },
    setSize(w, h, updateStyle = true) {
      canvas.width = w; canvas.height = h;
      if (updateStyle) {
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
    },
    setClearColor(hex, alpha = 1) {
      api._clearColor = { hex, alpha };
    },
    _clearColor: { hex: 0x000000, alpha: 1 }
  };

  // ---------- Helper: sample world points ----------
  function sampleWorldPointsFor(obj, geom) {
    const worldPoints = [];
    if (geom && geom.boundingBox) {
      const bb = geom.boundingBox;
      const min = bb.min, max = bb.max;
      const corners = [
        [min.x, min.y, min.z], [min.x, min.y, max.z], [min.x, max.y, min.z], [min.x, max.y, max.z],
        [max.x, min.y, min.z], [max.x, min.y, max.z], [max.x, max.y, min.z], [max.x, max.y, max.z],
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
      const count = posAttr.count;
      const step = Math.max(1, Math.floor(count / 12));
      for (let i = 0; i < Math.min(count, 12); i += step) {
        tmpVec.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)).applyMatrix4(obj.matrixWorld);
        worldPoints.push(tmpVec.clone());
      }
    } else {
      obj.getWorldPosition(tmpPos);
      worldPoints.push(tmpPos.clone());
    }
    return worldPoints;
  }

  // ---------- Core render function ----------
  api.render = function(scene, camera) {
    // Clear with clear color
    const c = api._clearColor;
    const r = (c.hex >> 16) & 0xff;
    const g = (c.hex >> 8) & 0xff;
    const b = c.hex & 0xff;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = `rgba(${r},${g},${b},${c.alpha})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    // Update camera
    camera.updateMatrixWorld();
    if (camera.updateProjectionMatrix) camera.updateProjectionMatrix();

    // camera inverse for camera-space transforms
    const camInv = tmpMat.copy(camera.matrixWorld).invert();

    // collect drawables
    const drawables = [];
    scene.traverse((obj) => {
      if (!obj.visible) return;
      if (obj.isCamera || obj.isLight) return;

      // world position center
      obj.getWorldPosition(tmpPos);
      proj.copy(tmpPos).project(camera);
      const sx = (proj.x * 0.5 + 0.5) * canvas.width;
      const sy = (-proj.y * 0.5 + 0.5) * canvas.height;
      const centerDist = camera.position.distanceTo(tmpPos);
      const mapImage = obj.material && obj.material.map && obj.material.map.image ? obj.material.map.image : null;
      const alwaysRender = !!obj.userData?.alwaysRender;

      // helper: gather projected pts with ndcZ after near-plane clipping
      function makeProjectedForMesh(obj, geom) {
        const worldPoints = sampleWorldPointsFor(obj, geom);
        const dists = worldPoints.map(wp => camera.position.distanceTo(wp));
        const distNear = Math.min(...dists);
        const distFar = Math.max(...dists);

        // cam-space z for near-plane checks
        const camSpacePts = worldPoints.map(wp => wp.clone().applyMatrix4(camInv));
        const nearZ = - (camera.near !== undefined ? camera.near : 0.1);
        const farZ = - (camera.far !== undefined ? camera.far : 1e12);

        // collected projected 2D points that are in front of near and not beyond far
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
        // handle edges crossing near plane
        for (let i = 0; i < worldPoints.length; i++) {
          for (let j = i + 1; j < worldPoints.length; j++) {
            const z1 = camSpacePts[i].z, z2 = camSpacePts[j].z;
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
          pts2d.push({ x: (proj.x * 0.5 + 0.5) * canvas.width, y: (-proj.y * 0.5 + 0.5) * canvas.height, ndcZ: proj.z });
        }
        return { pts2d, distNear, distFar };
      }

      // sprites / textured images
      if (mapImage) {
        let worldPoints = obj.geometry ? sampleWorldPointsFor(obj, obj.geometry) : [tmpPos.clone()];
        const dists = worldPoints.map(wp => camera.position.distanceTo(wp));
        const distNear = Math.min(...dists);
        const distFar = Math.max(...dists);
        drawables.push({ type: 'image', obj, sx, sy, distNear, distFar, projZ: proj.z, mapImage });
        return;
      }

      // meshes
      if (obj.isMesh && obj.geometry) {
        const geom = obj.geometry;
        if (!geom.boundingBox) geom.computeBoundingBox && geom.computeBoundingBox();
        if (!geom.boundingSphere) geom.computeBoundingSphere && geom.computeBoundingSphere();

        const { pts2d, distNear, distFar } = makeProjectedForMesh(obj, geom);

        if (pts2d.length === 0) {
          if (alwaysRender || obj.userData?.forceMarker) {
            const cx = Math.max(0, Math.min(canvas.width, sx));
            const cy = Math.max(0, Math.min(canvas.height, sy));
            drawables.push({ type: 'rect', obj, sx: cx, sy: cy, distNear: distNear || centerDist, distFar: distFar || centerDist, sizePx: obj.userData?.markerSizePx ?? 6 });
          }
          return;
        }

        const hull = convexHull(pts2d);
        if (hull.length >= 3) {
          drawables.push({ type: 'poly', obj, pts: hull, distNear, distFar, projZ: proj.z });
        } else if (hull.length === 2) {
          drawables.push({ type: 'line', obj, pts: hull, distNear, distFar });
        } else {
          const p = hull[0] || pts2d[0];
          if (alwaysRender || obj.userData?.forceMarker) {
            drawables.push({ type: 'rect', obj, sx: p.x, sy: p.y, distNear, distFar, sizePx: obj.userData?.markerSizePx ?? 6 });
          }
        }
        return;
      }

      // fallback (point marker if requested)
      if (obj.userData?.forceMarker) {
        drawables.push({ type: 'rect', obj, sx, sy, distNear: centerDist, distFar: centerDist, sizePx: obj.userData?.markerSizePx ?? 6 });
      }
    });

    // If there are no drawables, done
    if (drawables.length === 0) return;

    // ----------------- SORT + CLASSIFY -----------------
    // classify opaque vs translucent
    const opaque = [];
    const translucent = [];
    for (const d of drawables) {
      const alpha = (d.obj.userData?.opacity ?? d.obj.material?.opacity ?? 1);
      if (alpha >= 0.999 && !d.obj.userData?.forceTranslucent) opaque.push(d);
      else translucent.push(d);
    }

    function depthCmp(a, b) {
      const aFar = a.distFar ?? a.dist ?? 0;
      const bFar = b.distFar ?? b.dist ?? 0;
      if (aFar !== bFar) return bFar - aFar;
      const aNear = a.distNear ?? a.dist ?? 0;
      const bNear = b.distNear ?? b.dist ?? 0;
      if (aNear !== bNear) return bNear - aNear;
      const aZ = (a.projZ !== undefined ? a.projZ : 1);
      const bZ = (b.projZ !== undefined ? b.projZ : 1);
      return bZ - aZ;
    }

    // quick heuristics: if scene is huge, use painter's to avoid CPU spike
    if (api.options.forcePainterIfManyObjects && drawables.length > api.options.forcePainterThreshold) {
      // painter: opaque far->near then translucent near->far
      opaque.sort(depthCmp);
      for (const d of opaque) drawDrawable(d);
      translucent.sort((a,b) => -depthCmp(a,b));
      for (const d of translucent) drawDrawable(d);
      return;
    }

    // If few objects, use depth pass automatically (unless disabled)
    const useDepth = api.options.useSoftwareDepth && (drawables.length <= api.options.depthAutoThreshold || opaque.length > 1);

    if (!useDepth) {
      // painter's fallback
      opaque.sort(depthCmp);
      for (const d of opaque) drawDrawable(d);
      translucent.sort((a,b) => -depthCmp(a,b));
      for (const d of translucent) drawDrawable(d);
      return;
    }

    // --------------- SOFTWARE DEPTH PASS (optimized) ----------------
    // We'll rasterize opaque polygons (triangulated convex hulls) into a downsampled
    // depth/color buffer, then blit back and draw translucent items on top.
    const ds = Math.max(1, (api.options.depthDownsample | 0));
    const w = Math.max(1, Math.floor(canvas.width / ds));
    const h = Math.max(1, Math.floor(canvas.height / ds));
    const depthBuf = new Float32Array(w * h);
    for (let i = 0; i < depthBuf.length; i++) depthBuf[i] = 2.0; // init far (NDC z range approx -1..1)

    // color buffer bytes
    const colorData = new Uint8ClampedArray(w * h * 4);
    const cr = (api._clearColor.hex >> 16) & 0xff;
    const cg = (api._clearColor.hex >> 8) & 0xff;
    const cb = api._clearColor.hex & 0xff;
    const ca = Math.round((api._clearColor.alpha ?? 1) * 255);
    for (let i = 0; i < w*h; i++) {
      const idx = i*4;
      colorData[idx] = cr; colorData[idx+1] = cg; colorData[idx+2] = cb; colorData[idx+3] = ca;
    }

    // Rasterization helpers (triangle rasterization using barycentric check)
    function edge(a,b,x,y) { return (b.x - a.x)*(y - a.y) - (b.y - a.y)*(x - a.x); }

    function rasterizeTri(v0, v1, v2, rgba) {
      // v = {x,y,z} in downsampled pixel coords
      // compute bounding box
      let minX = Math.floor(Math.min(v0.x, v1.x, v2.x));
      let maxX = Math.ceil(Math.max(v0.x, v1.x, v2.x));
      let minY = Math.floor(Math.min(v0.y, v1.y, v2.y));
      let maxY = Math.ceil(Math.max(v0.y, v1.y, v2.y));
      if (minX > w-1 || maxX < 0 || minY > h-1 || maxY < 0) return;
      minX = Math.max(0, minX); maxX = Math.min(w-1, maxX);
      minY = Math.max(0, minY); maxY = Math.min(h-1, maxY);
      const area = edge(v0, v1, v2.x, v2.y) + 1e-12;

      for (let py = minY; py <= maxY; py++) {
        for (let px = minX; px <= maxX; px++) {
          const sx = px + 0.5;
          const sy = py + 0.5;
          const w0 = edge(v1, v2, sx, sy);
          const w1 = edge(v2, v0, sx, sy);
          const w2 = edge(v0, v1, sx, sy);
          if ((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0)) {
            const b0 = w0 / area, b1 = w1 / area, b2 = w2 / area;
            const z = b0 * v0.z + b1 * v1.z + b2 * v2.z; // NDC z approx
            const idx = py * w + px;
            if (z < depthBuf[idx]) {
              depthBuf[idx] = z;
              const ci = idx * 4;
              colorData[ci] = rgba[0]; colorData[ci+1] = rgba[1]; colorData[ci+2] = rgba[2]; colorData[ci+3] = rgba[3];
            }
          }
        }
      }
    }

    // Count triangles and early-abort heuristics
    let triCount = 0;
    for (const d of opaque) {
      if (d.type === 'poly' && d.pts && d.pts.length >= 3) {
        triCount += Math.max(0, d.pts.length - 2);
      } else if (d.type === 'image') {
        triCount += 2; // image quad => 2 triangles
      } else if (d.type === 'line') {
        triCount += 0;
      } else if (d.type === 'rect') {
        triCount += 2;
      }
      if (triCount > api.options.maxSoftwareTriangles) break;
    }
    if (triCount > api.options.maxSoftwareTriangles) {
      // too heavy -> fallback painter's
      opaque.sort(depthCmp);
      for (const d of opaque) drawDrawable(d);
      translucent.sort((a,b) => -depthCmp(a,b));
      for (const d of translucent) drawDrawable(d);
      return;
    }

    // Rasterize opaque drawables
    for (const d of opaque) {
      // get a simple color for the object (canvas fallback)
      let cssColor = d.obj.userData?.color ?? (d.obj.material?.color?.getStyle ? d.obj.material.color.getStyle() : null);
      if (!cssColor && d.obj.material && d.obj.material.color) {
        try { cssColor = '#' + d.obj.material.color.getHexString(); } catch (e) { cssColor = '#ffffff'; }
      }
      const alpha = Math.round(255 * (d.obj.userData?.opacity ?? d.obj.material?.opacity ?? 1));

      // get rgba bytes via 1x1 canvas trick (works for named colors, hex, rgb strings)
      let rgbaBytes = [255,255,255, alpha];
      try {
        const tmp = document.createElement('canvas'); tmp.width = tmp.height = 1;
        const tctx = tmp.getContext('2d');
        tctx.clearRect(0,0,1,1);
        tctx.fillStyle = cssColor || 'white';
        tctx.fillRect(0,0,1,1);
        const pix = tctx.getImageData(0,0,1,1).data;
        rgbaBytes = [pix[0], pix[1], pix[2], alpha];
      } catch(e) {
        rgbaBytes = [255,255,255, alpha];
      }

      if (d.type === 'poly' && d.pts && d.pts.length >= 3) {
        // downsampled points
        const pts = d.pts.map(p => ({ x: p.x / ds, y: p.y / ds, z: (p.ndcZ !== undefined ? p.ndcZ : 1) }));
        // triangulate as fan
        for (let i = 1; i < pts.length - 1; i++) {
          rasterizeTri(pts[0], pts[i], pts[i+1], rgbaBytes);
        }
      } else if (d.type === 'image' && d.mapImage) {
        // approximate image as opaque quad using its computed size at center
        // compute a simple quad by reprojecting bounding box corners if geometry present, otherwise use size heuristic
        let wPx = 64, hPx = 64;
        if (d.obj.geometry && d.obj.geometry.boundingBox) {
          const bb = d.obj.geometry.boundingBox;
          const corners = [
            [bb.min.x, bb.min.y, bb.min.z],
            [bb.max.x, bb.max.y, bb.max.z]
          ];
          const screenPts = [];
          for (let c of corners) {
            tmpVec.set(c[0], c[1], c[2]).applyMatrix4(d.obj.matrixWorld);
            proj.copy(tmpVec).project(camera);
            screenPts.push({ x: (proj.x * 0.5 + 0.5) * canvas.width, y: (-proj.y * 0.5 + 0.5) * canvas.height });
          }
          wPx = Math.max(8, Math.abs(screenPts[0].x - screenPts[1].x));
          hPx = Math.max(8, Math.abs(screenPts[0].y - screenPts[1].y));
        } else {
          wPx = Math.max(32, (d.obj.userData?.sizePx ?? 128));
          hPx = wPx;
        }
        // build quad pts (center d.sx,d.sy)
        const halfW = (wPx/2) / ds, halfH = (hPx/2) / ds;
        const cX = (d.sx / ds), cY = (d.sy / ds);
        // approximate ndcZ from projZ
        const z = (d.projZ !== undefined ? d.projZ : 1);
        const v0 = {x: cX - halfW, y: cY - halfH, z};
        const v1 = {x: cX + halfW, y: cY - halfH, z};
        const v2 = {x: cX + halfW, y: cY + halfH, z};
        const v3 = {x: cX - halfW, y: cY + halfH, z};
        rasterizeTri(v0,v1,v2, rgbaBytes);
        rasterizeTri(v0,v2,v3, rgbaBytes);
      } else if (d.type === 'rect') {
        const size = (d.sizePx ?? 6) / ds;
        const cx = (d.sx / ds), cy = (d.sy / ds);
        const z = (d.projZ !== undefined ? d.projZ : 1);
        const v0 = {x: cx - size/2, y: cy - size/2, z};
        const v1 = {x: cx + size/2, y: cy - size/2, z};
        const v2 = {x: cx + size/2, y: cy + size/2, z};
        const v3 = {x: cx - size/2, y: cy + size/2, z};
        rasterizeTri(v0,v1,v2, rgbaBytes);
        rasterizeTri(v0,v2,v3, rgbaBytes);
      } else {
        // lines / others: skip in opaque depth pass; they are rare to require occlusion
      }
    }

    // Paint colorData back to canvas using an offscreen / ImageBitmap (GPU-accelerated scaling)
    (async () => {
      try {
        if (typeof createImageBitmap === 'function' && api.options.gpuAssist) {
          // create small offscreen canvas -> putImageData -> createImageBitmap -> draw scaled
          const off = new OffscreenCanvas(w, h);
          const offCtx = off.getContext('2d');
          const id = new ImageData(colorData, w, h);
          offCtx.putImageData(id, 0, 0);
          const bmp = await createImageBitmap(off);
          ctx.save();
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
          ctx.restore();
          bmp.close && bmp.close();
        } else {
          // fallback: normal hidden canvas
          const off = document.createElement('canvas');
          off.width = w; off.height = h;
          const offCtx = off.getContext('2d');
          const id = new ImageData(colorData, w, h);
          offCtx.putImageData(id, 0, 0);
          ctx.save();
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
          ctx.restore();
        }
      } catch (e) {
        // if anything fails, fallback to painter's for everything (safe)
        opaque.sort(depthCmp);
        for (const d of opaque) drawDrawable(d);
      } finally {
        // draw translucent items on top (back-to-front)
        translucent.sort((a,b) => -depthCmp(a,b));
        for (const d of translucent) drawDrawable(d);
      }
    })();
  };

  // ---------------- drawDrawable: handles the actual canvas drawing for a drawable --------------
  function drawDrawable(d) {
    const { obj } = d;
    const avgDist = ((d.distNear ?? d.dist ?? 0) + (d.distFar ?? d.dist ?? 0)) * 0.5;
    let color = obj.userData?.color;
    if (!color && obj.material && obj.material.color) {
      try { color = obj.material.color.getStyle ? obj.material.color.getStyle() : (`#${obj.material.color.getHexString()}`); }
      catch(e) { color = obj.userData?.color || 'white'; }
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
  }

  return api;
}

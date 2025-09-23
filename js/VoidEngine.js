import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";

export function voidEngine({ width = 1280, height = 720 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.style.position = 'relative';
  canvas.style.zIndex = '0';
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // Scratch vars for projections & temp math
  const proj = new THREE.Vector3();
  const tmpPos = new THREE.Vector3();
  const tmpVec = new THREE.Vector3();
  const tmpVec2 = new THREE.Vector3();
  const tmpMat = new THREE.Matrix4();

  // helper: build convex hull (Andrew monotone chain) of 2D points
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

  const api = {
    domElement: canvas,
    options: {
      // if you ever want to toggle strict near-plane clipping:
      strictNearClip: true
    },
    setSize(w, h, updateStyle = true) {
      canvas.width = w;
      canvas.height = h;
      if (updateStyle) {
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
    },
    // Minimal clear color support
    setClearColor(hex, alpha = 1) {
      api._clearColor = { hex, alpha };
    },
    _clearColor: { hex: 0x000000, alpha: 1 },

    // Basic render: draw sprites (material.map.image) and approximated shapes for meshes
    render(scene, camera) {
      // Clear with the clear color (converted to CSS)
      const c = api._clearColor;
      const r = (c.hex >> 16) & 0xff;
      const g = (c.hex >> 8) & 0xff;
      const b = c.hex & 0xff;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = `rgba(${r},${g},${b},${c.alpha})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();

      // update camera matrices once
      camera.updateMatrixWorld();
      if (camera.updateProjectionMatrix) camera.updateProjectionMatrix();

      // camera world->camera matrix (inverse of matrixWorld)
      const camInv = tmpMat.copy(camera.matrixWorld).invert();

      // collect drawables (so we can sort by depth)
      const drawables = [];
      scene.traverse((obj) => {
        if (!obj.visible) return;
        if (obj.isCamera || obj.isLight) return;

        // World position (center)
        obj.getWorldPosition(tmpPos);
        proj.copy(tmpPos).project(camera); // NDC -1..1 (center)

        // screen coords of center (used as fallback)
        const sx = (proj.x * 0.5 + 0.5) * canvas.width;
        const sy = (-proj.y * 0.5 + 0.5) * canvas.height;

        // center distance for fallback (still useful)
        const centerDist = camera.position.distanceTo(tmpPos);

        // check for texture (sprites)
        const mapImage = obj.material && obj.material.map && obj.material.map.image ? obj.material.map.image : null;

        // If user explicitly wants to always render, skip strict culling checks later
        const alwaysRender = !!obj.userData?.alwaysRender;

        // Helper: assemble sample world points for an object (bbox corners / sphere / subset of positions)
        function sampleWorldPointsFor(obj, geom) {
          const worldPoints = [];
          if (geom && geom.boundingBox) {
            const bb = geom.boundingBox;
            const min = bb.min;
            const max = bb.max;
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
            // fallback to center
            worldPoints.push(tmpPos.clone());
          }
          return worldPoints;
        }

        // If sprite/image
        if (mapImage) {
          // try to create sample points to compute near/far distances
          let worldPoints = [];
          if (obj.geometry) {
            worldPoints = sampleWorldPointsFor(obj, obj.geometry);
          } else {
            worldPoints = [tmpPos.clone()];
          }
          // compute distances to camera for these samples
          const dists = worldPoints.map(wp => camera.position.distanceTo(wp));
          const distNear = Math.min(...dists);
          const distFar = Math.max(...dists);

          drawables.push({ type: 'image', obj, sx, sy, distNear, distFar, projZ: proj.z, mapImage });
          return;
        } else if (obj.isMesh && obj.geometry) {
          const geom = obj.geometry;
          if (!geom.boundingBox) geom.computeBoundingBox && geom.computeBoundingBox();
          if (!geom.boundingSphere) geom.computeBoundingSphere && geom.computeBoundingSphere();

          // Build sample points in world space (bbox corners, sphere points, or subset of positions)
          const worldPoints = sampleWorldPointsFor(obj, geom);

          // If no world points, fallback to center marker (rare)
          if (worldPoints.length === 0) {
            if (obj.userData?.forceMarker) {
              drawables.push({ type: 'rect', obj, sx, sy, distNear: centerDist, distFar: centerDist, sizePx: obj.userData?.markerSizePx ?? 6 });
            }
            return;
          }

          // compute distances to camera for the sample points (this is the key change)
          const dists = worldPoints.map(wp => camera.position.distanceTo(wp));
          const distNear = Math.min(...dists);
          const distFar = Math.max(...dists);

          // === CLIPPING AGAINST NEAR PLANE (camera space) ===
          // Convert points to camera space (z is negative in front of camera for THREE cameras)
          const camSpacePts = worldPoints.map(wp => wp.clone().applyMatrix4(camInv));

          // near plane in camera space (z <= -near is in front)
          const nearZ = - (camera.near !== undefined ? camera.near : 0.1);
          const farZ = - (camera.far !== undefined ? camera.far : 1e12);

          // Collect projected screen points for those in front of near and within far
          const pts2d = [];

          for (let i = 0; i < worldPoints.length; i++) {
            const camPt = camSpacePts[i];
            const wp = worldPoints[i];

            if (camPt.z <= nearZ && camPt.z >= farZ) {
              // point is in front of near and not beyond far -> project normally
              proj.copy(wp).project(camera);
              const px = (proj.x * 0.5 + 0.5) * canvas.width;
              const py = (-proj.y * 0.5 + 0.5) * canvas.height;
              pts2d.push({ x: px, y: py, ndcZ: proj.z });
            }
          }

          // For edges that cross the near plane, compute intersection point and include it
          for (let i = 0; i < worldPoints.length; i++) {
            for (let j = i + 1; j < worldPoints.length; j++) {
              const z1 = camSpacePts[i].z;
              const z2 = camSpacePts[j].z;

              // If one side is in front (<= nearZ) and the other is behind (> nearZ), there's a crossing
              if ((z1 <= nearZ && z2 > nearZ) || (z2 <= nearZ && z1 > nearZ)) {
                // Avoid numerical division by zero
                const denom = (z2 - z1);
                if (Math.abs(denom) < 1e-9) continue;
                const t = (nearZ - z1) / denom; // 0..1 along segment i->j where z == nearZ
                if (t < 0 || t > 1) continue;
                // Interpolate in world space to get accurate intersection position
                const ip = worldPoints[i].clone().lerp(worldPoints[j], t);
                proj.copy(ip).project(camera);
                const px = (proj.x * 0.5 + 0.5) * canvas.width;
                const py = (-proj.y * 0.5 + 0.5) * canvas.height;
                pts2d.push({ x: px, y: py, ndcZ: proj.z });
              }
            }
          }

          // If strict near clipping is disabled, include center projection as a loose fallback
          if (!api.options.strictNearClip && pts2d.length === 0) {
            proj.copy(tmpPos).project(camera);
            const px = (proj.x * 0.5 + 0.5) * canvas.width;
            const py = (-proj.y * 0.5 + 0.5) * canvas.height;
            pts2d.push({ x: px, y: py, ndcZ: proj.z });
          }

          // If after near-plane clipping we have zero pts, we may still want a fallback marker,
          // but only if user asked or object is forced to render.
          if (pts2d.length === 0) {
            if (alwaysRender || obj.userData?.forceMarker) {
              // clamp center to screen bounds so we get a marker on-screen
              const cx = Math.max(0, Math.min(canvas.width, sx));
              const cy = Math.max(0, Math.min(canvas.height, sy));
              drawables.push({ type: 'rect', obj, sx: cx, sy: cy, distNear, distFar, sizePx: obj.userData?.markerSizePx ?? 6 });
            }
            return;
          }

          // Build convex hull from the collected projected points
          const hull = convexHull(pts2d);

          // If hull is trivial (1 or 2 points), but user forced rendering, make fallback shapes
          if (hull.length >= 3) {
            drawables.push({ type: 'poly', obj, pts: hull, distNear, distFar, projZ: proj.z });
          } else if (hull.length === 2) {
            drawables.push({ type: 'line', obj, pts: hull, distNear, distFar });
          } else {
            // single point fallback
            const p = hull[0] || pts2d[0];
            if (alwaysRender || obj.userData?.forceMarker) {
              drawables.push({ type: 'rect', obj, sx: p.x, sy: p.y, distNear, distFar, sizePx: obj.userData?.markerSizePx ?? 6 });
            }
          }

          return;
        } else {
          // unknown / fallback: only draw marker if explicitly requested
          if (obj.userData?.forceMarker) {
            drawables.push({ type: 'rect', obj, sx, sy, distNear: centerDist, distFar: centerDist, sizePx: obj.userData?.markerSizePx ?? 6 });
          }
        }
      });

      // Painter's order: sort by farthest sampled point first (so large objects that *span* far will be drawn behind)
      // fallback to center-based dist if distFar is missing.
      drawables.sort((a, b) => {
        const aFar = (a.distFar !== undefined) ? a.distFar : (a.dist !== undefined ? a.dist : 0);
        const bFar = (b.distFar !== undefined) ? b.distFar : (b.dist !== undefined ? b.dist : 0);
        if (aFar === bFar) {
          const aNear = (a.distNear !== undefined) ? a.distNear : (a.dist !== undefined ? a.dist : 0);
          const bNear = (b.distNear !== undefined) ? b.distNear : (b.dist !== undefined ? b.dist : 0);
          return bNear - aNear; // tie-breaker: draw object with larger near distance first
        }
        return bFar - aFar; // farthest first
      });

      // draw
      for (let i = 0; i < drawables.length; i++) {
        const d = drawables[i];
        const { obj } = d;

        // compute an average distance for alpha/linewidth falloffs (keeps visuals smooth)
        const avgDist = ((d.distNear ?? d.dist ?? 0) + (d.distFar ?? d.dist ?? 0)) * 0.5;

        // common color selection
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
          // small centered rectangle marker (replaces prior circle/sphere)
          const size = d.sizePx ?? Math.max(2, Math.round(12 * (1 / Math.max(0.1, avgDist * 0.05))));
          const x = (d.sx || d.sx === 0) ? d.sx : 0;
          const y = (d.sy || d.sy === 0) ? d.sy : 0;
          ctx.save();
          ctx.globalAlpha = Math.max(0.5, Math.min(1, 1 - (avgDist * 0.002)));
          ctx.fillStyle = color;
          ctx.fillRect(x - size / 2, y - size / 2, size, size);
          ctx.restore();
        } else {
          // nothing
        }
      }
    }
  };

  return api;
}

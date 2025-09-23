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
  const tmpMat = new THREE.Matrix4();
  
  // Helper: build convex hull (Andrew monotone chain) of 2D points
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
    setClearColor(hex, alpha = 1) {
      api._clearColor = { hex, alpha };
    },
    _clearColor: { hex: 0x000000, alpha: 1 },

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

      // Update camera matrices once
      camera.updateMatrixWorld();
      if (camera.updateProjectionMatrix) camera.updateProjectionMatrix();
      
      const camInv = tmpMat.copy(camera.matrixWorld).invert();
      
      // Collect drawables for two separate lists: opaque and transparent
      const opaqueDrawables = [];
      const transparentDrawables = [];

      scene.traverse((obj) => {
        if (!obj.visible || obj.isCamera || obj.isLight) return;

        // Determine if object is transparent based on material opacity
        const opacity = obj.material?.opacity ?? 1;
        const isTransparent = opacity < 1;

        // World position (center)
        obj.getWorldPosition(tmpPos);
        const centerDist = camera.position.distanceTo(tmpPos);
        
        // Helper: assemble sample world points for an object
        function sampleWorldPointsFor(obj, geom) {
          const worldPoints = [];
          if (geom && geom.boundingBox) {
            const bb = geom.boundingBox;
            const corners = [
              bb.min, new THREE.Vector3(bb.min.x, bb.min.y, bb.max.z),
              new THREE.Vector3(bb.min.x, bb.max.y, bb.min.z), new THREE.Vector3(bb.min.x, bb.max.y, bb.max.z),
              new THREE.Vector3(bb.max.x, bb.min.y, bb.min.z), new THREE.Vector3(bb.max.x, bb.min.y, bb.max.z),
              new THREE.Vector3(bb.max.x, bb.max.y, bb.min.z), bb.max
            ];
            for (let c of corners) worldPoints.push(c.clone().applyMatrix4(obj.matrixWorld));
          } else {
            worldPoints.push(tmpPos.clone());
          }
          return worldPoints;
        }

        // --- Processing based on object type ---
        const mapImage = obj.material && obj.material.map && obj.material.map.image ? obj.material.map.image : null;
        if (mapImage) {
          const worldPoints = sampleWorldPointsFor(obj, obj.geometry);
          const dists = worldPoints.map(wp => camera.position.distanceTo(wp));
          const distNear = Math.min(...dists);
          const distFar = Math.max(...dists);
          const avgNdcZ = worldPoints.reduce((sum, wp) => {
            return sum + wp.clone().project(camera).z;
          }, 0) / worldPoints.length;
          
          const sx = (tmpPos.x * 0.5 + 0.5) * canvas.width;
          const sy = (-tmpPos.y * 0.5 + 0.5) * canvas.height;
          const drawable = { type: 'image', obj, sx, sy, distNear, distFar, avgNdcZ, mapImage };
          isTransparent ? transparentDrawables.push(drawable) : opaqueDrawables.push(drawable);
          return;
        } else if (obj.isMesh && obj.geometry) {
          const geom = obj.geometry;
          if (!geom.boundingBox) geom.computeBoundingBox && geom.computeBoundingBox();
          if (!geom.boundingSphere) geom.computeBoundingSphere && geom.computeBoundingSphere();
          
          const worldPoints = sampleWorldPointsFor(obj, geom);
          if (worldPoints.length === 0) return;
          
          const dists = worldPoints.map(wp => camera.position.distanceTo(wp));
          const distNear = Math.min(...dists);
          const distFar = Math.max(...dists);
          
          // Project points to 2D screen space and get NDC Z
          const pts2d = worldPoints.map(wp => {
            const projVec = wp.clone().project(camera);
            return {
              x: (projVec.x * 0.5 + 0.5) * canvas.width,
              y: (-projVec.y * 0.5 + 0.5) * canvas.height,
              ndcZ: projVec.z
            };
          });

          // Calculate average normalized depth
          const avgNdcZ = pts2d.reduce((sum, p) => sum + p.ndcZ, 0) / pts2d.length;

          const hull = convexHull(pts2d);
          if (hull.length >= 3) {
            const drawable = { type: 'poly', obj, pts: hull, distNear, distFar, avgNdcZ };
            isTransparent ? transparentDrawables.push(drawable) : opaqueDrawables.push(drawable);
          } else if (hull.length === 2) {
            const drawable = { type: 'line', obj, pts: hull, distNear, distFar, avgNdcZ };
            isTransparent ? transparentDrawables.push(drawable) : opaqueDrawables.push(drawable);
          } else if (obj.userData?.forceMarker) {
            const p = hull[0] || pts2d[0];
            const drawable = { type: 'rect', obj, sx: p.x, sy: p.y, distNear, distFar, avgNdcZ, sizePx: obj.userData?.markerSizePx ?? 6 };
            isTransparent ? transparentDrawables.push(drawable) : opaqueDrawables.push(drawable);
          }
          return;
        } else if (obj.userData?.forceMarker) {
          // Fallback for objects without geometry
          const drawable = { type: 'rect', obj, sx: (proj.x * 0.5 + 0.5) * canvas.width, sy: (-proj.y * 0.5 + 0.5) * canvas.height, distNear: centerDist, distFar: centerDist, avgNdcZ: proj.z, sizePx: obj.userData?.markerSizePx ?? 6 };
          isTransparent ? transparentDrawables.push(drawable) : opaqueDrawables.push(drawable);
        }
      });
      
      // --- Rendering Passes ---
      // Common sorting logic for both passes
      const sortFn = (a, b) => {
        const aZ = a.avgNdcZ !== undefined ? a.avgNdcZ : -Infinity;
        const bZ = b.avgNdcZ !== undefined ? b.avgNdcZ : -Infinity;
        if (aZ === bZ) {
          const aAvgDist = ((a.distNear ?? 0) + (a.distFar ?? 0)) * 0.5;
          const bAvgDist = ((b.distNear ?? 0) + (b.distFar ?? 0)) * 0.5;
          return bAvgDist - aAvgDist;
        }
        return bZ - aZ;
      };

      // Helper for drawing a drawable
      const draw = (d) => {
        const { obj } = d;
        const avgDist = ((d.distNear ?? 0) + (d.distFar ?? 0)) * 0.5;
        const alpha = obj.userData?.opacity ?? (obj.material?.opacity ?? 1);
        let color = obj.material?.color?.getStyle ? obj.material.color.getStyle() : (obj.userData?.color || 'white');

        if (d.type === 'image' && d.mapImage && d.mapImage.width) {
          const size = Math.max(8, obj.userData?.sizePx ?? (d.distFar / 100)); // Simple size scaling
          ctx.save();
          ctx.translate(d.sx, d.sy);
          const rot = obj.userData?.rotation ?? (obj.rotation?.z ?? 0);
          if (rot) ctx.rotate(rot);
          ctx.globalAlpha = alpha;
          ctx.drawImage(d.mapImage, -size / 2, -size / 2, size, size);
          ctx.restore();
        } else if (d.type === 'poly' && d.pts) {
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(d.pts[0].x, d.pts[0].y);
          for (let j = 1; j < d.pts.length; j++) ctx.lineTo(d.pts[j].x, d.pts[j].y);
          ctx.closePath();
          ctx.globalAlpha = alpha * Math.max(0.2, Math.min(1, 1 - (avgDist * 0.002)));
          ctx.fillStyle = color;
          ctx.fill();
          ctx.globalAlpha = alpha * 0.6;
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
          ctx.globalAlpha = alpha * (1 - Math.min(0.9, avgDist * 0.002));
          ctx.stroke();
        } else if (d.type === 'rect') {
          const size = d.sizePx ?? Math.max(2, Math.round(12 * (1 / Math.max(0.1, avgDist * 0.05))));
          const x = (d.sx || d.sx === 0) ? d.sx : 0;
          const y = (d.sy || d.sy === 0) ? d.sy : 0;
          ctx.save();
          ctx.globalAlpha = alpha * Math.max(0.5, Math.min(1, 1 - (avgDist * 0.002)));
          ctx.fillStyle = color;
          ctx.fillRect(x - size / 2, y - size / 2, size, size);
          ctx.restore();
        }
      };

      // Pass 1: Draw Opaque Objects (back to front)
      opaqueDrawables.sort(sortFn);
      opaqueDrawables.forEach(draw);

      // Pass 2: Draw Transparent Objects (back to front)
      transparentDrawables.sort(sortFn);
      transparentDrawables.forEach(draw);
    }
  };
  return api;
}

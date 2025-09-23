// PlayCanvas-based voidEngine replacement.
// Requires PlayCanvas engine loaded as global `pc`.
export function voidEngine({ width = 1280, height = 720 } = {}) {
  if (typeof pc === 'undefined') {
    throw new Error('PlayCanvas (pc) not found — include playcanvas-stable.min.js first.');
  }

  const canvas = document.createElement('canvas');
  canvas.style.position = 'relative';
  canvas.style.zIndex = '0';
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');

  // Scratch objects using PlayCanvas types
  const tmpVec = new pc.Vec3();
  const tmpVec2 = new pc.Vec3();
  const screenPt = new pc.Vec3();

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

  // Helper: recursively traverse PlayCanvas entity tree
  function traverseEntity(entity, cb) {
    if (!entity) return;
    cb(entity);
    const ch = entity._children || entity.children || []; // engine versions differ
    for (let i = 0; i < ch.length; i++) {
      traverseEntity(ch[i], cb);
    }
  }

  const api = {
    domElement: canvas,
    options: { strictNearClip: true },
    _clearColor: { hex: 0x000000, alpha: 1 },
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

    // sceneRoot: a PlayCanvas entity to traverse
    // cameraEntity: PlayCanvas entity with CameraComponent (cameraEntity.camera)
    render(sceneRoot, cameraEntity) {
      // clear
      const c = api._clearColor;
      const r = (c.hex >> 16) & 0xff;
      const g = (c.hex >> 8) & 0xff;
      const b = c.hex & 0xff;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = `rgba(${r},${g},${b},${c.alpha})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();

      if (!cameraEntity || !cameraEntity.camera) {
        // nothing to project with
        return;
      }
      const camComp = cameraEntity.camera;

      // collect drawables
      const drawables = [];

      traverseEntity(sceneRoot, (ent) => {
        // skip camera or disabled entities
        if (!ent.enabled) return;
        if (ent === cameraEntity) return;

        // Prefer model / meshInstances sampling
        if (ent.model && ent.model.model && ent.model.model.meshInstances && ent.model.model.meshInstances.length > 0) {
          const meshInstances = ent.model.model.meshInstances;
          const worldPoints = [];

          for (let mi of meshInstances) {
            if (!mi.aabb) continue;
            // mi.aabb is a pc.BoundingBox (world-space aabb)
            const min = mi.aabb.getMin ? mi.aabb.getMin() : mi.aabb.center.clone().sub(mi.aabb.halfExtents);
            const max = mi.aabb.getMax ? mi.aabb.getMax() : mi.aabb.center.clone().add(mi.aabb.halfExtents);

            // 8 corners
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
              worldPoints.push(new pc.Vec3(c[0], c[1], c[2]));
            }
          }

          // if we have no points from meshInstances, fallback to entity world position
          if (worldPoints.length === 0) {
            const wp = ent.getPosition(); // returns world pos
            if (wp) worldPoints.push(wp.clone ? wp.clone() : new pc.Vec3(wp.x, wp.y, wp.z));
          }

          // compute distances
          const camPos = cameraEntity.getPosition();
          const dists = worldPoints.map(wp => {
            return camPos.clone().sub(wp).length();
          });
          const distNear = Math.min(...dists);
          const distFar = Math.max(...dists);

          // Project only points that are in front of the near plane
          const pts2d = [];
          for (let wp of worldPoints) {
            // camera.worldToScreen writes pixel coords (x,y) into out Vector3, and z = clip depth (neg behind camera).
            camComp.worldToScreen(wp, screenPt);
            // screenPt.x, screenPt.y are pixels relative to bottom-left (PlayCanvas), so convert to top-left origin for canvas:
            const sx = screenPt.x;
            const sy = screenPt.y;
            // PlayCanvas historically sometimes returns y from bottom – flip to canvas top-left
            const canvasX = sx;
            const canvasY = canvas.height - sy;
            pts2d.push({ x: canvasX, y: canvasY, ndcZ: screenPt.z });
          }

          // If we have no projected points -> maybe behind near plane
          if (pts2d.length === 0) {
            // allow marker fallback
            const p = ent.getPosition();
            if (p) {
              camComp.worldToScreen(p, screenPt);
              const sx = screenPt.x;
              const sy = canvas.height - screenPt.y;
              drawables.push({ type: 'rect', ent, sx, sy, distNear, distFar, sizePx: 6 });
            }
            return;
          }

          const hull = convexHull(pts2d);
          if (hull.length >= 3) {
            drawables.push({ type: 'poly', ent, pts: hull, distNear, distFar, projZ: pts2d.reduce((acc, p) => acc + p.ndcZ, 0)/pts2d.length });
          } else if (hull.length === 2) {
            drawables.push({ type: 'line', ent, pts: hull, distNear, distFar });
          } else {
            const p = hull[0] || pts2d[0];
            drawables.push({ type: 'rect', ent, sx: p.x, sy: p.y, distNear, distFar, sizePx: 6 });
          }

          return;
        }

        // Fallback: if this entity has an element (UI image) or sprite-like thing, we could sample its position
        // For now: fallback marker if user marked entity.enabled and ent._forceMarker true (convention)
        if (ent._forceMarker) {
          const p = ent.getPosition();
          if (!p) return;
          camComp.worldToScreen(p, screenPt);
          const sx = screenPt.x;
          const sy = canvas.height - screenPt.y;
          drawables.push({ type: 'rect', ent, sx, sy, distNear: 0, distFar: 0, sizePx: ent._markerSizePx || 8 });
        }
      });

      // Sort painter order by distFar
      drawables.sort((a, b) => {
        const aFar = a.distFar ?? 0;
        const bFar = b.distFar ?? 0;
        if (aFar === bFar) {
          const aNear = a.distNear ?? 0;
          const bNear = b.distNear ?? 0;
          return bNear - aNear;
        }
        return bFar - aFar;
      });

      // draw
      for (let d of drawables) {
        const ent = d.ent;
        const avgDist = ((d.distNear ?? 0) + (d.distFar ?? 0)) * 0.5;
        // try to pick color from first meshInstance.material if available
        let color = 'white';
        if (ent.model && ent.model.model && ent.model.model.meshInstances && ent.model.model.meshInstances.length) {
          const mi = ent.model.model.meshInstances[0];
          if (mi.material && mi.material.diffuse) {
            // material.diffuse might be a pc.Color
            const col = mi.material.diffuse;
            if (col.r !== undefined) {
              const rr = Math.round(col.r * 255);
              const gg = Math.round(col.g * 255);
              const bb = Math.round(col.b * 255);
              color = `rgb(${rr},${gg},${bb})`;
            }
          }
        }
        if (d.type === 'poly') {
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
          ctx.lineWidth = ent._lineWidth ?? 3;
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
    }
  };

  return api;
}

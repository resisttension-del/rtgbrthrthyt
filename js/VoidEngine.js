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
      // Clear the canvas
      const c = api._clearColor;
      const r = (c.hex >> 16) & 0xff;
      const g = (c.hex >> 8) & 0xff;
      const b = c.hex & 0xff;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = `rgba(${r},${g},${b},${c.alpha})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();

      camera.updateMatrixWorld();
      if (camera.updateProjectionMatrix) camera.updateProjectionMatrix();

      const camInv = tmpMat.copy(camera.matrixWorld).invert();

      // 1. Collect drawables (only meshes with bounding boxes for boxes)
      const drawables = [];
      scene.traverse((obj) => {
        if (!obj.visible) return;
        if (obj.isCamera || obj.isLight) return;
        if (!obj.isMesh || !obj.geometry) return;

        // Ensure bounding box
        const geom = obj.geometry;
        if (!geom.boundingBox) geom.computeBoundingBox && geom.computeBoundingBox();

        if (geom.boundingBox) {
          // Project all 8 corners of the box
          const bb = geom.boundingBox;
          const corners = [
            [bb.min.x, bb.min.y, bb.min.z], [bb.min.x, bb.min.y, bb.max.z],
            [bb.min.x, bb.max.y, bb.min.z], [bb.min.x, bb.max.y, bb.max.z],
            [bb.max.x, bb.min.y, bb.min.z], [bb.max.x, bb.min.y, bb.max.z],
            [bb.max.x, bb.max.y, bb.min.z], [bb.max.x, bb.max.y, bb.max.z]
          ];
          const pts2d = [];
          const zs = [];
          for (let c of corners) {
            tmpVec.set(c[0], c[1], c[2]).applyMatrix4(obj.matrixWorld);
            const cameraSpace = tmpVec.clone().applyMatrix4(camInv);
            const projected = tmpVec.clone().project(camera);
            const px = (projected.x * 0.5 + 0.5) * canvas.width;
            const py = (-projected.y * 0.5 + 0.5) * canvas.height;
            pts2d.push({ x: px, y: py, ndcZ: projected.z });
            zs.push(cameraSpace.z);
          }
          // Use the minimum z (closest point to camera) for painter's sort
          const minZ = Math.min(...zs);

          // Build convex hull for footprint
          const hull = convexHull(pts2d);

          drawables.push({
            type: 'box',
            obj,
            pts: hull,
            zSort: minZ, // painter's sort key
            color: obj.userData?.color || (obj.material.color ? obj.material.color.getStyle() : 'white'),
            opacity: obj.material.opacity !== undefined ? obj.material.opacity : 1,
            outline: !!obj.userData?.drawBoundingBox
          });
        }
      });

      // 2. Sort by closest z (painter's order: farthest first)
      drawables.sort((a, b) => a.zSort - b.zSort);

      // 3. Draw
      for (const d of drawables) {
        // Fill the convex hull footprint
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(d.pts[0].x, d.pts[0].y);
        for (let j = 1; j < d.pts.length; j++) ctx.lineTo(d.pts[j].x, d.pts[j].y);
        ctx.closePath();
        ctx.globalAlpha = d.opacity;
        ctx.fillStyle = d.color;
        ctx.fill();

        // Optionally draw outline
        if (d.outline) {
          ctx.globalAlpha = 1;
          ctx.lineWidth = 2;
          ctx.strokeStyle = 'yellow';
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  };

  return api;
}

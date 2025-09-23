import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";

export function voidEngine({ width = 1280, height = 720 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.style.position = 'relative';
  canvas.style.zIndex = '0';
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  let clearColor = { hex: 0x000000, alpha: 1 };

  const api = {
    domElement: canvas,
    setSize(w, h, updateStyle = true) {
      canvas.width = w;
      canvas.height = h;
      if (updateStyle) {
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
    },
    setClearColor(hex, alpha = 1) {
      clearColor = { hex, alpha };
    },
    // Only draw boxes: sort by depth, draw filled then outline if requested
    render(scene, camera) {
      // Clear
      const c = clearColor;
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

      const boxes = [];
      scene.traverse(obj => {
        if (!obj.visible) return;
        if (!obj.isMesh || !obj.geometry || !obj.geometry.boundingBox) return;

        // Get world-space box corners
        obj.geometry.computeBoundingBox();
        const bb = obj.geometry.boundingBox;
        const corners = [
          [bb.min.x, bb.min.y, bb.min.z], [bb.min.x, bb.min.y, bb.max.z],
          [bb.min.x, bb.max.y, bb.min.z], [bb.min.x, bb.max.y, bb.max.z],
          [bb.max.x, bb.min.y, bb.min.z], [bb.max.x, bb.min.y, bb.max.z],
          [bb.max.x, bb.max.y, bb.min.z], [bb.max.x, bb.max.y, bb.max.z]
        ];
        // Project all corners to screen
        const screenPts = corners.map(c =>
          new THREE.Vector3(c[0], c[1], c[2]).applyMatrix4(obj.matrixWorld).project(camera)
        );
        // Screen coordinates
        const xs = screenPts.map(p => (p.x * 0.5 + 0.5) * canvas.width);
        const ys = screenPts.map(p => (-p.y * 0.5 + 0.5) * canvas.height);
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minY = Math.min(...ys), maxY = Math.max(...ys);
        // Use average z of box for sorting
        const avgZ = screenPts.reduce((sum, p) => sum + p.z, 0) / screenPts.length;

        boxes.push({
          x: minX, y: minY,
          width: Math.max(2, maxX - minX),
          height: Math.max(2, maxY - minY),
          z: avgZ,
          color: obj.userData?.color || (obj.material.color ? obj.material.color.getStyle() : '#eee'),
          opacity: obj.material.opacity ?? 1,
          outline: !!obj.userData?.drawBoundingBox
        });
      });

      // Sort boxes farthest to nearest (most negative z to least)
      boxes.sort((a, b) => a.z - b.z);

      // Draw all boxes
      for (const box of boxes) {
        ctx.save();
        ctx.globalAlpha = box.opacity;
        ctx.fillStyle = box.color;
        ctx.fillRect(box.x, box.y, box.width, box.height);
        ctx.restore();

        if (box.outline) {
          ctx.save();
          ctx.globalAlpha = 1;
          ctx.strokeStyle = 'yellow';
          ctx.lineWidth = 2;
          ctx.strokeRect(box.x, box.y, box.width, box.height);
          ctx.restore();
        }
      }
    }
  };

  return api;
}

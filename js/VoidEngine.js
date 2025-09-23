import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";

// Helper to project a 3D point to 2D screen coordinates
function projectToScreen(vec3, camera, width, height) {
  const projected = vec3.clone().project(camera);
  return {
    x: (projected.x * 0.5 + 0.5) * width,
    y: (-projected.y * 0.5 + 0.5) * height,
    z: projected.z // NDC z for depth sorting
  };
}

export function voidEngine({ width = 1280, height = 720 } = {}) {
  // Create canvas
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.style.position = 'relative';
  canvas.style.zIndex = '0';
  const ctx = canvas.getContext('2d');

  // Default clear color
  let clearColor = 'rgba(0,0,0,1)';

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
      const r = (hex >> 16) & 0xff;
      const g = (hex >> 8) & 0xff;
      const b = hex & 0xff;
      clearColor = `rgba(${r},${g},${b},${alpha})`;
    },

    // Render: expects scene and camera, only draws boxes
    render(scene, camera) {
      // Clear background
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = clearColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();

      camera.updateMatrixWorld();
      if (camera.updateProjectionMatrix) camera.updateProjectionMatrix();

      // Collect all box data
      const boxes = [];

      scene.traverse((obj) => {
        if (!obj.visible) return;
        if (!obj.isMesh || !obj.geometry || !obj.geometry.boundingBox) return;

        // Project box center to screen
        const box = obj.geometry.boundingBox;
        const center = box.getCenter(new THREE.Vector3()).applyMatrix4(obj.matrixWorld);
        const screen = projectToScreen(center, camera, canvas.width, canvas.height);

        // Project 8 corners to screen to get bounding box on screen
        const corners = [
          [box.min.x, box.min.y, box.min.z], [box.min.x, box.min.y, box.max.z],
          [box.min.x, box.max.y, box.min.z], [box.min.x, box.max.y, box.max.z],
          [box.max.x, box.min.y, box.min.z], [box.max.x, box.min.y, box.max.z],
          [box.max.x, box.max.y, box.min.z], [box.max.x, box.max.y, box.max.z]
        ];
        const pts2d = corners.map(([x, y, z]) =>
          projectToScreen(new THREE.Vector3(x, y, z).applyMatrix4(obj.matrixWorld), camera, canvas.width, canvas.height)
        );
        const xs = pts2d.map(p => p.x);
        const ys = pts2d.map(p => p.y);
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minY = Math.min(...ys), maxY = Math.max(...ys);

        // Use screen z for depth sorting (lower z = closer)
        boxes.push({
          x: minX, y: minY,
          width: Math.max(2, maxX - minX),
          height: Math.max(2, maxY - minY),
          z: screen.z,
          color: obj.userData?.color || (obj.material.color ? obj.material.color.getStyle() : 'rgba(200,0,0,0.7)'),
          opacity: obj.material.opacity !== undefined ? obj.material.opacity : 1,
          drawBoundingBox: !!obj.userData?.drawBoundingBox
        });
      });

      // Sort by z (largest first = farthest), draw farthest to nearest
      boxes.sort((a, b) => b.z - a.z);

      // Draw each box, then overlays
      for (const box of boxes) {
        ctx.save();
        ctx.globalAlpha = box.opacity;
        ctx.fillStyle = box.color;
        ctx.fillRect(box.x, box.y, box.width, box.height);
        ctx.restore();

        if (box.drawBoundingBox) {
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

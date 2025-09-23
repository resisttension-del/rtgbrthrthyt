import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";

export function voidEngine({ width = 1280, height = 720 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.style.position = 'relative';
  canvas.style.zIndex = '0';
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  const tmpVec = new THREE.Vector3();
  const tmpMat = new THREE.Matrix4();

  function projectToScreen(vec, camera) {
    const p = vec.clone().project(camera);
    return {
      x: (p.x * 0.5 + 0.5) * width,
      y: (-p.y * 0.5 + 0.5) * height,
      z: p.z
    };
  }

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

      // Collect all box faces to render
      const faces = [];
      scene.traverse(obj => {
        if (!obj.visible) return;
        if (!obj.isMesh || !obj.geometry) return;
        const geom = obj.geometry;
        if (!geom.boundingBox) geom.computeBoundingBox && geom.computeBoundingBox();
        if (!geom.boundingBox) return;

        // Get box corners in world space
        const bb = geom.boundingBox;
        const corners = [
          new THREE.Vector3(bb.min.x, bb.min.y, bb.min.z),
          new THREE.Vector3(bb.min.x, bb.min.y, bb.max.z),
          new THREE.Vector3(bb.min.x, bb.max.y, bb.min.z),
          new THREE.Vector3(bb.min.x, bb.max.y, bb.max.z),
          new THREE.Vector3(bb.max.x, bb.min.y, bb.min.z),
          new THREE.Vector3(bb.max.x, bb.min.y, bb.max.z),
          new THREE.Vector3(bb.max.x, bb.max.y, bb.min.z),
          new THREE.Vector3(bb.max.x, bb.max.y, bb.max.z)
        ].map(v => v.applyMatrix4(obj.matrixWorld));

        // Each box face: 4 indices into corners array
        const boxFaces = [
          [0, 1, 3, 2], // -X
          [4, 6, 7, 5], // +X
          [0, 4, 5, 1], // -Y
          [2, 3, 7, 6], // +Y
          [0, 2, 6, 4], // -Z
          [1, 5, 7, 3]  // +Z
        ];

        const faceColor = obj.userData?.color || (obj.material.color ? obj.material.color.getStyle() : 'white');
        const opacity = obj.material.opacity !== undefined ? obj.material.opacity : 1;

for (const idxs of boxFaces) {
  // Get face world space corners
  const faceCorners = idxs.map(i => corners[i]);
  // Compute face normal
  const v0 = faceCorners[0], v1 = faceCorners[1], v2 = faceCorners[2];
  const normal = v1.clone().sub(v0).cross(v2.clone().sub(v0)).normalize();
  // Camera direction
  const camDir = camera.position.clone().sub(v0).normalize();
  // Only draw if facing camera (back-face culling)
  if (normal.dot(camDir) < 0) {
    const pts2d = faceCorners.map(corner => projectToScreen(corner, camera));
    const minZ = Math.min(...pts2d.map(p => p.z));
    faces.push({
      pts: pts2d,
      zSort: minZ,
      color: faceColor,
      opacity
    });
  }
}
      });

      // Sort faces back-to-front (largest z = farthest)
      faces.sort((a, b) => b.avgZ - a.avgZ);

      // Draw faces
      for (const face of faces) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(face.pts[0].x, face.pts[0].y);
        for (let j = 1; j < face.pts.length; j++) ctx.lineTo(face.pts[j].x, face.pts[j].y);
        ctx.closePath();
        ctx.globalAlpha = face.opacity;
        ctx.fillStyle = face.color;
        ctx.fill();
        // Optional: draw edge for clarity
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'black';
        ctx.stroke();
        ctx.restore();
      }
    }
  };

  return api;
}

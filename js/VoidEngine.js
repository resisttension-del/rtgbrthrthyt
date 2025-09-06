import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";

export function voidEngine({ width = 640, height = 360, mode = "painter" } = {}) {
  // --- Canvas setup ---
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.style.display = "block";
  canvas.style.imageRendering = "pixelated";
  const ctx = canvas.getContext("2d", { alpha: true });

  let clearColor = { r: 0, g: 0, b: 0, a: 1 };

  function hexToRgba(hex, alpha = 1) {
    const r = (hex >> 16) & 255;
    const g = (hex >> 8) & 255;
    const b = hex & 255;
    return { r, g, b, a: alpha };
  }
  function rgbaToCss({ r, g, b, a }) {
    return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;
  }

  // build AABB corners and face index layout for a box given min/max (local space)
  function buildBoxLocalCorners(min, max) {
    return [
      new THREE.Vector3(min.x, min.y, min.z), // 0
      new THREE.Vector3(max.x, min.y, min.z), // 1
      new THREE.Vector3(max.x, max.y, min.z), // 2
      new THREE.Vector3(min.x, max.y, min.z), // 3
      new THREE.Vector3(min.x, min.y, max.z), // 4
      new THREE.Vector3(max.x, min.y, max.z), // 5
      new THREE.Vector3(max.x, max.y, max.z), // 6
      new THREE.Vector3(min.x, max.y, max.z)  // 7
    ];
  }
  const BOX_FACES = [
    [4,5,6,7], // +Z (front)
    [0,1,2,3], // -Z (back)
    [0,4,5,1], // -Y (bottom)
    [3,7,6,2], // +Y (top)
    [1,5,6,2], // +X (right)
    [0,3,7,4]  // -X (left)
  ];

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
    setClearColor(hex = 0x000000, alpha = 1) {
      clearColor = hexToRgba(hex, alpha);
    },

    render(scene, camera) {
      if (!scene || !camera) return;

      // ensure up-to-date
      scene.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);

      // camera inverse for near-plane checks
      const camInv = new THREE.Matrix4().copy(camera.matrixWorld).invert();

      // clear
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (clearColor.a > 0) {
        ctx.fillStyle = rgbaToCss(clearColor);
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      const facesToDraw = []; // { pts:[{x,y}...], color, depth }
      const cornerDots = [];  // { x,y, depth, size, color }

      // very simple directional light (world-space)
      const lightDir = new THREE.Vector3(1, 1, 0.5).normalize();

      const near = camera.near || 0.001;

      scene.traverseVisible((object) => {
        if (object.isMesh && object.visible && object.geometry) {
          object.updateMatrixWorld(true);

          const geometry = object.geometry;
          // ensure bounding box exists
          if (!geometry.boundingBox) geometry.computeBoundingBox();
          const bb = geometry.boundingBox;
          if (!bb) return;

          // material color fallback
          let matColor = { r: 255, g: 255, b: 255, a: 1 };
          let opacity = 1;
          if (object.material) {
            const m = object.material;
            if (m.color && m.color.isColor) {
              matColor = { r: m.color.r * 255, g: m.color.g * 255, b: m.color.b * 255, a: 1 };
            }
            opacity = m.opacity !== undefined ? m.opacity : 1;
          }

          // build local corners and transform to world space
          const localCorners = buildBoxLocalCorners(bb.min, bb.max);
          const worldCorners = localCorners.map((c) => c.clone().applyMatrix4(object.matrixWorld));

          // compute center for view checks
          const center = new THREE.Vector3();
          for (let i = 0; i < 8; i++) center.add(worldCorners[i]);
          center.multiplyScalar(1/8);

          // prepare projected corner data for dots later (we'll compute projection per corner)
          const projCorners = [];
          for (let i = 0; i < 8; i++) {
            const wc = worldCorners[i];
            const camSpace = wc.clone().applyMatrix4(camInv);
            // If corner is behind near plane, still compute projection but mark it
            const pv = wc.clone().project(camera);
            projCorners.push({ world: wc, camZ: camSpace.z, pv });
          }

          // push corner dots (we'll draw them after faces)
          for (let i = 0; i < 8; i++) {
            const pc = projCorners[i];
            // skip if projection invalid
            if (!Number.isFinite(pc.pv.x) || !Number.isFinite(pc.pv.y) || !Number.isFinite(pc.pv.z)) continue;
            // if completely off-screen we still might draw endpoints for debugging; skip majorly out-of-range points
            if (pc.pv.x < -2 || pc.pv.x > 2 || pc.pv.y < -2 || pc.pv.y > 2) continue;

            const sx = (pc.pv.x * 0.5 + 0.5) * canvas.width;
            const sy = (-pc.pv.y * 0.5 + 0.5) * canvas.height;
            const depth = Math.max(0.000001, -pc.camZ); // positive depth
            // size scales inversely with depth (closer = bigger)
            const size = Math.max(2, 12 / (depth * 0.2 + 1));
            cornerDots.push({
              x: sx, y: sy, depth,
              size,
              color: rgbaToCss({ r: matColor.r, g: matColor.g, b: matColor.b, a: Math.min(1, opacity) })
            });
          }

          // For each face, compute world-space normal, backface cull, project and shade
          for (let fi = 0; fi < BOX_FACES.length; fi++) {
            const idx = BOX_FACES[fi];
            const v0w = worldCorners[idx[0]];
            const v1w = worldCorners[idx[1]];
            const v2w = worldCorners[idx[2]];
            const v3w = worldCorners[idx[3]];

            // world-space normal
            const e1 = new THREE.Vector3().subVectors(v1w, v0w);
            const e2 = new THREE.Vector3().subVectors(v2w, v0w);
            const faceNormal = new THREE.Vector3().crossVectors(e1, e2).normalize();

            // face center
            const faceCenter = new THREE.Vector3().addVectors(v0w, v1w).add(v2w).add(v3w).multiplyScalar(0.25);

            // view vector (world-space)
            const viewVec = new THREE.Vector3().subVectors(camera.position, faceCenter).normalize();

            // backface cull: skip if facing away
            if (faceNormal.dot(viewVec) <= 0) continue;

            // ensure all corners are in front of near-plane (simple per-face early skip)
            const camV0 = v0w.clone().applyMatrix4(camInv);
            const camV1 = v1w.clone().applyMatrix4(camInv);
            const camV2 = v2w.clone().applyMatrix4(camInv);
            const camV3 = v3w.clone().applyMatrix4(camInv);
            if (camV0.z > -near || camV1.z > -near || camV2.z > -near || camV3.z > -near) {
              // simple approach: skip faces that have corners crossing the near plane
              continue;
            }

            // compute depth (average positive depth)
            const depth = Math.max(0.000001, (-camV0.z + -camV1.z + -camV2.z + -camV3.z) * 0.25);

            // project to NDC then to screen
            const pv0 = v0w.clone().project(camera);
            const pv1 = v1w.clone().project(camera);
            const pv2 = v2w.clone().project(camera);
            const pv3 = v3w.clone().project(camera);

            if (
              !Number.isFinite(pv0.x) || !Number.isFinite(pv0.y) ||
              !Number.isFinite(pv1.x) || !Number.isFinite(pv1.y) ||
              !Number.isFinite(pv2.x) || !Number.isFinite(pv2.y) ||
              !Number.isFinite(pv3.x) || !Number.isFinite(pv3.y)
            ) continue;

            // trivial off-screen cull (if all verts on same side then skip)
            if (
              (pv0.x < -1 && pv1.x < -1 && pv2.x < -1 && pv3.x < -1) ||
              (pv0.x > 1 && pv1.x > 1 && pv2.x > 1 && pv3.x > 1) ||
              (pv0.y < -1 && pv1.y < -1 && pv2.y < -1 && pv3.y < -1) ||
              (pv0.y > 1 && pv1.y > 1 && pv2.y > 1 && pv3.y > 1)
            ) {
              continue;
            }

            const sx0 = (pv0.x * 0.5 + 0.5) * canvas.width;
            const sy0 = (-pv0.y * 0.5 + 0.5) * canvas.height;
            const sx1 = (pv1.x * 0.5 + 0.5) * canvas.width;
            const sy1 = (-pv1.y * 0.5 + 0.5) * canvas.height;
            const sx2 = (pv2.x * 0.5 + 0.5) * canvas.width;
            const sy2 = (-pv2.y * 0.5 + 0.5) * canvas.height;
            const sx3 = (pv3.x * 0.5 + 0.5) * canvas.width;
            const sy3 = (-pv3.y * 0.5 + 0.5) * canvas.height;

            // shading
            const lambert = Math.max(0, faceNormal.dot(lightDir));
            const intensity = 0.16 + 0.84 * lambert; // ambient + diffuse
            const shaded = {
              r: matColor.r * intensity,
              g: matColor.g * intensity,
              b: matColor.b * intensity,
              a: opacity
            };

            facesToDraw.push({
              pts: [
                { x: sx0, y: sy0 },
                { x: sx1, y: sy1 },
                { x: sx2, y: sy2 },
                { x: sx3, y: sy3 }
              ],
              color: rgbaToCss(shaded),
              depth
            });
          } // faces
        } // mesh end
        // sprites unchanged
        if (object.isSprite && object.visible) {
          object.updateMatrixWorld(true);
          const wp = new THREE.Vector3();
          object.getWorldPosition(wp);
          wp.project(camera);

          if (!(wp.x < -1 || wp.x > 1 || wp.y < -1 || wp.y > 1 || wp.z < -1 || wp.z > 1)) {
            const sx = (wp.x * 0.5 + 0.5) * canvas.width;
            const sy = (-wp.y * 0.5 + 0.5) * canvas.height;
            const scale = object.scale ? (object.scale.x || 1) : 1;
            let sizePx = 32 * scale;
            if (camera.isPerspectiveCamera) {
              const dist = object.getWorldPosition(new THREE.Vector3()).distanceTo(camera.getWorldPosition(new THREE.Vector3()));
              sizePx = Math.max(4, sizePx / Math.max(0.001, dist * 0.1));
            }
            // draw sprite as simple filled circle
            ctx.beginPath();
            ctx.fillStyle = object.material && object.material.color && object.material.color.isColor
              ? `rgba(${Math.round(object.material.color.r*255)},${Math.round(object.material.color.g*255)},${Math.round(object.material.color.b*255)},${object.material.opacity!==undefined?object.material.opacity:1})`
              : "#fff";
            ctx.arc(sx, sy, Math.max(1, sizePx*0.5), 0, Math.PI*2);
            ctx.fill();
          }
        }
      }); // traverseVisible

      // sort faces far -> near
      facesToDraw.sort((a,b) => b.depth - a.depth);

      // draw filled faces (no outlines)
      for (let i = 0; i < facesToDraw.length; i++) {
        const f = facesToDraw[i];
        if (!f || !f.pts || f.pts.length < 3) continue;
        ctx.beginPath();
        ctx.moveTo(f.pts[0].x, f.pts[0].y);
        for (let j = 1; j < f.pts.length; j++) ctx.lineTo(f.pts[j].x, f.pts[j].y);
        ctx.closePath();
        ctx.fillStyle = f.color;
        ctx.fill();
      }

      // draw corner endpoints on top (near -> far so nearer endpoints overpaint)
      cornerDots.sort((a,b) => a.depth - b.depth); // smaller depth = nearer => draw last for on-top
      for (let i = 0; i < cornerDots.length; i++) {
        const d = cornerDots[i];
        // clamp small/large
        const size = Math.max(1.5, Math.min(18, d.size));
        ctx.beginPath();
        ctx.fillStyle = d.color;
        ctx.arc(d.x, d.y, size * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
    },

    dispose() {
      // nothing heavy
    },
  };

  api.setSize(width, height, false);
  api.setClearColor(0x000000, 1);
  return api;
}

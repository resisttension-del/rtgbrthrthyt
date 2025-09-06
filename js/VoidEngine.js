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

  // scratch
  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const camV0 = new THREE.Vector3();
  const camV1 = new THREE.Vector3();
  const camV2 = new THREE.Vector3();

  function hexToRgba(hex, alpha = 1) {
    const r = (hex >> 16) & 255;
    const g = (hex >> 8) & 255;
    const b = hex & 255;
    return { r, g, b, a: alpha };
  }
  function rgbaToCss({ r, g, b, a }) {
    return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;
  }

  // helper: linear interp of THREE.Vector3 into out
  function lerpVec(out, a, b, t) {
    out.x = a.x + (b.x - a.x) * t;
    out.y = a.y + (b.y - a.y) * t;
    out.z = a.z + (b.z - a.z) * t;
    return out;
  }

  // clip polygon (in camera space) against near-plane z = -near.
  // inputs:
  //  inWorld: array of world-space THREE.Vector3 objects (corresponding to inCam)
  //  inCam:  array of camera-space THREE.Vector3 objects (same length)
  // returns array of clipped triangles as arrays of world-space vertices (triangles)
  function clipPolygonAgainstNear(inWorld, inCam, near) {
    if (inWorld.length !== inCam.length) return [];

    // Sutherland–Hodgman for single plane. We'll produce polygon (world & cam) clipped.
    let outWorld = [];
    let outCam = [];

    function isInside(camV) {
      // camera-space: points in front of camera have negative z (three.js convention).
      // near plane at z = -near. Inside = z <= -near
      return camV.z <= -near;
    }

    const n = inWorld.length;
    for (let i = 0; i < n; i++) {
      const aW = inWorld[i];
      const aC = inCam[i];
      const j = (i + 1) % n;
      const bW = inWorld[j];
      const bC = inCam[j];

      const aIn = isInside(aC);
      const bIn = isInside(bC);

      if (aIn && bIn) {
        // both inside -> push b
        outWorld.push(bW.clone());
        outCam.push(bC.clone());
      } else if (aIn && !bIn) {
        // leaving -> push intersection
        const t = ( -near - aC.z ) / (bC.z - aC.z);
        // clamp t for safety
        const tt = Math.max(0, Math.min(1, t));
        const iW = new THREE.Vector3();
        const iC = new THREE.Vector3();
        lerpVec(iW, aW, bW, tt);
        lerpVec(iC, aC, bC, tt);
        outWorld.push(iW);
        outCam.push(iC);
      } else if (!aIn && bIn) {
        // entering -> push intersection then b
        const t = ( -near - aC.z ) / (bC.z - aC.z);
        const tt = Math.max(0, Math.min(1, t));
        const iW = new THREE.Vector3();
        const iC = new THREE.Vector3();
        lerpVec(iW, aW, bW, tt);
        lerpVec(iC, aC, bC, tt);
        outWorld.push(iW);
        outCam.push(iC);
        outWorld.push(bW.clone());
        outCam.push(bC.clone());
      } else {
        // both outside -> push nothing
      }
    }

    // now outWorld/outCam represent the clipped polygon (0..4 verts)
    // triangulate fan if >=3 verts
    const tris = [];
    if (outWorld.length >= 3) {
      for (let i = 1; i < outWorld.length - 1; i++) {
        tris.push([ outWorld[0].clone(), outWorld[i].clone(), outWorld[i+1].clone() ]);
      }
    }
    return tris;
  }

  // build AABB corners and face index layout for a box given min/max (world-space)
  function buildBoxFaces(min, max) {
    // eight corners
    const v = [
      new THREE.Vector3(min.x, min.y, min.z), // 0
      new THREE.Vector3(max.x, min.y, min.z), // 1
      new THREE.Vector3(max.x, max.y, min.z), // 2
      new THREE.Vector3(min.x, max.y, min.z), // 3
      new THREE.Vector3(min.x, min.y, max.z), // 4
      new THREE.Vector3(max.x, min.y, max.z), // 5
      new THREE.Vector3(max.x, max.y, max.z), // 6
      new THREE.Vector3(min.x, max.y, max.z)  // 7
    ];

    // each face is 4 indices (ordered CCW when looking at the face from outside)
    const faces = [
      [4,5,6,7], // +Z (front)
      [0,1,2,3], // -Z (back)
      [0,4,5,1], // -Y (bottom)
      [3,7,6,2], // +Y (top)
      [1,5,6,2], // +X (right)
      [0,3,7,4]  // -X (left)
    ];
    return { verts: v, faces };
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
    setClearColor(hex = 0x000000, alpha = 1) {
      clearColor = hexToRgba(hex, alpha);
    },

    render(scene, camera) {
      if (!scene || !camera) return;

      // ensure up-to-date
      scene.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);

      // compute a fresh camera inverse matrix (don't rely on camera.matrixWorldInverse being set)
      const camInv = new THREE.Matrix4().copy(camera.matrixWorld).invert();

      // clear
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (clearColor.a > 0) {
        ctx.fillStyle = rgbaToCss(clearColor);
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      const facesToDraw = []; // we'll push individual visible faces (screen polys) here
      const sprites = [];

      // simple directional light used to shade box faces (world-space)
      const lightDir = new THREE.Vector3(1, 1, 0.6).normalize(); // tweakable

      scene.traverseVisible((object) => {
        if (object.isMesh && object.visible && object.geometry) {
          const geometry = object.geometry;
          const posAttr = geometry.attributes && geometry.attributes.position;
          if (!posAttr) return;

          object.updateMatrixWorld(true);

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

          const colorCssBase = `rgba(${Math.round(matColor.r)},${Math.round(matColor.g)},${Math.round(matColor.b)},${opacity})`;

          const index = geometry.index ? geometry.index.array : null;
          const posArray = posAttr.array;
          const itemSize = posAttr.itemSize || 3;
          const count = index ? index.length : posArray.length / itemSize;

          // iterate triangles (we still iterate triangles to compute per-triangle bounding boxes)
          for (let i = 0; i < count; i += 3) {
            const ai = index ? index[i] : i;
            const bi = index ? index[i+1] : i+1;
            const ci = index ? index[i+2] : i+2;

            // get world positions for triangle vertices
            const wA = new THREE.Vector3().fromArray(posArray, ai * itemSize).applyMatrix4(object.matrixWorld);
            const wB = new THREE.Vector3().fromArray(posArray, bi * itemSize).applyMatrix4(object.matrixWorld);
            const wC = new THREE.Vector3().fromArray(posArray, ci * itemSize).applyMatrix4(object.matrixWorld);

            // compute camera-space positions
            const cA = wA.clone().applyMatrix4(camInv);
            const cB = wB.clone().applyMatrix4(camInv);
            const cC = wC.clone().applyMatrix4(camInv);

            const near = camera.near || 0.001;

            // Clip triangle against near plane properly; if completely clipped skip
            const clippedTris = clipPolygonAgainstNear([wA, wB, wC], [cA, cB, cC], near);
            if (!clippedTris || clippedTris.length === 0) continue;

            // For each clipped triangle, create its world-space AABB and render that as a 3D box (cuboid)
            for (let ct = 0; ct < clippedTris.length; ct++) {
              const triW = clippedTris[ct];

              // Compute AABB from the triangle's world-space verts
              const mins = new THREE.Vector3(
                Math.min(triW[0].x, triW[1].x, triW[2].x),
                Math.min(triW[0].y, triW[1].y, triW[2].y),
                Math.min(triW[0].z, triW[1].z, triW[2].z)
              );
              const maxs = new THREE.Vector3(
                Math.max(triW[0].x, triW[1].x, triW[2].x),
                Math.max(triW[0].y, triW[1].y, triW[2].y),
                Math.max(triW[0].z, triW[1].z, triW[2].z)
              );

              // ensure non-zero thickness so box is visible (small epsilon)
              const eps = 1e-4;
              if (maxs.x - mins.x < eps) { maxs.x += eps; mins.x -= eps; }
              if (maxs.y - mins.y < eps) { maxs.y += eps; mins.y -= eps; }
              if (maxs.z - mins.z < eps) { maxs.z += eps; mins.z -= eps; }

              const { verts: boxVerts, faces } = buildBoxFaces(mins, maxs);

              // For each face, decide if it's front-facing and project it
              for (let fi = 0; fi < faces.length; fi++) {
                const idx = faces[fi];
                const v0w = boxVerts[idx[0]];
                const v1w = boxVerts[idx[1]];
                const v2w = boxVerts[idx[2]];
                const v3w = boxVerts[idx[3]];

                // world-space face normal (outward)
                const e1 = new THREE.Vector3().subVectors(v1w, v0w);
                const e2 = new THREE.Vector3().subVectors(v2w, v0w);
                const faceNormal = new THREE.Vector3().crossVectors(e1, e2).normalize();

                // face center (world)
                const center = new THREE.Vector3().addVectors(v0w, v1w).add(v2w).add(v3w).multiplyScalar(0.25);

                // backface cull: check if faceNormal faces the camera
                const viewVec = new THREE.Vector3().subVectors(camera.position, center).normalize();
                if (faceNormal.dot(viewVec) <= 0) continue; // face turned away

                // project each corner to camera/NDC and screen space
                const camV0 = v0w.clone().applyMatrix4(camInv);
                const camV1 = v1w.clone().applyMatrix4(camInv);
                const camV2 = v2w.clone().applyMatrix4(camInv);
                const camV3 = v3w.clone().applyMatrix4(camInv);

                // if any vertex is behind near-plane, skip this face (avoid per-face clipping)
                if (camV0.z > -near || camV1.z > -near || camV2.z > -near || camV3.z > -near) continue;

                // depth for sorting: average camera-space depth (positive)
                const depth = Math.max(0.000001,
                  (-camV0.z + -camV1.z + -camV2.z + -camV3.z) * 0.25
                );

                // project to NDC
                const pv0 = v0w.clone().project(camera);
                const pv1 = v1w.clone().project(camera);
                const pv2 = v2w.clone().project(camera);
                const pv3 = v3w.clone().project(camera);

                // skip invalid projections
                if (
                  !Number.isFinite(pv0.x) || !Number.isFinite(pv0.y) || !Number.isFinite(pv0.z) ||
                  !Number.isFinite(pv1.x) || !Number.isFinite(pv1.y) || !Number.isFinite(pv1.z) ||
                  !Number.isFinite(pv2.x) || !Number.isFinite(pv2.y) || !Number.isFinite(pv2.z) ||
                  !Number.isFinite(pv3.x) || !Number.isFinite(pv3.y) || !Number.isFinite(pv3.z)
                ) continue;

                // trivial off-screen test if all verts are outside on same side
                if (
                  (pv0.x < -1 && pv1.x < -1 && pv2.x < -1 && pv3.x < -1) ||
                  (pv0.x > 1 && pv1.x > 1 && pv2.x > 1 && pv3.x > 1) ||
                  (pv0.y < -1 && pv1.y < -1 && pv2.y < -1 && pv3.y < -1) ||
                  (pv0.y > 1 && pv1.y > 1 && pv2.y > 1 && pv3.y > 1) ||
                  (pv0.z < -1 && pv1.z < -1 && pv2.z < -1 && pv3.z < -1) ||
                  (pv0.z > 1 && pv1.z > 1 && pv2.z > 1 && pv3.z > 1)
                ) {
                  continue;
                }

                // convert to screen coords
                const sx0 = (pv0.x * 0.5 + 0.5) * canvas.width;
                const sy0 = (-pv0.y * 0.5 + 0.5) * canvas.height;
                const sx1 = (pv1.x * 0.5 + 0.5) * canvas.width;
                const sy1 = (-pv1.y * 0.5 + 0.5) * canvas.height;
                const sx2 = (pv2.x * 0.5 + 0.5) * canvas.width;
                const sy2 = (-pv2.y * 0.5 + 0.5) * canvas.height;
                const sx3 = (pv3.x * 0.5 + 0.5) * canvas.width;
                const sy3 = (-pv3.y * 0.5 + 0.5) * canvas.height;

                // shading: lambert with small ambient
                const lambert = Math.max(0, faceNormal.dot(lightDir));
                const intensity = 0.14 + 0.86 * lambert; // ambient + diffuse
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
              } // faces loop
            } // clippedTris loop
          } // triangle iteration
        } // mesh handling

        // sprites (unchanged)
        if (object.isSprite && object.visible) {
          object.updateMatrixWorld(true);
          const wp = new THREE.Vector3();
          object.getWorldPosition(wp);
          wp.project(camera);

          if (wp.x < -1 || wp.x > 1 || wp.y < -1 || wp.y > 1 || wp.z < -1 || wp.z > 1) return;

          const sx = (wp.x * 0.5 + 0.5) * canvas.width;
          const sy = (-wp.y * 0.5 + 0.5) * canvas.height;
          const scale = object.scale ? (object.scale.x || 1) : 1;
          let sizePx = 32 * scale;
          if (camera.isPerspectiveCamera) {
            const dist = object.getWorldPosition(new THREE.Vector3()).distanceTo(camera.getWorldPosition(new THREE.Vector3()));
            sizePx = Math.max(4, sizePx / Math.max(0.001, dist * 0.1));
          }
          sprites.push({
            x: sx, y: sy, size: sizePx, material: object.material, depth: wp.z
          });
        }
      }); // traverseVisible

      // depth sort faces (farthest -> nearest)
      facesToDraw.sort((a, b) => b.depth - a.depth);

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

      // sprites (far->near)
      sprites.sort((a, b) => b.depth - a.depth);
      for (let s = 0; s < sprites.length; s++) {
        const sp = sprites[s];
        const mat = sp.material;
        const half = sp.size * 0.5;
        if (mat && mat.map && mat.map.image) {
          try {
            const img = mat.map.image;
            ctx.drawImage(img, sp.x - half, sp.y - half, sp.size, sp.size);
          } catch (err) {
            ctx.fillStyle = (mat.color && mat.color.isColor)
              ? `rgba(${Math.round(mat.color.r * 255)},${Math.round(mat.color.g * 255)},${Math.round(mat.color.b * 255)},${mat.opacity !== undefined ? mat.opacity : 1})`
              : "#fff";
            ctx.fillRect(sp.x - half, sp.y - half, sp.size, sp.size);
          }
        } else {
          let colorCss = "#ffffff";
          if (mat && mat.color && mat.color.isColor) {
            colorCss = `rgba(${Math.round(mat.color.r * 255)},${Math.round(mat.color.g * 255)},${Math.round(mat.color.b * 255)},${mat.opacity !== undefined ? mat.opacity : 1})`;
          }
          ctx.beginPath();
          ctx.fillStyle = colorCss;
          ctx.arc(sp.x, sp.y, Math.max(1, half), 0, Math.PI * 2);
          ctx.fill();
        }
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

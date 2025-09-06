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

      const triangles = [];
      const sprites = [];
      const edgeLines = []; // store edges to draw as lines after faces
      const endpoints = []; // store projected endpoints for small circles

      // box setup helpers
      const boxCornersLocal = [
        new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(),
        new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()
      ];
      const faceQuads = [
        [0,1,3,2], // -Z face
        [4,5,7,6], // +Z face
        [0,1,5,4], // -Y face
        [2,3,7,6], // +Y face
        [0,2,6,4], // -X face
        [1,3,7,5], // +X face
      ];
      const edgesIdx = [
        [0,1],[1,3],[3,2],[2,0],
        [4,5],[5,7],[7,6],[6,4],
        [0,4],[1,5],[2,6],[3,7]
      ];

      scene.traverseVisible((object) => {
        if (object.isMesh && object.visible && object.geometry) {
          const geometry = object.geometry;
          // ensure bounding box exists
          if (!geometry.boundingBox) {
            geometry.computeBoundingBox();
          }
          if (!geometry.boundingBox) return;

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
          const strokeCss = `rgba(${Math.round(matColor.r)},${Math.round(matColor.g)},${Math.round(matColor.b)},${opacity})`;
          const fillCss = `rgba(${Math.round(matColor.r)},${Math.round(matColor.g)},${Math.round(matColor.b)},${Math.max(0.08, Math.min(0.6, opacity * 0.35))})`;

          // build the 8 corners in local space from boundingBox
          const min = geometry.boundingBox.min;
          const max = geometry.boundingBox.max;
          // ordering: 0:(minx,miny,minz),1:(maxx,miny,minz),2:(minx,maxy,minz),3:(maxx,maxy,minz),
          //           4:(minx,miny,maxz),5:(maxx,miny,maxz),6:(minx,maxy,maxz),7:(maxx,maxy,maxz)
          boxCornersLocal[0].set(min.x, min.y, min.z);
          boxCornersLocal[1].set(max.x, min.y, min.z);
          boxCornersLocal[2].set(min.x, max.y, min.z);
          boxCornersLocal[3].set(max.x, max.y, min.z);
          boxCornersLocal[4].set(min.x, min.y, max.z);
          boxCornersLocal[5].set(max.x, min.y, max.z);
          boxCornersLocal[6].set(min.x, max.y, max.z);
          boxCornersLocal[7].set(max.x, max.y, max.z);

          // transform corners to world space and also compute camera-space z test
          const worldCorners = [];
          const camCorners = [];
          let allBehindCamera = true;
          for (let i = 0; i < 8; i++) {
            const w = boxCornersLocal[i].clone().applyMatrix4(object.matrixWorld);
            worldCorners.push(w);
            const c = w.clone().applyMatrix4(camInv); // camera space
            camCorners.push(c);
            if (c.z <= 0) allBehindCamera = false; // there's at least one in front of camera (negative or zero)
          }

          // if all behind camera (z > 0), skip to avoid projection artifacts
          if (allBehindCamera) return;

          // Project corners to NDC/screen
          const ndcCorners = [];
          let offscreenAllXNeg = true, offscreenAllXPos = true, offscreenAllYNeg = true, offscreenAllYPos = true;
          for (let i = 0; i < 8; i++) {
            const pv = worldCorners[i].clone().project(camera);
            ndcCorners.push(pv);
            if (pv.x >= -1) offscreenAllXNeg = false;
            if (pv.x <= 1) offscreenAllXPos = false;
            if (pv.y >= -1) offscreenAllYNeg = false;
            if (pv.y <= 1) offscreenAllYPos = false;
          }

          // trivial off-screen test: if entire box outside any frustum side, skip
          if (offscreenAllXNeg || offscreenAllXPos || offscreenAllYNeg || offscreenAllYPos) {
            // do not return here — still draw if partly visible horizontally/vertically.
            // but if completely off all sides, skip:
            if (offscreenAllXNeg || offscreenAllXPos || offscreenAllYNeg || offscreenAllYPos) {
              // we already set flags above; if any of those is true for all verts, it's totally off-screen in that axis
              // however the tests above were combined wrongly; we'll perform a stricter check:
              let allLeft = true, allRight = true, allTop = true, allBottom = true;
              for (let i = 0; i < 8; i++) {
                const pv = ndcCorners[i];
                if (pv.x >= -1) allLeft = false;
                if (pv.x <= 1) allRight = false;
                if (pv.y >= -1) allTop = false;
                if (pv.y <= 1) allBottom = false;
              }
              if (allLeft || allRight || allTop || allBottom) {
                return;
              }
            }
          }

          // convert ndc to screen coordinates
          const screenCorners = ndcCorners.map(pv => {
            return {
              x: (pv.x * 0.5 + 0.5) * canvas.width,
              y: (-pv.y * 0.5 + 0.5) * canvas.height,
              z: pv.z // NDC z
            };
          });

          // Build faces (triangulated) and push to triangles for depth-sort & fill
          for (let fi = 0; fi < faceQuads.length; fi++) {
            const quad = faceQuads[fi];
            // face world & cam arrays for clipping if needed
            const worldFace = [ worldCorners[quad[0]], worldCorners[quad[1]], worldCorners[quad[2]], worldCorners[quad[3]] ];
            const camFace = [ camCorners[quad[0]], camCorners[quad[1]], camCorners[quad[2]], camCorners[quad[3]] ];
            // clip face polygon against near plane:
            const near = camera.near || 0.001;
            const clippedTris = clipPolygonAgainstNear(worldFace, camFace, near);

            if (!clippedTris || clippedTris.length === 0) continue;

            // for each clipped triangle, project to screen and push
            for (let ct = 0; ct < clippedTris.length; ct++) {
              const triW = clippedTris[ct];
              // compute camera-space for depth
              const cam0 = triW[0].clone().applyMatrix4(camInv);
              const cam1 = triW[1].clone().applyMatrix4(camInv);
              const cam2 = triW[2].clone().applyMatrix4(camInv);

              const depth0 = -cam0.z;
              const depth1 = -cam1.z;
              const depth2 = -cam2.z;
              const farthestDepth = Math.max(depth0, depth1, depth2);

              const pv0 = triW[0].clone().project(camera);
              const pv1 = triW[1].clone().project(camera);
              const pv2 = triW[2].clone().project(camera);

              // drop if any non-finite
              if (
                !Number.isFinite(pv0.x) || !Number.isFinite(pv0.y) || !Number.isFinite(pv0.z) ||
                !Number.isFinite(pv1.x) || !Number.isFinite(pv1.y) || !Number.isFinite(pv1.z) ||
                !Number.isFinite(pv2.x) || !Number.isFinite(pv2.y) || !Number.isFinite(pv2.z)
              ) continue;

              // trivial off-screen test (all verts same side)
              if (
                (pv0.x < -1 && pv1.x < -1 && pv2.x < -1) ||
                (pv0.x > 1 && pv1.x > 1 && pv2.x > 1) ||
                (pv0.y < -1 && pv1.y < -1 && pv2.y < -1) ||
                (pv0.y > 1 && pv1.y > 1 && pv2.y > 1) ||
                (pv0.z < -1 && pv1.z < -1 && pv2.z < -1) ||
                (pv0.z > 1 && pv1.z > 1 && pv2.z > 1)
              ) {
                continue;
              }

              const sxA = (pv0.x * 0.5 + 0.5) * canvas.width;
              const syA = (-pv0.y * 0.5 + 0.5) * canvas.height;
              const sxB = (pv1.x * 0.5 + 0.5) * canvas.width;
              const syB = (-pv1.y * 0.5 + 0.5) * canvas.height;
              const sxC = (pv2.x * 0.5 + 0.5) * canvas.width;
              const syC = (-pv2.y * 0.5 + 0.5) * canvas.height;

              // sanity check coords
              const MAX_SCREEN_COORD = 1e7;
              if (
                !Number.isFinite(sxA) || !Number.isFinite(syA) ||
                !Number.isFinite(sxB) || !Number.isFinite(syB) ||
                !Number.isFinite(sxC) || !Number.isFinite(syC) ||
                Math.abs(sxA) > MAX_SCREEN_COORD || Math.abs(syA) > MAX_SCREEN_COORD ||
                Math.abs(sxB) > MAX_SCREEN_COORD || Math.abs(syB) > MAX_SCREEN_COORD ||
                Math.abs(sxC) > MAX_SCREEN_COORD || Math.abs(syC) > MAX_SCREEN_COORD
              ) {
                continue;
              }

              // skip degenerate / tiny triangles
              const ax = sxB - sxA, ay = syB - syA;
              const bx = sxC - sxA, by = syC - syA;
              const cross = Math.abs(ax * by - ay * bx);
              const screenArea = cross * 0.5;
              if (screenArea < 0.25) continue;

              triangles.push({
                pts: [
                  { x: sxA, y: syA, z: pv0.z },
                  { x: sxB, y: syB, z: pv1.z },
                  { x: sxC, y: syC, z: pv2.z }
                ],
                colorFill: fillCss,
                colorStroke: strokeCss,
                depth: farthestDepth
              });
            } // clipped tris loop
          } // face loop

          // Build edges and endpoints (projected) for wireframe + dots
          for (let ei = 0; ei < edgesIdx.length; ei++) {
            const a = edgesIdx[ei][0];
            const b = edgesIdx[ei][1];
            const pA = screenCorners[a];
            const pB = screenCorners[b];
            // skip if projection invalid
            if (!pA || !pB) continue;
            if (!Number.isFinite(pA.x) || !Number.isFinite(pA.y) || !Number.isFinite(pB.x) || !Number.isFinite(pB.y)) continue;
            edgeLines.push({ x1: pA.x, y1: pA.y, x2: pB.x, y2: pB.y, stroke: strokeCss, depth: (pA.z + pB.z) * 0.5 });
          }
          for (let i = 0; i < screenCorners.length; i++) {
            const sc = screenCorners[i];
            endpoints.push({ x: sc.x, y: sc.y, depth: sc.z, fill: strokeCss });
          }

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

      // 4. Sort triangles by depth (farthest to nearest) and draw filled faces
      triangles.sort((a, b) => b.depth - a.depth);

      for (let t = 0; t < triangles.length; t++) {
        const tri = triangles[t];
        const p0 = tri.pts[0], p1 = tri.pts[1], p2 = tri.pts[2];
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.closePath();
        // fill
        ctx.fillStyle = tri.colorFill;
        ctx.fill();
        // optional subtle stroke for face border
        ctx.strokeStyle = tri.colorStroke;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Draw edges (sorted by depth so nearer edges draw over farther ones)
      edgeLines.sort((a, b) => b.depth - a.depth);
      ctx.lineWidth = 1;
      for (let e = 0; e < edgeLines.length; e++) {
        const el = edgeLines[e];
        ctx.beginPath();
        ctx.moveTo(el.x1, el.y1);
        ctx.lineTo(el.x2, el.y2);
        ctx.strokeStyle = el.stroke;
        ctx.stroke();
      }

      // Draw endpoints (small filled circles), near -> far so nearer draws on top
      endpoints.sort((a, b) => a.depth - b.depth); // smaller z (nearer) first
      for (let i = 0; i < endpoints.length; i++) {
        const ep = endpoints[i];
        ctx.beginPath();
        ctx.fillStyle = ep.fill;
        ctx.arc(ep.x, ep.y, 2.0, 0, Math.PI * 2);
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

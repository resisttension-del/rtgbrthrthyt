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
  const tmpV0 = new THREE.Vector3();
  const tmpV1 = new THREE.Vector3();
  const tmpV2 = new THREE.Vector3();

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

  // Predefined box-edge index pairs for a 8-corner AABB
  const BOX_EDGES = [
    [0,1],[0,2],[0,4],
    [1,3],[1,5],
    [2,3],[2,6],
    [3,7],
    [4,5],[4,6],
    [5,7],
    [6,7]
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

      // compute a fresh camera inverse matrix (don't rely on camera.matrixWorldInverse being set)
      const camInv = new THREE.Matrix4().copy(camera.matrixWorld).invert();

      // clear
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (clearColor.a > 0) {
        ctx.fillStyle = rgbaToCss(clearColor);
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      const boxes = [];
      const sprites = [];

      scene.traverseVisible((object) => {
        // --- Meshes -> compute screen-space AABB (axis aligned) ---
        if (object.isMesh && object.visible && object.geometry) {
          const geometry = object.geometry;

          // ensure bbox exists
          if (!geometry.boundingBox) {
            if (geometry.computeBoundingBox) geometry.computeBoundingBox();
            else return; //can't proceed without bbox
          }
          const bb = geometry.boundingBox;
          const min = bb.min;
          const max = bb.max;

          // corner order:
          // 0: min x, min y, min z
          // 1: max x, min y, min z
          // 2: min x, max y, min z
          // 3: max x, max y, min z
          // 4: min x, min y, max z
          // 5: max x, min y, max z
          // 6: min x, max y, max z
          // 7: max x, max y, max z
          const localCorners = [
            new THREE.Vector3(min.x, min.y, min.z),
            new THREE.Vector3(max.x, min.y, min.z),
            new THREE.Vector3(min.x, max.y, min.z),
            new THREE.Vector3(max.x, max.y, min.z),
            new THREE.Vector3(min.x, min.y, max.z),
            new THREE.Vector3(max.x, min.y, max.z),
            new THREE.Vector3(min.x, max.y, max.z),
            new THREE.Vector3(max.x, max.y, max.z),
          ];

          // world-space corners
          const worldCorners = localCorners.map(c => c.clone().applyMatrix4(object.matrixWorld));
          // camera-space corners
          const camSpace = worldCorners.map(wc => wc.clone().applyMatrix4(camInv));

          const near = camera.near || 0.001;
          const nearZ = -near;
          const ptsScreen = [];
          const depths = [];

          // include any corner that is in front of near plane
          for (let i = 0; i < worldCorners.length; i++) {
            const cCam = camSpace[i];
            if (cCam.z <= nearZ) {
              // project world corner
              const proj = worldCorners[i].clone().project(camera);
              // drop non-finite results
              if (!Number.isFinite(proj.x) || !Number.isFinite(proj.y) || !Number.isFinite(proj.z)) continue;
              const sx = (proj.x * 0.5 + 0.5) * canvas.width;
              const sy = (-proj.y * 0.5 + 0.5) * canvas.height;
              ptsScreen.push({ x: sx, y: sy });
              depths.push(-cCam.z);
            }
          }

          // handle edges crossing the near plane: add intersection points
          for (const edge of BOX_EDGES) {
            const i = edge[0], j = edge[1];
            const aCam = camSpace[i];
            const bCam = camSpace[j];
            const aW = worldCorners[i];
            const bW = worldCorners[j];

            const aIn = aCam.z <= nearZ;
            const bIn = bCam.z <= nearZ;
            if (aIn && bIn) continue; // edge fully inside -> corners already added
            if (aIn === bIn) continue; // both out or both in handled; when both out, skip; both in handled above

            // one in, one out -> compute intersection along camera-space z
            const denom = (bCam.z - aCam.z);
            if (Math.abs(denom) < 1e-9) continue;
            const t = (nearZ - aCam.z) / denom;
            if (t < 0 || t > 1) continue;

            // interpolate world-space intersection (for projection)
            const iW = new THREE.Vector3();
            lerpVec(iW, aW, bW, t);
            const proj = iW.clone().project(camera);
            if (!Number.isFinite(proj.x) || !Number.isFinite(proj.y) || !Number.isFinite(proj.z)) continue;
            const sx = (proj.x * 0.5 + 0.5) * canvas.width;
            const sy = (-proj.y * 0.5 + 0.5) * canvas.height;
            ptsScreen.push({ x: sx, y: sy });

            // depth: interpolate camera-space z to compute a reasonable depth
            const interpCamZ = aCam.z + (bCam.z - aCam.z) * t;
            depths.push(-interpCamZ);
          }

          // If nothing is inside/visible after clipping, optionally fallback to center marker
          if (ptsScreen.length === 0) {
            // fallback: project center of object bounding box
            const centerLocal = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5);
            const centerWorld = centerLocal.applyMatrix4(object.matrixWorld);
            const centerCam = centerWorld.clone().applyMatrix4(camInv);
            if (centerCam.z <= nearZ) {
              const p = centerWorld.clone().project(camera);
              if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
                const sx = (p.x * 0.5 + 0.5) * canvas.width;
                const sy = (-p.y * 0.5 + 0.5) * canvas.height;
                ptsScreen.push({ x: sx, y: sy });
                depths.push(-centerCam.z);
              }
            } else {
              // nothing visible; skip this object
            }
          }

          if (ptsScreen.length > 0) {
            // compute axis-aligned bbox in screen space
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const p of ptsScreen) {
              if (p.x < minX) minX = p.x;
              if (p.y < minY) minY = p.y;
              if (p.x > maxX) maxX = p.x;
              if (p.y > maxY) maxY = p.y;
            }

            // clamp to some sane range (optional)
            const clampVal = 1e8;
            if (!isFinite(minX) || Math.abs(minX) > clampVal) minX = 0;
            if (!isFinite(minY) || Math.abs(minY) > clampVal) minY = 0;
            if (!isFinite(maxX) || Math.abs(maxX) > clampVal) maxX = canvas.width;
            if (!isFinite(maxY) || Math.abs(maxY) > clampVal) maxY = canvas.height;

            // choose color from material or userData
            let matColor = { r: 255, g: 255, b: 255, a: 1 };
            let opacity = 1;
            if (object.material) {
              const m = object.material;
              if (m.color && m.color.isColor) {
                matColor = { r: m.color.r * 255, g: m.color.g * 255, b: m.color.b * 255, a: 1 };
              }
              opacity = m.opacity !== undefined ? m.opacity : 1;
            }
            const colorCss = `rgba(${Math.round(matColor.r)},${Math.round(matColor.g)},${Math.round(matColor.b)},${opacity})`;

            // depth for sorting: use farthest (max) depth from depths[]
            const depth = depths.length ? Math.max(...depths) : 0;

            // push box
            boxes.push({
              minX, minY, maxX, maxY, color: colorCss, depth, obj: object
            });
          }
        } // end mesh handling

        // --- sprites (unchanged) ---
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

      // Sort boxes (farthest first)
      boxes.sort((a, b) => b.depth - a.depth);

      // draw boxes
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        const w = Math.max(1, b.maxX - b.minX);
        const h = Math.max(1, b.maxY - b.minY);

        // visual falloff based on depth (optional tuning)
        const avgDepth = b.depth || 0;
        const fillAlpha = Math.max(0.08, Math.min(0.85, 1 - (avgDepth * 0.002)));
        const strokeAlpha = Math.max(0.5, Math.min(1, 1 - (avgDepth * 0.002)));
        const lineWidth = Math.max(1, 2 - (avgDepth * 0.001));

        ctx.save();
        ctx.globalAlpha = fillAlpha;
        ctx.fillStyle = b.color;
        ctx.fillRect(b.minX, b.minY, w, h);

        ctx.globalAlpha = strokeAlpha;
        ctx.strokeStyle = "rgba(0,0,0,0.85)";
        ctx.lineWidth = lineWidth;
        ctx.strokeRect(b.minX, b.minY, w, h);
        ctx.restore();
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

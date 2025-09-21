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

  // --- GPU renderer (offscreen) ---
  const glCanvas = document.createElement("canvas");
  glCanvas.width = width;
  glCanvas.height = height;
  const glRenderer = new THREE.WebGLRenderer({
    canvas: glCanvas,
    antialias: false,
    alpha: true,
    preserveDrawingBuffer: false,
  });
  glRenderer.setClearColor(0x000000, 0); // transparent clear for compositing
  glRenderer.setSize(width, height, false);

  const gpuScene = new THREE.Scene();

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

  function lerpVec(out, a, b, t) {
    out.x = a.x + (b.x - a.x) * t;
    out.y = a.y + (b.y - a.y) * t;
    out.z = a.z + (b.z - a.z) * t;
    return out;
  }

  function clipPolygonAgainstNear(inWorld, inCam, near) {
    if (inWorld.length !== inCam.length) return [];
    let outWorld = [];
    let outCam = [];
    function isInside(camV) {
      return camV.z <= -near;
    }
    const n = inWorld.length;
    for (let i = 0; i < n; i++) {
      const aW = inWorld[i], aC = inCam[i];
      const j = (i + 1) % n;
      const bW = inWorld[j], bC = inCam[j];
      const aIn = isInside(aC), bIn = isInside(bC);
      if (aIn && bIn) {
        outWorld.push(bW.clone()); outCam.push(bC.clone());
      } else if (aIn && !bIn) {
        const t = (-near - aC.z) / (bC.z - aC.z);
        const tt = Math.max(0, Math.min(1, t));
        const iW = new THREE.Vector3(), iC = new THREE.Vector3();
        lerpVec(iW, aW, bW, tt);
        lerpVec(iC, aC, bC, tt);
        outWorld.push(iW); outCam.push(iC);
      } else if (!aIn && bIn) {
        const t = (-near - aC.z) / (bC.z - aC.z);
        const tt = Math.max(0, Math.min(1, t));
        const iW = new THREE.Vector3(), iC = new THREE.Vector3();
        lerpVec(iW, aW, bW, tt);
        lerpVec(iC, aC, bC, tt);
        outWorld.push(iW); outCam.push(iC);
        outWorld.push(bW.clone()); outCam.push(bC.clone());
      } else {
        // both outside
      }
    }
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
      canvas.width = w; canvas.height = h;
      glCanvas.width = w; glCanvas.height = h;
      glRenderer.setSize(w, h, false);
      if (updateStyle) {
        canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
      }
    },
    setClearColor(hex = 0x000000, alpha = 1) {
      clearColor = hexToRgba(hex, alpha);
    },

    render(scene, camera) {
      if (!scene || !camera) return;

      scene.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);
      const camInv = new THREE.Matrix4().copy(camera.matrixWorld).invert();

      // clear CPU canvas background
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (clearColor.a > 0) {
        ctx.fillStyle = rgbaToCss(clearColor);
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      // collect triangle data (CPU: geometry extraction & near-clipping)
      const triangles = [];
      const sprites = [];

      scene.traverseVisible((object) => {
        if (object.isMesh && object.visible && object.geometry) {
          const geometry = object.geometry;
          const posAttr = geometry.attributes && geometry.attributes.position;
          if (!posAttr) return;

          object.updateMatrixWorld(true);

          // material color fallback + opacity
          let matColor = { r: 255, g: 255, b: 255, a: 1 };
          let opacity = 1;
          if (object.material) {
            const m = object.material;
            if (m.color && m.color.isColor) {
              matColor = { r: m.color.r * 255, g: m.color.g * 255, b: m.color.b * 255, a: 1 };
            }
            opacity = m.opacity !== undefined ? m.opacity : 1;
          }

          const colorObj = { r: matColor.r, g: matColor.g, b: matColor.b, a: opacity };

          const index = geometry.index ? geometry.index.array : null;
          const posArray = posAttr.array;
          const itemSize = posAttr.itemSize || 3;
          const count = index ? index.length : posArray.length / itemSize;

          for (let i = 0; i < count; i += 3) {
            const ai = index ? index[i] : i;
            const bi = index ? index[i+1] : i+1;
            const ci = index ? index[i+2] : i+2;

            const wA = new THREE.Vector3().fromArray(posArray, ai * itemSize).applyMatrix4(object.matrixWorld);
            const wB = new THREE.Vector3().fromArray(posArray, bi * itemSize).applyMatrix4(object.matrixWorld);
            const wC = new THREE.Vector3().fromArray(posArray, ci * itemSize).applyMatrix4(object.matrixWorld);

            const cA = wA.clone().applyMatrix4(camInv);
            const cB = wB.clone().applyMatrix4(camInv);
            const cC = wC.clone().applyMatrix4(camInv);

            const near = camera.near || 0.001;
            const clippedTris = clipPolygonAgainstNear([wA, wB, wC], [cA, cB, cC], near);
            if (!clippedTris || clippedTris.length === 0) continue;

            for (let ct = 0; ct < clippedTris.length; ct++) {
              const triW = clippedTris[ct];

              const camV0 = triW[0].clone().applyMatrix4(camInv);
              const camV1 = triW[1].clone().applyMatrix4(camInv);
              const camV2 = triW[2].clone().applyMatrix4(camInv);
              const depth0 = -camV0.z, depth1 = -camV1.z, depth2 = -camV2.z;
              const farthestDepth = Math.max(depth0, depth1, depth2);

              const pv0 = triW[0].clone().project(camera);
              const pv1 = triW[1].clone().project(camera);
              const pv2 = triW[2].clone().project(camera);

              if (
                !Number.isFinite(pv0.x) || !Number.isFinite(pv0.y) || !Number.isFinite(pv0.z) ||
                !Number.isFinite(pv1.x) || !Number.isFinite(pv1.y) || !Number.isFinite(pv1.z) ||
                !Number.isFinite(pv2.x) || !Number.isFinite(pv2.y) || !Number.isFinite(pv2.z)
              ) continue;

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

              const ax = sxB - sxA, ay = syB - syA;
              const bx = sxC - sxA, by = syC - syA;
              const cross = Math.abs(ax * by - ay * bx);
              const screenArea = cross * 0.5;
              if (screenArea < 0.25) continue;

              // store world-space triangle + material color and opacity for GPU mesh creation
              triangles.push({
                world: [ triW[0].clone(), triW[1].clone(), triW[2].clone() ],
                color: colorObj,
                depth: farthestDepth
              });
            }
          }
        }

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
      });

      // ---------- GPU composition for triangles ----------
      // bucket triangles by opacity (simple approach to preserve per-material alpha)
      gpuScene.clear(); // remove previous meshes
      const buckets = new Map(); // key = opacity string
      for (let i = 0; i < triangles.length; i++) {
        const tri = triangles[i];
        const a = tri.color.a !== undefined ? tri.color.a : 1;
        const key = String(a);
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(tri);
      }

      // For each bucket, create one BufferGeometry mesh with vertex colors (RGB) and material.opacity = bucketAlpha
      for (const [key, tris] of buckets.entries()) {
        const alpha = parseFloat(key);
        const posArray = new Float32Array(tris.length * 9); // 3 verts * 3 components
        const colArray = new Float32Array(tris.length * 9); // r,g,b for each vertex
        let writeIdx = 0;
        for (let i = 0; i < tris.length; i++) {
          const t = tris[i];
          for (let v = 0; v < 3; v++) {
            const wv = t.world[v];
            posArray[writeIdx * 3 + 0] = wv.x;
            posArray[writeIdx * 3 + 1] = wv.y;
            posArray[writeIdx * 3 + 2] = wv.z;
            colArray[writeIdx * 3 + 0] = (t.color.r / 255);
            colArray[writeIdx * 3 + 1] = (t.color.g / 255);
            colArray[writeIdx * 3 + 2] = (t.color.b / 255);
            writeIdx++;
          }
        }
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
        geom.setAttribute('color', new THREE.BufferAttribute(colArray, 3));
        geom.setDrawRange(0, tris.length * 3);
        // Important: use double-sided unless you guarantee triangle winding
        const mat = new THREE.MeshBasicMaterial({
          vertexColors: true,
          side: THREE.DoubleSide,
          transparent: alpha < 1 ? true : false,
          opacity: alpha
        });
        const mesh = new THREE.Mesh(geom, mat);
        gpuScene.add(mesh);
      }

      // Render GPU scene (triangles) into the offscreen GL canvas using original camera
      glRenderer.setSize(canvas.width, canvas.height, false);
      glRenderer.render(gpuScene, camera);

      // Copy GPU canvas into CPU canvas
      // This ensures GPU-rendered triangles (with proper depth test) are composited into your 2D canvas
      ctx.drawImage(glCanvas, 0, 0, canvas.width, canvas.height);

      // ---------- fallback CPU sprites drawing (still preserved) ----------
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
      // clean up renderer and GPU scene
      glRenderer.dispose();
      gpuScene.clear();
    },
  };

  api.setSize(width, height, false);
  api.setClearColor(0x000000, 1);
  return api;
}

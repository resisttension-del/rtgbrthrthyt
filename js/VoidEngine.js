import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";

export function voidEngine({ width = 640, height = 360, mode = "painter", resolutionScale = 0.5 } = {}) {
  // --- Visible 2D canvas (user-facing) ---
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.style.display = "block";
  canvas.style.imageRendering = "pixelated";
  const ctx = canvas.getContext("2d", { alpha: true });

  // --- Offscreen GL canvas for fast blit ---
  const glCanvas = document.createElement("canvas");
  glCanvas.width = width;
  glCanvas.height = height;
  const glRenderer = new THREE.WebGLRenderer({
    canvas: glCanvas,
    antialias: false,
    alpha: true,
    preserveDrawingBuffer: false,
  });
  glRenderer.setClearColor(0x000000, 0); // transparent clear
  glRenderer.setSize(width, height, false);

  // Fullscreen quad & ortho camera to draw CPU texture
  const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
  const quadScene = new THREE.Scene();
  let quadMesh = null;
  let cpuTexture = null;

  // --- Internal scaled buffers (reused) ---
  let scale = Math.max(0.1, Math.min(1, resolutionScale)); // clamp sensible
  let scaledWidth = Math.max(1, Math.floor(canvas.width * scale));
  let scaledHeight = Math.max(1, Math.floor(canvas.height * scale));
  let pixelBuf = new Uint8ClampedArray(scaledWidth * scaledHeight * 4);
  let zBuf = new Float32Array(scaledWidth * scaledHeight);

  let clearColor = { r: 0, g: 0, b: 0, a: 1 };

  // scratch vectors
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

  function lerpVec(out, a, b, t) {
    out.x = a.x + (b.x - a.x) * t;
    out.y = a.y + (b.y - a.y) * t;
    out.z = a.z + (b.z - a.z) * t;
    return out;
  }

  function clipPolygonAgainstNear(inWorld, inCam, near) {
    if (inWorld.length !== inCam.length) return [];
    let outWorld = [], outCam = [];
    function isInside(camV) { return camV.z <= -near; }
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
        lerpVec(iW, aW, bW, tt); lerpVec(iC, aC, bC, tt);
        outWorld.push(iW); outCam.push(iC);
      } else if (!aIn && bIn) {
        const t = (-near - aC.z) / (bC.z - aC.z);
        const tt = Math.max(0, Math.min(1, t));
        const iW = new THREE.Vector3(), iC = new THREE.Vector3();
        lerpVec(iW, aW, bW, tt); lerpVec(iC, aC, bC, tt);
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

  // Efficient CPU rasterizer into pixelBuf (scaledW x scaledH).
  // Triangles expected in screen-space scaled coordinates with depth per-vertex.
  function rasterizeToBuffer(tris, sw, sh, pixels, zbuf, clearCol) {
    const pxCount = sw * sh;
    const cR = Math.round(clearCol.r), cG = Math.round(clearCol.g), cB = Math.round(clearCol.b);
    const cA255 = Math.round(Math.max(0, Math.min(1, clearCol.a)) * 255);
    // reset buffers
    for (let i = 0; i < pxCount; i++) {
      const idx = i * 4;
      pixels[idx] = cR;
      pixels[idx + 1] = cG;
      pixels[idx + 2] = cB;
      pixels[idx + 3] = cA255;
      zbuf[i] = Infinity;
    }

    // edge (signed area)
    function edge(ax, ay, bx, by, cx, cy) {
      return (cx - ax) * (by - ay) - (cy - ay) * (bx - ax);
    }

    for (let t = 0; t < tris.length; t++) {
      const tri = tris[t];
      const x0 = tri.sx[0], y0 = tri.sy[0];
      const x1 = tri.sx[1], y1 = tri.sy[1];
      const x2 = tri.sx[2], y2 = tri.sy[2];
      const d0 = tri.depth[0], d1 = tri.depth[1], d2 = tri.depth[2];
      const cr = Math.round(tri.color.r), cg = Math.round(tri.color.g), cb = Math.round(tri.color.b);
      const a = Math.max(0, Math.min(1, tri.color.a !== undefined ? tri.color.a : 1));
      const area = edge(x0, y0, x1, y1, x2, y2);
      if (Math.abs(area) < 1e-3) continue;
      const invArea = 1.0 / area;

      // bounding box (integer)
      let minX = Math.floor(Math.min(x0, x1, x2));
      let maxX = Math.ceil(Math.max(x0, x1, x2));
      let minY = Math.floor(Math.min(y0, y1, y2));
      let maxY = Math.ceil(Math.max(y0, y1, y2));
      if (minX < 0) minX = 0;
      if (minY < 0) minY = 0;
      if (maxX >= sw) maxX = sw - 1;
      if (maxY >= sh) maxY = sh - 1;
      if (maxX < 0 || maxY < 0 || minX >= sw || minY >= sh) continue;

      for (let py = minY; py <= maxY; py++) {
        for (let px = minX; px <= maxX; px++) {
          const sx = px + 0.5, sy = py + 0.5;
          const w0 = edge(sx, sy, x1, y1, x2, y2) * invArea;
          const w1 = edge(sx, sy, x2, y2, x0, y0) * invArea;
          const w2 = edge(sx, sy, x0, y0, x1, y1) * invArea;
          if (w0 >= -1e-6 && w1 >= -1e-6 && w2 >= -1e-6) {
            const depth = w0 * d0 + w1 * d1 + w2 * d2;
            const pixIndex = py * sw + px;
            if (depth < zbuf[pixIndex]) {
              const pixIdx = pixIndex * 4;
              if (a >= 0.999) {
                pixels[pixIdx] = cr; pixels[pixIdx + 1] = cg; pixels[pixIdx + 2] = cb; pixels[pixIdx + 3] = 255;
                zbuf[pixIndex] = depth;
              } else {
                // src-over composite (fast)
                const dstR = pixels[pixIdx] / 255, dstG = pixels[pixIdx + 1] / 255, dstB = pixels[pixIdx + 2] / 255;
                const srcR = cr / 255, srcG = cg / 255, srcB = cb / 255;
                const outR = srcR * a + dstR * (1 - a);
                const outG = srcG * a + dstG * (1 - a);
                const outB = srcB * a + dstB * (1 - a);
                pixels[pixIdx] = Math.round(Math.max(0, Math.min(255, outR * 255)));
                pixels[pixIdx + 1] = Math.round(Math.max(0, Math.min(255, outG * 255)));
                pixels[pixIdx + 2] = Math.round(Math.max(0, Math.min(255, outB * 255)));
                pixels[pixIdx + 3] = 255;
                zbuf[pixIndex] = depth;
              }
            }
          }
        }
      }
    }
  }

  // create or update DataTexture + quad for blit
  function ensureCpuTexture(sw, sh) {
    if (!cpuTexture) {
      cpuTexture = new THREE.DataTexture(pixelBuf, sw, sh, THREE.RGBAFormat);
      cpuTexture.minFilter = THREE.NearestFilter;
      cpuTexture.magFilter = THREE.NearestFilter;
      cpuTexture.flipY = true; // buffer is top-left; flipping makes it display correctly on the GL quad
      cpuTexture.needsUpdate = true;
      const geom = new THREE.PlaneGeometry(2, 2);
      const mat = new THREE.MeshBasicMaterial({ map: cpuTexture, transparent: true });
      quadMesh = new THREE.Mesh(geom, mat);
      quadScene.add(quadMesh);
    } else {
      // if size changed, recreate texture cleanly
      if (cpuTexture.image.width !== sw || cpuTexture.image.height !== sh) {
        cpuTexture.dispose();
        cpuTexture = new THREE.DataTexture(pixelBuf, sw, sh, THREE.RGBAFormat);
        cpuTexture.minFilter = THREE.NearestFilter;
        cpuTexture.magFilter = THREE.NearestFilter;
        cpuTexture.flipY = true;
        cpuTexture.needsUpdate = true;
        if (quadMesh) quadMesh.material.map = cpuTexture;
      }
    }
  }

  // public API
  const api = {
    domElement: canvas,

    setSize(w, h, updateStyle = true) {
      canvas.width = w; canvas.height = h;
      glCanvas.width = w; glCanvas.height = h;
      glRenderer.setSize(w, h, false);
      // recompute scaled buffers
      scaledWidth = Math.max(1, Math.floor(w * scale));
      scaledHeight = Math.max(1, Math.floor(h * scale));
      pixelBuf = new Uint8ClampedArray(scaledWidth * scaledHeight * 4);
      zBuf = new Float32Array(scaledWidth * scaledHeight);
      if (cpuTexture) { cpuTexture.dispose(); cpuTexture = null; quadScene.clear(); quadMesh = null; }
      if (updateStyle) {
        canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
      }
    },

    // lower the internal resolution scale (0.1..1.0)
    setResolutionScale(s) {
      scale = Math.max(0.1, Math.min(1, s));
      scaledWidth = Math.max(1, Math.floor(canvas.width * scale));
      scaledHeight = Math.max(1, Math.floor(canvas.height * scale));
      pixelBuf = new Uint8ClampedArray(scaledWidth * scaledHeight * 4);
      zBuf = new Float32Array(scaledWidth * scaledHeight);
      if (cpuTexture) { cpuTexture.dispose(); cpuTexture = null; quadScene.clear(); quadMesh = null; }
    },

    setClearColor(hex = 0x000000, alpha = 1) {
      clearColor = hexToRgba(hex, alpha);
    },

    render(scene, camera) {
      if (!scene || !camera) return;

      // update transforms
      scene.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);

      // camera inverse for clipping
      const camInv = new THREE.Matrix4().copy(camera.matrixWorld).invert();

      // collect triangles & sprites
      const triangles = [];
      const sprites = [];

      scene.traverseVisible((object) => {
        if (object.isMesh && object.visible && object.geometry) {
          const geometry = object.geometry;
          const posAttr = geometry.attributes && geometry.attributes.position;
          if (!posAttr) return;
          object.updateMatrixWorld(true);

          // material color + opacity
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
            const bi = index ? index[i + 1] : i + 1;
            const ci = index ? index[i + 2] : i + 2;

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

              // compute camera-space depths and project to NDC
              const camV0_ = triW[0].clone().applyMatrix4(camInv);
              const camV1_ = triW[1].clone().applyMatrix4(camInv);
              const camV2_ = triW[2].clone().applyMatrix4(camInv);
              const depth0 = -camV0_.z, depth1 = -camV1_.z, depth2 = -camV2_.z;

              const pv0 = triW[0].clone().project(camera);
              const pv1 = triW[1].clone().project(camera);
              const pv2 = triW[2].clone().project(camera);

              if (
                !Number.isFinite(pv0.x) || !Number.isFinite(pv0.y) ||
                !Number.isFinite(pv1.x) || !Number.isFinite(pv1.y) ||
                !Number.isFinite(pv2.x) || !Number.isFinite(pv2.y)
              ) continue;

              // trivial off-screen test
              if (
                (pv0.x < -1 && pv1.x < -1 && pv2.x < -1) ||
                (pv0.x > 1 && pv1.x > 1 && pv2.x > 1) ||
                (pv0.y < -1 && pv1.y < -1 && pv2.y < -1) ||
                (pv0.y > 1 && pv1.y > 1 && pv2.y > 1)
              ) {
                continue;
              }

              // compute scaled screen coords
              const sx0 = (pv0.x * 0.5 + 0.5) * canvas.width * scale;
              const sy0 = (-pv0.y * 0.5 + 0.5) * canvas.height * scale;
              const sx1 = (pv1.x * 0.5 + 0.5) * canvas.width * scale;
              const sy1 = (-pv1.y * 0.5 + 0.5) * canvas.height * scale;
              const sx2 = (pv2.x * 0.5 + 0.5) * canvas.width * scale;
              const sy2 = (-pv2.y * 0.5 + 0.5) * canvas.height * scale;

              // small-screen-area cull (tunable)
              const ax = sx1 - sx0, ay = sy1 - sy0;
              const bx = sx2 - sx0, by = sy2 - sy0;
              const cross = Math.abs(ax * by - ay * bx);
              const screenArea = cross * 0.5;
              if (screenArea < 0.25) continue;

              triangles.push({
                sx: [sx0, sx1, sx2],
                sy: [sy0, sy1, sy2],
                depth: [depth0, depth1, depth2],
                color: colorObj,
                world: [triW[0].clone(), triW[1].clone(), triW[2].clone()]
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
          const scaleSprite = object.scale ? (object.scale.x || 1) : 1;
          let sizePx = 32 * scaleSprite;
          if (camera.isPerspectiveCamera) {
            const dist = object.getWorldPosition(new THREE.Vector3()).distanceTo(camera.getWorldPosition(new THREE.Vector3()));
            sizePx = Math.max(4, sizePx / Math.max(0.001, dist * 0.1));
          }
          sprites.push({
            x: sx, y: sy, size: sizePx, material: object.material, depth: wp.z
          });
        }
      }); // traverseVisible

      // rasterize (CPU) into scaled buffers
      ensureCpuTexture(scaledWidth, scaledHeight);
      rasterizeToBuffer(triangles, scaledWidth, scaledHeight, pixelBuf, zBuf, clearColor);

      // upload data texture and blit via GL
      cpuTexture.image.data = pixelBuf;
      cpuTexture.image.width = scaledWidth;
      cpuTexture.image.height = scaledHeight;
      cpuTexture.needsUpdate = true;

      glRenderer.setSize(scaledWidth, scaledHeight, false);
      glRenderer.render(quadScene, orthoCam);

      // draw GL canvas into 2D canvas (stretched to visible size)
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(glCanvas, 0, 0, canvas.width, canvas.height);

      // draw sprites on top (in screen-space, unscaled to keep visual placement)
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
      if (cpuTexture) cpuTexture.dispose();
      if (quadMesh) {
        quadMesh.geometry.dispose();
        quadMesh.material.dispose();
      }
      glRenderer.dispose();
      quadScene.clear();
    }
  };

  // init size/scale
  api.setSize(width, height, false);
  api.setClearColor(0x000000, 1);

  return api;
}

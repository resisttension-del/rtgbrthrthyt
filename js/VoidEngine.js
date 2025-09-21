import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";

export function voidEngine({ width = 640, height = 360, mode = "painter", cpuMode = "rasterize" } = {}) {
  // --- Canvas setup (user-visible 2D canvas) ---
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.style.display = "block";
  canvas.style.imageRendering = "pixelated";
  const ctx = canvas.getContext("2d", { alpha: true });

  // --- Offscreen GL for final compositing (GPU just blits the CPU image) ---
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

  // Fullscreen quad that will receive the CPU-produced texture
  const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
  const quadScene = new THREE.Scene();
  let quadMesh = null;
  let cpuTexture = null;

  // pixel buffers (reused)
  let pixelBuf = new Uint8ClampedArray(width * height * 4);
  let zBuf = new Float32Array(width * height);

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

  // CPU rasterizer: triangles array expects vertices in screen space and camera depths per vertex:
  // each tri: { sx: [x0,x1,x2], sy: [y0,y1,y2], depth: [d0,d1,d2], color: {r,g,b,a} }
  function rasterizeToBuffer(tris, w, h, pixels, zbuf, clearCol) {
    const pxCount = w * h;
    // reset buffers
    const clearR = Math.round(clearCol.r), clearG = Math.round(clearCol.g), clearB = Math.round(clearCol.b);
    const clearA255 = Math.round(Math.max(0, Math.min(1, clearCol.a)) * 255);
    for (let i = 0; i < pxCount; i++) {
      const idx = i * 4;
      pixels[idx] = clearR;
      pixels[idx + 1] = clearG;
      pixels[idx + 2] = clearB;
      pixels[idx + 3] = clearA255;
      zbuf[i] = Infinity;
    }

    // Helper: edge function
    function edge(x0, y0, x1, y1, x2, y2) {
      return (x2 - x0) * (y1 - y0) - (y2 - y0) * (x1 - x0);
    }

    for (let t = 0; t < tris.length; t++) {
      const tri = tris[t];
      const x0 = tri.sx[0], y0 = tri.sy[0], x1 = tri.sx[1], y1 = tri.sy[1], x2 = tri.sx[2], y2 = tri.sy[2];
      const d0 = tri.depth[0], d1 = tri.depth[1], d2 = tri.depth[2];
      const cr = Math.round(tri.color.r), cg = Math.round(tri.color.g), cb = Math.round(tri.color.b);
      const a = Math.max(0, Math.min(1, tri.color.a !== undefined ? tri.color.a : 1));
      const a255 = Math.round(a * 255);

      // bbox
      let minX = Math.floor(Math.min(x0, x1, x2));
      let maxX = Math.ceil(Math.max(x0, x1, x2));
      let minY = Math.floor(Math.min(y0, y1, y2));
      let maxY = Math.ceil(Math.max(y0, y1, y2));
      if (minX < 0) minX = 0;
      if (minY < 0) minY = 0;
      if (maxX >= w) maxX = w - 1;
      if (maxY >= h) maxY = h - 1;
      if (maxX < 0 || maxY < 0 || minX >= w || minY >= h) continue;

      const area = edge(x0, y0, x1, y1, x2, y2);
      if (Math.abs(area) < 1e-3) continue;
      const invArea = 1.0 / area;

      // iterate pixels in bbox
      for (let py = minY; py <= maxY; py++) {
        for (let px = minX; px <= maxX; px++) {
          // sample at pixel center
          const sx = px + 0.5, sy = py + 0.5;
          const w0 = edge(sx, sy, x1, y1, x2, y2) * invArea;
          const w1 = edge(sx, sy, x2, y2, x0, y0) * invArea;
          const w2 = edge(sx, sy, x0, y0, x1, y1) * invArea;
          // inside test (allow small negative epsilon)
          if (w0 >= -1e-6 && w1 >= -1e-6 && w2 >= -1e-6) {
            // interpolate depth (depth is positive distance = -camZ)
            const depth = w0 * d0 + w1 * d1 + w2 * d2;
            const idx = py * w + px;
            if (depth < zbuf[idx]) {
              // simple alpha composite: src over dst
              const pixIdx = idx * 4;
              if (a >= 0.999) {
                // opaque: replace
                pixels[pixIdx] = cr;
                pixels[pixIdx + 1] = cg;
                pixels[pixIdx + 2] = cb;
                pixels[pixIdx + 3] = 255;
                zbuf[idx] = depth;
              } else {
                // translucent: composite over current pixel
                const dstR = pixels[pixIdx] / 255;
                const dstG = pixels[pixIdx + 1] / 255;
                const dstB = pixels[pixIdx + 2] / 255;
                const srcR = cr / 255;
                const srcG = cg / 255;
                const srcB = cb / 255;
                const outR = srcR * a + dstR * (1 - a);
                const outG = srcG * a + dstG * (1 - a);
                const outB = srcB * a + dstB * (1 - a);
                pixels[pixIdx] = Math.round(Math.max(0, Math.min(255, outR * 255)));
                pixels[pixIdx + 1] = Math.round(Math.max(0, Math.min(255, outG * 255)));
                pixels[pixIdx + 2] = Math.round(Math.max(0, Math.min(255, outB * 255)));
                // keep alpha 255 for composited buffer
                pixels[pixIdx + 3] = 255;
                // update depth to prevent further geometry behind from writing
                zbuf[idx] = depth;
              }
            }
          }
        }
      }
    }
  }

  // create / update the quad that displays our cpuTexture
  function ensureQuad(w, h) {
    if (!cpuTexture) {
      cpuTexture = new THREE.DataTexture(pixelBuf, w, h, THREE.RGBAFormat);
      cpuTexture.minFilter = THREE.NearestFilter;
      cpuTexture.magFilter = THREE.NearestFilter;
      cpuTexture.flipY = true; // because buffer is top-left origin while GL is bottom-left depending on usage
      cpuTexture.needsUpdate = true;

      const geom = new THREE.PlaneGeometry(2, 2);
      const mat = new THREE.MeshBasicMaterial({ map: cpuTexture, transparent: true });
      quadMesh = new THREE.Mesh(geom, mat);
      quadScene.add(quadMesh);
    } else {
      // if size changed, recreate texture and buffer arrays
      if (cpuTexture.image.width !== w || cpuTexture.image.height !== h) {
        cpuTexture.dispose();
        cpuTexture = new THREE.DataTexture(pixelBuf, w, h, THREE.RGBAFormat);
        cpuTexture.minFilter = THREE.NearestFilter;
        cpuTexture.magFilter = THREE.NearestFilter;
        cpuTexture.flipY = true;
        cpuTexture.needsUpdate = true;
        quadMesh.material.map = cpuTexture;
      }
    }
  }

  const api = {
    domElement: canvas,
    setSize(w, h, updateStyle = true) {
      canvas.width = w; canvas.height = h;
      glCanvas.width = w; glCanvas.height = h;
      glRenderer.setSize(w, h, false);
      // rebuild pixel buffers if required
      if (pixelBuf.length !== w * h * 4) {
        pixelBuf = new Uint8ClampedArray(w * h * 4);
        zBuf = new Float32Array(w * h);
        if (cpuTexture) {
          cpuTexture.dispose();
          cpuTexture = null;
          quadScene.clear();
          quadMesh = null;
        }
      }
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

      // prepare camera inverse (for clipping / depth)
      const camInv = new THREE.Matrix4().copy(camera.matrixWorld).invert();

      // clear 2D canvas background
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (clearColor.a > 0) {
        ctx.fillStyle = rgbaToCss(clearColor);
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      // collect triangles (projected) and sprites
      const triangles = [];
      const sprites = [];

      scene.traverseVisible((object) => {
        if (object.isMesh && object.visible && object.geometry) {
          const geometry = object.geometry;
          const posAttr = geometry.attributes && geometry.attributes.position;
          if (!posAttr) return;
          object.updateMatrixWorld(true);

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

              // compute camera-space vertices and project them
              const camV0_ = triW[0].clone().applyMatrix4(camInv);
              const camV1_ = triW[1].clone().applyMatrix4(camInv);
              const camV2_ = triW[2].clone().applyMatrix4(camInv);

              const depth0 = -camV0_.z; // positive distance
              const depth1 = -camV1_.z;
              const depth2 = -camV2_.z;

              // Project to NDC for offscreen CPU rasterization -> then to screen px coords
              const pv0 = triW[0].clone().project(camera);
              const pv1 = triW[1].clone().project(camera);
              const pv2 = triW[2].clone().project(camera);

              if (
                !Number.isFinite(pv0.x) || !Number.isFinite(pv0.y) ||
                !Number.isFinite(pv1.x) || !Number.isFinite(pv1.y) ||
                !Number.isFinite(pv2.x) || !Number.isFinite(pv2.y)
              ) continue;

              // fast trivial off-screen check (not perfect but useful)
              if (
                (pv0.x < -1 && pv1.x < -1 && pv2.x < -1) ||
                (pv0.x > 1 && pv1.x > 1 && pv2.x > 1) ||
                (pv0.y < -1 && pv1.y < -1 && pv2.y < -1) ||
                (pv0.y > 1 && pv1.y > 1 && pv2.y > 1)
              ) {
                continue;
              }

              // screen coords
              const sx0 = (pv0.x * 0.5 + 0.5) * canvas.width;
              const sy0 = (-pv0.y * 0.5 + 0.5) * canvas.height;
              const sx1 = (pv1.x * 0.5 + 0.5) * canvas.width;
              const sy1 = (-pv1.y * 0.5 + 0.5) * canvas.height;
              const sx2 = (pv2.x * 0.5 + 0.5) * canvas.width;
              const sy2 = (-pv2.y * 0.5 + 0.5) * canvas.height;

              // small screen-area cull
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
                // optional: store world tri if needed later
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

      // CPU-heavy path: rasterize into pixelBuf + zBuf
      if (cpuMode === "rasterize") {
        rasterizeToBuffer(triangles, canvas.width, canvas.height, pixelBuf, zBuf, clearColor);
        // upload pixelBuf to DataTexture and render fullscreen quad with GPU
        ensureQuad(canvas.width, canvas.height);
        cpuTexture.image.data = pixelBuf;
        cpuTexture.image.width = canvas.width;
        cpuTexture.image.height = canvas.height;
        cpuTexture.needsUpdate = true;

        glRenderer.setSize(canvas.width, canvas.height, false);
        glRenderer.render(quadScene, orthoCam);

        // blit the glCanvas onto the 2D canvas (keeps original UI layering semantics)
        ctx.drawImage(glCanvas, 0, 0, canvas.width, canvas.height);
      } else {
        // existing GPU-assisted (previous) approach could be placed here
        // For now just fallback to CPU: draw triangles as filled paths (slower)
        triangles.sort((a, b) => b.depth - a.depth);
        for (let t = 0; t < triangles.length; t++) {
          const tri = triangles[t];
          ctx.beginPath();
          ctx.moveTo(tri.sx[0], tri.sy[0]);
          ctx.lineTo(tri.sx[1], tri.sy[1]);
          ctx.lineTo(tri.sx[2], tri.sy[2]);
          ctx.closePath();
          ctx.fillStyle = `rgba(${Math.round(tri.color.r)},${Math.round(tri.color.g)},${Math.round(tri.color.b)},${tri.color.a})`;
          ctx.fill();
        }
      }

      // draw sprites on top (cpu)
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
    },
  };

  api.setSize(width, height, false);
  api.setClearColor(0x000000, 1);
  return api;
}

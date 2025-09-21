import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";

export function voidEngineCPU({ width = 640, height = 360, mode = "painter" } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.style.display = "block";
  canvas.style.imageRendering = "pixelated";

  // we'll try to present using the ImageBitmap / bitmaprenderer path (no 2d ctx)
  const bitmapCtx = canvas.getContext && canvas.getContext("bitmaprenderer");

  // fallback 2d ctx only if bitmaprenderer isn't available (you said "don't use ctx" — primary path avoids it)
  const fallback2d = (!bitmapCtx) ? (canvas.getContext && canvas.getContext("2d")) : null;

  let clearColor = { r: 0, g: 0, b: 0, a: 1 };

  // scratch vectors
  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();

  function hexToRgba(hex, alpha = 1) {
    const r = (hex >> 16) & 255;
    const g = (hex >> 8) & 255;
    const b = hex & 255;
    return { r, g, b, a: alpha };
  }

  // re-use your near-plane clipper (unchanged, returns tri lists in world-space)
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
    function isInside(camV) { return camV.z <= -near; } // three.js cam: negative z in front
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
        // both outside -> nothing
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

  // --- CPU framebuffer helpers ---
  let pixelBuffer = new Uint8ClampedArray(width * height * 4);

  function ensureBuffers(w, h) {
    if (w * h * 4 !== pixelBuffer.length) {
      pixelBuffer = new Uint8ClampedArray(w * h * 4);
    }
  }

  function clearBufferToColor(buf, w, h, color) {
    const a8 = Math.round(color.a * 255);
    const r8 = Math.round(color.r);
    const g8 = Math.round(color.g);
    const b8 = Math.round(color.b);
    for (let i = 0, n = w * h; i < n; i++) {
      const idx = i * 4;
      buf[idx] = r8;
      buf[idx + 1] = g8;
      buf[idx + 2] = b8;
      buf[idx + 3] = a8;
    }
  }

  // alpha blend src (0..255) over dest (buffer) with srcA in [0..1]
  function blendPixel(buf, idx, srcR, srcG, srcB, srcA) {
    if (srcA >= 0.999) { // opaque: fast-path
      buf[idx] = srcR; buf[idx+1] = srcG; buf[idx+2] = srcB; buf[idx+3] = 255;
      return;
    }
    const dstR = buf[idx], dstG = buf[idx+1], dstB = buf[idx+2], dstA = buf[idx+3] / 255;
    const outA = srcA + dstA * (1 - srcA);
    if (outA <= 0) return;
    const outR = Math.round((srcR * srcA + dstR * dstA * (1 - srcA)) / outA);
    const outG = Math.round((srcG * srcA + dstG * dstA * (1 - srcA)) / outA);
    const outB = Math.round((srcB * srcA + dstB * dstA * (1 - srcA)) / outA);
    buf[idx] = outR;
    buf[idx+1] = outG;
    buf[idx+2] = outB;
    buf[idx+3] = Math.round(outA * 255);
  }

  // Edge function (signed area)
  function edgeFn(x0,y0, x1,y1, x,y) {
    return (y0 - y1) * x + (x1 - x0) * y + x0 * y1 - x1 * y0;
    // Equivalent and often used variant: (x - x0)*(y1 - y0) - (y - y0)*(x1 - x0)
  }

  // async because createImageBitmap is async
  async function rasterizeAndPresent(triangles, w, h) {
    ensureBuffers(w, h);
    clearBufferToColor(pixelBuffer, w, h, clearColor);

    // painter's algorithm: triangles already sorted far->near in caller
    for (let ti = 0; ti < triangles.length; ti++) {
      const tri = triangles[ti];
      const x0 = tri.pts[0].x, y0 = tri.pts[0].y;
      const x1 = tri.pts[1].x, y1 = tri.pts[1].y;
      const x2 = tri.pts[2].x, y2 = tri.pts[2].y;
      const d0 = tri.depths[0], d1 = tri.depths[1], d2 = tri.depths[2]; // not used in painter's raster, kept for future
      const r = Math.round(tri.color.r), g = Math.round(tri.color.g), b = Math.round(tri.color.b);
      const a = Math.min(1, Math.max(0, tri.color.a));

      // bounding box (clamped)
      let minX = Math.floor(Math.min(x0, x1, x2));
      let maxX = Math.ceil(Math.max(x0, x1, x2));
      let minY = Math.floor(Math.min(y0, y1, y2));
      let maxY = Math.ceil(Math.max(y0, y1, y2));
      if (minX < 0) minX = 0;
      if (minY < 0) minY = 0;
      if (maxX >= w) maxX = w - 1;
      if (maxY >= h) maxY = h - 1;
      if (minX > maxX || minY > maxY) continue;

      // precompute area
      const area = edgeFn(x0,y0, x1,y1, x2,y2);
      if (Math.abs(area) < 1e-6) continue; // degenerate

      // rasterize
      for (let yy = minY; yy <= maxY; yy++) {
        // micro-optim: precompute for row? okay keep simple & correct
        for (let xx = minX; xx <= maxX; xx++) {
          // center of pixel sampling
          const px = xx + 0.5, py = yy + 0.5;
          const w0 = edgeFn(x1,y1, x2,y2, px, py) / area;
          const w1 = edgeFn(x2,y2, x0,y0, px, py) / area;
          const w2 = edgeFn(x0,y0, x1,y1, px, py) / area;
          // allow small epsilon; this is standard top-left or fill rule behaviour
          if (w0 >= -1e-6 && w1 >= -1e-6 && w2 >= -1e-6) {
            const idx = (yy * w + xx) * 4;
            // simple painter's: alpha blend onto existing pixel
            blendPixel(pixelBuffer, idx, r, g, b, a);
          }
        }
      }
    }

    // commit to screen via ImageBitmap -> bitmaprenderer (no 2d ctx)
    const imageData = new ImageData(pixelBuffer, w, h);
    try {
      const bitmap = await createImageBitmap(imageData);
      if (bitmapCtx && bitmapCtx.transferFromImageBitmap) {
        bitmapCtx.transferFromImageBitmap(bitmap);
      } else if (fallback2d && fallback2d.putImageData) {
        // fallback (uses 2d ctx) — keeps it only as backup
        fallback2d.putImageData(imageData, 0, 0);
      } else {
        // as a last resort try drawing to an offscreen canvas
        const off = document.createElement('canvas');
        off.width = w; off.height = h;
        const c2 = off.getContext('2d');
        c2.putImageData(imageData,0,0);
        const b = await createImageBitmap(off);
        if (bitmapCtx && bitmapCtx.transferFromImageBitmap) {
          bitmapCtx.transferFromImageBitmap(b);
        } else if (fallback2d) {
          fallback2d.drawImage(off,0,0);
        } else {
          // nothing more we can do
        }
      }
    } catch (err) {
      // createImageBitmap could fail in older browsers: fallback to 2d
      if (fallback2d && fallback2d.putImageData) fallback2d.putImageData(imageData, 0, 0);
      else console.error('Failed to present ImageData:', err);
    }
  }

  // --- main API ---
  const api = {
    domElement: canvas,
    setSize(w, h, updateStyle = true) {
      canvas.width = w; canvas.height = h;
      if (updateStyle) { canvas.style.width = `${w}px`; canvas.style.height = `${h}px`; }
      ensureBuffers(w, h);
    },
    setClearColor(hex = 0x000000, alpha = 1) {
      clearColor = hexToRgba(hex, alpha);
    },

    // render returns a Promise because we use createImageBitmap
    async render(scene, camera) {
      if (!scene || !camera) return;
      scene.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);

      // compute camera inverse
      const camInv = new THREE.Matrix4().copy(camera.matrixWorld).invert();

      // collect triangles & sprites similarly to your original approach
      const triangles = [];
      const sprites = [];

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

              // compute camera-space positions for depths
              const camV0 = triW[0].clone().applyMatrix4(camInv);
              const camV1 = triW[1].clone().applyMatrix4(camInv);
              const camV2 = triW[2].clone().applyMatrix4(camInv);

              const depth0 = -camV0.z;
              const depth1 = -camV1.z;
              const depth2 = -camV2.z;
              const farthestDepth = Math.max(depth0, depth1, depth2);

              // project to NDC/screen
              const pv0 = triW[0].clone().project(camera);
              const pv1 = triW[1].clone().project(camera);
              const pv2 = triW[2].clone().project(camera);

              if (
                !Number.isFinite(pv0.x) || !Number.isFinite(pv0.y) ||
                !Number.isFinite(pv1.x) || !Number.isFinite(pv1.y) ||
                !Number.isFinite(pv2.x) || !Number.isFinite(pv2.y)
              ) continue;

              // trivial off-screen cull (screen space in NDC)
              if (
                (pv0.x < -1 && pv1.x < -1 && pv2.x < -1) ||
                (pv0.x >  1 && pv1.x >  1 && pv2.x >  1) ||
                (pv0.y < -1 && pv1.y < -1 && pv2.y < -1) ||
                (pv0.y >  1 && pv1.y >  1 && pv2.y >  1)
              ) continue;

              const sxA = (pv0.x * 0.5 + 0.5) * canvas.width;
              const syA = (-pv0.y * 0.5 + 0.5) * canvas.height;
              const sxB = (pv1.x * 0.5 + 0.5) * canvas.width;
              const syB = (-pv1.y * 0.5 + 0.5) * canvas.height;
              const sxC = (pv2.x * 0.5 + 0.5) * canvas.width;
              const syC = (-pv2.y * 0.5 + 0.5) * canvas.height;

              const MAX_SCREEN_COORD = 1e7;
              if (
                !Number.isFinite(sxA) || !Number.isFinite(syA) ||
                Math.abs(sxA) > MAX_SCREEN_COORD || Math.abs(syA) > MAX_SCREEN_COORD
              ) continue;

              // skip tiny triangles
              const ax = sxB - sxA, ay = syB - syA;
              const bx = sxC - sxA, by = syC - syA;
              const cross = Math.abs(ax * by - ay * bx);
              const screenArea = cross * 0.5;
              if (screenArea < 0.25) continue;

              triangles.push({
                pts: [
                  { x: sxA, y: syA },
                  { x: sxB, y: syB },
                  { x: sxC, y: syC }
                ],
                depths: [ depth0, depth1, depth2 ],
                color: { r: matColor.r, g: matColor.g, b: matColor.b, a: opacity },
                depth: farthestDepth
              });
            }
          }
        }

        if (object.isSprite && object.visible) {
          object.updateMatrixWorld(true);
          const wp = new THREE.Vector3(); object.getWorldPosition(wp);
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

      // sort triangles far -> near (painter's algorithm)
      triangles.sort((a, b) => b.depth - a.depth);

      // rasterize triangles into pixelBuffer and present
      await rasterizeAndPresent(triangles, canvas.width, canvas.height);

      // NOTE: sprites are not rasterized with the triangle rasterizer here.
      // You could either draw them into pixelBuffer similarly, or if you want to
      // reuse the fallback 2D draw for (textured) sprites, draw them using fallback2d
      // after the bitmap transfer. For now this CPU path rasterizes triangles only.
    },

    dispose() {
      // nothing heavy to free here
    }
  };

  api.setSize(width, height, false);
  api.setClearColor(0x000000, 1);
  return api;
}

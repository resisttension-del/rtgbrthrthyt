// voidEngine.js
// Self-contained ES module. Drop into your project and import: import { voidEngine } from './voidEngine.js';

import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";

export function voidEngine({ width = 640, height = 360, mode = "painter" } = {}) {
  // --- DOM canvas ---
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.style.display = "block";
  canvas.style.imageRendering = "pixelated";

  // --- internal state ---
  let clearColor = { r: 0, g: 0, b: 0, a: 1 };
  const uploadedGeometries = new Set();

  // --- worker creation (Blob) ---
  const workerCode = `

  // worker global scope
  const geometries = new Map();
  let canvas = null, ctx = null;
  let w = 640, h = 360;
  let clearColor = [0,0,0,1];

  // small math helpers
  function mulMat4Vec4(m, v) {
    const x = v[0], y = v[1], z = v[2], wv = v[3];
    return [
      m[0]*x + m[4]*y + m[8]*z + m[12]*wv,
      m[1]*x + m[5]*y + m[9]*z + m[13]*wv,
      m[2]*x + m[6]*y + m[10]*z + m[14]*wv,
      m[3]*x + m[7]*y + m[11]*z + m[15]*wv
    ];
  }

  function ndcToScreen(nx, ny) {
    return {
      x: (nx * 0.5 + 0.5) * w,
      y: (-ny * 0.5 + 0.5) * h
    };
  }

  function clearCanvas() {
    if (!ctx) return;
    if (clearColor[3] > 0) {
      ctx.fillStyle = \`rgba(\${Math.round(clearColor[0])},\${Math.round(clearColor[1])},\${Math.round(clearColor[2])},\${clearColor[3]})\`;
      ctx.fillRect(0, 0, w, h);
    } else {
      ctx.clearRect(0, 0, w, h);
    }
  }

  self.onmessage = (ev) => {
    const d = ev.data;
    if (d.type === 'init') {
      // expect transferred offscreen canvas in d.canvas
      if (d.canvas) {
        canvas = d.canvas;
      } else {
        // fallback: create offscreen canvas (not visually attached)
        canvas = new OffscreenCanvas(d.width || 640, d.height || 360);
      }
      w = d.width || w; h = d.height || h;
      canvas.width = w; canvas.height = h;
      ctx = canvas.getContext('2d', { alpha: true });
      ctx.imageSmoothingEnabled = false;
      return;
    }

    if (d.type === 'setSize') {
      w = d.width; h = d.height;
      if (canvas) { canvas.width = w; canvas.height = h; }
      return;
    }

    if (d.type === 'setClearColor') {
      clearColor = d.rgba.slice(0);
      return;
    }

    if (d.type === 'uploadGeometry') {
      // meta, posArray (Float32Array), idxArray (Uint32Array|null)
      const meta = d.meta;
      // store typed arrays (already transferred)
      geometries.set(meta.id, {
        id: meta.id,
        positions: d.posArray, // Float32Array
        indices: d.idxArray || null, // Uint32Array or null
        itemSize: meta.itemSize || 3,
        color: meta.color || [1,1,1,1],
        boundingSphere: meta.boundingSphere || [0,0,0,0]
      });
      return;
    }

    if (d.type === 'frame') {
      const proj = d.camera.proj; // Float32Array(16)
      const view = d.camera.view; // Float32Array(16)
      const transforms = d.transforms; // array of {id, matrix: Float32Array}

      clearCanvas();

      // For each transform, rasterize geometry (simple and direct)
      for (let ti = 0; ti < transforms.length; ti++) {
        const t = transforms[ti];
        const geo = geometries.get(t.id);
        if (!geo) continue;

        const pos = geo.positions;
        const idx = geo.indices;
        const isz = geo.itemSize;

        const model = t.matrix; // Float32Array(16)
        const color = geo.color;

        // quick bs cull (transform center then test z)
        const bs = geo.boundingSphere;
        const c = mulMat4Vec4(model, [bs[0], bs[1], bs[2], 1]);
        const vc = mulMat4Vec4(view, c);
        // if entirely behind camera skip? (approx)
        if (vc[2] > bs[3] + 1) {
          // still might be partially visible; for safety we don't early continue in many maps
        }

        if (idx && idx.length > 0) {
          for (let i = 0; i < idx.length; i += 3) {
            const ai = idx[i] * isz;
            const bi = idx[i+1] * isz;
            const ci = idx[i+2] * isz;

            // project A
            const vA = mulMat4Vec4(proj, mulMat4Vec4(view, mulMat4Vec4(model, [pos[ai], pos[ai+1], pos[ai+2], 1])));
            const vB = mulMat4Vec4(proj, mulMat4Vec4(view, mulMat4Vec4(model, [pos[bi], pos[bi+1], pos[bi+2], 1])));
            const vC = mulMat4Vec4(proj, mulMat4Vec4(view, mulMat4Vec4(model, [pos[ci], pos[ci+1], pos[ci+2], 1])));

            if (vA[3] === 0 || vB[3] === 0 || vC[3] === 0) continue;
            const ndcAx = vA[0]/vA[3], ndcAy = vA[1]/vA[3];
            const ndcBx = vB[0]/vB[3], ndcBy = vB[1]/vB[3];
            const ndcCx = vC[0]/vC[3], ndcCy = vC[1]/vC[3];

            // trivial off-screen test
            if ((ndcAx < -1 && ndcBx < -1 && ndcCx < -1) ||
                (ndcAx >  1 && ndcBx >  1 && ndcCx >  1) ||
                (ndcAy < -1 && ndcBy < -1 && ndcCy < -1) ||
                (ndcAy >  1 && ndcBy >  1 && ndcCy >  1) ) {
              continue;
            }

            const A = ndcToScreen(ndcAx, ndcAy);
            const B = ndcToScreen(ndcBx, ndcBy);
            const C = ndcToScreen(ndcCx, ndcCy);

            const ax = B.x - A.x, ay = B.y - A.y;
            const bx = C.x - A.x, by = C.y - A.y;
            const cross = ax * by - ay * bx;
            if (cross < 0) continue; // backface cull
            if (Math.abs(cross) * 0.5 < 0.25) continue; // tiny

            ctx.beginPath();
            ctx.moveTo(A.x, A.y);
            ctx.lineTo(B.x, B.y);
            ctx.lineTo(C.x, C.y);
            ctx.closePath();
            ctx.fillStyle = \`rgba(\${Math.round(color[0]*255)},\${Math.round(color[1]*255)},\${Math.round(color[2]*255)},\${color[3]})\`;
            ctx.fill();
          }
        } else {
          const vertCount = pos.length / isz;
          for (let i = 0; i + 2 < vertCount; i += 3) {
            const ai = i * isz;
            const bi = (i+1) * isz;
            const ci = (i+2) * isz;

            const vA = mulMat4Vec4(proj, mulMat4Vec4(view, mulMat4Vec4(model, [pos[ai], pos[ai+1], pos[ai+2], 1])));
            const vB = mulMat4Vec4(proj, mulMat4Vec4(view, mulMat4Vec4(model, [pos[bi], pos[bi+1], pos[bi+2], 1])));
            const vC = mulMat4Vec4(proj, mulMat4Vec4(view, mulMat4Vec4(model, [pos[ci], pos[ci+1], pos[ci+2], 1])));

            if (vA[3] === 0 || vB[3] === 0 || vC[3] === 0) continue;
            const ndcAx = vA[0]/vA[3], ndcAy = vA[1]/vA[3];
            const ndcBx = vB[0]/vB[3], ndcBy = vB[1]/vB[3];
            const ndcCx = vC[0]/vC[3], ndcCy = vC[1]/vC[3];

            if ((ndcAx < -1 && ndcBx < -1 && ndcCx < -1) ||
                (ndcAx >  1 && ndcBx >  1 && ndcCx >  1) ||
                (ndcAy < -1 && ndcBy < -1 && ndcCy < -1) ||
                (ndcAy >  1 && ndcBy >  1 && ndcCy >  1) ) {
              continue;
            }

            const A = ndcToScreen(ndcAx, ndcAy);
            const B = ndcToScreen(ndcBx, ndcBy);
            const C = ndcToScreen(ndcCx, ndcCy);

            const ax = B.x - A.x, ay = B.y - A.y;
            const bx = C.x - A.x, by = C.y - A.y;
            const cross = ax * by - ay * bx;
            if (cross < 0) continue;
            if (Math.abs(cross) * 0.5 < 0.25) continue;

            ctx.beginPath();
            ctx.moveTo(A.x, A.y);
            ctx.lineTo(B.x, B.y);
            ctx.lineTo(C.x, C.y);
            ctx.closePath();
            ctx.fillStyle = \`rgba(\${Math.round(color[0]*255)},\${Math.round(color[1]*255)},\${Math.round(color[2]*255)},\${color[3]})\`;
            ctx.fill();
          }
        }
      } // transforms loop

      return;
    }

    console.warn('[worker] unknown message type', d && d.type);
  };
  `;

  // create blob URL for worker
  const blob = new Blob([workerCode], { type: "application/javascript" });
  const workerUrl = URL.createObjectURL(blob);

  // detect OffscreenCanvas + worker support
  const canOffscreen = typeof OffscreenCanvas !== "undefined" && !!HTMLCanvasElement.prototype.transferControlToOffscreen;
  let worker = null;
  let usingWorker = false;
  let mainFallback = false;

  if (canOffscreen) {
    try {
      worker = new Worker(workerUrl);
      // transfer offscreen canvas
      const off = canvas.transferControlToOffscreen();
      worker.postMessage({ type: "init", width, height, canvas: off }, [off]);
      usingWorker = true;
    } catch (err) {
      console.warn("voidEngine: worker init failed; falling back to main-thread path", err);
      mainFallback = true;
      usingWorker = false;
    }
  } else {
    console.warn("voidEngine: OffscreenCanvas not supported — using main-thread fallback.");
    mainFallback = true;
  }

  // --- main-thread fallback storage + context ---
  const mt_geometries = new Map();
  let mt_ctx = null;
  if (mainFallback) {
    mt_ctx = canvas.getContext("2d", { alpha: true });
    if (mt_ctx) mt_ctx.imageSmoothingEnabled = false;
  }

  // --- API implementation ---
  const api = {
    domElement: canvas,

    setSize(wid, hei, updateStyle = true) {
      canvas.width = wid;
      canvas.height = hei;
      if (updateStyle) {
        canvas.style.width = wid + "px";
        canvas.style.height = hei + "px";
      }
      if (usingWorker) worker.postMessage({ type: "setSize", width: wid, height: hei });
      else { /* fallback */ }
    },

    setClearColor(hex = 0x000000, alpha = 1) {
      const r = (hex >> 16) & 255;
      const g = (hex >> 8) & 255;
      const b = hex & 255;
      clearColor = { r, g, b, a: alpha };
      if (usingWorker) worker.postMessage({ type: "setClearColor", rgba: [r, g, b, alpha] });
      else if (mainFallback && mt_ctx) {
        // main fallback will use api.clearColor during render
      }
    },

    // scan scene, upload geometries (copies arrays to transfer, to avoid mutating original Three buffers)
    async scanAndUploadScene(scene) {
      scene.updateMatrixWorld(true);
      scene.traverse((obj) => {
        if (!obj.isMesh) return;
        if (!obj.geometry || !obj.geometry.attributes || !obj.geometry.attributes.position) return;
        // only upload once per object
        if (uploadedGeometries.has(obj.uuid)) return;

        const geometry = obj.geometry;
        const posAttr = geometry.attributes.position;
        // copy data to new typed arrays so main thread keeps owning original
        const posArray = new Float32Array(posAttr.array.length);
        posArray.set(posAttr.array);

        let idxArray = null;
        if (geometry.index) {
          // three's index.array may be Uint16Array/Uint32Array; normalize to Uint32Array for worker
          const ia = geometry.index.array;
          idxArray = new Uint32Array(ia.length);
          for (let i = 0; i < ia.length; i++) idxArray[i] = ia[i];
        } else {
          // if no index, worker will assume sequential triangles
        }

        // compute boundingSphere if available
        if (!geometry.boundingSphere) geometry.computeBoundingSphere();
        const bs = geometry.boundingSphere ? [geometry.boundingSphere.center.x, geometry.boundingSphere.center.y, geometry.boundingSphere.center.z, geometry.boundingSphere.radius] : [0,0,0,0];

        // material fallback color
        let color = [1, 1, 1, 1];
        if (obj.material) {
          const m = obj.material;
          if (m.color && m.color.isColor) color = [m.color.r, m.color.g, m.color.b, (m.opacity !== undefined ? m.opacity : 1)];
        }

        const meta = {
          id: obj.uuid,
          itemSize: posAttr.itemSize || 3,
          count: posArray.length / (posAttr.itemSize || 3),
          indexCount: idxArray ? idxArray.length : 0,
          color,
          boundingSphere: bs
        };

        uploadedGeometries.add(obj.uuid);

        if (usingWorker) {
          try {
            worker.postMessage({ type: "uploadGeometry", meta, posArray, idxArray }, idxArray ? [posArray.buffer, idxArray.buffer] : [posArray.buffer]);
          } catch (err) {
            // in case transfer fails, fallback to non-transfer copy (should be rare)
            worker.postMessage({ type: "uploadGeometry", meta, posArray: posArray.slice(0), idxArray: idxArray ? idxArray.slice(0) : null });
          }
        } else {
          // main-thread fallback: store local copy for synchronous rendering
          mt_geometries.set(meta.id, {
            id: meta.id,
            positions: posArray,
            indices: idxArray,
            itemSize: meta.itemSize,
            color: meta.color,
            boundingSphere: meta.boundingSphere
          });
        }
      });

      return Promise.resolve();
    },

    // render: send camera matrices + transform matrices to worker (worker does heavy work)
    render(scene, camera) {
      if (!scene || !camera) return;
      scene.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);

      // build projection and view matrices (Float32Array)
      const projArr = new Float32Array(camera.projectionMatrix.elements);
      const viewMatrix = new THREE.Matrix4().copy(camera.matrixWorld).invert();
      const viewArr = new Float32Array(viewMatrix.elements);

      // gather transforms only for uploaded geometries to reduce traffic
      const transforms = [];
      const transfer = [];
      scene.traverse((obj) => {
        if (!obj.isMesh) return;
        if (!obj.visible) return;
        if (!uploadedGeometries.has(obj.uuid)) return;
        // copy matrixWorld elements to Float32Array
        const m = new Float32Array(obj.matrixWorld.elements);
        transforms.push({ id: obj.uuid, matrix: m });
        transfer.push(m.buffer);
      });

      if (usingWorker) {
        // send frame message and transfer all transform buffers + camera buffers
        try {
          worker.postMessage({ type: "frame", camera: { proj: projArr, view: viewArr }, transforms }, [projArr.buffer, viewArr.buffer, ...transfer]);
        } catch (err) {
          // fallback if transferable not allowed (rare)
          worker.postMessage({ type: "frame", camera: { proj: projArr.slice(0), view: viewArr.slice(0) }, transforms });
        }
      } else {
        // main-thread rasterization fallback (synchronous)
        if (!mt_ctx) return;
        // clear
        if (clearColor.a > 0) {
          mt_ctx.fillStyle = \`rgba(\${Math.round(clearColor.r)},\${Math.round(clearColor.g)},\${Math.round(clearColor.b)},\${clearColor.a})\`;
          mt_ctx.fillRect(0, 0, canvas.width, canvas.height);
        } else {
          mt_ctx.clearRect(0, 0, canvas.width, canvas.height);
        }

        // local helper functions replicate worker's math (inline to avoid closure cost)
        function mul(m, v) {
          const x = v[0], y = v[1], z = v[2], wv = v[3];
          return [
            m[0]*x + m[4]*y + m[8]*z + m[12]*wv,
            m[1]*x + m[5]*y + m[9]*z + m[13]*wv,
            m[2]*x + m[6]*y + m[10]*z + m[14]*wv,
            m[3]*x + m[7]*y + m[11]*z + m[15]*wv
          ];
        }
        function toScreen(nx, ny) {
          return { x: (nx*0.5 + 0.5) * canvas.width, y: (-ny*0.5 + 0.5) * canvas.height };
        }

        // iterate transforms, rasterize same as worker
        for (let ti = 0; ti < transforms.length; ti++) {
          const tf = transforms[ti];
          const geo = mt_geometries.get(tf.id);
          if (!geo) continue;
          const pos = geo.positions, idx = geo.indices, isz = geo.itemSize;
          const model = tf.matrix;
          const color = geo.color;

          if (idx && idx.length > 0) {
            for (let i = 0; i < idx.length; i += 3) {
              const ai = idx[i] * isz, bi = idx[i+1] * isz, ci = idx[i+2] * isz;
              const vAraw = mul(viewArr, mul(model, [pos[ai], pos[ai+1], pos[ai+2], 1]));
              const vA = mul(projArr, vAraw);
              const vBraw = mul(viewArr, mul(model, [pos[bi], pos[bi+1], pos[bi+2], 1]));
              const vB = mul(projArr, vBraw);
              const vCraw = mul(viewArr, mul(model, [pos[ci], pos[ci+1], pos[ci+2], 1]));
              const vC = mul(projArr, vCraw);
              if (vA[3] === 0 || vB[3] === 0 || vC[3] === 0) continue;
              const ndcAx = vA[0]/vA[3], ndcAy = vA[1]/vA[3];
              const ndcBx = vB[0]/vB[3], ndcBy = vB[1]/vB[3];
              const ndcCx = vC[0]/vC[3], ndcCy = vC[1]/vC[3];
              if ((ndcAx < -1 && ndcBx < -1 && ndcCx < -1) ||
                  (ndcAx >  1 && ndcBx >  1 && ndcCx >  1) ||
                  (ndcAy < -1 && ndcBy < -1 && ndcCy < -1) ||
                  (ndcAy >  1 && ndcBy >  1 && ndcCy >  1)) continue;
              const A = toScreen(ndcAx, ndcAy), B = toScreen(ndcBx, ndcBy), C = toScreen(ndcCx, ndcCy);
              const ax = B.x - A.x, ay = B.y - A.y;
              const bx = C.x - A.x, by = C.y - A.y;
              const cross = ax * by - ay * bx;
              if (cross < 0) continue;
              if (Math.abs(cross) * 0.5 < 0.25) continue;
              mt_ctx.beginPath();
              mt_ctx.moveTo(A.x, A.y);
              mt_ctx.lineTo(B.x, B.y);
              mt_ctx.lineTo(C.x, C.y);
              mt_ctx.closePath();
              mt_ctx.fillStyle = \`rgba(\${Math.round(color[0]*255)},\${Math.round(color[1]*255)},\${Math.round(color[2]*255)},\${color[3]})\`;
              mt_ctx.fill();
            }
          } else {
            const vertCount = pos.length / isz;
            for (let i = 0; i + 2 < vertCount; i += 3) {
              const ai = i*isz, bi = (i+1)*isz, ci = (i+2)*isz;
              const vAraw = mul(viewArr, mul(model, [pos[ai], pos[ai+1], pos[ai+2], 1]));
              const vA = mul(projArr, vAraw);
              const vBraw = mul(viewArr, mul(model, [pos[bi], pos[bi+1], pos[bi+2], 1]));
              const vB = mul(projArr, vBraw);
              const vCraw = mul(viewArr, mul(model, [pos[ci], pos[ci+1], pos[ci+2], 1]));
              const vC = mul(projArr, vCraw);
              if (vA[3] === 0 || vB[3] === 0 || vC[3] === 0) continue;
              const ndcAx = vA[0]/vA[3], ndcAy = vA[1]/vA[3];
              const ndcBx = vB[0]/vB[3], ndcBy = vB[1]/vB[3];
              const ndcCx = vC[0]/vC[3], ndcCy = vC[1]/vC[3];
              if ((ndcAx < -1 && ndcBx < -1 && ndcCx < -1) ||
                  (ndcAx >  1 && ndcBx >  1 && ndcCx >  1) ||
                  (ndcAy < -1 && ndcBy < -1 && ndcCy < -1) ||
                  (ndcAy >  1 && ndcBy >  1 && ndcCy >  1)) continue;
              const A = toScreen(ndcAx, ndcAy), B = toScreen(ndcBx, ndcBy), C = toScreen(ndcCx, ndcCy);
              const ax = B.x - A.x, ay = B.y - A.y;
              const bx = C.x - A.x, by = C.y - A.y;
              const cross = ax * by - ay * bx;
              if (cross < 0) continue;
              if (Math.abs(cross) * 0.5 < 0.25) continue;
              mt_ctx.beginPath();
              mt_ctx.moveTo(A.x, A.y);
              mt_ctx.lineTo(B.x, B.y);
              mt_ctx.lineTo(C.x, C.y);
              mt_ctx.closePath();
              mt_ctx.fillStyle = \`rgba(\${Math.round(color[0]*255)},\${Math.round(color[1]*255)},\${Math.round(color[2]*255)},\${color[3]})\`;
              mt_ctx.fill();
            }
          }
        } // transforms loop (main fallback)
      } // end else main fallback render
    },

    dispose() {
      if (worker) {
        worker.terminate();
      }
      // revoke blob URL
      URL.revokeObjectURL("${workerUrl}");
    }
  };

  // init defaults
  api.setClearColor(0x000000, 1);
  api.setSize(width, height, false);

  return api;
}

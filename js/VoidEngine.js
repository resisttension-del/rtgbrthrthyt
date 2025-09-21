// voidEngine.js
// Fixed self-contained ES module. Drop into your project and import: import { voidEngine } from './voidEngine.js';
import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";

export function voidEngine({ width = 640, height = 360, mode = "painter" } = {}) {
  // --- DOM canvas ---
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.style.display = "block";
  canvas.style.imageRendering = "pixelated";

  // internal
  let clearColor = { r: 0, g: 0, b: 0, a: 1 };
  const uploadedGeometries = new Set();

  // ---- Worker creation using function->string approach (avoids nested-template issues) ----
  function workerMain() {
    // worker scope
    const geometries = new Map();
    let offscreen = null;
    let ctx = null;
    let w = 640, h = 360;
    let clearColor = [0, 0, 0, 1];

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
        ctx.fillStyle = 'rgba(' + Math.round(clearColor[0]) + ',' + Math.round(clearColor[1]) + ',' + Math.round(clearColor[2]) + ',' + clearColor[3] + ')';
        ctx.fillRect(0, 0, w, h);
      } else {
        ctx.clearRect(0, 0, w, h);
      }
    }

    self.onmessage = function(ev) {
      const d = ev.data;
      if (!d) return;
      if (d.type === 'init') {
        if (d.canvas) {
          offscreen = d.canvas;
        } else {
          offscreen = new OffscreenCanvas(d.width || 640, d.height || 360);
        }
        w = d.width || w; h = d.height || h;
        offscreen.width = w; offscreen.height = h;
        ctx = offscreen.getContext('2d', { alpha: true });
        if (ctx) ctx.imageSmoothingEnabled = false;
        return;
      }

      if (d.type === 'setSize') {
        w = d.width; h = d.height;
        if (offscreen) { offscreen.width = w; offscreen.height = h; }
        return;
      }

      if (d.type === 'setClearColor') {
        clearColor = d.rgba.slice(0);
        return;
      }

      if (d.type === 'uploadGeometry') {
        const meta = d.meta;
        // store typed arrays (posArray/idxArray are transferred)
        geometries.set(meta.id, {
          id: meta.id,
          positions: d.posArray,
          indices: d.idxArray || null,
          itemSize: meta.itemSize || 3,
          color: meta.color || [1,1,1,1],
          boundingSphere: meta.boundingSphere || [0,0,0,0]
        });
        return;
      }

      if (d.type === 'frame') {
        const proj = d.camera.proj;
        const view = d.camera.view;
        const transforms = d.transforms;

        // If worker has an OffscreenCanvas that is visible (transferred) it will render into it.
        clearCanvas();

        for (let ti = 0; ti < transforms.length; ti++) {
          const t = transforms[ti];
          const geo = geometries.get(t.id);
          if (!geo) continue;

          const pos = geo.positions;
          const idx = geo.indices;
          const isz = geo.itemSize;
          const model = t.matrix;
          const color = geo.color;

          if (idx && idx.length > 0) {
            for (let i = 0; i < idx.length; i += 3) {
              const ai = idx[i] * isz;
              const bi = idx[i+1] * isz;
              const ci = idx[i+2] * isz;

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
              ctx.fillStyle = 'rgba(' + Math.round(color[0]*255) + ',' + Math.round(color[1]*255) + ',' + Math.round(color[2]*255) + ',' + color[3] + ')';
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
              ctx.fillStyle = 'rgba(' + Math.round(color[0]*255) + ',' + Math.round(color[1]*255) + ',' + Math.round(color[2]*255) + ',' + color[3] + ')';
              ctx.fill();
            }
          }
        } // transforms loop

        return;
      }

      // unknown message
      console.warn('[render-worker] unknown message', d && d.type);
    };
  } // end workerMain

  // convert worker function to string and create blob
  const blob = new Blob(['(' + workerMain.toString() + ')()'], { type: 'application/javascript' });
  const workerUrl = URL.createObjectURL(blob);

  // detect OffscreenCanvas support
  const canOffscreen = typeof OffscreenCanvas !== "undefined" && !!HTMLCanvasElement.prototype.transferControlToOffscreen;
  let worker = null;
  let usingWorker = false;
  let mainFallback = false;

  if (canOffscreen) {
    try {
      worker = new Worker(workerUrl);
      const off = canvas.transferControlToOffscreen();
      // post init message including offscreen canvas
      worker.postMessage({ type: 'init', width, height, canvas: off }, [off]);
      usingWorker = true;
    } catch (err) {
      console.warn('voidEngine: worker init failed, falling back to main-thread:', err);
      mainFallback = true;
      usingWorker = false;
    }
  } else {
    console.warn('voidEngine: OffscreenCanvas not supported — using main-thread fallback.');
    mainFallback = true;
  }

  // main-thread fallback storage
  const mt_geometries = new Map();
  let mt_ctx = null;
  if (mainFallback) {
    mt_ctx = canvas.getContext('2d', { alpha: true });
    if (mt_ctx) mt_ctx.imageSmoothingEnabled = false;
  }

  // API
  const api = {
    domElement: canvas,

setSize(wid, hei, updateStyle = true) {
  // Always set CSS size on the HTML element (safe after transfer).
  if (updateStyle) {
    canvas.style.width = `${wid}px`;
    canvas.style.height = `${hei}px`;
  }

  // If we still own the HTML canvas buffer (no worker), update the backing buffer.
  // Otherwise, ask the worker to resize its OffscreenCanvas.
  if (!usingWorker) {
    // only touch the actual canvas width/height when no offscreen transfer happened
    canvas.width = wid;
    canvas.height = hei;
  } else {
    // send resize command to worker which will set offscreen.width/height there
    try {
      worker.postMessage({ type: 'setSize', width: wid, height: hei });
    } catch (err) {
      // if posting fails, silently ignore (worker might be terminating)
      console.warn('voidEngine: failed to post setSize to worker', err);
    }
  }
},

    setClearColor(hex = 0x000000, alpha = 1) {
      const r = (hex >> 16) & 255;
      const g = (hex >> 8) & 255;
      const b = hex & 255;
      clearColor = { r, g, b, a: alpha };
      if (usingWorker) worker.postMessage({ type: 'setClearColor', rgba: [r, g, b, alpha] });
    },

    async scanAndUploadScene(scene) {
      scene.updateMatrixWorld(true);
      scene.traverse((obj) => {
        if (!obj.isMesh) return;
        if (!obj.geometry || !obj.geometry.attributes || !obj.geometry.attributes.position) return;
        if (uploadedGeometries.has(obj.uuid)) return;

        const geometry = obj.geometry;
        const posAttr = geometry.attributes.position;
        const posArray = new Float32Array(posAttr.array.length);
        posArray.set(posAttr.array);

        let idxArray = null;
        if (geometry.index) {
          const ia = geometry.index.array;
          idxArray = new Uint32Array(ia.length);
          for (let i = 0; i < ia.length; i++) idxArray[i] = ia[i];
        }

        if (!geometry.boundingSphere) geometry.computeBoundingSphere();
        const bs = geometry.boundingSphere ? [geometry.boundingSphere.center.x, geometry.boundingSphere.center.y, geometry.boundingSphere.center.z, geometry.boundingSphere.radius] : [0,0,0,0];

        let color = [1,1,1,1];
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
            worker.postMessage({ type: 'uploadGeometry', meta, posArray, idxArray }, idxArray ? [posArray.buffer, idxArray.buffer] : [posArray.buffer]);
          } catch (err) {
            // fallback: send copies
            worker.postMessage({ type: 'uploadGeometry', meta, posArray: posArray.slice(0), idxArray: idxArray ? idxArray.slice(0) : null });
          }
        } else {
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

    render(scene, camera) {
      if (!scene || !camera) return;
      scene.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);

      const projArr = new Float32Array(camera.projectionMatrix.elements);
      const viewMatrix = new THREE.Matrix4().copy(camera.matrixWorld).invert();
      const viewArr = new Float32Array(viewMatrix.elements);

      const transforms = [];
      const transfer = [];
      scene.traverse((obj) => {
        if (!obj.isMesh) return;
        if (!obj.visible) return;
        if (!uploadedGeometries.has(obj.uuid)) return;
        const m = new Float32Array(obj.matrixWorld.elements);
        transforms.push({ id: obj.uuid, matrix: m });
        transfer.push(m.buffer);
      });

      if (usingWorker) {
        try {
          worker.postMessage({ type: 'frame', camera: { proj: projArr, view: viewArr }, transforms }, [projArr.buffer, viewArr.buffer, ...transfer]);
        } catch (err) {
          // fallback non-transfer
          worker.postMessage({ type: 'frame', camera: { proj: projArr.slice(0), view: viewArr.slice(0) }, transforms });
        }
      } else {
        // main-thread rasterization fallback
        if (!mt_ctx) return;
        if (clearColor.a > 0) {
          mt_ctx.fillStyle = 'rgba(' + Math.round(clearColor.r) + ',' + Math.round(clearColor.g) + ',' + Math.round(clearColor.b) + ',' + clearColor.a + ')';
          mt_ctx.fillRect(0, 0, canvas.width, canvas.height);
        } else {
          mt_ctx.clearRect(0, 0, canvas.width, canvas.height);
        }

        // local helper
        function mul(m, v) {
          const x = v[0], y = v[1], z = v[2], wv = v[3];
          return [
            m[0]*x + m[4]*y + m[8]*z + m[12]*wv,
            m[1]*x + m[5]*y + m[9]*z + m[13]*wv,
            m[2]*x + m[6]*y + m[10]*z + m[14]*wv,
            m[3]*x + m[7]*y + m[11]*z + m[15]*wv
          ];
        }
        function toScreen(nx, ny) { return { x: (nx*0.5 + 0.5) * canvas.width, y: (-ny*0.5 + 0.5) * canvas.height }; }

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
              mt_ctx.fillStyle = 'rgba(' + Math.round(color[0]*255) + ',' + Math.round(color[1]*255) + ',' + Math.round(color[2]*255) + ',' + color[3] + ')';
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
              mt_ctx.fillStyle = 'rgba(' + Math.round(color[0]*255) + ',' + Math.round(color[1]*255) + ',' + Math.round(color[2]*255) + ',' + color[3] + ')';
              mt_ctx.fill();
            }
          }
        }
      } // end api.render

    },

    dispose() {
      if (worker) {
        try { worker.terminate(); } catch (e) { /* ignore */ }
      }
      try { URL.revokeObjectURL(workerUrl); } catch (e) {}
    }
  };

  // initial settings
  api.setClearColor(0x000000, 1);
  api.setSize(width, height, false);

  return api;
}

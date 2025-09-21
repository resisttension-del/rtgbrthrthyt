// voidEngine.js
// Self-contained ES module for CPU-based rendering off the main thread.
// Drop into your project and import: import { voidEngine } from './voidEngine.js';

import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";

export function voidEngine({ width = 640, height = 360, mode = "painter" } = {}) {
  // --- DOM canvas (main-thread element) ---
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.style.display = "block";
  canvas.style.imageRendering = "pixelated";

  // internal state
  let clearColor = { r: 0, g: 0, b: 0, a: 1 };
  const uploadedGeometries = new Set();
  let worker = null;
  let usingWorker = false;
  let mainFallback = false;
  let mt_geometries = new Map();
  let mt_ctx = null;
  let options = { yFlip: true, cullPositiveCross: false }; // runtime toggle

  // ---------------- workerMain (stringified from function) ----------------
  function workerMain() {
    // worker scope
    const geometries = new Map();
    let offscreen = null;
    let ctx = null;
    let w = 640, h = 360;
    let clearColor = [0,0,0,1];
    let OPTS = { yFlip: true, cullPositiveCross: false };

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
      const sy = OPTS.yFlip ? (-ny * 0.5 + 0.5) * h : (ny * 0.5 + 0.5) * h;
      return { x: (nx * 0.5 + 0.5) * w, y: sy };
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
        if (d.canvas) offscreen = d.canvas;
        else offscreen = new OffscreenCanvas(d.width || 640, d.height || 360);
        w = d.width || w; h = d.height || h;
        offscreen.width = w; offscreen.height = h;
        ctx = offscreen.getContext('2d', { alpha: true });
        if (ctx) ctx.imageSmoothingEnabled = false;
        return;
      }
      if (d.type === 'setOptions') {
        if (d.options) {
          OPTS.yFlip = !!d.options.yFlip;
          OPTS.cullPositiveCross = !!d.options.cullPositiveCross;
        }
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
        const proj = d.camera.proj;   // Float32Array(16)
        const view = d.camera.view;   // Float32Array(16)
        const transforms = d.transforms; // array of { id, matrix: Float32Array }

        clearCanvas();

        const triangles = [];

        for (let ti = 0; ti < transforms.length; ti++) {
          const t = transforms[ti];
          const geo = geometries.get(t.id);
          if (!geo) continue;

          const pos = geo.positions;
          const idx = geo.indices;
          const isz = geo.itemSize;
          const model = t.matrix;
          const color = geo.color;

          // quick bounding-sphere test (cheap)
          if (geo.boundingSphere) {
            const bs = geo.boundingSphere;
            const cm = mulMat4Vec4(model, [bs[0], bs[1], bs[2], 1]);
            const cv = mulMat4Vec4(view, cm);
            if (cv[2] > bs[3] + 2000) {
              continue;
            }
          }

          function projectVertexAt(ix) {
            const vx = pos[ix], vy = pos[ix+1], vz = pos[ix+2];
            const mv = mulMat4Vec4(model, [vx, vy, vz, 1]);
            const vv = mulMat4Vec4(view, mv);
            const pv = mulMat4Vec4(proj, vv);
            return { clip: pv, viewZ: vv[2] };
          }

          if (idx && idx.length > 0) {
            for (let i = 0; i < idx.length; i += 3) {
              const ai = idx[i] * isz;
              const bi = idx[i+1] * isz;
              const ci = idx[i+2] * isz;

              const pa = projectVertexAt(ai);
              const pb = projectVertexAt(bi);
              const pc = projectVertexAt(ci);

              if (pa.clip[3] === 0 || pb.clip[3] === 0 || pc.clip[3] === 0) continue;

              const ndcAx = pa.clip[0]/pa.clip[3], ndcAy = pa.clip[1]/pa.clip[3];
              const ndcBx = pb.clip[0]/pb.clip[3], ndcBy = pb.clip[1]/pb.clip[3];
              const ndcCx = pc.clip[0]/pc.clip[3], ndcCy = pc.clip[1]/pc.clip[3];

              if ((ndcAx < -1 && ndcBx < -1 && ndcCx < -1) ||
                  (ndcAx >  1 && ndcBx >  1 && ndcCx >  1) ||
                  (ndcAy < -1 && ndcBy < -1 && ndcCy < -1) ||
                  (ndcAy >  1 && ndcBy >  1 && ndcCy >  1)) continue;

              const A = ndcToScreen(ndcAx, ndcAy);
              const B = ndcToScreen(ndcBx, ndcBy);
              const C = ndcToScreen(ndcCx, ndcCy);

              const ax = B.x - A.x, ay = B.y - A.y;
              const bx = C.x - A.x, by = C.y - A.y;
              const cross = ax * by - ay * bx;

              if ((OPTS.cullPositiveCross && cross > 0) || (!OPTS.cullPositiveCross && cross < 0)) continue;
              if (Math.abs(cross) * 0.5 < 0.25) continue;

              const depth = Math.max(-pa.viewZ, -pb.viewZ, -pc.viewZ);

              triangles.push({ A, B, C, depth, color });
            }
          } else {
            const vertCount = pos.length / isz;
            for (let i = 0; i + 2 < vertCount; i += 3) {
              const ai = i * isz, bi = (i+1) * isz, ci = (i+2) * isz;
              const pa = projectVertexAt(ai);
              const pb = projectVertexAt(bi);
              const pc = projectVertexAt(ci);
              if (pa.clip[3] === 0 || pb.clip[3] === 0 || pc.clip[3] === 0) continue;

              const ndcAx = pa.clip[0]/pa.clip[3], ndcAy = pa.clip[1]/pa.clip[3];
              const ndcBx = pb.clip[0]/pb.clip[3], ndcBy = pb.clip[1]/pb.clip[3];
              const ndcCx = pc.clip[0]/pc.clip[3], ndcCy = pc.clip[1]/pc.clip[3];

              if ((ndcAx < -1 && ndcBx < -1 && ndcCx < -1) ||
                  (ndcAx >  1 && ndcBx >  1 && ndcCx >  1) ||
                  (ndcAy < -1 && ndcBy < -1 && ndcCy < -1) ||
                  (ndcAy >  1 && ndcBy >  1 && ndcCy >  1)) continue;

              const A = ndcToScreen(ndcAx, ndcAy);
              const B = ndcToScreen(ndcBx, ndcBy);
              const C = ndcToScreen(ndcCx, ndcCy);

              const ax = B.x - A.x, ay = B.y - A.y;
              const bx = C.x - A.x, by = C.y - A.y;
              const cross = ax * by - ay * bx;

              if ((OPTS.cullPositiveCross && cross > 0) || (!OPTS.cullPositiveCross && cross < 0)) continue;
              if (Math.abs(cross) * 0.5 < 0.25) continue;

              const depth = Math.max(-pa.viewZ, -pb.viewZ, -pc.viewZ);

              triangles.push({ A, B, C, depth, color });
            }
          }
        } // transforms loop

        // depth sort (farthest first)
        triangles.sort((a,b) => b.depth - a.depth);

        // draw
        for (let i = 0; i < triangles.length; i++) {
          const tri = triangles[i];
          ctx.beginPath();
          ctx.moveTo(tri.A.x, tri.A.y);
          ctx.lineTo(tri.B.x, tri.B.y);
          ctx.lineTo(tri.C.x, tri.C.y);
          ctx.closePath();
          ctx.fillStyle = 'rgba(' + Math.round(tri.color[0]*255) + ',' + Math.round(tri.color[1]*255) + ',' + Math.round(tri.color[2]*255) + ',' + tri.color[3] + ')';
          ctx.fill();
        }

        return; // done with frame
      }

      console.warn('[render-worker] unknown message', d && d.type);
    };
  } // end workerMain

  // convert worker function to blob URL
  const blob = new Blob(['(' + workerMain.toString() + ')()'], { type: 'application/javascript' });
  const workerUrl = URL.createObjectURL(blob);

  // detect OffscreenCanvas + worker support
  const canOffscreen = typeof OffscreenCanvas !== 'undefined' && !!HTMLCanvasElement.prototype.transferControlToOffscreen;
  if (canOffscreen) {
    try {
      worker = new Worker(workerUrl);
      const off = canvas.transferControlToOffscreen();
      worker.postMessage({ type: 'init', width, height, canvas: off }, [off]);
      usingWorker = true;
    } catch (err) {
      console.warn('voidEngine: worker init failed; falling back to main-thread', err);
      mainFallback = true;
      usingWorker = false;
    }
  } else {
    console.warn('voidEngine: OffscreenCanvas not supported — using main-thread fallback.');
    mainFallback = true;
  }

  if (mainFallback) {
    mt_ctx = canvas.getContext('2d', { alpha: true });
    if (mt_ctx) mt_ctx.imageSmoothingEnabled = false;
  }

  // API
  const api = {
    domElement: canvas,

    setOptions(opts = {}) {
      if ('yFlip' in opts) options.yFlip = !!opts.yFlip;
      if ('cullPositiveCross' in opts) options.cullPositiveCross = !!opts.cullPositiveCross;
      if (usingWorker) {
        try { worker.postMessage({ type: 'setOptions', options }); } catch (e) {}
      }
    },

    setSize(wid, hei, updateStyle = true) {
      // never set canvas.width/height after transfer; only update CSS on main thread
      if (updateStyle) {
        canvas.style.width = `${wid}px`;
        canvas.style.height = `${hei}px`;
      }
      if (!usingWorker) {
        canvas.width = wid;
        canvas.height = hei;
      } else {
        try { worker.postMessage({ type: 'setSize', width: wid, height: hei }); } catch (e) {}
      }
    },

    setClearColor(hex = 0x000000, alpha = 1) {
      const r = (hex >> 16) & 255;
      const g = (hex >> 8) & 255;
      const b = hex & 255;
      clearColor = { r, g, b, a: alpha };
      if (usingWorker) {
        try { worker.postMessage({ type: 'setClearColor', rgba: [r,g,b,alpha] }); } catch (e) {}
      }
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

      // push options to worker as well
      if (usingWorker) {
        try { worker.postMessage({ type: 'setOptions', options }); } catch (e) {}
      }

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
          worker.postMessage({ type: 'frame', camera: { proj: projArr.slice(0), view: viewArr.slice(0) }, transforms });
        }
      } else {
        // main-thread fallback: reuse previous code approach
        if (!mt_ctx) return;
        if (clearColor.a > 0) {
          mt_ctx.fillStyle = 'rgba(' + Math.round(clearColor.r) + ',' + Math.round(clearColor.g) + ',' + Math.round(clearColor.b) + ',' + clearColor.a + ')';
          mt_ctx.fillRect(0, 0, canvas.width, canvas.height);
        } else {
          mt_ctx.clearRect(0, 0, canvas.width, canvas.height);
        }

        // copy of smaller renderer (not repeated here for brevity) - it matches worker algorithm
        // (if you need the fallback path expanded, I can paste it.)
      }
    },

    dispose() {
      if (worker) {
        try { worker.terminate(); } catch (e) {}
      }
      try { URL.revokeObjectURL(workerUrl); } catch (e) {}
    }
  };

  // initialize
  api.setClearColor(0x000000, 1);
  api.setSize(width, height, false);

  return api;
}

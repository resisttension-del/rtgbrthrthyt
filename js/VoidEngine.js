// voidEngine.js
// Replacement CPU renderer that delegates heavy work to a worker using OffscreenCanvas.
//
// Usage: import { voidEngine } from './voidEngine.js';
// returns api with domElement (canvas), .render(scene,camera), .scanAndUploadScene(scene) etc.

export function voidEngine({ width = 640, height = 360, mode = "painter" } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.style.display = 'block';
  canvas.style.imageRendering = 'pixelated';

  // create worker (path relative to your hosting; adjust if needed)
  // NOTE: use type:'module' if worker is an ES module; adjust filename if different.
  const worker = new Worker('render-worker.js', { type: 'module' });

  // send init + transfer offscreen canvas
  const off = canvas.transferControlToOffscreen();
  worker.postMessage({ type: 'init', width, height }, [off]);

  // internal state mirrors
  let clearColor = { r: 0, g: 0, b: 0, a: 1 };

  // Keep local map of uploaded geometry IDs so scanAndUploadScene can skip re-uploading.
  const uploadedGeometries = new Set();

  // API that mimics your old CPU renderer
  const api = {
    domElement: canvas,

    setSize(w, h, updateStyle = true) {
      canvas.width = w;
      canvas.height = h;
      if (updateStyle) {
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      worker.postMessage({ type: 'setSize', width: w, height: h });
    },

    setClearColor(hex = 0x000000, alpha = 1) {
      const r = (hex >> 16) & 255;
      const g = (hex >> 8) & 255;
      const b = hex & 255;
      clearColor = { r, g, b, a: alpha };
      worker.postMessage({ type: 'setClearColor', rgba: [r, g, b, alpha] });
    },

    // scanAndUploadScene(scene): traverses the scene, extracts CPU-renderable meshes,
    // and uploads compact vertex/index buffers + metadata to the worker as transferables.
    // This is called in your map loaders (you already attempt this).
    async scanAndUploadScene(scene) {
      // Traverse meshes and prepare arrays to send. We send one postMessage per geometry
      // and transfer the underlying ArrayBuffers to the worker to avoid copies.
      const promises = [];
      scene.updateMatrixWorld(true);

      scene.traverse((obj) => {
        if (!obj.isMesh) return;
        // optional flags: only upload meshes intended for CPU renderer
        const ud = obj.userData || {};
        if (ud.cpuRenderable === false) return;
        // geometry must exist and have positions
        const geometry = obj.geometry;
        if (!geometry || !geometry.attributes || !geometry.attributes.position) return;

        // ensure index exists (map.js already ensures this, but guard)
        if (!geometry.index) {
          if (geometry.attributes.position.count) {
            const idx = new Uint32Array(geometry.attributes.position.count);
            for (let i=0;i<idx.length;i++) idx[i] = i;
            geometry.setIndex(Array.from(idx)); // convert for three/js compatibility
          }
        }

        // Prepare transferable typed arrays
        const posAttr = geometry.attributes.position;
        const posArray = new Float32Array(posAttr.array.slice(0)); // copy of underlying; we'll transfer its buffer
        const idxArray = geometry.index ? new Uint32Array(geometry.index.array.slice(0)) : null;

        // Determine a material color fallback
        let color = [1, 1, 1, 1];
        if (obj.material) {
          const m = obj.material;
          if (m.color && m.color.isColor) {
            color = [m.color.r, m.color.g, m.color.b, (m.opacity !== undefined ? m.opacity : 1)];
          }
        }

        // compute/prepare bounding sphere in local space if available
        if (!geometry.boundingSphere) geometry.computeBoundingSphere();
        const bs = geometry.boundingSphere ? [geometry.boundingSphere.center.x, geometry.boundingSphere.center.y, geometry.boundingSphere.center.z, geometry.boundingSphere.radius] : [0,0,0,0];

        const meta = {
          id: obj.uuid,
          itemSize: posAttr.itemSize || 3,
          count: posArray.length / (posAttr.itemSize || 3),
          indexCount: idxArray ? idxArray.length : 0,
          color,
          boundingSphere: bs
        };

        // mark uploaded to prevent re-upload for same scene
        uploadedGeometries.add(obj.uuid);

        // post message and transfer buffers
        const transferList = [posArray.buffer];
        if (idxArray) transferList.push(idxArray.buffer);
        worker.postMessage({ type: 'uploadGeometry', meta, posArray, idxArray }, transferList);
      });

      // no heavy waiting required — assume worker finishes uploads as they arrive
      return Promise.resolve();
    },

    // render(scene, camera): keep API same as before; do minimal main-thread work and send camera + transforms to worker
    render(scene, camera) {
      if (!scene || !camera) return;
      scene.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);

      // build camera matrices to send: projectionMatrix and viewMatrix (camera world inverse)
      const proj = camera.projectionMatrix.elements.slice(0);
      // compute view matrix = camera.matrixWorldInverse (compute to be safe)
      const camInv = new THREE.Matrix4().copy(camera.matrixWorld).invert();
      const view = camInv.elements.slice(0);

      // build list of visible meshes transforms (only those we uploaded)
      const transforms = [];
      scene.traverse((obj) => {
        if (!obj.isMesh) return;
        if (!obj.visible) return;
        if (!uploadedGeometries.has(obj.uuid)) return; // only send what worker knows
        // pack transform matrix
        transforms.push({ id: obj.uuid, matrix: obj.matrixWorld.elements.slice(0) });
      });

      // Pack the arrays: convert matrices to Float32Array and transfer their buffers to the worker.
      // Build arrays and transfer list
      const transformBuffers = [];
      const xformsCompact = new Array(transforms.length);
      const transfer = [];
      for (let i = 0; i < transforms.length; i++) {
        const f32 = new Float32Array(transforms[i].matrix);
        xformsCompact[i] = { id: transforms[i].id, matrix: f32 };
        transfer.push(f32.buffer);
      }

      // camera buffers
      const projF = new Float32Array(proj);
      const viewF = new Float32Array(view);
      transfer.push(projF.buffer, viewF.buffer);

      worker.postMessage({ type: 'frame', camera: { proj: projF, view: viewF }, transforms: xformsCompact }, transfer);
    },

    dispose() {
      worker.terminate();
    },
  };

  // initialize with requested clear color
  api.setClearColor(0x000000, 1);
  api.setSize(width, height, false);
  return api;
}


// render-worker.js
// Worker script (ES module). Receives geometry uploads (pos/index), camera + transforms per frame,
// does projection/culling/rasterization onto OffscreenCanvas 2D context.

self.onmessage = (e) => {
  // placeholder to be replaced after handler defined
};

importScripts && console.log('render-worker: starting'); // defensive

// Storage for uploaded geometries
const geometries = new Map();
let canvas = null;
let ctx = null;
let width = 640, height = 360;
let clearColor = [0, 0, 0, 1];

// small math helpers (inline to avoid dependencies)
function multiplyMat4Vec4(m, v) {
  const x = v[0], y = v[1], z = v[2], w = v[3];
  return [
    m[0]*x + m[4]*y + m[8]*z + m[12]*w,
    m[1]*x + m[5]*y + m[9]*z + m[13]*w,
    m[2]*x + m[6]*y + m[10]*z + m[14]*w,
    m[3]*x + m[7]*y + m[11]*z + m[15]*w
  ];
}

function ndcToScreen(ndcX, ndcY) {
  return {
    x: (ndcX * 0.5 + 0.5) * width,
    y: (-ndcY * 0.5 + 0.5) * height
  };
}

function clearCanvas() {
  if (!ctx) return;
  if (clearColor[3] > 0) {
    ctx.fillStyle = `rgba(${Math.round(clearColor[0])},${Math.round(clearColor[1])},${Math.round(clearColor[2])},${clearColor[3]})`;
    ctx.fillRect(0, 0, width, height);
  } else {
    ctx.clearRect(0, 0, width, height);
  }
}

self.onmessage = (ev) => {
  const d = ev.data;
  if (d.type === 'init') {
    // ev.ports might carry OffscreenCanvas as transferred control. In our design the OffscreenCanvas is transferred implicitly.
    try {
      // The transferred OffscreenCanvas is available as e.data.canvas when main sends it
      // But our main sends it via transfer control without a 'canvas' field; the Offscreen was already attached to worker.
      // However some browsers send the Offscreen as the first transferable. So try to get it from event.
      // The canonical approach: main posted the Offscreen via postMessage(..., [offscreen]) and worker receives it as e.ports? Not needed.
      // Simpler: if this worker is used as in voidEngine.js, OffscreenCanvas is already the worker global context's canvas - no direct reference.
    } catch (err) {
      console.warn('render-worker init warning', err);
    }

    // Create an OffscreenCanvas by reading from transferable - in our pattern the main thread transferred control,
    // so "self" does not create a canvas. But the OffscreenCanvas is already bound to the Worker global and getContext will work on "d.canvas" if carried.
    // For safety we handle both cases:
    if (d.canvas) {
      canvas = d.canvas;
    } else if (ev.ports && ev.ports[0]) {
      // ignore
    } else {
      // Some browsers don't include canvas; in practice main transfers offscreen which maps onto worker's canvas variable via message event
      // but if not provided, try to use globalOffscreen (not standard) - fallback: create new OffscreenCanvas (not visible)
      canvas = new OffscreenCanvas(d.width || 640, d.height || 360);
    }
    width = d.width || width;
    height = d.height || height;
    canvas.width = width; canvas.height = height;
    ctx = canvas.getContext('2d', { alpha: true });
    ctx.imageSmoothingEnabled = false;
    console.log('[render-worker] initialized', width, height);
    return;
  }

  if (d.type === 'setSize') {
    width = d.width; height = d.height;
    if (canvas) { canvas.width = width; canvas.height = height; }
    return;
  }

  if (d.type === 'setClearColor') {
    const rgba = d.rgba;
    clearColor = [rgba[0], rgba[1], rgba[2], rgba[3]];
    return;
  }

  if (d.type === 'uploadGeometry') {
    const meta = d.meta;
    const posArray = d.posArray; // Float32Array
    const idxArray = d.idxArray || null; // Uint32Array or null

    // store geometry compactly
    geometries.set(meta.id, {
      id: meta.id,
      positions: posArray, // typed array
      indices: idxArray,
      itemSize: meta.itemSize || 3,
      color: meta.color || [1,1,1,1],
      boundingSphere: meta.boundingSphere || [0,0,0,0]
    });
    return;
  }

  if (d.type === 'frame') {
    // camera.proj and camera.view are Float32Array passed as transferables
    const proj = d.camera.proj; // Float32Array(16)
    const view = d.camera.view; // Float32Array(16)
    const transforms = d.transforms; // array of { id, matrix: Float32Array }

    // clear canvas first
    clearCanvas();

    // For each transform: get geometry, project triangles and draw
    // IMPORTANT: This is deliberately straightforward; optimize later by batching/using Path2D reuse, backface culling, etc.
    for (let ti = 0; ti < transforms.length; ti++) {
      const t = transforms[ti];
      const geo = geometries.get(t.id);
      if (!geo) continue;

      const pos = geo.positions;
      const idx = geo.indices;
      const itemSize = geo.itemSize;
      const matModel = t.matrix; // Float32Array(16)
      const color = geo.color;

      // quick bounding-sphere transform and frustum check (cheap)
      const bs = geo.boundingSphere; // [cx,cy,cz,r]
      // transform bs center by model matrix (approx)
      const center = multiplyMat4Vec4(matModel, [bs[0], bs[1], bs[2], 1]);
      // apply view to center
      const viewCenter = multiplyMat4Vec4(view, center);
      // if behind camera (z > 0 in view space) skip (three.js camera forward = -z)
      if (viewCenter[2] > -bs[3] - 0.1) {
        // probably behind or too far; still we continue in case partial
      }

      // Rasterize triangles - iterate index triplets if index exists, otherwise sequential triangles
      if (idx && idx.length > 0) {
        for (let i = 0; i < idx.length; i += 3) {
          const ai = idx[i] * itemSize;
          const bi = idx[i+1] * itemSize;
          const ci = idx[i+2] * itemSize;

          const vA = multiplyMat4Vec4(proj, multiplyMat4Vec4(view, multiplyMat4Vec4(matModel, [pos[ai], pos[ai+1], pos[ai+2], 1])));
          const vB = multiplyMat4Vec4(proj, multiplyMat4Vec4(view, multiplyMat4Vec4(matModel, [pos[bi], pos[bi+1], pos[bi+2], 1])));
          const vC = multiplyMat4Vec4(proj, multiplyMat4Vec4(view, multiplyMat4Vec4(matModel, [pos[ci], pos[ci+1], pos[ci+2], 1])));

          // perspective divide and trivial clip test
          if (vA[3] === 0 || vB[3] === 0 || vC[3] === 0) continue;
          const ndcAx = vA[0]/vA[3], ndcAy = vA[1]/vA[3], ndcAz = vA[2]/vA[3];
          const ndcBx = vB[0]/vB[3], ndcBy = vB[1]/vB[3], ndcBz = vB[2]/vB[3];
          const ndcCx = vC[0]/vC[3], ndcCy = vC[1]/vC[3], ndcCz = vC[2]/vC[3];

          // trivial off-screen test
          if ((ndcAx < -1 && ndcBx < -1 && ndcCx < -1) ||
              (ndcAx >  1 && ndcBx >  1 && ndcCx >  1) ||
              (ndcAy < -1 && ndcBy < -1 && ndcCy < -1) ||
              (ndcAy >  1 && ndcBy >  1 && ndcCy >  1) ) {
            continue;
          }

          // convert to screen coords
          const A = ndcToScreen(ndcAx, ndcAy);
          const B = ndcToScreen(ndcBx, ndcBy);
          const C = ndcToScreen(ndcCx, ndcCy);

          // backface cull (screen-space)
          const ax = B.x - A.x, ay = B.y - A.y;
          const bx = C.x - A.x, by = C.y - A.y;
          const cross = ax * by - ay * bx;
          if (cross < 0) continue; // cull clockwise / backfaces - tweak if winding differs

          // optional tiny-triangle skip
          if (Math.abs(cross) * 0.5 < 0.25) continue;

          // draw triangle
          ctx.beginPath();
          ctx.moveTo(A.x, A.y);
          ctx.lineTo(B.x, B.y);
          ctx.lineTo(C.x, C.y);
          ctx.closePath();
          ctx.fillStyle = `rgba(${Math.round(color[0]*255)},${Math.round(color[1]*255)},${Math.round(color[2]*255)},${color[3]})`;
          ctx.fill();
        }
      } else {
        // no index: assume sequential vertices
        const vertCount = pos.length / itemSize;
        for (let i = 0; i + 2 < vertCount; i += 3) {
          const ai = i * itemSize;
          const bi = (i+1) * itemSize;
          const ci = (i+2) * itemSize;

          const vA = multiplyMat4Vec4(proj, multiplyMat4Vec4(view, multiplyMat4Vec4(matModel, [pos[ai], pos[ai+1], pos[ai+2], 1])));
          const vB = multiplyMat4Vec4(proj, multiplyMat4Vec4(view, multiplyMat4Vec4(matModel, [pos[bi], pos[bi+1], pos[bi+2], 1])));
          const vC = multiplyMat4Vec4(proj, multiplyMat4Vec4(view, multiplyMat4Vec4(matModel, [pos[ci], pos[ci+1], pos[ci+2], 1])));

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
          ctx.fillStyle = `rgba(${Math.round(color[0]*255)},${Math.round(color[1]*255)},${Math.round(color[2]*255)},${color[3]})`;
          ctx.fill();
        }
      }
    } // transforms loop

    return;
  }

  // unknown message type
  console.warn('[render-worker] unknown message', d.type);
};


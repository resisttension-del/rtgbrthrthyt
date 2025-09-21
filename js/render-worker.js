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

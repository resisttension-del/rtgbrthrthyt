// raster-worker.js
self.onmessage = handleMsg;

let canvas = null;
let ctx = null;
let width = 0, height = 0;
let zBuffer = null;      // Float32Array
let pixelBuf = null;     // Uint8ClampedArray (ImageData.data)
let imageData = null;
let sceneMeshes = [];    // [{positions:Float32Array, indices:Uint32Array, color:[r,g,b], id, ...}]

function handleMsg(e) {
  const msg = e.data;
  if (msg.type === 'init') {
    canvas = msg.canvas;
    width = msg.width;
    height = msg.height;
    canvas.width = width;
    canvas.height = height;
    ctx = canvas.getContext('2d');
    initBuffers(width, height);
  } else if (msg.type === 'uploadMesh') {
    // positions: Float32Array [x,y,z,x,y,z...], indices: Uint32Array [i0,i1,i2...]
    // ownership: these are cloned by postMessage; can be transferred if you choose
    sceneMeshes.push({
      id: msg.id,
      positions: msg.positions,
      indices: msg.indices,
      color: msg.color || [200,200,200],
      dynamic: msg.dynamic || false
    });
  } else if (msg.type === 'frame') {
    // camera: {projMatrix:Float32Array(16), viewMatrix:Float32Array(16)}
    // transforms: [{id, modelMatrix:Float32Array(16)}...]
    renderFrame(msg.camera, msg.transforms);
  } else if (msg.type === 'resize') {
    width = msg.width; height = msg.height;
    canvas.width = width; canvas.height = height;
    initBuffers(width, height);
  } else if (msg.type === 'clearScene') {
    sceneMeshes.length = 0;
  }
}

function initBuffers(w,h) {
  zBuffer = new Float32Array(w * h);
  imageData = new ImageData(w, h);
  pixelBuf = imageData.data; // Uint8ClampedArray
  // clear
  for (let i = 0; i < pixelBuf.length; i += 4) {
    pixelBuf[i] = 0; pixelBuf[i+1] = 0; pixelBuf[i+2] = 0; pixelBuf[i+3] = 255;
  }
  for (let i = 0; i < zBuffer.length; i++) zBuffer[i] = Infinity;
}

// small helpers: matrix (Float32Array length 16) multiply 4x4 * vec3 (homogeneous)
function transformVec3(mat, vx, vy, vz, out) {
  const x = mat[0]*vx + mat[4]*vy + mat[8]*vz + mat[12];
  const y = mat[1]*vx + mat[5]*vy + mat[9]*vz + mat[13];
  const z = mat[2]*vx + mat[6]*vy + mat[10]*vz + mat[14];
  const w = mat[3]*vx + mat[7]*vy + mat[11]*vz + mat[15];
  out[0] = x / w; out[1] = y / w; out[2] = z / w; out[3] = w;
}

// project NDC -> screen coords
function ndcToScreen(ndcX, ndcY) {
  return [(ndcX * 0.5 + 0.5) * width, (-ndcY * 0.5 + 0.5) * height];
}

// The renderer: we'll build a combined viewProj matrix = proj * view
function renderFrame(camera, transforms) {
  if (!ctx) return;
  // build viewProj matrix (camera.proj * camera.view) (both 4x4 Float32Array)
  const proj = camera.proj; // Float32Array(16)
  const view = camera.view; // Float32Array(16)
  const viewProj = new Float32Array(16);
  // multiply proj * view (col-major assumed like three.js matrices)
  multiplyMat4(proj, view, viewProj);

  // map transforms by id for quick lookup
  const transformMap = new Map();
  for (let t of transforms) transformMap.set(t.id, t.model);

  // clear buffers
  const clearColor = camera.clearColor || [0,0,0];
  for (let i = 0, p=0; i < width*height; i++, p+=4) {
    pixelBuf[p] = clearColor[0];
    pixelBuf[p+1] = clearColor[1];
    pixelBuf[p+2] = clearColor[2];
    pixelBuf[p+3] = 255;
    zBuffer[i] = Infinity;
  }

  // For each mesh, transform vertices, project, cull backfaces, rasterize triangles
  const vWorld = [0,0,0,0]; // temp
  const vClip = [0,0,0,0];
  const p0 = {}, p1 = {}, p2 = {};
  for (let mesh of sceneMeshes) {
    const pos = mesh.positions;
    const idx = mesh.indices;
    const color = mesh.color;
    // if dynamic model transform provided, use it; otherwise identity
    const model = transformMap.get(mesh.id) || identityMat4();

    // build modelViewProj = viewProj * model
    const mvp = new Float32Array(16);
    multiplyMat4(viewProj, model, mvp);

    // project all vertices into clip space then NDC and screen
    const vertCount = pos.length / 3;
    const sx = new Float32Array(vertCount);
    const sy = new Float32Array(vertCount);
    const sz = new Float32Array(vertCount);
    for (let vi = 0; vi < vertCount; ++vi) {
      const vx = pos[vi*3], vy = pos[vi*3+1], vz = pos[vi*3+2];
      transformVec3(mvp, vx, vy, vz, vClip);
      // vClip is NDC already because transformVec3 divided by w
      const scr = ndcToScreen(vClip[0], vClip[1]);
      sx[vi] = scr[0];
      sy[vi] = scr[1];
      sz[vi] = vClip[2]; // z in NDC -1..1
    }

    // iterate triangles
    for (let t = 0; t < idx.length; t += 3) {
      const i0 = idx[t], i1 = idx[t+1], i2 = idx[t+2];
      const x0 = sx[i0], y0 = sy[i0], z0 = sz[i0];
      const x1 = sx[i1], y1 = sy[i1], z1 = sz[i1];
      const x2 = sx[i2], y2 = sy[i2], z2 = sz[i2];

      // trivial screen bbox cull
      const minX = Math.max(0, Math.floor(Math.min(x0,x1,x2)));
      const maxX = Math.min(width-1, Math.ceil(Math.max(x0,x1,x2)));
      const minY = Math.max(0, Math.floor(Math.min(y0,y1,y2)));
      const maxY = Math.min(height-1, Math.ceil(Math.max(y0,y1,y2)));
      if (maxX < 0 || maxY < 0 || minX >= width || minY >= height) continue;

      // backface cull in screen-space
      const ux = x1 - x0, uy = y1 - y0;
      const vx = x2 - x0, vy = y2 - y0;
      const cross = ux*vy - uy*vx;
      if (cross >= 0) continue; // winding can be flipped depending on culling

      // Precompute edge functions constants for barycentric
      const area = edgeFunc(x0,y0,x1,y1,x2,y2);
      if (Math.abs(area) < 1e-6) continue;

      // Loop over pixels in bbox (simple scan)
      for (let py = minY; py <= maxY; ++py) {
        let rowBase = py * width;
        for (let px = minX; px <= maxX; ++px) {
          // pixel center
          const cx = px + 0.5, cy = py + 0.5;
          const w0 = edgeFunc(x1,y1,x2,y2,cx,cy);
          const w1 = edgeFunc(x2,y2,x0,y0,cx,cy);
          const w2 = edgeFunc(x0,y0,x1,y1,cx,cy);
          if ((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0)) {
            // barycentric coords
            const b0 = w0 / area;
            const b1 = w1 / area;
            const b2 = w2 / area;
            // interpolated depth (NDC z)
            const zInterp = b0*z0 + b1*z1 + b2*z2;
            // map NDC z (-1..1) to positive depth for zBuffer compare
            const depth = (zInterp + 1) * 0.5;
            const idxBuf = rowBase + px;
            if (depth < zBuffer[idxBuf]) {
              // write pixel
              const p = idxBuf * 4;
              pixelBuf[p] = color[0];     // r
              pixelBuf[p+1] = color[1];   // g
              pixelBuf[p+2] = color[2];   // b
              pixelBuf[p+3] = 255;
              zBuffer[idxBuf] = depth;
            }
          }
        }
      }
    }
  }

  // push to canvas
  ctx.putImageData(imageData, 0, 0);
}

// small helpers
function edgeFunc(ax,ay,bx,by, cx,cy) {
  return (cx - ax) * (by - ay) - (cy - ay) * (bx - ax);
}

function multiplyMat4(a,b,out) {
  // column-major mat4 multiply (out = a * b)
  for (let i = 0; i < 4; ++i) {
    const ai0 = a[i], ai1 = a[i+4], ai2 = a[i+8], ai3 = a[i+12];
    out[i]   = ai0*b[0] + ai1*b[1] + ai2*b[2] + ai3*b[3];
    out[i+4] = ai0*b[4] + ai1*b[5] + ai2*b[6] + ai3*b[7];
    out[i+8] = ai0*b[8] + ai1*b[9] + ai2*b[10] + ai3*b[11];
    out[i+12]= ai0*b[12]+ ai1*b[13]+ ai2*b[14]+ ai3*b[15];
  }
  return out;
}

function identityMat4() {
  const I = new Float32Array(16);
  I[0]=1; I[5]=1; I[10]=1; I[15]=1;
  return I;
}

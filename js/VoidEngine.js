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

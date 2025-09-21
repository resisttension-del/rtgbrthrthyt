import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";

export function voidEngineGPU({ width = 640, height = 360, options = {} } = {}) {
  // options: { antialias, alpha, powerPreference, preserveDrawingBuffer, webgl2 }
  const opt = Object.assign({
    antialias: false,
    alpha: true,
    powerPreference: "high-performance", // "default" | "low-power"
    preserveDrawingBuffer: false,
    // If you want WebGL2, three will try to get it automatically.
  }, options);

  // create canvas and WebGL renderer
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.style.display = "block";
  canvas.style.imageRendering = "pixelated"; // keep your pixel look if desired

  // Create renderer once and reuse it
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: opt.antialias,
    alpha: opt.alpha,
    powerPreference: opt.powerPreference,
    preserveDrawingBuffer: opt.preserveDrawingBuffer,
  });

  // Important defaults for low CPU usage:
  // - don't call renderLists.dispose() each frame (three manages this)
  // - avoid readPixels or heavy CPU readbacks
  renderer.autoClear = true;
  renderer.sortObjects = true; // keep ability to sort for transparency (cheap)
  renderer.setSize(width, height, false); // false -> do not update canvas CSS style
  renderer.setPixelRatio(1); // control DPR explicitly for performance
  renderer.shadowMap.enabled = false; // off by default; turn on only if needed

  let clearColor = new THREE.Color(0x000000);
  let clearAlpha = 1;

  // API similar to your previous engine
  const api = {
    domElement: canvas,
    setSize(w, h, updateStyle = true) {
      canvas.width = w;
      canvas.height = h;
      if (updateStyle) {
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      renderer.setSize(w, h, false);
    },

    setClearColor(hex = 0x000000, alpha = 1) {
      clearColor.set(hex);
      clearAlpha = alpha;
      renderer.setClearColor(clearColor, clearAlpha);
    },

    // render is synchronous (unlike the ImageBitmap path). It pushes work to GPU; CPU cost is minimal.
    render(scene, camera) {
      if (!scene || !camera) return;

      // Ensure transforms updated (this is cheap — three.js already does the matrix math cheaply)
      scene.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);

      // Optional: you can perform cheap CPU culling / LOD adjustments here to reduce GPU workload.
      // But avoid expensive per-triangle work. Let three.js do frustum culling and upload only buffers that changed.

      // If you have dynamic object transforms, avoid creating new geometries each frame; reuse BufferGeometry.
      // Use Mesh.frustumCulled = true (default) so three.js skips off-screen draws.

      renderer.render(scene, camera);
      // no heavy CPU post-processing required — GPU handles rasterization, interpolation, blending.
    },

    // optional: allow access to underlying renderer if the user wants advanced control
    _threeRenderer: renderer,

    dispose() {
      // Free GPU resources if needed
      try {
        renderer.dispose();
      } catch (e) { /* ignore */ }
    }
  };

  api.setClearColor(0x000000, 1);
  return api;
}

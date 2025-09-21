import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";

export function voidEngine({ width = 640, height = 360, antialias = true, alpha = true, preserveDrawingBuffer = false } = {}) {
  // visible 2D canvas
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.style.display = "block";
  canvas.style.imageRendering = "pixelated";
  const ctx = canvas.getContext("2d", { alpha: true });

  // WebGL renderer (GPU)
  const glCanvas = document.createElement("canvas");
  glCanvas.width = width;
  glCanvas.height = height;
  const glRenderer = new THREE.WebGLRenderer({
    canvas: glCanvas,
    antialias,
    alpha,
    preserveDrawingBuffer,
  });
  glRenderer.setSize(width, height, false);
  glRenderer.autoClear = true; // clear each frame

  // GPU scene and orthographic camera (we'll render with user's camera)
  const gpuScene = new THREE.Scene();

  // Pools to mirror original scene objects in gpuScene without reallocation
  const meshPool = new Map();      // originalObject.uuid -> {mesh, lastSeenFrame}
  const spritePool = new Map();    // originalObject.uuid -> {sprite, lastSeenFrame}
  const materialPool = new Map();  // originalMaterial.uuid -> clonedMaterial

  let frameCounter = 0;

  // clear color stored as rgba obj for 2D canvas background if needed
  let clearColor = { r: 0, g: 0, b: 0, a: 1 };
  let glClearColorHex = 0x000000;
  let glClearAlpha = 0;

  // Helpers
  function hexToRgba(hex, alpha = 1) {
    const r = (hex >> 16) & 255;
    const g = (hex >> 8) & 255;
    const b = hex & 255;
    return { r, g, b, a: alpha };
  }
  function rgbaToCss({ r, g, b, a }) {
    return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;
  }

  // Clone/normalize a material for GPU mirror (done once per original material)
  function ensureClonedMaterial(origMat) {
    if (!origMat) return new THREE.MeshBasicMaterial({ color: 0xffffff });
    const id = origMat.uuid || origMat.id;
    if (materialPool.has(id)) return materialPool.get(id);

    // clone relevant properties we care about: color, map, opacity, transparent, side
    // cloning ensures we can tweak depthWrite/blend independently
    const m = origMat.clone ? origMat.clone() : new THREE.MeshBasicMaterial();
    // keep vertexColors if present
    if (origMat.vertexColors !== undefined) m.vertexColors = origMat.vertexColors;
    if (origMat.map) m.map = origMat.map;
    if (origMat.color && origMat.color.isColor) m.color = origMat.color.clone();

    m.transparent = origMat.transparent === true || (origMat.opacity !== undefined && origMat.opacity < 1);
    m.opacity = origMat.opacity !== undefined ? origMat.opacity : 1.0;
    // ensure depthWrite is correct for transparent objects
    if (m.transparent) {
      m.depthWrite = false;
      // keep default blending (NormalBlending) unless original was different
      m.blending = origMat.blending !== undefined ? origMat.blending : THREE.NormalBlending;
    } else {
      m.depthWrite = true;
      m.blending = THREE.NoBlending;
    }
    // set side to original side or double-side for safety
    m.side = origMat.side !== undefined ? origMat.side : THREE.DoubleSide;

    materialPool.set(id, m);
    return m;
  }

  // Create or reuse a GPU mesh for an original mesh object
  function getGpuMeshFor(original) {
    const id = original.uuid;
    let entry = meshPool.get(id);
    if (entry) {
      entry.lastSeenFrame = frameCounter;
      // update transform & visibility
      entry.mesh.matrix.copy(original.matrixWorld);
      entry.mesh.matrixAutoUpdate = false;
      entry.mesh.visible = original.visible;
      // update frustum culling flag
      entry.mesh.frustumCulled = original.frustumCulled !== undefined ? original.frustumCulled : true;
      // ensure geometry same reference
      if (entry.mesh.geometry !== original.geometry) {
        entry.mesh.geometry = original.geometry;
      }
      // sync material (clone on first use)
      const cm = ensureClonedMaterial(original.material);
      if (entry.mesh.material !== cm) entry.mesh.material = cm;
      return entry.mesh;
    }

    // create new mirror mesh (one-time)
    const geometry = original.geometry || new THREE.BufferGeometry();
    const material = ensureClonedMaterial(original.material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(original.matrixWorld);
    mesh.visible = original.visible;
    mesh.frustumCulled = original.frustumCulled !== undefined ? original.frustumCulled : true;
    // default: let GPU handle culling/depth/blend
    meshPool.set(id, { mesh, lastSeenFrame: frameCounter });
    gpuScene.add(mesh);
    return mesh;
  }

  // Create or reuse a GPU sprite for an original sprite object
  function getGpuSpriteFor(original) {
    const id = original.uuid;
    let entry = spritePool.get(id);
    if (entry) {
      entry.lastSeenFrame = frameCounter;
      entry.sprite.matrix.copy(original.matrixWorld);
      entry.sprite.matrixAutoUpdate = false;
      entry.sprite.visible = original.visible;
      return entry.sprite;
    }

    // create sprite material (reusing texture reference)
    const mat = new THREE.SpriteMaterial({
      map: (original.material && original.material.map) ? original.material.map : null,
      color: (original.material && original.material.color && original.material.color.isColor) ? original.material.color.clone() : new THREE.Color(0xffffff),
      opacity: (original.material && original.material.opacity !== undefined) ? original.material.opacity : 1,
      transparent: (original.material && original.material.transparent) || false,
      depthWrite: !(original.material && original.material.transparent),
    });
    const sprite = new THREE.Sprite(mat);
    sprite.matrixAutoUpdate = false;
    sprite.matrix.copy(original.matrixWorld);
    sprite.visible = original.visible;
    spritePool.set(id, { sprite, lastSeenFrame: frameCounter });
    gpuScene.add(sprite);
    return sprite;
  }

  // Remove stale entries (clean mesh/sprite clones that are no longer in the user scene)
  function cleanupPools() {
    const cutoff = frameCounter - 2; // if not seen for 2 frames, remove
    for (const [id, entry] of meshPool.entries()) {
      if (entry.lastSeenFrame < cutoff) {
        gpuScene.remove(entry.mesh);
        // dispose material/geometry references only if we cloned them here (we cloned materials into materialPool)
        // do not dispose geometries owned by the user's scene
        meshPool.delete(id);
      }
    }
    for (const [id, entry] of spritePool.entries()) {
      if (entry.lastSeenFrame < cutoff) {
        gpuScene.remove(entry.sprite);
        if (entry.sprite.material) entry.sprite.material.dispose();
        spritePool.delete(id);
      }
    }
    // Optionally keep materials in materialPool for reuse (faster). If you want to free them, dispose here.
  }

  // Public API
  const api = {
    domElement: canvas,

    setSize(w, h, updateStyle = true) {
      canvas.width = w;
      canvas.height = h;
      glCanvas.width = w;
      glCanvas.height = h;
      glRenderer.setSize(w, h, false);
      if (updateStyle) {
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
    },

    setClearColor(hex = 0x000000, alpha = 0) {
      const rgba = hexToRgba(hex, alpha);
      clearColor = rgba;
      glClearColorHex = hex;
      glClearAlpha = alpha;
      glRenderer.setClearColor(hex, alpha);
    },

    // The main render: minimal CPU, maximum GPU work
    render(scene, camera) {
      if (!scene || !camera) return;
      frameCounter++;

      // Minimal CPU ops: update matrices and traverse visible objects
      // (no per-vertex projection, no CPU rasterization)
      scene.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);

      // For each visible object in user's scene, ensure we have a GPU mirror and update transform
      scene.traverseVisible((object) => {
        // Only mirror Mesh and Sprite types (you can extend to Points/Line if needed)
        if (object.isMesh && object.visible && object.geometry) {
          // skip extremely tiny meshes optionally? leave to GPU
          const mesh = getGpuMeshFor(object);
          // If material opacity changed at runtime, sync alpha and depthWrite/blending
          const origMat = object.material;
          if (origMat) {
            const cm = mesh.material;
            // update only if values differ (cheap compares)
            if (cm.opacity !== (origMat.opacity !== undefined ? origMat.opacity : 1)) {
              cm.opacity = origMat.opacity !== undefined ? origMat.opacity : 1;
              cm.transparent = cm.opacity < 1 || !!origMat.transparent;
              cm.depthWrite = !cm.transparent;
              cm.needsUpdate = true;
            }
            // update map reference if changed
            if (origMat.map && cm.map !== origMat.map) {
              cm.map = origMat.map;
              cm.needsUpdate = true;
            }
          }
        } else if (object.isSprite && object.visible) {
          getGpuSpriteFor(object);
        } else {
          // we don't mirror lights, cameras, helpers, etc.
        }
      });

      // Clean stale mirrors (objects removed from user's scene)
      cleanupPools();

      // Let the GPU do the heavy raster work
      glRenderer.setSize(canvas.width, canvas.height, false);
      glRenderer.render(gpuScene, camera);

      // Copy GL canvas into 2D canvas (so existing 2D overlays still work)
      // We clear the 2D canvas with user clearColor first (preserve their API expectations)
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (clearColor.a > 0) {
        ctx.fillStyle = rgbaToCss(clearColor);
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(glCanvas, 0, 0, canvas.width, canvas.height);
    },

    dispose() {
      // remove all mirrors and dispose clones we created
      for (const [, entry] of meshPool) {
        gpuScene.remove(entry.mesh);
        if (entry.mesh.material) entry.mesh.material.dispose();
        // do not dispose geometries from user's scene
      }
      meshPool.clear();
      for (const [, entry] of spritePool) {
        gpuScene.remove(entry.sprite);
        if (entry.sprite.material) entry.sprite.material.dispose();
      }
      spritePool.clear();
      for (const [, mat] of materialPool) {
        mat.dispose();
      }
      materialPool.clear();
      glRenderer.dispose();
      gpuScene.clear();
    },
  };

  // initial defaults
  api.setSize(width, height, false);
  api.setClearColor(0x000000, 0);

  return api;
}

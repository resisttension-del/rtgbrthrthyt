import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";

/**
 * Hybrid Unity-like voidEngine
 * - CPU: scene traversal, near-plane clipping, per-vertex lighting, batching, instancing prep
 * - GPU: rasterization (WebGL) via three.js (MeshBasicMaterial with vertexColors)
 *
 * Tuning:
 * - engine.setCpuTargetMs(ms)  // raise to force more CPU work (push toward 90%)
 * - engine.setResolutionScale(s) // 0.1..1 to scale GL raster resolution (GPU load)
 */
export function voidEngine({ width = 640, height = 360, mode = "painter" } = {}) {
  // --- Visible 2D canvas (unchanged API) ---
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  canvas.style.display = "block";
  canvas.style.imageRendering = "pixelated";
  const ctx = canvas.getContext("2d", { alpha: true });

  // --- Offscreen GL canvas + three renderer for rasterization ---
  const glCanvas = document.createElement("canvas");
  glCanvas.width = width; glCanvas.height = height;
  const glRenderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: false, alpha: true, preserveDrawingBuffer: false });
  glRenderer.setClearColor(0x000000, 0);
  glRenderer.setSize(width, height, false);

  const gpuScene = new THREE.Scene(); // holds GPU-side meshes we upload each frame
  const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);

  // --- Engine tuning state ---
  let clearColor = { r: 0, g: 0, b: 0, a: 1 };
  let resolutionScale = 1.0; // GL internal scale (0.5 reduces GPU load)
  let cpuTargetMs = 12.0; // target ms to spend preparing buffers (raise to increase CPU load)
  let maxTessLevel = 0; // reserved for future tessellation hooks
  let useWorker = false; // placeholder (you can move preprocessing to a worker)

  // --- scratch temporary vectors used in loops to reduce allocs ---
  const tmpVecA = new THREE.Vector3();
  const tmpVecB = new THREE.Vector3();
  const tmpVecC = new THREE.Vector3();
  const camInv = new THREE.Matrix4();

  // --- small helpers (from your original) ---
  function hexToRgba(hex, alpha = 1) {
    const r = (hex >> 16) & 255; const g = (hex >> 8) & 255; const b = hex & 255;
    return { r, g, b, a: alpha };
  }
  function rgbaToCss({ r, g, b, a }) {
    return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;
  }
  function lerpVec(out, a, b, t) {
    out.x = a.x + (b.x - a.x) * t;
    out.y = a.y + (b.y - a.y) * t;
    out.z = a.z + (b.z - a.z) * t;
    return out;
  }
  function clipPolygonAgainstNear(inWorld, inCam, near) {
    if (inWorld.length !== inCam.length) return [];
    let outWorld = [], outCam = [];
    function isInside(camV) { return camV.z <= -near; }
    const n = inWorld.length;
    for (let i = 0; i < n; i++) {
      const aW = inWorld[i], aC = inCam[i];
      const j = (i + 1) % n;
      const bW = inWorld[j], bC = inCam[j];
      const aIn = isInside(aC), bIn = isInside(bC);
      if (aIn && bIn) {
        outWorld.push(bW.clone()); outCam.push(bC.clone());
      } else if (aIn && !bIn) {
        const t = (-near - aC.z) / (bC.z - aC.z); const tt = Math.max(0, Math.min(1, t));
        const iW = new THREE.Vector3(), iC = new THREE.Vector3();
        lerpVec(iW, aW, bW, tt); lerpVec(iC, aC, bC, tt);
        outWorld.push(iW); outCam.push(iC);
      } else if (!aIn && bIn) {
        const t = (-near - aC.z) / (bC.z - aC.z); const tt = Math.max(0, Math.min(1, t));
        const iW = new THREE.Vector3(), iC = new THREE.Vector3();
        lerpVec(iW, aW, bW, tt); lerpVec(iC, aC, bC, tt);
        outWorld.push(iW); outCam.push(iC);
        outWorld.push(bW.clone()); outCam.push(bC.clone());
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

  // --- Lighting: small CPU model used to compute per-vertex colors ---
  // We'll build a tiny light cache from scene lights each frame.
  const lightCache = [];
  function buildLightCache(scene) {
    lightCache.length = 0;
    scene.traverseVisible((o) => {
      if (!o.isLight) return;
      if (o.isAmbientLight) {
        lightCache.push({ type: "ambient", intensity: o.intensity, color: o.color ? o.color.clone() : new THREE.Color(0xffffff) });
      } else if (o.isDirectionalLight) {
        // direction from light position to target in world space
        const pos = new THREE.Vector3(); o.getWorldPosition(pos);
        const tgt = new THREE.Vector3(); if (o.target) o.target.getWorldPosition(tgt); else tgt.set(0,0,0);
        const dir = tmpVecA.copy(tgt).sub(pos).normalize();
        lightCache.push({ type: "dir", dir: dir.clone(), intensity: o.intensity, color: o.color ? o.color.clone() : new THREE.Color(0xffffff) });
      } else if (o.isPointLight) {
        const pos = new THREE.Vector3(); o.getWorldPosition(pos);
        lightCache.push({ type: "point", pos: pos.clone(), intensity: o.intensity, decay: o.decay !== undefined ? o.decay : 1.0, color: o.color ? o.color.clone() : new THREE.Color(0xffffff) });
      }
    });
    // ensure a tiny ambient so nothing is completely black
    if (!lightCache.some(L => L.type === "ambient")) lightCache.push({ type: "ambient", intensity: 0.06, color: new THREE.Color(0xffffff) });
  }

  function computeLighting(normal, worldPos, baseColor) {
    // simple Lambert + ambient; return RGB triple multiplied into baseColor
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < lightCache.length; i++) {
      const L = lightCache[i];
      if (L.type === "ambient") {
        r += L.intensity * L.color.r;
        g += L.intensity * L.color.g;
        b += L.intensity * L.color.b;
      } else if (L.type === "dir") {
        const d = Math.max(0, normal.dot(L.dir));
        r += d * L.intensity * L.color.r;
        g += d * L.intensity * L.color.g;
        b += d * L.intensity * L.color.b;
      } else if (L.type === "point") {
        const dir = tmpVecB.copy(L.pos).sub(worldPos);
        const dist = dir.length();
        dir.normalize();
        const d = Math.max(0, normal.dot(dir));
        const attenuation = 1.0 / (1.0 + L.decay * dist * dist);
        r += d * L.intensity * attenuation * L.color.r;
        g += d * L.intensity * attenuation * L.color.g;
        b += d * L.intensity * attenuation * L.color.b;
      }
    }
    // multiply by baseColor (r,g,b in 0..1)
    return {
      r: Math.min(1, baseColor.r * (r + 0.125)), // small baseline
      g: Math.min(1, baseColor.g * (g + 0.125)),
      b: Math.min(1, baseColor.b * (b + 0.125))
    };
  }

  // --- batching & instancing helpers ---
  // We'll group triangles into buckets keyed by material id + opacity to reduce draw calls.
  // Also detect repeated geometry+material to use InstancedMesh when many instances exist.
  function makeMaterialKey(material) {
    if (!material) return "mat:none:1";
    const col = (material.color && material.color.isColor) ? `${Math.round(material.color.r*255)}_${Math.round(material.color.g*255)}_${Math.round(material.color.b*255)}` : "c:undef";
    const op = material.opacity !== undefined ? material.opacity : 1.0;
    const mapId = (material.map && material.map.uuid) ? material.map.uuid : "nomap";
    return `mat:${col}:op:${op}:map:${mapId}:type:${material.type || "basic"}`;
  }

  // --- GPU pool management (reused geometries / meshes) ---
  const gpuMeshPool = []; // meshes created for last frame; we clear them and dispose next frame
  const instancedPool = new Map(); // key -> InstancedMesh reused across frames if possible

  function clearGpuScene() {
    // remove all non-sprite children from gpuScene and dispose them
    for (let i = gpuScene.children.length - 1; i >= 0; i--) {
      const c = gpuScene.children[i];
      // keep Sprites (if we add), otherwise remove everything
      gpuScene.remove(c);
      if (c.geometry) { c.geometry.dispose(); }
      if (c.material) { c.material.dispose(); }
    }
    gpuMeshPool.length = 0;
    instancedPool.clear();
  }

  // --- ensure GL resolution matches resolutionScale ---
  function setGlSizeFromScale() {
    const sw = Math.max(1, Math.floor(canvas.width * resolutionScale));
    const sh = Math.max(1, Math.floor(canvas.height * resolutionScale));
    if (glCanvas.width !== sw || glCanvas.height !== sh) {
      glCanvas.width = sw; glCanvas.height = sh;
      glRenderer.setSize(sw, sh, false);
    }
  }

  // --- main API object (keeps render behavior similar to your original) ---
  const api = {
    domElement: canvas,

    setSize(w, h, updateStyle = true) {
      canvas.width = w; canvas.height = h;
      if (updateStyle) { canvas.style.width = `${w}px`; canvas.style.height = `${h}px`; }
      setGlSizeFromScale();
    },

    setClearColor(hex = 0x000000, alpha = 1) {
      clearColor = hexToRgba(hex, alpha);
    },

    // tuning: push CPU heavier by increasing cpuTargetMs, or lower resolutionScale to drop GPU
    setCpuTargetMs(ms) { cpuTargetMs = Math.max(1, Number(ms) || cpuTargetMs); },
    setResolutionScale(s) { resolutionScale = Math.max(0.1, Math.min(1, s)); setGlSizeFromScale(); },
    setUseWorker(flag) { useWorker = !!flag; /* worker integration point: move processSceneToBuckets() to worker */ },

    // The render path:
    // 1) traversal & clipping (CPU)
    // 2) per-vertex lighting (CPU)
    // 3) bucket triangles by material and create GPU BufferGeometry per bucket (CPU->GPU upload)
    // 4) GPU rasterization (glRenderer.render)
    // 5) blit GL canvas into 2D ctx and draw sprites
    render(scene, camera) {
      if (!scene || !camera) return;

      // small housekeeping
      scene.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);
      camInv.copy(camera.matrixWorld).invert();

      // clear 2D canvas background (keeps original semantics)
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (clearColor.a > 0) {
        ctx.fillStyle = rgbaToCss(clearColor);
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      // 1) gather lights for CPU lighting
      buildLightCache(scene);

      // 2) traverse meshes and build buckets
      // bucketMap: key -> { positions: [], colors: [], countTriangles: int, isOpaque: bool, materialRef }
      const bucketMap = new Map();
      const instancingCandidates = new Map(); // geom.uuid|matKey -> array of {object, matrixWorld}

      // also collect sprites to draw on 2D ctx later (unchanged behavior)
      const sprites = [];

      // traverseVisible: similar to your original traversal
      scene.traverseVisible((object) => {
        if (object.isMesh && object.visible && object.geometry) {
          object.updateMatrixWorld(true);

          const geom = object.geometry;
          const posAttr = geom.attributes && geom.attributes.position;
          if (!posAttr) return;

          const indexArr = geom.index ? geom.index.array : null;
          const posArray = posAttr.array;
          const itemSize = posAttr.itemSize || 3;
          const count = indexArr ? indexArr.length : posArray.length / itemSize;

          // material color fallback
          let matColor = new THREE.Color(1, 1, 1);
          let opacity = 1;
          if (object.material) {
            const m = object.material;
            if (m.color && m.color.isColor) matColor = m.color.clone();
            opacity = m.opacity !== undefined ? m.opacity : 1;
          }

          const matKey = makeMaterialKey(object.material);
          // consider instancing candidate key
          const instKey = `${geom.uuid}::${matKey}`;

          // We'll attempt instancing only if multiple objects share geom+mat (we count them)
          if (!instancingCandidates.has(instKey)) instancingCandidates.set(instKey, []);
          instancingCandidates.get(instKey).push({object, matrixWorld: object.matrixWorld.clone()});

          // iterate triangles
          for (let i = 0; i < count; i += 3) {
            const ai = indexArr ? indexArr[i] : i;
            const bi = indexArr ? indexArr[i+1] : i+1;
            const ci = indexArr ? indexArr[i+2] : i+2;

            const wA = new THREE.Vector3().fromArray(posArray, ai * itemSize).applyMatrix4(object.matrixWorld);
            const wB = new THREE.Vector3().fromArray(posArray, bi * itemSize).applyMatrix4(object.matrixWorld);
            const wC = new THREE.Vector3().fromArray(posArray, ci * itemSize).applyMatrix4(object.matrixWorld);

            // compute camera-space positions for clipping
            const cA = wA.clone().applyMatrix4(camInv);
            const cB = wB.clone().applyMatrix4(camInv);
            const cC = wC.clone().applyMatrix4(camInv);

            const near = camera.near || 0.001;
            const clipped = clipPolygonAgainstNear([wA, wB, wC], [cA, cB, cC], near);
            if (!clipped || clipped.length === 0) continue;

            // for each resulting triangle, compute per-vertex lighting and push into bucket
            for (let ct = 0; ct < clipped.length; ct++) {
              const triW = clipped[ct]; // [v0,v1,v2] in world space

              // compute normals: try to use geometry normal attribute if present in object-space,
              // otherwise compute face normal from the tri (cheap)
              let nA, nB, nC;
              if (geom.attributes && geom.attributes.normal) {
                // approximate by computing normal from transformed positions (less accurate but ok)
                nA = tmpVecA.subVectors(triW[1], triW[0]).cross(tmpVecB.subVectors(triW[2], triW[0])).normalize();
                nB = nA.clone(); nC = nA.clone();
              } else {
                nA = tmpVecA.subVectors(triW[1], triW[0]).cross(tmpVecB.subVectors(triW[2], triW[0])).normalize();
                nB = nA.clone(); nC = nA.clone();
              }

              // CPU lighting per vertex (this is the CPU work we want)
              const c0 = computeLighting(nA, triW[0], matColor);
              const c1 = computeLighting(nB, triW[1], matColor);
              const c2 = computeLighting(nC, triW[2], matColor);

              // push into bucket
              if (!bucketMap.has(matKey)) {
                bucketMap.set(matKey, { positions: [], colors: [], triCount: 0, materialRef: object.material, opacity });
              }
              const bucket = bucketMap.get(matKey);
              // positions: push three vertices world-space (we'll render with identity matrix)
              bucket.positions.push(triW[0].x, triW[0].y, triW[0].z, triW[1].x, triW[1].y, triW[1].z, triW[2].x, triW[2].y, triW[2].z);
              // colors: per-vertex rgb floats 0..1
              bucket.colors.push(c0.r, c0.g, c0.b, c1.r, c1.g, c1.b, c2.r, c2.g, c2.b);
              bucket.triCount++;
            }
          }
        }

        // sprites: leave to CPU 2D drawing (unchanged)
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
          sprites.push({ x: sx, y: sy, size: sizePx, material: object.material, depth: wp.z });
        }
      }); // traverseVisible

      // 3) Instancing decision: if a geometry+material combination has >1 instance, create InstancedMesh
      // (this reduces CPU→GPU draw calls massively for repeated objects)
      // prepare arrays of instanced keys that have more than one object
      const instancedKeys = [];
      for (const [key, arr] of instancingCandidates.entries()) {
        if (arr.length > 1) instancedKeys.push({ key, arr });
      }

      // 4) Upload buckets to GPU: for each bucket, build BufferGeometry with position + color attributes
      clearGpuScene(); // remove previous frame's meshes

      setGlSizeFromScale();

      for (const [matKey, bucket] of bucketMap.entries()) {
        // create typed arrays
        const posArray = new Float32Array(bucket.positions);
        const colArray = new Float32Array(bucket.colors);

        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
        geom.setAttribute('color', new THREE.BufferAttribute(colArray, 3));
        geom.computeBoundingSphere();

        // create MeshBasicMaterial with vertexColors so GPU does minimal work (raster + depth)
        const mat = new THREE.MeshBasicMaterial({
          vertexColors: true,
          transparent: bucket.opacity < 1 ? true : false,
          opacity: bucket.opacity,
          side: THREE.DoubleSide,
          depthWrite: bucket.opacity < 1 ? false : true
        });

        const mesh = new THREE.Mesh(geom, mat);
        // our vertex positions are already world-space; don't apply any mesh transform
        mesh.matrixAutoUpdate = false;
        mesh.matrix.identity();

        gpuScene.add(mesh);
        gpuMeshPool.push(mesh);
      }

      // 4b) create InstancedMesh objects for instancedKeys (if any)
      // We'll create an InstancedMesh with a simple unit-triangle or use the original geometry.
      // For simplicity: if many objects share the same geometry and the geometry is small, build InstancedMesh by uploading single geom + per-instance matrix.
      for (const entry of instancedKeys) {
        const key = entry.key;
        const instances = entry.arr;
        if (instances.length <= 1) continue;
        // get one of the objects by uuid (we stored object references earlier)
        const sample = instances[0].object || instances[0]; // shape depends
        const geom = sample.geometry;
        // clone material for instanced mesh (simple MeshBasicMaterial)
        const baseMat = sample.material || new THREE.MeshBasicMaterial({ color: 0xffffff });
        const mat = new THREE.MeshBasicMaterial({
          color: baseMat.color ? baseMat.color.clone() : new THREE.Color(1,1,1),
          map: baseMat.map || null,
          transparent: baseMat.opacity < 1 || !!baseMat.transparent,
          opacity: baseMat.opacity !== undefined ? baseMat.opacity : 1,
        });

        // create instanced mesh
        const inst = new THREE.InstancedMesh(geom, mat, instances.length);
        inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        // set per-instance matrices
        const tempMat = new THREE.Matrix4();
        for (let i = 0; i < instances.length; i++) {
          const obj = instances[i].object || instances[i];
          inst.setMatrixAt(i, obj.matrixWorld);
        }
        inst.instanceMatrix.needsUpdate = true;
        gpuScene.add(inst);
        instancedPool.set(key, inst);
      }

      // 5) GPU render
      glRenderer.setSize(glCanvas.width, glCanvas.height, false);
      glRenderer.render(gpuScene, camera);

      // 6) blit GL to 2D canvas (keeps your original compositing behavior)
      ctx.drawImage(glCanvas, 0, 0, canvas.width, canvas.height);

      // 7) draw sprites on top (far -> near)
      sprites.sort((a, b) => b.depth - a.depth);
      for (let s = 0; s < sprites.length; s++) {
        const sp = sprites[s];
        const mat = sp.material;
        const half = sp.size * 0.5;
        if (mat && mat.map && mat.map.image) {
          try {
            const img = mat.map.image;
            ctx.drawImage(img, sp.x - half, sp.y - half, sp.size, sp.size);
          } catch (err) {
            ctx.fillStyle = (mat.color && mat.color.isColor)
              ? `rgba(${Math.round(mat.color.r * 255)},${Math.round(mat.color.g * 255)},${Math.round(mat.color.b * 255)},${mat.opacity !== undefined ? mat.opacity : 1})`
              : "#fff";
            ctx.fillRect(sp.x - half, sp.y - half, sp.size, sp.size);
          }
        } else {
          let colorCss = "#ffffff";
          if (mat && mat.color && mat.color.isColor) {
            colorCss = `rgba(${Math.round(mat.color.r * 255)},${Math.round(mat.color.g * 255)},${Math.round(mat.color.b * 255)},${mat.opacity !== undefined ? mat.opacity : 1})`;
          }
          ctx.beginPath();
          ctx.fillStyle = colorCss;
          ctx.arc(sp.x, sp.y, Math.max(1, half), 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // optional: return telemetry helpful for tuning
      return {
        buckets: bucketMap.size,
        gpuMeshes: gpuMeshPool.length + instancedPool.size,
        glRes: { w: glCanvas.width, h: glCanvas.height }
      };
    },

    dispose() {
      clearGpuScene();
      glRenderer.dispose();
      gpuScene.clear();
    }
  };

  // initialize sizes & GL scale
  api.setSize(width, height, false);
  api.setResolutionScale = (s) => { api.setResolutionScale ? api.setResolutionScale(s) : null; }; // No-op placeholder if user calls old name
  api.setResolutionScale = (s) => { resolutionScale = Math.max(0.1, Math.min(1, s)); setGlSizeFromScale(); };

  // set defaults
  api.setClearColor(0x000000, 1);

  return api;
}

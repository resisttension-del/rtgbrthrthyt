import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";

/**
 * Hybrid voidEngine — CPU-heavy preprocessing (lighting, tessellation),
 * GPU rasterization (fast depth + blending). Tunable to push CPU up toward ~90%.
 *
 * Usage:
 *   const engine = voidEngine({ width:640, height:360 });
 *   engine.setCpuTargetMs(18); // push more CPU
 *   engine.render(scene, camera);
 */
export function voidEngine({ width = 640, height = 360, antialias = false, resolutionScale = 1.0 } = {}) {
  // --- visible 2D canvas (keeps compatibility with previous API) ---
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  canvas.style.display = "block";
  canvas.style.imageRendering = "pixelated";
  const ctx = canvas.getContext("2d", { alpha: true });

  // --- WebGL renderer for final rasterization ---
  const glCanvas = document.createElement("canvas");
  glCanvas.width = Math.max(1, Math.floor(width * resolutionScale));
  glCanvas.height = Math.max(1, Math.floor(height * resolutionScale));
  const glRenderer = new THREE.WebGLRenderer({
    canvas: glCanvas,
    antialias,
    alpha: true,
    preserveDrawingBuffer: false,
  });
  glRenderer.setClearColor(0x000000, 0); // keep transparent so 2d compositor can draw bg
  glRenderer.setSize(glCanvas.width, glCanvas.height, false);

  const gpuScene = new THREE.Scene(); // will hold meshes created from CPU buffers
  const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);

  // Pools & caches
  let meshPool = []; // list of { mesh, material } used for buckets (reused each frame)
  let spritePool = new Map(); // uuid -> Sprite (reused)
  const lightCache = []; // lightweight list of directional/ambient lights for CPU shading

  // engine tuning / adaptive state
  let cpuTargetMs = 12.0; // desired CPU build time per frame (increase to push CPU harder)
  let tessLevel = 0; // current tessellation level (0 = none). adaptive
  let maxTessLevel = 3; // hard cap (increase to raise CPU)
  let resolution = Math.max(0.1, Math.min(1, resolutionScale));
  let clearColor = { r: 0, g: 0, b: 0, a: 1 };

  // temporaries for performance
  const tmpV0 = new THREE.Vector3(), tmpV1 = new THREE.Vector3(), tmpV2 = new THREE.Vector3();
  const camInv = new THREE.Matrix4();

  // helpers
  function hexToRgba(hex, alpha = 1) {
    const r = (hex >> 16) & 255;
    const g = (hex >> 8) & 255;
    const b = hex & 255;
    return { r, g, b, a: alpha };
  }
  function rgbaToCss({ r, g, b, a }) {
    return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;
  }

  function setGlSizeFromResolution() {
    const w = Math.max(1, Math.floor(canvas.width * resolution));
    const h = Math.max(1, Math.floor(canvas.height * resolution));
    if (glCanvas.width !== w || glCanvas.height !== h) {
      glCanvas.width = w; glCanvas.height = h;
      glRenderer.setSize(w, h, false);
    }
  }

  // CPU lighting model: ambient + sum(max(dot(N, Ldir), 0) * intensity)
  function computeCpuLighting(normal, worldPos) {
    // ambient
    let lighting = 0.15; // small ambient baseline
    for (let i = 0; i < lightCache.length; i++) {
      const L = lightCache[i];
      if (L.type === "directional") {
        // light.dir is normalized (world space)
        const d = Math.max(0, normal.dot(L.dir));
        lighting += d * L.intensity;
      } else if (L.type === "ambient") {
        lighting += L.intensity;
      } else if (L.type === "point") {
        // simple point attenuation
        const dist = worldPos.distanceTo(L.pos);
        const att = 1.0 / (1.0 + L.decay * dist * dist);
        const dir = tmpV0.copy(L.pos).sub(worldPos).normalize();
        const d = Math.max(0, normal.dot(dir));
        lighting += d * L.intensity * att;
      }
    }
    return Math.min(4.0, Math.max(0, lighting));
  }

  // Build lightCache by sampling lights from the scene (called each frame)
  function buildLightCacheFromScene(scene) {
    lightCache.length = 0;
    scene.traverseVisible((obj) => {
      if (obj.isLight) {
        if (obj.isAmbientLight) {
          lightCache.push({ type: "ambient", intensity: obj.intensity * (obj.color ? obj.color.getHexString ? 1 : 1 : 1) });
        } else if (obj.isDirectionalLight) {
          // world direction = target - position
          const worldPos = new THREE.Vector3();
          const tgtPos = new THREE.Vector3();
          obj.getWorldPosition(worldPos);
          if (obj.target) obj.target.getWorldPosition(tgtPos);
          else tgtPos.set(0, 0, 0);
          const dir = tmpV0.copy(tgtPos).sub(worldPos).normalize();
          lightCache.push({ type: "directional", dir: dir.clone(), intensity: obj.intensity, color: obj.color ? obj.color.clone() : new THREE.Color(0xffffff) });
        } else if (obj.isPointLight) {
          const pos = new THREE.Vector3();
          obj.getWorldPosition(pos);
          lightCache.push({ type: "point", pos: pos.clone(), intensity: obj.intensity, decay: obj.decay !== undefined ? obj.decay : 1.0 });
        } else if (obj.isHemisphereLight) {
          // approximate as ambient + weak directional from above
          lightCache.push({ type: "ambient", intensity: obj.intensity * 0.5 });
          lightCache.push({ type: "directional", dir: new THREE.Vector3(0, 1, 0), intensity: obj.intensity * 0.5 });
        }
      }
    });
    // always keep at least small ambient so nothing is fully black
    if (!lightCache.some(L => L.type === "ambient")) {
      lightCache.push({ type: "ambient", intensity: 0.05 });
    }
  }

  // Clip triangle against camera near plane; returns 0..2 triangles in world-space (simple Sutherland-Hodgman)
  function clipTriAgainstNearWorld(worldVerts, camVerts, near) {
    // worldVerts: [v0,v1,v2] (THREE.Vector3 clones), camVerts same length (camera-space)
    const inCam = camVerts;
    const inWorld = worldVerts;
    function inside(c) { return c.z <= -near; }
    let outWorld = [], outCam = [];
    for (let i = 0; i < 3; i++) {
      const aW = inWorld[i], aC = inCam[i];
      const bW = inWorld[(i + 1) % 3], bC = inCam[(i + 1) % 3];
      const aIn = inside(aC), bIn = inside(bC);
      if (aIn && bIn) {
        outWorld.push(bW.clone()); outCam.push(bC.clone());
      } else if (aIn && !bIn) {
        const t = (-near - aC.z) / (bC.z - aC.z);
        const tt = Math.max(0, Math.min(1, t));
        const iW = new THREE.Vector3().lerpVectors(aW, bW, tt);
        const iC = new THREE.Vector3().lerpVectors(aC, bC, tt);
        outWorld.push(iW); outCam.push(iC);
      } else if (!aIn && bIn) {
        const t = (-near - aC.z) / (bC.z - aC.z);
        const tt = Math.max(0, Math.min(1, t));
        const iW = new THREE.Vector3().lerpVectors(aW, bW, tt);
        const iC = new THREE.Vector3().lerpVectors(aC, bC, tt);
        outWorld.push(iW); outCam.push(iC);
        outWorld.push(bW.clone()); outCam.push(bC.clone());
      } else {
        // both out
      }
    }
    const tris = [];
    if (outWorld.length >= 3) {
      for (let i = 1; i < outWorld.length - 1; i++) {
        tris.push([outWorld[0].clone(), outWorld[i].clone(), outWorld[i + 1].clone()]);
      }
    }
    return tris;
  }

  // Tessellate a triangle recursively by midpoints up to 'level'
  function subdivideTriangle(worldTri, level) {
    if (level <= 0) return [worldTri];
    const [a, b, c] = worldTri;
    const ab = new THREE.Vector3().lerpVectors(a, b, 0.5);
    const bc = new THREE.Vector3().lerpVectors(b, c, 0.5);
    const ca = new THREE.Vector3().lerpVectors(c, a, 0.5);
    const res = [];
    res.push(...subdivideTriangle([a.clone(), ab.clone(), ca.clone()], level - 1));
    res.push(...subdivideTriangle([ab.clone(), b.clone(), bc.clone()], level - 1));
    res.push(...subdivideTriangle([ca.clone(), bc.clone(), c.clone()], level - 1));
    res.push(...subdivideTriangle([ab.clone(), bc.clone(), ca.clone()], level - 1));
    return res;
  }

  // Convert a mesh's triangles into CPU-lit vertex arrays (positions + colors), bucketed by opacity key
  function processSceneToCpuBuffers(scene, camera) {
    const buckets = new Map(); // key = opacity (string) -> { positions: [], colors: [], indices: [] optional }
    camInv.copy(camera.matrixWorld).invert();

    scene.traverseVisible((object) => {
      if (object.isMesh && object.visible && object.geometry && object.material) {
        // get base color & opacity
        let baseColor = new THREE.Color(1, 1, 1);
        if (object.material.color && object.material.color.isColor) baseColor = object.material.color.clone();
        const opacity = (object.material.opacity !== undefined) ? object.material.opacity : 1;
        const key = String(opacity);

        // geometry attributes
        const geom = object.geometry;
        const posAttr = geom.attributes && geom.attributes.position;
        const normAttr = geom.attributes && geom.attributes.normal;

        if (!posAttr) return;

        const indexArr = geom.index ? geom.index.array : null;
        const itemSize = posAttr.itemSize || 3;
        const triCount = indexArr ? indexArr.length / 3 : posAttr.count / 3;

        // world-matrix for object
        object.updateMatrixWorld(true);

        for (let ti = 0; ti < triCount; ti++) {
          const ai = indexArr ? indexArr[ti * 3 + 0] : ti * 3 + 0;
          const bi = indexArr ? indexArr[ti * 3 + 1] : ti * 3 + 1;
          const ci = indexArr ? indexArr[ti * 3 + 2] : ti * 3 + 2;

          const wA = new THREE.Vector3().fromArray(posAttr.array, ai * itemSize).applyMatrix4(object.matrixWorld);
          const wB = new THREE.Vector3().fromArray(posAttr.array, bi * itemSize).applyMatrix4(object.matrixWorld);
          const wC = new THREE.Vector3().fromArray(posAttr.array, ci * itemSize).applyMatrix4(object.matrixWorld);

          // compute camera-space vertices for clipping
          const cA = wA.clone().applyMatrix4(camInv);
          const cB = wB.clone().applyMatrix4(camInv);
          const cC = wC.clone().applyMatrix4(camInv);

          const near = camera.near || 0.001;
          const clipped = clipTriAgainstNearWorld([wA, wB, wC], [cA, cB, cC], near);
          if (!clipped || clipped.length === 0) continue;

          // optionally subdivide clipped triangles according to tessLevel
          for (let ct = 0; ct < clipped.length; ct++) {
            const triWorld = clipped[ct]; // array of three Vector3
            const subtris = (tessLevel > 0) ? subdivideTriangle(triWorld, tessLevel) : [triWorld];
            for (let st = 0; st < subtris.length; st++) {
              const tW = subtris[st];
              // compute per-vertex normals (try attr normals transformed, otherwise compute face normal)
              let nA, nB, nC;
              if (normAttr) {
                nA = new THREE.Vector3().fromArray(normAttr.array, ai * itemSize).transformDirection(object.matrixWorld);
                nB = new THREE.Vector3().fromArray(normAttr.array, bi * itemSize).transformDirection(object.matrixWorld);
                nC = new THREE.Vector3().fromArray(normAttr.array, ci * itemSize).transformDirection(object.matrixWorld);
              } else {
                // fallback face normal
                nA = new THREE.Vector3().subVectors(tW[1], tW[0]).cross(new THREE.Vector3().subVectors(tW[2], tW[0])).normalize();
                nB = nA.clone(); nC = nA.clone();
              }

              // compute lighting per vertex (CPU-heavy)
              const ld0 = computeCpuLighting(nA, tW[0]);
              const ld1 = computeCpuLighting(nB, tW[1]);
              const ld2 = computeCpuLighting(nC, tW[2]);

              // compute final vertex color (apply base color and lighting)
              const c0 = new THREE.Color(baseColor.r * ld0, baseColor.g * ld0, baseColor.b * ld0);
              const c1 = new THREE.Color(baseColor.r * ld1, baseColor.g * ld1, baseColor.b * ld1);
              const c2 = new THREE.Color(baseColor.r * ld2, baseColor.g * ld2, baseColor.b * ld2);

              // push into bucket
              if (!buckets.has(key)) buckets.set(key, { positions: [], colors: [] });
              const bucket = buckets.get(key);
              bucket.positions.push(tW[0].x, tW[0].y, tW[0].z, tW[1].x, tW[1].y, tW[1].z, tW[2].x, tW[2].y, tW[2].z);
              bucket.colors.push(c0.r, c0.g, c0.b, c1.r, c1.g, c1.b, c2.r, c2.g, c2.b);
            }
          }
        }
      }

      // Sprites are mirrored to GPU (cheap)
      if (object.isSprite && object.visible) {
        // ensure sprite is created in spritePool with same texture/color/transform
        if (!spritePool.has(object.uuid)) {
          const mat = new THREE.SpriteMaterial({
            map: (object.material && object.material.map) ? object.material.map : null,
            color: (object.material && object.material.color && object.material.color.isColor) ? object.material.color.clone() : new THREE.Color(0xffffff),
            opacity: (object.material && object.material.opacity !== undefined) ? object.material.opacity : 1,
            transparent: (object.material && object.material.transparent) || false,
            depthWrite: !(object.material && object.material.transparent),
          });
          const s = new THREE.Sprite(mat);
          spritePool.set(object.uuid, s);
          gpuScene.add(s);
        }
        const s = spritePool.get(object.uuid);
        object.updateMatrixWorld(true);
        s.matrixAutoUpdate = false;
        s.matrix.copy(object.matrixWorld);
        s.visible = object.visible;
      }
    }); // traverseVisible

    return buckets;
  }

  // Create or reuse Mesh objects from buckets and add them to gpuScene
  function uploadBucketsToGpu(buckets) {
    // clear previous gpuScene meshes (but keep sprites)
    for (let i = gpuScene.children.length - 1; i >= 0; i--) {
      const c = gpuScene.children[i];
      // keep sprites (we manage spritePool separately)
      if (c.type === "Sprite") c

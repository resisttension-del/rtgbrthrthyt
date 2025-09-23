import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";

export function voidEngine({ width = 1280, height = 720 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.style.position = 'relative';
  canvas.style.zIndex = '0';
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // Scratch vars
  const proj = new THREE.Vector3();
  const tmpPos = new THREE.Vector3();
  const tmpVec = new THREE.Vector3();
  const tmpVec2 = new THREE.Vector3();
  const tmpMat = new THREE.Matrix4();

  // convexHull - kept identical to your original
  function convexHull(points) {
    if (!points || points.length <= 1) return points ? points.slice() : [];
    const pts = points.slice().sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower = [];
    for (let p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    lower.pop(); upper.pop();
    return lower.concat(upper);
  }

  // ---------- small options tuned for Chromebook / weak devices ----------
  const api = {
    domElement: canvas,
    options: {
      strictNearClip: true,
      useGLDepthPass: true,
      glDepthWidth: 128,   // try 128x72. Lower -> cheaper but blockier silhouettes (64x36 is very light)
      glDepthHeight: 72,
      maxTriangulation: 4000,   // if triangles > this -> fallback to painter
      forcePainterIfManyObjects: true,
      forcePainterThreshold: 300
    },
    setSize(w, h, updateStyle = true) {
      canvas.width = w; canvas.height = h;
      if (updateStyle) {
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
    },
    setClearColor(hex, alpha = 1) { api._clearColor = { hex, alpha }; },
    _clearColor: { hex: 0x000000, alpha: 1 }
  };

  // sampleWorldPointsFor - kept same as your original (unchanged)
  function sampleWorldPointsFor(obj, geom) {
    const worldPoints = [];
    if (geom && geom.boundingBox) {
      const bb = geom.boundingBox;
      const min = bb.min; const max = bb.max;
      const corners = [
        [min.x, min.y, min.z], [min.x, min.y, max.z], [min.x, max.y, min.z], [min.x, max.y, max.z],
        [max.x, min.y, min.z], [max.x, min.y, max.z], [max.x, max.y, min.z], [max.x, max.y, max.z],
      ];
      for (let c of corners) {
        tmpVec.set(c[0], c[1], c[2]).applyMatrix4(obj.matrixWorld);
        worldPoints.push(tmpVec.clone());
      }
    } else if (geom && geom.boundingSphere) {
      const bs = geom.boundingSphere;
      const center = bs.center.clone().applyMatrix4(obj.matrixWorld);
      const r = bs.radius * (obj.matrixWorld.getMaxScaleOnAxis ? obj.matrixWorld.getMaxScaleOnAxis() : 1);
      worldPoints.push(center.clone());
      worldPoints.push(center.clone().add(new THREE.Vector3(r, 0, 0)));
      worldPoints.push(center.clone().add(new THREE.Vector3(-r, 0, 0)));
      worldPoints.push(center.clone().add(new THREE.Vector3(0, r, 0)));
      worldPoints.push(center.clone().add(new THREE.Vector3(0, -r, 0)));
      worldPoints.push(center.clone().add(new THREE.Vector3(0, 0, r)));
      worldPoints.push(center.clone().add(new THREE.Vector3(0, 0, -r)));
    } else if (geom && geom.attributes && geom.attributes.position && geom.attributes.position.count > 0) {
      const posAttr = geom.attributes.position;
      const count = posAttr.count;
      const step = Math.max(1, Math.floor(count / 12));
      for (let i = 0; i < Math.min(count, 12); i += step) {
        tmpVec.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)).applyMatrix4(obj.matrixWorld);
        worldPoints.push(tmpVec.clone());
      }
    } else {
      obj.getWorldPosition(tmpPos);
      worldPoints.push(tmpPos.clone());
    }
    return worldPoints;
  }

  // ---------- create tiny offscreen GL context once ----------
  function createOffscreenGL(w, h) {
    try {
      const off = document.createElement('canvas');
      off.width = w; off.height = h;
      // try webgl2 first (if present), otherwise webgl1
      const gl = off.getContext('webgl2', { antialias: false, depth: true }) || off.getContext('webgl', { antialias: false, depth: true });
      if (!gl) return null;

      // choose shader variants for webgl2/webgl1
      const isGL2 = (typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext);
      const vsSrc = isGL2 ? `#version 300 es
        in vec3 a_pos;
        void main(){ gl_Position = vec4(a_pos, 1.0); }`
        : `attribute vec3 a_pos; void main(){ gl_Position = vec4(a_pos,1.0); }`;
      const fsSrc = isGL2 ? `#version 300 es
        precision mediump float; uniform vec4 u_color; out vec4 o; void main(){ o = u_color; }`
        : `precision mediump float; uniform vec4 u_color; void main(){ gl_FragColor = u_color; }`;

      function compile(src, type) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
          const info = gl.getShaderInfoLog(s);
          gl.deleteShader(s);
          throw new Error(info);
        }
        return s;
      }

      const vs = compile(vsSrc, gl.VERTEX_SHADER);
      const fs = compile(fsSrc, gl.FRAGMENT_SHADER);
      const prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error('GL program link failed: ' + gl.getProgramInfoLog(prog));
      }

      const attribLoc = { a_pos: isGL2 ? gl.getAttribLocation(prog, 'a_pos') : gl.getAttribLocation(prog, 'a_pos') };
      const uniformLoc = { u_color: gl.getUniformLocation(prog, 'u_color') };
      const vbo = gl.createBuffer();

      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.clearDepth(1.0);
      gl.disable(gl.BLEND);

      return { gl, canvas: off, program: prog, attribLoc, uniformLoc, vbo, isGL2 };
    } catch (e) {
      return null;
    }
  }

  // ---------- drawDrawable (keeps your original visual style) ----------
  function drawDrawable(d, camera) {
    const obj = d.obj;
    const avgDist = ((d.distNear ?? d.dist ?? 0) + (d.distFar ?? d.dist ?? 0)) * 0.5;
    let color = obj.userData?.color;
    if (!color && obj.material && obj.material.color) {
      try { color = obj.material.color.getStyle ? obj.material.color.getStyle() : (`#${obj.material.color.getHexString()}`); }
      catch (e) { color = obj.userData?.color || 'white'; }
    }
    color = color || obj.userData?.color || 'white';

    if (d.type === 'image' && d.mapImage && d.mapImage.width) {
      let size;
      if (obj.geometry && obj.geometry.boundingBox) {
        const bb = obj.geometry.boundingBox;
        const corners = [
          [bb.min.x, bb.min.y, bb.min.z],
          [bb.max.x, bb.max.y, bb.max.z]
        ];
        const screenPts = [];
        for (let c of corners) {
          tmpVec.set(c[0], c[1], c[2]).applyMatrix4(obj.matrixWorld);
          const p = tmpVec.project(camera);
          screenPts.push({ x: (p.x * 0.5 + 0.5) * canvas.width, y: (-p.y * 0.5 + 0.5) * canvas.height });
        }
        const wPx = Math.abs(screenPts[0].x - screenPts[1].x);
        const hPx = Math.abs(screenPts[0].y - screenPts[1].y);
        size = Math.max(8, obj.userData?.sizePx ?? Math.max(wPx, hPx, 32));
      } else {
        const baseSize = obj.userData?.sizePx ?? 300;
        size = Math.max(8, baseSize * (1 / Math.max(0.1, avgDist * 0.05)));
      }
      ctx.save();
      ctx.translate(d.sx, d.sy);
      const rot = obj.userData?.rotation ?? (obj.rotation?.z ?? 0);
      if (rot) ctx.rotate(rot);
      ctx.globalAlpha = obj.userData?.opacity ?? (obj.material?.opacity ?? 1);
      ctx.drawImage(d.mapImage, -size / 2, -size / 2, size, size);
      ctx.restore();
      return;
    }

    if (d.type === 'poly' && d.pts) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(d.pts[0].x, d.pts[0].y);
      for (let j = 1; j < d.pts.length; j++) ctx.lineTo(d.pts[j].x, d.pts[j].y);
      ctx.closePath();
      ctx.globalAlpha = Math.max(0.2, Math.min(1, 1 - (avgDist * 0.002)));
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = Math.max(1, 2 - (avgDist * 0.001));
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.stroke();
      ctx.restore();
      return;
    }

    if (d.type === 'line' && d.pts && d.pts.length === 2) {
      ctx.beginPath();
      ctx.moveTo(d.pts[0].x, d.pts[0].y);
      ctx.lineTo(d.pts[1].x, d.pts[1].y);
      ctx.strokeStyle = color;
      ctx.lineWidth = obj.userData?.lineWidth ?? 3;
      ctx.globalAlpha = 1 - Math.min(0.9, avgDist * 0.002);
      ctx.stroke();
      return;
    }

    if (d.type === 'rect') {
      const size = d.sizePx ?? Math.max(2, Math.round(12 * (1 / Math.max(0.1, avgDist * 0.05))));
      const x = (d.sx || d.sx === 0) ? d.sx : 0;
      const y = (d.sy || d.sy === 0) ? d.sy : 0;
      ctx.save();
      ctx.globalAlpha = Math.max(0.5, Math.min(1, 1 - (avgDist * 0.002)));
      ctx.fillStyle = color;
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
      ctx.restore();
      return;
    }
  }

  // Create GL up front (but lazily when first render if you prefer)
  let glState = null;
  function ensureGL() {
    if (glState) return glState;
    if (!api.options.useGLDepthPass) return null;
    const wGL = Math.max(8, Math.min(512, api.options.glDepthWidth | 0));
    const hGL = Math.max(8, Math.min(512, api.options.glDepthHeight | 0));
    glState = createOffscreenGL(wGL, hGL);
    if (!glState) {
      glState = null;
      return null;
    }
    return glState;
  }

  // ---------- render (main) - mirrors your original structure but uses GL depth-pass ----------
  api.render = function (scene, camera) {
    // Clear 2D canvas
    const c = api._clearColor;
    const r = (c.hex >> 16) & 0xff;
    const g = (c.hex >> 8) & 0xff;
    const b = c.hex & 0xff;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = `rgba(${r},${g},${b},${c.alpha})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    // Update camera
    camera.updateMatrixWorld();
    if (camera.updateProjectionMatrix) camera.updateProjectionMatrix();

    // camera inverse
    const camInv = tmpMat.copy(camera.matrixWorld).invert();

    // collect drawables (exactly like original)
    const drawables = [];
    scene.traverse((obj) => {
      if (!obj.visible) return;
      if (obj.isCamera || obj.isLight) return;

      obj.getWorldPosition(tmpPos);
      proj.copy(tmpPos).project(camera);
      const sx = (proj.x * 0.5 + 0.5) * canvas.width;
      const sy = (-proj.y * 0.5 + 0.5) * canvas.height;
      const centerDist = camera.position.distanceTo(tmpPos);
      const mapImage = obj.material && obj.material.map && obj.material.map.image ? obj.material.map.image : null;
      const alwaysRender = !!obj.userData?.alwaysRender;

      function sampleWorldPointsForLocal(objLocal, geomLocal) {
        return sampleWorldPointsFor(objLocal, geomLocal);
      }

      if (mapImage) {
        let worldPoints = obj.geometry ? sampleWorldPointsForLocal(obj, obj.geometry) : [tmpPos.clone()];
        const dists = worldPoints.map(wp => camera.position.distanceTo(wp));
        const distNear = Math.min(...dists);
        const distFar = Math.max(...dists);
        drawables.push({ type: 'image', obj, sx, sy, distNear, distFar, projZ: proj.z, mapImage });
        return;
      } else if (obj.isMesh && obj.geometry) {
        const geom = obj.geometry;
        if (!geom.boundingBox) geom.computeBoundingBox && geom.computeBoundingBox();
        if (!geom.boundingSphere) geom.computeBoundingSphere && geom.computeBoundingSphere();

        const worldPoints = sampleWorldPointsForLocal(obj, geom);
        if (worldPoints.length === 0) {
          if (obj.userData?.forceMarker) {
            drawables.push({ type: 'rect', obj, sx, sy, distNear: centerDist, distFar: centerDist, sizePx: obj.userData?.markerSizePx ?? 6 });
          }
          return;
        }

        const dists = worldPoints.map(wp => camera.position.distanceTo(wp));
        const distNear = Math.min(...dists);
        const distFar = Math.max(...dists);

        // near-plane clipping -> produce projected points with ndcZ
        const camSpacePts = worldPoints.map(wp => wp.clone().applyMatrix4(camInv));
        const nearZ = - (camera.near !== undefined ? camera.near : 0.1);
        const farZ = - (camera.far !== undefined ? camera.far : 1e12);
        const pts2d = [];
        for (let i = 0; i < worldPoints.length; i++) {
          const camPt = camSpacePts[i];
          const wp = worldPoints[i];
          if (camPt.z <= nearZ && camPt.z >= farZ) {
            proj.copy(wp).project(camera);
            const px = (proj.x * 0.5 + 0.5) * canvas.width;
            const py = (-proj.y * 0.5 + 0.5) * canvas.height;
            pts2d.push({ x: px, y: py, ndcZ: proj.z });
          }
        }
        // near-plane edge intersections
        for (let i = 0; i < worldPoints.length; i++) {
          for (let j = i + 1; j < worldPoints.length; j++) {
            const z1 = camSpacePts[i].z, z2 = camSpacePts[j].z;
            if ((z1 <= nearZ && z2 > nearZ) || (z2 <= nearZ && z1 > nearZ)) {
              const denom = (z2 - z1); if (Math.abs(denom) < 1e-9) continue;
              const t = (nearZ - z1) / denom; if (t < 0 || t > 1) continue;
              const ip = worldPoints[i].clone().lerp(worldPoints[j], t);
              proj.copy(ip).project(camera);
              const px = (proj.x * 0.5 + 0.5) * canvas.width;
              const py = (-proj.y * 0.5 + 0.5) * canvas.height;
              pts2d.push({ x: px, y: py, ndcZ: proj.z });
            }
          }
        }

        if (!api.options.strictNearClip && pts2d.length === 0) {
          proj.copy(tmpPos).project(camera);
          pts2d.push({ x: (proj.x * 0.5 + 0.5) * canvas.width, y: (-proj.y * 0.5 + 0.5) * canvas.height, ndcZ: proj.z });
        }

        if (pts2d.length === 0) {
          if (alwaysRender || obj.userData?.forceMarker) {
            const cx = Math.max(0, Math.min(canvas.width, sx));
            const cy = Math.max(0, Math.min(canvas.height, sy));
            drawables.push({ type: 'rect', obj, sx: cx, sy: cy, distNear, distFar, sizePx: obj.userData?.markerSizePx ?? 6 });
          }
          return;
        }

        const hull = convexHull(pts2d);
        if (hull.length >= 3) {
          drawables.push({ type: 'poly', obj, pts: hull, distNear, distFar, projZ: proj.z });
        } else if (hull.length === 2) {
          drawables.push({ type: 'line', obj, pts: hull, distNear, distFar });
        } else {
          const p = hull[0] || pts2d[0];
          if (alwaysRender || obj.userData?.forceMarker) {
            drawables.push({ type: 'rect', obj, sx: p.x, sy: p.y, distNear, distFar, sizePx: obj.userData?.markerSizePx ?? 6 });
          }
        }
        return;
      } else {
        if (obj.userData?.forceMarker) {
          drawables.push({ type: 'rect', obj, sx, sy, distNear: centerDist, distFar: centerDist, sizePx: obj.userData?.markerSizePx ?? 6 });
        }
      }
    });

    // Painter's order sort helper (same as original)
    function depthCmp(a, b) {
      const aFar = (a.distFar !== undefined) ? a.distFar : (a.dist !== undefined ? a.dist : 0);
      const bFar = (b.distFar !== undefined) ? b.distFar : (b.dist !== undefined ? b.dist : 0);
      if (aFar !== bFar) return bFar - aFar;
      const aNear = (a.distNear !== undefined) ? a.distNear : (a.dist !== undefined ? a.dist : 0);
      const bNear = (b.distNear !== undefined) ? b.distNear : (b.dist !== undefined ? b.dist : 0);
      if (aNear !== bNear) return bNear - aNear;
      const aZ = (a.projZ !== undefined ? a.projZ : 1);
      const bZ = (b.projZ !== undefined ? b.projZ : 1);
      return bZ - aZ;
    }

    if (drawables.length === 0) return;

    // classify opaque vs translucent
    const opaque = [];
    const translucent = [];
    for (const d of drawables) {
      const alpha = (d.obj.userData?.opacity ?? d.obj.material?.opacity ?? 1);
      if (alpha >= 0.999 && !d.obj.userData?.forceTranslucent) opaque.push(d);
      else translucent.push(d);
    }

    // too many objects -> painter fallback
    if (api.options.forcePainterIfManyObjects && drawables.length > api.options.forcePainterThreshold) {
      opaque.sort(depthCmp); for (const d of opaque) drawDrawable(d, camera);
      translucent.sort((a,b) => -depthCmp(a,b)); for (const d of translucent) drawDrawable(d, camera);
      return;
    }

    // If GL depth pass requested -> try to use it
    const glSt = ensureGL();
    if (!glSt) {
      opaque.sort(depthCmp); for (const d of opaque) drawDrawable(d, camera);
      translucent.sort((a,b) => -depthCmp(a,b)); for (const d of translucent) drawDrawable(d, camera);
      return;
    }

    // budget triangles
    let triCount = 0;
    for (const d of opaque) {
      if (d.type === 'poly' && d.pts && d.pts.length >= 3) triCount += Math.max(0, d.pts.length - 2);
      else if (d.type === 'image' || d.type === 'rect') triCount += 2;
    }
    if (triCount > api.options.maxTriangulation) {
      opaque.sort(depthCmp); for (const d of opaque) drawDrawable(d, camera);
      translucent.sort((a,b) => -depthCmp(a,b)); for (const d of translucent) drawDrawable(d, camera);
      return;
    }

    // ---------- GL pass: draw opaque hulls into tiny GL buffer ----------
    const { gl, canvas: glCanvas, program, attribLoc, uniformLoc, vbo } = glSt;
    gl.viewport(0, 0, glCanvas.width, glCanvas.height);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.useProgram(program);
    // clear GL buffer to the same clear color
    gl.clearColor(r/255, g/255, b/255, c.alpha);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // ensure depth test and no blending for opaque
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    // per-opaque drawable: convert its projected screen pts back to clip-space NDC and draw triangles
    for (const d of opaque) {
      let verts = [];
      if (d.type === 'poly' && d.pts && d.pts.length >= 3) {
        for (let p of d.pts) {
          // convert screen x,y to NDC clip-space x,y; keep ndcZ as z
          const ndcX = (p.x / canvas.width) * 2 - 1;
          const ndcY = -((p.y / canvas.height) * 2 - 1);
          const z = (p.ndcZ !== undefined ? p.ndcZ : 0.0);
          verts.push([ndcX, ndcY, z]);
        }
      } else if (d.type === 'image') {
        // approximate as quad centered at sx,sy, using avg size heuristic and d.projZ
        const base = d.obj.userData?.sizePx ?? 128;
        const avgDist = ((d.distNear ?? d.dist ?? 0) + (d.distFar ?? d.dist ?? 0)) * 0.5;
        const sizePx = Math.max(8, base * (1 / Math.max(0.1, avgDist * 0.05)));
        const halfW = (sizePx / 2) / canvas.width * 2;
        const halfH = (sizePx / 2) / canvas.height * 2;
        const cx = (d.sx / canvas.width) * 2 - 1;
        const cy = -((d.sy / canvas.height) * 2 - 1);
        const z = (d.projZ !== undefined ? d.projZ : 0.0);
        verts = [
          [cx - halfW, cy - halfH, z],
          [cx + halfW, cy - halfH, z],
          [cx + halfW, cy + halfH, z],
          [cx - halfW, cy + halfH, z]
        ];
      } else if (d.type === 'rect') {
        const size = d.sizePx ?? 6;
        const halfW = (size / 2) / canvas.width * 2;
        const halfH = (size / 2) / canvas.height * 2;
        const cx = (d.sx / canvas.width) * 2 - 1;
        const cy = -((d.sy / canvas.height) * 2 - 1);
        const z = (d.projZ !== undefined ? d.projZ : 0.0);
        verts = [
          [cx - halfW, cy - halfH, z],
          [cx + halfW, cy - halfH, z],
          [cx + halfW, cy + halfH, z],
          [cx - halfW, cy + halfH, z]
        ];
      } else {
        // skip unknown types
        continue;
      }

      // triangulate as fan
      const triArr = [];
      for (let i = 1; i < verts.length - 1; i++) {
        triArr.push(verts[0][0], verts[0][1], verts[0][2]);
        triArr.push(verts[i][0], verts[i][1], verts[i][2]);
        triArr.push(verts[i+1][0], verts[i+1][1], verts[i+1][2]);
      }
      if (triArr.length === 0) continue;

      const floatData = new Float32Array(triArr);
      gl.bufferData(gl.ARRAY_BUFFER, floatData, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(attribLoc.a_pos);
      gl.vertexAttribPointer(attribLoc.a_pos, 3, gl.FLOAT, false, 0, 0);

      // compute object color quickly (1px canvas trick)
      let cssColor = d.obj.userData?.color ?? (d.obj.material?.color?.getStyle ? d.obj.material.color.getStyle() : null);
      if (!cssColor && d.obj.material && d.obj.material.color) {
        try { cssColor = '#' + d.obj.material.color.getHexString(); } catch (e) { cssColor = '#ffffff'; }
      }
      let alpha = d.obj.userData?.opacity ?? d.obj.material?.opacity ?? 1;
      let rgba = [1,1,1, alpha];
      try {
        const tc = document.createElement('canvas'); tc.width = tc.height = 1;
        const tctx = tc.getContext('2d'); tctx.fillStyle = cssColor || 'white'; tctx.fillRect(0,0,1,1);
        const p = tctx.getImageData(0,0,1,1).data;
        rgba = [p[0]/255, p[1]/255, p[2]/255, alpha];
      } catch (e) { rgba = [1,1,1, alpha]; }

      gl.uniform4f(uniformLoc.u_color, rgba[0], rgba[1], rgba[2], rgba[3]);
      gl.drawArrays(gl.TRIANGLES, 0, floatData.length / 3);
    }

    // blit GL canvas into main canvas (hardware-accelerated in browsers)
    try {
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(glCanvas, 0, 0, canvas.width, canvas.height);
      ctx.restore();
    } catch (e) {
      // rare fallback: if drawImage fails, fall back to painter entirely
      opaque.sort(depthCmp); for (const d of opaque) drawDrawable(d, camera);
      translucent.sort((a,b) => -depthCmp(a,b)); for (const d of translucent) drawDrawable(d, camera);
      return;
    }

    // finally draw translucent overlays on top (back-to-front)
    translucent.sort((a,b) => -depthCmp(a,b));
    for (const d of translucent) drawDrawable(d, camera);
  };

  return api;
}

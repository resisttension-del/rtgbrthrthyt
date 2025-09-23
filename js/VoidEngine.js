import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";

export function voidEngine({ width = 1280, height = 720, debug = true } = {}) {
  // Create canvas
  const canvas = document.createElement('canvas');
  // unique id so you can query/select the exact canvas we created
  const uniqueId = `voidEngineCanvas-${Math.floor(Math.random()*1e9).toString(36)}`;
  canvas.id = uniqueId;
  canvas.width = width;
  canvas.height = height;

  // Sane default styling so it is visible unless user overrides
  canvas.style.position = 'absolute';
  canvas.style.left = '0px';
  canvas.style.top = '0px';
  canvas.style.zIndex = '9999';
  canvas.style.background = 'transparent';
  canvas.style.pointerEvents = 'none';

  const ctx = canvas.getContext('2d');

  // --- Scratch objects / helpers (Three.js types) ---
  const proj = new THREE.Vector3();
  const tmpPos = new THREE.Vector3();
  const tmpVec = new THREE.Vector3();
  const tmpVec2 = new THREE.Vector3();
  const tmpMat = new THREE.Matrix4();

  // Convex hull helper (Andrew monotone chain) — unchanged algorithm
  function convexHull(points) {
    if (!points || points.length <= 1) return (points || []).slice();
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
    lower.pop();
    upper.pop();
    return lower.concat(upper);
  }

  // --- API object returned to user ---
  const api = {
    domElement: canvas,
    options: {
      strictNearClip: true
    },
    debug: {
      enabled: !!debug,        // turn on/off console logs
      overlay: true,          // draw a small debug overlay in the canvas
      showCanvasIdOnCreate: true,
    },
    _clearColor: { hex: 0x000000, alpha: 1 },

    // Attach canvas to DOM parent (defaults to document.body)
    attachTo(parent = document.body) {
      if (typeof parent === 'string') parent = document.querySelector(parent) || document.body;
      if (!parent) parent = document.body;
      parent.appendChild(canvas);
      // ensure visible in flow if user forgot to style
      canvas.style.display = 'block';
      // immediate test draw so you can visually confirm
      this.testDraw();
      if (this.debug.showCanvasIdOnCreate) console.info(`[voidEngine] canvas id: ${canvas.id} appended to`, parent);
    },

    // Resize helper
    setSize(w, h, updateStyle = true) {
      canvas.width = w;
      canvas.height = h;
      if (updateStyle) {
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
    },

    // set clear color like THREE (hex int, alpha 0..1)
    setClearColor(hex, alpha = 1) {
      this._clearColor = { hex: typeof hex === 'string' ? parseInt(hex.replace(/^#/, ''), 16) : hex, alpha };
    },

    // Simple test draw that explicitly draws on *this* canvas and logs
    testDraw() {
      try {
        const c = canvas;
        const ct = ctx;
        ct.save();
        ct.setTransform(1, 0, 0, 1, 0, 0);
        ct.fillStyle = 'magenta';
        ct.fillRect(4, 4, 64, 64);
        ct.fillStyle = 'white';
        ct.font = '11px monospace';
        ct.fillText(`id:${canvas.id}`, 76, 18);
        ct.restore();
        console.log(`[voidEngine] testDraw -> magenta box drawn to canvas id=${canvas.id}`);
      } catch (e) {
        console.error('[voidEngine] testDraw failed', e);
      }
    },

    // MAIN render function — accepts a THREE.Scene root and THREE.Camera (same semantics as your original engine)
    render(scene, camera) {
      // Safety: trap all exceptions so a single error won't kill the page rendering
      try {
        if (!canvas || !ctx) return;
        // clear with configured clear color
        const c = api._clearColor;
        const r = (c.hex >> 16) & 0xff;
        const g = (c.hex >> 8) & 0xff;
        const b = c.hex & 0xff;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = `rgba(${r},${g},${b},${c.alpha})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.restore();

        if (!scene || !camera) {
          if (api.debug.enabled) console.warn('[voidEngine] render called with missing scene or camera', { scene, camera });
          // draw red 'missing' overlay to make failures obvious
          if (api.debug.overlay) {
            ctx.save();
            ctx.fillStyle = 'rgba(255,0,0,0.06)';
            ctx.fillRect(0, 0, Math.min(160, canvas.width), 28);
            ctx.fillStyle = 'white';
            ctx.font = '12px monospace';
            ctx.fillText('voidEngine: missing scene or camera', 6, 18);
            ctx.restore();
          }
          return;
        }

        // Update camera matrices (same as before)
        camera.updateMatrixWorld();
        if (camera.updateProjectionMatrix) camera.updateProjectionMatrix();

        // inverse camera world matrix for camera-space checks
        const camInv = tmpMat.copy(camera.matrixWorld).invert();

        // Collect drawables (objects to render to 2D canvas)
        const drawables = [];

        // Traverse scene graph
        scene.traverse((obj) => {
          if (!obj.visible) return;
          if (obj.isCamera || obj.isLight) return;

          // get world center position
          obj.getWorldPosition(tmpPos);
          proj.copy(tmpPos).project(camera); // NDC

          const sx = (proj.x * 0.5 + 0.5) * canvas.width;
          const sy = (-proj.y * 0.5 + 0.5) * canvas.height;
          const centerDist = camera.position.distanceTo(tmpPos);

          const mapImage = obj.material && obj.material.map && obj.material.map.image ? obj.material.map.image : null;
          const alwaysRender = !!obj.userData?.alwaysRender;

          // sample points (bbox corners, bounding sphere, or subset of positions)
          function sampleWorldPoints(obj, geom) {
            const out = [];
            if (geom && geom.boundingBox) {
              const bb = geom.boundingBox;
              const min = bb.min;
              const max = bb.max;
              const corners = [
                [min.x, min.y, min.z],
                [min.x, min.y, max.z],
                [min.x, max.y, min.z],
                [min.x, max.y, max.z],
                [max.x, min.y, min.z],
                [max.x, min.y, max.z],
                [max.x, max.y, min.z],
                [max.x, max.y, max.z],
              ];
              for (let c of corners) {
                tmpVec.set(c[0], c[1], c[2]).applyMatrix4(obj.matrixWorld);
                out.push(tmpVec.clone());
              }
            } else if (geom && geom.boundingSphere) {
              const bs = geom.boundingSphere;
              const center = bs.center.clone().applyMatrix4(obj.matrixWorld);
              const r = bs.radius * (obj.matrixWorld.getMaxScaleOnAxis ? obj.matrixWorld.getMaxScaleOnAxis() : 1);
              out.push(center.clone());
              out.push(center.clone().add(new THREE.Vector3(r, 0, 0)));
              out.push(center.clone().add(new THREE.Vector3(-r, 0, 0)));
              out.push(center.clone().add(new THREE.Vector3(0, r, 0)));
              out.push(center.clone().add(new THREE.Vector3(0, -r, 0)));
              out.push(center.clone().add(new THREE.Vector3(0, 0, r)));
              out.push(center.clone().add(new THREE.Vector3(0, 0, -r)));
            } else if (geom && geom.attributes && geom.attributes.position && geom.attributes.position.count > 0) {
              const posAttr = geom.attributes.position;
              const stride = Math.max(1, Math.floor(posAttr.count / 12));
              for (let i = 0; i < Math.min(12, posAttr.count); i += stride) {
                tmpVec.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)).applyMatrix4(obj.matrixWorld);
                out.push(tmpVec.clone());
              }
            } else {
              out.push(tmpPos.clone()); // fallback to center
            }
            return out;
          }

          // SPRITE / IMAGE objects: draw image centered at sampled screen pos
          if (mapImage) {
            let worldPoints = obj.geometry ? sampleWorldPoints(obj, obj.geometry) : [tmpPos.clone()];
            const dists = worldPoints.map(wp => camera.position.distanceTo(wp));
            const distNear = Math.min(...dists);
            const distFar = Math.max(...dists);
            drawables.push({ type: 'image', obj, sx, sy, distNear, distFar, projZ: proj.z, mapImage });
            return;
          }

          // MESH objects: build projected hull after near-plane clipping
          if (obj.isMesh && obj.geometry) {
            const geom = obj.geometry;
            if (!geom.boundingBox) geom.computeBoundingBox && geom.computeBoundingBox();
            if (!geom.boundingSphere) geom.computeBoundingSphere && geom.computeBoundingSphere();

            const worldPoints = sampleWorldPoints(obj, geom);
            if (worldPoints.length === 0) {
              if (obj.userData?.forceMarker) {
                drawables.push({ type: 'rect', obj, sx, sy, distNear: centerDist, distFar: centerDist, sizePx: obj.userData?.markerSizePx ?? 6 });
              }
              return;
            }

            const dists = worldPoints.map(wp => camera.position.distanceTo(wp));
            const distNear = Math.min(...dists);
            const distFar = Math.max(...dists);

            // camera-space check
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

            // edge intersections against near plane
            for (let i = 0; i < worldPoints.length; i++) {
              for (let j = i + 1; j < worldPoints.length; j++) {
                const z1 = camSpacePts[i].z, z2 = camSpacePts[j].z;
                if ((z1 <= nearZ && z2 > nearZ) || (z2 <= nearZ && z1 > nearZ)) {
                  const denom = (z2 - z1);
                  if (Math.abs(denom) < 1e-9) continue;
                  const t = (nearZ - z1) / denom;
                  if (t < 0 || t > 1) continue;
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
          }

          // fallback: only draw marker if requested by userData
          if (obj.userData?.forceMarker) {
            drawables.push({ type: 'rect', obj, sx, sy, distNear: centerDist, distFar: centerDist, sizePx: obj.userData?.markerSizePx ?? 6 });
          }
        }); // end traverse

        // Sort painter order by farthest distFar first (big spanning objects drawn behind)
        drawables.sort((a, b) => {
          const aFar = (a.distFar !== undefined) ? a.distFar : (a.dist !== undefined ? a.dist : 0);
          const bFar = (b.distFar !== undefined) ? b.distFar : (b.dist !== undefined ? b.dist : 0);
          if (aFar === bFar) {
            const aNear = (a.distNear !== undefined) ? a.distNear : (a.dist !== undefined ? a.dist : 0);
            const bNear = (b.distNear !== undefined) ? b.distNear : (b.dist !== undefined ? b.dist : 0);
            return bNear - aNear;
          }
          return bFar - aFar;
        });

        // DRAW PASS
        for (let i = 0; i < drawables.length; i++) {
          const d = drawables[i];
          const obj = d.obj;
          const avgDist = ((d.distNear ?? d.dist ?? 0) + (d.distFar ?? d.dist ?? 0)) * 0.5;

          // color resolution: prefer userData.color -> material color -> white
          let color = obj.userData?.color;
          if (!color && obj.material && obj.material.color) {
            try { color = obj.material.color.getStyle ? obj.material.color.getStyle() : (`#${obj.material.color.getHexString()}`); }
            catch (e) { color = obj.userData?.color || 'white'; }
          }
          color = color || obj.userData?.color || 'white';

          if (d.type === 'image' && d.mapImage && d.mapImage.width) {
            // compute size (use bbox if available)
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
          } else if (d.type === 'poly' && d.pts) {
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
          } else if (d.type === 'line' && d.pts && d.pts.length === 2) {
            ctx.beginPath();
            ctx.moveTo(d.pts[0].x, d.pts[0].y);
            ctx.lineTo(d.pts[1].x, d.pts[1].y);
            ctx.strokeStyle = color;
            ctx.lineWidth = obj.userData?.lineWidth ?? 3;
            ctx.globalAlpha = 1 - Math.min(0.9, avgDist * 0.002);
            ctx.stroke();
          } else if (d.type === 'rect') {
            const size = d.sizePx ?? Math.max(2, Math.round(12 * (1 / Math.max(0.1, avgDist * 0.05))));
            const x = (d.sx || d.sx === 0) ? d.sx : 0;
            const y = (d.sy || d.sy === 0) ? d.sy : 0;
            ctx.save();
            ctx.globalAlpha = Math.max(0.5, Math.min(1, 1 - (avgDist * 0.002)));
            ctx.fillStyle = color;
            ctx.fillRect(x - size / 2, y - size / 2, size, size);
            ctx.restore();
          }
        } // end draw loop

        // Debug overlay: show number of drawables + canvas id so you can verify target
        if (api.debug.enabled && api.debug.overlay) {
          ctx.save();
          ctx.fillStyle = 'rgba(0,0,0,0.5)';
          const pad = 6;
          const txt = `drawables: ${drawables.length}  id:${canvas.id}`;
          ctx.font = '12px monospace';
          const w = Math.min(canvas.width - 10, 8 + ctx.measureText(txt).width + pad * 2);
          ctx.fillRect(6, 6, w, 26);
          ctx.fillStyle = 'white';
          ctx.fillText(txt, 10 + pad / 2, 24);
          ctx.restore();
        }

        if (api.debug.enabled && !api.debug.overlay) {
          console.debug(`[voidEngine] render -> drawables=${drawables.length}`);
        }
      } catch (err) {
        console.error('[voidEngine] render exception:', err);
        // Draw a visible error box so it's obvious on screen
        try {
          ctx.save();
          ctx.fillStyle = 'rgba(255,0,0,0.12)';
          ctx.fillRect(0, 0, canvas.width, 32);
          ctx.fillStyle = 'white';
          ctx.font = '12px monospace';
          ctx.fillText('voidEngine render error: see console', 8, 20);
          ctx.restore();
        } catch (e) { /* best effort only */ }
      }
    }
  };

  // Immediately log id and draw a tiny test if debug requested
  if (api.debug.enabled) {
    console.info(`[voidEngine] created canvas id=${canvas.id}; call engine.attachTo(parent) to append it to the DOM.`);
    // quick visible test so you can visually check this exact canvas
    api.testDraw();
  }

  return api;
}

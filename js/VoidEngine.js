// voidEnginePlayCanvas.js
export function voidEnginePlayCanvas({ width = 1280, height = 720, playcanvasAttrs = {} } = {}) {
  // create overlay canvas (2D) — we'll draw bounding hulls, sprites, markers here
  const canvas = document.createElement('canvas');
  canvas.style.position = 'relative';
  canvas.style.zIndex = '0';
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');

  // create PlayCanvas canvas (we keep the engine canvas behind the overlay)
  const pcCanvas = document.createElement('canvas');
  pcCanvas.style.position = 'absolute';
  pcCanvas.style.left = '0';
  pcCanvas.style.top = '0';
  pcCanvas.style.zIndex = '-1';
  pcCanvas.width = width;
  pcCanvas.height = height;
  pcCanvas.style.width = `${width}px`;
  pcCanvas.style.height = `${height}px`;
  document.body.appendChild(pcCanvas);
  document.body.appendChild(canvas);

  // create PlayCanvas app
  const app = new pc.Application(pcCanvas, {
    mouse: new pc.Mouse(pcCanvas),
    touch: new pc.TouchDevice(pcCanvas),
    keyboard: new pc.Keyboard(window),
    ...playcanvasAttrs
  });

  // basic setup (camera + root scene)
  app.start();

  // set up a camera entity (if user will supply their own, you can replace this)
  const cameraEntity = new pc.Entity('camera');
  cameraEntity.addComponent('camera', {
    fov: 60,
    nearClip: 0.1,
    farClip: 1000
  });
  cameraEntity.setPosition(0, 0, 5);
  app.root.addChild(cameraEntity);

  // utility: devicePixelRatio correction (PlayCanvas can render at different internal sizes)
  function getDPIScale() {
    return window.devicePixelRatio || 1;
  }

  // reuse your convexHull implementation (copy/paste, unchanged)
  function convexHull(points) {
    if (points.length <= 1) return points.slice();
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

  // sample points for an entity.
  // This is intentionally generic: if the entity has a model or render component we try to use mesh aabb;
  // otherwise fallback to entity.getPosition().
  function sampleWorldPointsForEntity(entity) {
    const pts = [];

    // try model component -> model.meshInstances -> aabb
    if (entity.model && entity.model.model && entity.model.model.meshInstances && entity.model.model.meshInstances.length) {
      // gather world-space corners from mesh instance AABB (if available)
      const mi = entity.model.model.meshInstances[0];
      // meshInstance.aabb exists in PlayCanvas engine (axis-aligned bounding box)
      if (mi.aabb) {
        const aabb = mi.aabb; // has center and halfExtents in local space
        // local center + half extents -> build corners in local then transform to world
        const center = new pc.Vec3().copy(aabb.center);
        const he = new pc.Vec3().copy(aabb.halfExtents);
        const cx = center.x, cy = center.y, cz = center.z;
        const corners = [
          new pc.Vec3(cx - he.x, cy - he.y, cz - he.z),
          new pc.Vec3(cx - he.x, cy - he.y, cz + he.z),
          new pc.Vec3(cx - he.x, cy + he.y, cz - he.z),
          new pc.Vec3(cx - he.x, cy + he.y, cz + he.z),
          new pc.Vec3(cx + he.x, cy - he.y, cz - he.z),
          new pc.Vec3(cx + he.x, cy - he.y, cz + he.z),
          new pc.Vec3(cx + he.x, cy + he.y, cz - he.z),
          new pc.Vec3(cx + he.x, cy + he.y, cz + he.z)
        ];
        const worldTransform = entity.getWorldTransform(); // pc.Mat4
        for (let c of corners) {
          const wc = worldTransform.transformPoint(c);
          pts.push(wc.clone ? wc.clone() : new pc.Vec3(wc.x, wc.y, wc.z));
        }
        return pts;
      }
    }

    // fallback: world position, maybe add a few offsets to approximate size
    const center = entity.getPosition();
    pts.push(center.clone());
    // add small offsets as crude proxy for size
    pts.push(center.clone().add(new pc.Vec3(0.5, 0, 0)));
    pts.push(center.clone().add(new pc.Vec3(-0.5, 0, 0)));
    pts.push(center.clone().add(new pc.Vec3(0, 0.5, 0)));
    pts.push(center.clone().add(new pc.Vec3(0, -0.5, 0)));
    return pts;
  }

  // Build drawables similar to your original code
  function buildDrawables() {
    const drawables = [];
    const cam = cameraEntity.camera;

    // traverse all entities in the scene
    app.root.find(function (entity) {
      // skip if no render interest
      if (!entity.enabled) return;
      if (entity === cameraEntity) return;

      // optional: skip lights or UI-only etc.
      // if (!entity.render) return; // uncomment if you only want renderable entities

      const worldPoints = sampleWorldPointsForEntity(entity);

      // compute screen points using camera.worldToScreen
      const pts2d = [];
      for (let wp of worldPoints) {
        const out = new pc.Vec3();
        cam.worldToScreen(wp, out); // out.x/out.y = pixel coordinates relative to camera/canvas
        // Note: playcanvas worldToScreen returns coords in pixels. Double-check devicePixelRatio if you render at DPR
        pts2d.push({ x: out.x, y: out.y, ndcZ: out.z ?? 0 });
      }

      if (pts2d.length === 0) {
        return;
      }

      // build convex hull and push polygon drawable
      const hull = convexHull(pts2d);
      if (hull.length >= 3) {
        drawables.push({ type: 'poly', entity, pts: hull });
      } else if (hull.length === 2) {
        drawables.push({ type: 'line', entity, pts: hull });
      } else {
        drawables.push({ type: 'rect', entity, sx: hull[0].x, sy: hull[0].y });
      }
    });

    return drawables;
  }

  // overlay render: clear then draw drawables — you can reuse most of your old styles
  function renderOverlay() {
    // adjust for dpi if necessary
    const dpr = getDPIScale();
    const w = canvas.width;
    const h = canvas.height;

    // clear (use same style as before)
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = `rgba(0,0,0,1)`;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    const drawables = buildDrawables();

    // simple painter order: no distance sorting here, but you can compute distances similarly by reading entity.getPosition()
    for (let d of drawables) {
      if (d.type === 'poly') {
        ctx.beginPath();
        ctx.moveTo(d.pts[0].x / dpr, d.pts[0].y / dpr);
        for (let j = 1; j < d.pts.length; j++) ctx.lineTo(d.pts[j].x / dpr, d.pts[j].y / dpr);
        ctx.closePath();
        ctx.globalAlpha = 0.7;
        ctx.fillStyle = '#00ff00';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.stroke();
      } else if (d.type === 'line') {
        ctx.beginPath();
        ctx.moveTo(d.pts[0].x / dpr, d.pts[0].y / dpr);
        ctx.lineTo(d.pts[1].x / dpr, d.pts[1].y / dpr);
        ctx.strokeStyle = '#ff0';
        ctx.lineWidth = 3;
        ctx.stroke();
      } else if (d.type === 'rect') {
        const size = 8;
        ctx.fillStyle = '#fff';
        ctx.fillRect((d.sx - size/2) / dpr, (d.sy - size/2) / dpr, size, size);
      }
    }
  }

  // attach update loop: run PlayCanvas then overlay render each frame
  app.on('update', function (dt) {
    // PlayCanvas renders automatically; we just draw overlay on top on every frame
    renderOverlay();
  });

  // convenience API similar to your original voidEngine
  const api = {
    app,                 // PlayCanvas application (for user to directly manipulate scene)
    cameraEntity,
    domElement: canvas,
    pcCanvas,
    setSize(w, h) {
      canvas.width = w;
      canvas.height = h;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      pcCanvas.width = w;
      pcCanvas.height = h;
      pcCanvas.style.width = `${w}px`;
      pcCanvas.style.height = `${h}px`;
      // update PlayCanvas graphics device viewport
      app.graphicsDevice.resize(w, h);
      if (cameraEntity.camera) {
        cameraEntity.camera.aspectRatio = w / h;
      }
    },
    destroy() {
      app.destroy();
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      if (pcCanvas.parentNode) pcCanvas.parentNode.removeChild(pcCanvas);
    }
  };

  return api;
}

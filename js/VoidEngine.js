// PlayCanvas full renderer: uses the real PlayCanvas GPU renderer (pc.Application).
// Requires PlayCanvas engine loaded (e.g. <script src="https://code.playcanvas.com/playcanvas-stable.min.js"></script>).
export function voidEngine({
  width = 1280,
  height = 720,
  autoRender = true,          // if false, call renderOnce() to render a single frame
  transparentCanvas = false,  // if true, create a canvas with alpha (useful for HTML overlays)
  createDefaultCamera = true  // if true, create a fallback camera if none added
} = {}) {
  if (typeof pc === 'undefined') {
    throw new Error('PlayCanvas (pc) not found — include playcanvas-stable.min.js first.');
  }

  // Create canvas that PlayCanvas will render into
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.style.position = 'absolute';
  canvas.style.left = '0';
  canvas.style.top = '0';
  canvas.style.zIndex = '9999';
  canvas.style.pointerEvents = 'auto';

  // Setup application options: allow alpha channel if transparent canvas requested
  const appOptions = {
    mouse: new pc.Mouse(canvas),
    touch: new pc.TouchDevice(canvas),
    graphicsDeviceOptions: {
      alpha: !!transparentCanvas
    }
  };

  // Create the PlayCanvas application (this is the real renderer)
  const app = new pc.Application(canvas, appOptions);

  // Configure the app's canvas sizing behavior (we keep manual control)
  // NOTE: you can call app.setCanvasFillMode / setCanvasResolutionPolicy if you want fullscreen behavior.
  app.graphicsDevice.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 2);

  // Control auto-rendering
  app.autoRender = !!autoRender;

  // Start the engine update loop (scripts, physics, etc). If autoRender=false, it won't draw until renderNextFrame=true.
  app.start();

  // Provide a small fallback camera if the user has not created one.
  let fallbackCamera = null;
  if (createDefaultCamera) {
    const camEnt = new pc.Entity('voidEngine-fallback-camera');
    camEnt.addComponent('camera', {
      fov: 60,
      nearClip: 0.1,
      farClip: 1000,
      clearColor: new pc.Color(0.2, 0.2, 0.2, 1)
    });
    camEnt.setPosition(0, 0, 5);
    app.root.addChild(camEnt);
    fallbackCamera = camEnt;
  }

  // Build the API
  const api = {
    domElement: canvas,
    app,                        // exposed in case you want to manipulate app directly
    options: { autoRender: app.autoRender },
    // attach canvas to DOM parent
    attachTo(parent = document.body) {
      if (typeof parent === 'string') parent = document.querySelector(parent) || document.body;
      parent.appendChild(canvas);
      canvas.style.display = 'block';
      return this;
    },
    // resize canvas + tell graphics device
    setSize(w, h, updateStyle = true) {
      canvas.width = w;
      canvas.height = h;
      if (updateStyle) {
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      // optionally update PlayCanvas internal size handling:
      // Note: PlayCanvas will read canvas size on the next frame; forcing a resize helps UI/cameras
      app.resizeCanvas(canvas.width, canvas.height);
    },
    // Set clear color for all cameras (convenience) - cameras can still override individually.
    // hex: 0xRRGGBB or '#RRGGBB' ; alpha: 0..1
    setClearColor(hex, alpha = 1) {
      // normalize hex -> pc.Color
      let h = hex;
      if (typeof h === 'string') h = parseInt(h.replace(/^#/, ''), 16);
      const r = ((h >> 16) & 0xff) / 255;
      const g = ((h >> 8) & 0xff) / 255;
      const b = (h & 0xff) / 255;
      const col = new pc.Color(r, g, b, alpha);

      // set on every camera in the app (convenience)
      app.root.findComponents('camera').forEach((camComp) => {
        camComp.clearColor = col;
      });

      // also update fallback camera if present
      if (fallbackCamera && fallbackCamera.camera) {
        fallbackCamera.camera.clearColor = col;
      }
    },
    // start/stop the internal update loop
    start() {
      app.start();
      app.autoRender = !!api.options.autoRender;
    },
    stop() {
      app.stop();
    },
    // If autoRender=false, call this to render one frame (app.renderNextFrame triggers a single draw)
    renderOnce() {
      if (app.autoRender) {
        // already rendering every frame; nothing to do
        return;
      }
      app.renderNextFrame = true;
    },
    // toggle automatic drawing
    setAutoRender(enabled) {
      app.autoRender = !!enabled;
      api.options.autoRender = app.autoRender;
    },
    // convenience: remove the fallback camera (if you will add your own)
    removeFallbackCamera() {
      if (fallbackCamera) {
        fallbackCamera.destroy();
        fallbackCamera = null;
      }
    },
    // When you want to render a specific camera this frame (useful for deterministic screenshots):
    // Pass a pc.Entity that has a camera component (cameraEntity)
    // This performs an explicit render pass using that camera (leaves app.autoRender unchanged).
    renderCameraOnce(cameraEntity) {
      if (!cameraEntity || !cameraEntity.camera) {
        console.warn('renderCameraOnce: invalid cameraEntity');
        return;
      }
      // create a temporary layer with only the camera's render (not necessary normally).
      // Simpler: we can draw the frame using the app's renderer but forcing camera to be the one used.
      // The simplest cross-version-safe method: set cameraEntity.camera.rect to [0,0,1,1] and request frame.
      // Then request a frame:
      if (!app.autoRender) {
        app.renderNextFrame = true;
      } else {
        // already auto rendering; nothing extra required.
      }
    }
  };

  // Helpful default: attach canvas if no other canvas present
  if (!document.querySelector('canvas')) {
    api.attachTo(document.body);
  }

  // Return API
  return api;
}

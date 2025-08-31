// SimpleCanvasRenderer.js
class SimpleCanvasRenderer {
  constructor(opts = {}) {
    this.canvas = opts.canvas || document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.domElement = this.canvas;
    this.setSize(opts.width || window.innerWidth, opts.height || window.innerHeight);
    this.clearColor = opts.clearColor || '#000000';
    this.autoClear = opts.autoClear !== undefined ? opts.autoClear : true;
  }

  setSize(w, h) {
    this.width = Math.max(1, Math.floor(w));
    this.height = Math.max(1, Math.floor(h));
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.canvas.style.width = this.width + 'px';
    this.canvas.style.height = this.height + 'px';
    this.halfWidth = this.width / 2;
    this.halfHeight = this.height / 2;
  }

  // basic clear
  clear() {
    this.ctx.fillStyle = this.clearColor;
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  // public render(scene, camera)
  render(scene, camera) {
    if (!scene || !camera) return;
    // Basic checks for expected THREE types
    if (!camera.isCamera) {
      console.warn('SimpleCanvasRenderer: camera is not a THREE.Camera, abort render.');
      return;
    }
    if (!scene.isScene && !scene.isObject3D) {
      console.warn('SimpleCanvasRenderer: scene does not look like a THREE.Scene');
      return;
    }

    if (this.autoClear) this.clear();

    // Build list of renderable triangles: [{points:[{x,y,z},...], color, zAvg}]
    const triangles = [];

    // Cache some temp objects to avoid allocations in loops
    const vWorld = new THREE.Vector3();
    const vCamera = new THREE.Vector3();

    // Prepare camera matrices
    camera.updateMatrixWorld();
    const projScreenMatrix = new THREE.Matrix4().multiplyMatrices(
      camera.projectionMatrix,
      new THREE.Matrix4().getInverse(camera.matrixWorld)
    );

    // Traverse scene to collect meshes
    scene.traverse(obj => {
      if (!obj.visible) return;
      if (!obj.isMesh) return;

      const mesh = obj;
      const geometry = mesh.geometry;
      if (!geometry) return;

      // ensure world matrix
      mesh.updateMatrixWorld(true);

      // Get vertex positions and indexing
      let positions = null;
      let indices = null;
      if (geometry.isBufferGeometry) {
        const posAttr = geometry.attributes.position;
        if (!posAttr) return;
        positions = posAttr.array;
        if (geometry.index) indices = geometry.index.array;
      } else if (geometry.isGeometry) {
        // older Geometry
        positions = [];
        for (let v of geometry.vertices) {
          positions.push(v.x, v.y, v.z);
        }
        indices = [];
        for (let f of geometry.faces) {
          indices.push(f.a, f.b, f.c);
        }
      } else {
        return; // unknown geometry type
      }

      // helper: get position vector from index i
      function getVertexByIndex(i, outVec) {
        const ix = i * 3;
        outVec.set(positions[ix], positions[ix + 1], positions[ix + 2]);
      }

      // iterate triangles
      const getIndices = indices ? indices : null;
      const triCount = getIndices ? (getIndices.length / 3) : (positions.length / 9);

      const worldMatrix = mesh.matrixWorld;

      for (let t = 0; t < triCount; t++) {
        let aIndex, bIndex, cIndex;
        if (getIndices) {
          aIndex = getIndices[t * 3];
          bIndex = getIndices[t * 3 + 1];
          cIndex = getIndices[t * 3 + 2];
        } else {
          aIndex = t * 3;
          bIndex = t * 3 + 1;
          cIndex = t * 3 + 2;
        }

        // world-space
        const pA = new THREE.Vector3();
        const pB = new THREE.Vector3();
        const pC = new THREE.Vector3();
        getVertexByIndex(aIndex, pA);
        getVertexByIndex(bIndex, pB);
        getVertexByIndex(cIndex, pC);

        pA.applyMatrix4(worldMatrix);
        pB.applyMatrix4(worldMatrix);
        pC.applyMatrix4(worldMatrix);

        // Project to clip space: clip = projection * view * world
        const clipA = pA.clone().applyMatrix4(projScreenMatrix);
        const clipB = pB.clone().applyMatrix4(projScreenMatrix);
        const clipC = pC.clone().applyMatrix4(projScreenMatrix);

        // clip coordinates are homogeneous; do perspective divide
        if (Math.abs(clipA.w || 1) < 1e-9 || Math.abs(clipB.w || 1) < 1e-9 || Math.abs(clipC.w || 1) < 1e-9) {
          continue;
        }
        clipA.x /= (clipA.w || 1); clipA.y /= (clipA.w || 1); clipA.z /= (clipA.w || 1);
        clipB.x /= (clipB.w || 1); clipB.y /= (clipB.w || 1); clipB.z /= (clipB.w || 1);
        clipC.x /= (clipC.w || 1); clipC.y /= (clipC.w || 1); clipC.z /= (clipC.w || 1);

        // Culling: if all vertices are outside clip space, skip (simple)
        const outside =
          (clipA.x < -1 && clipB.x < -1 && clipC.x < -1) ||
          (clipA.x > 1 && clipB.x > 1 && clipC.x > 1) ||
          (clipA.y < -1 && clipB.y < -1 && clipC.y < -1) ||
          (clipA.y > 1 && clipB.y > 1 && clipC.y > 1) ||
          (clipA.z < -1 && clipB.z < -1 && clipC.z < -1) ||
          (clipA.z > 1 && clipB.z > 1 && clipC.z > 1);
        if (outside) continue;

        // screen coords
        const sA = { x: clipA.x * this.halfWidth + this.halfWidth, y: -clipA.y * this.halfHeight + this.halfHeight, z: clipA.z };
        const sB = { x: clipB.x * this.halfWidth + this.halfWidth, y: -clipB.y * this.halfHeight + this.halfHeight, z: clipB.z };
        const sC = { x: clipC.x * this.halfWidth + this.halfWidth, y: -clipC.y * this.halfHeight + this.halfHeight, z: clipC.z };

        const zAvg = (sA.z + sB.z + sC.z) / 3;

        // color
        let color = '#888';
        const mat = mesh.material;
        if (Array.isArray(mat)) {
          // if multiple materials, try to pick first (no groups handling)
          if (mat[0] && mat[0].color) color = mat[0].color.getStyle();
        } else if (mat && mat.color) {
          color = mat.color.getStyle();
        }

        triangles.push({
          points: [sA, sB, sC],
          color,
          zAvg,
          visible: mesh.visible
        });
      } // triangles of mesh
    }); // traverse

    // painter's algorithm: draw from far (large z) to near (small z)
    triangles.sort((A, B) => B.zAvg - A.zAvg);

    // Draw triangles
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    for (const tri of triangles) {
      const p0 = tri.points[0], p1 = tri.points[1], p2 = tri.points[2];
      // Backface cull in screen space: compute signed area
      const area = (p1.x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (p1.y - p0.y);
      if (area >= 0) continue; // cull clockwise / backfaces (tweak if needed)

      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.closePath();

      ctx.fillStyle = tri.color;
      ctx.fill();
      // optional stroke:
      // ctx.strokeStyle = '#00000022';
      // ctx.stroke();
    }
    ctx.restore();
  }
}

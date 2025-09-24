// weapons.js (full updated file)
// Engine-agnostic PlayCanvas <-> Three.js friendly WeaponController + helpers

import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";
import { PhysicsController } from "./physics.js";
import { localPlayerId } from "./network.js";
import { updateCrosshair } from "./game.js";
import { getSpreadMultiplier, getSpreadDirection, getRecoilAngle, ADS_FOV } from './cs2_logic.js';
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { sendTracer, sendSoundEvent } from "./network.js";
import { updateAmmoDisplay, updateInventory } from "./ui.js";
import { mergeBufferGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { sendBulletHole } from "./network.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Loader } from './Loader.js';

// ----------------------- small materials and helpers -----------------------
function createMetalMaterial(color) {
  return new THREE.MeshStandardMaterial({ color: color, metalness: 0.9, roughness: 0.3, envMapIntensity: 1 });
}
function createPlasticMaterial(color) {
  return new THREE.MeshStandardMaterial({ color: color, metalness: 0.1, roughness: 0.8 });
}
function createWoodMaterial(color) {
  return new THREE.MeshStandardMaterial({ color: color, metalness: 0.0, roughness: 0.7 });
}
function createSkinMaterial(color = "#f5be90") {
  return new THREE.MeshStandardMaterial({ color, metalness: 0.1, roughness: 0.8 });
}
function createGlassMaterial(color, opacity) {
  return new THREE.MeshPhysicalMaterial({ color, metalness: 0, roughness: 0.1, transmission: 0.9, transparent: true, opacity, ior: 1.5, thickness: 0.1 });
}

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
export const _prototypeModels = window._prototypeModels = window._prototypeModels || {};
// Detection helpers
function isPcEntity(ent) {
  return !!ent && typeof ent.setLocalPosition === 'function' && typeof ent.setLocalScale === 'function';
}
function isThreeObject(ent) {
  return typeof THREE !== "undefined" && !!ent && (ent.isObject3D || (ent.position && ent.rotation && ent.scale));
}
function isContainerResourceLike(ent) {
  return ent && ent.children && ent.children.length !== undefined;
}

// Generic transform applier (handles pc Entities, THREE objects, and container-like)
function setEntityTransform(ent, posVec3 = {x:0,y:0,z:0}, rotDegVec3 = {x:0,y:0,z:0}, scaleVec3 = {x:1,y:1,z:1}) {
  const pos = { x: posVec3.x, y: posVec3.y, z: posVec3.z };
  const rot = { x: rotDegVec3.x, y: rotDegVec3.y, z: rotDegVec3.z };
  const scl = { x: scaleVec3.x, y: scaleVec3.y, z: scaleVec3.z };
  try {
    if (isPcEntity(ent)) {
      ent.setLocalPosition(pos.x, pos.y, pos.z);
      ent.setLocalEulerAngles(rot.x, rot.y, rot.z);
      ent.setLocalScale(scl.x, scl.y, scl.z);
      return;
    }
    if (isThreeObject(ent)) {
      ent.position.set(pos.x, pos.y, pos.z);
      ent.rotation.set(rot.x * DEG_TO_RAD, rot.y * DEG_TO_RAD, rot.z * DEG_TO_RAD);
      if (ent.scale) ent.scale.set(scl.x, scl.y, scl.z);
      return;
    }
    if (isContainerResourceLike(ent) && ent.children && ent.children.length) {
      const rootChild = ent.children[0];
      setEntityTransform(rootChild, pos, rot, scl);
      return;
    }
    // Last fallback - assign properties where possible
    if (ent) {
      if ('position' in ent && ent.position && typeof ent.position.set === 'function') ent.position.set(pos.x, pos.y, pos.z);
      if ('rotation' in ent && ent.rotation && typeof ent.rotation.set === 'function') ent.rotation.set(rot.x*DEG_TO_RAD, rot.y*DEG_TO_RAD, rot.z*DEG_TO_RAD);
      if ('scale' in ent && ent.scale && typeof ent.scale.set === 'function') ent.scale.set(scl.x, scl.y, scl.z);
    }
  } catch (e) {
    console.warn("setEntityTransform failed", e);
  }
}

// Per-weapon base transforms (tweak these numbers to change placement/scale)
function applyCommonTransforms(ent, key) {
  // reset
  setEntityTransform(ent, {x:0,y:0,z:0}, {x:0,y:0,z:0}, {x:1,y:1,z:1});
  switch ((key||"").toLowerCase()) {
    case "knife":
      setEntityTransform(ent, { x: 0.5, y: -0.1, z: -0.7 }, { x: 90, y: 160, z: 0 }, { x: 0.001, y: 0.001, z: 0.001 });
      break;
    case "deagle":
    case "legion":
    case "m79":
      setEntityTransform(ent,
        { x: 0.15 * (window.innerWidth / 1920), y: 0.1 * (window.innerHeight / 1080), z: -0.1 * (window.innerWidth / 1920) },
        { x: 7, y: 180, z: 0 },
        { x: 0.3, y: 0.3, z: 0.3 }
      );
      break;
    case "ak47":
    case "viper":
      setEntityTransform(ent,
        { x: 0.35 * (window.innerWidth / 1920), y: -0.15 * (window.innerHeight / 1080), z: -0.3 * (window.innerWidth / 1920) },
        { x: 4, y: 180, z: 0 },
        { x: 0.4, y: 0.4, z: 0.4 }
      );
      break;
    case "marshal":
      setEntityTransform(ent,
        { x: 0.15 * (window.innerWidth / 1920), y: 0.15 * (window.innerHeight / 1080), z: -0.1 * (window.innerWidth / 1920) },
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 1 }
      );
      break;
    default:
      break;
  }
}

// Robust PlayCanvas getter (returns app or null)
function getPlayCanvasApp() {
  if (typeof window !== "undefined" && window.playcanvasApp) return window.playcanvasApp;
  if (typeof pc !== "undefined" && pc.Application && typeof pc.Application.getApplication === "function") {
    try { return pc.Application.getApplication(); } catch (e) { return null; }
  }
  return null;
}


// -------------------- Tracer (PlayCanvas-friendly) --------------------
export const activeTracers = [];

export class AnimatedTracer {
  constructor(origin, target, speed = 500, opts = {}) {
    if (typeof pc === "undefined") throw new Error("PlayCanvas (pc) required for AnimatedTracer.");
    const toVec = (v) => {
      if (!v) return new pc.Vec3();
      if (v instanceof pc.Vec3) return v.clone();
      if (v.x !== undefined && v.y !== undefined && v.z !== undefined) return new pc.Vec3(v.x, v.y, v.z);
      return new pc.Vec3();
    };
    this.origin = toVec(origin);
    this.target = toVec(target);
    this.direction = new pc.Vec3();
    this.direction.sub2(this.target, this.origin).normalize();
    this.distance = this.origin.distance(this.target);
    this.speed = speed;
    this.traveledDistance = 0;
    this.initialOpacity = 1.0;
    this.remove = false;

    this.length = typeof opts.length === "number" ? opts.length : 20;
    this.width = typeof opts.width === "number" ? opts.width : 0.05;
    this.height = typeof opts.height === "number" ? opts.height : 0.05;
    this.colorHex = typeof opts.color === "number" ? opts.color : 0xffa500;

    this.entity = new pc.Entity("tracer");
    this.entity.addComponent("model", { type: "box" });
    this.material = new pc.StandardMaterial();
    const r = ((this.colorHex >> 16) & 0xff) / 255;
    const g = ((this.colorHex >> 8) & 0xff) / 255;
    const b = (this.colorHex & 0xff) / 255;
    this.material.diffuse = new pc.Color(r, g, b);
    this.material.emissive = new pc.Color(r * 0.6, g * 0.6, b * 0.6);
    this.material.blendType = pc.BLEND_ADDITIVE;
    this.material.opacity = this.initialOpacity;
    this.material.update();
    try { this.entity.model.material = this.material; } catch (e) { console.warn("assign tracer material failed", e); }
    this.entity.setLocalScale(this.width, this.height, this.length);

    const dx = this.direction.x, dy = this.direction.y, dz = this.direction.z;
    const yaw = Math.atan2(dx, dz);
    const horizontalLen = Math.sqrt(dx*dx + dz*dz);
    const pitch = Math.atan2(-dy, horizontalLen);
    const pitchDeg = pitch * RAD_TO_DEG, yawDeg = yaw * RAD_TO_DEG;

    this.entity.setLocalEulerAngles(pitchDeg, yawDeg, 0);
    const half = this.length * 0.5;
    const pos = new pc.Vec3();
    pos.copy(this.origin).add(this.direction.clone().scale(half));
    this.entity.setPosition(pos);

    const root = (window.scene && window.scene instanceof pc.Entity) ? window.scene : (window.playcanvasApp && window.playcanvasApp.root);
    if (root && typeof root.addChild === "function") root.addChild(this.entity);
    window.activeTracers.push(this);
    this._ensureGlobalUpdateHook();
  }

  _ensureGlobalUpdateHook() {
    if (window._pcTracerUpdateAttached) return;
    const pcApp = window.playcanvasApp;
    if (!pcApp || typeof pcApp.on !== "function") {
      let last = performance.now();
      const rafLoop = (t) => {
        const dt = (t - last) / 1000;
        last = t;
        (window.activeTracers || []).forEach(tr => { try { tr.update(dt); } catch (e) {} });
        (window.activeTracers || []).forEach((tr, i) => { if (tr.remove) { tr.dispose(); window.activeTracers.splice(i,1); } });
        window._pcTracerRaf = requestAnimationFrame(rafLoop);
      };
      window._pcTracerRaf = requestAnimationFrame(rafLoop);
      window._pcTracerUpdateAttached = true;
      return;
    }
    pcApp.on("update", (dt) => {
      const arr = window.activeTracers || [];
      for (let i = arr.length - 1; i >= 0; i--) {
        try { arr[i].update(dt); } catch (e) { console.warn("tracer update error", e); }
        if (arr[i].remove) { try { arr[i].dispose(); } catch(e){}; arr.splice(i,1); }
      }
    });
    window._pcTracerUpdateAttached = true;
  }

  update(deltaTime) {
    if (this.remove) return;
    const moveAmount = this.speed * deltaTime;
    this.traveledDistance += moveAmount;
    const traveledForPosition = Math.min(this.traveledDistance, this.distance);
    const half = this.length * 0.5;
    const pos = new pc.Vec3();
    pos.copy(this.origin).add(this.direction.clone().scale(traveledForPosition + half));
    this.entity.setPosition(pos);

    const remainingDistance = this.distance - this.traveledDistance;
    const fadeOutStart = Math.max(0.001, this.speed * 0.01);
    if (remainingDistance < fadeOutStart) {
      const frac = Math.max(0, remainingDistance / fadeOutStart);
      this.material.opacity = this.initialOpacity * frac;
      this.material.update();
    }

    if (this.traveledDistance >= this.distance) this.remove = true;
  }

  dispose() {
    try { if (this.entity && this.entity._parent) this.entity._parent.removeChild(this.entity); } catch (e) {}
    try { if (this.entity) this.entity.destroy(); } catch (e) {}
    try { if (this.material && typeof this.material.destroy === "function") this.material.destroy(); } catch (e) {}
    if (window.activeTracers) {
      const idx = window.activeTracers.indexOf(this);
      if (idx !== -1) window.activeTracers.splice(idx, 1);
    }
  }
}

// -------------------- PlayCanvas BulletHoleManager + debug dot --------------------
(function(global){
  const DEFAULT_APP = () => window.playcanvasApp || (pc && pc.Application && pc.Application.getApplication && pc.Application.getApplication());

  const PCBulletHoleManager = {
    bulletHoles: {},
    addBulletHole(holeData, firebaseKey, opts = {}) {
      const app = DEFAULT_APP();
      if (!app) { console.warn("PCBulletHoleManager: no app"); return; }
      if (!holeData || !firebaseKey) return;
      if (this.bulletHoles[firebaseKey]) return;
      const { x=0,y=0,z=0,nx=0,ny=1,nz=0, timeCreated=Date.now() } = holeData;
      const fadeDuration = typeof opts.fadeDuration === "number" ? opts.fadeDuration : 5.0;
      const size = typeof opts.size === "number" ? opts.size : 0.15;

      const hole = new pc.Entity("bulletHole");
      hole.addComponent("model", { type: "plane" });
      hole.setLocalScale(size, size, 1);

      const mat = new pc.StandardMaterial();
      mat.emissive = new pc.Color(0.07,0.07,0.07);
      mat.blendType = pc.BLEND_NORMAL;
      mat.opacity = 0.85;
      mat.update();
      try { hole.model.material = mat; } catch (e) {
        if (hole.model && hole.model.meshInstances) for (let mi of hole.model.meshInstances) mi.material = mat;
      }

      hole.setPosition(x,y,z);
      const normal = new pc.Vec3(nx,ny,nz).normalize();
      const target = new pc.Vec3(x+normal.x, y+normal.y, z+normal.z);
      hole.lookAt(target);
      hole.translate(normal.scale(0.002));

      app.root.addChild(hole);
      this.bulletHoles[firebaseKey] = { entity: hole, material: mat };

      const age = (Date.now() - timeCreated) / 1000;
      const start = performance.now() / 1000 - age;
      const animate = () => {
        const now = performance.now() / 1000;
        const elapsed = now - start;
        if (!this.bulletHoles[firebaseKey] || !hole || !hole.parent) {
          if (hole && hole.parent) hole.parent.removeChild(hole);
          if (mat && typeof mat.destroy === "function") mat.destroy();
          delete this.bulletHoles[firebaseKey];
          return;
        }
        if (elapsed >= fadeDuration) {
          if (hole && hole.parent) hole.parent.removeChild(hole);
          try { hole.destroy(); } catch (e) {}
          try { if (mat && typeof mat.destroy === "function") mat.destroy(); } catch (e) {}
          delete this.bulletHoles[firebaseKey];
        } else {
          const o = pc.math.lerp(0.85, 0.0, elapsed / fadeDuration);
          if (mat) { mat.opacity = o; mat.update(); }
          requestAnimationFrame(animate);
        }
      };
      requestAnimationFrame(animate);
      return hole;
    },
    removeBulletHole(firebaseKey) {
      if (!this.bulletHoles || !this.bulletHoles[firebaseKey]) return;
      const entry = this.bulletHoles[firebaseKey];
      try { if (entry.entity && entry.entity.parent) entry.entity.parent.removeChild(entry.entity); if (entry.entity) entry.entity.destroy(); } catch (e){}
      try { if (entry.material && typeof entry.material.destroy === "function") entry.material.destroy(); } catch (e) {}
      delete this.bulletHoles[firebaseKey];
    }
  };

  function addDebugMuzzleDot(muzzleEntity, dotSize = 0.02, colorHex = 0xff0000) {
    const app = DEFAULT_APP();
    if (!app) { console.warn("addDebugMuzzleDot: no app"); return null; }
    if (!muzzleEntity) return null;
    const dot = new pc.Entity("DebugMuzzleDot");
    dot.addComponent("model", { type: "sphere" });
    dot.setLocalScale(dotSize, dotSize, dotSize);

    const mat = new pc.StandardMaterial();
    const r = ((colorHex >> 16) & 0xff) / 255;
    const g = ((colorHex >> 8) & 0xff) / 255;
    const b = (colorHex & 0xff) / 255;
    mat.emissive = new pc.Color(r * 0.9, g * 0.1, b * 0.1);
    mat.blendType = pc.BLEND_ADDITIVE;
    mat.opacity = 1.0;
    mat.update();
    try { dot.model.material = mat; } catch (e) {
      if (dot.model && dot.model.meshInstances) for (let mi of dot.model.meshInstances) mi.material = mat;
    }

    muzzleEntity.addChild(dot);
    return dot;
  }

  global.PCBulletHoleManager = PCBulletHoleManager;
  global.pcBulletHoles = PCBulletHoleManager.bulletHoles;
  global.addPlaycanvasDebugMuzzleDot = addDebugMuzzleDot;
})(window);

// -------------------- PCWeaponBuilder (generic GLB loader -> weaponRoot + parts) --------------------
class PCWeaponBuilder {
  constructor(opts = {}) {
       this.app = opts.app || getPlayCanvasApp();
    this.viewModel = opts.viewModel || null;
    if (!this.app) console.warn("PCWeaponBuilder: PlayCanvas app not found.");
  }

  _loadGlb(url) {
    const app = this.app;
    return new Promise((res, rej) => {
      if (!app) return rej(new Error("PlayCanvas app not available"));
      app.assets.loadFromUrl(url, "container", (err, asset) => {
        if (err) return rej(err);
        let inst = null;
        try {
          const container = asset.resource;
          if (container.instantiateRenderEntity) inst = container.instantiateRenderEntity();
          else if (container.instantiateModelEntity) inst = container.instantiateModelEntity();
          else if (container.instantiate) inst = container.instantiate();
        } catch (e) {
          console.warn("_loadGlb instantiate error", e);
        }
        if (!inst) return rej(new Error("instantiate returned null"));
        try { if (inst.parent) inst.parent.removeChild(inst); } catch {}
        res(inst);
      });
    });
  }

  _computeCombinedAabb(rootEntity) {
    if (!rootEntity) return null;
    const INF = Number.POSITIVE_INFINITY;
    const min = new pc.Vec3(INF, INF, INF);
    const max = new pc.Vec3(-INF, -INF, -INF);
    let found = false;
    const visit = (ent) => {
      if (!ent) return;
      if (ent.model && ent.model.model && ent.model.model.meshInstances) {
        for (let mi of ent.model.model.meshInstances) {
          if (mi.aabb) {
            const aMin = mi.aabb.getMin();
            const aMax = mi.aabb.getMax();
            const node = mi.node || ent;
            const wt = node.getWorldTransform();
            const corners = [
              new pc.Vec3(aMin.x, aMin.y, aMin.z),
              new pc.Vec3(aMax.x, aMin.y, aMin.z),
              new pc.Vec3(aMin.x, aMax.y, aMin.z),
              new pc.Vec3(aMin.x, aMin.y, aMax.z),
              new pc.Vec3(aMax.x, aMax.y, aMin.z),
              new pc.Vec3(aMax.x, aMin.y, aMax.z),
              new pc.Vec3(aMin.x, aMax.y, aMax.z),
              new pc.Vec3(aMax.x, aMax.y, aMax.z),
            ];
            for (let c of corners) {
              const wc = wt.transformPoint(c);
              min.x = Math.min(min.x, wc.x);
              min.y = Math.min(min.y, wc.y);
              min.z = Math.min(min.z, wc.z);
              max.x = Math.max(max.x, wc.x);
              max.y = Math.max(max.y, wc.y);
              max.z = Math.max(max.z, wc.z);
              found = true;
            }
          }
        }
      }
      const children = ent.children ? ent.children.slice() : [];
      for (let ch of children) visit(ch);
    };
    visit(rootEntity);
    if (!found) return null;
    return { min, max, center: new pc.Vec3((min.x + max.x)/2, (min.y + max.y)/2, (min.z + max.z)/2) };
  }

  _buildGeneric(url, opts = {}) {
    const promise = this._loadGlb(url).then((inst) => {
      const weaponRoot = new pc.Entity("weaponRoot");
      weaponRoot.enabled = true;
      weaponRoot.addChild(inst);
      if (this.viewModel && typeof this.viewModel.addChild === 'function') this.viewModel.addChild(weaponRoot);
      else if (this.app && this.app.root) this.app.root.addChild(weaponRoot);

      const aabb = this._computeCombinedAabb(inst);
      if (aabb && inst.translate) {
        try {
          const wt = inst.getWorldTransform();
          const inv = wt.clone().invert();
          const localCenter = inv.transformPoint(aabb.center);
          inst.translate(-localCenter.x, -localCenter.y, -localCenter.z);
        } catch (e) {}
      }

      const parts = {};
      const searchParts = (ent) => {
        if (!ent) return;
        const n = (ent.name || "").toLowerCase();
        if (n) {
          if (!parts.blade && (n.includes("ater") || n.includes("blade"))) parts.blade = ent;
          if (!parts.handle && (n.includes("ahva") || n.includes("handle") || n.includes("grip"))) parts.handle = ent;
          if (!parts.ring && (n.includes("sormensi") || n.includes("ring") || n.includes("guard"))) parts.ring = ent;
          if (!parts.muzzle && n === "muzzle") parts.muzzle = ent;
        }
        if (ent.children) for (let ch of ent.children) searchParts(ch);
      };
      searchParts(inst);

      if (!parts.muzzle) {
        const muzzle = new pc.Entity("Muzzle");
        muzzle.setLocalPosition(0,0,0);
        weaponRoot.addChild(muzzle);
        parts.muzzle = muzzle;
        const aabb2 = this._computeCombinedAabb(inst);
        if (aabb2) {
          try {
            const invRoot = weaponRoot.getWorldTransform().clone().invert();
            const local = invRoot.transformPoint(aabb2.max);
            muzzle.setLocalPosition(local.x, local.y, local.z);
          } catch (e) {
            muzzle.setLocalPosition(0, 0.5, 0);
          }
        } else {
          muzzle.setLocalPosition(0,0.5,0);
        }
      }

      weaponRoot.setLocalScale(1,1,1);
      weaponRoot.setLocalEulerAngles(0,0,0);
      weaponRoot.setLocalPosition(0,0,0);

      return { weaponRoot, parts };
    });
    return { promise, register: cb => {} };
  }

  buildKnife() { return this._buildGeneric('https://raw.githubusercontent.com/thearthd/3d-models/main/Weapon/voidffa_knife_V6.glb'); }
  buildDeagle() { return this._buildGeneric('https://raw.githubusercontent.com/thearthd/3d-models/main/Weapon/voidffa_deagle.glb'); }
  buildLegion() { return this._buildGeneric('https://raw.githubusercontent.com/thearthd/3d-models/main/Legion1212.glb'); }
  buildAK47() { return this._buildGeneric('https://raw.githubusercontent.com/thearthd/3d-models/main/Weapon/voidffa_AK47_V2.glb'); }
  buildViper() { return this._buildGeneric('https://raw.githubusercontent.com/thearthd/3d-models/main/Viper.glb'); }
  buildMarshal() { return this._buildGeneric('https://raw.githubusercontent.com/thearthd/3d-models/main/svd_sniper_rfile.glb'); }
  buildM79() { return this._buildGeneric('https://raw.githubusercontent.com/thearthd/3d-models/main/M-79.glb'); }
}
window.PCWeaponBuilder = PCWeaponBuilder;

// -------------------- Prototype preloader (PlayCanvas) --------------------
export async function preloadWeaponPrototypes(onComplete) {
  const names = ['knife','deagle','ak47','marshal','m79','viper','legion'];
  window._pcPrototypeModels = window._pcPrototypeModels || {};
  const pcApp = (typeof pc !== 'undefined' && pc.Application && pc.Application.getApplication) ? pc.Application.getApplication() : window.playcanvasApp;
  if (!pcApp) {
    console.warn("preloadWeaponPrototypes: playcanvas app not found");
    onComplete && onComplete();
    return;
  }

  const urlMap = {
    knife: 'https://raw.githubusercontent.com/thearthd/3d-models/main/Weapon/voidffa_knife_V6.glb',
    deagle: 'https://raw.githubusercontent.com/thearthd/3d-models/main/Weapon/voidffa_deagle.glb',
    ak47: 'https://raw.githubusercontent.com/thearthd/3d-models/main/Weapon/voidffa_AK47_V2.glb',
    marshal: 'https://raw.githubusercontent.com/thearthd/3d-models/main/svd_sniper_rfile.glb',
    m79: 'https://raw.githubusercontent.com/thearthd/3d-models/main/M-79.glb',
    viper: 'https://raw.githubusercontent.com/thearthd/3d-models/main/Viper.glb',
    legion: 'https://raw.githubusercontent.com/thearthd/3d-models/main/Legion1212.glb'
  };

  const loaderUI = (typeof Loader === "function") ? new Loader() : null;
  if (loaderUI && loaderUI.show) loaderUI.show('Loading weapons...', names.map(()=>1/names.length));

  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const url = urlMap[name];
    if (!url) continue;
    await new Promise((resolve) => {
      pcApp.assets.loadFromUrl(url, "container", (err, asset) => {
        if (err) {
          console.warn(`[preload] failed to load ${name}:`, err);
          resolve();
          return;
        }
        let rootEnt = null;
        try {
          if (asset.resource.instantiateRenderEntity) rootEnt = asset.resource.instantiateRenderEntity();
          else if (asset.resource.instantiateModelEntity) rootEnt = asset.resource.instantiateModelEntity();
          else if (asset.resource.instantiate) rootEnt = asset.resource.instantiate();
        } catch (e) {
          console.warn(`[preload] instantiate failed for ${name}:`, e);
        }
        if (!rootEnt) { resolve(); return; }
        try { if (rootEnt.parent) rootEnt.parent.removeChild(rootEnt); } catch {}
        rootEnt.enabled = false;
        window._pcPrototypeModels[name] = rootEnt;
        resolve();
      });
    });
    if (loaderUI && loaderUI.track) {
      try { loaderUI.track(1/names.length, Promise.resolve()); } catch {}
    }
  }
  if (loaderUI && loaderUI.onComplete) loaderUI.onComplete();
  onComplete && onComplete();
}
preloadWeaponPrototypes(() => console.log("✅ PlayCanvas prototypes loaded (weapons)"));


// -------------------- getWeaponModel helper for THREE prototypes --------------------
export function getWeaponModel(name) {
  const proto = _prototypeModels && _prototypeModels[name];
  if (!proto) {
    console.warn(`No THREE prototype for weapon ${name}`);
    return new THREE.Group();
  }
  try {
    return proto.clone(true);
  } catch (e) {
    return new THREE.Group();
  }
}

// -------------------- Vector/Spread helpers used in fireBullet --------------------
function plainClone(v) { return { x: v.x || 0, y: v.y || 0, z: v.z || 0 }; }
function plainLength(v) { return Math.sqrt(v.x*v.x + v.y*v.y + v.z*v.z); }
function plainNormalize(v) {
  const L = plainLength(v) || 1;
  return { x: v.x / L, y: v.y / L, z: v.z / L };
}
function plainAdd(a,b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
function plainScale(a, s) { return { x: a.x * s, y: a.y * s, z: a.z * s }; }
function plainCross(a,b) {
  return { x: a.y*b.z - a.z*b.y, y: a.z*b.x - a.x*b.z, z: a.x*b.y - a.y*b.x };
}
function applySpreadToPCVec(dirInput, spreadDeg) {
  if (!dirInput) return (typeof pc !== "undefined") ? new pc.Vec3(0,0,1) : {x:0,y:0,z:1};
  const dirPlain = plainClone(dirInput);
  const dirLen = plainLength(dirPlain);
  if (dirLen === 0) return (typeof pc !== "undefined") ? new pc.Vec3(0,0,1) : {x:0,y:0,z:1};
  const dir = plainNormalize(dirPlain);
  const spreadRad = (spreadDeg || 0) * Math.PI / 180;
  if (spreadRad <= 0) return (typeof pc !== "undefined") ? new pc.Vec3(dir.x, dir.y, dir.z) : {x:dir.x,y:dir.y,z:dir.z};
  const up = (Math.abs(dir.y) < 0.99) ? { x:0, y:1, z:0 } : { x:1, y:0, z:0 };
  let right = plainCross(dir, up);
  if (plainLength(right) === 0) right = { x:1, y:0, z:0 };
  right = plainNormalize(right);
  let realUp = plainCross(right, dir);
  if (plainLength(realUp) === 0) realUp = { x:0, y:1, z:0 };
  realUp = plainNormalize(realUp);
  const theta = Math.random() * 2 * Math.PI;
  const u = Math.random();
  const r = Math.sqrt(u) * Math.tan(spreadRad);
  const offset = plainAdd(plainScale(right, Math.cos(theta) * r), plainScale(realUp, Math.sin(theta) * r));
  const resultPlain = plainNormalize(plainAdd(dir, offset));
  return (typeof pc !== "undefined") ? new pc.Vec3(resultPlain.x, resultPlain.y, resultPlain.z) : resultPlain;
}

// -------------------- WeaponController class --------------------
export class WeaponController {
  static WEAPONS = {
    knife: { name: "Knife", bodyDamage: 70, isMelee: true, magazineSize: Infinity, swingTime: 300/600, heavySwingTime: 300/600, pullDuration: 300/600/2, reloadDuration: null, speedModifier: 1.0, rpm: 120, tracerLength: 0, damageDropOff: { body: [70] } },
    deagle: { name: "Desert Eagle", isMelee: false, headshotDamage: 180, bodyDamage: 76, fireRateRPM: 125, magazineSize: 8, reloadDuration: 1.8, pullDuration: 0.5, recoilDistance: 0.08, recoilDuration: 0.08, tracerLength: 100, speedModifier: 0.9, damageDropOff: { head:[180,160,140], body:[76,66,56] } },
    "ak-47": { name: "AK-47", isMelee: false, headshotDamage: 100, bodyDamage: 30, fireRateRPM: 600, magazineSize: 25, reloadDuration: 2.5, pullDuration: 0.6, recoilDistance: 0.07, recoilDuration: 0.06, tracerLength: 100, speedModifier: 0.7, damageDropOff: { head:[100,80,60], body:[30,26,22] } },
    viper: { name: "Viper", isMelee: false, headshotDamage: 60, bodyDamage: 20, fireRateRPM: 800, magazineSize: 35, reloadDuration: 2.1, pullDuration: 0.6, recoilDistance: 0.07, recoilDuration: 0.06, tracerLength: 50, speedModifier: 0.8, damageDropOff: { head:[60,50,40], body:[20,16,12] } },
    marshal: { name: "Marshal", isMelee: false, headshotDamage: 300, bodyDamage: 150, fireRateRPM: 48, magazineSize: 5, reloadDuration: 2.8, pullDuration: 48/60, recoilDistance: 0.12, recoilDuration: 0.1, isSniper: true, tracerLength: 100, speedModifier: 0.6, damageDropOff: { head:[300,260,220], body:[150,130,120] } },
    m79: { name: "M-79", isMelee: false, headshotDamage: 54, bodyDamage: 22, fireRateRPM: 405, magazineSize: 12, reloadDuration: 1.8, pullDuration: 125/600 * 1.5, recoilDistance: 0.08, recoilDuration: 0.08, speedModifier: 0.9, tracerLength: 20, damageDropOff: { head:[54,44,36], body:[22,18,16] } },
    legion: { name: "Legion", isMelee: false, headshotDamage: 124, bodyDamage: 76, fireRateRPM: 45, magazineSize: 2, reloadDuration: 3, pullDuration: 1.33, recoilDistance: 0.08, recoilDuration: 0.08, tracerLength: 100, speedModifier: 0.8, damageDropOff: { head:[124,110,100], body:[76,68,62] } }
  };

  static SOUNDS = {
    knife: { shot: 'https://codehs.com/uploads/a3b7d894d7ce224bc7dcbc93181862da', pull: 'https://codehs.com/uploads/433c856c847bc650b59d966f155b3f1d', reloadStart: null, reloadEnd: null },
    deagle: { shot: 'https://codehs.com/uploads/ab0452d6facfe07db8d94ac658195a5d', pull: 'https://codehs.com/uploads/c1b3935dd9777a8d32037e1538c5a09e', reloadStart: 'https://codehs.com/uploads/238ffcd55332e871083db2bf7644aff1', reloadEnd: 'https://codehs.com/uploads/830cd250b21f3da989f345833a010cbf' },
    'ak-47': { shot: 'https://codehs.com/uploads/35aaccb252e92205c08699da0818c524', pull: 'https://codehs.com/uploads/2f1ba563e325477717d4f97e18ff62b2', reloadStart: 'https://codehs.com/uploads/fb84ff53478328e3b508a65097a7cd7b', reloadEnd: 'https://codehs.com/uploads/3275c387a1288d0a040b8aebb3958e97' },
    marshal: { shot: 'https://codehs.com/uploads/c706ed1686988515f8767aa46952fd23', pull: 'https://codehs.com/uploads/c5684202c108d053ba61561a62e4c1ca', reloadStart: 'https://codehs.com/uploads/80601ac1055d110402b6a87d3520b025', reloadEnd: 'https://codehs.com/uploads/171d3fdd7af759a85fd178bb706ff0ad' },
    m79: { shot: 'https://codehs.com/uploads/8b81838df3b08b56fac7f26a2ca9e7c3', pull: 'https://codehs.com/uploads/aff98052ce443af0016300655d234189', reloadStart: 'https://codehs.com/uploads/c037824e7ad86dcf55ca2e89b0b893af', reloadEnd: 'https://codehs.com/uploads/bb78ded10db4f1f4a9092d5744bda11a' },
    viper: { shot: 'https://codehs.com/uploads/7536977c95aafe3ed9b2633239282f88', pull: 'https://codehs.com/uploads/6305a83477d217c2575c59e90b8273fd', reloadStart: 'https://codehs.com/uploads/bceedd01e90d49150d6d0c33f8107066', reloadEnd: 'https://codehs.com/uploads/bc0dfbadc36ac155b7944c788c827135' },
    legion: { shot: 'https://codehs.com/uploads/616e8771754822be53dd1448f9856623', pull: 'https://codehs.com/uploads/fe236825318fcd2a9adfc60224701585', reloadStart: 'https://codehs.com/uploads/9f62af374bd5d875478b4c5164257a1a', reloadEnd: 'https://codehs.com/uploads/d656c6f3c369fbc977122a575c172468' }
  };

  constructor(camera, playersRef, holesRef, createTracer, localPlayerIdArg, physicsController) {
    this.camera = camera || window.camera || null;
    this.playersRef = playersRef || null;
    this.holesRef = holesRef || null;
    this.createTracer = createTracer || window.createTracer;
    this.localPlayerId = localPlayerIdArg || localPlayerId || (window.localPlayer && window.localPlayer.id) || null;
    this.physicsController = physicsController || window.physicsController || null;

    this._prevFire = false;
    this._lastKnifeSwingTime = 0;
    this.stats = WeaponController.WEAPONS.knife;
    this.ammoInMagazine = this.stats.magazineSize;
    this.ammoStore = {};
    this.isReloadingFlag = false;
    this.lastShotTime = 0;
    this.burstCount = 0;
    this._reloadEndPlayed = false;

    this.viewModel = null;
    this.parts = { slide: null, muzzle: null };
    this.state = { pulling: false, pullStart: 0, pullFrom: {x:0,y:0,z:0}, pullTo: {x:0,y:0,z:0}, recoiling: false, recoilStart: 0, reloading: false, reloadStart: 0, knifeSwing: false, knifeSwingStart: 0, knifeHeavy: false, tracerObjects: [] };
    this.audio = {};
    for (const [key, paths] of Object.entries(WeaponController.SOUNDS)) {
      this.audio[key] = {
        shot: paths.shot ? new Audio(paths.shot) : null,
        pull: paths.pull ? new Audio(paths.pull) : null,
        reloadStart: paths.reloadStart ? new Audio(paths.reloadStart) : null,
        reloadEnd: paths.reloadEnd ? new Audio(paths.reloadEnd) : null
      };
    }

    this.offPos = { x: 0.5, y: -0.7, z: -1.5 };
    this.readyPos = { x: 0.3, y: -0.5, z: -0.7 };
    this.readyRot = { x: 0, y: 0, z: 0 };

    this._recoil = { currentOffset: 0, peakOffset: 0, recoilStartTime: 0, recoilDuration: 0.25, previousRecoilOffset: 0 };
    this.createPlayerArm();
    // equip default
    this.equipWeapon("knife");
  }

  // ------------------ camera FOV helpers ------------------
  getCameraFov() {
    try {
      if (this.camera && isPcEntity(this.camera) && this.camera.camera) return Number(this.camera.camera.fov) || 60;
      if (this.camera && this.camera.isCamera && typeof this.camera.fov === 'number') return Number(this.camera.fov) || 60;
      if (this.camera && this.camera.camera && typeof this.camera.camera.fov === 'number') return Number(this.camera.camera.fov) || 60;
    } catch (e) {}
    return 60;
  }

  setCameraFov(newFov) {
    try {
      if (this.camera && isPcEntity(this.camera) && this.camera.camera) {
        this.camera.camera.fov = newFov;
        return;
      }
      if (this.camera && this.camera.isCamera && typeof this.camera.fov === 'number') {
        this.camera.fov = newFov;
        if (typeof this.camera.updateProjectionMatrix === 'function') this.camera.updateProjectionMatrix();
        return;
      }
      if (this.camera && this.camera.camera && typeof this.camera.camera.fov === 'number') {
        this.camera.camera.fov = newFov;
        if (this.camera.camera.updateProjectionMatrix) this.camera.camera.updateProjectionMatrix();
      }
    } catch (e) { console.warn("setCameraFov failed", e); }
  }

  createFallbackViewModel() {
    try {
      const pcApp = getPlayCanvasApp();
      if (pcApp && typeof pc !== "undefined") {
        // PlayCanvas fallback: create a small box entity and parent to camera
        try {
          const boxEnt = new pc.Entity("vm_debug_box");
          boxEnt.addComponent("model", { type: "box" });
          boxEnt.setLocalScale(0.1, 0.1, 0.3);
          // position in front of camera
          boxEnt.setLocalPosition(0.2, -0.2, -0.6);
          if (this.camera && typeof this.camera.addChild === "function") {
            this.camera.addChild(boxEnt);
          } else if (pcApp.root) {
            pcApp.root.addChild(boxEnt);
          }
          this.viewModel = boxEnt;
          this.weaponModel = boxEnt;
          return boxEnt;
        } catch (e) { /* fallthrough to three fallback */ }
      }
    } catch (e) {}

    // THREE fallback
    try {
      if (typeof THREE !== "undefined") {
        const g = new THREE.BoxGeometry(0.12, 0.12, 0.3);
        const m = new THREE.MeshStandardMaterial({ color: 0x00ffcc });
        const mesh = new THREE.Mesh(g, m);
        mesh.name = "vm_debug_box";
        // position local to camera
        mesh.position.set(0.2, -0.2, -0.6);
        if (this.camera && typeof this.camera.add === "function") this.camera.add(mesh);
        else if (window.scene && typeof window.scene.add === "function") window.scene.add(mesh);
        this.viewModel = mesh;
        this.weaponModel = mesh;
        return mesh;
      }
    } catch (e) {}

    // last-resort: create a tiny placeholder object so other code has something to reference
    this.viewModel = this.viewModel || { position: { x: 0, y: 0, z: 0 }, scale: { x:1,y:1,z:1 } };
    return this.viewModel;
  }

  // ------------------ equipWeapon (robust) ------------------
  equipWeapon(weaponKey) {
    if (!WeaponController.WEAPONS || !WeaponController.WEAPONS[weaponKey]) {
      console.warn(`[WeaponController] Unknown weapon: ${weaponKey}`);
      return;
    }

    // save ammo for previous weapon
    if (this.currentKey) {
      this.ammoStore = this.ammoStore || {};
      this.ammoStore[this.currentKey] = this.ammoInMagazine;
    }

    this.currentKey = weaponKey;
    this.stats = WeaponController.WEAPONS[weaponKey];
    this.isReloadingFlag = false;
    this.lastShotTime = 0;
    this.burstCount = 0;
    this.speedModifier = this.stats.speedModifier;
    this.ammoStore = this.ammoStore || {};
    this.ammoInMagazine = (this.ammoStore[weaponKey] != null) ? this.ammoStore[weaponKey] : this.stats.magazineSize;

    const normalized = (weaponKey || "").replace(/-/g,'').toLowerCase();

    // Helper: robust PlayCanvas app lookup (works even if getPlayCanvasApp helper exists elsewhere)
    const pcApp = (typeof getPlayCanvasApp === 'function')
      ? getPlayCanvasApp()
      : (window.playcanvasApp || ((typeof pc !== 'undefined' && pc.Application && typeof pc.Application.getApplication === 'function') ? (pc.Application.getApplication() || null) : null));

    // Guess engine context from camera and app
    const isPcContext = !!pcApp || ((typeof pc !== 'undefined') && isPcEntity(this.camera));

    // Helper: create a visible fallback viewmodel if prototypes/builders aren't ready
    const ensureFallbackViewModel = () => {
      try {
        if (typeof this.createFallbackViewModel === 'function') {
          return this.createFallbackViewModel();
        }
      } catch (e) {}
      // Inline fallback creation (PlayCanvas)
      try {
        if (pcApp && typeof pc !== 'undefined') {
          const boxEnt = new pc.Entity("vm_debug_box");
          boxEnt.addComponent("model", { type: "box" });
          boxEnt.setLocalScale(0.1, 0.1, 0.3);
          try { boxEnt.setLocalPosition(0.2, -0.2, -0.6); } catch(e){}
          try {
            if (this.camera && typeof this.camera.addChild === "function") this.camera.addChild(boxEnt);
            else if (pcApp.root) pcApp.root.addChild(boxEnt);
          } catch(e){}
          this.viewModel = boxEnt;
          this.weaponModel = boxEnt;
          return boxEnt;
        }
      } catch (e) {}
      // THREE fallback
      try {
        if (typeof THREE !== 'undefined') {
          const g = new THREE.BoxGeometry(0.12, 0.12, 0.3);
          const m = new THREE.MeshStandardMaterial({ color: 0x00ffcc });
          const mesh = new THREE.Mesh(g, m);
          mesh.name = "vm_debug_box";
          mesh.position.set(0.2, -0.2, -0.6);
          try {
            if (this.camera && typeof this.camera.add === "function") this.camera.add(mesh);
            else if (window.scene && typeof window.scene.add === "function") window.scene.add(mesh);
          } catch (e) {}
          this.viewModel = mesh;
          this.weaponModel = mesh;
          return mesh;
        }
      } catch (e) {}
      // final minimal fallback
      this.viewModel = this.viewModel || { position: { x: 0, y: 0, z: 0 }, scale: { x:1,y:1,z:1 } };
      return this.viewModel;
    };

    // create viewModel container attached to camera if missing or if engine context differs
    try {
      if (!this.viewModel) {
        if (isPcContext) {
          try {
            const vm = new pc.Entity("ViewModelRoot");
            vm.enabled = true;
            vm.setLocalPosition(0,0,0);
            vm.setLocalEulerAngles(0,0,0);
            vm.setLocalScale(1,1,1);
            if (this.camera && typeof this.camera.addChild === "function") this.camera.addChild(vm);
            else if (pcApp && pcApp.root) pcApp.root.addChild(vm);
            this.viewModel = vm;
          } catch (e) {
            // fallback to simple debug vm if pc entity creation fails
            ensureFallbackViewModel();
          }
        } else {
          try {
            const vm = new THREE.Group();
            vm.name = "ViewModelRoot";
            if (this.camera && typeof this.camera.add === "function") this.camera.add(vm);
            else if (window.scene && typeof window.scene.add === "function") window.scene.add(vm);
            this.viewModel = vm;
          } catch (e) {
            ensureFallbackViewModel();
          }
        }
      } else {
        // ensure it's parented to camera (if possible)
        try {
          if (isPcContext && this.viewModel && this.viewModel.parent !== this.camera && typeof this.camera.addChild === "function") {
            try { if (this.viewModel.parent) this.viewModel.parent.removeChild(this.viewModel); } catch (e) {}
            this.camera.addChild(this.viewModel);
          } else if (!isPcContext && this.viewModel && this.viewModel.parent !== this.camera && this.camera && typeof this.camera.add === "function") {
            try { if (this.viewModel.parent && typeof this.viewModel.parent.remove === "function") this.viewModel.parent.remove(this.viewModel); } catch (e) {}
            this.camera.add(this.viewModel);
          }
        } catch (e) {}
      }
    } catch (e) {
      console.warn("equipWeapon create viewModel failed", e);
      ensureFallbackViewModel();
    }

    // defensive: ensure viewModel scale non-zero
    try {
      if (this.viewModel) {
        if (typeof this.viewModel.getLocalScale === 'function') {
          const s = this.viewModel.getLocalScale();
          if ((s.x||0) === 0 || (s.y||0) === 0 || (s.z||0) === 0) this.viewModel.setLocalScale(1,1,1);
        } else if (this.viewModel.scale) {
          if ((this.viewModel.scale.x||0) === 0 || (this.viewModel.scale.y||0) === 0 || (this.viewModel.scale.z||0) === 0) this.viewModel.scale.set(1,1,1);
        }
      }
    } catch(e){}

    // clear previous weaponModel if present
    try {
      if (this.weaponModel) {
        if (isPcContext && isPcEntity(this.weaponModel)) {
          try { if (this.weaponModel.parent) this.weaponModel.parent.removeChild(this.weaponModel); } catch (e) {}
        } else if (!isPcContext && isThreeObject(this.weaponModel)) {
          try { if (this.weaponModel.parent) this.weaponModel.parent.remove(this.weaponModel); } catch (e) {}
        }
        this.weaponModel = null;
        this.parts = { slide: null, muzzle: null };
      }
    } catch (e) {}

    // Try PlayCanvas prototype first (when in PC environment and prototypes exist)
    try {
      if (pcApp && window._pcPrototypeModels && window._pcPrototypeModels[normalized]) {
        try {
          const proto = window._pcPrototypeModels[normalized];
          const clone = (typeof proto.clone === "function") ? proto.clone(true) : null;
          if (clone) {
            clone.enabled = true;
            try { if (clone.parent) clone.parent.removeChild(clone); } catch (e) {}
            // parent into viewModel
            try { if (this.viewModel && typeof this.viewModel.addChild === 'function') this.viewModel.addChild(clone); else if (this.viewModel && this.viewModel.add) this.viewModel.add(clone); } catch(e){}
            this.weaponModel = clone;
            applyCommonTransforms(clone, normalized);

            // find muzzle
            const findMuzzlePc = (ent) => {
              if (!ent) return null;
              if ((ent.name || "").toLowerCase() === "muzzle") return ent;
              if (ent.children) for (let c of ent.children) { const r = findMuzzlePc(c); if (r) return r; }
              return null;
            };
            const muzzle = findMuzzlePc(clone);
            if (muzzle) this.parts.muzzle = muzzle;
            return;
          }
        } catch (e) {
          console.warn("equipWeapon pc prototype clone failed", e);
        }
      }
    } catch (e) { console.warn("equipWeapon pc prototype check failed", e); }

    // Try THREE prototypes if available (for THREE-mode)
    try {
      if ((!pcApp || !isPcEntity(this.camera)) && window._prototypeModels && window._prototypeModels[normalized]) {
        try {
          const clone = getWeaponModel(normalized);
          try { if (clone.parent) clone.parent.remove(clone); } catch (e) {}
          // add to viewModel (which should be a THREE Group)
          try { if (this.viewModel && typeof this.viewModel.add === 'function') this.viewModel.add(clone); else if (this.camera && typeof this.camera.add === 'function') this.camera.add(clone); } catch(e){}
          this.weaponModel = clone;
          applyCommonTransforms(clone, normalized);
          const findMuzzleThree = (o) => {
            if (!o) return null;
            if ((o.name || "").toLowerCase() === "muzzle") return o;
            if (o.children) for (let c of o.children) { const r = findMuzzleThree(c); if (r) return r; }
            return null;
          };
          const muzzle = findMuzzleThree(clone);
          if (muzzle) this.parts.muzzle = muzzle;
          return;
        } catch (e) {
          console.warn("equipWeapon THREE prototype failed", e);
        }
      }
    } catch (e) { console.warn("equipWeapon three prototype check failed", e); }

    // If PlayCanvas app isn't ready but this is a PlayCanvas context: create fallback and schedule a retry
    if (!pcApp && isPcContext) {
      console.warn(`[equipWeapon] PlayCanvas app not ready for ${normalized}. Creating visible fallback and scheduling retry.`);
      ensureFallbackViewModel();

      // schedule retry to attempt builder once pcApp becomes available (cleared on success)
      if (!this._equipRetryInterval) {
        let tries = 0;
        this._equipRetryInterval = setInterval(() => {
          tries++;
          const appNow = (typeof getPlayCanvasApp === 'function') ? getPlayCanvasApp() : (window.playcanvasApp || (typeof pc !== 'undefined' && pc.Application && pc.Application.getApplication ? pc.Application.getApplication() : null));
          if (appNow) {
            clearInterval(this._equipRetryInterval);
            this._equipRetryInterval = null;
            // re-run equipWeapon to try the builder/prototypes now that the app exists
            try { this.equipWeapon(this.currentKey); } catch (e) { console.warn("retry equipWeapon failed", e); }
            return;
          }
          if (tries > 20) { // ~10s of attempts
            clearInterval(this._equipRetryInterval);
            this._equipRetryInterval = null;
            console.warn("[equipWeapon] timed out waiting for PlayCanvas app; leaving fallback in place.");
          }
        }, 500);
      }
      return;
    }

    // Fallback to builder when PlayCanvas app is present (or if we explicitly want to use builder)
    try {
      const builder = new PCWeaponBuilder({ app: pcApp, viewModel: this.viewModel });
      const buildMap = { knife: 'buildKnife', deagle: 'buildDeagle', ak47: 'buildAK47', marshal: 'buildMarshal', m79: 'buildM79', viper: 'buildViper', legion: 'buildLegion' };
      const method = buildMap[normalized];
      if (method && typeof builder[method] === "function") {
        const { promise } = builder[method]();
        promise.then((res) => {
          if (!res) {
            console.warn(`[equipWeapon] builder returned null for ${normalized}; using fallback viewmodel`);
            if (!this.viewModel) ensureFallbackViewModel();
            return;
          }
          // If builder returned a structured weaponRoot + parts object, use it
          if (res.weaponRoot && res.parts) {
            try {
              // remove any fallback added earlier
              if (this.viewModel && this.viewModel.name === "vm_debug_box" && typeof this.viewModel.parent !== 'undefined') {
                try { if (isPcContext && this.viewModel.parent) this.viewModel.parent.removeChild(this.viewModel); else if (!isPcContext && this.viewModel.parent && typeof this.viewModel.parent.remove === 'function') this.viewModel.parent.remove(this.viewModel); } catch (e) {}
              }
            } catch(e){}
            this.weaponModel = res.weaponRoot;
            this.parts = res.parts || {};
            try { applyCommonTransforms(this.weaponModel, normalized); } catch(e){}
          } else {
            // direct entity/three object returned
            try {
              if (this.viewModel && typeof this.viewModel.addChild === 'function') {
                try { this.viewModel.addChild(res); } catch(e){}
              } else if (this.viewModel && typeof this.viewModel.add === 'function') {
                try { this.viewModel.add(res); } catch(e){}
              }
            } catch(e){}
            this.weaponModel = res;
            try { applyCommonTransforms(this.weaponModel, normalized); } catch(e){}
          }

          // find muzzle if not set yet
          try {
            if (!this.parts || !this.parts.muzzle) {
              const findMuzzle = (root) => {
                if (!root) return null;
                try {
                  if ((root.name || "").toLowerCase() === "muzzle") return root;
                } catch(e){}
                try {
                  const children = root.children ? root.children : (root.getChildren ? root.getChildren() : null);
                  if (children && children.length) {
                    for (let c of children) {
                      const r = findMuzzle(c);
                      if (r) return r;
                    }
                  }
                } catch(e){}
                return null;
              };
              const muzzle = findMuzzle(this.weaponModel);
              if (muzzle) this.parts = this.parts || {}, this.parts.muzzle = muzzle;
            }
          } catch (e) {}
        }).catch(err => {
          console.warn("equipWeapon builder failed", err);
          if (!this.viewModel) ensureFallbackViewModel();
        });
      } else {
        console.warn(`[equipWeapon] No builder method for ${normalized}; creating fallback viewmodel`);
        if (!this.viewModel) ensureFallbackViewModel();
      }
    } catch (e) {
      console.warn("equipWeapon builder error", e);
      if (!this.viewModel) ensureFallbackViewModel();
    }
  }


  // ------------------ play weapon sound (and network) ------------------
  playWeaponSound(soundType) {
    const soundSrc = WeaponController.SOUNDS[this.currentKey]?.[soundType];
    if (soundSrc) {
      try {
        const snd = new Audio(soundSrc);
        snd.volume = 1;
        snd.play().catch(()=>{});
      } catch (e) {}
      try {
        const pos = new THREE.Vector3();
        if (this.camera && typeof this.camera.getWorldPosition === 'function') this.camera.getWorldPosition(pos);
        else if (this.camera && this.camera.position) pos.set(this.camera.position.x, this.camera.position.y, this.camera.position.z);
        if (typeof sendSoundEvent === "function") sendSoundEvent(this.currentKey, soundType, pos);
      } catch (e) {}
    }
  }

  // ------------------ createPlayerArm (simple placeholder) ------------------
  createPlayerArm() {
    // For viewmodel aesthetic only; keep minimal to avoid extra complexity
    // (You can extend this for better arm models)
    try {
      const skinMat = createSkinMaterial("#f5be90");
      // nothing to attach unless you have a viewModel and three environment
    } catch (e) {}
  }

  // ------------------ utility getters ------------------
  getCurrentAmmo() { return this.ammoInMagazine; }
  getMaxAmmo() { return this.stats.magazineSize; }
  isReloading() { return this.isReloadingFlag; }
  isMelee() { return !!this.stats.isMelee; }

  // ------------------ checkBulletHit (player-only raycast) ------------------
  checkBulletHit(origin, direction, intersectionPointOut) {
    // this implementation checks window.remotePlayers meshes if present (THREE-based)
    if (typeof THREE === "undefined") return null;
    const raycaster = new THREE.Raycaster();
    raycaster.set(origin.clone(), direction.clone().normalize());
    let closest = null;
    const remotePlayers = window.remotePlayers || {};
    for (const rp of Object.values(remotePlayers)) {
      const meshes = [];
      if (rp.bodyMesh) meshes.push(rp.bodyMesh);
      if (rp.headMesh) meshes.push(rp.headMesh);
      for (const mesh of meshes) {
        if (!mesh || !mesh.geometry) continue;
        const hits = raycaster.intersectObject(mesh, true);
        if (!hits || !hits.length) continue;
        const hit = hits[0];
        if (!closest || hit.distance < closest.distance) {
          closest = {
            mesh,
            isHead: mesh.userData.isPlayerHead === true,
            intersection: hit.point.clone(),
            distance: hit.distance
          };
        }
      }
    }
    if (!closest) return null;
    if (intersectionPointOut instanceof THREE.Vector3) intersectionPointOut.copy(closest.intersection);
    return { mesh: closest.mesh, isHead: closest.isHead, intersection: closest.intersection.clone(), distance: closest.distance };
  }

  // ------------------ checkBulletPenetration (world + player) ------------------
  checkBulletPenetration(origin, direction, maxWorldPenetrations = 1) {
    if (!this.physicsController || !this.physicsController.collider) {
      console.error("World BVH or collider mesh not available.");
      return { playerHitResult: null, allWorldHits: [], penetrationCount: 0, isPenetrationShot: false };
    }
    const dir = (direction.clone) ? direction.clone().normalize() : (new THREE.Vector3(direction.x, direction.y, direction.z)).normalize();
    let currentOrigin = origin.clone ? origin.clone() : new THREE.Vector3(origin.x, origin.y, origin.z);
    let worldPenetrationCount = 0;
    const allWorldHits = [];
    let playerHitResult = null;

    for (let iter = 0; iter <= maxWorldPenetrations; iter++) {
      const ray = new THREE.Raycaster();
      ray.set(currentOrigin.clone(), dir);
      const worldHits = ray.intersectObject(this.physicsController.collider, true);
      const worldIntersection = worldHits && worldHits.length ? worldHits[0] : null;
      const playerHit = this.checkBulletHit(currentOrigin, dir);

      let closestHit = null; let hitType = null;
      if (worldIntersection && (!playerHit || worldIntersection.distance <= playerHit.distance)) { closestHit = worldIntersection; hitType = 'world'; }
      else if (playerHit) { closestHit = playerHit; hitType = 'player'; }
      else break;

      if (hitType === 'player') {
        playerHitResult = { mesh: closestHit.mesh, isHead: closestHit.isHead, intersection: closestHit.intersection.clone(), distance: origin.distanceTo(closestHit.intersection) };
        break;
      }

      // world hit
      const normal = (closestHit.face && closestHit.object) ? closestHit.face.normal.clone().transformDirection(closestHit.object.matrixWorld).normalize() : dir.clone().negate();
      allWorldHits.push({ point: closestHit.point.clone(), normal, distance: currentOrigin.distanceTo(closestHit.point), object: closestHit.object });
      worldPenetrationCount++;
      if (worldPenetrationCount > maxWorldPenetrations) break;
      currentOrigin.copy(closestHit.point).add(dir.clone().multiplyScalar(0.01));
    }

    return {
      playerHitResult,
      allWorldHits,
      penetrationCount: worldPenetrationCount,
      isPenetrationShot: !!(playerHitResult && worldPenetrationCount > 0)
    };
  }

  // ------------------ fireBullet (robust engine-agnostic) ------------------
  fireBullet(spreadAngle = 0, collidables = []) {
    // world BVH required for meaningful hits
    if (!this.physicsController || !this.physicsController.worldBVH) { console.error("World BVH not available"); return; }

    // Compute origin & forward (pc.Vec3 or THREE.Vector3)
    let originPC = null, dirPC = null;
    // prefer parts.muzzle world if available
    try {
      if (this.parts && this.parts.muzzle) {
        if (isPcEntity(this.parts.muzzle) && typeof this.parts.muzzle.getWorldTransform === 'function') {
          const wt = this.parts.muzzle.getWorldTransform();
          const o = wt.transformPoint(new pc.Vec3(0,0,0));
          const f = wt.transformPoint(new pc.Vec3(0,0,1));
          originPC = o.clone();
          dirPC = f.clone().sub(o).normalize();
        } else if (isThreeObject(this.parts.muzzle) && typeof this.parts.muzzle.getWorldPosition === 'function') {
          const o = new THREE.Vector3(); this.parts.muzzle.getWorldPosition(o);
          const f = new THREE.Vector3(0,0,1).applyQuaternion(this.parts.muzzle.getWorldQuaternion(new THREE.Quaternion())).add(o);
          originPC = o;
          dirPC = f.clone().sub(o).normalize();
        }
      }
    } catch (e) {}

    // fallback to camera world forward
    try {
      if (!originPC) {
        if (isPcEntity(this.camera) && typeof this.camera.getWorldTransform === 'function') {
          const wt = this.camera.getWorldTransform();
          const o = wt.transformPoint(new pc.Vec3(0,0,0));
          const f = wt.transformPoint(new pc.Vec3(0,0,1));
          originPC = o.clone();
          dirPC = f.clone().sub(o).normalize();
        } else if (this.camera && typeof this.camera.getWorldPosition === 'function') {
          const o = new THREE.Vector3(); this.camera.getWorldPosition(o);
          const quat = new THREE.Quaternion();
          if (typeof this.camera.getWorldQuaternion === 'function') this.camera.getWorldQuaternion(quat);
          const f = new THREE.Vector3(0,0,1).applyQuaternion(quat).add(o);
          originPC = o;
          dirPC = f.clone().sub(o).normalize();
        } else if (this.camera && this.camera.position) {
          originPC = (isThreeObject(this.camera)) ? new THREE.Vector3(this.camera.position.x, this.camera.position.y, this.camera.position.z) : (this.camera.getPosition ? this.camera.getPosition().clone() : new pc.Vec3(0,0,0));
          dirPC = (isThreeObject(this.camera) && this.camera.getWorldQuaternion) ? new THREE.Vector3(0,0,1).applyQuaternion(this.camera.getWorldQuaternion(new THREE.Quaternion())).normalize() : new pc.Vec3(0,0,1);
        }
      }
    } catch (e) {}

    if (!originPC || !dirPC) {
      console.error("Unable to determine bullet origin/dir");
      return;
    }

    // Apply spread
    let directionWithSpread = null;
    try {
      // convert to plain vector and use applySpreadToPCVec
      const plainDir = (dirPC.x !== undefined) ? { x: dirPC.x, y: dirPC.y, z: dirPC.z } : { x: 0, y: 0, z: 1 };
      const spreadVec = applySpreadToPCVec(plainDir, spreadAngle);
      // keep type consistent for checkBulletPenetration (it expects THREE vectors in our impl)
      if (isThreeObject(dirPC) || (typeof THREE !== "undefined" && dirPC instanceof THREE.Vector3)) {
        directionWithSpread = new THREE.Vector3(spreadVec.x, spreadVec.y, spreadVec.z);
      } else {
        directionWithSpread = (typeof pc !== "undefined") ? new pc.Vec3(spreadVec.x, spreadVec.y, spreadVec.z) : { x: spreadVec.x, y: spreadVec.y, z: spreadVec.z };
      }
    } catch (e) {
      console.warn("applySpread failed", e);
      directionWithSpread = dirPC.clone ? dirPC.clone() : (new THREE.Vector3(dirPC.x, dirPC.y, dirPC.z));
    }

    // Prepare origin & dir for checkBulletPenetration (our implementation uses THREE)
    let originForCheck = (originPC.clone) ? originPC.clone() : new THREE.Vector3(originPC.x, originPC.y, originPC.z);
    let dirForCheck = (directionWithSpread.clone) ? directionWithSpread.clone() : new THREE.Vector3(directionWithSpread.x, directionWithSpread.y, directionWithSpread.z);

    let traj = null;
    try { traj = this.checkBulletPenetration(originForCheck, dirForCheck, 1); }
    catch (e) {
      try { traj = this.checkBulletPenetration({x:originForCheck.x,y:originForCheck.y,z:originForCheck.z}, {x:dirForCheck.x,y:dirForCheck.y,z:dirForCheck.z}, 1); }
      catch (err) { console.error("checkBulletPenetration failed", err); return; }
    }

    const pointToThree = (p) => {
      if (!p) return new THREE.Vector3();
      if (p instanceof pc.Vec3) return new THREE.Vector3(p.x, p.y, p.z);
      if (p instanceof THREE.Vector3) return p.clone();
      return new THREE.Vector3(p.x, p.y, p.z);
    };

    let tracerEnd = null;
    let realPenetrate = false;

    if (traj && traj.playerHitResult) {
      const hit = traj.playerHitResult;
      let mesh = hit.mesh;
      while (mesh && mesh.userData && mesh.userData.playerId == null) mesh = mesh.parent;
      if (mesh && mesh.userData && mesh.userData.playerId != null) {
        const isHead = !!hit.isHead;
        const baseDamage = isHead ? this.stats.headshotDamage : this.stats.bodyDamage;
        const hitPos = pointToThree(hit.intersection);
        const originPos = pointToThree(originForCheck);
        const distanceUnits = originPos.distanceTo(hitPos);
        const distanceMeters = (this.unitsPerMeter && this.unitsPerMeter > 0) ? (distanceUnits / this.unitsPerMeter) : distanceUnits;
        let damageToApply = typeof calculateDamageWithDropOff === "function" ? calculateDamageWithDropOff(baseDamage, distanceMeters, this.stats.damageDropOff, isHead) : baseDamage;
        if (traj.isPenetrationShot) { damageToApply *= 0.5; realPenetrate = true; }
        damageToApply = Math.round(damageToApply);
        if (typeof window.applyDamageToRemote === "function") {
          window.applyDamageToRemote(mesh.userData.playerId, damageToApply, {
            id: this.localPlayerId,
            username: window.localPlayer?.username ?? "Unknown",
            weapon: this.currentKey,
            isHeadshot: isHead,
            isPenetrationShot: realPenetrate
          });
        }
        realPenetrate = false;
      }
      tracerEnd = pointToThree(traj.playerHitResult.intersection);
    } else {
      if (traj && traj.allWorldHits && traj.allWorldHits.length) {
        const last = traj.allWorldHits[traj.allWorldHits.length - 1];
        tracerEnd = pointToThree(last.point);
      } else {
        const len = this.stats && this.stats.tracerLength ? this.stats.tracerLength : 2000;
        const originT = pointToThree(originForCheck);
        const dirT = pointToThree(directionWithSpread);
        tracerEnd = originT.clone().add(dirT.clone().multiplyScalar(len));
      }
    }

    // send bullet holes for world hits
    if (traj && traj.allWorldHits && Array.isArray(traj.allWorldHits)) {
      for (const wh of traj.allWorldHits) {
        if (!wh || !wh.point || !wh.normal) continue;
        const pt = pointToThree(wh.point), n = pointToThree(wh.normal);
        try {
          const payload = { x: pt.x, y: pt.y, z: pt.z, nx: n.x, ny: n.y, nz: n.z, timeCreated: (typeof firebase !== "undefined" && firebase.database && firebase.database.ServerValue) ? firebase.database.ServerValue.TIMESTAMP : Date.now() };
          if (typeof sendBulletHole === "function") sendBulletHole(payload);
        } catch (e) { console.warn("failed to sendBulletHole", e); }
      }
    }

    // create tracer from muzzle/origin -> tracerEnd
    try {
      let muzzleWorld = originForCheck;
      try { if (this.parts && this.parts.muzzle && this.parts.muzzle.getWorldPosition) { muzzleWorld = new THREE.Vector3(); this.parts.muzzle.getWorldPosition(muzzleWorld); } } catch(e){}
      if (typeof this.createTracer === "function") {
        try {
          this.createTracer(muzzleWorld.clone(), tracerEnd.clone(), this.currentKey, this.stats.tracerLength);
        } catch (e) {
          try { this.createTracer({ ox: muzzleWorld.x, oy: muzzleWorld.y, oz: muzzleWorld.z, tx: tracerEnd.x, ty: tracerEnd.y, tz: tracerEnd.z, key: this.currentKey }); } catch (e2) {}
        }
      }
    } catch (e) {}

    // send tracer network event
    try { if (typeof sendTracer === "function") sendTracer({ ox: tracerEnd.x, oy: tracerEnd.y, oz: tracerEnd.z, tx: tracerEnd.x, ty: tracerEnd.y, tz: tracerEnd.z }); } catch (e) {}
  }

  // ------------------ checkMeleeHit ------------------
  checkMeleeHit(collidables) {
    const nowMs = performance.now();
    const { rpm, bodyDamage } = WeaponController.WEAPONS.knife;
    const interval = 60000 / rpm;
    if (nowMs - this._lastKnifeSwingTime < interval) return;
    this._lastKnifeSwingTime = nowMs;
    const meleeRange = 2;
    const meleeDamage = bodyDamage;
    try {
      const playerPos = new THREE.Vector3();
      if (this.camera && typeof this.camera.getWorldPosition === 'function') this.camera.getWorldPosition(playerPos);
      for (const obj of collidables || []) {
        if (obj.userData?.isPlayerBodyPart && obj.userData.playerId !== this.localPlayerId) {
          const targetGroup = window.remotePlayers[obj.userData.playerId]?.group;
          if (!targetGroup) continue;
          const targetPos = new THREE.Vector3();
          if (typeof targetGroup.getWorldPosition === 'function') targetGroup.getWorldPosition(targetPos);
          if (playerPos.distanceTo(targetPos) <= meleeRange) {
            window.applyDamageToRemote?.(obj.userData.playerId, meleeDamage, { id: this.localPlayerId, username: window.localPlayer?.username ?? "Unknown", weapon: "knife", isHeadshot: false, isPenetrationShot: false });
            return;
          }
        }
      }
    } catch (e) { console.warn("checkMeleeHit failed", e); }
  }

  // ------------------ update (FULL method) ------------------
  update(inputState, delta, playerState) {
    // Helpers
    const now = performance.now() / 1000;
    const lerp = (a,b,t)=>a+(b-a)*t;
    const clamp = (v,lo,hi)=>Math.max(lo,Math.min(hi,v));

    // ensure viewModel exists (try to equip if missing)
    if (!this.viewModel) {
      this.equipWeapon(this.currentKey || "knife");
      // give one frame for loader, but still continue (will early-return next frame)
      return;
    }

    // Make sure viewModel is parented to the camera (robust for PC / THREE)
    try {
      const isPc = (typeof pc !== "undefined") && isPcEntity(this.camera);
      if (isPc && isPcEntity(this.viewModel) && this.camera && typeof this.camera.addChild === "function" && this.viewModel.parent !== this.camera) {
        try { if (this.viewModel.parent) this.viewModel.parent.removeChild(this.viewModel); } catch(e) {}
        try { this.camera.addChild(this.viewModel); } catch(e) {}
      } else if (!isPc && this.camera && this.camera.add && this.viewModel.parent !== this.camera) {
        try { if (this.viewModel.parent && typeof this.viewModel.parent.remove === 'function') this.viewModel.parent.remove(this.viewModel); } catch(e) {}
        try { this.camera.add(this.viewModel); } catch(e) {}
      }
    } catch(e) {}

    // defensive: ensure viewModel scale not zero (fix invisible-gun cases)
    try {
      if (this.viewModel) {
        if (typeof this.viewModel.getLocalScale === 'function') {
          const s = this.viewModel.getLocalScale();
          if ((s.x||0) === 0 || (s.y||0) === 0 || (s.z||0) === 0) this.viewModel.setLocalScale(1,1,1);
        } else if (this.viewModel.scale) {
          if ((this.viewModel.scale.x||0) === 0 || (this.viewModel.scale.y||0) === 0 || (this.viewModel.scale.z||0) === 0) this.viewModel.scale.set(1,1,1);
        }
      }
    } catch(e) {}

    // debug: ensure muzzle dot exists and is visible if requested
    try {
      if (this._createMuzzleDebug === undefined) this._createMuzzleDebug = true;
      if (this._createMuzzleDebug && !this._muzzleDebugDot) {
        this._muzzleDebugDot = addDebugMuzzleDotForParts(this.parts, 0.03);
        if (this._muzzleDebugDot) {
          try { this._muzzleDebugDot.name = "vm_muzzle_debug"; } catch(e){}
        }
      }
    } catch(e){}

    // input & simple state
    const rawFire = !!inputState.fire;
    const justPressed = rawFire && !this._prevFire; this._prevFire = rawFire;

    const velocity = playerState?.velocity || (typeof pc !== "undefined" ? new pc.Vec3(0,0,0) : {x:0,y:0,z:0});
    const isCrouched = !!playerState?.isCrouched;
    const wishAim = !!inputState.aim;
    const isGrounded = !!(playerState?.physicsController && playerState.physicsController.isGrounded);
    const sinceLast = now - (this.lastShotTime || 0);

    // fallback readyPos if missing
    if (!this.readyPos) this.readyPos = { x:0.3, y:-0.5, z:-0.7 };

    // target aim offsets local to viewModel root (useable across engines)
    const gunAimPos = {
      "ak-47": { x:0, y:-0.3, z:-0.5 }, "deagle": { x:0, y:-0.3, z:-0.5 }, "m79": { x:0.2, y:-0.4, z:-0.7 },
      "viper": { x:0, y:-0.3, z:-0.5 }, "legion": { x:0, y:-0.15, z:-0.5 }, "marshal": { x:-0.025, y:-0.035, z:-0.2 }
    };

    // Pull animation
    if (this.state && this.state.pulling) {
      const tPull = (now - (this.state.pullStart||now)) / (this.stats.pullDuration || 0.001);
      if (tPull >= 1) {
        try {
          const to = this.state.pullTo || {x:0,y:0,z:0};
          if (this.viewModel.setLocalPosition) this.viewModel.setLocalPosition(to.x,to.y,to.z);
          else if (this.viewModel.position) this.viewModel.position.set(to.x,to.y,to.z);
        } catch(e){}
        this.state.pulling = false;
      } else {
        try {
          const pf = this.state.pullFrom || {x:0,y:0,z:0}; const pt = this.state.pullTo || {x:0,y:0,z:0};
          const ix = lerp(pf.x, pt.x, clamp(tPull,0,1)); const iy = lerp(pf.y, pt.y, clamp(tPull,0,1)); const iz = lerp(pf.z, pt.z, clamp(tPull,0,1));
          if (this.viewModel.setLocalPosition) this.viewModel.setLocalPosition(ix,iy,iz);
          else if (this.viewModel.position) this.viewModel.position.set(ix,iy,iz);
        } catch (e) {}
      }
    }

    // Update muzzle dot world transform each frame (if present)
    if (this._muzzleDebugDot && this.parts && this.parts.muzzle) {
      try {
        // if the dot is an entity/pc object it was already parented in addDebugMuzzleDotForParts, so nothing else required.
        // for THREE mesh dot also parented. If not parented, attempt manual world-position copy:
        if (typeof this._muzzleDebugDot.getWorldPosition === 'function' && this.parts.muzzle.getWorldPosition) {
          // nothing — parent already handles it
        } else if (this.parts.muzzle.getWorldPosition && this._muzzleDebugDot.position) {
          const wp = new THREE.Vector3();
          this.parts.muzzle.getWorldPosition(wp);
          this._muzzleDebugDot.position.set(wp.x, wp.y, wp.z);
        }
      } catch(e){}
    }

    // crosshair
    const spreadAngle = (typeof getSpreadMultiplier === "function") ? getSpreadMultiplier(this.currentKey, velocity, isCrouched, this._aiming, isGrounded, this.burstCount) : 0;
    if (typeof updateCrosshair === "function") updateCrosshair(spreadAngle);
    playerState.isAirborne = !isGrounded;

    if (!rawFire && (this.currentKey === "ak-47" || this.currentKey === "viper")) this.burstCount = 0;

    // Aim toggle (ADS) — robust, but DO NOT change camera FOV here (prevents zoom)
    if (wishAim !== this._prevWishAim) {
      // avoid toggling during pull/reload
      if (this.state.pulling || this.isReloadingFlag) { this._prevWishAim = wishAim; return; }
      const aimableGuns = ["ak-47","deagle","m79","viper","legion","marshal"];
      if (wishAim && !aimableGuns.includes(this.currentKey)) { this._prevWishAim = wishAim; return; }

      // robust read of current scale/pos
      const readScale = () => {
        try {
          if (this.viewModel.getLocalScale) { const s = this.viewModel.getLocalScale(); return {x:s.x,y:s.y,z:s.z}; }
          if (this.viewModel.scale) { const s = this.viewModel.scale; return {x:s.x||1,y:s.y||1,z:s.z||1}; }
        } catch(e){}
        return {x:1,y:1,z:1};
      };
      const readPos = () => {
        try {
          if (this.viewModel.getLocalPosition) { const p = this.viewModel.getLocalPosition(); return {x:p.x,y:p.y,z:p.z}; }
          if (this.viewModel.position) { const p = this.viewModel.position; return {x:p.x||0,y:p.y||0,z:p.z||0}; }
        } catch(e){}
        return {x:0,y:0,z:0};
      };

      this._baseScale = readScale();
      this._fromPos = readPos();

      // target pos in local viewmodel space
      const toPos = wishAim ? (gunAimPos[this.currentKey] ? gunAimPos[this.currentKey] : this.readyPos) : this.readyPos;
      // keep scale consistent to avoid disappearing
      const toScale = { x:this._baseScale.x, y:this._baseScale.y, z:this._baseScale.z };

      this._fovTween = {
        active: true,
        fromFov: this.getCameraFov(),
        toFov: this.getCameraFov(),
        fromScale: {...this._baseScale},
        toScale,
        fromPos: {...this._fromPos},
        toPos,
        startTime: now,
        duration: 0.18,
        applyFovToCamera: false
      };

      if (this.currentKey !== "marshal" && typeof scopeOverlay !== "undefined" && scopeOverlay) scopeOverlay.style.display = 'none';
    }
    this._prevWishAim = wishAim;

    this._fovTween = this._fovTween || { active: false };

    if (this._fovTween.active) {
      const t = (now - this._fovTween.startTime) / (this._fovTween.duration || 0.0001);
      const clamped = clamp(t, 0, 1);
      const s = (clamped >= 1) ? 1 : clamped * clamped * (3 - 2 * clamped);

      if (clamped >= 1) {
        this._fovTween.active = false;
        this._aiming = wishAim;
        // sniper special handling
        if (this.currentKey === "marshal") {
          if (this._aiming) {
            if (typeof scopeOverlay !== "undefined" && scopeOverlay) scopeOverlay.style.display = 'block';
            if (isPcEntity(this.viewModel)) { try { this.viewModel.enabled = false; } catch (e) {} }
            else if (this.viewModel && this.viewModel.visible !== undefined) this.viewModel.visible = false;
            else if (this.viewModel && typeof this.viewModel.setLocalScale === 'function') this.viewModel.setLocalScale(0,0,0);
          } else {
            if (typeof scopeOverlay !== "undefined" && scopeOverlay) scopeOverlay.style.display = 'none';
            if (isPcEntity(this.viewModel)) { try { this.viewModel.enabled = true; } catch (e) {} }
            else if (this.viewModel && this.viewModel.visible !== undefined) this.viewModel.visible = true;
            else if (this.viewModel && typeof this.viewModel.setLocalScale === 'function') this.viewModel.setLocalScale(1,1,1);
          }
        }
      }

      // DO NOT change camera FOV here. We intentionally keep camera projection unchanged.
      // animate scale (kept equal to base to avoid disappearing)
      try {
        const fs = this._fovTween.fromScale || {x:1,y:1,z:1}; const ts = this._fovTween.toScale || {x:1,y:1,z:1};
        const sx = fs.x + (ts.x - fs.x) * s; const sy = fs.y + (ts.y - fs.y) * s; const sz = fs.z + (ts.z - fs.z) * s;
        if (this.viewModel.setLocalScale) this.viewModel.setLocalScale(sx,sy,sz);
        else if (this.viewModel.scale) this.viewModel.scale.set(sx,sy,sz);
      } catch(e){}

      // animate position (center the gun relative to camera)
      try {
        const fp = this._fovTween.fromPos || {x:0,y:0,z:0}; const tp = this._fovTween.toPos || {x:0,y:0,z:0};
        const px = fp.x + (tp.x - fp.x) * s, py = fp.y + (tp.y - fp.y) * s, pz = fp.z + (tp.z - fp.z) * s;
        if (this.viewModel.setLocalPosition) this.viewModel.setLocalPosition(px,py,pz);
        else if (this.viewModel.position) this.viewModel.position.set(px,py,pz);
      } catch(e){}
    }

    // ensure viewModel visible if not aiming (in case sniper branch hid it)
    if (!this._aiming) {
      try {
        if (isPcEntity(this.viewModel)) { try { this.viewModel.enabled = true; } catch (e) {} }
        else if (this.viewModel && this.viewModel.visible !== undefined) this.viewModel.visible = true;
        else if (this.viewModel && typeof this.viewModel.setLocalScale === 'function') this.viewModel.setLocalScale(1,1,1);
        if (typeof scopeOverlay !== "undefined" && scopeOverlay) scopeOverlay.style.display = 'none';
      } catch(e){}
    }

    // FIRE / SWING (rest of your logic left unchanged)
    const isSemi = ["deagle","marshal","m79","legion"].includes(this.currentKey);
    const secsPerShot = 60 / (this.stats.fireRateRPM || 600);
    const canFire = this.stats.isMelee
      ? (justPressed && sinceLast > (this._aiming ? (this.stats.heavySwingTime || 0.4) : (this.stats.swingTime || 0.25)))
      : (isSemi ? (justPressed && sinceLast > secsPerShot) : (sinceLast > secsPerShot));

    if (!this.state.pulling && rawFire && !this.isReloadingFlag && canFire) {
      if (this.stats.isMelee) {
        this.state.knifeSwing = true;
        this.state.knifeSwingStart = now;
        this.state.knifeHeavy = !!this._aiming;
        window.localPlayer = window.localPlayer || {};
        window.localPlayer.knifeSwing = true; window.localPlayer.knifeHeavy = !!this.state.knifeHeavy;
        if (typeof this.playWeaponSound === "function") this.playWeaponSound("shot");
        if (typeof this.checkMeleeHit === "function") this.checkMeleeHit(playerState?.collidables || []);
        this.lastShotTime = now;
      } else {
        if (this.ammoInMagazine > 0) {
          this.lastShotTime = now;
          this.ammoInMagazine--;
          this.burstCount++;
          if (typeof this.fireBullet === "function") this.fireBullet(spreadAngle, playerState?.collidables || []);
          if (typeof this.playWeaponSound === "function") this.playWeaponSound("shot");
          try { if (typeof updateAmmoDisplay === "function") updateAmmoDisplay(this.ammoInMagazine, this.stats.magazineSize); } catch (e) {}

          const shotIndex = this.burstCount - 1;
          let rawRecoil = (typeof getRecoilAngle === "function") ? getRecoilAngle(this.currentKey, shotIndex) : 0.01;
          let recoilMultiplier = 4;
          let appliedRecoilAngle = rawRecoil * recoilMultiplier;

          if (this.currentKey === "ak-47" && shotIndex >= 3) {
            const decayFactor = 0.8; const minRecoil = 0.005 * recoilMultiplier;
            const recoilDecay = appliedRecoilAngle * Math.pow(decayFactor, shotIndex - 3);
            appliedRecoilAngle = Math.max(recoilDecay, minRecoil);
          }
          if (this.currentKey === "viper" && shotIndex >= 3) {
            const decayFactor = 0.8; const minRecoil = 0.007 * recoilMultiplier;
            const recoilDecay = appliedRecoilAngle * Math.pow(decayFactor, shotIndex - 3);
            appliedRecoilAngle = Math.max(recoilDecay, minRecoil);
          }

          this._recoil = this._recoil || {};
          this._recoil.peakOffset = appliedRecoilAngle;
          this._recoil.recoilStartTime = now;
          this._recoil.previousRecoilOffset = 0;
          this._recoil.recoilDuration = this._recoil.recoilDuration || 0.25;

          this.state.recoiling = true;
          this.state.recoilStart = now;

          if (this.currentKey === 'deagle' || this.currentKey === 'legion') {
            this.state.deagleRecoil = { active: true, startTime: now, startRotation: (this.viewModel.getLocalEulerAngles ? this.viewModel.getLocalEulerAngles() : (this.viewModel.rotation ? { x:this.viewModel.rotation.x*RAD_TO_DEG, y:this.viewModel.rotation.y*RAD_TO_DEG, z:this.viewModel.rotation.z*RAD_TO_DEG } : {x:0,y:0,z:0})), durationUp: 0.03, durationDown: 0.25, maxAngleUp: 60*DEG_TO_RAD, maxAngleSide: 3*DEG_TO_RAD };
          }
        } else {
          this.isReloadingFlag = true; this.state.reloading = true; this.state.reloadStart = now; this._reloadEndPlayed = false;
          if (typeof this.playWeaponSound === "function") this.playWeaponSound("reloadStart");
        }
      }
    }

    // DEAGLE recoil, knife swing and reload handling — keep rest as before
    // (I intentionally left your existing implementations for those sections unchanged
    //  since earlier issues were mostly around ADS/FOV/visibility — keep them below)
    // ---------- existing code continues unchanged from here ----------
    // deagle recoil
    if (this.state.deagleRecoil && this.state.deagleRecoil.active) {
      const dr = this.state.deagleRecoil; const elapsed = now - dr.startTime; const total = dr.durationUp + dr.durationDown;
      if (elapsed < total) {
        let xAngle = 0, zAngle = 0;
        if (elapsed < dr.durationUp) { const progress = elapsed / dr.durationUp; const easedProgress = 1 - Math.exp(-progress * 5); xAngle = -dr.maxAngleUp * easedProgress; zAngle = -dr.maxAngleSide * easedProgress; }
        else { const downElapsed = elapsed - dr.durationUp; const progress = downElapsed / dr.durationDown; const easedProgress = Math.exp(-progress * 5); xAngle = -dr.maxAngleUp * easedProgress; zAngle = -dr.maxAngleSide * easedProgress; }
        const startRot = dr.startRotation || {x:0,y:0,z:0};
        let startXdeg = startRot.x, startYdeg = startRot.y, startZdeg = startRot.z;
        if (Math.abs(startXdeg) < 1 && Math.abs(startYdeg) < 1 && Math.abs(startZdeg) < 1) { startXdeg *= RAD_TO_DEG; startYdeg *= RAD_TO_DEG; startZdeg *= RAD_TO_DEG; }
        const xDeg = startXdeg - (xAngle * RAD_TO_DEG);
        const zDeg = startZdeg - (zAngle * RAD_TO_DEG);
        if (this.viewModel && typeof this.viewModel.setLocalEulerAngles === 'function') this.viewModel.setLocalEulerAngles(xDeg, startYdeg, zDeg);
        else if (this.viewModel && this.viewModel.rotation) this.viewModel.rotation.set(xDeg*DEG_TO_RAD, startYdeg*DEG_TO_RAD, zDeg*DEG_TO_RAD);
      } else {
        const sr = dr.startRotation || {x:0,y:0,z:0};
        if (this.viewModel && typeof this.viewModel.setLocalEulerAngles === 'function') this.viewModel.setLocalEulerAngles(sr.x, sr.y, sr.z);
        else if (this.viewModel && this.viewModel.rotation) this.viewModel.rotation.set((sr.x||0)*DEG_TO_RAD, (sr.y||0)*DEG_TO_RAD, (sr.z||0)*DEG_TO_RAD);
        this.state.deagleRecoil.active = false;
      }
    }

    // viewmodel recoil kick (unchanged)
    if (this.state.recoiling && !this.stats.isMelee) {
      const VIEWER_RECOIL_ANIM_DURATION = 0.15; const tR = (now - this.state.recoilStart) / VIEWER_RECOIL_ANIM_DURATION;
      if (tR >= 1) {
        const backTo = (this._aiming && gunAimPos[this.currentKey]) ? gunAimPos[this.currentKey] : (this.readyPos || {x:0,y:0,z:0});
        try { if (this.viewModel.setLocalPosition) this.viewModel.setLocalPosition(backTo.x, backTo.y, backTo.z); else if (this.viewModel.position) this.viewModel.position.set(backTo.x, backTo.y, backTo.z); } catch (e) {}
        this.state.recoiling = false;
      } else {
        const baseZ = (this._aiming && gunAimPos[this.currentKey]) ? gunAimPos[this.currentKey].z : (this.readyPos ? this.readyPos.z : 0);
        const kick = (this.stats.recoilDistance || 0.05) * Math.sin(Math.PI * tR);
        const x = (this._aiming && gunAimPos[this.currentKey]) ? gunAimPos[this.currentKey].x : (this.readyPos ? this.readyPos.x : 0);
        const y = (this._aiming && gunAimPos[this.currentKey]) ? gunAimPos[this.currentKey].y : (this.readyPos ? this.readyPos.y : 0);
        if (this.viewModel && typeof this.viewModel.setLocalPosition === 'function') this.viewModel.setLocalPosition(x, y, baseZ + kick);
        else if (this.viewModel && this.viewModel.position) this.viewModel.position.set(x, y, baseZ + kick);
      }
    }

    // knife swing (unchanged)
    if (this.state.knifeSwing && this.stats.isMelee) {
      const restX = 90 * DEG_TO_RAD, restY = 160 * DEG_TO_RAD;
      const elapsed = now - this.state.knifeSwingStart; const dur = this.state.knifeHeavy ? (this.stats.heavySwingTime || 0.6) : (this.stats.swingTime || 0.35);
      if (elapsed >= dur) { if (this.weaponModel && typeof this.weaponModel.setLocalEulerAngles === 'function') this.weaponModel.setLocalEulerAngles(90,160,0); this.state.knifeSwing = false; if (window.localPlayer) { window.localPlayer.knifeSwing = false; window.localPlayer.knifeHeavy = false; } }
      else {
        const progress = elapsed / dur; const maxF = this.state.knifeHeavy ? 0.9 : 1.2; const swingAng = maxF * Math.sin(Math.PI * progress); const sideAng = swingAng * 0.5; const yOffset = 0.5 * Math.sin(Math.PI * progress);
        const xDeg = (restX - swingAng) * RAD_TO_DEG; const yDeg = (restY + yOffset) * RAD_TO_DEG; const zDeg = (0 + sideAng) * RAD_TO_DEG;
        if (this.weaponModel && typeof this.weaponModel.setLocalEulerAngles === 'function') this.weaponModel.setLocalEulerAngles(xDeg,yDeg,zDeg); else if (this.weaponModel && this.weaponModel.rotation) this.weaponModel.rotation.set(xDeg*DEG_TO_RAD, yDeg*DEG_TO_RAD, zDeg*DEG_TO_RAD);
      }
    }

    // reload handling (unchanged)
    if (inputState.reload && !this.isReloadingFlag && this.ammoInMagazine < this.stats.magazineSize) {
      this.isReloadingFlag = true; this.state.reloading = true; this.state.reloadStart = now; this._reloadEndPlayed = false;
      if (typeof this.playWeaponSound === "function") this.playWeaponSound("reloadStart");
    }
    if (this.state.reloading && !this.stats.isMelee) {
      const elapsed = now - this.state.reloadStart; const half = (this.stats.reloadDuration || 1) / 2;
      if (!this._reloadEndPlayed && elapsed >= half) { if (typeof this.playWeaponSound === "function") this.playWeaponSound("reloadEnd"); this._reloadEndPlayed = true; }
      if (elapsed >= (this.stats.reloadDuration || 1)) {
        this.ammoInMagazine = this.stats.magazineSize; this.isReloadingFlag = false; this.state.reloading = false;
        if (this.parts && this.parts.slide && typeof this.parts.slide.setLocalPosition === 'function') {
          const pos = this.parts.slide.getLocalPosition ? this.parts.slide.getLocalPosition() : {x:0,y:0,z:0};
          try { this.parts.slide.setLocalPosition(pos.x, pos.y, 0); } catch (e) {}
        }
        try { if (typeof updateAmmoDisplay === "function") updateAmmoDisplay(this.ammoInMagazine, this.stats.magazineSize); } catch (e) {}
      } else if (elapsed <= half) {
        const angle = (Math.PI / 180) * 40 * (elapsed / half);
        if (this.viewModel && typeof this.viewModel.setLocalEulerAngles === 'function') this.viewModel.setLocalEulerAngles(angle * RAD_TO_DEG, 0, 0);
        else if (this.viewModel && this.viewModel.rotation) this.viewModel.rotation.set(angle,0,0);
        if (this.parts && this.parts.slide && typeof this.parts.slide.setLocalPosition === 'function') {
          const slideZ = -0.05 * (elapsed / half); const pos = this.parts.slide.getLocalPosition ? this.parts.slide.getLocalPosition() : {x:0,y:0,z:0};
          try { this.parts.slide.setLocalPosition(pos.x, pos.y, slideZ); } catch (e) {}
        }
      } else {
        const t2 = (elapsed - half) / half; const angle = (Math.PI / 180) * 40 * (1 - t2);
        if (this.viewModel && typeof this.viewModel.setLocalEulerAngles === 'function') this.viewModel.setLocalEulerAngles(angle * RAD_TO_DEG, 0, 0);
        else if (this.viewModel && this.viewModel.rotation) this.viewModel.rotation.set(angle,0,0);
        if (this.parts && this.parts.slide && typeof this.parts.slide.setLocalPosition === 'function') {
          const slideZ = -0.05 * (1 - t2); const pos = this.parts.slide.getLocalPosition ? this.parts.slide.getLocalPosition() : {x:0,y:0,z:0};
          try { this.parts.slide.setLocalPosition(pos.x, pos.y, slideZ); } catch (e) {}
        }
      }
    }

    // tracer cleanup (unchanged)
    if (this.state.tracerObjects && Array.isArray(this.state.tracerObjects)) {
      this.state.tracerObjects = this.state.tracerObjects.filter(entry => {
        if (!entry) return false;
        if ((now - entry.startTime > 0.2) && entry.entity) {
          try { if (entry.entity.parent) entry.entity.parent.removeChild(entry.entity); if (typeof entry.entity.destroy === "function") entry.entity.destroy(); } catch (e) {}
          return false;
        }
        return true;
      });
    }

    // camera recoil recovery (unchanged)
    this._recoil = this._recoil || { peakOffset: 0, recoilStartTime: 0, previousRecoilOffset: 0, recoilDuration: 0.25 };
    const elapsedRec = now - (this._recoil.recoilStartTime || 0);
    if (elapsedRec < (this._recoil.recoilDuration || 0)) {
      const t = clamp(elapsedRec / (this._recoil.recoilDuration || 0.0001), 0, 1);
      const easedT = 1 - (t * t * (3 - 2 * t));
      const currentRecoilOffset = (this._recoil.peakOffset || 0) * easedT;
      const recoilDelta = currentRecoilOffset - (this._recoil.previousRecoilOffset || 0);
      const deltaDeg = recoilDelta * RAD_TO_DEG;
      try {
        if (this.camera && typeof this.camera.getLocalEulerAngles === 'function' && typeof this.camera.setLocalEulerAngles === 'function') {
          const cur = this.camera.getLocalEulerAngles(); this.camera.setLocalEulerAngles(cur.x + deltaDeg, cur.y, cur.z);
        } else if (this.camera && this.camera.rotation) {
          this.camera.rotation.x += deltaDeg * DEG_TO_RAD;
        }
      } catch (e) {}
      this._recoil.previousRecoilOffset = currentRecoilOffset;
    } else if ((this._recoil.peakOffset || 0) > 0) {
      this._recoil.peakOffset = 0; this._recoil.recoilStartTime = 0; this._recoil.previousRecoilOffset = 0;
    }
  } // end update
} // end WeaponController class

// Export convenience globals used externally
window._pcPrototypeModels = window._pcPrototypeModels || {};
window._prototypeModels = window._prototypeModels || {};
window.activeTracers = window.activeTracers || [];

// -------------------- small exported helpers --------------------
export function addDebugMuzzleDotForParts(parts, size = 0.02) {
  try {
    if (typeof window.addPlaycanvasDebugMuzzleDot === 'function' && parts && parts.muzzle) return window.addPlaycanvasDebugMuzzleDot(parts.muzzle, size);
    if (parts && parts.muzzle && isThreeObject(parts.muzzle)) {
      const s = new THREE.SphereGeometry(size, 8, 8);
      const m = new THREE.MeshBasicMaterial({ color: 0xff0000 });
      const dot = new THREE.Mesh(s, m);
      try { parts.muzzle.add(dot); } catch (e) { if (parts.muzzle.parent) parts.muzzle.parent.add(dot); }
      return dot;
    }
  } catch (e) {}
  return null;
}



// -------------------- Safe bullet-hole wrappers (fixes missing addBulletHole errors) --------------------
(function(global){
  if (!global) return;

  global._threeBulletHoles = global._threeBulletHoles || {};

  function createThreeBulletHole(holeData, key, opts = {}) {
    try {
      if (typeof THREE === "undefined") return null;
      const size = (typeof opts.size === "number") ? opts.size : (opts.defaultSize || 0.15);
      const fadeDuration = (typeof opts.fadeDuration === "number") ? opts.fadeDuration : (opts.defaultFade || 5.0);
      const geom = new THREE.PlaneGeometry(size, size);
      const mat = new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geom, mat);
      const px = (holeData.x !== undefined) ? holeData.x : 0;
      const py = (holeData.y !== undefined) ? holeData.y : 0;
      const pz = (holeData.z !== undefined) ? holeData.z : 0;
      const nx = (holeData.nx !== undefined) ? holeData.nx : 0;
      const ny = (holeData.ny !== undefined) ? holeData.ny : 1;
      const nz = (holeData.nz !== undefined) ? holeData.nz : 0;
      mesh.position.set(px, py, pz);
      // orient plane to face the normal
      const normal = new THREE.Vector3(nx, ny, nz).normalize();
      const target = mesh.position.clone().add(normal);
      mesh.lookAt(target);
      // tiny offset to reduce z-fighting
      mesh.position.add(normal.clone().multiplyScalar(0.002));
      // add to scene (robust lookup)
      const scene = global.scene || (global.window && global.window.scene) || (global.THREE && global.THREE.Scene && null);
      if (scene && typeof scene.add === "function") scene.add(mesh);
      else if (global.camera && typeof global.camera.add === "function") global.camera.add(mesh);
      else if (global.scene && typeof global.scene.add === "function") global.scene.add(mesh);
      // store for removal
      if (key) global._threeBulletHoles[key] = mesh;

      // fade and remove
      const start = performance.now();
      const animate = () => {
        const now = performance.now();
        const t = (now - start) / (fadeDuration * 1000);
        if (!mesh.parent || t >= 1) {
          try { if (mesh.parent) mesh.parent.remove(mesh); } catch(e){}
          try { geom.dispose(); mat.dispose(); } catch(e){}
          if (key && global._threeBulletHoles[key] === mesh) delete global._threeBulletHoles[key];
          return;
        }
        mat.opacity = 0.85 * (1 - t);
        requestAnimationFrame(animate);
      };
      requestAnimationFrame(animate);
      return mesh;
    } catch(e) {
      console.warn("createThreeBulletHole failed", e);
      return null;
    }
  }

  // addBulletHole wrapper: prefer PlayCanvas manager, else fallback to THREE implementation
  global.addBulletHole = global.addBulletHole || function(holeData, firebaseKey, opts = {}) {
    try {
      if (global.PCBulletHoleManager && typeof global.PCBulletHoleManager.addBulletHole === 'function') {
        return global.PCBulletHoleManager.addBulletHole(holeData, firebaseKey, opts);
      }
      // some code expects addBulletHole(payload, key) signature, so we accept both
      return createThreeBulletHole(holeData || {}, firebaseKey, opts);
    } catch (e) {
      console.warn("addBulletHole wrapper failed", e);
      try { return createThreeBulletHole(holeData || {}, firebaseKey, opts); } catch(e2){}
    }
    return null;
  };

  // removeBulletHole wrapper: mirror PlayCanvas manager or Three fallback
  global.removeBulletHole = global.removeBulletHole || function(firebaseKey) {
    try {
      if (global.PCBulletHoleManager && typeof global.PCBulletHoleManager.removeBulletHole === 'function') {
        return global.PCBulletHoleManager.removeBulletHole(firebaseKey);
      }
      const mesh = global._threeBulletHoles && global._threeBulletHoles[firebaseKey];
      if (mesh) {
        try { if (mesh.parent) mesh.parent.remove(mesh); } catch(e){}
        if (global._threeBulletHoles) delete global._threeBulletHoles[firebaseKey];
      }
    } catch(e) { console.warn("removeBulletHole wrapper failed", e); }
  };

})(window);


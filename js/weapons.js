

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


// ffff

let realPenetrate = false;

const scopeOverlay = document.getElementById('scopeOverlay');

export const _prototypeModels = {};
let camera = window.camera

const loader = new OBJLoader();
const objURL = "https://raw.githubusercontent.com/thearthd/3d-models/refs/heads/main/deagle.obj";
loader.load(
  objURL,
  (group) => {
    group.scale.set(0.01, 0.01, 0.01);
    group.position.set(0, 0, 0);
    group.traverse((child) => {
      if (child.isMesh) {
        child.material = new THREE.MeshStandardMaterial({
          color: 0xdddddd,
          metalness: 0.5,
          roughness: 0.4
        });
      }
    });
    scene.add(group);
  },
  (xhr) => {
    if (xhr.lengthComputable) {
      console.log(`Model ${(xhr.loaded / xhr.total * 100).toFixed(2)}% loaded`);
    }
  },
  (err) => {
    console.error("Error loading OBJ:", err);
  }
);


function playBodyHit() {
    setTimeout(() => {
        let bodyHit = new Audio("https://codehs.com/uploads/a20a1a356bea275a0b124e706b1e24ba");
        bodyHit.volume = 1;
        bodyHit.play();
       // console.log("playBodyHit")
    }, 100);
}

function playBodyHeadshot() {
    setTimeout(() => {
        let bodyHeadshot = new Audio("https://codehs.com/uploads/de124c69b20be47b9fa42b1b1b1aa580");
        bodyHeadshot.volume = 1;
        bodyHeadshot.play();
      //  console.log("playBodyHeadshot")
    }, 100);
}

function createMetalMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color: color,
    metalness: 0.9,
    roughness: 0.3,
    envMapIntensity: 1
  });
}
function createPlasticMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color: color,
    metalness: 0.1,
    roughness: 0.8
  });
}
function createWoodMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color: color,
    metalness: 0.0,
    roughness: 0.7
  });
}
function createSkinMaterial(color = "#f5be90") {
  return new THREE.MeshStandardMaterial({ color, metalness: 0.1, roughness: 0.8 });
}
function createGlassMaterial(color, opacity) {
  return new THREE.MeshPhysicalMaterial({
    color: color,
    metalness: 0,
    roughness: 0.1,
    transmission: 0.9,
    transparent: true,
    opacity: opacity,
    ior: 1.5,
    thickness: 0.1
  });
}
function capitalize(name) {
  return name.charAt(0).toUpperCase() + name.slice(1);
}
let swingTime;

function worldUnitsToMeters(worldDistance, unitsPerMeter) {
  return Number(worldDistance) / Number(unitsPerMeter || 1);
}

function debugDistance(origin, targetPosition, markerManager, weaponController) {
  const worldDist = origin.distanceTo(targetPosition);
  const markerMeters = worldDist / (markerManager?.unitsPerMeter ?? 1);
  const weaponMeters = worldDist / (weaponController?.unitsPerMeter ?? 1);
  console.log("DEBUG DISTANCE CHECK:");
  console.log("  raw world units:", worldDist);
  console.log("  marker unitsPerMeter:", markerManager?.unitsPerMeter, " -> marker meters:", markerMeters);
  console.log("  weapon unitsPerMeter:", weaponController?.unitsPerMeter, " -> weapon meters:", weaponMeters);
}


function calculateDamageWithDropOff(baseDamage, distance, dropOff = {}, isHead = false) {
  // Determine if we are in the "absolute" format: dropOff.head / dropOff.body
  let useAbsolute = false;
  let map = dropOff || {};

  if (dropOff && typeof dropOff === 'object' && (dropOff.head || dropOff.body)) {
    useAbsolute = true;
    map = isHead ? (dropOff.head || dropOff.body || {}) : (dropOff.body || dropOff.head || {});
  }

  // Build sorted points array from map which can be:
  // - an array of values -> evenly spaced up to 50m (i+1)*(50/n)
  // - an object with numeric keys -> use those distances
  function buildPoints(m) {
    if (Array.isArray(m)) {
      const n = m.length;
      if (n === 0) return { points: [], sourceWasArray: true };
      const pts = m
        .map((val, i) => ({ d: (50 * (i + 1) / n), v: Number(val) }))
        .filter(p => !Number.isNaN(p.v))
        .sort((a, b) => a.d - b.d);
      return { points: pts, sourceWasArray: true };
    }
    // object case
    const pts = Object.entries(m || {})
      .map(([k, v]) => ({ d: Number(k), v: Number(v) }))
      .filter(p => !Number.isNaN(p.d) && !Number.isNaN(p.v))
      .sort((a, b) => a.d - b.d);
    return { points: pts, sourceWasArray: false };
  }

  const { points, sourceWasArray } = buildPoints(map);

  // nothing defined -> no dropoff
  if (!points || points.length === 0) return baseDamage;

  // clamp negative distances
  if (distance <= 0) return baseDamage;

  // simple linear lerp (used only for multiplier format)
  const lerp = (a, b, t) => a + (b - a) * t;

  // ---------- ABSOLUTE MODE (STEP / exact meter cutoff) ----------
  if (useAbsolute) {
    // If distance is before or equal to first point -> return first value
    if (distance <= points[0].d) {
      return Math.max(0, points[0].v);
    }
    // Find the last point whose distance <= given distance (step behavior)
    for (let i = points.length - 1; i >= 0; i--) {
      if (distance >= points[i].d) {
        return Math.max(0, points[i].v);
      }
    }
    // Fallback (shouldn't happen) -> return last
    return Math.max(0, points[points.length - 1].v);
  }

  // ---------- MULTIPLIER / INTERPOLATION MODE ----------
  // If distance is before first point: interpolate from factor 1 at 0m to first.v at first.d
  if (distance <= points[0].d) {
    const first = points[0];
    const t = first.d === 0 ? 1 : (distance / first.d);
    const factor = lerp(1, first.v, t);
    return Math.max(0, baseDamage * factor);
  }

  // Between points -> interpolate multipliers
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    if (distance <= b.d) {
      const t = (distance - a.d) / (b.d - a.d);
      const interp = lerp(a.v, b.v, t);
      return Math.max(0, baseDamage * interp);
    }
  }

  // Beyond last point: use last point multiplier
  const last = points[points.length - 1];
  return Math.max(0, baseDamage * last.v);
}



export class WeaponController {
  static WEAPONS = {
    knife: {
      name: "Knife",
      bodyDamage: 70,
      isMelee: true,
      magazineSize: Infinity,
      swingTime: 300 / 600,
      heavySwingTime: 300 / 600,
      pullDuration: 300 / 600 / 2,
      reloadDuration: null,
      speedModifier: 1.1 - 0.1,
      rpm: 120,
      tracerLength: 0,
      damageDropOff: {
        body: [70]
      },
    },
    deagle: {
      name: "Desert Eagle",
      isMelee: false,
      headshotDamage: 180,
      bodyDamage: 76,
      fireRateRPM: 125,
      magazineSize: 8,
      reloadDuration: 1.8,
      pullDuration: 0.5,
      recoilDistance: 0.08,
      recoilDuration: 0.08,
      tracerLength: 100,
      speedModifier: 1 - 0.1,
      damageDropOff: {
        head: [180, 160, 140],
        body: [76, 66, 56]
      },
    },
    "ak-47": {
      name: "AK-47",
      isMelee: false,
      headshotDamage: 100,
      bodyDamage: 30,
      fireRateRPM: 600,
      magazineSize: 25,
      reloadDuration: 2.5,
      pullDuration: 0.6,
      recoilDistance: 0.07,
      recoilDuration: 0.06,
      tracerLength: 100,
      speedModifier: 0.8 - 0.1,
      damageDropOff: {
        head: [100, 80, 60],
        body: [30, 26, 22]
      },
    },
    viper: {
      name: "Viper",
      isMelee: false,
      headshotDamage: 60,
      bodyDamage: 20,
      fireRateRPM: 800,
      magazineSize: 35,
      reloadDuration: 2.1,
      pullDuration: 0.6,
      recoilDistance: 0.07,
      recoilDuration: 0.06,
      tracerLength: 50,
      speedModifier: 0.9 - 0.1,
      damageDropOff: {
        head: [60, 50, 40],
        body: [20, 16, 12]
      },
    },
    marshal: {
      name: "Marshal",
      isMelee: false,
      headshotDamage: 300,
      bodyDamage: 150,
      fireRateRPM: 48,
      magazineSize: 5,
      reloadDuration: 2.8,
      pullDuration: 48 / 60,
      recoilDistance: 0.12,
      recoilDuration: 0.1,
      isSniper: true,
      tracerLength: 100,
      speedModifier: 0.7 - 0.1,
      damageDropOff: {
        head: [300, 260, 220],
        body: [150, 130, 120]
      },
    },
    m79: {
      name: "M-79",
      isMelee: false,
      headshotDamage: 54,
      bodyDamage: 22,
      fireRateRPM: 405,
      magazineSize: 12,
      reloadDuration: 1.8,
      pullDuration: 125 / 600 * 1.5,
      recoilDistance: 0.08,
      recoilDuration: 0.08,
      speedModifier: 1 - 0.1,
      tracerLength: 20,
      damageDropOff: {
        head: [54, 44, 36],
        body: [22, 18, 16]
      },
    },
    legion: {
      name: "Legion",
      isMelee: false,
      headshotDamage: 124,
      bodyDamage: 76,
      fireRateRPM: 45,
      magazineSize: 2,
      reloadDuration: 3,
      pullDuration: 1.33,
      recoilDistance: 0.08,
      recoilDuration: 0.08,
      tracerLength: 100,
      speedModifier: 0.9 - 0.1,
      damageDropOff: {
        head: [124, 110, 100],
        body: [76, 68, 62]
      },
    },
  };

  static SOUNDS = {
    knife: {
      shot: 'https://codehs.com/uploads/a3b7d894d7ce224bc7dcbc93181862da',
      pull: 'https://codehs.com/uploads/433c856c847bc650b59d966f155b3f1d',
      reloadStart: null,
      reloadEnd: null,
    },
    deagle: {
      shot: 'https://codehs.com/uploads/ab0452d6facfe07db8d94ac658195a5d',
      pull: 'https://codehs.com/uploads/c1b3935dd9777a8d32037e1538c5a09e',
      reloadStart: 'https://codehs.com/uploads/238ffcd55332e871083db2bf7644aff1',
      reloadEnd: 'https://codehs.com/uploads/830cd250b21f3da989f345833a010cbf',
    },
    'ak-47': {
      shot: 'https://codehs.com/uploads/35aaccb252e92205c08699da0818c524',
      pull: 'https://codehs.com/uploads/2f1ba563e325477717d4f97e18ff62b2',
      reloadStart: 'https://codehs.com/uploads/fb84ff53478328e3b508a65097a7cd7b',
      reloadEnd: 'https://codehs.com/uploads/3275c387a1288d0a040b8aebb3958e97',
    },
    marshal: {
      shot: 'https://codehs.com/uploads/c706ed1686988515f8767aa46952fd23',
      pull: 'https://codehs.com/uploads/c5684202c108d053ba61561a62e4c1ca',
      reloadStart: 'https://codehs.com/uploads/80601ac1055d110402b6a87d3520b025',
      reloadEnd: 'https://codehs.com/uploads/171d3fdd7af759a85fd178bb706ff0ad',
    },
    m79: {
      shot: 'https://codehs.com/uploads/8b81838df3b08b56fac7f26a2ca9e7c3',
      pull: 'https://codehs.com/uploads/aff98052ce443af0016300655d234189',
      reloadStart: 'https://codehs.com/uploads/c037824e7ad86dcf55ca2e89b0b893af',
      reloadEnd: 'https://codehs.com/uploads/bb78ded10db4f1f4a9092d5744bda11a',
    },
    viper: {
      shot: 'https://codehs.com/uploads/7536977c95aafe3ed9b2633239282f88',
      pull: 'https://codehs.com/uploads/6305a83477d217c2575c59e90b8273fd',
      reloadStart: 'https://codehs.com/uploads/bceedd01e90d49150d6d0c33f8107066',
      reloadEnd: 'https://codehs.com/uploads/bc0dfbadc36ac155b7944c788c827135',
    },
    legion: {
      shot: 'https://codehs.com/uploads/616e8771754822be53dd1448f9856623',
      pull: 'https://codehs.com/uploads/fe236825318fcd2a9adfc60224701585',
      reloadStart: 'https://codehs.com/uploads/9f62af374bd5d875478b4c5164257a1a',
      reloadEnd: 'https://codehs.com/uploads/d656c6f3c369fbc977122a575c172468',
    },
  };

 constructor(camera, playersRef, holesRef, createTracer, localPlayerId, physicsController) {
    this.camera = window.camera;
    this.physicsController = window.physicsController;
    this.playersRef = playersRef;
    this.holesRef = holesRef;
    this.createTracer = createTracer;
    this.localPlayerId = localPlayerId;
    this._prevFire = false;
    this._lastKnifeSwingTime = 0;
    this.stats = WeaponController.WEAPONS.knife;
    this.ammoInMagazine = this.stats.magazineSize;
    this.ammoStore = {};
    this.isReloadingFlag = false;
    this.lastShotTime = 0;
    this.burstCount = 0;
    this._reloadEndPlayed = false;
    this.checkMeleeHit = this.checkMeleeHit.bind(this);
    this.viewModel = new THREE.Group();
    this.parts = { slide: null, muzzle: null };
    this.state = { pulling: false, pullStart: 0, pullFrom: new THREE.Vector3(), pullTo: new THREE.Vector3(), recoiling: false, recoilStart: 0, reloading: false, reloadStart: 0, knifeSwing: false, knifeSwingStart: 0, knifeHeavy: false, tracerObjects: [] };
    this.audio = {};
    for (const [key, paths] of Object.entries(WeaponController.SOUNDS)) {
      this.audio[key] = {
        shot: paths.shot ? new Audio(paths.shot) : null,
        pull: paths.pull ? new Audio(paths.pull) : null,
        reloadStart: paths.reloadStart ? new Audio(paths.reloadStart) : null,
        reloadEnd: paths.reloadEnd ? new Audio(paths.reloadEnd) : null
      };
    }
    this.offPos = new THREE.Vector3(0.5, -0.7, -1.5);
    this.readyPos = new THREE.Vector3(0.3, -0.5, -0.7);
    this.readyRot = new THREE.Euler(0, 0, 0);
    this._lastKnifeSwingTime = 0;
    this.createPlayerArm();
    this.viewModel.position.copy(this.readyPos);
    this.viewModel.rotation.copy(this.readyRot);

    this.scene = window.scene;
    this.raycaster = new THREE.Raycaster();

this._recoil = {
  currentOffset: 0,
  peakOffset:    0,
  recoilStartTime: 0,
  recoilDuration:  0.25
};
  }

equipWeapon(weaponKey) {
  if (!WeaponController.WEAPONS[weaponKey]) {
    console.warn(`[WeaponController] Unknown weapon: ${weaponKey}`);
    return;
  }

  // ---- Save current ammo ----
  if (this.currentKey) {
    this.ammoStore[this.currentKey] = this.ammoInMagazine;
  }

  // ---- Helper: inline disposal logic (local functions) ----
  // Dispose textures referenced by a material
  const disposeMaterialTextures = (material) => {
    try {
      for (const prop in material) {
        if (!Object.prototype.hasOwnProperty.call(material, prop)) continue;
        const value = material[prop];
        if (value && value.isTexture) {
          try { value.dispose(); } catch (e) { /* ignore */ }
        }
      }
    } catch (e) { /* ignore */ }
  };

  // Dispose a material (array or single)
  const disposeMaterial = (mat) => {
    if (!mat) return;
    if (Array.isArray(mat)) {
      mat.forEach(m => {
        try { disposeMaterialTextures(m); } catch {}
        try { m.dispose(); } catch {}
      });
    } else {
      try { disposeMaterialTextures(mat); } catch {}
      try { mat.dispose(); } catch {}
    }
  };

  // Recursively dispose geometries/materials and stop mixers on a root object
  const disposeThreeObject = (root) => {
    if (!root) return;
    root.traverse((child) => {
      // stop animation mixer if stored on userData
      if (child.userData && child.userData.mixer) {
        try { child.userData.mixer.stopAllAction(); } catch (e) {}
        try { child.userData.mixer.uncacheRoot(child); } catch (e) {}
        delete child.userData.mixer;
      }

      if (child.geometry) {
        try { child.geometry.dispose(); } catch (e) {}
        child.geometry = undefined;
      }

      if (child.material) {
        try { disposeMaterial(child.material); } catch (e) {}
        child.material = undefined;
      }
    });
  };

  // ---- Cleanup tracer objects (remove + dispose geometry/material) ----
  if (this.state && Array.isArray(this.state.tracerObjects)) {
    this.state.tracerObjects.forEach(entry => {
      const lm = entry.lineMesh;
      if (!lm) return;
      try {
        if (lm.parent) lm.parent.remove(lm);
      } catch (e) {}
      if (lm.geometry) {
        try { lm.geometry.dispose(); } catch (e) {}
        lm.geometry = undefined;
      }
      if (lm.material) {
        try { disposeMaterial(lm.material); } catch (e) {}
        lm.material = undefined;
      }
    });
    // keep the array but empty it
    this.state.tracerObjects.length = 0;
  }

  // ---- Remove & dispose previous viewModel ----
  // Ensure global cache exists
  if (typeof window._weaponInstanceCache === "undefined") window._weaponInstanceCache = {};

  // Helper to check if an object is one of our cached prototypes (we should not dispose cached instances)
  const isCachedInstance = (obj) => {
    if (!obj) return false;
    for (const k in window._weaponInstanceCache) {
      if (window._weaponInstanceCache[k] === obj) return true;
    }
    return false;
  };

  // If a previous viewModel exists, remove it from camera and dispose if it's not cached
  if (this.viewModel) {
    try {
      if (this.viewModel.parent === this.camera) this.camera.remove(this.viewModel);
    } catch (e) {}

    // If the weaponModel inside viewModel is a cached instance, don't dispose shared resources —
    // just remove and hide it so the cache remains intact.
    if (this.weaponModel && isCachedInstance(this.weaponModel)) {
      try { this.weaponModel.visible = false; } catch (e) {}
      try {
        // remove from any parent just in case
        if (this.weaponModel.parent) this.weaponModel.parent.remove(this.weaponModel);
      } catch (e) {}
      // We still clear references so GC can collect viewModel container
      this.weaponModel = null;
      this.parts = {};
      this.viewModel = null;
    } else {
      // Fully dispose the viewModel and its children (buildX fallback objects typically fall here)
      try { disposeThreeObject(this.viewModel); } catch (e) {}
      this.weaponModel = null;
      this.parts = {};
      this.viewModel = null;
    }
  }

  // ---- Reset core state and create fresh viewModel container ----
  this.currentKey = weaponKey;
  this.stats = WeaponController.WEAPONS[weaponKey];
  this.isReloadingFlag = false;
  this.lastShotTime = 0;
  this.burstCount = 0;
  this.speedModifier = this.stats.speedModifier;
  this.ammoInMagazine = this.ammoStore[weaponKey] != null
      ? this.ammoStore[weaponKey]
      : this.stats.magazineSize;

  this.state = {
    pulling: false,
    pullStart: 0,
    pullFrom: new THREE.Vector3(),
    pullTo: new THREE.Vector3(),
    recoiling: false,
    recoilStart: 0,
    reloading: false,
    reloadStart: 0,
    knifeSwing: false,
    knifeSwingStart: 0,
    knifeHeavy: false,
    tracerObjects: [] // fresh array
  };

  this.viewModel = new THREE.Group();
  this.viewModel.name = "ViewModelRoot";
  this.createPlayerArm();

  // ---- Build normalized key and pick source (cached clone or prototype or fallback) ----
  const key = weaponKey.replace(/-/g, "").toLowerCase();
  const proto = _prototypeModels[key];

  // ensure parts object is reset
  this.parts = {};

  // Inline function to prepare and attach a modelGroup to the viewModel (keeps everything local)
  const attachModel = (modelGroup) => {
    if (!modelGroup) return;

    // ensure model is not parented elsewhere
    try { if (modelGroup.parent) modelGroup.parent.remove(modelGroup); } catch (e) {}

    // Make the model visible and attach
    modelGroup.visible = true;
    this.viewModel.add(modelGroup);
    this.weaponModel = modelGroup;

    // store animation mixer reference if we need to create one (only if animations exist)
    if (modelGroup.animations && modelGroup.animations.length) {
      try {
        const mixer = new THREE.AnimationMixer(modelGroup);
        modelGroup.userData.mixer = mixer;
        // NOTE: we don't start playing any default action here; your code can do that if needed
      } catch (e) { /* ignore */ }
    }

    // find muzzle child anywhere under the model
    let muzzle = null;
    modelGroup.traverse(child => {
      if (child.name === "Muzzle") muzzle = child;
    });
    if (muzzle) this.parts.muzzle = muzzle;

    // 7) Do animation-in
    this.viewModel.position.copy(this.offPos);
    this.viewModel.rotation.copy(this.readyRot);
    try { this.camera.add(this.viewModel); } catch (e) { /* ignore */ }
    this.state.pulling = true;
    this.state.pullStart = performance.now() / 1000;
    this.state.pullFrom.copy(this.offPos);
    this.state.pullTo.copy(this.readyPos);

    // 8) Play the pull sound (reuse audio object if available)
    const pullSnd = this.audio && this.audio[this.currentKey] && this.audio[this.currentKey].pull;
    if (pullSnd) {
      try { pullSnd.currentTime = 0; pullSnd.play(); } catch (e) {}
      try {
        const pos = new THREE.Vector3();
        this.camera.getWorldPosition(pos);
        sendSoundEvent(this.currentKey, "pull", pos);
      } catch (e) {}
    }

    // 9) Update UI
    try { updateAmmoDisplay(this.ammoInMagazine, this.stats.magazineSize); } catch (e) {}
    try { updateInventory(this.currentKey); } catch (e) {}
  };

  // ---- If prototype exists, try to get or create cached instance ----
  if (proto) {
    // ensure a cache exists and return a single shared instance per key
    if (!window._weaponInstanceCache[key]) {
      try {
        const cached = proto.clone(true);
        cached.visible = false;
        // detach just in case
        try { if (cached.parent) cached.parent.remove(cached); } catch (e) {}
        window._weaponInstanceCache[key] = cached;
      } catch (e) {
        console.warn(`[WeaponController] Failed to clone proto for ${key}:`, e);
        window._weaponInstanceCache[key] = null;
      }
    }

    const cachedInstance = window._weaponInstanceCache[key];

    // Apply deterministic transforms to the instance for this weapon (safe because we always set them)
    if (cachedInstance) {
      // Reset transforms first so repeated equips don't compound transforms
      cachedInstance.scale.set(1, 1, 1);
      cachedInstance.rotation.set(0, 0, 0);
      cachedInstance.position.set(0, 0, 0);

      switch (key) {
        case "knife":
          cachedInstance.scale.set(0.001, 0.001, 0.001);
          cachedInstance.rotation.set(
            THREE.MathUtils.degToRad(90),
            THREE.MathUtils.degToRad(160),
            0
          );
          cachedInstance.position.set(0.5, -0.1, -0.7);
          break;
        case "deagle":
        case "legion":
        case "m79":
          cachedInstance.scale.set(0.3, 0.3, 0.3);
          cachedInstance.rotation.set(
            THREE.MathUtils.degToRad(7),
            THREE.MathUtils.degToRad(180),
            0
          );
          cachedInstance.position.set(
            0.15 * (window.innerWidth / 1920),
            0.10 * (window.innerHeight / 1080),
            -0.1 * (window.innerWidth / 1920)
          );
          break;
        case "ak47":
          cachedInstance.scale.set(0.4, 0.4, 0.4);
          cachedInstance.rotation.set(
            THREE.MathUtils.degToRad(4),
            THREE.MathUtils.degToRad(180),
            0
          );
          cachedInstance.position.set(
            0.35 * (window.innerWidth / 1920),
            -0.15 * (window.innerHeight / 1080),
            -0.3 * (window.innerWidth / 1920)
          );
          break;
        case "viper":
          cachedInstance.scale.set(0.4, 0.4, 0.4);
          cachedInstance.rotation.set(
            THREE.MathUtils.degToRad(4),
            THREE.MathUtils.degToRad(180),
            0
          );
          cachedInstance.position.set(
            0.35 * (window.innerWidth / 1920),
            -0.15 * (window.innerHeight / 1080),
            0 * (window.innerWidth / 1920)
          );
          break;
        case "marshal":
          cachedInstance.scale.set(1, 1, 1);
          cachedInstance.rotation.set(0, 0, 0);
          cachedInstance.position.set(
            0.15 * (window.innerWidth / 1920),
            0.15 * (window.innerHeight / 1080),
            -0.1 * (window.innerWidth / 1920)
          );
          break;
        default:
          console.warn(`[WeaponController] No transform logic for "${key}"`);
      }

      attachModel(cachedInstance);
    } else {
      // fallback to build methods if cache failed or is null
      console.warn(`[WeaponController] cached proto missing for "${key}" → falling back to build method.`);
      switch (key) {
        case "knife":
          this.buildKnife();
          attachModel(this.weaponModel);
          break;
        case "deagle":
          this.buildDeagle();
          attachModel(this.weaponModel);
          break;
        case "legion":
          this.buildLegion();
          attachModel(this.weaponModel);
          break;
        case "ak47":
          this.buildAK47();
          attachModel(this.weaponModel);
          break;
        case "marshal":
          this.buildMarshal();
          attachModel(this.weaponModel);
          break;
        case "viper":
          this.buildViper();
          attachModel(this.weaponModel);
          break;
        case "m79":
          this.buildM79();
          attachModel(this.weaponModel);
          break;
        default:
          console.error(`[WeaponController] No build method for "${key}"`);
          break;
      }
    }
  } else {
    // No prototype at all — run buildX directly (your original fallback)
    console.warn(`[WeaponController] Prototype for "${key}" missing → running build${key.charAt(0).toUpperCase()+key.slice(1)}()`);
    switch (key) {
      case "knife":
        this.buildKnife();
        attachModel(this.weaponModel);
        break;
      case "deagle":
        this.buildDeagle();
        attachModel(this.weaponModel);
        break;
      case "legion":
        this.buildLegion();
        attachModel(this.weaponModel);
        break;
      case "ak47":
        this.buildAK47();
        attachModel(this.weaponModel);
        break;
      case "marshal":
        this.buildMarshal();
        attachModel(this.weaponModel);
        break;
      case "viper":
        this.buildViper();
        attachModel(this.weaponModel);
        break;
      case "m79":
        this.buildM79();
        attachModel(this.weaponModel);
        break;
      default:
        console.error(`[WeaponController] No build method for "${key}"`);
        break;
    }
  }
}








  playWeaponSound(soundType) {
    const soundSrc = WeaponController.SOUNDS[this.currentKey]?.[soundType];
    if (soundSrc) {
      const snd = new Audio(soundSrc);
      snd.volume = 1;
      snd.play().catch(() => {});
      const pos = new THREE.Vector3();
      this.camera.getWorldPosition(pos);
      sendSoundEvent(this.currentKey, soundType, pos);
    }
  }

update(inputState, delta, playerState) {
    // --- Lazy initialize any weapon (incl. knife) if we haven't yet ---
    if (!this.viewModel) {
      this.equipWeapon(this.currentKey || "knife");
      return;
    }

    // --- EDGE DETECTION: build our own “justPressed” for semi-autos ---
    const rawFire     = inputState.fire;
    const justPressed = rawFire && !this._prevFire;
    this._prevFire    = rawFire;

    // --- Gather common state ---
    const velocity      = playerState.velocity;
    const isCrouched    = playerState.isCrouched;
    const wishAim       = inputState.aim;
    const isGrounded    = playerState.physicsController.isGrounded;
    const now           = performance.now() / 1000;
    const sinceLast     = now - this.lastShotTime;
    const defaultAimPos = new THREE.Vector3(0, -0.3, -0.5);

    // --- NEW: Define aiming positions for each gun ---
    const gunAimPos = {
        "ak-47": new THREE.Vector3(0, -0.3, -0.5),
        "deagle": new THREE.Vector3(0, -0.3, -0.5),
        "m79": new THREE.Vector3(0.2, -0.4, -0.7), // away from center, away from bottom, away from player
        "viper": new THREE.Vector3(0, -0.3, -0.5),
        "legion": new THREE.Vector3(0, -0.15, -0.5),
        "marshal": new THREE.Vector3(-0.025, -0.035, -0.2) // Special position for sniper scope
    };

    // Handle weapon switch & ADS positioning
    if (this.currentKey !== this._prevKey) {
      if (this._aiming) {
        // If the player was ADS, start a smooth zoom-out tween.
        this._fovTween = {
            active: true,
            fromFov: this.camera.fov,
            toFov: ADS_FOV.default,
            fromScale: this.viewModel.scale.clone(),
            toScale: this.viewModel.scale.clone(),
            fromPos: this.viewModel.position.clone(),
            toPos: this.readyPos.clone(),
            startTime: now,
            duration: 0.2 // Match this duration to your normal zoom-in/out tween
        };
        // Correctly reset aiming flag immediately on weapon swap
        this._aiming = false;
      }

      if (this._prevKey === "marshal" && this._aiming) {
        scopeOverlay.style.display = 'none';
      }
      this._prevKey = this.currentKey;
      this.equipWeapon(this.currentKey);

      if (this.currentKey !== "marshal") {
        scopeOverlay.style.display = 'none';
      }
    }

    // Handle slide-pull animation
    if (this.state.pulling) {
      const tPull = (now - this.state.pullStart) / this.stats.pullDuration;
      if (tPull >= 1) {
        this.viewModel.position.copy(this.state.pullTo);
        this.state.pulling = false;
      } else {
        this.viewModel.position.lerpVectors(this.state.pullFrom, this.state.pullTo, tPull);
      }
    }

    // Crosshair spread
    let spreadAngle = getSpreadMultiplier(
      this.currentKey,
      velocity,
      isCrouched,
      this._aiming,
      isGrounded,
      this.burstCount
    );
    updateCrosshair(spreadAngle);
    playerState.isAirborne = !isGrounded;

    // Reset burst count on release for full-auto weapons
    if (!rawFire && this.currentKey === "ak-47") {
      this.burstCount = 0;
    }
    if (!rawFire && this.currentKey === "viper") {
      this.burstCount = 0;
    }

    // Aim toggle tweening
    if (wishAim !== this._prevWishAim) {
      // Prevent ADS if the weapon is still in the pullout or reload animation.
      if (this.state.pulling || this.isReloadingFlag) {
          this._prevWishAim = wishAim;
          return;
      }
      // Check if the current gun is aimable.
      const aimableGuns = ["ak-47", "deagle", "m79", "viper", "legion", "marshal"];
      if (wishAim && !aimableGuns.includes(this.currentKey)) {
        this._prevWishAim = wishAim;
        return;
      }

      this._baseFov    = this.camera.fov;
      this._baseScale  = this.viewModel.scale.clone();
      this._fromPos    = this.viewModel.position.clone();

      const adsFovMap = {
          "ak-47": ADS_FOV.ak47,
          "viper": ADS_FOV.viper,
          "deagle": ADS_FOV.deagle,
          "m79": ADS_FOV.m79,
          "legion": ADS_FOV.legion,
      };

      const targetFov = wishAim
          ? (this.stats.isSniper 
              ? ADS_FOV.marshal 
              : adsFovMap[this.currentKey] || ADS_FOV.default)
          : ADS_FOV.default;

      const toPos = wishAim
          ? gunAimPos[this.currentKey].clone()
          : this.readyPos.clone();

      this._fovTween = {
          active: true,
          fromFov: this._baseFov,
          toFov: targetFov,
          fromScale: this._baseScale.clone(),
          toScale: this._baseScale.clone().multiplyScalar(targetFov / this._baseFov),
          fromPos: this._fromPos.clone(),
          toPos: toPos,
          startTime: now,
          duration: 0.2
      };

      if (this.currentKey !== "marshal") {
          scopeOverlay.style.display = 'none';
      }
    }
this._prevWishAim = wishAim;

    // FIX: Initialize _fovTween if it doesn't exist to prevent the TypeError.
    // This ensures the object exists before we try to read its properties.
    this._fovTween = this._fovTween || { active: false };

    if (this._fovTween.active) {
      const t  = (now - this._fovTween.startTime) / this._fovTween.duration;
      const s  = t >= 1 ? 1 : t * t * (3 - 2 * t);
      if (t >= 1) {
        this._fovTween.active = false;
        this._aiming = wishAim;
            if (this.currentKey === "marshal") {
                if (this._aiming) {
                    scopeOverlay.style.display = 'block';
                    this.viewModel.visible = false;
                } else {
                }
            }
      }
      this.camera.fov = THREE.MathUtils.lerp(this._fovTween.fromFov, this._fovTween.toFov, s);
      this.camera.updateProjectionMatrix();
      this.viewModel.scale.copy(
        this._fovTween.fromScale.clone().lerp(this._fovTween.toScale, s)
      );
      this.viewModel.position.copy(
        this._fovTween.fromPos.clone().lerp(this._fovTween.toPos, s)
      );
    }

  if (!wishAim) {
      this.viewModel.visible = true;
      scopeOverlay.style.display = 'none'; // Added to ensure it hides when no longer aiming
  }

    // --- FIRING / SWINGING LOGIC ---
    const isSemi      = ["deagle","marshal","m79","legion"].includes(this.currentKey);
    const secsPerShot = 60 / this.stats.fireRateRPM;
    const canFire     = this.stats.isMelee
      ? justPressed && sinceLast > (this._aiming ? this.stats.heavySwingTime : this.stats.swingTime)
      : (isSemi
          ? justPressed && sinceLast > secsPerShot
          : sinceLast > secsPerShot
        );

    if (!this.state.pulling && rawFire && !this.isReloadingFlag && canFire) {
      // —— MELEE KNIFE SWING ——
  if (this.stats.isMelee) {
    this.state.knifeSwing      = true;
    this.state.knifeSwingStart = now;
    this.state.knifeHeavy      = this._aiming;
    // --- network flag so server/others see the swing ---
    window.localPlayer = window.localPlayer || {};
    window.localPlayer.knifeSwing = true;
    window.localPlayer.knifeHeavy = !!this.state.knifeHeavy;
    // optional: console.debug(`[local] knifeSwing START heavy=${window.localPlayer.knifeHeavy}`);
  
    this.playWeaponSound("shot");
    this.checkMeleeHit(playerState.collidables);
    this.lastShotTime = now;

      } else {
        // —— BULLET FIRE ——
        if (this.ammoInMagazine > 0) {
          this.lastShotTime    = now;
          this.ammoInMagazine--;
          this.burstCount++;

          this.fireBullet(spreadAngle, playerState.collidables);
          this.playWeaponSound("shot");
          updateAmmoDisplay(this.ammoInMagazine, this.stats.magazineSize);

          // Camera recoil: capture start rotation so recovery returns from here
          const shotIndex = this.burstCount - 1;
          let rawRecoil = getRecoilAngle(this.currentKey, shotIndex);
          let recoilMultipler = 4;
          let appliedRecoilAngle = rawRecoil * recoilMultipler;

          // —— FALL OFF ——
          if (this.currentKey === "ak-47") {
            if (shotIndex >= 3) {
              const decayFactor = 0.8;
              const minRecoil   = 0.005 * recoilMultipler;
              const recoilDecay = appliedRecoilAngle * Math.pow(decayFactor, shotIndex - 3);
              appliedRecoilAngle = Math.max(recoilDecay, minRecoil);
            }
          }
          if (this.currentKey === "viper") {
            if (shotIndex >= 3) {
              const decayFactor = 0.8;
              const minRecoil   = 0.007 * recoilMultipler;
              const recoilDecay = appliedRecoilAngle * Math.pow(decayFactor, shotIndex - 3);
              appliedRecoilAngle = Math.max(recoilDecay, minRecoil);
            }
          }

          if (this._aiming) {
            appliedRecoilAngle = appliedRecoilAngle/2;
          }

          // Store the recoil properties for the animation
          this._recoil.peakOffset         = appliedRecoilAngle;
          this._recoil.recoilStartTime   = now;
          this._recoil.previousRecoilOffset = 0;

          // View-model kickback
          this.state.recoiling  = true;
          this.state.recoilStart = now;

          // Deagle-specific Z-axis recoil animation trigger
          if (this.currentKey === 'deagle' || this.currentKey === 'legion') {
            this.state.deagleRecoil = {
              active:     true,
              startTime:  now,
              startRotation: this.viewModel.rotation.clone(),
              durationUp:  0.03,
              durationDown: 0.25,
              maxAngleUp: THREE.MathUtils.degToRad(60),
              maxAngleSide: THREE.MathUtils.degToRad(3),
            };
          }

        } else {
          // Start reload
          this.isReloadingFlag = true;
          this.state.reloading  = true;
          this.state.reloadStart = now;
          this._reloadEndPlayed = false;
          this.playWeaponSound("reloadStart");
        }
      }
    }

    // --- Deagle Recoil Animation Logic with Z-axis rotation ---
    if (this.state.deagleRecoil && this.state.deagleRecoil.active) {
      const { deagleRecoil } = this.state;
      const elapsed = now - deagleRecoil.startTime;
      const { durationUp, durationDown, maxAngleUp, maxAngleSide, startRotation } = deagleRecoil;
      const totalDuration = durationUp + durationDown;

      if (elapsed < totalDuration) {
        let xAngle = 0, zAngle = 0;
        if (elapsed < durationUp) {
          const progress = elapsed / durationUp;
          const easedProgress = 1 - Math.exp(-progress * 5);
          xAngle = -maxAngleUp * easedProgress;
          zAngle = -maxAngleSide * easedProgress;
        } else {
          const downElapsed = elapsed - durationUp;
          const progress = downElapsed / durationDown;
          const easedProgress = Math.exp(-progress * 5);
          xAngle = -maxAngleUp * easedProgress;
          zAngle = -maxAngleSide * easedProgress;
        }
        this.viewModel.rotation.x = startRotation.x - xAngle;
        this.viewModel.rotation.z = startRotation.z - zAngle;
      } else {
        this.viewModel.rotation.copy(startRotation);
        this.state.deagleRecoil.active = false;
      }
    }

    // —— VIEW-MODEL RECOIL ANIMATION FOR GUNS ——
    if (this.state.recoiling && !this.stats.isMelee) {
      const VIEWER_RECOIL_ANIM_DURATION = 0.15;
      const tR = (now - this.state.recoilStart) / VIEWER_RECOIL_ANIM_DURATION;
      if (tR >= 1) {
        const backTo = this._aiming
          ? gunAimPos[this.currentKey] // Use the new object here
          : this.readyPos;
        this.viewModel.position.copy(backTo);
        this.state.recoiling = false;
      } else {
        const baseZ = this._aiming ? gunAimPos[this.currentKey].z : this.readyPos.z;
        const kick  = this.stats.recoilDistance * Math.sin(Math.PI * tR);
        const x     = this._aiming
          ? gunAimPos[this.currentKey].x
          : this.readyPos.x;
        const y     = this._aiming ? gunAimPos[this.currentKey].y : this.readyPos.y;
        this.viewModel.position.set(x, y, baseZ + kick);
      }
    }

    // —— KNIFE SWING ANIMATION ——
    if (this.state.knifeSwing && this.stats.isMelee) {
      const { MathUtils } = THREE;
      const restX = MathUtils.degToRad(90),
            restY = MathUtils.degToRad(160),
            restZ = MathUtils.degToRad(0);
      const elapsed = now - this.state.knifeSwingStart;
      const dur     = this.state.knifeHeavy ? this.stats.heavySwingTime : this.stats.swingTime;

        if (elapsed >= dur) {
          this.weaponModel.rotation.set(restX, restY, restZ);
          this.state.knifeSwing = false;
        
          // --- clear network flag so server/clients stop replaying the swing ---
          if (window.localPlayer) {
            window.localPlayer.knifeSwing = false;
            window.localPlayer.knifeHeavy = false;
          }
      } else {
        const progress = elapsed / dur;
        const maxF     = this.state.knifeHeavy ? 0.9 : 1.2;
        const swingAng = maxF * Math.sin(Math.PI * progress);
        const sideAng  = swingAng * 0.5;
        const yOffset  = 0.5 * Math.sin(Math.PI * progress);
        this.weaponModel.rotation.set(
          restX - swingAng,
          restY + yOffset,
          restZ + sideAng
        );
      }
    }

    // Reload handling
    if (inputState.reload && !this.isReloadingFlag && this.ammoInMagazine < this.stats.magazineSize) {
      this.isReloadingFlag = true;
      this.state.reloading  = true;
      this.state.reloadStart = now;
      this._reloadEndPlayed = false;
      this.playWeaponSound("reloadStart");
    }
    if (this.state.reloading && !this.stats.isMelee) {
      const elapsed = now - this.state.reloadStart;
      const half    = this.stats.reloadDuration / 2;
      if (!this._reloadEndPlayed && elapsed >= half) {
        this.playWeaponSound("reloadEnd");
        this._reloadEndPlayed = true;
      }

      if (elapsed >= this.stats.reloadDuration) {
        this.ammoInMagazine  = this.stats.magazineSize;
        this.isReloadingFlag = false;
        this.state.reloading = false;
        if (this.parts.slide) this.parts.slide.position.setZ(0);
        updateAmmoDisplay(this.ammoInMagazine, this.stats.magazineSize);
      } else if (elapsed <= half) {
        const angle = (Math.PI / 180) * 40 * (elapsed / half);
        this.viewModel.rotation.x = angle;
        if (this.parts.slide) this.parts.slide.position.setZ(-0.05 * (elapsed / half));
      } else {
        const t2   = (elapsed - half) / half;
        const angle = (Math.PI / 180) * 40 * (1 - t2);
        this.viewModel.rotation.x = angle;
        if (this.parts.slide) this.parts.slide.position.setZ(-0.05 * (1 - t2));
      }
    }

    // Tracer cleanup
    this.state.tracerObjects = this.state.tracerObjects.filter(entry => {
      if (now - entry.startTime > 0.2 && entry.lineMesh.parent) {
        entry.lineMesh.parent.remove(entry.lineMesh);
        return false;
      }
      return true;
    });

    // --- Camera recoil recovery & application ---
    const elapsedRec = now - this._recoil.recoilStartTime;
    if (elapsedRec < this._recoil.recoilDuration) {
      const t    = elapsedRec / this._recoil.recoilDuration;
      const easedT = 1 - (t * t * (3 - 2 * t));
      const currentRecoilOffset = this._recoil.peakOffset * easedT;
      const recoilDelta = currentRecoilOffset - (this._recoil.previousRecoilOffset || 0);

      this.camera.rotation.x += recoilDelta;
      this._recoil.previousRecoilOffset = currentRecoilOffset;

    } else if (this._recoil.peakOffset > 0) {
      this._recoil.peakOffset = 0;
      this._recoil.recoilStartTime = 0;
      this._recoil.previousRecoilOffset = 0;
    }
}
  

  getCurrentAmmo() {
    return this.ammoInMagazine;
  }
  getMaxAmmo() {
    return this.stats.magazineSize;
  }
  isReloading() {
    return this.isReloadingFlag;
  }
  isMelee() {
    return this.stats.isMelee;
  }

  createPlayerArm() {
    const skinMat = createSkinMaterial("#f5be90");
    const upperGeom = new THREE.CylinderGeometry(0.05, 0.05, 0.3, 8);
    const upperArm = new THREE.Mesh(upperGeom, skinMat);
    upperArm.rotation.x = Math.PI / 2;
    upperArm.position.set(0.15, -0.2, -0.2);


    const foreGeom = new THREE.CylinderGeometry(0.045, 0.045, 0.3, 8);
    const foreArm = new THREE.Mesh(foreGeom, skinMat);
    foreArm.rotation.x = Math.PI / 2;
    foreArm.position.set(0.3, -0.35, -0.6);

  }
  
  
  


  /**
   * Performs a raycast to detect hits and handles the outcome (damage, bullet holes, tracers).
   * @param {number} spreadAngle The angle of spread to apply to the bullet's direction.
   * @param {Array<THREE.Object3D>} collidables Array of all meshes that bullets can hit (environment + players).
   */
   
// checkBulletHit: Remove sound playing logic
checkBulletHit(origin, direction, intersectionPointOut) {
  const raycaster = new THREE.Raycaster();
  raycaster.set(origin.clone(), direction.clone().normalize());
  let closest = null;

  const remotePlayers = window.remotePlayers || {};
  for (const rp of Object.values(remotePlayers)) {
    const meshes = [];
    if (rp.bodyMesh) meshes.push(rp.bodyMesh);
    if (rp.headMesh) meshes.push(rp.headMesh);

    for (const mesh of meshes) {
      if (!mesh || !mesh.geometry || !mesh.geometry.boundsTree) continue;
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
  if (intersectionPointOut instanceof THREE.Vector3) {
    intersectionPointOut.copy(closest.intersection);
  }
  return {
    mesh: closest.mesh,
    isHead: closest.isHead,
    intersection: closest.intersection.clone(),
    distance: closest.distance
  };
}

checkBulletPenetration(origin, direction, maxWorldPenetrations = 1) {
  if (!this.physicsController || !this.physicsController.worldBVH || !this.physicsController.collider) {
    console.error("World BVH or collider mesh not available.");
    return { playerHitResult: null, allWorldHits: [], penetrationCount: 0, isPenetrationShot: false };
  }

  const dir = direction.clone().normalize();
  let currentOrigin = origin.clone();
  let worldPenetrationCount = 0;
  const allWorldHits = [];
  let playerHitResult = null;

  for (let iter = 0; iter <= maxWorldPenetrations; iter++) {
    const ray = new THREE.Raycaster();
    ray.set(currentOrigin.clone(), dir);
    const worldHits = ray.intersectObject(this.physicsController.collider, true);
    const worldIntersection = worldHits && worldHits.length ? worldHits[0] : null;
    const playerHit = this.checkBulletHit(currentOrigin, dir);

    let closestHit = null;
    let hitType = null;
    if (worldIntersection && (!playerHit || worldIntersection.distance <= playerHit.distance)) {
      closestHit = worldIntersection;
      hitType = 'world';
    } else if (playerHit) {
      closestHit = playerHit;
      hitType = 'player';
    } else {
      break;
    }

    if (hitType === 'player') {
      playerHitResult = {
        mesh: closestHit.mesh,
        isHead: closestHit.isHead,
        intersection: closestHit.intersection.clone(),
        distance: origin.distanceTo(closestHit.intersection)
      };
      break;
    }

    // world hit
    const normal = (closestHit.face && closestHit.object)
      ? closestHit.face.normal.clone().transformDirection(closestHit.object.matrixWorld).normalize()
      : dir.clone().negate();

    allWorldHits.push({
      point: closestHit.point.clone(),
      normal,
      distance: currentOrigin.distanceTo(closestHit.point),
      object: closestHit.object
    });

    worldPenetrationCount++;
    if (worldPenetrationCount > maxWorldPenetrations) break;

    // advance origin slightly past the hit point to continue the ray
    currentOrigin.copy(closestHit.point).add(dir.clone().multiplyScalar(0.01));
  }

  return {
    playerHitResult,
    allWorldHits,
    penetrationCount: worldPenetrationCount,
    isPenetrationShot: !!(playerHitResult && worldPenetrationCount > 0)
  };
}

fireBullet(spreadAngle) {
  if (!this.physicsController || !this.physicsController.worldBVH) {
    console.error("World BVH not available to fire bullet.");
    return;
  }

  let realPenetrate = false;

  this.camera.updateMatrixWorld();
  const origin = new THREE.Vector3().setFromMatrixPosition(this.camera.matrixWorld);
  const direction = getSpreadDirection(spreadAngle, this.camera).normalize();

  const traj = this.checkBulletPenetration(origin, direction, 1);

  let tracerEnd = null;

  if (traj.playerHitResult) {
    const hit = traj.playerHitResult;
    let mesh = hit.mesh;
    while (mesh && mesh.userData && mesh.userData.playerId == null) mesh = mesh.parent;

    if (mesh && mesh.userData && mesh.userData.playerId != null) {
      const isHead = !!hit.isHead;
      const baseDamage = isHead ? this.stats.headshotDamage : this.stats.bodyDamage;

      const distanceMeters = worldUnitsToMeters(origin.distanceTo(hit.intersection), this.unitsPerMeter);

      // <-- FIX: pass isHead so calculateDamageWithDropOff uses head/body absolute arrays when present
      let damageToApply = calculateDamageWithDropOff(baseDamage, distanceMeters, this.stats.damageDropOff, isHead);

      if (traj.isPenetrationShot) {
        damageToApply *= 0.5;
        realPenetrate = true;
      }

      damageToApply = Math.round(damageToApply);

      window.applyDamageToRemote?.(
        mesh.userData.playerId,
        damageToApply,
        {
          id: this.localPlayerId,
          username: window.localPlayer?.username ?? "Unknown",
          weapon: this.currentKey,
          isHeadshot: isHead,
          isPenetrationShot: realPenetrate
        }
      );

      realPenetrate = false;

      if (!traj.isPenetrationShot) {
        if (isHead) {
          playBodyHeadshot && playBodyHeadshot();
        } else {
          playBodyHit && playBodyHit();
        }
      }
    }

    tracerEnd = hit.intersection.clone();
  } else {
    if (traj.allWorldHits && traj.allWorldHits.length) {
      tracerEnd = traj.allWorldHits[traj.allWorldHits.length - 1].point.clone();
    } else {
      tracerEnd = origin.clone().add(direction.clone().multiplyScalar(this.stats.tracerLength || 2000));
    }
  }

  for (const wh of traj.allWorldHits) {
    sendBulletHole && sendBulletHole({
      x: wh.point.x, y: wh.point.y, z: wh.point.z,
      nx: wh.normal.x, ny: wh.normal.y, nz: wh.normal.z,
      timeCreated: (firebase && firebase.database && firebase.database.ServerValue) ? firebase.database.ServerValue.TIMESTAMP : Date.now()
    });
  }

  const muzzlePos = this.parts?.muzzle ? this.parts.muzzle.getWorldPosition(new THREE.Vector3()) : origin.clone();
  this.createTracer && this.createTracer(muzzlePos, tracerEnd.clone(), this.currentKey, this.stats.tracerLength);
  sendTracer && sendTracer({
    ox: muzzlePos.x, oy: muzzlePos.y, oz: muzzlePos.z,
    tx: tracerEnd.x, ty: tracerEnd.y, tz: tracerEnd.z
  });
}


checkMeleeHit(collidables) {
  const nowMs = performance.now();
  const { rpm, bodyDamage } = WeaponController.WEAPONS.knife;
  const interval = 60000 / rpm;
  if (nowMs - this._lastKnifeSwingTime < interval) return;
  this._lastKnifeSwingTime = nowMs;

  const meleeRange = 2;
  const meleeDamage = bodyDamage; // Use the correct damage variable
  const playerPos = new THREE.Vector3();
  this.camera.getWorldPosition(playerPos);

  for (const obj of collidables) {
    if (obj.userData?.isPlayerBodyPart && obj.userData.playerId !== this.localPlayerId) {
      const targetGroup = window.remotePlayers[obj.userData.playerId]?.group;
      if (!targetGroup) continue;

      const targetPos = new THREE.Vector3();
      targetGroup.getWorldPosition(targetPos);

      // Check if the target is within melee range
      if (playerPos.distanceTo(targetPos) <= meleeRange) {
        window.applyDamageToRemote?.(
          obj.userData.playerId, // Use the playerId from the object that was hit
          meleeDamage, // Use the correct meleeDamage variable
          {
            id: this.localPlayerId,
            username: window.localPlayer?.username ?? "Unknown",
            weapon: "knife", // Correctly identify the weapon as "knife"
            isHeadshot: false, // Melee hits are not headshots in this context
            isPenetrationShot: false // Melee hits don't penetrate
          }
        );
        return; // Exit after hitting one player
      }
    }
  }
}


buildKnife(onProgressRegistrar) {
    const loader = new GLTFLoader();
    const url = 'https://raw.githubusercontent.com/thearthd/3d-models/main/Weapon/voidffa_knife_V5.glb';
    let prog = () => {};
    const promise = new Promise((res, rej) => {
      loader.load(
        url,
        gltf => {
          this.weaponModel = new THREE.Group();
          this.parts = {};
          if (this.viewModel) this.viewModel.add(this.weaponModel);
          const model = gltf.scene;

          // Remove or comment out all the material creation and assignment:
          // const bladeMat = createMetalMaterial(0xffffff);
          // const handleMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 });
          // const fingerRestMat = createMetalMaterial(0xffffff);
          // const decoMat = createMetalMaterial(0xff0000);
          // const defaultMat = new THREE.MeshStandardMaterial({ color: 0x999999 });

          model.traverse(child => {
            if (!child.isMesh) return;

            // Remove or comment out this entire block that reassigns materials
            // const name = child.name.toLowerCase();
            // let mat = defaultMat;
            // if (name.includes('ahva')) mat = handleMat;
            // else if (name.includes('koriste')) mat = decoMat;
            // else if (name.includes('sormensi')) mat = fingerRestMat;
            // else if (name.includes('ater')) mat = bladeMat;
            // child.material = mat; // This line is the one overriding the GLB's material
            // child.geometry.computeVertexNormals(); // May still be useful, but related to geometry not material
            // child.material.needsUpdate = true; // This is only needed if you change the material

            // Keep these lines to assign parts if needed for other logic (e.g., animations)
            const name = child.name.toLowerCase(); // Keep this to identify parts
            if (name.includes('ater')) this.parts.blade = child;
            if (name.includes('sormensi')) this.parts.ring = child;
            if (name.includes('ahva')) this.parts.handle = child;
          });

          // The rest of your code remains largely the same for positioning and scaling
          const bbox = new THREE.Box3().setFromObject(model);
          const center = bbox.getCenter(new THREE.Vector3());
          model.position.sub(center);
          const size = bbox.getSize(new THREE.Vector3());
          const s = 0.5 / Math.max(size.x, size.y, size.z);
          this.weaponModel.scale.set(s, s, s);

          this.weaponModel.traverse(child => {
            if (child.isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });
          this.weaponModel.add(model);
          this.weaponModel.rotation.set(
            THREE.MathUtils.degToRad(90),
            THREE.MathUtils.degToRad(160),
            0
          );
          this.weaponModel.position.set(0.5, -0.1, -0.7);
          res(this.weaponModel);
        },
        evt => { if (evt.lengthComputable) prog(evt); },
        err => rej(err)
      );
    });
    return { promise, register: cb => prog = cb };
}

addDebugMuzzleDot(muzzleObject3D, dotSize = 0.5) {
        const geometry = new THREE.SphereGeometry(dotSize, 8, 8); // Small sphere
        const material = new THREE.MeshBasicMaterial({ color: 0xff0000 }); // Bright red
        const debugDot = new THREE.Mesh(geometry, material);
        debugDot.name = 'DebugMuzzleDot';
        
        // Add it to the muzzle Object3D, so it moves with the muzzle
        muzzleObject3D.add(debugDot);
    }
  
    buildDeagle(onProgressRegistrar) {
        const loader = new GLTFLoader();
        const url = 'https://raw.githubusercontent.com/thearthd/3d-models/main/Weapon/voidffa_deagle.glb';
        let prog = () => {};
        const promise = new Promise((res, rej) => {
            loader.load(
                url,
                gltf => {
                    this.weaponModel = new THREE.Group();
                    this.parts = {};
                    if (this.viewModel) this.viewModel.add(this.weaponModel);
                    const model = gltf.scene;
                    const box = new THREE.Box3().setFromObject(model);
                    const center = box.getCenter(new THREE.Vector3());
                    model.position.sub(center);
                    this.weaponModel.add(model);
                    this.weaponModel.scale.set(5, 5, 5);
                    this.weaponModel.rotation.set(
                        THREE.MathUtils.degToRad(7),
                        THREE.MathUtils.degToRad(180),
                        0
                    );
                    const sw = window.innerWidth, sh = window.innerHeight;
                    this.weaponModel.position.set(
                        0.15 * (sw/1920),
                        0.1 * (sh/1080),
                        -0.1 * (sw/1920)
                    );
                    const box2 = new THREE.Box3().setFromObject(model);
                    const muzzle = new THREE.Object3D();
                    muzzle.name = 'Muzzle';
                    // These coordinates are relative to the 'model's' local space after centering
                    // You'll likely need to adjust these values (`-box2.max.x, box2.max.y, 1`)
                    // until the debug dot appears at the very tip of your gun's muzzle.
                    muzzle.position.set(-box2.max.x, box2.max.y, 1);
                    this.weaponModel.add(muzzle);
                    this.parts.muzzle = muzzle;

                    // --- ADD THE DEBUG DOT HERE ---


                    res(this.weaponModel);
                },
                evt => { if (evt.lengthComputable) prog(evt); },
                err => rej(err)
            );
        });
        return { promise, register: cb => prog = cb };
    }

    buildLegion(onProgressRegistrar) {
        const loader = new GLTFLoader();
        const url = 'https://raw.githubusercontent.com/thearthd/3d-models/main/Legion1212.glb';
        let prog = () => {};
        const promise = new Promise((res, rej) => {
            loader.load(
                url,
                gltf => {
                    this.weaponModel = new THREE.Group();
                    this.parts = {};
                    if (this.viewModel) this.viewModel.add(this.weaponModel);
                    const model = gltf.scene;
                    const box = new THREE.Box3().setFromObject(model);
                    const center = box.getCenter(new THREE.Vector3());
                    model.position.sub(center);
                    this.weaponModel.add(model);
                    this.weaponModel.scale.set(5, 5, 5);
                    this.weaponModel.rotation.set(
                        THREE.MathUtils.degToRad(7),
                        THREE.MathUtils.degToRad(180),
                        0
                    );
                    const sw = window.innerWidth, sh = window.innerHeight;
                    this.weaponModel.position.set(
                        0.15 * (sw/1920),
                        0.1 * (sh/1080),
                        -0.1 * (sw/1920)
                    );
                    const box2 = new THREE.Box3().setFromObject(model);
                    const muzzle = new THREE.Object3D();
                    muzzle.name = 'Muzzle';
                    // These coordinates are relative to the 'model's' local space after centering
                    // You'll likely need to adjust these values (`-box2.max.x, box2.max.y, 1`)
                    // until the debug dot appears at the very tip of your gun's muzzle.
                    muzzle.position.set(-box2.max.x, box2.max.y, 1);
                    this.weaponModel.add(muzzle);
                    this.parts.muzzle = muzzle;

                    // --- ADD THE DEBUG DOT HERE ---


                    res(this.weaponModel);
                },
                evt => { if (evt.lengthComputable) prog(evt); },
                err => rej(err)
            );
        });
        return { promise, register: cb => prog = cb };
    }

    buildAK47(onProgressRegistrar) {
        const loader = new GLTFLoader();
        const url = 'https://raw.githubusercontent.com/thearthd/3d-models/main/Weapon/voidffa_AK47_V2.glb';
        let prog = () => {};
        const promise = new Promise((res, rej) => {
            loader.load(
                url,
                gltf => {
                    this.weaponModel = new THREE.Group();
                    this.parts = {};
                    // Original model materials will now be used.
                    const model = gltf.scene;
                    const before = new THREE.Box3().setFromObject(model);
                    const center = before.getCenter(new THREE.Vector3());
                    model.position.sub(center);
                    const after = new THREE.Box3().setFromObject(model);
                    const muzzle = new THREE.Object3D();
                    muzzle.name = 'Muzzle';
                    // Adjust these values until the debug dot appears at the very tip.
                    muzzle.position.set(-after.max.x + 0.5, after.max.y, 1.6);
                    this.weaponModel.add(model);
                    this.weaponModel.scale.set(0.4,0.4,0.4);
                    this.weaponModel.rotation.set(
                        THREE.MathUtils.degToRad(4),
                        THREE.MathUtils.degToRad(180),
                        0
                    );
                    const sw = window.innerWidth, sh = window.innerHeight;
                    this.weaponModel.position.set(
                        0.35*(sw/1920),
                        -0.15*(sh/1080),
                        -0.3*(sw/1920)
                    );
                    this.weaponModel.add(muzzle);
                    this.parts.muzzle = muzzle;
                    if (this.viewModel) this.viewModel.add(this.weaponModel);

                    // --- ADD THE DEBUG DOT HERE ---


                    res(this.weaponModel);
                },
                evt => { if (evt.lengthComputable) prog(evt); },
                err => rej(err)
            );
        });
        return { promise, register: cb => prog = cb };
    }


    buildViper(onProgressRegistrar) {
        const loader = new GLTFLoader();
        const url = 'https://raw.githubusercontent.com/thearthd/3d-models/main/Viper.glb';
        let prog = () => {};
        const promise = new Promise((res, rej) => {
            loader.load(
                url,
                gltf => {
                    this.weaponModel = new THREE.Group();
                    this.parts = {};
                    // Original model materials will now be used.
                    const model = gltf.scene;
                    const before = new THREE.Box3().setFromObject(model);
                    const center = before.getCenter(new THREE.Vector3());
                    model.position.sub(center);
                    const after = new THREE.Box3().setFromObject(model);
                    const muzzle = new THREE.Object3D();
                    muzzle.name = 'Muzzle';
                    // Adjust these values until the debug dot appears at the very tip.
                    muzzle.position.set(-after.max.x + 0.5, after.max.y, 1.6);
                    this.weaponModel.add(model);
                    this.weaponModel.scale.set(0.4,0.4,0.4);
                    this.weaponModel.rotation.set(
                        THREE.MathUtils.degToRad(4),
                        THREE.MathUtils.degToRad(180),
                        0
                    );
                    const sw = window.innerWidth, sh = window.innerHeight;
                    this.weaponModel.position.set(
                        0.35*(sw/1920),
                        -0.15*(sh/1080),
                        0*(sw/1920)
                    );
                    this.weaponModel.add(muzzle);
                    this.parts.muzzle = muzzle;
                    if (this.viewModel) this.viewModel.add(this.weaponModel);

                    // --- ADD THE DEBUG DOT HERE ---


                    res(this.weaponModel);
                },
                evt => { if (evt.lengthComputable) prog(evt); },
                err => rej(err)
            );
        });
        return { promise, register: cb => prog = cb };
    }

    buildMarshal(onProgressRegistrar) {
        const loader = new GLTFLoader();
        const url = 'https://raw.githubusercontent.com/thearthd/3d-models/main/svd_sniper_rfile.glb';
        let prog = () => {};
        const promise = new Promise((res, rej) => {
            loader.load(
                url,
                gltf => {
                    this.weaponModel = new THREE.Group();
                    this.parts = {};
                    // Original model materials will now be used.
                    // Removed custom material assignments and traversal for original materials
                    const model = gltf.scene;
                    const b1 = new THREE.Box3().setFromObject(model);
                    const center = b1.getCenter(new THREE.Vector3());
                    model.position.sub(center);
                    const b2 = new THREE.Box3().setFromObject(model);
                    const muzzle = new THREE.Object3D();
                    muzzle.name = 'Muzzle';
                    // Adjust these values until the debug dot appears at the very tip.
                    muzzle.position.set(0, b2.max.y, -b2.max.z);
                    model.add(muzzle);
                    this.parts.muzzle = muzzle;
                    this.weaponModel.add(model);
                    this.weaponModel.scale.set(1,1,1);
                    this.weaponModel.rotation.set(0,0,0);
                    const sw = window.innerWidth, sh = window.innerHeight;
                    this.weaponModel.position.set(
                        0.15*(sw/1920),
                        0.15*(sh/1080),
                        -0.1*(sw/1920)
                    );
                    if (this.viewModel) this.viewModel.add(this.weaponModel);

                    // --- ADD THE DEBUG DOT HERE ---


                    res(this.weaponModel);
                },
                evt => { if (evt.lengthComputable) prog(evt); },
                err => rej(err)
            );
        });
        return { promise, register: cb => prog = cb };
    }
    buildM79(onProgressRegistrar) {
        const loader = new GLTFLoader();
        const url = 'https://raw.githubusercontent.com/thearthd/3d-models/main/M-79.glb';
        let prog = () => {};
        const promise = new Promise((res, rej) => {
            loader.load(
                url,
                gltf => {
                    this.weaponModel = new THREE.Group();
                    this.parts = {};
                    if (this.viewModel) this.viewModel.add(this.weaponModel);
                    const model = gltf.scene;
                    const box = new THREE.Box3().setFromObject(model);
                    const center = box.getCenter(new THREE.Vector3());
                    model.position.sub(center);
                    this.weaponModel.add(model);
                    this.weaponModel.scale.set(5, 5, 5);
                    this.weaponModel.rotation.set(
                        THREE.MathUtils.degToRad(7),
                        THREE.MathUtils.degToRad(180),
                        0
                    );
                    const sw = window.innerWidth, sh = window.innerHeight;
                    this.weaponModel.position.set(
                        0.15 * (sw/1920),
                        0.1 * (sh/1080),
                        -0.1 * (sw/1920)
                    );
                    const box2 = new THREE.Box3().setFromObject(model);
                    const muzzle = new THREE.Object3D();
                    muzzle.name = 'Muzzle';
                    // These coordinates are relative to the 'model's' local space after centering
                    // You'll likely need to adjust these values (`-box2.max.x, box2.max.y, 1`)
                    // until the debug dot appears at the very tip of your gun's muzzle.
                    muzzle.position.set(-box2.max.x, box2.max.y, 1);
                    this.weaponModel.add(muzzle);
                    this.parts.muzzle = muzzle;

                    // --- ADD THE DEBUG DOT HERE ---


                    res(this.weaponModel);
                },
                evt => { if (evt.lengthComputable) prog(evt); },
                err => rej(err)
            );
        });
        return { promise, register: cb => prog = cb };
    }
  
}



export async function preloadWeaponPrototypes(onComplete) {
  const names = ['knife','deagle','ak47','marshal','m79','viper','legion',];
  const dummyCam = new THREE.Group();
  const loaderUI = new Loader();
  const itemPercentages = names.map(() => 1 / names.length);

  loaderUI.show('Loading...', itemPercentages);
  loaderUI.onComplete(() => {
    console.log('▶️ ALL weapon prototypes ready');
    onComplete?.();
  });

  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const wc = new WeaponController(dummyCam);
    const method = 'build' + (name === 'ak47' ? 'AK47' : name[0].toUpperCase() + name.slice(1));
    console.log(`Preloading ${name}, weight ${itemPercentages[i] * 100}%`);

    // get { promise, register } from buildX()
    const { promise, register } = wc[method]();
    // track with live progress
    await loaderUI.track(itemPercentages[i], promise, cb => register(cb));
    // post-load housekeeping
    const model = await promise;
    dummyCam.remove(model);
    model.visible = false;
    _prototypeModels[name] = model;
    console.log(`Loaded ${name}`);
  }
}


// Call once at startup:
preloadWeaponPrototypes(() => {
  console.log("✅ All prototypes including knife have been preloaded!");
  // Now it's safe to start letting players swap weapons.
});

// factory to clone
export function getWeaponModel(name) {
  const proto = _prototypeModels[name];
  if (!proto) {
    console.warn(`No prototype for weapon ${name}`);
    return new THREE.Group();
  }
  return proto.clone(true);
}

let debugLogElement;



export const activeTracers = []; // <--- EXPORT THIS!

export class AnimatedTracer extends THREE.Mesh {
    constructor(origin, target, speed = 500) { // Increased default speed significantly
        // --- NEW GEOMETRY: BoxGeometry for a long rectangle ---
        // Parameters: width, height, depth (along Z-axis for alignment)
        // Adjust these values to get the desired look.
        // width and height are small for a thin line.
        // depth is the length of the tracer.
        const tracerLength = 20; // Length of the tracer visual
        const tracerWidth = 0.05; // Thickness of the tracer
        const tracerHeight = 0.05; // Thickness of the tracer

        const geometry = new THREE.BoxGeometry(tracerWidth, tracerHeight, tracerLength); 

        const material = new THREE.MeshBasicMaterial({
            color: 0xffa500, // Orange-ish color for visibility
            transparent: true,
            opacity: 1.0,
            blending: THREE.AdditiveBlending,
            // --- MODIFICATION: Set depthTest and depthWrite to true ---
            depthTest: true, // Allow depth testing
            depthWrite: true // Allow writing to the depth buffer
        });

        super(geometry, material);

        this.initialOrigin = origin.clone(); // Store initial origin for direction and rotation
        this.target = target.clone();
        this.direction = new THREE.Vector3().subVectors(target, origin).normalize();
        this.distance = origin.distanceTo(target);
        this.speed = speed; // Use the passed-in speed (default is now 500)
        this.traveledDistance = 0;
        this.initialOpacity = 1.0;
        this.remove = false;

        // --- NEW: Position and Orient the tracer correctly ---
        // Calculate the midpoint of the tracer's travel path for initial placement
        const midpoint = new THREE.Vector3().addVectors(origin, target).multiplyScalar(0.5);
        this.position.copy(origin); // Start tracer at the origin

        // Orient the tracer along its travel direction
        const tempQuaternion = new THREE.Quaternion();
        const up = new THREE.Vector3(0, 1, 0); // Assuming Y is up
        tempQuaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.direction); // Z-axis of box points to target
        this.rotation.setFromQuaternion(tempQuaternion);

        // Adjust position so the *start* of the tracer is at the origin
        // The BoxGeometry is centered at its origin (0,0,0), so we need to offset it
        // by half its length along its local Z-axis (which now points in 'direction')
        this.position.addScaledVector(this.direction, 5);

        if (window.scene) {
            window.scene.add(this);
        } else {
            console.error("THREE.js scene not found. Cannot add tracer.");
        }
        
        activeTracers.push(this);
    }

    update(deltaTime) {
        if (this.traveledDistance < this.distance) {
            const moveAmount = this.speed * deltaTime;
            
            // Move the tracer along its direction vector
            // We move it by `moveAmount` which updates its current position relative to its initial point.
            this.position.addScaledVector(this.direction, moveAmount);
            this.traveledDistance += moveAmount;

            // Optional: Fade out as it approaches the target
            const remainingDistance = this.distance - this.traveledDistance;
            const fadeOutStartDistance = this.speed * 0.01; // Fade out over a very short time, proportional to speed
            if (remainingDistance < fadeOutStartDistance) { 
                this.material.opacity = this.initialOpacity * (remainingDistance / fadeOutStartDistance);
            }
            this.material.opacity = Math.max(0, this.material.opacity); 

        } else {
            this.remove = true;
        }
    }

    dispose() {
        if (this.parent) {
            this.parent.remove(this);
        }
        this.geometry.dispose();
        this.material.dispose();
    }
}

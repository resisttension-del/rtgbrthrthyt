

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

// PlayCanvas version of equipWeapon — drop into your PC WeaponController class
equipWeapon(weaponKey) {
  if (!WeaponController.WEAPONS || !WeaponController.WEAPONS[weaponKey]) {
    console.warn(`[WeaponController] Unknown weapon: ${weaponKey}`);
    return;
  }

  // Save ammo for previous weapon
  if (this.currentKey) {
    this.ammoStore = this.ammoStore || {};
    this.ammoStore[this.currentKey] = this.ammoInMagazine;
  }

  // Reset state for the new weapon
  this.currentKey = weaponKey;
  this.stats = WeaponController.WEAPONS[weaponKey];
  this.isReloadingFlag = false;
  this.lastShotTime = 0;
  this.burstCount = 0;
  this.speedModifier = this.stats.speedModifier;
  this.ammoStore = this.ammoStore || {};
  this.ammoInMagazine = (this.ammoStore[weaponKey] != null) ? this.ammoStore[weaponKey] : this.stats.magazineSize;

  // Normalized key for prototype lookup (remove hyphens)
  const normalized = (weaponKey || "").replace(/-/g, "").toLowerCase();

  // Decide whether we're running in PlayCanvas or Three.js mode
  const isPc = (typeof pc !== "undefined") && isPcEntity(this.camera);
  // Create a viewModel container attached to the camera (engine-specific)
  try {
    if (isPc) {
      // Create a PlayCanvas Entity as view model root
      const vm = new pc.Entity("ViewModelRoot");
      vm.enabled = true;
      vm.setLocalPosition(0, 0, 0);
      vm.setLocalEulerAngles(0, 0, 0);
      vm.setLocalScale(1, 1, 1);
      // Parent to PlayCanvas camera entity so it follows camera transforms
      try {
        this.camera.addChild(vm);
      } catch (e) {
        // fallback to app.root if camera parenting fails
        const pcApp = window.playcanvasApp;
        if (pcApp && pcApp.root) pcApp.root.addChild(vm);
      }
      this.viewModel = vm;
    } else {
      // THREE mode fallback
      const vm = new THREE.Group();
      vm.name = "ViewModelRoot";
      try {
        // prefer parenting directly to THREE camera (keeps VM in camera space)
        if (this.camera && typeof this.camera.add === "function") this.camera.add(vm);
        else if (window.scene && typeof window.scene.add === "function") window.scene.add(vm);
      } catch (e) { console.warn("equipWeapon: failed to parent THREE viewModel", e); }
      this.viewModel = vm;
    }
  } catch (e) {
    console.warn("equipWeapon: failed to create viewModel container", e);
    // final fallback: keep using THREE Group (so code doesn't break)
    this.viewModel = new THREE.Group();
    try { if (window.scene && window.scene.add) window.scene.add(this.viewModel); } catch (e2) {}
  }

  // Reset parts map and state
  this.parts = {};
  this.state.pulling = true;
  this.state.pullStart = performance.now() / 1000;

  // Attempt to mount a PlayCanvas prototype (preferred in PC mode)
  if (isPc && window._pcPrototypeModels && window._pcPrototypeModels[normalized]) {
    try {
      const proto = window._pcPrototypeModels[normalized];
      // clone the pc.Entity prototype if possible
      const clone = (typeof proto.clone === "function") ? proto.clone(true) : null;
      if (clone) {
        // ensure clone is detached then parent to VM
        try { if (clone.parent) clone.parent.removeChild(clone); } catch (e) {}
        // some PlayCanvas roots require enable/disable toggles
        clone.enabled = true;
        this.viewModel.addChild(clone);
        this.weaponModel = clone;
        applyCommonTransforms(clone, normalized);
        // try to locate a muzzle entry on pc entities
        const findMuzzlePc = (ent) => {
          if (!ent) return null;
          if ((ent.name || "").toLowerCase() === "muzzle") return ent;
          if (ent.children) {
            for (let c of ent.children) {
              const r = findMuzzlePc(c);
              if (r) return r;
            }
          }
          return null;
        };
        const muzzle = findMuzzlePc(clone);
        if (muzzle) this.parts.muzzle = muzzle;
        return;
      }
    } catch (e) {
      console.warn("equipWeapon: pc prototype clone failed, falling back to builder", e);
    }
  }

  // Next try Three.js prototype table if present and camera is THREE (or prototype is THREE)
  if (!isPc && window._prototypeModels && window._prototypeModels[normalized]) {
    try {
      const clone = getWeaponModel(normalized);
      clone.visible = true;
      // detach then attach to the THREE viewModel
      try { if (clone.parent) clone.parent.remove(clone); } catch (e) {}
      this.viewModel.add(clone);
      this.weaponModel = clone;
      applyCommonTransforms(clone, normalized);
      // find muzzle by name for THREE models
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
      console.warn("equipWeapon: THREE prototype attach failed", e);
    }
  }

  // Fallback: use the PCWeaponBuilder (works for PlayCanvas; will also try to return a THREE group if that builder creates THREE)
  try {
    const builder = new PCWeaponBuilder({ app: window.playcanvasApp, viewModel: this.viewModel });
    const buildMap = {
      knife: 'buildKnife', deagle: 'buildDeagle', ak47: 'buildAK47', marshal: 'buildMarshal',
      m79: 'buildM79', viper: 'buildViper', legion: 'buildLegion'
    };
    const method = buildMap[normalized];
    if (method && typeof builder[method] === "function") {
      const { promise } = builder[method]();
      promise.then((res) => {
        if (!res) return;
        // If builder returns an object with weaponRoot and parts (generic builder), handle that
        if (res.weaponRoot && res.parts) {
          const root = res.weaponRoot;
          this.weaponModel = root;
          this.parts = res.parts || {};
          applyCommonTransforms(root, normalized);
        } else {
          // builder returned an Entity/Group directly
          this.weaponModel = res;
          applyCommonTransforms(res, normalized);
        }
      }).catch(err => {
        console.warn("equipWeapon: builder failed:", err);
      });
    } else {
      console.warn(`[equipWeapon] No build method for ${normalized}`);
    }
  } catch (e) {
    console.warn("equipWeapon builder invocation error", e);
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

  getCameraFov() {
  // Returns current FOV in degrees (PlayCanvas or Three.js)
  try {
    if (this.camera && isPcEntity(this.camera) && this.camera.camera) {
      return Number(this.camera.camera.fov) || 60;
    }
    if (this.camera && this.camera.isCamera && typeof this.camera.fov === 'number') {
      return Number(this.camera.fov) || 60;
    }
    // fallback: some wrappers use camera.camera.fov (Three.js)
    if (this.camera && this.camera.camera && typeof this.camera.camera.fov === 'number') {
      return Number(this.camera.camera.fov) || 60;
    }
  } catch (e) {}
  return 60;
}

setCameraFov(newFov) {
  // Sets camera FOV for PlayCanvas or Three.js
  try {
    if (this.camera && isPcEntity(this.camera) && this.camera.camera) {
      // PlayCanvas camera component
      this.camera.camera.fov = newFov;
      // PlayCanvas camera recalculates projection automatically next frame
      return;
    }
    if (this.camera && this.camera.isCamera && typeof this.camera.fov === 'number') {
      // Three.js camera
      this.camera.fov = newFov;
      if (typeof this.camera.updateProjectionMatrix === 'function') this.camera.updateProjectionMatrix();
      return;
    }
    // fallback to nested camera.camera.fov (some code uses that)
    if (this.camera && this.camera.camera && typeof this.camera.camera.fov === 'number') {
      this.camera.camera.fov = newFov;
      if (this.camera.camera.updateProjectionMatrix) this.camera.camera.updateProjectionMatrix();
    }
  } catch (e) {
    console.warn("setCameraFov failed", e);
  }
}

update(inputState, delta, playerState) {
  // Engine-agnostic helpers
  const nowSec = () => performance.now() / 1000;
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const RAD_TO_DEG = 180 / Math.PI;
  const DEG_TO_RAD = Math.PI / 180;

  // Local camera-FOV helpers (use class methods if present, else fallback)
  const getCameraFovLocal = () => {
    try {
      if (typeof this.getCameraFov === 'function') return Number(this.getCameraFov());
      if (this.camera && this.camera.camera && typeof this.camera.camera.fov === 'number') return Number(this.camera.camera.fov);
      if (this.camera && typeof this.camera.fov === 'number') return Number(this.camera.fov);
    } catch (e) {}
    return 60;
  };
  const setCameraFovLocal = (v) => {
    try {
      if (typeof this.setCameraFov === 'function') return this.setCameraFov(v);
      if (this.camera && this.camera.camera && typeof this.camera.camera.fov === 'number') {
        this.camera.camera.fov = v;
        if (this.camera.camera.updateProjectionMatrix) this.camera.camera.updateProjectionMatrix();
        return;
      }
      if (this.camera && typeof this.camera.fov === 'number') {
        this.camera.fov = v;
        if (typeof this.camera.updateProjectionMatrix === 'function') this.camera.updateProjectionMatrix();
      }
    } catch (e) { console.warn("setCameraFovLocal failed", e); }
  };

  // Small pc/three vector helpers used here (prefer existing pc.Vec3 when available)
  const makePcVec = (x=0,y=0,z=0) => (typeof pc !== "undefined" && pc.Vec3) ? new pc.Vec3(x,y,z) : { x, y, z };
  const vecClonePc = (v) => (v && v.clone) ? v.clone() : makePcVec(v?.x||0, v?.y||0, v?.z||0);

  // Ensure viewModel is present (lazy equip)
  if (!this.viewModel) {
    // Keep existing currentKey or default to knife
    this.equipWeapon(this.currentKey || "knife");
    return;
  }

  // Build "justPressed" for semi-auto handling
  const rawFire = !!inputState.fire;
  const justPressed = rawFire && !this._prevFire;
  this._prevFire = rawFire;

  // Gather player state
  const velocity = (playerState && playerState.velocity) ? playerState.velocity : (typeof pc !== 'undefined' ? new pc.Vec3(0,0,0) : { x:0,y:0,z:0 });
  const isCrouched = !!playerState.isCrouched;
  const wishAim = !!inputState.aim;
  const isGrounded = !!(playerState.physicsController && playerState.physicsController.isGrounded);
  const now = nowSec();
  const sinceLast = now - (this.lastShotTime || 0);

  // gun aim positions (pc/three style plain objects - applyCommonTransforms handles them)
  const gunAimPos = {
    "ak-47": { x:0, y:-0.3, z:-0.5 },
    "deagle": { x:0, y:-0.3, z:-0.5 },
    "m79": { x:0.2, y:-0.4, z:-0.7 },
    "viper": { x:0, y:-0.3, z:-0.5 },
    "legion": { x:0, y:-0.15, z:-0.5 },
    "marshal": { x:-0.025, y:-0.035, z:-0.2 }
  };

  // --- Pull animation (equip) ---
  if (this.state && this.state.pulling) {
    const tPull = (now - (this.state.pullStart || now)) / (this.stats.pullDuration || 0.001);
    if (tPull >= 1) {
      // finalize position using available API
      try { if (this.viewModel.setLocalPosition) this.viewModel.setLocalPosition((this.state.pullTo||{x:0}).x, (this.state.pullTo||{y:0}).y, (this.state.pullTo||{z:0}).z); }
      catch (e) {}
      this.state.pulling = false;
    } else {
      // interpolate
      try {
        const pf = this.state.pullFrom || { x:0, y:0, z:0 };
        const pt = this.state.pullTo || { x:0, y:0, z:0 };
        const ix = lerp(pf.x, pt.x, clamp(tPull,0,1));
        const iy = lerp(pf.y, pt.y, clamp(tPull,0,1));
        const iz = lerp(pf.z, pt.z, clamp(tPull,0,1));
        if (this.viewModel.setLocalPosition) this.viewModel.setLocalPosition(ix, iy, iz);
        else if (this.viewModel.position) this.viewModel.position.set(ix, iy, iz);
      } catch (e) {}
    }
  }

  // --- Crosshair spread update ---
  const spreadAngle = (typeof getSpreadMultiplier === "function")
    ? getSpreadMultiplier(this.currentKey, velocity, isCrouched, this._aiming, isGrounded, this.burstCount)
    : 0;
  if (typeof updateCrosshair === "function") updateCrosshair(spreadAngle);
  playerState.isAirborne = !isGrounded;

  // reset burst for auto on release
  if (!rawFire && (this.currentKey === "ak-47" || this.currentKey === "viper")) this.burstCount = 0;

  // --- Aim toggle tweening: handle wishAim changes ---
  if (wishAim !== this._prevWishAim) {
    // prevent ADS while pulling or reloading
    if (this.state.pulling || this.isReloadingFlag) {
      this._prevWishAim = wishAim;
      return;
    }

    const aimableGuns = ["ak-47","deagle","m79","viper","legion","marshal"];
    if (wishAim && !aimableGuns.includes(this.currentKey)) {
      this._prevWishAim = wishAim;
      return;
    }

    // store base fov & scales/positions
    this._baseFov = getCameraFovLocal();
    // read scale/pos in engine-appropriate way
    const readScale = () => {
      try {
        if (this.viewModel && typeof this.viewModel.getLocalScale === 'function') return this.viewModel.getLocalScale();
        if (this.viewModel && this.viewModel.scale) return { x: this.viewModel.scale.x, y: this.viewModel.scale.y, z: this.viewModel.scale.z };
      } catch (e) {}
      return { x:1, y:1, z:1 };
    };
    const readPos = () => {
      try {
        if (this.viewModel && typeof this.viewModel.getLocalPosition === 'function') return this.viewModel.getLocalPosition();
        if (this.viewModel && this.viewModel.position) return { x:this.viewModel.position.x, y:this.viewModel.position.y, z:this.viewModel.position.z };
      } catch (e) {}
      return { x:0, y:0, z:0 };
    };

    const currentScale = readScale();
    this._baseScale = { x: currentScale.x, y: currentScale.y, z: currentScale.z };

    this._fromPos = readPos();

    // choose target FOV (use ADS_FOV mapping if available)
    const adsFovMap = (typeof ADS_FOV !== "undefined") ? {
      "ak-47": ADS_FOV.ak47,
      "viper": ADS_FOV.viper,
      "deagle": ADS_FOV.deagle,
      "m79": ADS_FOV.m79,
      "legion": ADS_FOV.legion,
      "marshal": ADS_FOV.marshal
    } : {};

    const targetFov = wishAim
      ? ((this.stats && this.stats.isSniper) ? (ADS_FOV ? ADS_FOV.marshal : this._baseFov) : (adsFovMap[this.currentKey] || (ADS_FOV ? ADS_FOV.default : this._baseFov)))
      : (ADS_FOV ? ADS_FOV.default : this._baseFov);

    // compute toPos - prefer the gunAim mapping, fallback to readyPos
    const toPos = wishAim ? (gunAimPos[this.currentKey] ? gunAimPos[this.currentKey] : (this.readyPos || { x: 0, y:0, z:0 })) : (this.readyPos ? this.readyPos : { x:0, y:0, z:0 });

    // compute toScale that visually approximates fov change
    const scaleFactor = (this._baseFov && this._baseFov !== 0) ? (targetFov / this._baseFov) : 1;
    const toScale = { x: this._baseScale.x * scaleFactor, y: this._baseScale.y * scaleFactor, z: this._baseScale.z * scaleFactor };

    this._fovTween = {
      active: true,
      fromFov: this._baseFov,
      toFov: targetFov,
      fromScale: { x: this._baseScale.x, y: this._baseScale.y, z: this._baseScale.z },
      toScale,
      fromPos: { x: this._fromPos.x, y: this._fromPos.y, z: this._fromPos.z },
      toPos,
      startTime: now,
      duration: 0.2
    };

    // hide scope overlay if we are leaving marshal (disabled state)
    if (this.currentKey !== "marshal" && typeof scopeOverlay !== "undefined" && scopeOverlay) scopeOverlay.style.display = 'none';
  }
  this._prevWishAim = wishAim;

  // ensure _fovTween exists
  this._fovTween = this._fovTween || { active: false };

  // --- Apply FOV tween if active ---
  if (this._fovTween.active) {
    const t = (now - this._fovTween.startTime) / (this._fovTween.duration || 0.0001);
    const clamped = clamp(t, 0, 1);
    const s = (clamped >= 1) ? 1 : clamped * clamped * (3 - 2 * clamped); // smoothstep

    if (clamped >= 1) {
      this._fovTween.active = false;
      this._aiming = wishAim;

      // special handling for marshal/sniper: show overlay & hide viewmodel
      if (this.currentKey === "marshal") {
        if (this._aiming) {
          if (typeof scopeOverlay !== "undefined" && scopeOverlay) scopeOverlay.style.display = 'block';
          if (isPcEntity(this.viewModel)) {
            try { this.viewModel.enabled = false; } catch (e) {}
          } else if (this.viewModel && this.viewModel.visible !== undefined) {
            this.viewModel.visible = false;
          } else if (this.viewModel && typeof this.viewModel.setLocalScale === 'function') {
            this.viewModel.setLocalScale(0,0,0);
          }
        } else {
          if (typeof scopeOverlay !== "undefined" && scopeOverlay) scopeOverlay.style.display = 'none';
          if (isPcEntity(this.viewModel)) {
            try { this.viewModel.enabled = true; } catch (e) {}
          } else if (this.viewModel && this.viewModel.visible !== undefined) {
            this.viewModel.visible = true;
          } else if (this.viewModel && typeof this.viewModel.setLocalScale === 'function') {
            this.viewModel.setLocalScale(1,1,1);
          }
        }
      }
    }

    // Camera FOV lerp
    const newFov = lerp(this._fovTween.fromFov, this._fovTween.toFov, s);
    setCameraFovLocal(newFov);

    // Interpolate viewModel scale & pos
    try {
      // scale
      const fs = this._fovTween.fromScale || { x:1,y:1,z:1 };
      const ts = this._fovTween.toScale || { x:1,y:1,z:1 };
      const sx = fs.x + (ts.x - fs.x) * s;
      const sy = fs.y + (ts.y - fs.y) * s;
      const sz = fs.z + (ts.z - fs.z) * s;
      if (this.viewModel && typeof this.viewModel.setLocalScale === 'function') {
        this.viewModel.setLocalScale(sx, sy, sz);
      } else if (this.viewModel && this.viewModel.scale) {
        this.viewModel.scale.set(sx, sy, sz);
      }
    } catch (e) {}

    try {
      // position
      const fp = this._fovTween.fromPos || { x:0,y:0,z:0 };
      const tp = this._fovTween.toPos || { x:0,y:0,z:0 };
      const px = fp.x + (tp.x - fp.x) * s;
      const py = fp.y + (tp.y - fp.y) * s;
      const pz = fp.z + (tp.z - fp.z) * s;
      if (this.viewModel && typeof this.viewModel.setLocalPosition === 'function') {
        this.viewModel.setLocalPosition(px, py, pz);
      } else if (this.viewModel && this.viewModel.position) {
        this.viewModel.position.set(px, py, pz);
      }
    } catch (e) {}
  }

  // if not aiming ensure viewModel visible
  if (!this._aiming) {
    if (isPcEntity(this.viewModel)) {
      try { this.viewModel.enabled = true; } catch (e) {}
    } else if (this.viewModel && this.viewModel.visible !== undefined) {
      this.viewModel.visible = true;
    } else if (this.viewModel && typeof this.viewModel.setLocalScale === 'function') {
      this.viewModel.setLocalScale(1,1,1);
    }
    if (typeof scopeOverlay !== "undefined" && scopeOverlay) scopeOverlay.style.display = 'none';
  }

  // --- FIRING / SWING LOGIC ---
  const isSemi = ["deagle","marshal","m79","legion"].includes(this.currentKey);
  const secsPerShot = 60 / (this.stats.fireRateRPM || 600);
  const canFire = this.stats.isMelee
    ? (justPressed && sinceLast > (this._aiming ? (this.stats.heavySwingTime || 0.4) : (this.stats.swingTime || 0.25)))
    : (isSemi ? (justPressed && sinceLast > secsPerShot) : (sinceLast > secsPerShot));

  if (!this.state.pulling && rawFire && !this.isReloadingFlag && canFire) {
    // Melee
    if (this.stats.isMelee) {
      this.state.knifeSwing = true;
      this.state.knifeSwingStart = now;
      this.state.knifeHeavy = !!this._aiming;
      // network flags
      window.localPlayer = window.localPlayer || {};
      window.localPlayer.knifeSwing = true;
      window.localPlayer.knifeHeavy = !!this.state.knifeHeavy;

      if (typeof this.playWeaponSound === "function") this.playWeaponSound("shot");
      if (typeof this.checkMeleeHit === "function") this.checkMeleeHit(playerState.collidables);
      this.lastShotTime = now;
    } else {
      // bullet fire
      if (this.ammoInMagazine > 0) {
        this.lastShotTime = now;
        this.ammoInMagazine--;
        this.burstCount++;

        if (typeof this.fireBullet === "function") this.fireBullet(spreadAngle, playerState.collidables);
        if (typeof this.playWeaponSound === "function") this.playWeaponSound("shot");
        try { if (typeof updateAmmoDisplay === "function") updateAmmoDisplay(this.ammoInMagazine, this.stats.magazineSize); } catch (e) {}

        // recoil (use getRecoilAngle if available)
        const shotIndex = this.burstCount - 1;
        let rawRecoil = (typeof getRecoilAngle === "function") ? getRecoilAngle(this.currentKey, shotIndex) : 0.01;
        let recoilMultiplier = 4;
        let appliedRecoilAngle = rawRecoil * recoilMultiplier;

        // fall-off for certain guns
        if (this.currentKey === "ak-47" && shotIndex >= 3) {
          const decayFactor = 0.8;
          const minRecoil = 0.005 * recoilMultiplier;
          const recoilDecay = appliedRecoilAngle * Math.pow(decayFactor, shotIndex - 3);
          appliedRecoilAngle = Math.max(recoilDecay, minRecoil);
        }
        if (this.currentKey === "viper" && shotIndex >= 3) {
          const decayFactor = 0.8;
          const minRecoil = 0.007 * recoilMultiplier;
          const recoilDecay = appliedRecoilAngle * Math.pow(decayFactor, shotIndex - 3);
          appliedRecoilAngle = Math.max(recoilDecay, minRecoil);
        }

        // store recoil state (radians)
        this._recoil = this._recoil || {};
        this._recoil.peakOffset = appliedRecoilAngle;
        this._recoil.recoilStartTime = now;
        this._recoil.previousRecoilOffset = 0;
        this._recoil.recoilDuration = this._recoil.recoilDuration || 0.25;

        // viewmodel kickback
        this.state.recoiling = true;
        this.state.recoilStart = now;

        // deagle specific z-axis recoil animation
        if (this.currentKey === 'deagle' || this.currentKey === 'legion') {
          this.state.deagleRecoil = {
            active: true,
            startTime: now,
            startRotation: (this.viewModel.getLocalEulerAngles ? this.viewModel.getLocalEulerAngles() : (this.viewModel.rotation ? { x:this.viewModel.rotation.x, y:this.viewModel.rotation.y, z:this.viewModel.rotation.z } : { x:0,y:0,z:0 })),
            durationUp: 0.03,
            durationDown: 0.25,
            maxAngleUp: 60 * DEG_TO_RAD,
            maxAngleSide: 3 * DEG_TO_RAD
          };
        }
      } else {
        // start reload
        this.isReloadingFlag = true;
        this.state.reloading = true;
        this.state.reloadStart = now;
        this._reloadEndPlayed = false;
        if (typeof this.playWeaponSound === "function") this.playWeaponSound("reloadStart");
      }
    }
  }

  // Deagle recoil animation (Z rotation + X)
  if (this.state.deagleRecoil && this.state.deagleRecoil.active) {
    const dr = this.state.deagleRecoil;
    const elapsed = now - dr.startTime;
    const total = dr.durationUp + dr.durationDown;
    if (elapsed < total) {
      let xAngle = 0, zAngle = 0;
      if (elapsed < dr.durationUp) {
        const progress = elapsed / dr.durationUp;
        const easedProgress = 1 - Math.exp(-progress * 5);
        xAngle = -dr.maxAngleUp * easedProgress;
        zAngle = -dr.maxAngleSide * easedProgress;
      } else {
        const downElapsed = elapsed - dr.durationUp;
        const progress = downElapsed / dr.durationDown;
        const easedProgress = Math.exp(-progress * 5);
        xAngle = -dr.maxAngleUp * easedProgress;
        zAngle = -dr.maxAngleSide * easedProgress;
      }

      const startRot = dr.startRotation || { x:0, y:0, z:0 };
      // startRotation may be degrees or radians depending on earlier storage, normalize if needed
      let startXdeg = startRot.x;
      let startYdeg = startRot.y;
      let startZdeg = startRot.z;
      // if start values look like radians (small), convert to degrees
      if (Math.abs(startXdeg) < 1.0 && Math.abs(startYdeg) < 1.0 && Math.abs(startZdeg) < 1.0) {
        startXdeg = startXdeg * RAD_TO_DEG;
        startYdeg = startYdeg * RAD_TO_DEG;
        startZdeg = startZdeg * RAD_TO_DEG;
      }
      const xDeg = startXdeg - (xAngle * RAD_TO_DEG);
      const zDeg = startZdeg - (zAngle * RAD_TO_DEG);

      if (this.viewModel && typeof this.viewModel.setLocalEulerAngles === 'function') {
        this.viewModel.setLocalEulerAngles(xDeg, startYdeg, zDeg);
      } else if (this.viewModel && this.viewModel.rotation) {
        this.viewModel.rotation.set(xDeg * DEG_TO_RAD, startYdeg * DEG_TO_RAD, zDeg * DEG_TO_RAD);
      }
    } else {
      // restore
      const sr = dr.startRotation || { x:0, y:0, z:0 };
      if (this.viewModel && typeof this.viewModel.setLocalEulerAngles === 'function') {
        this.viewModel.setLocalEulerAngles(sr.x, sr.y, sr.z);
      } else if (this.viewModel && this.viewModel.rotation) {
        this.viewModel.rotation.set((sr.x || 0) * DEG_TO_RAD, (sr.y || 0) * DEG_TO_RAD, (sr.z || 0) * DEG_TO_RAD);
      }
      this.state.deagleRecoil.active = false;
    }
  }

  // View-model recoil animation (z/back kick)
  if (this.state.recoiling && !this.stats.isMelee) {
    const VIEWER_RECOIL_ANIM_DURATION = 0.15;
    const tR = (now - this.state.recoilStart) / VIEWER_RECOIL_ANIM_DURATION;
    if (tR >= 1) {
      const backTo = (this._aiming && gunAimPos[this.currentKey]) ? gunAimPos[this.currentKey] : (this.readyPos || { x:0, y:0, z:0 });
      try { if (this.viewModel.setLocalPosition) this.viewModel.setLocalPosition(backTo.x, backTo.y, backTo.z); }
      catch (e) { if (this.viewModel.position) this.viewModel.position.set(backTo.x, backTo.y, backTo.z); }
      this.state.recoiling = false;
    } else {
      const baseZ = (this._aiming && gunAimPos[this.currentKey]) ? gunAimPos[this.currentKey].z : (this.readyPos ? this.readyPos.z : 0);
      const kick = (this.stats.recoilDistance || 0.05) * Math.sin(Math.PI * tR);
      const x = (this._aiming && gunAimPos[this.currentKey]) ? gunAimPos[this.currentKey].x : (this.readyPos ? this.readyPos.x : 0);
      const y = (this._aiming && gunAimPos[this.currentKey]) ? gunAimPos[this.currentKey].y : (this.readyPos ? this.readyPos.y : 0);
      if (this.viewModel && typeof this.viewModel.setLocalPosition === 'function') {
        this.viewModel.setLocalPosition(x, y, baseZ + kick);
      } else if (this.viewModel && this.viewModel.position) {
        this.viewModel.position.set(x, y, baseZ + kick);
      }
    }
  }

  // Knife swing animation
  if (this.state.knifeSwing && this.stats.isMelee) {
    const restX = 90 * DEG_TO_RAD, restY = 160 * DEG_TO_RAD, restZ = 0;
    const elapsed = now - this.state.knifeSwingStart;
    const dur = this.state.knifeHeavy ? (this.stats.heavySwingTime || 0.6) : (this.stats.swingTime || 0.35);
    if (elapsed >= dur) {
      if (this.weaponModel && typeof this.weaponModel.setLocalEulerAngles === 'function') this.weaponModel.setLocalEulerAngles(90,160,0);
      this.state.knifeSwing = false;
      if (window.localPlayer) { window.localPlayer.knifeSwing = false; window.localPlayer.knifeHeavy = false; }
    } else {
      const progress = elapsed / dur;
      const maxF = this.state.knifeHeavy ? 0.9 : 1.2;
      const swingAng = maxF * Math.sin(Math.PI * progress);
      const sideAng = swingAng * 0.5;
      const yOffset = 0.5 * Math.sin(Math.PI * progress);
      const xDeg = (restX - swingAng) * RAD_TO_DEG;
      const yDeg = (restY + yOffset) * RAD_TO_DEG;
      const zDeg = (restZ + sideAng) * RAD_TO_DEG;
      if (this.weaponModel && typeof this.weaponModel.setLocalEulerAngles === 'function') {
        this.weaponModel.setLocalEulerAngles(xDeg, yDeg, zDeg);
      } else if (this.weaponModel && this.weaponModel.rotation) {
        this.weaponModel.rotation.set(xDeg * DEG_TO_RAD, yDeg * DEG_TO_RAD, zDeg * DEG_TO_RAD);
      }
    }
  }

  // Handle reload input
  if (inputState.reload && !this.isReloadingFlag && this.ammoInMagazine < this.stats.magazineSize) {
    this.isReloadingFlag = true;
    this.state.reloading = true;
    this.state.reloadStart = now;
    this._reloadEndPlayed = false;
    if (typeof this.playWeaponSound === "function") this.playWeaponSound("reloadStart");
  }

  if (this.state.reloading && !this.stats.isMelee) {
    const elapsed = now - this.state.reloadStart;
    const half = (this.stats.reloadDuration || 1) / 2;
    if (!this._reloadEndPlayed && elapsed >= half) {
      if (typeof this.playWeaponSound === "function") this.playWeaponSound("reloadEnd");
      this._reloadEndPlayed = true;
    }
    if (elapsed >= (this.stats.reloadDuration || 1)) {
      this.ammoInMagazine = this.stats.magazineSize;
      this.isReloadingFlag = false;
      this.state.reloading = false;
      if (this.parts && this.parts.slide && typeof this.parts.slide.setLocalPosition === 'function') {
        const pos = this.parts.slide.getLocalPosition ? this.parts.slide.getLocalPosition() : { x:0, y:0, z:0 };
        try { this.parts.slide.setLocalPosition(pos.x, pos.y, 0); } catch (e) {}
      }
      try { if (typeof updateAmmoDisplay === "function") updateAmmoDisplay(this.ammoInMagazine, this.stats.magazineSize); } catch (e) {}
    } else if (elapsed <= half) {
      const angle = (Math.PI / 180) * 40 * (elapsed / half); // radians
      if (this.viewModel && typeof this.viewModel.setLocalEulerAngles === 'function') {
        this.viewModel.setLocalEulerAngles(angle * RAD_TO_DEG, 0, 0);
      } else if (this.viewModel && this.viewModel.rotation) {
        this.viewModel.rotation.set(angle, 0, 0);
      }
      if (this.parts && this.parts.slide && typeof this.parts.slide.setLocalPosition === 'function') {
        const slideZ = -0.05 * (elapsed / half);
        const pos = this.parts.slide.getLocalPosition ? this.parts.slide.getLocalPosition() : { x:0, y:0, z:0 };
        try { this.parts.slide.setLocalPosition(pos.x, pos.y, slideZ); } catch (e) {}
      }
    } else {
      const t2 = (elapsed - half) / half;
      const angle = (Math.PI / 180) * 40 * (1 - t2);
      if (this.viewModel && typeof this.viewModel.setLocalEulerAngles === 'function') {
        this.viewModel.setLocalEulerAngles(angle * RAD_TO_DEG, 0, 0);
      } else if (this.viewModel && this.viewModel.rotation) {
        this.viewModel.rotation.set(angle, 0, 0);
      }
      if (this.parts && this.parts.slide && typeof this.parts.slide.setLocalPosition === 'function') {
        const slideZ = -0.05 * (1 - t2);
        const pos = this.parts.slide.getLocalPosition ? this.parts.slide.getLocalPosition() : { x:0, y:0, z:0 };
        try { this.parts.slide.setLocalPosition(pos.x, pos.y, slideZ); } catch (e) {}
      }
    }
  }

  // Tracer cleanup - keep as-is
  if (this.state.tracerObjects && Array.isArray(this.state.tracerObjects)) {
    this.state.tracerObjects = this.state.tracerObjects.filter(entry => {
      if (!entry) return false;
      if ((now - entry.startTime > 0.2) && entry.entity) {
        try {
          if (entry.entity.parent) entry.entity.parent.removeChild(entry.entity);
          if (typeof entry.entity.destroy === "function") entry.entity.destroy();
        } catch (e) {}
        return false;
      }
      return true;
    });
  }

  // Camera recoil recovery & application
  this._recoil = this._recoil || { peakOffset: 0, recoilStartTime: 0, previousRecoilOffset: 0, recoilDuration: 0.25 };
  const elapsedRec = now - (this._recoil.recoilStartTime || 0);
  if (elapsedRec < (this._recoil.recoilDuration || 0)) {
    const t = clamp(elapsedRec / (this._recoil.recoilDuration || 0.0001), 0, 1);
    const easedT = 1 - (t * t * (3 - 2 * t));
    const currentRecoilOffset = (this._recoil.peakOffset || 0) * easedT; // radians
    const recoilDelta = currentRecoilOffset - (this._recoil.previousRecoilOffset || 0);
    const deltaDeg = recoilDelta * RAD_TO_DEG;

    // apply to camera local Euler X (engine agnostic)
    try {
      if (this.camera && typeof this.camera.getLocalEulerAngles === 'function' && typeof this.camera.setLocalEulerAngles === 'function') {
        const cur = this.camera.getLocalEulerAngles();
        this.camera.setLocalEulerAngles(cur.x + deltaDeg, cur.y, cur.z);
      } else if (this.camera && this.camera.rotation) {
        // three.js camera uses radians in rotation.x
        this.camera.rotation.x += deltaDeg * DEG_TO_RAD;
      }
    } catch (e) {}

    this._recoil.previousRecoilOffset = currentRecoilOffset;
  } else if ((this._recoil.peakOffset || 0) > 0) {
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
  // ensure required systems are present
  if (!this.physicsController || !this.physicsController.worldBVH) {
    console.error("World BVH not available to fire bullet.");
    return;
  }

  let realPenetrate = false;

  // Helpers ----------------------------------------------------------------
  const toPCVec3 = (v) => {
    if (!v) return new pc.Vec3();
    if (v instanceof pc.Vec3) return v.clone();
    if (typeof v.x === "number" && typeof v.y === "number" && typeof v.z === "number") return new pc.Vec3(v.x, v.y, v.z);
    return new pc.Vec3();
  };

  const toPlainObj = (v) => ({ x: v.x, y: v.y, z: v.z });

  const toTHREEVec = (v) => {
    if (typeof THREE === "undefined") return null;
    return new THREE.Vector3(v.x, v.y, v.z);
  };

  // Get world-space origin and forward direction (pc.Vec3)
  const getWorldPositionOfEntity = (ent) => {
    if (!ent) return new pc.Vec3();
    try {
      // 1) prefer getPosition() (PlayCanvas often exposes world pos via getPosition)
      if (typeof ent.getPosition === "function") {
        const p = ent.getPosition();
        if (p) return p.clone ? p.clone() : new pc.Vec3(p.x, p.y, p.z);
      }
      // 2) try getWorldTransform().transformPoint if available
      if (typeof ent.getWorldTransform === "function") {
        const wt = ent.getWorldTransform();
        if (wt && typeof wt.transformPoint === "function") {
          const out = wt.transformPoint(new pc.Vec3(0, 0, 0));
          if (out) return out.clone ? out.clone() : new pc.Vec3(out.x, out.y, out.z);
        }
      }
      // 3) fallback to local position transformed by parent's world transform
      if (typeof ent.getLocalPosition === "function") {
        const lp = ent.getLocalPosition();
        // if parent exists, try parent.world transform
        if (ent.parent && typeof ent.parent.getWorldTransform === "function") {
          const pwt = ent.parent.getWorldTransform();
          if (pwt && typeof pwt.transformPoint === "function") {
            return pwt.transformPoint(lp);
          }
        }
        return lp.clone ? lp.clone() : new pc.Vec3(lp.x, lp.y, lp.z);
      }
    } catch (e) {
      // ignore and return zero
    }
    return new pc.Vec3();
  };

  const getWorldForwardOfEntity = (ent) => {
    // returns normalized forward world vector (pc.Vec3) pointing along local +Z
    if (!ent) return new pc.Vec3(0, 0, 1);
    try {
      // Use world transform to transform local forward point (0,0,1) and subtract world origin
      if (typeof ent.getWorldTransform === "function") {
        const wt = ent.getWorldTransform();
        if (wt && typeof wt.transformPoint === "function") {
          const w0 = wt.transformPoint(new pc.Vec3(0, 0, 0));
          const wf = wt.transformPoint(new pc.Vec3(0, 0, 1));
          const dir = wf.clone().sub(w0).normalize();
          return dir;
        }
      }
      // fallback: use entity.forward() if present
      if (typeof ent.forward === "function") {
        const f = ent.forward();
        if (f) return f.clone ? f.clone() : new pc.Vec3(f.x,f.y,f.z);
      }
      // last fallback: camera forward if entity is missing world transform
      if (this.camera) {
        try {
          if (typeof this.camera.getWorldTransform === "function") {
            const cwt = this.camera.getWorldTransform();
            if (cwt && typeof cwt.transformPoint === "function") {
              const c0 = cwt.transformPoint(new pc.Vec3(0,0,0));
              const cf = cwt.transformPoint(new pc.Vec3(0,0,1));
              return cf.clone().sub(c0).normalize();
            }
          }
        } catch (e) {}
      }
    } catch (e) {}
    return new pc.Vec3(0, 0, 1);
  };

  // Build origin & direction (pc.Vec3)
  let originPC = new pc.Vec3();
  let dirPC = new pc.Vec3(0, 0, 1);

  if (this.parts && this.parts.muzzle) {
    // try muzzle world transform
    originPC = getWorldPositionOfEntity(this.parts.muzzle);
    dirPC = getWorldForwardOfEntity(this.parts.muzzle);
  } else if (this.camera) {
    // fallback to camera world forward
    originPC = getWorldPositionOfEntity(this.camera);
    dirPC = getWorldForwardOfEntity(this.camera);
  }

  // Apply spread: use a random cone around dirPC
  const applySpread = (dir, spreadDeg) => {
    if (!dir || !dir.length) return dir;
    const spreadRad = (spreadDeg || 0) * (Math.PI / 180);
    if (spreadRad <= 0) return dir.clone();
    // Build orthonormal basis
    const up = Math.abs(dir.y) < 0.99 ? new pc.Vec3(0,1,0) : new pc.Vec3(1,0,0);
    const right = dir.clone().cross(up).normalize();
    const realUp = right.clone().cross(dir).normalize();
    const theta = Math.random() * 2 * Math.PI;
    const u = Math.random();
    const r = Math.sqrt(u) * Math.tan(spreadRad);
    const offset = right.scale(Math.cos(theta) * r).add(realUp.scale(Math.sin(theta) * r));
    const out = dir.clone().add(offset).normalize();
    return out;
  };

// dirPC is pc.Vec3 world forward computed from muzzle or camera
const directionWithSpread = applySpreadToPCVec(dirPC, spreadAngle);


  // Prepare arguments for checkBulletPenetration
  // Try to detect which vector types checkBulletPenetration expects:
  let originForCheck = originPC;
  let dirForCheck = directionWithSpread;
  let usedThree = false;

  if (typeof THREE !== "undefined") {
    // If THREE is present, create THREE vectors to maximize backwards compatibility
    try {
      const o3 = new THREE.Vector3(originPC.x, originPC.y, originPC.z);
      const d3 = new THREE.Vector3(directionWithSpread.x, directionWithSpread.y, directionWithSpread.z);
      originForCheck = o3;
      dirForCheck = d3;
      usedThree = true;
    } catch (e) {
      usedThree = false;
    }
  }

  // Call penetration check (some implementations expect THREE vectors, others may accept plain objects)
  let traj = null;
  try {
    traj = this.checkBulletPenetration(originForCheck, dirForCheck, 1);
  } catch (e) {
    // fallback: try passing plain objects
    try {
      traj = this.checkBulletPenetration(toPlainObj(originPC), toPlainObj(directionWithSpread), 1);
    } catch (err) {
      console.error("checkBulletPenetration failed (both vector forms):", err);
      return;
    }
  }

  // Helper to coerce intersection/point/normal into pc.Vec3
  const pointToPC = (p) => {
    if (!p) return new pc.Vec3();
    if (p instanceof pc.Vec3) return p.clone();
    if (typeof p.x === "number" && typeof p.y === "number" && typeof p.z === "number") return new pc.Vec3(p.x, p.y, p.z);
    // if THREE.Vector3
    if (typeof THREE !== "undefined" && p instanceof THREE.Vector3) return new pc.Vec3(p.x, p.y, p.z);
    return new pc.Vec3();
  };

  // Determine tracer end (pc.Vec3)
  let tracerEndPC = null;

  if (traj && traj.playerHitResult) {
    const hit = traj.playerHitResult;
    let mesh = hit.mesh;
    // climb to parent until we find userData.playerId (keep original logic)
    while (mesh && mesh.userData && mesh.userData.playerId == null) mesh = mesh.parent;

    if (mesh && mesh.userData && mesh.userData.playerId != null) {
      const isHead = !!hit.isHead;
      const baseDamage = isHead ? this.stats.headshotDamage : this.stats.bodyDamage;

      // compute distance in meters — convert using your unitsPerMeter if available
      // make sure to coerce types for distance calculation
      const hitPos = pointToPC(hit.intersection);
      const originForDist = usedThree ? pointToPC(originForCheck) : originPC;
      const distanceUnits = originForDist.distance(hitPos);
      const distanceMeters = typeof this.unitsPerMeter === "number" && this.unitsPerMeter > 0 ? (distanceUnits / this.unitsPerMeter) : distanceUnits;

      // calculate damage with drop-off; pass isHead flag if your function supports it
      let damageToApply = typeof calculateDamageWithDropOff === "function"
        ? calculateDamageWithDropOff(baseDamage, distanceMeters, this.stats.damageDropOff, isHead)
        : baseDamage;

      if (traj.isPenetrationShot) {
        damageToApply *= 0.5;
        realPenetrate = true;
      }

      damageToApply = Math.round(damageToApply);

      // Send damage to server/remote handler
      if (typeof window.applyDamageToRemote === "function") {
        window.applyDamageToRemote(
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
      }

      realPenetrate = false;

      if (!traj.isPenetrationShot) {
        try { if (isHead) (typeof playBodyHeadshot === "function") && playBodyHeadshot(); else (typeof playBodyHit === "function") && playBodyHit(); } catch (e) {}
      }
    }

    tracerEndPC = pointToPC(traj.playerHitResult.intersection);
  } else {
    if (traj && traj.allWorldHits && traj.allWorldHits.length) {
      const last = traj.allWorldHits[traj.allWorldHits.length - 1];
      tracerEndPC = pointToPC(last.point);
    } else {
      // fallback to a long tracer in the shot direction
      const len = this.stats && this.stats.tracerLength ? this.stats.tracerLength : 2000;
      tracerEndPC = originPC.clone().add(directionWithSpread.clone().scale(len));
    }
  }

  // Send bullet holes for world hits (convert to plain numeric)
  if (traj && traj.allWorldHits && Array.isArray(traj.allWorldHits)) {
    for (const wh of traj.allWorldHits) {
      if (!wh || !wh.point || !wh.normal) continue;
      const pt = pointToPC(wh.point);
      const n = pointToPC(wh.normal);
      try {
        const payload = {
          x: pt.x, y: pt.y, z: pt.z,
          nx: n.x, ny: n.y, nz: n.z,
          timeCreated: (typeof firebase !== "undefined" && firebase.database && firebase.database.ServerValue)
            ? firebase.database.ServerValue.TIMESTAMP
            : Date.now()
        };
        if (typeof sendBulletHole === "function") sendBulletHole(payload);
      } catch (e) {
        console.warn("failed to sendBulletHole", e);
      }
    }
  }

  // Create tracer from muzzle world position (pc.Vec3)
  let muzzleWorld = originPC.clone();
  try {
    if (this.parts && this.parts.muzzle) muzzleWorld = getWorldPositionOfEntity(this.parts.muzzle);
  } catch (e) {}

  // Call createTracer with appropriate types (convert to whatever your tracer implementation expects)
  try {
    // If createTracer expects THREE vectors, convert if THREE exists
    if (typeof createTracer === "function") {
      // prefer to send plain pc.Vec3 - your createTracer may accept this in PC port
      createTracer(muzzleWorld.clone(), tracerEndPC.clone(), this.currentKey, this.stats.tracerLength);
    }
  } catch (e) {
    // fallback: if createTracer expects plain number coordinates
    try {
      if (typeof createTracer === "function") {
        createTracer({ ox: muzzleWorld.x, oy: muzzleWorld.y, oz: muzzleWorld.z, tx: tracerEndPC.x, ty: tracerEndPC.y, tz: tracerEndPC.z, key: this.currentKey });
      }
    } catch (e2) {
      console.warn("createTracer failed:", e2);
    }
  }

  // Send tracer network event (numbers)
  try {
    if (typeof sendTracer === "function") {
      sendTracer({
        ox: muzzleWorld.x, oy: muzzleWorld.y, oz: muzzleWorld.z,
        tx: tracerEndPC.x, ty: tracerEndPC.y, tz: tracerEndPC.z
      });
    }
  } catch (e) { console.warn("sendTracer failed:", e); }
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
    const url = 'https://raw.githubusercontent.com/thearthd/3d-models/main/Weapon/voidffa_knife_V6.glb';
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
  
// inside PCWeaponBuilder
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



const PC = {
  app: () => window.playcanvasApp,
  nowSec: () => performance.now() / 1000,
  vec: (x=0,y=0,z=0) => new pc.Vec3(x,y,z),
  clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
  lerp: (a, b, t) => a + (b - a) * t,
  toDeg: (r) => r * 180 / Math.PI,
  toRad: (d) => d * Math.PI / 180,
};

/* -------------------------
   Preload weapon prototypes (PlayCanvas)
   - Loads GLBs as 'container' assets and stores instantiated root
   - Result prototypes are pc.Entity roots stored in window._pcPrototypeModels
   ------------------------- */
export async function preloadWeaponPrototypes(onComplete) {
  const names = ['knife','deagle','ak47','marshal','m79','viper','legion'];
  window._pcPrototypeModels = window._pcPrototypeModels || {};
  const pcApp = PC.app();
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
    console.log(`[preload] loading ${name} from ${url}`);
    await new Promise((resolve) => {
      pcApp.assets.loadFromUrl(url, "container", (err, asset) => {
        if (err) {
          console.warn(`[preload] failed to load ${name}:`, err);
          resolve();
          return;
        }
        // instantiate a render entity group (root)
        let rootEnt = null;
        try {
          if (asset.resource.instantiateRenderEntity) {
            rootEnt = asset.resource.instantiateRenderEntity();
          } else if (asset.resource.instantiateModelEntity) {
            rootEnt = asset.resource.instantiateModelEntity();
          } else if (asset.resource.instantiate) {
            rootEnt = asset.resource.instantiate();
          }
        } catch (e) {
          console.warn(`[preload] instantiate failed for ${name}:`, e);
        }
        if (!rootEnt) {
          resolve();
          return;
        }
        // detach from scene if accidentally attached
        try { if (rootEnt.parent) rootEnt.parent.removeChild(rootEnt); } catch {}
        // make invisible/prototype-safe
        rootEnt.enabled = false;
        window._pcPrototypeModels[name] = rootEnt;
        console.log(`[preload] prototype stored: ${name}`);
        resolve();
      });
    });
    // update loader progress if present
    if (loaderUI && loaderUI.track) {
      try { loaderUI.track(1/names.length, Promise.resolve()); } catch {}
    }
  }

  if (loaderUI && loaderUI.onComplete) loaderUI.onComplete();
  console.log("▶️ ALL PlayCanvas weapon prototypes ready");
  onComplete && onComplete();
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

// PlayCanvas equivalent of your THREE AnimatedTracer
// Usage:
//   const t = new PlayCanvasAnimatedTracer(originVec3Like, targetVec3Like, speed);
// It will add itself to the PlayCanvas scene root (window.scene || window.playcanvasApp.root)
// and register a global update handler to step all active tracers automatically.
//
// origin/target may be pc.Vec3, THREE.Vector3-like ({x,y,z}), or plain objects with numeric x,y,z.

export class AnimatedTracer {
    /**
     * @param {object|pc.Vec3} origin - {x,y,z} or pc.Vec3 (world space)
     * @param {object|pc.Vec3} target - {x,y,z} or pc.Vec3 (world space)
     * @param {number} speed - units per second (default 500, same semantics as your THREE class)
     * @param {object} opts - optional: { length, width, height, color }
     */
    constructor(origin, target, speed = 500, opts = {}) {
        // Ensure PlayCanvas exists
        if (typeof pc === "undefined") {
            throw new Error("PlayCanvas (pc) not found in environment.");
        }

        // normalize inputs into pc.Vec3
        const toVec3 = v => {
            if (!v) return new pc.Vec3();
            if (v instanceof pc.Vec3) return v.clone();
            if (typeof v.x === "number" && typeof v.y === "number" && typeof v.z === "number") {
                return new pc.Vec3(v.x, v.y, v.z);
            }
            // if THREE.Vector3-like
            if (v.x !== undefined && v.y !== undefined && v.z !== undefined) {
                return new pc.Vec3(v.x, v.y, v.z);
            }
            return new pc.Vec3();
        };

        this.origin = toVec3(origin);
        this.target = toVec3(target);
        this.direction = new pc.Vec3();
        this.direction.sub2(this.target, this.origin).normalize();

        this.distance = this.origin.distance(this.target);
        this.speed = speed;
        this.traveledDistance = 0;
        this.initialOpacity = 1.0;
        this.remove = false;

        // Visual parameters (can be overridden by opts)
        this.length = typeof opts.length === "number" ? opts.length : 20; // plays as world units
        this.width = typeof opts.width === "number" ? opts.width : 0.05;
        this.height = typeof opts.height === "number" ? opts.height : 0.05;
        this.colorHex = typeof opts.color === "number" ? opts.color : 0xffa500; // orange default

        // create entity
        this.entity = new pc.Entity("tracer");
        // add a box model and use local scale to control dims (box is unit cube centered)
        this.entity.addComponent("model", { type: "box" });
        this.entity.model.castShadows = false;
        this.entity.model.receiveShadows = false;

        // create a dedicated material so opacity changes are safe per-tracer
        this.material = new pc.StandardMaterial();
        // set diffuse from hex
        const r = ((this.colorHex >> 16) & 0xff) / 255;
        const g = ((this.colorHex >> 8) & 0xff) / 255;
        const b = (this.colorHex & 0xff) / 255;
        this.material.diffuse = new pc.Color(r, g, b);
        // use emissive so it's bright
        this.material.emissive = new pc.Color(r * 0.6, g * 0.6, b * 0.6);
        // enable additive blending / transparency
        this.material.blendType = pc.BLEND_ADDITIVE;
        this.material.opacity = this.initialOpacity;
        // ensure transparency takes effect
        this.material.update();

        // assign material to model (model.material expects a single material)
        try {
            this.entity.model.material = this.material;
        } catch (e) {
            // Some PlayCanvas versions require walking children; but most accept direct assignment.
            console.warn("Could not assign material directly to model; tracer may use default material.", e);
        }

        // scale box so its Z size equals `length` and thickness are width/height
        this.entity.setLocalScale(this.width, this.height, this.length);

        // orientation: compute pitch & yaw to align local +Z toward direction
        // formula: yaw = atan2(dx, dz); pitch = atan2(-dy, sqrt(dx^2+dz^2))
        const dx = this.direction.x;
        const dy = this.direction.y;
        const dz = this.direction.z;
        const yaw = Math.atan2(dx, dz); // radians
        const horizontalLen = Math.sqrt(dx * dx + dz * dz);
        const pitch = Math.atan2(-dy, horizontalLen); // radians

        // convert to degrees for setLocalEulerAngles
        const RAD_TO_DEG = 180 / Math.PI;
        const pitchDeg = pitch * RAD_TO_DEG;
        const yawDeg = yaw * RAD_TO_DEG;

        // Set rotation (pitch around X, yaw around Y)
        this.entity.setLocalEulerAngles(pitchDeg, yawDeg, 0);

        // Position the box such that its BACK (start) sits at origin:
        // Box is centered; to put back at origin, offset by +direction * (length/2)
        const half = this.length * 0.5;
        const pos = new pc.Vec3();
        pos.copy(this.origin).add(this.direction.clone().scale(half));
        this.entity.setPosition(pos);

        // Add to scene root (try window.scene first, then playcanvasApp.root)
        const root = (window.scene && window.scene instanceof pc.Entity) ? window.scene : (window.playcanvasApp && window.playcanvasApp.root);
        if (root && typeof root.addChild === "function") {
            root.addChild(this.entity);
        } else {
            console.warn("PlayCanvas root not found: tracer will not be added to scene automatically.");
        }

        // register tracer in global list and ensure update loop is attached
        window.activeTracers = window.activeTracers || [];
        window.activeTracers.push(this);

        // attach global update once
        this._ensureGlobalUpdateHook();
    }

    // Single global update hook attached to PlayCanvas app (only once)
    _ensureGlobalUpdateHook() {
        if (window._pcTracerUpdateAttached) return;
        const pcApp = window.playcanvasApp;
        if (!pcApp || typeof pcApp.on !== "function") {
            // If no pc app, fallback to requestAnimationFrame loop
            let last = performance.now();
            const rafLoop = (t) => {
                const dt = (t - last) / 1000;
                last = t;
                try {
                    (window.activeTracers || []).forEach(tr => {
                        try { tr.update(dt); } catch (e) { console.warn("tracer update error", e); }
                    });
                    // cleanup removals
                    (window.activeTracers || []).forEach((tr, i) => { if (tr.remove) { tr.dispose(); window.activeTracers.splice(i, 1); } });
                } catch (e) {}
                window._pcTracerRaf = requestAnimationFrame(rafLoop);
            };
            window._pcTracerRaf = requestAnimationFrame(rafLoop);
            window._pcTracerUpdateAttached = true;
            return;
        }

        // Use PlayCanvas update event (dt is in seconds)
        pcApp.on("update", (dt) => {
            const arr = window.activeTracers || [];
            for (let i = arr.length - 1; i >= 0; i--) {
                try {
                    arr[i].update(dt);
                } catch (e) {
                    console.warn("tracer update error:", e);
                }
                if (arr[i].remove) {
                    try { arr[i].dispose(); } catch (e) {}
                    arr.splice(i, 1);
                }
            }
        });
        window._pcTracerUpdateAttached = true;
    }

    /**
     * Step the tracer. deltaTime is seconds.
     */
    update(deltaTime) {
        if (this.remove) return;

        // step traveled distance
        const moveAmount = this.speed * deltaTime;
        this.traveledDistance += moveAmount;

        // clamp movement so we don't overshoot in the display position (we still mark remove when done)
        const traveledForPosition = Math.min(this.traveledDistance, this.distance);

        // recompute center position = origin + direction * (traveled + halfLength)
        const half = this.length * 0.5;
        const pos = new pc.Vec3();
        pos.copy(this.origin).add(this.direction.clone().scale(traveledForPosition + half));
        this.entity.setPosition(pos);

        // fade out when near the target (short fade window proportional to speed)
        const remainingDistance = this.distance - this.traveledDistance;
        const fadeOutStart = Math.max(0.001, this.speed * 0.01); // safety clamp
        if (remainingDistance < fadeOutStart) {
            const frac = Math.max(0, remainingDistance / fadeOutStart);
            this.material.opacity = this.initialOpacity * frac;
            this.material.update();
        }

        if (this.traveledDistance >= this.distance) {
            this.remove = true;
        }
    }

    /**
     * Dispose and free resources.
     */
    dispose() {
        try {
            if (this.entity && this.entity._parent) {
                this.entity._parent.removeChild(this.entity);
            }
        } catch (e) { /* ignore */ }

        try {
            if (this.entity) {
                this.entity.destroy();
            }
        } catch (e) { /* ignore */ }

        try {
            if (this.material) {
                // PlayCanvas StandardMaterial has a destroy method
                if (typeof this.material.destroy === "function") this.material.destroy();
            }
        } catch (e) { /* ignore */ }

        // remove from global list if present
        if (window.activeTracers) {
            const idx = window.activeTracers.indexOf(this);
            if (idx !== -1) window.activeTracers.splice(idx, 1);
        }
    }
}





// PlayCanvas helpers: WeaponBuilder + BulletHoleManager + debug dot
// Usage:
//   const app = window.playcanvasApp; // ensure set
//   const wb = new PCWeaponBuilder({ app, viewModel: someParentEntity });
//   wb.buildAK47().promise.then(entity => { /* entity added to viewModel by default */ });
//   PCBulletHoleManager.addBulletHole(holeData, firebaseKey);
//   PCBulletHoleManager.removeBulletHole(firebaseKey);

(function (global) {
  // Ensure pc exists
  if (typeof pc === "undefined") {
    console.warn("PlayCanvas (pc) not found. Include these helpers only inside PlayCanvas context.");
  }

  const DEFAULT_APP = () => window.playcanvasApp || (pc && pc.Application && pc.Application.getApplication && pc.Application.getApplication());

  // ---------- BulletHoleManager ----------
  const PCBulletHoleManager = {
    bulletHoles: {},

    /**
     * holeData: { x,y,z, nx,ny,nz, timeCreated } in world coordinates
     * firebaseKey: unique key to avoid duplicates
     */
    addBulletHole: function (holeData, firebaseKey, opts = {}) {
      const app = DEFAULT_APP();
      if (!app) {
        console.warn("PCBulletHoleManager: PlayCanvas app not found.");
        return;
      }
      if (!holeData || !firebaseKey) return;
      if (!this.bulletHoles) this.bulletHoles = {};
      if (this.bulletHoles[firebaseKey]) return; // already added

      const { x = 0, y = 0, z = 0, nx = 0, ny = 1, nz = 0, timeCreated = Date.now() } = holeData;
      const fadeDuration = typeof opts.fadeDuration === "number" ? opts.fadeDuration : 5.0; // seconds
      const size = typeof opts.size === "number" ? opts.size : 0.15;

      // create bullet hole entity (a thin plane facing its normal)
      const hole = new pc.Entity("bulletHole");
      // create plane model primitive
      hole.addComponent("model", { type: "plane" });
      // rotate plane so its normal points +Z (we will reorient via lookAt)
      hole.setLocalScale(size, size, 1);

      // material
      const mat = new pc.StandardMaterial();
      mat.emissive = new pc.Color(0.07, 0.07, 0.07); // slightly visible even in dark
      mat.blendType = pc.BLEND_NORMAL;
      mat.opacity = 0.85;
      mat.alphaTest = 0; // fully transparent fallback
      mat.useMetalness = false;
      mat.update();

      // assign material (safe single-instance per decal; we will clone if needed)
      try {
        hole.model.material = mat;
      } catch (e) {
        // In some PlayCanvas versions, model assignment needs walking children; try fallback
        if (hole.model && hole.model.meshInstances) {
          for (let mi of hole.model.meshInstances) {
            mi.material = mat;
          }
        }
      }

      // position
      hole.setPosition(x, y, z);

      // orient to normal
      const normal = new pc.Vec3(nx, ny, nz).normalize();
      // Create a temporary lookAt target: pos + normal
      const target = new pc.Vec3(x + normal.x, y + normal.y, z + normal.z);
      hole.lookAt(target);

      // offset slightly along normal to avoid z-fighting
      const ZFIGHT_OFFSET = 0.002;
      hole.translate(normal.scale(ZFIGHT_OFFSET));

      // add to root (or to a dedicated bullet-hole group on root)
      app.root.addChild(hole);

      // store
      this.bulletHoles[firebaseKey] = { entity: hole, material: mat };

      // handle fade-out accounting for 'age' (timeCreated possibly in the past)
      const age = (Date.now() - timeCreated) / 1000;
      const start = performance.now() / 1000 - age;
      const animate = () => {
        const now = performance.now() / 1000;
        const elapsed = now - start;
        if (!this.bulletHoles[firebaseKey] || !hole || !hole.parent) {
          // clean up if removed elsewhere
          if (hole && hole.parent) hole.parent.removeChild(hole);
          if (mat && typeof mat.destroy === "function") mat.destroy();
          delete this.bulletHoles[firebaseKey];
          return;
        }
        if (elapsed >= fadeDuration) {
          // remove and destroy
          if (hole && hole.parent) hole.parent.removeChild(hole);
          try { hole.destroy(); } catch (e) {}
          try { if (mat && typeof mat.destroy === "function") mat.destroy(); } catch (e) {}
          delete this.bulletHoles[firebaseKey];
        } else {
          const o = pc.math.lerp(0.85, 0.0, elapsed / fadeDuration);
          if (mat) {
            mat.opacity = o;
            mat.update();
          }
          requestAnimationFrame(animate);
        }
      };
      requestAnimationFrame(animate);
      return hole;
    },

    removeBulletHole: function (firebaseKey) {
      if (!this.bulletHoles || !this.bulletHoles[firebaseKey]) return;
      const entry = this.bulletHoles[firebaseKey];
      try {
        if (entry.entity && entry.entity.parent) entry.entity.parent.removeChild(entry.entity);
        if (entry.entity) entry.entity.destroy();
      } catch (e) {}
      try { if (entry.material && typeof entry.material.destroy === "function") entry.material.destroy(); } catch (e) {}
      delete this.bulletHoles[firebaseKey];
    }
  };

  // Put manager on window for easy access (matches your tracer pattern)
  window.pcBulletHoleManager = PCBulletHoleManager;
  window.pcBulletHoles = PCBulletHoleManager.bulletHoles;

  // ---------- Debug muzzle dot ----------
  function addDebugMuzzleDot(muzzleEntity, dotSize = 0.02, colorHex = 0xff0000) {
    const app = DEFAULT_APP();
    if (!app) {
      console.warn("addDebugMuzzleDot: PlayCanvas app not found.");
      return null;
    }
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
    try {
      dot.model.material = mat;
    } catch (e) {
      if (dot.model && dot.model.meshInstances) {
        for (let mi of dot.model.meshInstances) mi.material = mat;
      }
    }

    muzzleEntity.addChild(dot);
    return dot;
  }
  window.addPlaycanvasDebugMuzzleDot = addDebugMuzzleDot;

  // ---------- WeaponBuilder ----------
class PCWeaponBuilder {
  /**
   * @param {object} opts { app: pc.Application (optional), viewModel: pc.Entity (optional) }
   */
  constructor(opts = {}) {
    this.app = opts.app || (window.playcanvasApp || (typeof pc !== 'undefined' && pc.Application && pc.Application.getApplication && pc.Application.getApplication()));
    this.viewModel = opts.viewModel || null;
    if (!this.app) console.warn("PCWeaponBuilder: PlayCanvas app not found. Provide opts.app or ensure window.playcanvasApp exists.");
  }

  // load a glb container and instantiate a pc.Entity root
  _loadGlb(url) {
    const app = this.app;
    return new Promise((res, rej) => {
      if (!app) return rej(new Error("PlayCanvas app not available"));
      app.assets.loadFromUrl(url, "container", (err, asset) => {
        if (err) return rej(err);
        // instantiate a render entity root
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
        // detach if accidentally attached
        try { if (inst.parent) inst.parent.removeChild(inst); } catch {}
        res(inst);
      });
    });
  }

  // compute rough combined AABB of an instantiated pc.Entity (returns {min, max, center} or null)
  _computeCombinedAabb(rootEntity) {
    if (!rootEntity) return null;
    const INF = Number.POSITIVE_INFINITY;
    const min = new pc.Vec3(INF, INF, INF);
    const max = new pc.Vec3(-INF, -INF, -INF);
    let found = false;

    const visit = (ent) => {
      if (!ent) return;
      // if model -> meshInstances
      if (ent.model && ent.model.model && ent.model.model.meshInstances) {
        for (let mi of ent.model.model.meshInstances) {
          if (mi.aabb) {
            const aMin = mi.aabb.getMin();
            const aMax = mi.aabb.getMax();
            // transform both corners to world
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

  // generic builder that returns a weaponRoot entity and detected parts.
  _buildGeneric(url, opts = {}) {
    let prog = () => {};
    const promise = this._loadGlb(url).then((inst) => {
      // inst is the instantiated container root (pc.Entity)
      // create a wrapper root so we can set unified transforms per-weapon
      const weaponRoot = new pc.Entity("weaponRoot");
      weaponRoot.enabled = true;

      // parent the instanced container under weaponRoot
      weaponRoot.addChild(inst);

      // attach to viewModel (so it inherits camera transforms)
      if (this.viewModel && typeof this.viewModel.addChild === 'function') {
        this.viewModel.addChild(weaponRoot);
      } else if (this.app && this.app.root) {
        this.app.root.addChild(weaponRoot);
      }

      // compute AABB and center the model (shift inst so its center is origin)
      const aabb = this._computeCombinedAabb(inst);
      if (aabb && inst.translate) {
        // Convert world center to inst local coordinates by using world->local transform
        try {
          // get world transform of inst, invert it to get world->local
          const wt = inst.getWorldTransform();
          const inv = wt.clone().invert();
          const localCenter = inv.transformPoint(aabb.center);
          inst.translate(-localCenter.x, -localCenter.y, -localCenter.z);
        } catch (e) {
          // if anything fails we ignore centering (not critical)
        }
      }

      // create basic parts map and attempt to find named nodes
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

      // create a muzzle if none found: try to place at AABB max
      if (!parts.muzzle) {
        const muzzle = new pc.Entity("Muzzle");
        muzzle.setLocalPosition(0,0,0);
        weaponRoot.addChild(muzzle);
        parts.muzzle = muzzle;
        const aabb2 = this._computeCombinedAabb(inst);
        if (aabb2) {
          // world->weaponRoot local
          try {
            const invRoot = weaponRoot.getWorldTransform().clone().invert();
            const local = invRoot.transformPoint(aabb2.max);
            muzzle.setLocalPosition(local.x, local.y, local.z);
          } catch (e) {
            muzzle.setLocalPosition(0, 0.5, 0);
          }
        } else {
          muzzle.setLocalPosition(0, 0.5, 0);
        }
      }

      // reasonable defaults
      weaponRoot.setLocalScale(1,1,1);
      weaponRoot.setLocalEulerAngles(0,0,0);
      weaponRoot.setLocalPosition(0,0,0);

      return { weaponRoot, parts };
    });

    return {
      promise,
      register: cb => (prog = cb)
    };
  }

  // Concrete builders
  buildKnife(onProgressRegistrar) {
    const url = 'https://raw.githubusercontent.com/thearthd/3d-models/main/Weapon/voidffa_knife_V6.glb';
    return this._buildGeneric(url);
  }
  buildDeagle(onProgressRegistrar) {
    const url = 'https://raw.githubusercontent.com/thearthd/3d-models/main/Weapon/voidffa_deagle.glb';
    return this._buildGeneric(url);
  }
  buildLegion(onProgressRegistrar) {
    const url = 'https://raw.githubusercontent.com/thearthd/3d-models/main/Legion1212.glb';
    return this._buildGeneric(url);
  }
  buildAK47(onProgressRegistrar) {
    const url = 'https://raw.githubusercontent.com/thearthd/3d-models/main/Weapon/voidffa_AK47_V2.glb';
    return this._buildGeneric(url);
  }
  buildViper(onProgressRegistrar) {
    const url = 'https://raw.githubusercontent.com/thearthd/3d-models/main/Viper.glb';
    return this._buildGeneric(url);
  }
  buildMarshal(onProgressRegistrar) {
    const url = 'https://raw.githubusercontent.com/thearthd/3d-models/main/svd_sniper_rfile.glb';
    return this._buildGeneric(url);
  }
  buildM79(onProgressRegistrar) {
    const url = 'https://raw.githubusercontent.com/thearthd/3d-models/main/M-79.glb';
    return this._buildGeneric(url);
  }
}

  // Expose to global
  global.PCWeaponBuilder = PCWeaponBuilder;
  global.PCBulletHoleManager = PCBulletHoleManager;
  global.addPlaycanvasDebugMuzzleDot = addDebugMuzzleDot;

})(window);








// Helpers used by equipWeapon
const DEG_TO_RAD = Math.PI / 180;
function isPcEntity(ent) {
  return ent && typeof ent.setLocalPosition === 'function' && typeof ent.setLocalScale === 'function';
}
function isThreeObject(ent) {
  return typeof THREE !== "undefined" && ent && (ent.isObject3D || (ent.position && ent.rotation && ent.scale));
}
function isContainerResourceLike(ent) {
  // container resource instantiate may return an object that isn't a pc.Entity nor THREE but has children
  return ent && ent.children && ent.children.length !== undefined;
}
function setEntityTransform(ent, posVec3, rotDegVec3, scaleVec3) {
  // posVec3 / rotDegVec3 / scaleVec3 expected as simple {x,y,z} or pc.Vec3
  const toPlain = (v) => ({ x: v.x, y: v.y, z: v.z });

  const pos = toPlain(posVec3 || { x: 0, y: 0, z: 0 });
  const rot = toPlain(rotDegVec3 || { x: 0, y: 0, z: 0 }); // degrees
  const scl = toPlain(scaleVec3 || { x: 1, y: 1, z: 1 });

  try {
    if (isPcEntity(ent)) {
      ent.setLocalPosition(pos.x, pos.y, pos.z);
      ent.setLocalEulerAngles(rot.x, rot.y, rot.z);
      ent.setLocalScale(scl.x, scl.y, scl.z);
      return;
    }
    if (isThreeObject(ent)) {
      // THREE uses radians for rotation and vector3 for scale/pos
      ent.position.set(pos.x, pos.y, pos.z);
      ent.rotation.set(rot.x * DEG_TO_RAD, rot.y * DEG_TO_RAD, rot.z * DEG_TO_RAD);
      if (ent.scale) ent.scale.set(scl.x, scl.y, scl.z);
      return;
    }
    // If it's a container-like object with children, attempt setting local transforms on root child
    if (isContainerResourceLike(ent) && ent.children && ent.children.length) {
      const rootChild = ent.children[0];
      setEntityTransform(rootChild, pos, rot, scl);
      return;
    }

    // Last fallback: try properties
    if (ent) {
      if ('x' in ent || 'position' in ent) {
        try {
          if (ent.position && typeof ent.position.set === 'function') ent.position.set(pos.x, pos.y, pos.z);
          else ent.position = { x: pos.x, y: pos.y, z: pos.z };
        } catch (e) {}
      }
      if ('scale' in ent) {
        try {
          if (ent.scale && typeof ent.scale.set === 'function') ent.scale.set(scl.x, scl.y, scl.z);
          else ent.scale = { x: scl.x, y: scl.y, z: scl.z };
        } catch (e) {}
      }
      if ('rotation' in ent) {
        try {
          if (ent.rotation && typeof ent.rotation.set === 'function') ent.rotation.set(rot.x * DEG_TO_RAD, rot.y * DEG_TO_RAD, rot.z * DEG_TO_RAD);
          else ent.rotation = { x: rot.x * DEG_TO_RAD, y: rot.y * DEG_TO_RAD, z: rot.z * DEG_TO_RAD };
        } catch (e) {}
      }
    }
  } catch (err) {
    console.warn("setEntityTransform fallback failed", err);
  }
}

// Example replacement for applyCommonTransforms (call within equipWeapon)
function applyCommonTransforms(ent, key) {
  // reset to identity-ish
  setEntityTransform(ent, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 });

  switch (key) {
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
      // no-op
      break;
  }
}


// Small vector helpers (plain JS objects)
function plainClone(v) { return { x: v.x || 0, y: v.y || 0, z: v.z || 0 }; }
function plainLength(v) { return Math.sqrt(v.x*v.x + v.y*v.y + v.z*v.z); }
function plainNormalize(v) {
  const L = plainLength(v) || 1;
  return { x: v.x / L, y: v.y / L, z: v.z / L };
}
function plainAdd(a,b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
function plainScale(a, s) { return { x: a.x * s, y: a.y * s, z: a.z * s }; }
function plainCross(a,b) {
  return {
    x: a.y*b.z - a.z*b.y,
    y: a.z*b.x - a.x*b.z,
    z: a.x*b.y - a.y*b.x
  };
}

// applySpread: dirInput may be pc.Vec3, THREE.Vector3, or plain {x,y,z}
// spreadDeg = degrees
function applySpreadToPCVec(dirInput, spreadDeg) {
  if (!dirInput) return new pc.Vec3(0,0,1);
  // convert to plain
  const dirPlain = plainClone(dirInput);
  const dirLen = plainLength(dirPlain);
  if (dirLen === 0) return new pc.Vec3(0,0,1);
  const dir = plainNormalize(dirPlain);

  const spreadRad = (spreadDeg || 0) * Math.PI / 180;
  if (spreadRad <= 0) return new pc.Vec3(dir.x, dir.y, dir.z);

  // pick an 'up' that isn't parallel to dir
  const up = (Math.abs(dir.y) < 0.99) ? { x:0, y:1, z:0 } : { x:1, y:0, z:0 };

  // right = normalize(cross(dir, up))
  let right = plainCross(dir, up);
  if (plainLength(right) === 0) right = { x:1, y:0, z:0 };
  right = plainNormalize(right);

  // realUp = normalize(cross(right, dir))
  let realUp = plainCross(right, dir);
  if (plainLength(realUp) === 0) realUp = { x:0, y:1, z:0 };
  realUp = plainNormalize(realUp);

  // random point in cone using sqrt(random) for uniform distribution
  const theta = Math.random() * 2 * Math.PI;
  const u = Math.random();
  const r = Math.sqrt(u) * Math.tan(spreadRad);

  const offset = plainAdd(plainScale(right, Math.cos(theta) * r), plainScale(realUp, Math.sin(theta) * r));
  const resultPlain = plainNormalize(plainAdd(dir, offset));

  // return a PlayCanvas Vec3
  return new pc.Vec3(resultPlain.x, resultPlain.y, resultPlain.z);
}


/* ---------------------------
   Example usage:

// ensure your PlayCanvas app is in window.playcanvasApp
const wb = new PCWeaponBuilder({ app: window.playcanvasApp, viewModel: window.playcanvasApp.root });

// load and view the AK47
wb.buildAK47().promise.then(({ weaponRoot, parts }) => {
  // optional: add a debug dot at the muzzle
  const dot = addPlaycanvasDebugMuzzleDot(parts.muzzle, 0.02);
  // tweak muzzle position if the dot is not perfectly at the tip:
  // parts.muzzle.translate(0.1, 0.02, 0); // experiment
});

// add a bullet hole:
PCBulletHoleManager.addBulletHole({ x:10, y:1.5, z:-5, nx:0, ny:1, nz:0, timeCreated: Date.now() }, "uniqueKey123");

--------------------------- */



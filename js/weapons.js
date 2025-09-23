

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
    // Validate
    if (!WeaponController.WEAPONS || !WeaponController.WEAPONS[weaponKey]) {
        console.warn(`[WeaponController] Unknown weapon: ${weaponKey}`);
        return;
    }

    const app = this.app || window.playcanvasApp;
    if (!app) console.warn("[WeaponController] playcanvas app not found on this.app or window.playcanvasApp");

    // ---- Save current ammo ----
    if (this.currentKey) {
        this.ammoStore = this.ammoStore || {};
        this.ammoStore[this.currentKey] = this.ammoInMagazine;
    }

    // ---- Helpers: disposal for PlayCanvas resources ----
    // Try to safely destroy a PlayCanvas material and its textures
    const disposeMaterial = (mat) => {
        if (!mat) return;
        try {
            // If model uses meshInstance.material instances, we'll destroy those separately.
            if (typeof mat.destroy === "function") mat.destroy();
        } catch (e) { /* ignore */ }
    };

    // Recursively destroy an entity and attempt to release model/meshInstance materials & textures
    const disposeEntityRecursive = (ent) => {
        if (!ent) return;
        // walk children first
        const children = ent.children ? ent.children.slice() : [];
        for (let ch of children) {
            disposeEntityRecursive(ch);
        }

        // handle model component (destroy meshInstance materials)
        try {
            if (ent.model && ent.model.model && ent.model.model.meshInstances) {
                const mis = ent.model.model.meshInstances;
                for (let mi of mis) {
                    try {
                        if (mi.material) {
                            disposeMaterial(mi.material);
                            // set to null to help GC
                            mi.material = null;
                        }
                    } catch (e) {}
                }
            }
        } catch (e) {}

        // Finally remove/destroy this entity
        try {
            if (ent.parent) ent.parent.removeChild(ent);
        } catch (e) {}
        try {
            // entity.destroy() cleans up components & unlinks resources
            if (typeof ent.destroy === "function") ent.destroy();
        } catch (e) {}
    };

    // Helper to check cached prototype equality
    if (typeof window._pcWeaponInstanceCache === "undefined") window._pcWeaponInstanceCache = {};
    const isCachedInstance = (obj) => {
        if (!obj) return false;
        for (const k in window._pcWeaponInstanceCache) {
            if (window._pcWeaponInstanceCache[k] === obj) return true;
        }
        return false;
    };

    // ---- Cleanup tracer objects (PlayCanvas tracer cleanup: window.activeTracers) ----
    try {
        if (window.activeTracers && Array.isArray(window.activeTracers)) {
            for (let i = window.activeTracers.length - 1; i >= 0; i--) {
                try {
                    const tr = window.activeTracers[i];
                    if (tr && typeof tr.dispose === "function") tr.dispose();
                } catch (e) {}
                window.activeTracers.splice(i, 1);
            }
        }
    } catch (e) { /* ignore */ }

    // ---- Remove & dispose previous viewModel (PlayCanvas entities) ----
    if (this.viewModel) {
        try {
            if (this.viewModel.parent && this.viewModel.parent === this.camera) {
                this.camera.removeChild(this.viewModel);
            } else if (this.viewModel.parent) {
                // detach from any parent gracefully
                this.viewModel.parent.removeChild(this.viewModel);
            }
        } catch (e) {}

        // If weaponModel is a cached instance, we should not destroy shared resources — just detach and hide
        if (this.weaponModel && isCachedInstance(this.weaponModel)) {
            try { this.weaponModel.enabled = false; } catch (e) {}
            try { if (this.weaponModel.parent) this.weaponModel.parent.removeChild(this.weaponModel); } catch (e) {}
            // clear only controller references (cached model stays in window._pcWeaponInstanceCache)
            this.weaponModel = null;
            this.parts = {};
            try { this.viewModel.destroy(); } catch (e) {} // destroy container only
            this.viewModel = null;
        } else {
            // Fully dispose the viewModel and its children
            try { disposeEntityRecursive(this.viewModel); } catch (e) {}
            this.weaponModel = null;
            this.parts = {};
            this.viewModel = null;
        }
    }

    // ---- Reset core state and create fresh viewModel container (PlayCanvas) ----
    this.currentKey = weaponKey;
    this.stats = WeaponController.WEAPONS[weaponKey];
    this.isReloadingFlag = false;
    this.lastShotTime = 0;
    this.burstCount = 0;
    this.speedModifier = this.stats.speedModifier;
    this.ammoStore = this.ammoStore || {};
    this.ammoInMagazine = (this.ammoStore[weaponKey] != null) ? this.ammoStore[weaponKey] : this.stats.magazineSize;

    // fresh state object (mirrors your THREE state fields but using pc.Vec3)
    this.state = {
        pulling: false,
        pullStart: 0,
        pullFrom: new pc.Vec3(),
        pullTo: new pc.Vec3(),
        recoiling: false,
        recoilStart: 0,
        reloading: false,
        reloadStart: 0,
        knifeSwing: false,
        knifeSwingStart: 0,
        knifeHeavy: false,
        tracerObjects: []
    };

    // Create new PlayCanvas container entity to hold the viewmodel
    this.viewModel = new pc.Entity("ViewModelRoot");
    // ensure it has a transform and is ready to be parented to the camera
    this.viewModel.setLocalPosition(0, 0, 0);
    this.viewModel.setLocalEulerAngles(0, 0, 0);
    this.viewModel.setLocalScale(1, 1, 1);

    // helper to attach the player arm or any arm entity you expect
    if (typeof this.createPlayerArm === "function") {
        try { this.createPlayerArm(); } catch (e) { /* ignore */ }
    }

    // ---- Build normalized key and pick source (cached clone or prototype or fallback) ----
    const key = weaponKey.replace(/-/g, "").toLowerCase();
    const proto = window._pcPrototypeModels && window._pcPrototypeModels[key]; // assume you may have set prototypes here

    // ensure parts object is reset
    this.parts = {};

    // Inline attachModel that adapts PlayCanvas entity into our viewModel
    const attachModel = (modelEntity) => {
        if (!modelEntity) return;

        // detach model from any parent
        try { if (modelEntity.parent) modelEntity.parent.removeChild(modelEntity); } catch (e) {}

        // make visible/enabled and add to viewModel
        try {
            modelEntity.enabled = true;
            this.viewModel.addChild(modelEntity);
            this.weaponModel = modelEntity;
        } catch (e) {
            console.warn("[WeaponController] attachModel addChild failed:", e);
        }

        // find muzzle child (traverse)
        let muzzle = null;
        const findMuzzle = (ent) => {
            if (!ent) return;
            if ((ent.name || "") === "Muzzle") { muzzle = ent; return; }
            if (ent.children) {
                for (let ch of ent.children) {
                    if (muzzle) break;
                    findMuzzle(ch);
                }
            }
        };
        findMuzzle(modelEntity);
        if (muzzle) this.parts.muzzle = muzzle;

        // add viewModel to camera
        try {
            if (this.camera && typeof this.camera.addChild === "function") {
                this.camera.addChild(this.viewModel);
            } else if (app && app.root) {
                app.root.addChild(this.viewModel);
            }
        } catch (e) {}

        // set up "pull" state (animation initiation)
        this.state.pulling = true;
        this.state.pullStart = performance.now() / 1000;
        if (this.offPos) this.state.pullFrom.copy(this.offPos);
        if (this.readyPos) this.state.pullTo.copy(this.readyPos);

        // play pull sound if available (assumes HTMLAudio style objects)
        try {
            const pullSnd = this.audio && this.audio[this.currentKey] && this.audio[this.currentKey].pull;
            if (pullSnd) { pullSnd.currentTime = 0; pullSnd.play(); }
            // optional: sendSoundEvent fallback if you have it
            if (typeof sendSoundEvent === "function") {
                const pos = this.camera ? this.camera.getPosition() : new pc.Vec3();
                sendSoundEvent(this.currentKey, "pull", pos);
            }
        } catch (e) {}
        // Update UI (hooks)
        try { if (typeof updateAmmoDisplay === "function") updateAmmoDisplay(this.ammoInMagazine, this.stats.magazineSize); } catch (e) {}
        try { if (typeof updateInventory === "function") updateInventory(this.currentKey); } catch (e) {}
    };

    // ---- If prototype exists, try to get or create cached instance ----
    if (proto) {
        if (!window._pcWeaponInstanceCache[key]) {
            try {
                // attempt deep clone
                const cached = proto.clone(true);
                cached.enabled = false;
                try { if (cached.parent) cached.parent.removeChild(cached); } catch (e) {}
                window._pcWeaponInstanceCache[key] = cached;
            } catch (e) {
                console.warn(`[WeaponController] Failed to clone proto for ${key}:`, e);
                window._pcWeaponInstanceCache[key] = null;
            }
        }

        const cachedInstance = window._pcWeaponInstanceCache[key];

        if (cachedInstance) {
            // Reset transforms (local)
            try {
                cachedInstance.setLocalScale(1, 1, 1);
                cachedInstance.setLocalEulerAngles(0, 0, 0);
                cachedInstance.setLocalPosition(0, 0, 0);
            } catch (e) {}

            // apply per-weapon transforms (using PlayCanvas methods)
            switch (key) {
                case "knife":
                    cachedInstance.setLocalScale(0.001, 0.001, 0.001);
                    cachedInstance.setLocalEulerAngles(90, 160, 0);
                    cachedInstance.setLocalPosition(0.5, -0.1, -0.7);
                    break;
                case "deagle":
                case "legion":
                case "m79":
                    cachedInstance.setLocalScale(0.3, 0.3, 0.3);
                    cachedInstance.setLocalEulerAngles(7, 180, 0);
                    cachedInstance.setLocalPosition(
                        0.15 * (window.innerWidth / 1920),
                        0.10 * (window.innerHeight / 1080),
                        -0.1 * (window.innerWidth / 1920)
                    );
                    break;
                case "ak47":
                    cachedInstance.setLocalScale(0.4, 0.4, 0.4);
                    cachedInstance.setLocalEulerAngles(4, 180, 0);
                    cachedInstance.setLocalPosition(
                        0.35 * (window.innerWidth / 1920),
                        -0.15 * (window.innerHeight / 1080),
                        -0.3 * (window.innerWidth / 1920)
                    );
                    break;
                case "viper":
                    cachedInstance.setLocalScale(0.4, 0.4, 0.4);
                    cachedInstance.setLocalEulerAngles(4, 180, 0);
                    cachedInstance.setLocalPosition(
                        0.35 * (window.innerWidth / 1920),
                        -0.15 * (window.innerHeight / 1080),
                        0
                    );
                    break;
                case "marshal":
                    cachedInstance.setLocalScale(1, 1, 1);
                    cachedInstance.setLocalEulerAngles(0, 0, 0);
                    cachedInstance.setLocalPosition(
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
            // fallback: use PCWeaponBuilder to build
            console.warn(`[WeaponController] cached proto missing for "${key}" → falling back to PCWeaponBuilder.`);
            const builder = new PCWeaponBuilder({ app, viewModel: this.viewModel });
            // choose appropriate builder call
            let result;
            switch (key) {
                case "knife": result = builder.buildKnife(); break;
                case "deagle": result = builder.buildDeagle(); break;
                case "legion": result = builder.buildLegion(); break;
                case "ak47": result = builder.buildAK47(); break;
                case "marshal": result = builder.buildMarshal(); break;
                case "viper": result = builder.buildViper(); break;
                case "m79": result = builder.buildM79(); break;
                default: result = null; break;
            }
            if (result && result.promise) {
                result.promise.then(({ weaponRoot, parts }) => {
                    // PCWeaponBuilder returns { weaponRoot, parts } in this implementation
                    // attach weaponRoot to viewModel
                    attachModel(weaponRoot);
                    // store parts if provided
                    if (parts) this.parts = parts;
                }).catch(err => {
                    console.error("[WeaponController] builder failed:", err);
                });
            } else {
                console.error(`[WeaponController] No build method for "${key}"`);
            }
        }
    } else {
        // No prototype at all — attempt builder
        console.warn(`[WeaponController] Prototype for "${key}" missing → running PCWeaponBuilder fallback.`);
        const builder = new PCWeaponBuilder({ app, viewModel: this.viewModel });
        let result;
        switch (key) {
            case "knife": result = builder.buildKnife(); break;
            case "deagle": result = builder.buildDeagle(); break;
            case "legion": result = builder.buildLegion(); break;
            case "ak47": result = builder.buildAK47(); break;
            case "marshal": result = builder.buildMarshal(); break;
            case "viper": result = builder.buildViper(); break;
            case "m79": result = builder.buildM79(); break;
            default: result = null; break;
        }
        if (result && result.promise) {
            result.promise.then(({ weaponRoot, parts }) => {
                attachModel(weaponRoot);
                if (parts) this.parts = parts;
            }).catch(err => {
                console.error("[WeaponController] builder failed:", err);
            });
        } else {
            console.error(`[WeaponController] No build method for "${key}"`);
        }
    }
} // end equipWeapon









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
      this.app = opts.app || DEFAULT_APP();
      this.viewModel = opts.viewModel || null; // parent entity for weapon view-models
      if (!this.app) console.warn("PCWeaponBuilder: PlayCanvas app not found. You'll need to provide it via opts.app or window.playcanvasApp.");
    }

    // utility: load a glb container and instantiate a root entity
    _loadGlb = (url) => {
      const app = this.app;
      return new Promise((res, rej) => {
        if (!app) return rej(new Error("PlayCanvas app not available"));
        app.assets.loadFromUrl(url, "container", (err, asset) => {
          if (err) return rej(err);
          // instantiate render entity group
          const container = asset.resource; // pc.ContainerResource
          const inst = container.instantiateRenderEntity();
          // The instantiated container returns a top-level entity (group). We return that.
          res(inst);
        });
      });
    }

    // heuristic: compute combined AABB for a model entity (works with container-instantiated entity)
    _computeCombinedAabb = (rootEntity) => {
      // Walk children and gather meshInstances aabb if present
      const INF = Number.POSITIVE_INFINITY;
      const min = new pc.Vec3(INF, INF, INF);
      const max = new pc.Vec3(-INF, -INF, -INF);
      let found = false;

      // recursive traverse
      const walk = (ent) => {
        if (!ent) return;
        // model component -> model -> meshInstances
        if (ent.model && ent.model.model && ent.model.model.meshInstances) {
          const mis = ent.model.model.meshInstances;
          for (let mi of mis) {
            if (mi.aabb) {
              // aabb is in node-local space; we approximate by using mi.node.getWorldTransform
              const aabbMin = mi.aabb.getMin();
              const aabbMax = mi.aabb.getMax();
              // transform corners by world transform of the node to get world-space approx
              const node = mi.node || ent;
              const wt = node.getWorldTransform(); // pc.Mat4
              const corners = [
                new pc.Vec3(aabbMin.x, aabbMin.y, aabbMin.z),
                new pc.Vec3(aabbMax.x, aabbMin.y, aabbMin.z),
                new pc.Vec3(aabbMin.x, aabbMax.y, aabbMin.z),
                new pc.Vec3(aabbMin.x, aabbMin.y, aabbMax.z),
                new pc.Vec3(aabbMax.x, aabbMax.y, aabbMin.z),
                new pc.Vec3(aabbMax.x, aabbMin.y, aabbMax.z),
                new pc.Vec3(aabbMin.x, aabbMax.y, aabbMax.z),
                new pc.Vec3(aabbMax.x, aabbMax.y, aabbMax.z),
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
        // children
        const children = ent.children ? ent.children.slice() : [];
        for (let ch of children) walk(ch);
      };

      walk(rootEntity);

      if (!found) return null;
      return { min, max, center: new pc.Vec3((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2) };
    }

    // generic loader pattern used by specific weapon builders
    _buildGeneric(url, opts = {}) {
      let progCb = () => {};
      const promise = this._loadGlb(url).then((entity) => {
        // `entity` is group root
        const weaponRoot = new pc.Entity("weaponModel");
        weaponRoot.addChild(entity);

        // optional parent
        if (this.viewModel) this.viewModel.addChild(weaponRoot);
        else if (this.app && this.app.root) this.app.root.addChild(weaponRoot);

        // compute bounding box and center the model so rotation origin is sensible
        const aabb = this._computeCombinedAabb(entity);
        if (aabb && entity.translate) {
          // shift entity so center is at origin (local transform)
          const center = aabb.center;
          // compute world->local offset: transform world center into rootEntity local space
          const inv = new pc.Mat4();
          entity.getLocalTransform().invert(inv); // may fail for some nodes but attempt
          const localCenter = inv.transformPoint(center);
          entity.translate(-localCenter.x, -localCenter.y, -localCenter.z);
        }

        // attempt to create a muzzle point using AABB max
        const parts = {};
        const aabb2 = this._computeCombinedAabb(entity);
        const muzzle = new pc.Entity("Muzzle");
        muzzle.setLocalPosition(0, 0, 0);
        weaponRoot.addChild(muzzle);
        parts.muzzle = muzzle;

        if (aabb2) {
          // put muzzle at the max corner in world space, then convert to weaponRoot local
          const worldMax = aabb2.max;
          // convert worldMax into weaponRoot local space
          const invRoot = weaponRoot.getWorldTransform().invert();
          const local = invRoot.transformPoint(worldMax);
          muzzle.setLocalPosition(local.x, local.y, local.z);
        } else {
          // default small offset forward (user will adjust)
          muzzle.setLocalPosition(0, 0.5, 0);
        }

        // find named parts heuristically (blade, handle, etc.)
        const names = { blade: ["ater", "blade", "blade"], handle: ["ahva", "handle", "grip"], ring: ["sormensi", "ring", "guard"] };
        const search = (ent) => {
          if (!ent) return;
          const n = (ent.name || "").toLowerCase();
          if (n) {
            if (!parts.blade && (n.includes("ater") || n.includes("blade") || n.includes("blade"))) parts.blade = ent;
            if (!parts.handle && (n.includes("ahva") || n.includes("handle") || n.includes("grip"))) parts.handle = ent;
            if (!parts.ring && (n.includes("sormensi") || n.includes("ring") || n.includes("guard"))) parts.ring = ent;
          }
          if (ent.children) for (let ch of ent.children) search(ch);
        };
        search(entity);

        // make small performance/visibility defaults
        weaponRoot.enabled = true;

        return { weaponRoot, parts };
      });

      return {
        promise,
        register: (cb) => { progCb = cb; } // placeholder for parity with your original API
      };
    }

    // Concrete builders matching original names (URLs copied from your snippet)
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



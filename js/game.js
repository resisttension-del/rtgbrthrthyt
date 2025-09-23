// js/game.js

import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";
import { EffectComposer } from "https://cdn.jsdelivr.net/npm/three@0.152.0/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass }     from "https://cdn.jsdelivr.net/npm/three@0.152.0/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "https://cdn.jsdelivr.net/npm/three@0.152.0/examples/jsm/postprocessing/UnrealBloomPass.js";
import { currentKeybinds, isChatting } from "./input.js";
import { ShaderPass } from "https://cdn.jsdelivr.net/npm/three@0.152.0/examples/jsm/postprocessing/ShaderPass.js";
import { CopyShader } from "https://cdn.jsdelivr.net/npm/three@0.152.0/examples/jsm/shaders/CopyShader.js";
import Stats from 'stats.js';
import { dbRefs, disposeGame, fullCleanup, activeGameId, setupDamageListener } from "./network.js";
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { voidEngine } from './VoidEngine.js';
import {
    computeBoundsTree,
    disposeBoundsTree,
    acceleratedRaycast,
    MeshBVH, // <--- Added MeshBVH import
    MeshBVHHelper,
    StaticGeometryGenerator
} from 'https://cdn.jsdelivr.net/npm/three-mesh-bvh@0.9.1/+esm';

// ffffffffffffffffffffffffffff
// ─── BVH Setup ────────────────────────────────────────────────────────────
// Extend THREE.BufferGeometry and THREE.Mesh prototypes for BVH functionality
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

import { createDiddyDunes, createSigmaCity, createCrocodilosConstruction } from "./map.js";

import { initNetwork, sendPlayerUpdate, localPlayerId, remotePlayers, updateHealth, updateShield, initializeAudioManager, startSoundListener, disconnectPlayer, setupPlayersListener } from "./network.js";
import { claimGameSlot, releaseGameSlot, getSlotNameForGameId } from './firebase-config.js';
import { initMenuUI } from "./menu.js";
import {
initChatUI,
addChatMessage,
updateKillFeed,
updateScoreboard,
initBulletHoles,
initInventory,
updateInventory,
initAmmoDisplay,
updateAmmoDisplay,
createHealthBar,
updateHealthShieldUI,
createTracer,
uiDbRefs
} from "./ui.js";

import { usersRef } from './firebase-config.js';

import { initInput, inputState, postFrameCleanup, handleWeaponSwitch } from "./input.js";
import { PhysicsController } from "./physics.js";
import { WeaponController, _prototypeModels, getWeaponModel, activeTracers }  from "./weapons.js";
let detailsEnabled;
let renderPass;
const bodyColor = Math.floor(Math.random() * 0xffffff);

const FIXED_WIDTH  = 1920;
const FIXED_HEIGHT = 1080;



let scene, camera, renderer, composer, bloomPass, fog;
window.camera = window.camera || new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
window.scene = window.scene || new THREE.Scene();


// f
let dirLight, hemi;
let localPlayer = null;
let physicsController;
let weaponController;
let spawnPoints = [];
let skyMesh, starField;

export const KILLSTREAK_SOUNDS = {
1:  'https://codehs.com/uploads/5626b4ea9d389c0936a1971b1f3a6beb',
2:  'https://codehs.com/uploads/3b7b1aa5c4a9f532aa16ac0d7f4ffdb5',
3:  'https://codehs.com/uploads/81976fee406a0346b5b75de70c7e2c0e',
4:  'https://codehs.com/uploads/b337a894983ddc58e778bdb76eb0efe4',
5:  'https://codehs.com/uploads/03edb8ea396418fbc3630d1262c7e991',
6:  'https://codehs.com/uploads/413cb56b57597f40aa223dc6488eecca',
7:  'https://codehs.com/uploads/f4bca7128545c430257bc59d0c169e45',
8:  'https://codehs.com/uploads/373998fa75359ae1ca6462fe1b023bf7',
9:  'https://codehs.com/uploads/bac5a38abad4d17c00f7adf629af9063',
10: 'https://codehs.com/uploads/c2645a73d7b76fa17634d8a4f2ffd15a'
};
let chatInput;
let respawnOverlay = null;
let respawnButton  = null;
let fadeOverlay    = null;
let playersKillsListener = null;
let sceneNum = 0;

let deathTheme = new Audio("https://codehs.com/uploads/720078943b931e7eb258b01fb10f1fba");
deathTheme.loop = true;
deathTheme.volume = 0.5;

const windSound = new Audio(
"https://codehs.com/uploads/91aa5e56fc63838b4bdc06f596849daa"
);
windSound.loop   = true;
windSound.volume = 0.1;

const dessertWindSound = new Audio(
"https://codehs.com/uploads/37a04df493b1a86c91ccccc53c7a09d4"
);
dessertWindSound.loop   = true;
dessertWindSound.volume = 0.25;

const forestNoise = new Audio(
"https://codehs.com/uploads/e26ad4fc80829f48ecd9b470fe84987d"
);
forestNoise.loop   = true;
forestNoise.volume = 0.15;


const bulletHoleMeshes = {};

const initialPlayerHealth = 100;
const initialPlayerShield = 50;
const initialPlayerWeapon = "knife";

window.remotePlayers = {};
window.collidables    = [];
window.envMeshes      = [];

let chatPruneInterval       = null;
let killsPruneInterval      = null;
let activeRecoils           = [];
let weaponAmmo              = {};
let playerVisibilityTimeouts = {};

let playersRef = null;
let chatRef = null;
let killsRef = null;
let mapStateRef = null;
let gameConfigRef  = null;    // ← add this


let gameEndTime   = null;   // will be fetched from gameConfigRef
let gameInterval  = null;   // ID returned by setInterval()

let manager;


export function initGlobalFogAndShadowParams() {

  window.originalFogParams = {

    type:    "exp2",

    color:   0x888888,

    density: 0.015

  };

}

function createFog() {
const fp = originalFogParams;
if (fp.type === "exp2") {
window.scene.fog = new THREE.FogExp2(fp.color, fp.density);
} else if (fp.type === "linear") {
window.scene.fog = new THREE.Fog(fp.color, fp.near, fp.far);
} else {
window.scene.fog = null; // No fog
}
}

function destroyFog() {
window.scene.fog = null;
}

function enableShadows() {
if (!dirLight) {
dirLight = new THREE.DirectionalLight(0xffffff, 0.8); // Color, intensity
dirLight.position.set(50, 200, 100); // Position the light
dirLight.castShadow = true;

// Shadow map settings (adjust resolution and camera frustum for your scene)
dirLight.shadow.mapSize.width = 2048; // Higher resolution for better shadows
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 500; // Far plane for shadow camera
dirLight.shadow.camera.left = -200;
dirLight.shadow.camera.right = 200;
dirLight.shadow.camera.top = 200;
dirLight.shadow.camera.bottom = -200;
// dirLight.shadow.bias = -0.001; // Adjust bias to fight shadow acne if needed

window.scene.add(dirLight);
}
dirLight.castShadow = true; // Ensure castShadow is true
if (renderer) { // Check if renderer is initialized
renderer.shadowMap.enabled = true;
}
}

function disableShadows() {
if (dirLight) {
dirLight.castShadow = false; // Disable casting
window.scene.remove(dirLight); // Remove from scene
dirLight.dispose(); // Release resources
dirLight = null; // Set to null for re-creation
}
if (renderer) { // Check if renderer is initialized
renderer.shadowMap.enabled = false;
}
}

function createBloom() {
// Ensure composer and renderPass are initialized
if (!composer || !renderPass) {
console.warn("Composer or RenderPass not initialized. Cannot create Bloom.");
return;
}
if (!bloomPass) { // Only create if it doesn't exist
bloomPass = new UnrealBloomPass(
new THREE.Vector2(window.innerWidth, window.innerHeight), // Use window dimensions for bloom
originalBloomStrength, // Use the stored original strength
1, // Radius
0.6 // Threshold
);
composer.addPass(bloomPass);
}
}

function destroyBloom() {
if (bloomPass && composer) {
composer.removePass(bloomPass);
bloomPass.dispose(); // Release resources
bloomPass = null;
}
}

async function determineWinnerAndEndGame() {
    console.log("Determining winner and ending game...");
    if (!playersRef) {
        console.error("determineWinnerAndEndGame: playersRef is NULL");
        return;
    }

    const playersSnapshot = await playersRef.once("value");
    const statsByUser = {};
    playersSnapshot.forEach(childSnap => {
        const p = childSnap.val();
        if (!p || typeof p.kills !== 'number') return;
        // use the username as stored in DB (canonical form)
        statsByUser[p.username] = {
            kills: p.kills || 0,
            deaths: p.deaths || 0,
            win: 0,
            loss: 0
        };
    });

    const allStats = Object.values(statsByUser);
    if (allStats.length === 0) {
        console.log("No players found");
    } else {
        const maxKills = Math.max(...allStats.map(s => s.kills));
        if (maxKills > 0) {
            const winners = Object.entries(statsByUser)
                .filter(([_, s]) => s.kills === maxKills)
                .map(([u]) => u);
            for (const username of winners) {
                statsByUser[username].win = 1;
            }
            for (const [username, s] of Object.entries(statsByUser)) {
                if (!winners.includes(username)) {
                    s.loss = 1;
                }
            }
            const display = winners.length > 1 ? winners.join(", ") : winners[0];
            console.log(`WINNER${winners.length > 1 ? "S" : ""}: ${display} (${maxKills} kills)`);
            localStorage.setItem('gameWinner', JSON.stringify({ winners, kills: maxKills }));
            localStorage.setItem('gameEndedTimestamp', Date.now().toString());
            const gameTimerEl = document.getElementById("game-timer");
            if (gameTimerEl) {
                gameTimerEl.textContent = `WINNER${winners.length > 1 ? "S" : ""}: ${display}`;
                gameTimerEl.style.display = "block";
            }
        } else {
            console.log("No kills recorded, no winners or losers");
            localStorage.removeItem('gameWinner');
            localStorage.removeItem('gameEndedTimestamp');
        }
    }

    // ⭐ Only increment stats for the local player — but resolve the canonical username
    const statUpdates = [];
    if (window.localPlayer && window.localPlayer.username) {
        const provided = String(window.localPlayer.username).trim();
        if (provided !== "") {
            const providedLower = provided.toLowerCase();

            // Find the canonical username key that matches case-insensitively
            const canonical = Object.keys(statsByUser).find(k => String(k).toLowerCase() === providedLower);

            if (!canonical) {
                // If we couldn't find a match among the players, do NOT create a user or increment anything.
                console.warn(`[determineWinnerAndEndGame] Local player username '${provided}' not found among players (case-insensitive). Skipping stat increment to avoid creating new user.`);
            } else {
                const localPlayerStats = statsByUser[canonical];
                if (localPlayerStats) {
                    if (localPlayerStats.win === 1) {
                        statUpdates.push(incrementUserStat(canonical, 'wins', 1));
                    }
                    if (localPlayerStats.loss === 1) {
                        statUpdates.push(incrementUserStat(canonical, 'losses', 1));
                    }
                }
            }
        } else {
            console.warn('[determineWinnerAndEndGame] window.localPlayer.username is empty after trim.');
        }
    }

    // await all stat updates (no-op if statUpdates is empty)
    try {
        await Promise.all(statUpdates);
    } catch (e) {
        console.error('Error while incrementing local player stats:', e);
    }

    try {
        await gameConfigRef.remove();
        console.log("Game config fully removed.");
    } catch (e) {
        console.error("Failed to remove gameConfig:", e);
    }

    if (playersKillsListener) {
        playersRef.off("value", playersKillsListener);
        playersKillsListener = null;
        console.log("Detached players kill listener.");
    }

    setTimeout(function() {
      disconnectPlayer(localPlayerId);
      location.reload();
    }, 2000);
}

window.determineWinnerAndEndGame = determineWinnerAndEndGame;

document.addEventListener('DOMContentLoaded', () => {
  const stored = localStorage.getItem('gameWinner');
  if (stored) {
    try {
      const { winners, kills } = JSON.parse(stored);
      const msgEl = document.getElementById('game-over-message');
      if (msgEl) {
        const label = winners.length > 1 ? "Winners" : "Winner";
        msgEl.textContent = `Game Over! ${label}: ${winners.join(", ")} with ${kills} kills!`;
        msgEl.style.display = 'block';
      }
      localStorage.removeItem('gameWinner');
      localStorage.removeItem('gameEndedTimestamp');
    } catch {
      localStorage.removeItem('gameWinner');
      localStorage.removeItem('gameEndedTimestamp');
    }
  }
});


function createStars() {
if (sceneNum !== 1) return; // Only create for CrocodilosConstruction

console.log("Creating stars for CrocodilosConstruction...");
if (starField) return; // Already created

const starCount = 1000;
const positions = new Float32Array(starCount * 3);

for (let i = 0; i < starCount; i++) {
const theta = Math.random() * 2 * Math.PI;
const phi = Math.acos(2 * Math.random() - 1);
const r = 90 + Math.random() * 100;

positions[3 * i] = r * Math.sin(phi) * Math.cos(theta);
positions[3 * i + 1] = r * Math.sin(phi) * Math.sin(theta);
positions[3 * i + 2] = r * Math.cos(phi);
}

const starsGeo = new THREE.BufferGeometry().setAttribute(
"position",
new THREE.BufferAttribute(positions, 3)
);
const starsMat = new THREE.PointsMaterial({
color: 0xeeeeff,
size: 0.5,
sizeAttenuation: true,
fog: false // Stars should ignore fog
});
starField = new THREE.Points(starsGeo, starsMat);
scene.add(starField);
}

/**
* Destroys the stars specifically for CrocodilosConstruction.
*/
function destroyStars() {
if (starField) {
console.log("Destroying stars for CrocodilosConstruction...");
scene.remove(starField);
starField.geometry.dispose();
starField.material.dispose();
starField = null;
}
}

/**
* Creates the fog dots specifically for CrocodilosConstruction.
*/
function createFogDots() {
if (sceneNum !== 1) return; // Only create for CrocodilosConstruction

console.log("Creating fog dots for CrocodilosConstruction...");
if (worldFog) return; // Already created

const BOUNDS = { x: 100, y: 20, z: 100 };
const fogCount = 5000;
const fogGeo = new THREE.BufferGeometry();
const pos = new Float32Array(fogCount * 3);

for (let i = 0; i < fogCount; i++) {
pos[3 * i] = (Math.random() * 2 - 1) * BOUNDS.x;
pos[3 * i + 1] = Math.random() * BOUNDS.y;
pos[3 * i + 2] = (Math.random() * 2 - 1) * BOUNDS.z;
}

fogGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
const fogMat = new THREE.PointsMaterial({
color: 0xcccccc,
size: 0.2,
transparent: true,
opacity: 0.3,
sizeAttenuation: true,
fog: true // Fog dots should be affected by fog
});
worldFog = new THREE.Points(fogGeo, fogMat);
scene.add(worldFog);
window.worldFog = worldFog; // Keep window.worldFog updated
}

/**
* Destroys the fog dots specifically for CrocodilosConstruction.
*/
function destroyFogDots() {
if (worldFog) {
console.log("Destroying fog dots for CrocodilosConstruction...");
scene.remove(worldFog);
worldFog.geometry.dispose();
worldFog.material.dispose();
worldFog = null;
}
}

// --- Main toggle function (exported for main.js to call) ---

/**
* Toggles the creation/destruction of scene details like fog, shadows, bloom, stars, and fog dots.
* This function is now intelligent about which scene is active.
* @param {boolean} isOn - True to enable details, false to disable.
*/
export function toggleSceneDetails(isOn) {
if (isOn !== detailsEnabled) {
detailsEnabled = isOn; // Update internal state

if (isOn) {
console.log("Enabling scene details...");
// Universal details
createFog();
enableShadows();
createBloom();

// Scene-specific details
if (sceneNum === 1) { // CrocodilosConstruction specific
createStars();
createFogDots();
}
// SigmaCity doesn't have unique details beyond universal ones, so no 'else if (sceneNum === 2)' needed here
} else {
console.log("Disabling scene details...");
// Universal details
destroyFog();
disableShadows();
destroyBloom();

// Scene-specific details
if (sceneNum === 1) { //CrocodilosConstruction specific
destroyStars();
destroyFogDots();
}
}
}
}


// Crosshair

const BASE_GAP      = 2;
const SPREAD_SCALAR = 50;

export function updateCrosshair(spreadAngle) {
if (window.localPlayer?.isDead) return;

const gap = BASE_GAP + spreadAngle * SPREAD_SCALAR;

const up    = document.getElementById("line-up");
const down  = document.getElementById("line-down");
const left  = document.getElementById("line-left");
const right = document.getElementById("line-right");

up.style.top    = `${-gap - up.clientHeight}px`;
down.style.top  = `${gap}px`;
left.style.left = `${-gap - left.clientWidth}px`;
right.style.left= `${gap}px`;

document.getElementById("crosshair").style.display = "";
}

// Hit Pulse

const pendingRestore = {};
const originalColor   = {};

export async function pulsePlayerHit(victimId) {
  const playerRef = playersRef.child(victimId);
  const flashColor = 0xff0000;
  const PULSE_MS   = 200;

  // --- 0) Ensure we have the "original" color cached ---
  if (typeof originalColor[victimId] !== 'number') {
    try {
      // Prefer DB field originalBodyColor
      const origSnap = await playerRef.child('originalBodyColor').once('value');
      const origVal = origSnap.val();

      if (typeof origVal === 'number') {
        originalColor[victimId] = origVal;
      } else if (victimId === localPlayerId && window.localPlayer && typeof window.localPlayer.originalBodyColor === 'number') {
        // local player's original is available on the client
        originalColor[victimId] = window.localPlayer.originalBodyColor;
        // best-effort: ensure DB has it too
        try {
          await playerRef.update({ originalBodyColor: originalColor[victimId] });
        } catch (e) {
          console.warn('[pulsePlayerHit] could not write originalBodyColor for local player:', e);
        }
      } else {
        // DB missing originalBodyColor: fall back to reading current bodyColor and initialize originalBodyColor in DB
        const curSnap = await playerRef.child('bodyColor').once('value');
        const curVal = curSnap.val();
        if (typeof curVal === 'number') {
          originalColor[victimId] = curVal;
          // Best-effort write so future clients/readers can use the DB-stored original
          try {
            await playerRef.update({ originalBodyColor: curVal });
          } catch (e) {
            console.warn('[pulsePlayerHit] unable to persist originalBodyColor to DB (best-effort):', e);
          }
        } else {
          console.warn(`[pulsePlayerHit] Can't flash ${victimId}, no numeric original or bodyColor available:`, curVal);
          return;
        }
      }
    } catch (err) {
      console.error('[pulsePlayerHit] Error retrieving originalBodyColor/bodyColor:', err);
      return;
    }
  }

  // --- 1) Cancel any pending restore so repeated hits keep the flash visible ---
  if (pendingRestore[victimId]) {
    clearTimeout(pendingRestore[victimId]);
  }

  // --- 2) Flash RED immediately (best-effort) ---
  try {
    await playerRef.update({ bodyColor: flashColor });
  } catch (err) {
    console.error('[pulsePlayerHit] Error flashing RED:', err);
    // continue to schedule restore even if flashing failed
  }

  // --- 3) Schedule restore after PULSE_MS, but only if the current color isn't already the original ---
  pendingRestore[victimId] = setTimeout(async () => {
    const orig = originalColor[victimId];
    if (typeof orig !== 'number') {
      delete pendingRestore[victimId];
      return;
    }

    try {
      const curSnap = await playerRef.child('bodyColor').once('value');
      const cur = curSnap.val();

      // restore only when the current color differs from desired original
      if (cur !== orig) {
        await playerRef.update({ bodyColor: orig });
      }
    } catch (err) {
      console.error('[pulsePlayerHit] Error restoring color:', err);
    }

    delete pendingRestore[victimId];
    // keep originalColor cached for future hits
  }, PULSE_MS);
}





// Game Start
export async function startGame(username, mapName, initialDetailsEnabled, ffaEnabled, gameId) {
    const networkOk = await initNetwork(username, mapName, gameId, ffaEnabled);
    if (!networkOk) return;

    // These references are now correctly set within the createGameButtonHit function
    playersRef = dbRefs.playersRef;
    gameConfigRef = dbRefs.gameConfigRef;

    const gameTimerElement = document.getElementById('game-timer');



    
    // The rest of your startGame function remains the same
    initGlobalFogAndShadowParams();
    window.isGamePaused = false;
    document.getElementById('menu-overlay').style.display = 'none';
    document.body.classList.add('game-active');
    document.getElementById('game-container').style.display = 'block';
    document.getElementById('hud').style.display = 'block';
    document.getElementById('crosshair').style.display = 'block';

    if (!localPlayerId) return;

    window.physicsController = new PhysicsController(window.camera, scene);
    physicsController = window.physicsController;
    weaponController = new WeaponController(
        window.camera,
        dbRefs.playersRef,
        dbRefs.mapStateRef.child('bullets'),
        createTracer,
        localPlayerId,
        physicsController
    );
    window.weaponController = weaponController;

    if (mapName === 'CrocodilosConstruction') {
        await initSceneCrocodilosConstruction();
    } else if (mapName === 'SigmaCity') {
        await initSceneSigmaCity();
    } else if (mapName === 'DiddyDunes') {
        await initSceneDiddyDunes();
    }

    initInput();
    initChatUI();
    initBulletHoles();
    initializeAudioManager(window.camera, scene);
    startSoundListener();


const initialBodyColor = Math.floor(Math.random() * 0xffffff);

window.localPlayer = {
    id: localPlayerId,
    username,
    x: 0,
    y: 1000,
    z: 0,
    rotY: 0,
    health: initialPlayerHealth,
    shield: initialPlayerShield,
    weapon: initialPlayerWeapon,
    kills: 0,
    deaths: 0,
    ks: 0,
    bodyColor: initialBodyColor,
    originalBodyColor: initialBodyColor, // <-- add this
    isDead: false
};

    await dbRefs.playersRef.child(localPlayerId).set({
        ...window.localPlayer
    });
    updateHealthShieldUI(window.localPlayer.health, window.localPlayer.shield);
    weaponController.equipWeapon(window.localPlayer.weapon);
    initInventory(window.localPlayer.weapon);
    initAmmoDisplay(window.localPlayer.weapon, weaponController.getMaxAmmo());
    updateInventory(window.localPlayer.weapon);
    updateAmmoDisplay(weaponController.ammoInMagazine, weaponController.stats.magazineSize);

    createRespawnOverlay();
    createFadeOverlay();
    animate();
    setupPlayersListener(playersRef);
    updateScoreboard(playersRef);



    if (ffaEnabled) {
      gameTimerElement.style.display = 'block';
    
      let currentRemainingSeconds = null;
      let gameEnded = false;
      let uiInterval = null;
    
      // --- NO owner election here. menu app will elect & update gameDuration ---
      const durationRef = gameConfigRef.child('gameDuration');
      durationRef.on('value', snap => {
        const val = snap.val();
        if (typeof val === 'number') {
          currentRemainingSeconds = val;
        }
      });
    
      const endedRef = gameConfigRef.child('ended');
      endedRef.on('value', snap => {
        if (snap.val() === true && !gameEnded) {
          gameEnded = true;
          if (uiInterval) clearInterval(uiInterval);
          durationRef.off();
          endedRef.off();
          gameTimerElement.textContent = 'TIME UP!';
          determineWinnerAndEndGame();
        }
      });
    
      uiInterval = setInterval(() => {
        if (currentRemainingSeconds == null) {
          gameTimerElement.textContent = 'Time: Syncing…';
        } else {
          const mins = Math.floor(currentRemainingSeconds / 60);
          const secs = currentRemainingSeconds % 60;
          gameTimerElement.textContent = `Time: ${mins}:${secs < 10 ? '0' : ''}${secs}`;
        }
      }, 250);
    
      // keep your kills-based early end logic
      if (playersKillsListener) {
        playersRef.off('value', playersKillsListener);
      }
      playersKillsListener = playersRef.on('value', snap => {
        let reached = false;
        snap.forEach(childSnap => {
          if (childSnap.val().kills >= 40) reached = true;
        });
        if (reached && !gameEnded) {
          endedRef.set(true);
        }
      });
    
    } else {
        gameTimerElement.style.display = 'none';
        if (gameInterval) clearInterval(gameInterval);
        gameConfigRef.remove();
    }


    
        const spawn = findFurthestSpawn();
        window.camera.position.copy(spawn).add(new THREE.Vector3(0, 1.6, 0));
    createLeaderboardOverlay();
    
}

export function hideGameUI() {
  document.getElementById("menu-overlay").style.display = "flex";
  document.body.classList.remove("game-active");
}

function setupDetailToggle() {
  const btn = document.getElementById("toggle-details-btn");
  if (!btn) return;

  btn.addEventListener("click", () => {
    detailsEnabled = !detailsEnabled;

    if (detailsEnabled) {
      const fp = window.originalFogParams;
      if (fp.type === "exp2") {
        scene.fog = new THREE.FogExp2(fp.color, fp.density);
      } else {
        scene.fog = new THREE.Fog(fp.color, fp.near, fp.far);
      }
      renderer.shadowMap.enabled = true;
      dirLight.castShadow      = true;
      window.bloomPass.strength = window.originalBloomStrength;
      btn.textContent           = "Details: On";
    } else {
      scene.fog                = null;
      renderer.shadowMap.enabled = false;
      dirLight.castShadow        = false;
      window.bloomPass.strength   = 0;
      btn.textContent             = "Details: Off";
    }
  });

  btn.textContent = detailsEnabled ? "Details: On" : "Details: Off";
  
}





// PlayCanvas conversion of your render + scene init
// Assumes your existing game objects/controllers (physicsController, weaponController, etc)
// remain the same and just receive/return plain JS objects (position/rotation etc).

// --- Utilities: helpers that work with either three.js object or playcanvas entity ---
function getPosition(obj) {
  if (!obj) return { x: 0, y: 0, z: 0 };
  // PlayCanvas entity (has getPosition)
  if (typeof obj.getPosition === "function") {
    const v = obj.getPosition();
    return { x: v.x, y: v.y, z: v.z };
  }
  // Three.js style
  if (obj.position) return { x: obj.position.x, y: obj.position.y, z: obj.position.z };
  // plain object fallback
  return { x: obj.x || 0, y: obj.y || 0, z: obj.z || 0 };
}
function setPosition(obj, p) {
  if (!obj) return;
  if (typeof obj.setPosition === "function") return obj.setPosition(p.x, p.y, p.z);
  if (obj.position) {
    obj.position.x = p.x; obj.position.y = p.y; obj.position.z = p.z;
  } else {
    obj.x = p.x; obj.y = p.y; obj.z = p.z;
  }
}
function getEuler(obj) {
  // returns { x, y, z } in radians
  if (!obj) return { x: 0, y: 0, z: 0 };
  if (typeof obj.getLocalEulerAngles === "function") {
    const e = obj.getLocalEulerAngles();
    // PlayCanvas gives degrees, convert to radians
    return { x: e.x * Math.PI / 180, y: e.y * Math.PI / 180, z: e.z * Math.PI / 180 };
  }
  if (obj.rotation) {
    // Three.js Euler or Quaternion case
    if (obj.rotation.x != null) return { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z };
    // quaternion fallback (not handled here)
  }
  return { x: 0, y: 0, z: 0 };
}
function setEuler(obj, e) {
  if (!obj) return;
  if (typeof obj.setLocalEulerAngles === "function") {
    // PlayCanvas expects degrees
    obj.setLocalEulerAngles(e.x * 180 / Math.PI, e.y * 180 / Math.PI, e.z * 180 / Math.PI);
    return;
  }
  if (obj.rotation) {
    obj.rotation.x = e.x; obj.rotation.y = e.y; obj.rotation.z = e.z;
  }
}

// --- PlayCanvas app bootstrap ---
let pcApp = null;
function _disposeWebGLCanvasesInContainer(container, keepCanvasId = "game-canvas") {
  try {
    const canvases = Array.from(container.querySelectorAll("canvas"));
    for (const c of canvases) {
      if (c.id === keepCanvasId) continue;
      try {
        // Try to lose the WebGL context if present
        const gl = c.getContext && (c.getContext("webgl2") || c.getContext("webgl") || c.getContext("experimental-webgl"));
        if (gl) {
          const ext = gl.getExtension && (gl.getExtension("WEBGL_lose_context") || gl.getExtension("EXT_disjoint_timer_query"));
          if (ext && typeof ext.loseContext === "function") {
            try { ext.loseContext(); } catch (e) {}
          }
        }
      } catch (e) {}
      // Remove the canvas element from DOM to avoid duplicate contexts
      try { c.remove(); } catch (e) {}
    }
  } catch (e) {
    console.warn("_disposeWebGLCanvasesInContainer error:", e);
  }
}

// ---------- Init PlayCanvas scene (CrocodilosConstruction) ----------
export async function initSceneCrocodilosConstruction() {
  sceneNum = 1;
  console.log("Initializing CrocodilosConstruction scene (PlayCanvas)...");

  // 0) Dispose any previous THREE / WebGL canvas in the game container to avoid context conflicts
  const container = document.getElementById("game-container");
  if (!container) throw new Error("No #game-container element found");

  _disposeWebGLCanvasesInContainer(container, "game-canvas");

  // Ensure FIXED_WIDTH/HEIGHT exist (fallback)
  if (!window.FIXED_WIDTH || !window.FIXED_HEIGHT) {
    window.FIXED_WIDTH = window.FIXED_WIDTH || Math.max(800, container.clientWidth || 800);
    window.FIXED_HEIGHT = window.FIXED_HEIGHT || Math.max(600, container.clientHeight || 600);
  }

  // 1) Create or reuse PlayCanvas application via window.playcanvasApp
  let pcApp = window.playcanvasApp;
  let canvas = container.querySelector("#game-canvas");
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.id = "game-canvas";
    // set actual drawingbuffer size (very important)
    canvas.width = window.FIXED_WIDTH;
    canvas.height = window.FIXED_HEIGHT;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    container.appendChild(canvas);
  } else {
    // ensure canvas attributes match expected
    canvas.width = canvas.width || window.FIXED_WIDTH;
    canvas.height = canvas.height || window.FIXED_HEIGHT;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
  }

  if (!pcApp) {
    // create app and attach input devices to canvas explicitly
    pcApp = new pc.Application(canvas, {
      mouse: new pc.Mouse(canvas),
      touch: new pc.TouchDevice(canvas),
      keyboard: new pc.Keyboard(window)
    });

    // Use fixed internal resolution similar to your original approach
    try {
      pcApp.setCanvasFillMode(pc.FILLMODE_NONE);
      pcApp.setCanvasResolution(pc.RESOLUTION_FIXED);
    } catch (e) {
      console.warn("setCanvasFillMode/resolution failed (engine mismatch?):", e);
    }

    // force the canvas drawingbuffer size immediately
    try { pcApp.resizeCanvas(window.FIXED_WIDTH, window.FIXED_HEIGHT); } catch (e) { console.warn("resizeCanvas failed:", e); }

    // cap pixel ratio to avoid hi-dpi framebuffer bigness
    try { if (pcApp.graphicsDevice) pcApp.graphicsDevice.maxPixelRatio = 1; } catch (e) {}

    // start engine loop
    pcApp.start();
    window.playcanvasApp = pcApp;
    console.log("Created new PlayCanvas app and started it.");
  } else {
    // On reuse, ensure canvas/drawbuffer sizes are correct and attach to this container
    try {
      const gd = pcApp.graphicsDevice;
      if (gd && gd.canvas !== canvas) {
        // If PlayCanvas's canvas differs, swap it if possible (best-effort)
        try { gd.canvas.parentNode && gd.canvas.parentNode.removeChild(gd.canvas); } catch (e) {}
      }
      // ensure drawingbuffer size
      try { pcApp.resizeCanvas(window.FIXED_WIDTH, window.FIXED_HEIGHT); } catch (e) {}
    } catch (e) {}
    console.log("Reusing existing PlayCanvas app.");
  }

  // Expose global references
  window.pcApp = pcApp;
  window.camera = window.camera || null;
  window.scene = pcApp.root;

  // 2) Camera: ensure only one "game-camera" exists; create if missing or replace
  try {
    const prevCam = pcApp.root.findByName("game-camera");
    if (prevCam) prevCam.destroy();
  } catch (e) {}

  const cameraEnt = new pc.Entity("game-camera");
  cameraEnt.addComponent("camera", {
    clearColor: new pc.Color(0.0, 0.0, 0.0), // keep black default; change if you like visible sky
    fov: 60,
    nearClip: 0.1,
    farClip: 2000
  });
  cameraEnt.setLocalPosition(0, 1.6, 0);
  pcApp.root.addChild(cameraEnt);

  window.camera = cameraEnt;
  window.scene = pcApp.root;

  // 3) Light
  try {
    const prevLight = pcApp.root.findByName("map-sun");
    if (prevLight) prevLight.destroy();

    const sunEnt = new pc.Entity("map-sun");
    sunEnt.addComponent("light", {
      type: "directional",
      color: new pc.Color(1, 1, 1),
      intensity: 0.9,
      castShadows: false
    });
    sunEnt.setLocalEulerAngles(50, 30, 0);
    pcApp.root.addChild(sunEnt);
    window.hemi = sunEnt;
  } catch (e) {
    console.warn("Failed to create PlayCanvas light:", e);
  }

  // 4) Disable references to old THREE composer to prevent accidental use
  try { composer = null; renderPass = null; window.composer = null; window.renderPass = null; } catch (e) {}

  // 5) Load the map and BVH collider (use the PlayCanvas root and current physicsController)
  let spawnPoints = [];
  try {
    spawnPoints = await createCrocodilosConstruction(pcApp.root, physicsController);
  } catch (err) {
    console.warn("createCrocodilosConstruction failed:", err);
    spawnPoints = [{ x: 0, y: 2, z: 0 }];
  }
  window.spawnPoints = spawnPoints;

  // choose initial spawn
  const initialSpawnPoint = (typeof findFurthestSpawn === "function") ? findFurthestSpawn() : spawnPoints[0];
  if (physicsController && typeof physicsController.setPlayerPosition === "function") {
    physicsController.setPlayerPosition(initialSpawnPoint);
    console.log("Player and camera teleported to:", `(${initialSpawnPoint.x}, ${initialSpawnPoint.y}, ${initialSpawnPoint.z})`);
  } else {
    console.warn("physicsController.setPlayerPosition not available.");
  }

  // 6) Audio attempt - non-blocking
  if (typeof windSound !== "undefined") {
    try { windSound.play().catch(err => console.warn("Failed to play wind sound:", err)); } catch (e) {}
    window.windSound = windSound;
  } else {
    console.warn("windSound is not defined. Audio might not play for CrocodilosConstruction.");
  }

  // 7) Resize handling (ensures drawingbuffer size and CSS size)
  function onWindowResize() {
    const displayWidth = Math.max(1, container.clientWidth);
    const displayHeight = Math.max(1, container.clientHeight);

    // Keep fixed internal resolution for deterministic physics/collisions
    try {
      pcApp.resizeCanvas(window.FIXED_WIDTH, window.FIXED_HEIGHT);
      const c = pcApp.graphicsDevice.canvas;
      if (c) {
        c.style.width = `${displayWidth}px`;
        c.style.height = `${displayHeight}px`;
      }
    } catch (e) {
      try { pcApp.resizeCanvas(displayWidth, displayHeight); } catch (e2) {}
    }

    // re-attach weapons for local/remote players if necessary (best-effort)
    try {
      if (window.weaponController && window.localPlayer && typeof getWeaponModel === 'function' && typeof attachWeaponToPlayer === 'function') {
        const key = window.localPlayer.weapon.replace(/-/g, "").toLowerCase();
        const proto = getWeaponModel(key);
        if (proto) attachWeaponToPlayer(window.localPlayer.id, key);
      }
    } catch (e) { console.warn("Error re-attaching local weapon after resize:", e); }

    // HUD sizing
    const hud = document.getElementById("hud");
    if (hud) { hud.style.width = `${displayWidth}px`; hud.style.height = `${displayHeight}px`; }
  }

  window.addEventListener("resize", onWindowResize, false);
  onWindowResize();

  // 8) Hook game loop into PlayCanvas update (attach once)
  if (pcApp && !pcApp._gameUpdateAttached) {
    pcApp.on("update", function(dt) {
      const timestamp = performance.now();
      try { playcanvasFrameUpdate(dt, timestamp); } catch (err) { console.error("playcanvasFrameUpdate error:", err); }
    });
    pcApp._gameUpdateAttached = true;
  }

  console.log("CrocodilosConstruction initialization complete (PlayCanvas).");
  return spawnPoints;
}

export async function initSceneSigmaCity() {
  sceneNum = 2;
  console.log("Initializing SigmaCity scene...");

  scene = new THREE.Scene();
  const skyColor = new THREE.Color(0x87CEEB);
  scene.background = skyColor;
  window.scene = scene;

  const skyGeo = new THREE.SphereGeometry(200, 32, 32).scale(-1, 1, 1);
  const skyMat = new THREE.MeshBasicMaterial({
    color: 0x000022,
    side: THREE.BackSide,
    fog: false
  });
  skyMesh = new THREE.Mesh(skyGeo, skyMat);
  scene.add(skyMesh);
  window.scene = scene;

  window.camera.rotation.order = "YXZ";
  scene.add(window.camera);

  // 3. Renderer (CPU canvas)
  const cpuRenderer = createCanvasRenderer({ width: FIXED_WIDTH, height: FIXED_HEIGHT });
  cpuRenderer.setClearColor(0x000000, 1);
  renderer = cpuRenderer;
  window.renderer = renderer;

  const container = document.getElementById("game-container");
  if (container) {
    const prev = container.querySelector('canvas');
    if (prev) container.removeChild(prev);
    container.appendChild(renderer.domElement);
  }

  // 4. Hemisphere Light
  hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.05);
  scene.add(hemi);
  window.hemi = hemi;

  // 5. Composer - not used in CPU mode
  composer = null;
  renderPass = null;
  window.composer = composer;
  window.renderPass = renderPass;

  // --- Initial Detail Setup for SigmaCity ---
  toggleSceneDetails(detailsEnabled);

  // --- Map and Physics Initialization ---
  spawnPoints = await createSigmaCity(scene, physicsController);
  window.spawnPoints = spawnPoints;

  const initialSpawnPoint = findFurthestSpawn();
  physicsController.setPlayerPosition(initialSpawnPoint);

  // --- Audio Initialization ---
  if (typeof forestNoise !== 'undefined') {
    forestNoise.volume = 0.05;
    forestNoise.play().catch(err => console.warn("Failed to play forest noise:", err));
    window.windSound = forestNoise;
  } else {
    console.warn("forestNoise is not defined. Audio might not play for SigmaCity.");
  }

  // --- Window Resize Handling ---
  function onWindowResize() {
    const displayWidth = container.clientWidth;
    const displayHeight = container.clientHeight;

    renderer.setSize(FIXED_WIDTH, FIXED_HEIGHT, false);

    renderer.domElement.style.width = `${displayWidth}px`;
    renderer.domElement.style.height = `${displayHeight}px`;

    window.camera.aspect = displayWidth / displayHeight;
    window.camera.updateProjectionMatrix();

    if (window.weaponController && window.localPlayer && typeof getWeaponModel === 'function' && typeof attachWeaponToPlayer === 'function') {
      const key = window.localPlayer.weapon.replace(/-/g, "").toLowerCase();
      const proto = getWeaponModel(key);
      if (proto) attachWeaponToPlayer(window.localPlayer.id, key);
    }

    if (window.remotePlayers) {
      Object.values(window.remotePlayers).forEach(({ currentWeapon, weaponRoot }) => {
        if (currentWeapon && weaponRoot && typeof attachWeaponToPlayer === 'function') {
          attachWeaponToPlayer(weaponRoot.userData.playerId, currentWeapon);
        }
      });
    }

    const hud = document.getElementById("hud");
    if (hud) {
      hud.style.width = `${displayWidth}px`;
      hud.style.height = `${displayHeight}px`;
    }
  }

  window.addEventListener("resize", onWindowResize, false);
  onWindowResize();
}

export async function initSceneDiddyDunes() {
  sceneNum = 3;
  console.log("Initializing DiddyDunes scene...");

  scene = new THREE.Scene();
  const skyColor = new THREE.Color(0x87CEEB);
  scene.background = skyColor;
  window.scene = scene;

  const skyGeo = new THREE.SphereGeometry(200, 32, 32).scale(-1, 1, 1);
  const skyMat = new THREE.MeshBasicMaterial({
    color: 0x000022,
    side: THREE.BackSide,
    fog: false
  });
  skyMesh = new THREE.Mesh(skyGeo, skyMat);
  scene.add(skyMesh);
  window.scene = scene;

  window.camera.rotation.order = "YXZ";
  scene.add(window.camera);

  // 3. Renderer (CPU canvas)
  const cpuRenderer = createCanvasRenderer({ width: FIXED_WIDTH, height: FIXED_HEIGHT });
  cpuRenderer.setClearColor(0x000000, 1);
  renderer = cpuRenderer;
  window.renderer = renderer;

  const container = document.getElementById("game-container");
  if (container) {
    const prev = container.querySelector('canvas');
    if (prev) container.removeChild(prev);
    container.appendChild(renderer.domElement);
  }

  // 4. Hemisphere Light
  hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.05);
  scene.add(hemi);
  window.hemi = hemi;

  // 5. Composer - not used in CPU mode
  composer = null;
  renderPass = null;
  window.composer = composer;
  window.renderPass = renderPass;

  // --- Initial Detail Setup for DiddyDunes ---
  toggleSceneDetails(detailsEnabled);

  // --- Map and Physics Initialization ---
  spawnPoints = await createDiddyDunes(scene, physicsController);
  window.spawnPoints = spawnPoints;

  const initialSpawnPoint = findFurthestSpawn();
  physicsController.setPlayerPosition(initialSpawnPoint);

  // --- Audio Initialization ---
  if (typeof dessertWindSound !== 'undefined') {
    dessertWindSound.volume = 0.25;
    dessertWindSound.play().catch(err => console.warn("Failed to play dessert wind sound:", err));
    window.windSound = dessertWindSound;
  } else {
    console.warn("dessertWindSound is not defined. Audio might not play for DiddyDunes.");
  }

  // --- Window Resize Handling ---
  function onWindowResize() {
    const displayWidth = container.clientWidth;
    const displayHeight = container.clientHeight;

    renderer.setSize(FIXED_WIDTH, FIXED_HEIGHT, false);

    renderer.domElement.style.width = `${displayWidth}px`;
    renderer.domElement.style.height = `${displayHeight}px`;

    window.camera.aspect = displayWidth / displayHeight;
    window.camera.updateProjectionMatrix();

    if (window.weaponController && window.localPlayer && typeof getWeaponModel === 'function' && typeof attachWeaponToPlayer === 'function') {
      const key = window.localPlayer.weapon.replace(/-/g, "").toLowerCase();
      const proto = getWeaponModel(key);
      if (proto) attachWeaponToPlayer(window.localPlayer.id, key);
    }

    if (window.remotePlayers) {
      Object.values(window.remotePlayers).forEach(({ currentWeapon, weaponRoot }) => {
        if (currentWeapon && weaponRoot && typeof attachWeaponToPlayer === 'function') {
          attachWeaponToPlayer(weaponRoot.userData.playerId, currentWeapon);
        }
      });
    }

    const hud = document.getElementById("hud");
    if (hud) {
      hud.style.width = `${displayWidth}px`;
      hud.style.height = `${displayHeight}px`;
    }
  }

  window.addEventListener("resize", onWindowResize, false);
  onWindowResize();
}


// js/game.js (modify existing initGameNetwork)


export function pruneChat() {
chatRef
.orderByChild("timestamp")
.limitToFirst(1)
.once("value", (snap) => {
if (snap.exists()) {
chatRef.once("value", (allSnap) => {
if (allSnap.numChildren() > 10) {
snap.forEach((child) => child.ref.remove());
}
});
}
});
}

export function pruneKills() {
killsRef
.orderByChild("timestamp")
.limitToFirst(1)
.once("value", (snap) => {
if (snap.exists()) {
killsRef.once("value", (allSnap) => {
if (allSnap.numChildren() > 5) {
snap.forEach((child) => child.ref.remove());
}
});
}
});
}

// — REMOTE PLAYERS MANAGEMENT —
/**
* Fully updated addRemotePlayer function — no undefined references,
* uses the stored data.bodyColor (as colorHex) and sets up the entire player.
*/
// -------------------------------------------------------------
// Spawns a remote player and remembers their default color
// -------------------------------------------------------------
// -------------------------------------------------------------
// Spawns a remote player and remembers their default color
// -------------------------------------------------------------

import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js'; // Correct import for FontLoader
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';

export function addRemotePlayer(data) {
// Check if the player is ALREADY FULLY CREATED and in the scene.
// If the group is NOT in the scene, even if it's in remotePlayers, something went wrong,
// so we should try to re-create it.
const existingPlayerEntry = window.remotePlayers[data.id];
if (existingPlayerEntry && window.scene.getObjectById(existingPlayerEntry.group.id)) {
// Player exists in map AND their group is in the scene. All good.
console.warn(`Attempted to add remote player ${data.id} but their mesh already exists in scene. Skipping creation.`);
return;
}

// If an incomplete entry exists, remove it before re-creating
if (existingPlayerEntry) {
console.warn(`Incomplete remote player entry for ${data.id} found. Removing and recreating.`);
// Clean up any partial Three.js objects if they were added
if (existingPlayerEntry.group && existingPlayerEntry.group.parent) {
existingPlayerEntry.group.parent.remove(existingPlayerEntry.group);
existingPlayerEntry.group.traverse(obj => {
if (obj.geometry) obj.geometry.dispose();
if (obj.material) {
if (Array.isArray(obj.material)) {
obj.material.forEach(m => m.dispose());
} else {
obj.material.dispose();
}
}
});
}
delete window.remotePlayers[data.id]; // Remove the stale entry
}


// Ensure window.scene is available
if (!window.scene) {
console.error("Critical Error: window.scene is not initialized when attempting to add remote player mesh.");
return;
}

// 1) Determine the player’s original color
const initialColor = (typeof data.trueColor === 'number')
? data.trueColor
: (typeof data.bodyColor === 'number' ? data.bodyColor : 0xffffff);

console.log(
`Remote player ${data.id} originalColor → 0x${initialColor
           .toString(16)
           .padStart(6, '0')} `);

// 2) Build the THREE.Group for this player
const group = new THREE.Group();
group.name = `remotePlayer_${data.id}`; // Set the name here for future getObjectByName calls
group.userData.playerId = data.id; // Store ID on the group

// ─── Body ──────────────────────────────────────────────────────────────────────
const bodyWidth = 0.6;   // ~2 * capsule radius (0.3)
const bodyHeight = 1.9;  // approx. capsule total height (1.3 + 2*0.3)
const bodyDepth = 0.6;

const bodyGeom = new THREE.BoxGeometry(bodyWidth, bodyHeight, bodyDepth);
const bodyMat = new THREE.MeshStandardMaterial({ color: initialColor });
const bodyMesh = new THREE.Mesh(bodyGeom, bodyMat);
bodyMesh.castShadow = true;
bodyMesh.position.set(0, 0.0 - 1.1, 0); // Position relative to group center
bodyMesh.userData.isPlayerBodyPart = true;
bodyMesh.userData.playerId = data.id;

// ensure index exists (some custom routines expect it)
if (!bodyMesh.geometry.index) {
  bodyMesh.geometry.setIndex(
    generateSequentialIndices(bodyMesh.geometry.attributes.position.count)
  );
}
bodyMesh.geometry.computeBoundsTree();

group.add(bodyMesh);

// ─── Head (box) ───────────────────────────────────────────────────────────────
const headSize = 0.3; // ~diameter of original sphere (radius 0.15)
const headGeom = new THREE.BoxGeometry(headSize, headSize, headSize);
const headMat = new THREE.MeshStandardMaterial({ color: 0xffffaa });
const headMesh = new THREE.Mesh(headGeom, headMat);
headMesh.castShadow = true;
headMesh.position.set(0, 1.1 - 1.1, 0); // same relative offset as before
headMesh.userData.isPlayerBodyPart = true;
headMesh.userData.playerId = data.id;
headMesh.userData.isPlayerHead = true;

      if (!headMesh.geometry.index) {
    headMesh.geometry.setIndex(
      generateSequentialIndices(headMesh.geometry.attributes.position.count)
    );
  }
  headMesh.geometry.computeBoundsTree();

  group.add(headMesh);

// ─── Health Bar ───────────────────────────────────────────────────────────────
// Ensure createHealthBar exists and returns expected object structure
let healthBarObj;
try {
healthBarObj = createHealthBar();
healthBarObj.group.position.set(0, 0.5 - 1.1, -0.4); // Position relative to group
healthBarObj.group.scale.set(0.25, 0.75, 1);
// group.add(healthBarObj.group);
} catch (e) {
console.error(`Error creating health bar for player ${data.id}:`, e);
// Decide how to handle: skip health bar, or abort player creation?
// For now, let's assume it's non-critical for basic player visibility.
}


// ─── Name Label ───────────────────────────────────────────────────────────────
let nameMesh;
try {
// You'll need to load a font first. This is an example, replace with your font path.
// Common Three.js fonts are in node_modules/three/examples/fonts/
const fontLoader = new FontLoader();
fontLoader.load('https://unpkg.com/three@0.165.0/examples/fonts/helvetiker_regular.typeface.json', function(font) {
const textGeometry = new TextGeometry(data.username, {
font: font,
size: 0.1, // Adjust size as needed
height: 0.05, // Depth of the 3D text
curveSegments: 12,
bevelEnabled: true,
bevelThickness: 0.01,
bevelSize: 0.005,
bevelOffset: 0,
bevelSegments: 5
});
textGeometry.center(); // Center the text geometry
const textMaterial = new THREE.MeshStandardMaterial({
color: 0xffffff
}); // White text
nameMesh = new THREE.Mesh(textGeometry, textMaterial);
nameMesh.position.set(0, 0.3 - 1.1, -0.4); // Position above the head
nameMesh.rotation.set(
THREE.MathUtils.degToRad(0),
THREE.MathUtils.degToRad(180),
0
);
nameMesh.userData.isPlayerName = true;
// group.add(nameMesh);
}, undefined, function(err) {
console.error('An error happened loading the font:', err);
});

} catch (e) {
console.error(`Error creating name label for player ${data.id}:`, e);
}


// ─── Weapon Root ──────────────────────────────────────────────────────────────
const weaponRoot = new THREE.Group();
weaponRoot.name = 'remoteWeaponRoot'; // Name for easy access
group.add(weaponRoot);

// 3) Position & visibility of the main group
group.position.set(data.x, data.y, data.z); // Set absolute world position
group.rotation.y = data.rotY;
group.visible = !data.isDead; // Set initial visibility

// 4) Add to scene FIRST, then add to remotePlayers map
window.scene.add(group); // Add the entire player group to the global scene

// Now, create the entry in the map, *after* adding to the scene
window.remotePlayers[data.id] = {
id: data.id,
group, // The main Three.js group for this player
bodyMesh,
headMesh,
healthBarObj, // Object containing the health bar group and update function
nameMesh,
weaponRoot,
data: { ...data }, // Store a copy of the player data
currentWeapon: null, // Will be updated by attachWeaponToPlayer
trueColor: initialColor,
originalColor: initialColor
};

console.log(`Successfully added remote player mesh for: ${data.username} (ID: ${data.id})`);

// 5) Attach their weapon model after the player group exists
// Call this AFTER the player object is properly stored in window.remotePlayers
// to ensure attachWeaponToPlayer can find the weaponRoot.
// Ensure attachWeaponToPlayer handles cases where the player object might be incomplete if it's called too early
attachWeaponToPlayer(data.id, data.weapon);
}





// ─── bullet-proof removeRemotePlayer ─────────────────────────────────────────
export function removeRemotePlayer(id) {
const rp = window.remotePlayers[id];

// Remove model if still in scene
if (rp && rp.group && rp.group.parent) {
scene.remove(rp.group);
console.log(`[removeRemotePlayer] Removed model for player ${id}`);
}

// Clear any pending hide‐timeouts
clearTimeout(playerVisibilityTimeouts[id]);
delete playerVisibilityTimeouts[id];


// Unconditionally delete the map entry
delete window.remotePlayers[id];
// console.log(`[removeRemotePlayer] Purged remotePlayers[${id}]`);
}

export function updateRemotePlayer(data) {
    // console.log('[updateRemotePlayer] called for id=', data.id);
    if (data.id == null) return;

    const rp = window.remotePlayers[data.id];
    if (!rp || typeof rp !== 'object') {
        removeRemotePlayer(data.id);
        return;
    }
    if (!data.username) {
        console.warn(`[${data.id}] missing username, removing`);
        removeRemotePlayer(data.id);
        return;
    }

    // Store latest data
    rp.data = data;

    // --- Apply transform only when alive ---
    if (!data.isDead) {
        rp.group.userData.isFalling = false;
        rp.group.userData.velocityY = 0;
        if (!rp.group.parent) scene.add(rp.group);
        rp.group.visible = true;
        rp.group.position.set(data.x, data.y, data.z);
        rp.group.rotation.y = data.rotY;

        if (rp.headMesh) {
            rp.headMesh.rotation.x = data.rotX;
            rp.headMesh.rotation.z = data.rotZ;
        }
        if (rp.weaponRoot) {
            rp.weaponRoot.rotation.x = data.rotX;
        }
    } else {
        if (!rp.group.userData.isFalling) {
            rp.group.userData.isFalling = true;
            rp.group.userData.velocityY = 0;
        }
        rp.group.visible = true;
        rp.group.rotation.y = data.rotY;

        if (rp.headMesh) {
            rp.headMesh.rotation.x = data.rotX;
            rp.headMesh.rotation.z = data.rotZ;
        }
        if (rp.weaponRoot) {
            rp.weaponRoot.rotation.x = data.rotX;
        }
    }

    // Health/shield UI
    rp.healthBarObj.update(data.health, data.shield);

    // Body color flash
    if (typeof data.bodyColor === 'number') {
        const colorToUse = data.bodyColor === rp.originalColor ? rp.originalColor : data.bodyColor;
        rp.bodyMesh.material.color.setHex(colorToUse);
    }

    // Weapon change → clear any in-flight swing timer and reset
    if (data.weapon !== rp.currentWeapon) {
        if (rp.swingAnim && rp.swingAnim.timerId != null) {
            clearTimeout(rp.swingAnim.timerId);
            rp.swingAnim.timerId = null;
        }
        rp.swingAnim = { active: false, timerId: null };

        attachWeaponToPlayer(data.id, data.weapon);
        rp.currentWeapon = data.weapon;
        resetWeaponPose(data.weapon, rp.weaponMesh);
        const mats = Array.isArray(rp.weaponMesh.material) ? rp.weaponMesh.material : [rp.weaponMesh.material];
        mats.forEach(m => m?.emissive?.setHex(0x000000));
    }

    // Death → start falling (redundant guard)
    if (data.isDead && !rp.group.userData.isFalling) {
        rp.group.userData.isFalling = true;
        rp.group.userData.velocityY = 0;
    }

    if (!rp.weaponMesh) {
        console.warn(`[${data.id}] rp.weaponMesh is null or undefined`);
        return;
    }

    if (!rp.swingAnim) {
        rp.swingAnim = { active: false, timerId: null };
    }

    // === HANDLE KNIFE SWING REQUEST ===
    // Consume the incoming flag into a local variable (do NOT mutate the incoming `data` object).
    const incomingKnifeSwing = !!data.knifeSwing;
    const incomingKnifeHeavy = !!data.knifeHeavy;

    // Start a swing if requested and not already swinging, and if weapon is knife
    if (incomingKnifeSwing && !rp.swingAnim.active && rp.currentWeapon === 'knife') {
        rp.swingAnim.active = true;
        // Prefer authoritative durations if we have rp.stats (which may be in seconds).
        // Fall back to a default RPM-derived duration (500ms default).
        let durationMs;
        if (rp.stats && typeof rp.stats.swingTime === 'number') {
            // rp.stats.swingTime likely expressed in seconds on the local model
            durationMs = rp.stats.swingTime * 1000;
        } else if (rp.stats && typeof rp.stats.heavySwingTime === 'number' && incomingKnifeHeavy) {
            durationMs = rp.stats.heavySwingTime * 1000;
        } else {
            const rpm = 120; // default fallback
            durationMs = Math.round(60000 / rpm); // ms per swing
        }

        rp.swingAnim.duration = durationMs;
        rp.swingAnim.startTime = performance.now();
        rp.swingAnim.heavy = incomingKnifeHeavy;

        // Clear any previous timer
        if (rp.swingAnim.timerId != null) {
            clearTimeout(rp.swingAnim.timerId);
            rp.swingAnim.timerId = null;
        }

        // Set a safety timer to ensure cleanup even if update calls are intermittent.
        rp.swingAnim.timerId = setTimeout(() => {
            if (rp.currentWeapon === 'knife') {
                resetWeaponPose(rp.currentWeapon, rp.weaponMesh);
                const mats2 = Array.isArray(rp.weaponMesh.material) ? rp.weaponMesh.material : [rp.weaponMesh.material];
                mats2.forEach(m => m?.emissive?.setHex(0x000000));
            }
            rp.swingAnim.active = false;
            rp.swingAnim.timerId = null;
            // console.log(`[${data.id}] 🗡️ knifeSwing ENDED via timer`);
        }, rp.swingAnim.duration);

        // Optionally: immediate visual feedback (emissive) at start
        const matsStart = Array.isArray(rp.weaponMesh.material) ? rp.weaponMesh.material : [rp.weaponMesh.material];
        matsStart.forEach(m => { if (m?.emissive?.setHex) m.emissive.setHex(0xff0000); });

        // console.log(`[${data.id}] 🗡️ knifeSwing START (heavy=${rp.swingAnim.heavy})`);
    }

    // === Animate ongoing swing in a framerate-safe way ===
    if (rp.swingAnim.active && rp.currentWeapon === 'knife') {
        const now = performance.now();
        const elapsed = now - rp.swingAnim.startTime;
        const t = Math.min(elapsed / rp.swingAnim.duration, 1);
        const maxF = rp.swingAnim.heavy ? 0.9 : 1.2;
        const swingAng = maxF * Math.sin(Math.PI * t);
        const { MathUtils } = THREE;

        // emissive pulse: compute an integer hex color and clamp
        const progress = Math.max(0, Math.min(1, t));
        const redVal = Math.min(255, Math.floor(255 * progress));
        const hex = (redVal << 16);
        const mats = Array.isArray(rp.weaponMesh.material) ? rp.weaponMesh.material : [rp.weaponMesh.material];
        mats.forEach(mat => {
            if (mat?.emissive?.setHex) {
                mat.emissive.setHex(hex);
            }
        });

        // apply tilt (match local rest orientation closely)
        const restX = MathUtils.degToRad(90);
        const restY = MathUtils.degToRad(180);
        const restZ = 0;
        rp.weaponMesh.rotation.set(
            restX - swingAng,
            restY,
            restZ
        );

        // If animation reached the end, do cleanup immediately (don't rely on timer alone)
        if (t >= 1) {
            // clear timer if present
            if (rp.swingAnim.timerId != null) {
                clearTimeout(rp.swingAnim.timerId);
                rp.swingAnim.timerId = null;
            }
            resetWeaponPose(rp.currentWeapon, rp.weaponMesh);
            mats.forEach(m => m?.emissive?.setHex(0x000000));
            rp.swingAnim.active = false;
        }
    } else if (!rp.swingAnim.active && rp.currentWeapon === 'knife') {
        // Ensure pose is reset when not swinging
        resetWeaponPose(rp.currentWeapon, rp.weaponMesh);
        const mats2 = Array.isArray(rp.weaponMesh.material) ? rp.weaponMesh.material : [rp.weaponMesh.material];
        mats2.forEach(m => m?.emissive?.setHex(0x000000));
    }
}


function cleanUpRemotePlayers() {
for (const id in window.remotePlayers) {
const rp = window.remotePlayers[id];
// If it's not a proper object, just purge it
if (!rp || typeof rp !== "object") {
console.log(`[cleanUp] Found invalid entry for ${id}:`, rp);
removeRemotePlayer(id);
}
}
}

// Run this on a schedule (or right after you process incoming deltas)
setInterval(cleanUpRemotePlayers, 1000);

// — SPAWN SELECTION —
function findFurthestSpawn() {
//  console.log("Finding furthest spawn point...");
const spawnPoints = window.spawnPoints; // Correctly reference the global spawnPoints

if (!spawnPoints || !Array.isArray(spawnPoints) || spawnPoints.length === 0) {
console.warn("window.spawnPoints is not an array or is empty. Returning default spawn point.");
return new THREE.Vector3(0, 10, 0); // Default fallback spawn point
}

const spawnDistances = [];

// Calculate the minimum distance for each spawn point to any remote player
for (let sp of spawnPoints) {
let minDist = Infinity;

// Iterate through remote players for distance calculation
for (let pid in window.remotePlayers) {
const rp = window.remotePlayers[pid];
// Defensive check for rp.group and its position
if (rp.group && rp.group.position) {
const dx = rp.group.position.x - sp.x;
const dz = rp.group.position.z - sp.z;
const dist = Math.sqrt(dx * dx + dz * dz);
if (dist < minDist) {
minDist = dist;
}
}
}
// If no remote players were found, all minDist will remain Infinity.
// In this case, all spawn points are equally "furthest", so we'll assign a very large value.
// If there are remote players, minDist will be a finite number.
spawnDistances.push({
spawnPoint: sp,
distance: minDist
});
}

// Handle case where no remote players exist (all distances are Infinity)
if (spawnDistances.every(sd => sd.distance === Infinity)) {
console.log("No remote players found. Selecting a random spawn point from all available.");
// If no players, all spots are equally good, so pick a random one from all.
const randomIndex = Math.floor(Math.random() * spawnPoints.length);
return spawnPoints[randomIndex];
}

// Sort spawn points by distance in descending order (furthest first)
spawnDistances.sort((a, b) => b.distance - a.distance);

// Get the top 3 furthest spawn points
// Use Math.min to ensure we don't try to slice more than available spawn points
const top3Furthest = spawnDistances.slice(0, Math.min(3, spawnDistances.length));

// Randomly select one from the top 3 (or fewer if less than 3 are available)
const randomIndex = Math.floor(Math.random() * top3Furthest.length);
const chosenSpawn = top3Furthest[randomIndex].spawnPoint;

//  console.log(`Chosen spawn point: (${chosenSpawn.x}, ${chosenSpawn.y}, ${chosenSpawn.z}) with distance ${top3Furthest[randomIndex].distance}`);

return chosenSpawn;
}

// NEW: Internal functions for showing/hiding respawn overlay
function showRespawn() {
if (respawnOverlay) {
respawnOverlay.style.display = 'flex';
}
}

function hideRespawn() {
if (respawnOverlay) {
respawnOverlay.style.display = 'none';
}
}

// NEW: Create the fade-to-black overlay (initially transparent)
function createFadeOverlay() {
if (fadeOverlay) return; // Only create once
fadeOverlay = document.createElement("div");
fadeOverlay.id = "fade-overlay";
Object.assign(fadeOverlay.style, {
position: "fixed",
top: "0",
left: "0",
width: "100%",
height: "100%",
background: "#000",
opacity: "0",            // start fully transparent
transition: "opacity 1s ease-in-out",
pointerEvents: "none",   // clicks pass through while transparent
zIndex: "5",             // Above HUD (z=2), below respawn (z=6)
});
document.body.appendChild(fadeOverlay);
// console.log("[createFadeOverlay] Fade overlay added to DOM.");
}

let redOverlay;

function createRedOverlay() {
if (redOverlay) return; // only create it once

redOverlay = document.createElement("div");
redOverlay.id = "full-red-overlay";
Object.assign(redOverlay.style, {
position:      "fixed",
top:           "0",
left:          "0",
width:         "100%",
height:        "100%",
background:    "rgba(255, 0, 0, 1)",   // fully-opaque red
opacity:       "0",                    // start fully transparent
transition:    "opacity 0.5s ease-out",// fade in/out
zIndex:        "9999",                 // on top of everything
pointerEvents: "none",                 // allow clicks through when hidden
});

document.body.appendChild(redOverlay);
// console.log("[createRedOverlay] Full-screen red overlay added to DOM.");
}

const hitArrowCSS = `
 #hit-direction-arrow {
   position: absolute;
   top: 50%;
   left: 50%;
   transform: translate(-50%, -50%) rotate(0deg); /* Initial rotation */
   width: 80px; /* Adjust size as needed */
   height: 80px; /* Adjust size as needed */
   background-color: rgba(255, 0, 0, 0.7); /* Red arrow */
   clip-path: polygon(0% 20%, 60% 20%, 60% 0%, 100% 50%, 60% 100%, 60% 80%, 0% 80%);
   opacity: 0;
   transition: opacity 0.1s ease-out, transform 0.1s ease-out; /* Faster transitions for a snappier feel */
   pointer-events: none; /* Allows clicks to pass through */
   z-index: 1000; /* Ensure it's on top */
 }
`;

// Inject the CSS into the head of the document
const styleElement = document.createElement('style');
styleElement.innerHTML = hitArrowCSS;
document.head.appendChild(styleElement);

// Create the hit direction arrow element
let hitDirectionArrow = document.getElementById('hit-direction-arrow');
if (!hitDirectionArrow) {
hitDirectionArrow = document.createElement('div');
hitDirectionArrow.id = 'hit-direction-arrow';
document.body.appendChild(hitDirectionArrow);
}


function showHitDirectionArrow(angle) {
hitDirectionArrow.style.transition = 'opacity 0.1s ease-out, transform 0.1s ease-out';
hitDirectionArrow.style.transform = `translate(-50%, -50%) rotate(${angle}deg)`;
hitDirectionArrow.style.opacity = '1';

// Fade out the arrow after a short duration
setTimeout(() => {
hitDirectionArrow.style.opacity = '0';
}, 500); // Arrow visible for 0.5 seconds
}

let lastDamageSourcePosition = null;

/** Call this to flash red then fade away **/
function pulseScreenRed() {
createRedOverlay();
// Bring it up quickly
redOverlay.style.pointerEvents = "auto"; // block input briefly if you want
redOverlay.style.opacity = "0.8";        // semi-strong flash

// After a short hold, fade back to transparent
setTimeout(() => {
redOverlay.style.opacity = "0";
// when fade completes, allow input through again
redOverlay.addEventListener("transitionend", function onEnd() {
redOverlay.style.pointerEvents = "none";
redOverlay.removeEventListener("transitionend", onEnd);
});
}, 100); // you can tweak this hold time (ms)
}

let whiteOverlay = null;

function createWhiteOverlay() {
if (whiteOverlay) return; // only create it once

whiteOverlay = document.createElement("div");
whiteOverlay.id = "full-white-overlay";
Object.assign(whiteOverlay.style, {
position:      "fixed",
top:           "0",
left:          "0",
width:         "100%",
height:        "100%",
background:    "rgba(255, 255, 255, 1)", // fully-opaque white
opacity:       "0",                     // start fully transparent
transition:    "opacity 0.5s ease-out",
zIndex:        "9999",
pointerEvents: "none",
});

document.body.appendChild(whiteOverlay);
// console.log("[createWhiteOverlay] Full-screen white overlay added to DOM.");
}

/** Call this to flash white then fade away **/
function pulseScreenWhite() {
createWhiteOverlay();
whiteOverlay.style.pointerEvents = "auto";
whiteOverlay.style.opacity = "0.8";

setTimeout(() => {
whiteOverlay.style.opacity = "0";
whiteOverlay.addEventListener("transitionend", function onEnd() {
whiteOverlay.style.pointerEvents = "none";
whiteOverlay.removeEventListener("transitionend", onEnd);
});
}, 100);
}

// Replace your old showRedOverlay/hideRedOverlay calls with:
window.pulseScreenRed = pulseScreenRed;


// NEW: Create the respawn overlay and button
function createRespawnOverlay() {
if (respawnOverlay) return; // Only create once
    /*
respawnOverlay = document.createElement("div");
respawnOverlay.id = "respawn-overlay";
Object.assign(respawnOverlay.style, {
position: "fixed",
top: "0",
left: "0",
width: "100%",
height: "100%",
background: "rgba(0, 0, 0, 0.75)",
zIndex: "6",            // Above fade overlay
display: "none",        // Hidden until death
alignItems: "center",
justifyContent: "center",
pointerEvents: "auto",
});

respawnButton = document.createElement("button");
respawnButton.id = "respawn-btn";
respawnButton.textContent = "Respawn";
Object.assign(respawnButton.style, {
padding: "15px 25px",
fontSize: "1.2rem",
cursor: "pointer",
border: "none",
borderRadius: "6px",
background: "#e74c3c",
color: "#fff",
});

respawnOverlay.appendChild(respawnButton);
document.body.appendChild(respawnOverlay);
// console.log("[createRespawnOverlay] Respawn overlay added to DOM.");
*/
respawnOverlay = document.getElementById("respawn-overlay");
respawnButton = document.getElementById("respawn-now-button");
    
respawnButton.addEventListener("click", () => {
respawnPlayer();
});
}

function createLeaderboardOverlay() {
  const overlay = document.getElementById("leaderboard-overlay");
  const tbody = document.getElementById("leaderboard-body");

  if (!overlay || !tbody) {
    console.error("Leaderboard overlay or body not found. Please ensure elements with IDs 'leaderboard-overlay' and 'leaderboard-body' exist in your HTML.");
    return;
  }
  
  // Make the overlay visible
  overlay.style.display = "block";

  // Firebase listener
  playersRef.on("value", snapshot => {
    const players = [];
    snapshot.forEach(snap => {
      const d = snap.val();
      if (d && d.username) {
        players.push({
          name: d.username,
          kills: d.kills || 0,
          deaths: d.deaths || 0,
          ks: d.ks || 0
        });
      }
    });
    players.sort((a, b) => b.kills - a.kills || b.ks - a.ks);

    tbody.innerHTML = "";
    if (players.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" style="padding:4px; text-align:center;">No players</td></tr>`;
    } else {
      players.forEach(p => {
        const row = document.createElement("tr");
        row.innerHTML = `
          <td style="padding:4px;">${p.name}</td>
          <td style="padding:4px;">${p.kills}</td>
          <td style="padding:4px;">${p.deaths}</td>
          <td style="padding:4px;">${p.ks}</td>
        `;
        tbody.appendChild(row);
      });
    }
  });
    window.addEventListener("keydown", e => {
      if (isChatting()) return;    // ← if they’re typing, do nothing
    
      if (e.code === currentKeybinds.toggleLeaderboard && !e.repeat) {
        overlay.style.display = overlay.style.display === "none" ? "block" : "none";
        e.preventDefault();
      }
    });
}




// — DEATH & RESPAWN —
export function handleLocalDeath() {
    //console.log("▶️ handleLocalDeath called! deathTheme exists?", !!deathTheme);
    document.getElementById("crosshair").style.display = "none";
    // console.log("[DEBUG] handleLocalDeath called.");

    if (window.localPlayer) {
        // 1. Mark the player dead
        window.localPlayer.isDead = true;
        //   console.log("[DEBUG] window.localPlayer.isDead set to:", window.localPlayer.isDead);

        // 2. Remove any physics bodies (if you’re using a physics engine)

        // 3. Remove THREE.js colliders from collidables array
        window.collidables = window.collidables.filter(obj => {
            // assume each collider has userData.playerId === localPlayer.id
            return !(obj.userData.isPlayerBodyPart && obj.userData.playerId === window.localPlayer.id);
        });
        //   console.log("[DEBUG] Stripped out localPlayer collidables, remaining:", window.collidables.length);

        // 4. Optionally hide the model in the scene (if you want)
        if (window.localPlayer.group && window.localPlayer.group.parent) {
            scene.remove(window.localPlayer.group);
            //   console.log("[DEBUG] Removed localPlayer model from scene");
        }

        // ⭐ NEW: Increment the local player's death stat in both the game state and the menu database
        if (typeof incrementUserStat === "function" && window.localPlayer.username) {
            // Update the stat in the menu database
            incrementUserStat(window.localPlayer.username, 'deaths', 1);
            // Update the local game state
            window.localPlayer.deaths = (window.localPlayer.deaths || 0) + 1;
        } else {
            console.error("[DEBUG ERROR] 'incrementUserStat' function or local player username is not defined.");
        }

        // 5. Trigger your respawn UI
        if (typeof showRespawn === "function") {
            showRespawn();
            //     console.log("[DEBUG] showRespawn() called.");
        } else {
            console.error("[DEBUG ERROR] showRespawn function is not defined!");
        }
    } else {
        console.error("[DEBUG ERROR] window.localPlayer is not defined in handleLocalDeath.");
    }
}


// Make sure that the 'respawnPlayer' function is defined globally as well.
// If you haven't already, define it similar to this example:
window.respawnPlayer = function() {
if (window.localPlayer) {
window.localPlayer.isDead = false;
window.localPlayer.health = 100;
window.localPlayer.shield = 50;
console.log("Player has respawned!");

}
if (typeof hideRespawn === "function") {
hideRespawn();
}
};

function respawnPlayer() {
    // 0) Flip yourself alive immediately
    window.localPlayer.isDead = false;

    // Force the player's weapon to be the knife and update the inventory
    window.localPlayer.weapon = "knife";
    weaponController.equipWeapon("knife");
    updateInventory("knife");
    activeRecoils.length = 0; // Clear recoil for the knife

    // UI + audio reset
    deathTheme.currentTime = 0;
    deathTheme.pause();
    if (sceneNum == 1) {
        windSound.play().catch(err => console.warn(err));
    } else if (sceneNum == 2) {
        forestNoise.play().catch(err => console.warn(err));
    } else if (sceneNum == 3) {
        dessertWindSound.play().catch(err => console.warn(err));
    }

    respawnOverlay.style.display = "none";
    document.getElementById("crosshair").style.display = "block";
    if (fadeOverlay) {
        fadeOverlay.style.pointerEvents = "none";
        fadeOverlay.style.opacity = "0";
    }

    // 1) Compute spawn point
    const spawn = findFurthestSpawn();

    // 2) Reset logical/player state
    window.localPlayer.x = spawn.x;
    window.localPlayer.y = spawn.y;
    window.localPlayer.z = spawn.z;
    physicsController.setPlayerPosition(spawn);
    // 3) Reset your physics body so PhysicsController doesn’t yank you back
    if (physicsController && physicsController.body) {
        const body = physicsController.body;
        // zero out any residual motion
        body.velocity.set(0, 0, 0);
        body.angularVelocity.set(0, 0, 0);
        // teleport to spawn + eye-height
        body.position.set(spawn.x, spawn.y + 1.6, spawn.z);
        // reset orientation
        body.quaternion.set(0, 0, 0, 1);
        body.wakeUp();
    }

    // 4) Move THREE camera immediately
    window.camera.position.copy(spawn).add(new THREE.Vector3(0, 1.6, 0));
    window.camera.lookAt(new THREE.Vector3(spawn.x, spawn.y + 1.6, spawn.z + 1).add(new THREE.Vector3(0, 0, 0)));

    // 5) Reposition your model/group if you have one
    const group = window.localPlayer.group;
    if (group) {
        group.position.set(spawn.x, spawn.y + 1.6, spawn.z);
    }

    // 6) Re-add collidables for your body
    if (group) {
        group.traverse(child => {
            if (child.isMesh) {
                child.userData.isPlayerBodyPart = true;
                child.userData.playerId = window.localPlayer.id;
                window.collidables.push(child);
            }
        });
    }

    // 7) Pointer-lock & input reset
    document.body.classList.add("game-active");

    // 8) Weapon & HUD reset
    if (typeof weaponAmmo === 'object') {
        for (const key in weaponAmmo) delete weaponAmmo[key];
    }
    for (const key in WeaponController.WEAPONS) {
        const stats = WeaponController.WEAPONS[key];
        weaponController.ammoStore[key] = stats.magazineSize;
        if (weaponController.currentKey === key) {
            weaponController.ammoInMagazine = stats.magazineSize;
            updateAmmoDisplay(weaponController.ammoInMagazine, stats.magazineSize);
            updateInventory(
                weaponController.getCurrentAmmo(),
                weaponController.getMaxAmmo()
            );
        }
    }

    // 9) Sync alive state to Firebase
    playersRef.child(window.localPlayer.id).update({
        x: spawn.x,
        y: spawn.y,
        z: spawn.z,
        health: 100,
        shield: 50,
        isDead: false,
        weapon: "knife" // Update the weapon in Firebase
    });
}


// — MAIN ANIMATION LOOP —
// js/game.js (or wherever your main loop lives)

let hiddenInterval = null;
let rafId = null;

function round2(n) {
  return Math.round(n * 100) / 100;
}




export function playcanvasFrameUpdate(delta, timestamp) {
  // delta in seconds
  // --- Disconnection/Pause Logic ---
  if (localPlayerId == null || window.isGamePaused) return;

  try {
    // Pre-animation checks
    if (!physicsController || !weaponController) {
      console.warn("Skipping frame: controllers not yet initialized");
      postFrameCleanup();
      return;
    }
    if (!window.mapReady) {
      postFrameCleanup();
      return;
    }
    if (!window.localPlayer) {
      console.warn("Skipping frame: window.localPlayer is not initialized.");
      postFrameCleanup();
      return;
    }

    // Death screen handling
    if (window.localPlayer.isDead) {
      const cross = document.getElementById("crosshair");
      if (cross) cross.style.display = "none";

      if (windSound && !windSound.paused) windSound.pause();
      if (forestNoise && !forestNoise.paused) forestNoise.pause();
      if (dessertWindSound && !dessertWindSound.paused) dessertWindSound.pause();
      if (deathTheme && deathTheme.paused) {
        deathTheme.currentTime = 0;
        deathTheme.play().catch(e => console.error("Error playing death theme:", e));
      }

      if (fadeOverlay) {
        fadeOverlay.style.pointerEvents = "auto";
        fadeOverlay.style.opacity = "1";
      }
      if (respawnOverlay) respawnOverlay.style.display = "flex";

      // PlayCanvas auto-renders; nothing explicit to call here for the final frame.
      postFrameCleanup();
      return;
    } else {
      if (fadeOverlay && fadeOverlay.style.opacity !== "0") hideFadeOverlay();
      if (respawnOverlay && respawnOverlay.style.display !== "none") hideRespawn();
      const cross = document.getElementById("crosshair");
      if (cross) cross.style.display = "block";
    }

    // Normal game updates
    checkForDamagePulse();

    if (weaponController.stats && weaponController.stats.speedModifier != null) {
      physicsController.setSpeedModifier(weaponController.stats.speedModifier);
    }

    // Remote players falling (works with three or PlayCanvas entities)
    const GRAVITY = 9.8;
    Object.values(window.remotePlayers || {}).forEach(rp => {
      const g = rp.group;
      if (g?.userData?.isFalling) {
        g.userData.velocityY = (g.userData.velocityY || 0) + GRAVITY * delta;
        // read/set position in engine-agnostic way
        const pos = getPosition(g);
        pos.y -= g.userData.velocityY * delta;
        setPosition(g, pos);

        if (pos.y < -20) {
          g.userData.isFalling = false;
          g.userData.velocityY = 0;
          // hide entity/object whichever API
          if (typeof g.enabled !== "undefined") g.enabled = false; // PlayCanvas
          if (g.visible !== undefined) g.visible = false; // THREE
          if (g.setLocalPosition) g.setLocalPosition(pos.x, pos.y, pos.z);
        }
      }
    });

    // animate sky / stars / fog (rotation)
    if (window.skyMesh) {
      const e = getEuler(window.skyMesh);
      e.x += 0.0001 * (delta * 1000);
      setEuler(window.skyMesh, e);
    }
    if (window.starField) {
      const e = getEuler(window.starField);
      e.x += 0.00008 * (delta * 1000);
      setEuler(window.starField, e);
    }

    if (window.worldFog) {
      // rotate about Y
      const we = getEuler(window.worldFog);
      we.y += delta * 0.005;
      setEuler(window.worldFog, we);

      const nowMs = performance.now();
      const pos = getPosition(window.worldFog);
      pos.x += Math.sin(nowMs * 0.0001) * delta * 2;
      pos.z += Math.cos(nowMs * 0.0001) * delta * 2;
      setPosition(window.worldFog, pos);
    }

    // Physics & Input Update (unchanged)
    const physState = physicsController.update(delta, inputState, window.collidables);

    // Weapon Update (unchanged)
    weaponController.update(
      inputState,
      delta, {
        velocity: physState.velocity,
        isCrouched: inputState.crouch,
        physicsController,
        collidables: window.collidables,
        stats: weaponController.stats
      }
    );

    // Active Tracers Update
    for (let i = activeTracers.length - 1; i >= 0; i--) {
      const tracer = activeTracers[i];
      tracer.update(delta);
      if (tracer.remove) {
        tracer.dispose();
        activeTracers.splice(i, 1);
      }
    }

    // Network Sync
    if (dbRefs && dbRefs.playersRef && localPlayerId) {
      sendPlayerUpdate({
        x: physState.x,
        y: physState.y,
        z: physState.z,
        rotY: round2(physState.rotY),
        rotX: round2(getEuler(window.camera).x),
        rotZ: round2(getEuler(window.camera).z),
        weapon: window.localPlayer.weapon,
        knifeSwing: window.localPlayer.knifeSwing || false,
        knifeHeavy: window.localPlayer.knifeHeavy || false
      });
      window.localPlayer.knifeSwing = false;
      window.localPlayer.knifeHeavy = false;
    } else {
      // only warn occasionally to avoid spamming console
      // console.warn("Skipping sendPlayerUpdate: dbRefs, dbRefs.playersRef or localPlayerId is null.");
    }

    // Remote avatars update
    for (const id in window.remotePlayers || {}) {
      const rp = window.remotePlayers[id];
      if (rp.data) updateRemotePlayer(rp.data);
    }

    // Weapon switching
    if (inputState.weaponSwitch) {
      const oldW = window.localPlayer.weapon;
      weaponAmmo[oldW] = weaponController.getCurrentAmmo();
      const newW = inputState.weaponSwitch;
      window.localPlayer.weapon = newW;

      if (dbRefs && dbRefs.playersRef && localPlayerId) {
        try {
          dbRefs.playersRef.child(localPlayerId).update({ weapon: newW });
        } catch (error) {
          console.error("Failed to update local player weapon in Firebase:", error);
        }
      }

      weaponController.equipWeapon(newW);
      weaponController.ammoInMagazine = weaponAmmo[newW] ?? weaponController.stats.magazineSize;
      updateInventory(newW);
      updateAmmoDisplay(weaponController.ammoInMagazine, weaponController.stats.magazineSize);
      inputState.weaponSwitch = null;
      if (newW === "knife") activeRecoils.length = 0;
    }

    // Mouse look + recoil (adapts to PlayCanvas camera entity)
    const baseSens = parseFloat(localStorage.getItem("sensitivity") || "5.00");
    const aimMul = inputState.aim ? (window.localPlayer.weapon === "marshal" ? 0.15 : 0.5) : 1;
    const finalSens = baseSens * aimMul;

    // camera rotation uses Euler helper
    const camEuler = getEuler(window.camera);
    camEuler.y -= inputState.mouseDX * finalSens * 0.002;
    let newPitch = camEuler.x - inputState.mouseDY * finalSens * 0.002;
    camEuler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, newPitch));
    setEuler(window.camera, camEuler);

    // Recoil
    {
      const now = performance.now() / 1000;
      let totalOffset = 0;
      for (let i = activeRecoils.length - 1; i >= 0; i--) {
        const r = activeRecoils[i];
        const t = (now - r.start) / r.duration;
        if (t >= 1) {
          activeRecoils.splice(i, 1);
          continue;
        }
        totalOffset += r.angle * (1 - t);
      }
      const ce = getEuler(window.camera);
      ce.x += totalOffset;
      setEuler(window.camera, ce);
    }

    // Rebuild collidables
    if (window.mapReady) {
      window.collidables = [...(window.envMeshes || [])];
      for (const otherId in window.remotePlayers || {}) {
        if (otherId === window.localPlayer.id) continue;
        const other = window.remotePlayers[otherId];
        const group = other.group;
        // traverse compatibility: PlayCanvas entities have traverseHierarchy? we'll do a simple check
        if (!group) continue;
        // If PlayCanvas entity: it has children array
        if (group.children && group.enabled !== false) {
          const stack = [group];
          while (stack.length) {
            const c = stack.pop();
            // detect mesh-like / player body part flags
            if (c.meshInstances || c.render || (c.userData && c.userData.isPlayerBodyPart)) {
              if (c.userData?.isPlayerBodyPart) window.collidables.push(c);
            }
            if (c.children) stack.push(...c.children);
          }
        } else if (group.traverse) {
          // Three.js traverse
          group.traverse(child => {
            if (child.isMesh && child.userData?.isPlayerBodyPart) window.collidables.push(child);
          });
        }
      }
    }

    // No explicit render call needed: PlayCanvas renders automatically each frame.

  } catch (err) {
    console.error("Error in PlayCanvas frame update:", err);
  } finally {
    postFrameCleanup();
  }
}

// Backwards-compatible animate export: if other code still calls animate(timestamp),
// we'll forward to PlayCanvas update once and no-op otherwise (PlayCanvas drives updates).
export function animate(timestamp) {

    if (window.playcanvasApp) return;

  // keep API compatibility: if a PlayCanvas app exists, do nothing because the app runs update().
  if (pcApp) return;
  // otherwise fall back to your original requestAnimationFrame-based loop (kept minimal)
  requestAnimationFrame(animate);
  // You can optionally call the original animate logic here if you want to support non-PlayCanvas rendering.
}


function resetWeaponPose(weaponKey, mesh) {
    const M = THREE.MathUtils;

    switch (weaponKey) {
        case "knife":
            mesh.scale.set(0.0007, 0.0007, 0.0007);
            mesh.rotation.set(M.degToRad(90), M.degToRad(180), 0);
            mesh.position.set(0.5, 0.8 - 1.4, 0);
            break;

        case "deagle":
            mesh.scale.set(0.5, 0.5, 0.5);
            mesh.rotation.set(M.degToRad(0), M.degToRad(180), 0);
            mesh.position.set(0.5, 0.8 - 1.4, 0);
            break;

        case "legion":
            mesh.scale.set(0.5, 0.5, 0.5);
            mesh.rotation.set(M.degToRad(0), M.degToRad(180), 0);
            mesh.position.set(0.5, 0.8 - 1.4, 0);
            break;

        case "ak-47":
            mesh.scale.set(0.4, 0.4, 0.4);
            mesh.rotation.set(M.degToRad(0), M.degToRad(180), 0);
            mesh.position.set(0.5, 0.8 - 1.4, 0);
            break;

        case "viper":
            mesh.scale.set(0.4, 0.4, 0.4);
            mesh.rotation.set(M.degToRad(0), M.degToRad(180), 0);
            mesh.position.set(0.5, 0.8 - 1.4, 0);
            break;

        case "marshal":
            mesh.scale.set(2, 2, 2);
            mesh.rotation.set(M.degToRad(0), M.degToRad(0), 0);
            mesh.position.set(0.5, 0.8 - 1.4, 0);
            break;

        case "m79":
            mesh.scale.set(0.5, 0.5, 0.5);
            mesh.rotation.set(M.degToRad(0), M.degToRad(180), 0);
            mesh.position.set(0.5, 0.8 - 1.4, 0);
            break;

        default:
            console.warn(`resetWeaponPose(): unknown weapon "${weaponKey}"`);
    }
}

function attachWeaponToPlayer(playerId, weaponName) {
    const key = weaponName.replace(/-/g, "").toLowerCase();
    const rp = window.remotePlayers[playerId];
    if (!rp) return;

    // 1) Clear any previous model
    while (rp.weaponRoot.children.length) {
        rp.weaponRoot.remove(rp.weaponRoot.children[0]);
    }
    rp.weaponMesh = null;

    // 2) Get preloaded prototype
    const proto = _prototypeModels[key];

    if (proto && proto.children.length) {
        const clone = proto.clone(true);
        clone.visible = true;

        // 3) Apply original buildX() transforms
        switch (key) {
            case "knife": {
                const s = 0.0007;
                clone.scale.set(s, s, s);
                clone.rotation.set(
                    THREE.MathUtils.degToRad(90),
                    THREE.MathUtils.degToRad(180),
                    0
                );
                clone.position.set(0.5, 0.8 - 1.4, 0);
                break;
            }
            case "deagle":
                clone.scale.set(0.5, 0.5, 0.5);
                clone.rotation.set(
                    THREE.MathUtils.degToRad(0),
                    THREE.MathUtils.degToRad(180),
                    0
                );
                clone.position.set(0.5, 0.8 - 1.4, 0);
                break;

            case "legion":
                clone.scale.set(0.5, 0.5, 0.5);
                clone.rotation.set(
                    THREE.MathUtils.degToRad(0),
                    THREE.MathUtils.degToRad(180),
                    0
                );
                clone.position.set(0.5, 0.8 - 1.4, 0);
                break;

            case "ak47":
                clone.scale.set(0.4, 0.4, 0.4);
                clone.rotation.set(
                    THREE.MathUtils.degToRad(0),
                    THREE.MathUtils.degToRad(180),
                    0
                );
                clone.position.set(0.5, 0.8 - 1.4, 0);
                break;

            case "viper":
                clone.scale.set(0.4, 0.4, 0.4);
                clone.rotation.set(
                    THREE.MathUtils.degToRad(0),
                    THREE.MathUtils.degToRad(180),
                    0
                );
                clone.position.set(0.5, 0.8 - 1.4, 0);
                break;

            case "marshal":
                clone.scale.set(2, 2, 2);
                clone.rotation.set(
                    THREE.MathUtils.degToRad(0),
                    THREE.MathUtils.degToRad(0),
                    0
                );
                clone.position.set(0.5, 0.8 - 1.4, 0);
                break;

            case "m79":
                clone.scale.set(0.5, 0.5, 0.5);
                clone.rotation.set(
                    THREE.MathUtils.degToRad(0),
                    THREE.MathUtils.degToRad(180),
                    0
                );
                clone.position.set(0.5, 0.8 - 1.4, 0);
                break;

            default:
                console.warn(`attachWeaponToPlayer(): Unknown weapon "${key}"`);
                return;
        }

        // 4) Parent it under the hand and record for animation
        rp.weaponRoot.add(clone);
        rp.weaponMesh = clone;
        rp.currentWeapon = key;
        return;
    }

    // 5) Knife fallback only if prototype isn't ready
    if (key === "knife") {
        console.warn(`[attachWeaponToPlayer] Knife prototype missing — fallback to live build`);
        const tempWC = new WeaponController(new THREE.Group());
        tempWC.buildKnife((knifeGroup) => {
            knifeGroup.visible = true;
            knifeGroup.scale.set(0.001, 0.001, 0.001);
            knifeGroup.rotation.set(
                THREE.MathUtils.degToRad(90),
                THREE.MathUtils.degToRad(160),
                0
            );
            knifeGroup.position.set(0.5, -0.1, -0.7);

            rp.weaponRoot.add(knifeGroup);
            rp.weaponMesh = knifeGroup;
            rp.currentWeapon = "knife";

            console.log(`[${playerId}] attached fallback knife as weaponMesh`, knifeGroup);
        });
    } else {
        console.warn(`attachWeaponToPlayer(): No prototype available for "${key}"`);
    }
}




// Optionally, re-attach on resize so your players’ weapons stay in the right spot:
window.addEventListener("resize", () => {
Object.keys(window.remotePlayers).forEach(pid => {
const wp = window.remotePlayers[pid].currentWeapon;
if (wp) attachWeaponToPlayer(pid, wp);
});
});

function animateDeath(targetId) {
// console.log('[animateDeath] called for', targetId);
const entry = window.remotePlayers[targetId];
if (!entry || !entry.group) {
console.warn('[animateDeath] missing entry or group for', targetId, entry);
return;
}
// Mark for falling/sinking. In updateRemotePlayer, death logic expects group.userData.isFalling:
entry.group.userData.isFalling = true;
entry.group.userData.velocityY = 0;
// console.log('[animateDeath] marked isFalling & set velocityY=0 for', targetId);
}


// — DAMAGE CALLBACK (Called by WeaponController when a remote player is hit) —
// This function needs to be globally accessible for WeaponController to call it.

// -------------------------------------------------------------
// Applies damage and flashes red, then reverts to originalColor
// -------------------------------------------------------------
// -------------------------------------------------------------
// Applies damage and flashes red, then reverts to originalColor
// -------------------------------------------------------------
export async function incrementUserStat(username, field, amount) {
    if (!username || !field || typeof amount !== 'number' || isNaN(amount)) {
        console.warn(`[incrementUserStat] Invalid call: username='${username}', field='${field}', amount='${amount}'`);
        return Promise.resolve();
    }

    if (!usersRef) {
        console.warn('[incrementUserStat] usersRef not initialized. Cannot increment stat.');
        return Promise.reject(new Error('usersRef not initialized'));
    }

    const trimmed = String(username).trim();
    if (trimmed === '') {
        console.warn('[incrementUserStat] username is empty after trim.');
        return Promise.resolve();
    }

    // Resolve the actual stored user key (case-insensitive resolution)
    async function resolveUserKey(name) {
        // 1) Exact key match
        const exactSnap = await usersRef.child(name).once('value');
        if (exactSnap.exists()) return name;

        const lower = name.toLowerCase();

        // 2) If your user nodes store a lowercase index (recommended: usernameLower),
        //    query by that to find the canonical key quickly.
        try {
            const byLower = await usersRef.orderByChild('usernameLower').equalTo(lower).limitToFirst(1).once('value');
            if (byLower.exists()) {
                const keys = Object.keys(byLower.val());
                if (keys.length) return keys[0];
            }
        } catch (e) {
            // ignore query errors and fall back
        }

        // 3) Fallback: scan children keys for a case-insensitive match.
        //    WARNING: this reads the whole users node and can be expensive on large datasets.
        const allSnap = await usersRef.once('value');
        if (!allSnap.exists()) return null;
        const all = allSnap.val();

        for (const key of Object.keys(all)) {
            // if the DB key is the username, compare case-insensitively
            if (key.toLowerCase() === lower) return key;

            const node = all[key];
            // if user object contains a username property, compare that too
            if (node && typeof node.username === 'string' && node.username.toLowerCase() === lower) return key;
            if (node && node.usernameLower === lower) return key;
        }

        return null;
    }

    try {
        const canonicalKey = await resolveUserKey(trimmed);

        if (!canonicalKey) {
            console.warn(`[incrementUserStat] No existing user found matching '${username}' (any capitalization). Aborting to avoid creating new user.`);
            return Promise.resolve(); // no-op rather than creating a new user
        }

        const userStatRef = usersRef.child(canonicalKey).child('stats').child(field);

        // perform transaction (this may create the stat field under an existing user,
        // but won't create a new user)
        const result = await userStatRef.transaction(currentValue => {
            if (currentValue === null) return amount;
            return (currentValue || 0) + amount;
        });

        if (result.committed) {
            console.log(`[incrementUserStat] Successfully incremented ${canonicalKey}'s ${field} by ${amount}. New value: ${result.snapshot.val()}`);
        } else {
            console.warn(`[incrementUserStat] Transaction for ${canonicalKey}'s ${field} was aborted.`);
        }
        return result;
    } catch (err) {
        console.error(`[incrementUserStat] Failed to update ${username}'s ${field}:`, err);
        return Promise.reject(err);
    }
}

// game.js
(function ensureDamagePopupStyles() {
  if (document.getElementById('damage-popup-styles')) return;
  const style = document.createElement('style');
  style.id = 'damage-popup-styles';
  style.textContent = `
    .damage-popup {
      position: fixed;
      left: 0;
      top: 0;
      transform-origin: center;
      font-weight: 800;
      color: #ff3b3b;
      text-shadow: 0 2px 6px rgba(0,0,0,0.6);
      pointer-events: none;
      user-select: none;
      z-index: 999999;
      font-family: "Segoe UI", Roboto, system-ui, -apple-system, "Helvetica Neue", Arial;
      will-change: left, top, opacity, transform;
      white-space: nowrap;
    }
  `;
  document.head.appendChild(style);
})();

function showDamagePopup(damage, opts = {}) {
  // options
  const duration = opts.duration ?? 900; // ms
  const minRadius = opts.minRadius ?? 36; // px from center
  const maxRadius = opts.maxRadius ?? 120; // px from center
  const fontSize = opts.fontSize ?? Math.max(18, Math.min(40, Math.round(window.innerWidth * 0.03))); // responsive
  const MAX_ROT_DEG = 25; // clamp to ±25 degrees

  // helper to normalize to [-180,180]
  const normalizeDeg = (d) => {
    let a = ((d + 180) % 360);
    if (a < 0) a += 360;
    return a - 180;
  };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // create element
  const el = document.createElement('div');
  el.className = 'damage-popup';
  el.textContent = `${damage}`;
  el.style.fontSize = `${fontSize}px`;
  el.style.fontWeight = '900';
  el.style.color = '#ff2e2e';
  el.style.opacity = '1';
  el.style.transform = 'translate(-50%,-50%) rotate(0deg)';

  // compute center
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;

  // choose a random angle (radians) and radius (px)
  const angle = Math.random() * Math.PI * 2; // full circle
  const radius = minRadius + Math.random() * (maxRadius - minRadius);

  // start position (near center)
  const dx = Math.cos(angle) * radius;
  const dy = Math.sin(angle) * radius;
  const startLeft = Math.round(cx + dx);
  const startTop = Math.round(cy + dy);

  // end position — move further outward
  const outwardFactor = 1.45 + Math.random() * 0.35; // 1.45..1.8
  const endLeft = Math.round(cx + dx * outwardFactor);
  const endTop = Math.round(cy + dy * outwardFactor);

  // rotation — base angle pointing away from center (convert to degrees)
  const angleDeg = angle * (180 / Math.PI); // 0..360
  // normalize then clamp to ±MAX_ROT_DEG, then add small jitter and clamp again
  let rotationDeg = clamp(normalizeDeg(angleDeg) + (Math.random() * 8 - 4), -MAX_ROT_DEG, MAX_ROT_DEG);
  const endRotationDeg = clamp(rotationDeg + (Math.random() * 10 - 5), -MAX_ROT_DEG, MAX_ROT_DEG);

  // style initial placement
  el.style.left = `${startLeft}px`;
  el.style.top = `${startTop}px`;
  el.style.transform = `translate(-50%,-50%) rotate(${rotationDeg}deg)`;
  el.style.opacity = '1';

  document.body.appendChild(el);

  // animate using Web Animations API (fallback to CSS transitions if not supported)
  const easing = 'cubic-bezier(.2,.9,.27,1)';

  if (el.animate) {
    el.animate([
      {
        left: `${startLeft}px`,
        top: `${startTop}px`,
        transform: `translate(-50%,-50%) rotate(${rotationDeg}deg) scale(1)`,
        opacity: 1
      },
      {
        left: `${endLeft}px`,
        top: `${endTop}px`,
        transform: `translate(-50%,-50%) rotate(${endRotationDeg}deg) scale(1.08)`,
        opacity: 0
      }
    ], {
      duration,
      easing,
      fill: 'forwards'
    }).onfinish = () => {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    };
  } else {
    // fallback: CSS transition
    el.style.transition = `left ${duration}ms ${easing}, top ${duration}ms ${easing}, opacity ${Math.round(duration*0.9)}ms ${easing}, transform ${duration}ms ${easing}`;
    requestAnimationFrame(() => {
      el.style.left = `${endLeft}px`;
      el.style.top = `${endTop}px`;
      el.style.transform = `translate(-50%,-50%) rotate(${endRotationDeg}deg) scale(1.08)`;
      el.style.opacity = '0';
    });
    setTimeout(() => {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }, duration + 50);
  }
}

// ---------------------- Integrate with applyDamageToRemote ----------------------
// Updated applyDamageToRemote that calls showDamagePopup for the local shooter when the shot did NOT penetrate.
// NOTE: make sure you have `localPlayerId` defined on the client (the id of the local player).

function applyDamageToRemote(targetId, damage, killerInfo) {
  const {
    id: killerId,
    weapon,
    isHeadshot = false,
    isPenetrationShot = null
  } = killerInfo || {};

  const damageQueueRef = dbRefs?.rootRef?.child('damageQueue');
  const playersRef = dbRefs?.rootRef?.child('players');

  if (!damageQueueRef || !playersRef) {
    console.warn('[applyDamageToRemote] required database references not set—skipping');
    return;
  }

  // Show local damage popup when this client is the shooter AND the bullet DID NOT penetrate.
  // (treat explicit false as "didn't penetrate")
  try {
    if (typeof localPlayerId !== 'undefined' && killerId === localPlayerId && isPenetrationShot === false) {
      // optional: make headshot popups bigger
      const popupDamage = isHeadshot ? `${damage} 💥` : damage;
      showDamagePopup(popupDamage, { duration: 900, minRadius: 36, maxRadius: 110 });
    }
  } catch (err) {
    // don't block server push if UI fails
    console.warn('[applyDamageToRemote] popup error', err);
  }

  // Check the player's current status before applying damage.
  // This is the crucial part to prevent duplicate pushes.
  playersRef.child(targetId).once('value', (snapshot) => {
    const victimData = snapshot.val();

    // If the victim is already dead, don't push a new damage event.
    // This prevents the kill from being logged multiple times.
    if (!victimData || victimData.isDead) {
      console.log(`[applyDamageToRemote] Victim ${targetId} is already dead or not found. Aborting damage push.`);
      return;
    }

    // Push a new damage event to the queue.
    damageQueueRef.push({
      victimId: targetId,
      killerId,
      damage,
      weapon,
      isHeadshot,
      isPenetrationShot,
      timestamp: firebase.database.ServerValue.TIMESTAMP
    })
    .then(() => {
      console.log(`Pushed damage event for ${targetId}`);
    })
    .catch((err) => {
      console.error('[applyDamageToRemote] failed to push damage event', err);
    });
  });
}

window.applyDamageToRemote = applyDamageToRemote;

// --- NEW: Global FFA Active Flag ---
// This flag allows applyDamageToRemote to know if FFA mode is active.
// Set it inside startGame after the ffaEnabled check.
// You might want to adjust its placement based on your overall game state management.
// For example, if you have a dedicated game state object, store it there.
// For now, placing it after startGame to indicate it's set by startGame.
let isFFAActive = false;
window.isFFAActive = isFFAActive;


// — CLEANUP ON UNLOAD —
// Ensure player data is removed from Firebase when the window is closed/reloaded
window.addEventListener("beforeunload", () => {
if (localPlayer) {
playersRef.child(localPlayer.id).remove();
}
// Clear pruning intervals to prevent memory leaks
clearInterval(chatPruneInterval);
clearInterval(killsPruneInterval);
});


document.addEventListener("bulletHoleRemoved", (e) => {
const { id } = e.detail;
const hole = bulletHoleMeshes[id];
if (hole) {
scene.remove(hole);
hole.geometry.dispose();
hole.material.dispose();
delete bulletHoleMeshes[id];
}
});

document.addEventListener("keydown", (e) => {
// Normalize to lowercase so both 'g' and 'G' work.
setTimeout(() => {
if (e.key.toLowerCase() === "g") {
// Only call respawnPlayer() if the overlay is currently shown.


if (respawnOverlay && respawnOverlay.style.display === "flex") {
respawnPlayer();
}
}
}, 200);
});

let prevHealth = 0;
let prevShield = 0;

function checkForDamagePulse() {
// If localPlayer isn't ready, bail out
if (!window.localPlayer) return;

// Only proceed if health/shield are numbers
const hasHealth = typeof window.localPlayer.health === 'number';
const hasShield = typeof window.localPlayer.shield === 'number';

// If we haven’t initialized prevs yet, do it now
if (prevHealth === null || prevShield === null) {
prevHealth = hasHealth ? window.localPlayer.health : 0;
prevShield = hasShield ? window.localPlayer.shield : 0;
return;
}

const health = hasHealth ? window.localPlayer.health : prevHealth;
const shield = hasShield ? window.localPlayer.shield : prevShield;

if (health < prevHealth || shield < prevShield) {
pulseScreenRed();

// If there's information about the last damage source, show the arrow
if (lastDamageSourcePosition) {
const localPlayerPos = window.localPlayer.position; // Assuming localPlayer has a position

// Calculate angle from damage source to local player
const deltaX = lastDamageSourcePosition.x - localPlayerPos.x;
const deltaY = lastDamageSourcePosition.y - localPlayerPos.y;

const angleRad = Math.atan2(deltaY, deltaX);
let angleDeg = angleRad * (180 / Math.PI);

// Adjust angle to make 0 degrees point up, and arrow points from source to player
// If source is right (+X), arrow should point left (180 deg)
// If source is up (-Y), arrow should point down (90 deg)
// This flips the angle to point *towards* the player from the source.
angleDeg = (angleDeg + 180) % 360;

showHitDirectionArrow(angleDeg);
console.log(angleDeg);
// Clear the damage source info after using it
lastDamageSourcePosition = null;
}
}

prevHealth = health;
prevShield = shield;
}





























































































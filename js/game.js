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


function voidEngine({ width = 1280, height = 720 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.style.position = 'relative';
  canvas.style.zIndex = '0';
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // Scratch vars for projections & temp math
  const proj = new THREE.Vector3();
  const tmpPos = new THREE.Vector3();
  const tmpVec = new THREE.Vector3();
  const tmpVec2 = new THREE.Vector3();
  const tmpMat = new THREE.Matrix4();

  // helper: build convex hull (Andrew monotone chain) of 2D points
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
    lower.pop();
    upper.pop();
    return lower.concat(upper);
  }

  // small helper: clamp
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const api = {
    domElement: canvas,
    options: {
      // if you ever want to toggle strict near-plane clipping:
      strictNearClip: true
    },
    setSize(w, h, updateStyle = true) {
      canvas.width = w;
      canvas.height = h;
      if (updateStyle) {
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
    },
    // Minimal clear color support
    setClearColor(hex, alpha = 1) {
      api._clearColor = { hex, alpha };
    },
    _clearColor: { hex: 0x000000, alpha: 1 },

    // Basic render: draw sprites (material.map.image) and approximated shapes for meshes
    render(scene, camera) {
      // Clear with the clear color (converted to CSS)
      const c = api._clearColor;
      const r = (c.hex >> 16) & 0xff;
      const g = (c.hex >> 8) & 0xff;
      const b = c.hex & 0xff;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = `rgba(${r},${g},${b},${c.alpha})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();

      // update camera matrices once
      camera.updateMatrixWorld();
      if (camera.updateProjectionMatrix) camera.updateProjectionMatrix();

      // camera world->camera matrix (inverse of matrixWorld)
      const camInv = tmpMat.copy(camera.matrixWorld).invert();

      // collect drawables (so we can sort by depth)
      const drawables = [];
      scene.traverse((obj) => {
        if (!obj.visible) return;
        if (obj.isCamera || obj.isLight) return;

        // World position (center)
        obj.getWorldPosition(tmpPos);
        proj.copy(tmpPos).project(camera); // NDC -1..1 (center)

        // screen coords of center (used as fallback)
        const sx = (proj.x * 0.5 + 0.5) * canvas.width;
        const sy = (-proj.y * 0.5 + 0.5) * canvas.height;

        // camera-space center Z (used for correct painter's sorting & depth cues)
        const camCenter = tmpPos.clone().applyMatrix4(camInv);
        const camCenterZ = camCenter.z; // negative values are in front of camera for three.js

        // check for texture (sprites)
        const mapImage = obj.material && obj.material.map && obj.material.map.image ? obj.material.map.image : null;

        // If user explicitly wants to always render, skip strict culling checks later
        const alwaysRender = !!obj.userData?.alwaysRender;

        // categorize drawable
        if (mapImage) {
          // Sprite-style: keep rendering (center used for placement)
          drawables.push({
            type: 'image',
            obj,
            sx,
            sy,
            camZ: camCenterZ,
            dist: camera.position.distanceTo(tmpPos),
            projZ: proj.z,
            mapImage
          });
          return;
        } else if (obj.isMesh && obj.geometry) {
          const geom = obj.geometry;
          if (!geom.boundingBox) geom.computeBoundingBox && geom.computeBoundingBox();
          if (!geom.boundingSphere) geom.computeBoundingSphere && geom.computeBoundingSphere();

          // Build sample points in world space (bbox corners, sphere points, or subset of positions)
          const worldPoints = [];
          if (geom.boundingBox) {
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
              worldPoints.push(tmpVec.clone());
            }
          } else if (geom.boundingSphere) {
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
          } else {
            const posAttr = geom.attributes && geom.attributes.position;
            if (posAttr && posAttr.count > 0) {
              for (let i = 0; i < Math.min(12, posAttr.count); i += Math.max(1, Math.floor(posAttr.count / 12))) {
                tmpVec.set(
                  posAttr.getX(i),
                  posAttr.getY(i),
                  posAttr.getZ(i)
                ).applyMatrix4(obj.matrixWorld);
                worldPoints.push(tmpVec.clone());
              }
            } else {
              worldPoints.push(tmpPos.clone());
            }
          }

          // If no world points, fallback to center marker (rare)
          if (worldPoints.length === 0) {
            if (obj.userData?.forceMarker) {
              drawables.push({ type: 'rect', obj, sx, sy, camZ: camCenterZ, dist: camera.position.distanceTo(tmpPos), sizePx: obj.userData?.markerSizePx ?? 6 });
            }
            return;
          }

          // === CLIPPING AGAINST NEAR PLANE (camera space) ===
          // Convert points to camera space (z is negative in front of camera for THREE cameras)
          const camSpacePts = worldPoints.map(wp => wp.clone().applyMatrix4(camInv));

          // near plane in camera space (z <= -near is in front)
          const nearZ = - (camera.near !== undefined ? camera.near : 0.1);
          const farZ = - (camera.far !== undefined ? camera.far : 1e12);

          // Collect projected screen points for those in front of near and within far
          const pts2d = [];
          const ptsCamZ = [];

          for (let i = 0; i < worldPoints.length; i++) {
            const camPt = camSpacePts[i];
            const wp = worldPoints[i];

            if (camPt.z <= nearZ && camPt.z >= farZ) {
              // point is in front of near and not beyond far -> project normally
              proj.copy(wp).project(camera);
              const px = (proj.x * 0.5 + 0.5) * canvas.width;
              const py = (-proj.y * 0.5 + 0.5) * canvas.height;
              pts2d.push({ x: px, y: py, ndcZ: proj.z });
              ptsCamZ.push(camPt.z);
            }
          }

          // For edges that cross the near plane, compute intersection point and include it
          for (let i = 0; i < worldPoints.length; i++) {
            for (let j = i + 1; j < worldPoints.length; j++) {
              const z1 = camSpacePts[i].z;
              const z2 = camSpacePts[j].z;

              // If one side is in front (<= nearZ) and the other is behind (> nearZ), there's a crossing
              if ((z1 <= nearZ && z2 > nearZ) || (z2 <= nearZ && z1 > nearZ)) {
                // Avoid numerical division by zero
                const denom = (z2 - z1);
                if (Math.abs(denom) < 1e-9) continue;
                const t = (nearZ - z1) / denom; // 0..1 along segment i->j where z == nearZ
                if (t < 0 || t > 1) continue;
                // Interpolate in world space to get accurate intersection position
                const ip = worldPoints[i].clone().lerp(worldPoints[j], t);
                proj.copy(ip).project(camera);
                const px = (proj.x * 0.5 + 0.5) * canvas.width;
                const py = (-proj.y * 0.5 + 0.5) * canvas.height;
                pts2d.push({ x: px, y: py, ndcZ: proj.z });
                // approximate camZ for this intersection by interpolating camera-space zs
                const interpCamZ = camSpacePts[i].z + t * (camSpacePts[j].z - camSpacePts[i].z);
                ptsCamZ.push(interpCamZ);
              }
            }
          }

          // If strict near clipping is disabled, include center projection as a loose fallback
          if (!api.options.strictNearClip && pts2d.length === 0) {
            proj.copy(tmpPos).project(camera);
            const px = (proj.x * 0.5 + 0.5) * canvas.width;
            const py = (-proj.y * 0.5 + 0.5) * canvas.height;
            pts2d.push({ x: px, y: py, ndcZ: proj.z });
            ptsCamZ.push(camCenterZ);
          }

          // If after near-plane clipping we have zero pts, we may still want a fallback marker,
          // but only if user asked or object is forced to render.
          if (pts2d.length === 0) {
            if (alwaysRender || obj.userData?.forceMarker) {
              // clamp center to screen bounds so we get a marker on-screen
              const cx = Math.max(0, Math.min(canvas.width, sx));
              const cy = Math.max(0, Math.min(canvas.height, sy));
              drawables.push({ type: 'rect', obj, sx: cx, sy: cy, camZ: camCenterZ, dist: camera.position.distanceTo(tmpPos), sizePx: obj.userData?.markerSizePx ?? 6 });
            }
            return;
          }

          // Build convex hull from the collected projected points
          const hull = convexHull(pts2d);

          // compute average camZ for the captured pts (used for sorting + depth cues)
          const avgCamZ = ptsCamZ.length ? ptsCamZ.reduce((s, v) => s + v, 0) / ptsCamZ.length : camCenterZ;

          // If hull is trivial (1 or 2 points), but user forced rendering, make fallback shapes
          if (hull.length >= 3) {
            drawables.push({ type: 'poly', obj, pts: hull, dist: camera.position.distanceTo(tmpPos), camZ: avgCamZ, projZ: proj.z });
          } else if (hull.length === 2) {
            drawables.push({ type: 'line', obj, pts: hull, dist: camera.position.distanceTo(tmpPos), camZ: avgCamZ });
          } else {
            // single point fallback
            const p = hull[0] || pts2d[0];
            if (alwaysRender || obj.userData?.forceMarker) {
              drawables.push({ type: 'rect', obj, sx: p.x, sy: p.y, dist: camera.position.distanceTo(tmpPos), camZ: avgCamZ, sizePx: obj.userData?.markerSizePx ?? 6 });
            }
          }

          return;
        } else {
          // unknown / fallback: only draw marker if explicitly requested
          if (obj.userData?.forceMarker) {
            drawables.push({ type: 'rect', obj, sx, sy, camZ: camCenterZ, dist: camera.position.distanceTo(tmpPos), sizePx: obj.userData?.markerSizePx ?? 6 });
          }
        }
      });

      // Painter's order: furthest first (more negative camZ => farther). Sort by camZ ascending.
      drawables.sort((a, b) => {
        const az = (a.camZ === undefined ? -1e6 : a.camZ);
        const bz = (b.camZ === undefined ? -1e6 : b.camZ);
        return az - bz;
      });

      // draw
      for (let i = 0; i < drawables.length; i++) {
        const d = drawables[i];
        const { obj } = d;

        // compute depth-based factors (use absolute camZ because camZ is negative in front)
        const camZ = (d.camZ !== undefined ? Math.abs(d.camZ) : 1000); // larger = farther
        const near = camera.near || 0.1;
        const far = camera.far || 10000;
        // normalized depth where 0 => at near, 1 => at far (clamped)
        const normDepth = clamp((camZ - near) / Math.max(1e-3, (far - near)), 0, 1);
        // depth lighting / haze: nearer -> 1, farther -> 0.35
        const depthLight = clamp(1 - normDepth * 0.65, 0.2, 1);

        // common color selection (string style)
        let color = obj.userData?.color;
        if (!color && obj.material && obj.material.color) {
          try {
            color = obj.material.color.getStyle ? obj.material.color.getStyle() : (`#${obj.material.color.getHexString()}`);
          } catch (e) {
            color = obj.userData?.color || 'white';
          }
        }
        color = color || obj.userData?.color || 'white';

        // apply some depth-based shadow parameters
        const shadowOffset = clamp((camZ - near) * 0.02, 0, 40); // px
        const shadowBlur = clamp((camZ - near) * 0.02, 0, 30);
        const baseAlpha = obj.userData?.opacity ?? (obj.material?.opacity ?? 1);

        if (d.type === 'image' && d.mapImage && d.mapImage.width) {
          // Size determination using projected bbox if available, otherwise heuristic on camZ
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
            // fallback: scale with inverse camZ (closer = larger)
            size = Math.max(8, obj.userData?.sizePx ?? 300 * (1 / Math.max(0.001, camZ * 0.05)));
            // clamp to reasonable bounds
            size = clamp(size, 8, Math.max(32, Math.min(canvas.width, canvas.height)));
          }

          ctx.save();
          // depth shadow & alpha
          ctx.globalAlpha = clamp(baseAlpha * depthLight, 0.05, 1);
          ctx.translate(d.sx, d.sy);

          // subtle rotation support
          const rot = obj.userData?.rotation ?? (obj.rotation?.z ?? 0);
          if (rot) ctx.rotate(rot);

          // drop shadow to give depth / height illusion
          ctx.shadowColor = 'rgba(0,0,0,0.45)';
          ctx.shadowBlur = shadowBlur;
          // offset shadow downward/right by small amount proportional to "height" (camZ)
          ctx.shadowOffsetX = shadowOffset * 0.3;
          ctx.shadowOffsetY = shadowOffset * 0.6;

          ctx.drawImage(d.mapImage, -size / 2, -size / 2, size, size);

          // reset shadow for subsequent draws
          ctx.shadowBlur = 0;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 0;
          ctx.restore();

        } else if (d.type === 'poly' && d.pts) {
          ctx.save();

          // fill with depth-chosen alpha (gives atmospheric fade)
          ctx.beginPath();
          ctx.moveTo(d.pts[0].x, d.pts[0].y);
          for (let j = 1; j < d.pts.length; j++) ctx.lineTo(d.pts[j].x, d.pts[j].y);
          ctx.closePath();

          // fill alpha combines baseAlpha and depthLight
          ctx.globalAlpha = clamp(Math.max(0.08, baseAlpha * depthLight), 0.02, 1);

          // soft shadow under shape to suggest separation from background
          ctx.shadowColor = 'rgba(0,0,0,0.35)';
          ctx.shadowBlur = shadowBlur * 0.6;
          ctx.shadowOffsetX = shadowOffset * 0.2;
          ctx.shadowOffsetY = shadowOffset * 0.5;

          ctx.fillStyle = color;
          ctx.fill();

          // stroke with width scaled by depth so close edges read stronger
          ctx.globalAlpha = clamp(0.6 * depthLight, 0.05, 1);
          ctx.lineWidth = Math.max(1, clamp(2.5 * (1 - normDepth), 0.5, 3.5));
          ctx.strokeStyle = 'rgba(0,0,0,0.6)';
          ctx.stroke();

          // reset shadow
          ctx.shadowBlur = 0;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 0;
          ctx.restore();
        } else if (d.type === 'line' && d.pts && d.pts.length === 2) {
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(d.pts[0].x, d.pts[0].y);
          ctx.lineTo(d.pts[1].x, d.pts[1].y);

          ctx.globalAlpha = clamp(baseAlpha * depthLight, 0.05, 1);
          ctx.lineWidth = obj.userData?.lineWidth ?? clamp(3 * (1 - normDepth) + 1, 1, 6);
          ctx.strokeStyle = color;
          ctx.stroke();
          ctx.restore();
        } else if (d.type === 'rect') {
          // small centered rectangle marker (replaces prior circle/sphere)
          const size = d.sizePx ?? Math.max(2, Math.round(12 * (1 / Math.max(0.1, camZ * 0.05))));
          const x = (d.sx || d.sx === 0) ? d.sx : 0;
          const y = (d.sy || d.sy === 0) ? d.sy : 0;
          ctx.save();
          ctx.globalAlpha = clamp(Math.max(0.35, baseAlpha * depthLight), 0.15, 1);

          // small soft shadow
          ctx.shadowColor = 'rgba(0,0,0,0.4)';
          ctx.shadowBlur = shadowBlur * 0.7;
          ctx.shadowOffsetX = shadowOffset * 0.2;
          ctx.shadowOffsetY = shadowOffset * 0.5;

          ctx.fillStyle = color;
          ctx.fillRect(x - size / 2, y - size / 2, size, size);

          ctx.shadowBlur = 0;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 0;
          ctx.restore();
        } else {
          // nothing
        }
      }
    }
  };

  return api;
}


/* ---------- Updated scene initializers (CPU renderer) ---------- */

export async function initSceneCrocodilosConstruction() {
  sceneNum = 1;
  console.log("Initializing CrocodilosConstruction scene...");

  // 1. Scene
  scene = new THREE.Scene();
  const skyGeo = new THREE.SphereGeometry(200, 32, 32).scale(-1, 1, 1);
  const skyMat = new THREE.MeshBasicMaterial({
    color: 0x000022,
    side: THREE.BackSide,
    fog: false
  });
  window.scene = scene;

  window.camera.rotation.order = "YXZ";
  scene.add(window.camera);

  // 3. Renderer (CPU canvas)
  const cpuRenderer = voidEngine({ width: FIXED_WIDTH, height: FIXED_HEIGHT });
  cpuRenderer.setClearColor(0x000000, 1);
  renderer = cpuRenderer;
  window.renderer = renderer;

  const container = document.getElementById("game-container");
  // remove any previous renderer DOM element if present
  if (container) {
    // clear existing children with canvas or WebGLRenderer
    // (be careful not to remove other unrelated DOM nodes)
    const prev = container.querySelector('canvas');
    if (prev) container.removeChild(prev);
    container.appendChild(renderer.domElement);
  }

  // 4. Hemisphere Light (kept for scene lighting math / potential use)
  hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.05);
  scene.add(hemi);
  window.hemi = hemi;

  // 5. Post-processing composer: not available for CPU canvas — null out
  composer = null;
  renderPass = null;
  window.composer = composer;
  window.renderPass = renderPass;

  // --- Initial Detail Setup for CrocodilosConstruction ---
  toggleSceneDetails(detailsEnabled);

  // --- Map and Physics Initialization ---
  spawnPoints = await createCrocodilosConstruction(scene, physicsController);
  window.spawnPoints = spawnPoints;

  const initialSpawnPoint = findFurthestSpawn();
  physicsController.setPlayerPosition(initialSpawnPoint);

  // --- Audio Initialization ---
  if (typeof windSound !== 'undefined') {
    windSound.play().catch(err => console.warn("Failed to play wind sound:", err));
    window.windSound = windSound;
  } else {
    console.warn("windSound is not defined. Audio might not play for CrocodilosConstruction.");
  }

  // --- Window Resize Handling ---
  function onWindowResize() {
    const displayWidth = container.clientWidth;
    const displayHeight = container.clientHeight;

    // 1) Render at fixed internal resolution
    renderer.setSize(FIXED_WIDTH, FIXED_HEIGHT, false);

    // 2) Stretch the canvas via CSS to fill the container
    renderer.domElement.style.width = `${displayWidth}px`;
    renderer.domElement.style.height = `${displayHeight}px`;

    // 3) Update camera aspect ratio
    window.camera.aspect = displayWidth / displayHeight;
    window.camera.updateProjectionMatrix();

    // 4) Re-attach weapon to local player (if needed)
    if (window.weaponController && window.localPlayer && typeof getWeaponModel === 'function' && typeof attachWeaponToPlayer === 'function') {
      const key = window.localPlayer.weapon.replace(/-/g, "").toLowerCase();
      const proto = getWeaponModel(key);
      if (proto) attachWeaponToPlayer(window.localPlayer.id, key);
    }

    // 5) Re-attach weapons for remote players
    if (window.remotePlayers) {
      Object.values(window.remotePlayers).forEach(({ currentWeapon, weaponRoot }) => {
        if (currentWeapon && weaponRoot && typeof attachWeaponToPlayer === 'function') {
          attachWeaponToPlayer(weaponRoot.userData.playerId, currentWeapon);
        }
      });
    }

    // 6) Resize HUD overlay
    const hud = document.getElementById("hud");
    if (hud) {
      hud.style.width = `${displayWidth}px`;
      hud.style.height = `${displayHeight}px`;
    }
  }

  window.addEventListener("resize", onWindowResize, false);
  onWindowResize();
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
const bodyGeom = new THREE.CapsuleGeometry(0.3, 1.3, 4, 8);
const bodyMat = new THREE.MeshStandardMaterial({ color: initialColor });
const bodyMesh = new THREE.Mesh(bodyGeom, bodyMat);
bodyMesh.castShadow = true;
bodyMesh.position.set(0, 0.0 - 1.1, 0); // Position relative to group center
bodyMesh.userData.isPlayerBodyPart = true;
bodyMesh.userData.playerId = data.id;
group.add(bodyMesh);

     if (!bodyMesh.geometry.index) {
    bodyMesh.geometry.setIndex(
      generateSequentialIndices(bodyMesh.geometry.attributes.position.count)
    );
  }
  bodyMesh.geometry.computeBoundsTree();

  group.add(bodyMesh);

// ─── Head ──────────────────────────────────────────────────────────────────────
const headGeom = new THREE.SphereGeometry(0.15, 8, 8);
const headMat = new THREE.MeshStandardMaterial({ color: 0xffffaa });
const headMesh = new THREE.Mesh(headGeom, headMat);
headMesh.castShadow = true;
headMesh.position.set(0, 1.1 - 1.1, 0); // Relative to body/group
headMesh.userData.isPlayerBodyPart = true;
headMesh.userData.playerId = data.id;
headMesh.userData.isPlayerHead = true;
group.add(headMesh);

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
group.add(nameMesh);
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




export function animate(timestamp) {
  // Schedule the next frame first
  requestAnimationFrame(animate);

  // --- Disconnection/Pause Logic ---
  if (localPlayerId === null || window.isGamePaused) {
    return;
  }

  // Frame throttling ~60fps
  const FRAME_INTERVAL = 1000 / 60;
  if (!animate.lastTime) animate.lastTime = timestamp;
  const deltaMs = timestamp - animate.lastTime;
  if (deltaMs < FRAME_INTERVAL) return;
  animate.lastTime = timestamp - (deltaMs % FRAME_INTERVAL);
  const delta = deltaMs / 1000;

  // Pre-animation checks
  if (!physicsController || !weaponController) {
    console.warn("Skipping animate(): controllers not yet initialized");
    postFrameCleanup();
    return;
  }
  if (!window.mapReady) {
    postFrameCleanup();
    return;
  }
  if (!window.localPlayer) {
    console.warn("Skipping animate(): window.localPlayer is not initialized.");
    postFrameCleanup();
    return;
  }

  try {
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

      // Render final frame
      if (composer && typeof composer.render === 'function') {
        composer.render();
      } else if (renderer && typeof renderer.render === 'function') {
        renderer.render(scene, window.camera);
      }

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

    if (weaponController.stats.speedModifier != null) {
      physicsController.setSpeedModifier(weaponController.stats.speedModifier);
    }

    // Remote players falling
    const GRAVITY = 9.8;
    Object.values(window.remotePlayers).forEach(rp => {
      const g = rp.group;
      if (g?.userData.isFalling) {
        g.userData.velocityY = (g.userData.velocityY || 0) + GRAVITY * delta;
        g.position.y -= g.userData.velocityY * delta;
        if (g.position.y < -20) {
          g.userData.isFalling = false;
          g.userData.velocityY = 0;
          g.visible = false;
        }
      }
    });

    if (skyMesh) skyMesh.rotation.x += 0.0001 * deltaMs;
    if (starField) starField.rotation.x += 0.00008 * deltaMs;

    if (window.worldFog) {
      window.worldFog.rotation.y += delta * 0.005;
      const nowMs = performance.now();
      window.worldFog.position.x += Math.sin(nowMs * 0.0001) * delta * 2;
      window.worldFog.position.z += Math.cos(nowMs * 0.0001) * delta * 2;
    }

    // Physics & Input Update
    const physState = physicsController.update(delta, inputState, window.collidables);

    // Weapon Update
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
        rotX: round2(window.camera.rotation.x),
        rotZ: round2(window.camera.rotation.z),
        weapon: window.localPlayer.weapon,
        knifeSwing: window.localPlayer.knifeSwing || false,
        knifeHeavy: window.localPlayer.knifeHeavy || false
      });
      window.localPlayer.knifeSwing = false;
      window.localPlayer.knifeHeavy = false;
    } else {
      console.warn("Skipping sendPlayerUpdate: dbRefs, dbRefs.playersRef or localPlayerId is null.");
    }

    // Remote avatars update
    for (const id in window.remotePlayers) {
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
      } else {
        console.warn("Cannot update local player weapon in Firebase: dbRefs or localPlayerId is null.");
      }

      weaponController.equipWeapon(newW);
      weaponController.ammoInMagazine = weaponAmmo[newW] ?? weaponController.stats.magazineSize;
      updateInventory(newW);
      updateAmmoDisplay(weaponController.ammoInMagazine, weaponController.stats.magazineSize);
      inputState.weaponSwitch = null;
      if (newW === "knife") activeRecoils.length = 0;
    }

    // Mouse look + recoil
    const baseSens = parseFloat(localStorage.getItem("sensitivity") || "5.00");
    const aimMul = inputState.aim ? (window.localPlayer.weapon === "marshal" ? 0.15 : 0.5) : 1;
    const finalSens = baseSens * aimMul;

    window.camera.rotation.y -= inputState.mouseDX * finalSens * 0.002;
    let newPitch = window.camera.rotation.x - inputState.mouseDY * finalSens * 0.002;
    window.camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, newPitch));

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
      window.camera.rotation.x += totalOffset;
    }

    // Rebuild collidables
    if (window.mapReady) {
      window.collidables = [...window.envMeshes];
      for (const otherId in window.remotePlayers) {
        if (otherId === window.localPlayer.id) continue;
        const other = window.remotePlayers[otherId];
        if (other.group?.visible) {
          other.group.traverse(child => {
            if (child.isMesh && child.userData?.isPlayerBodyPart) window.collidables.push(child);
          });
        }
      }
    }

    // Render
    if (composer && typeof composer.render === 'function') {
      composer.render();
    } else if (renderer && typeof renderer.render === 'function') {
      renderer.render(scene, window.camera);
    }
  } catch (err) {
    console.error("Error in animate:", err);
  } finally {
    postFrameCleanup();
  }
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




































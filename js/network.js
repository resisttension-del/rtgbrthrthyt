// network.js
import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";

// ff ff 
// New imports for game slot management
import {
    claimGameSlot,
    releaseGameSlot,
    gamesRef,
    gameDatabaseConfigs,
    initGameFirebaseApp
} from "./firebase-config.js";

import { isMessageClean, filterOrMaskMessage, diagnoseMessage, sanitizeMessage } from './chatFilter.js';

// Re-importing existing functions from game.js and ui.js
// Ensure these paths are correct relative to network.js
import {
    addRemotePlayer,
    removeRemotePlayer as removeRemotePlayerModel,
    updateRemotePlayer,
    pulsePlayerHit,
    incrementUserStat,
    KILLSTREAK_SOUNDS,
    handleLocalDeath // Assuming this handles respawn too
} from "./game.js";

import {
    addChatMessage,
    updateKillFeed,
    updateScoreboard,
    createTracer,
    removeTracer,
    updateHealthShieldUI,
    setUIDbRefs, // This will be used to pass the game-specific dbRefs to UI
    addBulletHole,
    removeBulletHole
} from "./ui.js";

import { WeaponController } from "./weapons.js";
import { AudioManager } from "./AudioManager.js";
import { SOUND_CONFIG } from './soundConfig.js'; // Ensure the path is correct

const PHYSICS_SOUNDS = {
    footstep: { run: 'https://codehs.com/uploads/616ef1b61061008f9993d1ab4fa323ba' },
    landingThud: { land: 'https://codehs.com/uploads/600ab769d99d74647db55a468b19761f' }
};

export let localPlayerId = null;
export const remotePlayers = {}; // This is where Three.js objects for remote players are stored
const permanentlyRemoved = new Set(); // Tracks players confirmed disconnected
let latestValidIds = []; // Used in purgeNamelessPlayers

let audioManagerInstance = null;
export let dbRefs = {}; // Will hold game-specific Firebase references (playersRef, chatRef, etc.)

let activeGameSlotName = null; // Stores the name of the currently claimed game slot

// Store listeners so they can be detached
let playersListener = null;
let ownPlayerValueListener = null;
let ownPlayerRef = null; 
let chatListener = null;
let killsListener = null;
let mapStateListener = null;
let tracersListener = null;
let soundsListener = null;
let gameConfigListener = null; // New listener for game config changes (e.g., timer)


// --- Core AudioManager Initialization & Listener Functions (from your original code) ---

export function initializeAudioManager(camera, scene) {
    console.log("Attempting to initialize AudioManager...");
    if (!camera || !scene) {
        console.error("Cannot initialize AudioManager: Camera or Scene are undefined/null. AudioManager will not be created.");
        return;
    }
    if (audioManagerInstance) {
        console.warn("AudioManager already initialized. Stopping existing sounds and reinitializing.");
        audioManagerInstance.stopAll();
    }
    audioManagerInstance = new AudioManager(camera, scene, { hearingRange: 50 });
    window.audioManager = audioManagerInstance; // Global access for game.js
    console.log("AudioManager successfully initialized with camera:", camera.uuid, "at initial position:", camera.position.toArray());
}

export let activeGameId = null;

// add this:
export function setActiveGameId(id) {
  activeGameId = id;
}

export function startSoundListener() {
  if (!dbRefs || !dbRefs.soundsRef) {
    console.error("Cannot start sound listener: dbRefs or soundsRef not initialized.");
    return;
  }

  dbRefs.soundsRef.off();

  dbRefs.soundsRef.on("child_added", (snap) => {
    const data = snap.val();
    const soundRef = snap.ref;

    if (!data || data.shooter === localPlayerId) {
      if (data.shooter === localPlayerId) {
        setTimeout(() => {
          soundRef.remove().catch(err => console.error("Failed to remove own sound event from Firebase:", err));
        }, 10000);
      }
      return;
    }

    setTimeout(() => {
      soundRef.remove().catch(err => console.error("Failed to remove sound event from Firebase after 10s:", err));
    }, 3000);

    const url = WeaponController.SOUNDS[data.soundKey]?.[data.soundType] ??
      PHYSICS_SOUNDS[data.soundKey]?.[data.soundType];

    if (!url) {
      console.warn(`No URL found for soundKey: ${data.soundKey}, soundType: ${data.soundType}`);
      return;
    }

    const worldPos = new THREE.Vector3(data.x, data.y, data.z);

    if (audioManagerInstance) {
      // Get sound properties from SOUND_CONFIG
      const soundProps = SOUND_CONFIG[data.soundKey]?.[data.soundType];
      if (soundProps) {
        audioManagerInstance.playSpatial(
          url,
          worldPos,
          {
            loop: soundProps.loop ?? false, // Default to false if not specified
            volume: soundProps.volume,
            hearingRange: soundProps.hearingRange,
            rolloffFactor: soundProps.rolloffFactor,
            distanceModel: soundProps.distanceModel
          }
        );
      } else {
        // Fallback to default values if not found in SOUND_CONFIG
        console.warn(`Sound properties not found for ${data.soundKey}:${data.soundType}. Playing with defaults.`);
        audioManagerInstance.playSpatial(url, worldPos, { loop: false, volume: 1, hearingRange: 100, rolloffFactor: 2, distanceModel: 'linear' });
      }
    } else {
      console.warn("AudioManager not initialized when trying to play spatial sound (after startSoundListener called).");
    }
  });
  console.log("Firebase sound listener started.");
}


// --- Player Data Update Functions (from your original code) ---

let lastSync = 0;
export function sendPlayerUpdate(data) {
    const now = Date.now();
    if (now - lastSync < 50) return; // Limit update frequency
    lastSync = now;
    if (dbRefs.playersRef && localPlayerId) { // Check for playersRef from the current game slot
        dbRefs.playersRef.child(localPlayerId).update({
            x: data.x,
            y: data.y,
            z: data.z,
            rotY: data.rotY,
            rotX: data.rotX,
            rotZ: data.rotZ,
            weapon: data.weapon,
            knifeSwing: data.knifeSwing, // Include knife animation states
            knifeHeavy: data.knifeHeavy
        }).catch(err => console.error("Failed to send player update:", err));
    } else {
        // console.warn("Attempted to send player update before network initialized or localPlayerId is null."); // Too chatty
    }
}
export function updateHealth(health) {
    if (dbRefs.playersRef && localPlayerId) {
        dbRefs.playersRef.child(localPlayerId).update({ health }).catch(err => console.error("Failed to update health:", err));
    }
}

export function updateShield(shield) {
    if (dbRefs.playersRef && localPlayerId) {
        dbRefs.playersRef.child(localPlayerId).update({ shield }).catch(err => console.error("Failed to update shield:", err));
    }
}
// --- Event Sending Functions (Tracers, Chat, Bullet Holes, Sounds) ---

export function sendTracer(tracerData) {
    if (dbRefs.tracersRef) { // Check for tracersRef from the current game slot
        dbRefs.tracersRef.push({
            ...tracerData,
            shooter: localPlayerId,
            time: firebase.database.ServerValue.TIMESTAMP
        }).catch((err) => console.error("Failed to send tracer:", err));
    } else {
        // console.warn("Attempted to send tracer before network initialized or dbRefs.tracersRef is null."); // Too chatty
    }
}

export function sendChatMessage(username, text) {
    let sanitizedText = text;

    try {
        if (typeof filterOrMaskMessage === "function") {
            const res = filterOrMaskMessage(text);
            if (!res.allowed) return console.warn("Message blocked due to profanity/slurs");
            sanitizedText = res.text;
        } else if (typeof diagnoseMessage === "function") {
            const diag = diagnoseMessage(text);
            if (diag && diag.blocked) {
                if (typeof sanitizeMessage === "function") {
                    sanitizedText = sanitizeMessage(text);
                } else {
                    return console.warn("Message blocked due to profanity/slurs");
                }
            }
        }
    } catch (err) {
        console.error("Autofilter error (chat) — using original:", err);
        sanitizedText = text;
    }

    if (sanitizedText.length > 100) {
        console.warn("Message too long — not sent");
        return;
    }

    if (dbRefs.chatRef) {
        dbRefs.chatRef.push({ username, text: sanitizedText, timestamp: Date.now() })
            .catch((err) => console.error("Failed to send chat message:", err));
    } else {
        console.warn("Attempted to send chat message before network initialized.");
    }
}

export function sendBulletHole(pos) {
    if (dbRefs.mapStateRef) { // Check for mapStateRef from the current game slot
        dbRefs.mapStateRef.child("bullets").push({
            x: pos.x, y: pos.y, z: pos.z,
            nx: pos.nx, ny: pos.ny, nz: pos.nz,
            timeCreated: Date.now() // Use Date.now() for client-side timestamp
        }).catch(err => console.error("Failed to send bullet hole:", err));
    } else {
        // console.warn("Attempted to send bullet hole before network initialized or dbRefs.mapStateRef is null."); // Too chatty
    }
}

export function sendSoundEvent(soundKey, soundType, position) {
    if (dbRefs.soundsRef) { // Check for soundsRef from the current game slot
        const soundProps = SOUND_CONFIG[soundKey]?.[soundType];
        if (!soundProps) {
            console.warn(`Sound properties for ${soundKey}:${soundType} not found in SOUND_CONFIG. Event will be sent with minimal data.`);
            dbRefs.soundsRef.push({
                soundKey, soundType,
                x: position.x, y: position.y, z: position.z,
                shooter: localPlayerId,
                time: firebase.database.ServerValue.TIMESTAMP
            }).catch(err => console.error("Failed to send sound event:", err));
            return;
        }

        dbRefs.soundsRef.push({
            soundKey,
            soundType,
            x: position.x,
            y: position.y,
            z: position.z,
            shooter: localPlayerId,
            time: firebase.database.ServerValue.TIMESTAMP,
            volume: soundProps.volume,
            hearingRange: soundProps.hearingRange,
            rolloffFactor: soundProps.rolloffFactor,
            distanceModel: soundProps.distanceModel,
            loop: soundProps.loop ?? false
        }).catch(err => console.error("Failed to send sound event:", err));
    } else {
        console.warn("Attempted to send sound event before network initialized or dbRefs.soundsRef is null.");
    }
}

export async function disposeGame() {
  console.log("[network.js] Disposing game…");

  // 1) Run your existing cleanup of Firebase + slot
  await endGameCleanup();

  // 2) Clear any game‑side intervals and listeners
  if (window.gameInterval) {
    clearInterval(window.gameInterval);
    window.gameInterval = null;
  }
  if (window.playersKillsListener && window.dbRefs?.playersRef) {
    window.dbRefs.playersRef.off("value", window.playersKillsListener);
    window.playersKillsListener = null;
  }

  // 3) Cancel the animation loop
  if (window._animationId != null) {
    cancelAnimationFrame(window._animationId);
    window._animationId = null;
  }

  // 4) Stop all audio
  if (window.audioManager) {
    window.audioManager.stopAll();
  }
  [ window.deathTheme, window.windSound, window.forestNoise ]
    .forEach(sound => { if (sound && sound.pause) sound.pause(); });

  console.log("[network.js] Game disposed.");
}

// --- Player Purging and Disconnection ---

export function purgeNamelessPlayers(validIds = []) {
    Object.keys(remotePlayers).forEach(id => {
        const rp = remotePlayers[id];
        // If player has no username (indicates incomplete data) OR is not in the latest valid IDs list
        if (!rp?.data?.username || (validIds.length && !validIds.includes(id))) {
            permanentlyRemoved.add(id);
            console.log(`[purgeNameless] Permanently removing ${id}`);
            removeRemotePlayerModel(id);
        }
    });
}

export async function disconnectPlayer(playerId) {
  if (!dbRefs.playersRef) {
    console.warn("Cannot disconnect player: dbRefs not initialized.");
    return;
  }

  if (playerId === localPlayerId) {
    console.log("Disconnecting local player:", playerId);
    try {
      await remove(ref(dbRefs.playersRef, playerId));
      console.log(`Local player ${playerId} removed from Firebase.`);
    } catch (err) {
      console.error("Failed to remove local player from Firebase:", err);
    }

    localPlayerId = null;
    location.reload(); // Reload only after the database operation is complete
  } else {
    console.log("Disconnecting remote player:", playerId);
    removeRemotePlayerModel(playerId);
    delete remotePlayers[playerId];
    permanentlyRemoved.add(playerId);
  }
}

window.disconnectPlayer = disconnectPlayer; // Make accessible globally for button presses etc.

// --- Game End Cleanup ---

export async function endGameCleanup() {
    console.log("[network.js] Running endGameCleanup...");

    // Detach listeners robustly using the refs' .off() when available.
    try {
        if (dbRefs?.playersRef) {
            if (playersListener && typeof dbRefs.playersRef.off === "function") {
                dbRefs.playersRef.off("value", playersListener);
            } else if (typeof dbRefs.playersRef.off === "function") {
                dbRefs.playersRef.off();
            }
            playersListener = null;
            console.log("Players listener detached.");
        }
    } catch (e) {
        console.warn("Failed to detach players listener:", e);
        playersListener = null;
    }

    try {
        if (dbRefs?.chatRef) {
            if (chatListener && typeof dbRefs.chatRef.off === "function") {
                dbRefs.chatRef.off("child_added", chatListener);
            } else if (typeof dbRefs.chatRef.off === "function") {
                dbRefs.chatRef.off();
            }
            chatListener = null;
            console.log("Chat listener detached.");
        }
    } catch (e) {
        console.warn("Failed to detach chat listener:", e);
        chatListener = null;
    }

    try {
        if (dbRefs?.killsRef) {
            if (killsListener && typeof dbRefs.killsRef.off === "function") {
                dbRefs.killsRef.off("child_added", killsListener);
            } else if (typeof dbRefs.killsRef.off === "function") {
                dbRefs.killsRef.off();
            }
            killsListener = null;
            console.log("Kills listener detached.");
        }
    } catch (e) {
        console.warn("Failed to detach kills listener:", e);
        killsListener = null;
    }

    try {
        if (dbRefs?.mapStateRef) {
            if (mapStateListener && typeof dbRefs.mapStateRef.child === "function") {
                // if you attached child listeners, try to detach them
                if (typeof mapStateListener === "function" && typeof dbRefs.mapStateRef.child === "function") {
                    dbRefs.mapStateRef.child("bullets").off("child_added", mapStateListener);
                }
            } else if (typeof dbRefs.mapStateRef.off === "function") {
                dbRefs.mapStateRef.off();
            }
            mapStateListener = null;
            console.log("MapState listener detached.");
        }
    } catch (e) {
        console.warn("Failed to detach mapState listener:", e);
        mapStateListener = null;
    }

    try {
        if (dbRefs?.tracersRef) {
            if (tracersListener && typeof dbRefs.tracersRef.off === "function") {
                dbRefs.tracersRef.off("child_added", tracersListener);
            } else if (typeof dbRefs.tracersRef.off === "function") {
                dbRefs.tracersRef.off();
            }
            tracersListener = null;
            console.log("Tracers listener detached.");
        }
    } catch (e) {
        console.warn("Failed to detach tracers listener:", e);
        tracersListener = null;
    }

    try {
        if (dbRefs?.soundsRef) {
            if (soundsListener && typeof dbRefs.soundsRef.off === "function") {
                dbRefs.soundsRef.off("child_added", soundsListener);
            } else if (typeof dbRefs.soundsRef.off === "function") {
                dbRefs.soundsRef.off();
            }
            soundsListener = null;
            console.log("Sounds listener detached.");
        }
    } catch (e) {
        console.warn("Failed to detach sounds listener:", e);
        soundsListener = null;
    }

    try {
        if (dbRefs?.gameConfigRef) {
            if (gameConfigListener && typeof dbRefs.gameConfigRef.off === "function") {
                dbRefs.gameConfigRef.off("value", gameConfigListener);
            } else if (typeof dbRefs.gameConfigRef.off === "function") {
                dbRefs.gameConfigRef.off();
            }
            gameConfigListener = null;
            console.log("GameConfig listener detached.");
        }
    } catch (e) {
        console.warn("Failed to detach gameConfig listener:", e);
        gameConfigListener = null;
    }

    if (audioManagerInstance) {
        audioManagerInstance.stopAll();
        console.log("Audio manager stopped all sounds.");
    }

    // Remove the local player entry in a way that works for both compat and modular refs
    if (dbRefs?.playersRef && localPlayerId) {
        try {
            if (typeof dbRefs.playersRef.child === "function") {
                // compat-style ref
                await dbRefs.playersRef.child(localPlayerId).remove();
            } else {
                // fallback to modular-style remove(ref(db, path))
                try {
                    const db = getDatabase(firebase.app(activeGameSlotName + "App"));
                    const modularRef = ref(db, `game/${activeGameId}/players/${localPlayerId}`);
                    await remove(modularRef);
                } catch (innerErr) {
                    console.error("Fallback removal failed (modular attempt):", innerErr);
                    throw innerErr;
                }
            }
            console.log(`Local player '${localPlayerId}' explicitly removed from Firebase.`);
        } catch (error) {
            console.error(`Error removing local player '${localPlayerId}' from Firebase during cleanup:`, error);
        }
    }

    if (activeGameSlotName) {
        try {
            await releaseGameSlot(activeGameSlotName);
            console.log(`Game slot '${activeGameSlotName}' released AND lobby entry removed.`);
        } catch (e) {
            console.warn("releaseGameSlot failed during cleanup:", e);
        }
        localStorage.removeItem(`playerId-${activeGameSlotName}`);
        activeGameSlotName = null;
    }

    localPlayerId = null;
    dbRefs = {};

    for (const id in remotePlayers) {
        removeRemotePlayerModel(id);
    }
    for (const key in remotePlayers) {
        delete remotePlayers[key];
    }
    permanentlyRemoved.clear();
    latestValidIds = [];

    console.log("[network.js] Game cleanup complete. All listeners detached and data cleared.");
}


/**
 * Initializes the network connection for a new game.
 * Claims a game slot, sets up Firebase references, and attaches listeners.
 * @param {string} username - The username of the player joining the game.
 * @param {string} mapName - The name of the map for the game.
 * @param {boolean} ffaEnabled - True if FFA mode is enabled, false otherwise.
 * @returns {Promise<boolean>} True if network initialization was successful, false otherwise.
 */
export async function initNetwork(username, mapName, gameId, ffaEnabled) {
  console.log("[network.js] initNetwork for", username, mapName, gameId, ffaEnabled);
  await endGameCleanup();

  // --- get slot name from lobby ---
  const slotSnap = await gamesRef.child(gameId + "/slot").once("value");
  const slotName = slotSnap.val();
  if (!slotName) {
    Swal.fire('Error', 'No slot associated with that game ID.', 'error');
    return false;
  }
  activeGameId = gameId;
  activeGameSlotName = slotName;

  // --- init firebase app for this slot (auth + db) ---
  const gameAuthResult = await initGameFirebaseApp(slotName);
  if (!gameAuthResult) {
    console.error("Failed to initialize Firebase app or authenticate for game slot.");
    return false;
  }
  const {
    slotApp,
    userId,
    dbRefs: newDbRefs
  } = gameAuthResult;

  const slotDb = slotApp.database(); // compat-style Database instance
  const gameRootRef = slotDb.ref(`game/${gameId}`);

  // Build canonical refs nested under game/<gameId>
  dbRefs = {
    rootRef: gameRootRef,
    playersRef: gameRootRef.child("players"),
    chatRef: gameRootRef.child("chat"),
    killsRef: gameRootRef.child("kills"),
    mapStateRef: gameRootRef.child("mapState"),
    tracersRef: gameRootRef.child("tracers"),
    soundsRef: gameRootRef.child("sounds"),
    gameConfigRef: gameRootRef.child("gameConfig"),
    damageQueueRef: gameRootRef.child('damageQueue')
  };
  setUIDbRefs(dbRefs);

  // Diagnostic: log the actual paths we're using (very helpful when debugging rules)
  try {
    console.log("[network.js] DB refs bound to paths:",
      "players:", dbRefs.playersRef.toString(),
      "chat:", dbRefs.chatRef.toString(),
      "kills:", dbRefs.killsRef.toString()
    );
  } catch (e) {
    console.log("[network.js] (diagnostic) couldn't stringify refs:", e);
  }

  // --- Player count check (using the namespaced playersRef) ---
  const currentPlayersSnap = await dbRefs.playersRef.once("value");
  const playerCount = currentPlayersSnap.exists() ? Object.keys(currentPlayersSnap.val()).length : 0;
if (playerCount >= 10) {
    Swal.fire({
        icon: 'warning',
        title: 'Game Full',
        text: 'Sorry, this game slot already has 10 players.'
    }).then(() => {
        location.reload();
    });
    return false;
}

  console.log(`[network.js] Using slot "${slotName}" with DB URL ${slotApp.options.databaseURL}`);

  // --- Force correct ID from auth (guarantees localPlayerId === auth.uid) ---
  // userId comes from initGameFirebaseApp and should be the signed-in auth UID
  const correctPlayerId = userId;
  if (!correctPlayerId) {
    console.error("[network.js] No auth UID available (userId is falsy). Aborting initNetwork.");
    Swal.fire('Error', 'Authentication failed (no UID).', 'error');
    return false;
  }

  // Overwrite localStorage for this slot with the authenticated UID (ensures rule match)
  localStorage.setItem(`playerId-${activeGameSlotName}`, correctPlayerId);
  localPlayerId = correctPlayerId;
  window.localPlayerId = correctPlayerId;
  console.log(`[network.js] Using auth.uid as localPlayerId: ${correctPlayerId}`);

  // --- Bind playerRef AFTER correcting ID (so rules like auth.uid === $playerId pass) ---
  const playerRef = dbRefs.playersRef.child(correctPlayerId);

  // Clean up on disconnect
  try {
    await playerRef.onDisconnect().remove();
    console.log(`[network.js] onDisconnect set for player '${correctPlayerId}'.`);
  } catch (err) {
    console.error(`[network.js] Error setting onDisconnect for player '${correctPlayerId}':`, err);
  }

  // --- initial player payload ---
  const initialPlayerState = {
    id: correctPlayerId,
    username,
    x: 0,
    y: 0,
    z: 0,
    rotY: 0,
    health: 100,
    shield: 50,
    weapon: "knife",
    kills: 0,
    deaths: 0,
    ks: 0,
    isDead: false,
    bodyColor: Math.floor(Math.random() * 0xffffff),
  };

  // --- Write initial player to DB (this should now meet the ".write": "auth.uid === $playerId" rule) ---
  try {
    await playerRef.set(initialPlayerState);
    console.log("Local player initial state set in Firebase for slot:", activeGameSlotName);
  } catch (err) {
    console.error("Failed to set initial player data:", err);
    // Helpful debug info for permission_denied: log error.code/message
    if (err && err.code) console.error("Firebase error code:", err.code);
    Swal.fire({
      icon: 'error',
      title: 'Firebase Error',
      text: 'Could not write initial player data. Please check connection and try again.'
    });
    if (activeGameSlotName) await releaseGameSlot(activeGameSlotName);
    return false;
  }

  // --- Attach listeners (use the namespaced refs) ---
  setupChatListener(dbRefs.chatRef);
  setupKillsListener(dbRefs.killsRef);
  setupMapStateListener(dbRefs.mapStateRef);
  startSoundListener();
  setupTracerListener(dbRefs.tracersRef);

  // *** ADD THIS LINE TO START THE DAMAGE LISTENER ***
  setupDamageListener(correctPlayerId);

  console.log("[network.js] Network initialization complete.");
  return true;
}

// --- Listener Setup Functions ---
export async function fullCleanup(gameId) {
    console.log("[fullCleanup] START, gameId =", gameId);

    // ✅ Capture BEFORE cleanup processes which might wipe it
    const initialSlotName = activeGameSlotName; // Capture it here
    const initialLocalPlayerId = localPlayerId;

    try {
        // 1) Detach all listeners & remove local player using the *current* state
        // endGameCleanup will also set activeGameSlotName to null, but we've already captured it.
        await endGameCleanup();
        console.log("[fullCleanup] ✓ endGameCleanup complete");
        // 4) Remove from lobby (this is on the *main* gamesRef, not slot-specific)
        if (gameId) {
            await gamesRef.child(gameId).remove();
            console.log(`[fullCleanup] ✓ removed lobby entry gamesRef/${gameId}`);
        } else {
            console.warn("[fullCleanup] no gameId provided, skipping lobby removal from main gamesRef");
        }

        // 5) Dispose Three.js
        if (window.scene) {
            // Your disposeThreeScene function might need to be imported or globally accessible
            if (typeof disposeThreeScene === 'function') {
                disposeThreeScene(window.scene);
            } else {
                console.warn("[fullCleanup] disposeThreeScene function not found. Skipping scene disposal.");
                // Manual basic cleanup if function isn't available
                window.scene.clear();
                window.scene = null;
            }
            console.log("[fullCleanup] ✓ Three.js scene disposed");
        }
        if (window.camera) {
            window.camera = null;
            console.log("[fullCleanup] ✓ camera reference cleared");
        }

        // 6) Clear pointers (already largely done by endGameCleanup, but good to be explicit for fullCleanup's scope)
        activeGameSlotName = null;
        localPlayerId = null;

        console.log("[fullCleanup] END");
        return true;

    } catch (err) {
        console.error("[fullCleanup] ERROR during cleanup:", err);
        throw err; // Re-throw to propagate the error if necessary
    }
}

export function setupDamageListener() {
  if (!dbRefs || !dbRefs.damageQueueRef) {
    console.error("[setupDamageListener] damageQueueRef is not defined. Make sure dbRefs is initialized before calling this.");
    return;
  }

  let naturalRegenTimeout = null;
  let naturalRegenInterval = null;

  const startNaturalRegen = (playerId) => {
    // Clear any existing intervals to prevent multiple running at once
    if (naturalRegenInterval) {
      clearInterval(naturalRegenInterval);
    }

    naturalRegenInterval = setInterval(async () => {
      // Only apply to the local player and if they are not at max health
      if (window.localPlayer && window.localPlayer.id === playerId) {
        const playerSnap = await dbRefs.playersRef.child(playerId).once('value');
        const playerData = playerSnap.val();
        
        if (playerData && playerData.health < 100) {
          const newHealth = Math.min(playerData.health + 1, 100);
          await dbRefs.playersRef.child(playerId).update({ health: newHealth });
          console.log(`[Natural Regen] Player ${playerId} health regenerated to ${newHealth}.`);
        } else if (playerData && playerData.health >= 100) {
          // If health is full, stop the regen interval
          clearInterval(naturalRegenInterval);
          naturalRegenInterval = null;
        }
      }
    }, 100); // Regenerate every 100ms
  };

  dbRefs.damageQueueRef.on('child_added', async (snapshot) => {
    const event = snapshot.val();
    if (!event) return;

    try {
      const [killerSnap, victimSnap] = await Promise.all([
        dbRefs.playersRef.child(event.killerId).once('value'),
        dbRefs.playersRef.child(event.victimId).once('value')
      ]);

      const killerData = killerSnap.val();
      const victimData = victimSnap.val();
      // Abort if killer/victim data is missing or if the victim is already dead
      if (!killerData || !victimData || victimData.isDead) return;

      // --- Damage/shield logic ---
      let newShield = victimData.shield;
      let newHealth = victimData.health;
      let remainingDamage = event.damage;

      if (newShield > 0) {
        const shieldDamage = Math.min(newShield, remainingDamage);
        newShield -= shieldDamage;
        remainingDamage -= shieldDamage;
      }
      newHealth -= remainingDamage;

      // --- Natural Regen Reset Logic ---
      if (event.victimId === window.localPlayer.id) {
        if (naturalRegenTimeout) clearTimeout(naturalRegenTimeout);
        if (naturalRegenInterval) clearInterval(naturalRegenInterval);
        naturalRegenTimeout = setTimeout(() => {
          startNaturalRegen(window.localPlayer.id);
        }, 5000); // 5-second delay
      }

      // --- Fatal hit logic with a transaction to prevent duplicates ---
      if (newHealth <= 0) {
        // Use a transaction on the victim's health to ensure only one client processes the kill
        await dbRefs.playersRef.child(event.victimId).child('isDead').transaction(currentIsDead => {
          // If the victim is already dead according to the database, abort the transaction
          if (currentIsDead === true) {
            return; // Abort the transaction
          }
          // Otherwise, claim the kill by setting isDead to true and let the transaction proceed
          return true;
        }, async (error, committed, transactionSnapshot) => {
          if (error) {
            console.error("Transaction failed:", error);
          } else if (!committed) {
            console.log(`[setupDamageListener] Another client logged the kill for victim ${event.victimId} first. Aborting push.`);
          } else {
            // This block is only executed by the single client whose transaction committed successfully
            console.log(`[setupDamageListener] Committing kill for victim ${event.victimId}.`);

            // --- Update victim's stats (kills, deaths, streak) ---
            const victimUpdate = {
              deaths: (victimData.deaths || 0) + 1,
              ks: 0, // Kill streak resets on death
              shield: 0,
              isDead: true, // This is explicitly set to true after the transaction
            };
            await dbRefs.playersRef.child(event.victimId).update(victimUpdate);

            // --- Update killer's stats with capped siphon effect ---
            const siphonAmount = 50;
            let bonusHealth = Math.min(siphonAmount, 100 - killerData.health);
            let bonusShield = siphonAmount - bonusHealth;

            const newHealthKiller = Math.min(killerData.health + bonusHealth, 100);
            const newShieldKiller = Math.min(killerData.shield + bonusShield, 50);

            const killerUpdate = {
              kills: (killerData.kills || 0) + 1,
              ks: (killerData.ks || 0) + 1,
              health: newHealthKiller,
              shield: newShieldKiller
            };
            await dbRefs.playersRef.child(event.killerId).update(killerUpdate);

            // --- Log the kill to the killfeed only once ---
            const newKillRef = dbRefs.killsRef.push();
            await newKillRef.set({
              killerId: event.killerId,
              victimId: event.victimId,
              weapon: event.weapon,
              isHeadshot: event.isHeadshot ?? false,
              isPenetrationShot: event.isPenetrationShot ?? false,
              timestamp: firebase.database.ServerValue.TIMESTAMP
            });

            // --- Local client-specific UI/sound effects ---
            if (event.killerId === window.localPlayer.id) {
              incrementUserStat(killerData.username, 'kills', 1);
              const streak = Math.min(killerUpdate.ks, 10);
              const url = (typeof KILLSTREAK_SOUNDS !== 'undefined') ? KILLSTREAK_SOUNDS[streak] : null;
              if (url) new Audio(url).play();
              if (typeof pulseScreenWhite === 'function') pulseScreenWhite();
            }
          }
        });

      } else {
        // --- Non-fatal hit ---
        const victimUpdate = {
          shield: newShield,
          health: Math.max(newHealth, 0),
        };
        await dbRefs.playersRef.child(event.victimId).update(victimUpdate);
        
        if (typeof pulsePlayerHit === 'function') {
          pulsePlayerHit(event.victimId);
        }
      }
    } catch (err) {
      console.error('[setupDamageListener] Error processing damage event:', err);
    } finally {
      // It is critical to remove the processed event to prevent re-processing
      snapshot.ref.remove();
    }
  });
}


const DISCONNECT_KEY_PREFIX = 'playerDisconnectNotice';

function _disconnectKey() {
  return `${DISCONNECT_KEY_PREFIX}-${activeGameSlotName || 'default'}`;
}

function setDisconnectNotice(reason) {
  try {
    localStorage.setItem(_disconnectKey(), JSON.stringify({
      reason: reason || 'Disconnected from server',
      time: Date.now()
    }));
  } catch (e) { /* ignore storage errors */ }
}

function clearDisconnectNotice() {
  try { localStorage.removeItem(_disconnectKey()); } catch (e) {}
}

/**
 * Show any pending disconnect notice (call on page load).
 * Loads SweetAlert2 from CDN if necessary; falls back to swal() or alert().
 */
function showDisconnectNoticeIfAny() {
  try {
    const raw = localStorage.getItem(_disconnectKey());
    if (!raw) return;
    // remove it immediately so it only shows once
    localStorage.removeItem(_disconnectKey());
    let payload;
    try { payload = JSON.parse(raw); } catch (e) { payload = { reason: String(raw) }; }
    const text = payload.reason || 'You were disconnected.';

    const runAlert = () => {
      if (window.Swal && typeof Swal.fire === 'function') {
        Swal.fire({
          icon: 'warning',
          title: 'Disconnected',
          text,
          confirmButtonText: 'OK'
        });
      } else if (window.swal && typeof swal === 'function') {
        // legacy SweetAlert
        swal('Disconnected', text, 'warning');
      } else {
        alert(`Disconnected: ${text}`);
      }
    };

    // If neither Swal nor swal present, try to load SweetAlert2, otherwise fallback
    if (!window.Swal && !window.swal) {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/sweetalert2@11';
      script.onload = runAlert;
      script.onerror = runAlert;
      document.head.appendChild(script);
    } else {
      runAlert();
    }
  } catch (e) {
    try { localStorage.removeItem(_disconnectKey()); } catch (e2) {}
  }
}

// Ensure this runs after the DOM is available (so SweetAlert script injection and UI works)
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', showDisconnectNoticeIfAny);
} else {
  showDisconnectNoticeIfAny();
}

// --- Updated listeners (replace your existing functions with these) ---
export function attachOwnPlayerListener(playersRef, playerId) {
  // detach previous own listener if any
  if (ownPlayerRef && ownPlayerValueListener) {
    ownPlayerRef.off("value", ownPlayerValueListener);
    ownPlayerRef = null;
    ownPlayerValueListener = null;
  }

  if (!playerId) return;

  // Make a child ref to the local player's node and listen for existence
  ownPlayerRef = playersRef.child ? playersRef.child(playerId) : playersRef.ref.child(playerId);
  ownPlayerValueListener = ownPlayerRef.on("value", (snap) => {
    if (!snap.exists()) {
      console.warn("[ownPlayerListener] Local player node is gone — reloading.");
      // Save notice so after reload we show the SweetAlert
      setDisconnectNotice('Your player was removed from the server (disconnected).');

      // Clean slot-specific storage here so reload starts fresh
      try { localStorage.removeItem(`playerId-${activeGameSlotName}`); } catch (e) {}

      localPlayerId = null;
      location.reload();
      return;
    }

    // Node exists — check for required fields (username). If missing, force reload.
    const data = snap.val();
    if (!data || !data.username) {
      console.warn("[ownPlayerListener] Local player node missing username — reloading.");
      setDisconnectNotice('Your player record is incomplete (missing username).');

      try { localStorage.removeItem(`playerId-${activeGameSlotName}`); } catch (e) {}

      localPlayerId = null;
      location.reload();
      return;
    }

    // Node exists and has a username — sync any server-driven fields if needed
    if (window.localPlayer && typeof data.health === "number") {
      window.localPlayer.health = data.health;
      updateHealthShieldUI(window.localPlayer.health, window.localPlayer.shield);
    }
  });
}

export function detachOwnPlayerListener() {
  if (ownPlayerRef && ownPlayerValueListener) {
    ownPlayerRef.off("value", ownPlayerValueListener);
    ownPlayerRef = null;
    ownPlayerValueListener = null;
  }
}

export function setupPlayersListener(playersRef) {
  // Detach previous listeners before attaching new ones
  playersRef.off("value");
  playersRef.off("child_added");
  playersRef.off("child_changed");
  playersRef.off("child_removed");

  playersListener = playersRef.on("value", (fullSnap) => {
    const allIds = [];
    fullSnap.forEach(s => allIds.push(s.key));
    latestValidIds = allIds;
    purgeNamelessPlayers(latestValidIds);

    // Pass the snapshot directly to updateScoreboard to avoid an extra DB read,
    // and to ensure updateScoreboard never receives 'undefined'.
    updateScoreboard(fullSnap);
  });

  // If we already have a localPlayerId, attach the dedicated listener for it
  if (localPlayerId) {
    attachOwnPlayerListener(playersRef, localPlayerId);
  }

  playersRef.on("child_added", (snap) => {
    const data = snap.val();
    const id = data.id;
    console.log(`[playersRef:child_added] Event for player ID: ${id}`);

    // If this is the local player's node, check username presence and reload if missing.
    if (id === localPlayerId) {
      if (!data.username) {
        console.warn(`[playersRef:child_added] Local player ${id} added but missing username — reloading.`);
        setDisconnectNotice('Your player joined but username is missing (re-auth required).');
        try { localStorage.removeItem(`playerId-${activeGameSlotName}`); } catch (e) {}
        localPlayerId = null;
        location.reload();
        return;
      }
      console.log(`[playersRef:child_added] Skipping local player ${id}.`);
      return;
    }

    if (permanentlyRemoved.has(id)) {
      permanentlyRemoved.delete(id); // Player re-joined
      console.log(`[permanentlyRemoved] Player ${id} re-joined, clearing from permanent removal list.`);
    }

    // Explicit check to prevent adding a player model if it's already in our local cache
    if (remotePlayers[id]) {
      console.warn(`[playersRef:child_added] Player ${id} already exists in remotePlayers. Skipping model creation.`);
      return;
    }

    // Check for essential data before adding the player model
    if (!data.username) {
      console.warn(`[playersRef:child_added] Player ${id} has incomplete data (missing username). Skipping model creation.`);
      return;
    }

    // If all checks pass, add the remote player model
    addRemotePlayer(data);
  });

  playersRef.on("child_changed", (snap) => {
    const data = snap.val();
    const id = data.id;

    if (permanentlyRemoved.has(id)) {
      removeRemotePlayerModel(id); // Ensure we don't update models of removed players
      return;
    }

    // If the local player's DB node lost its username, force reload.
    if (id === localPlayerId) {
      if (!data.username) {
        console.warn(`[playersRef:child_changed] Local player ${id} changed but is missing username — reloading.`);
        setDisconnectNotice('Your player record lost its username (disconnected).');
        try { localStorage.removeItem(`playerId-${activeGameSlotName}`); } catch (e) {}
        localPlayerId = null;
        location.reload();
        return;
      }

      if (window.localPlayer) {
        // Only update localPlayer's health/shield/death status from DB if it changed
        if (typeof data.health === "number") {
          window.localPlayer.health = data.health;
        }
        if (typeof data.shield === "number") {
          window.localPlayer.shield = data.shield;
        }
        if (typeof data.isDead === "boolean") {
          if (!window.localPlayer.isDead && data.isDead) {
            handleLocalDeath(data.killerUsername || "Unknown Player");
          }
          window.localPlayer.isDead = data.isDead;
        }
        updateHealthShieldUI(window.localPlayer.health, window.localPlayer.shield);

        // Update local player's body color if changed (for visual feedback/debugging)
        if (window.localPlayer.bodyMesh && typeof data.bodyColor === "number" &&
            window.localPlayer.bodyMesh.material.color.getHex() !== data.bodyColor) {
          window.localPlayer.bodyMesh.material.color.setHex(data.bodyColor);
        }
      }
    } else {
      updateRemotePlayer(data); // Update remote player's model and data
    }
  });

  playersRef.on("child_removed", (snap) => {
    const id = snap.key;
    // If the removed child *is* the local player, we want to make sure reload happens.
    if (id === localPlayerId) {
      console.warn("Local player removed from Firebase. Handling disconnection.");
      // Save a reason so after reload we alert the user
      setDisconnectNotice('You were disconnected (your player node was removed).');

      // Note: we still clear storage for that slot so reload starts clean.
      try { localStorage.removeItem(`playerId-${activeGameSlotName}`); } catch (e) {}
      // We *do not* directly call location.reload() here — rely on attachOwnPlayerListener
      // to detect the absence of the node and reload. This avoids races.
      return;
    }
    permanentlyRemoved.add(id);
    removeRemotePlayerModel(id);
  });
}

function setupChatListener(chatRef) {
    if (chatListener) chatRef.off("child_added", chatListener); // Detach previous
    const chatSeenKeys = new Set();
    chatListener = chatRef.on("child_added", (snap) => {
        const { username: u, text } = snap.val();
        const key = snap.key;
        if (chatSeenKeys.has(key)) return;
        chatSeenKeys.add(key);
        addChatMessage(u, text, key);
    });
}

function setupKillsListener(killsRef) {
  // Detach old listener before attaching new one to prevent duplicates
  if (killsListener) {
    killsRef.off("child_added", killsListener);
  }
  
  // Use a map to track and prevent duplicate processing of kill events
  const killsSeenKeys = new Set();
  
  killsListener = killsRef.on("child_added", async (snap) => {
    const k = snap.val() || {};
    const key = snap.key;

    // Check if this key has already been processed to avoid re-running logic
    if (killsSeenKeys.has(key)) {
      return;
    }
    killsSeenKeys.add(key);

    const killerId = k.killerId;
    const victimId = k.victimId;

    // --- FIX START ---
    // The previous code was referencing a global 'db' object that doesn't exist.
    // We now use the correctly initialized 'dbRefs' object to fetch player data.
    const killerSnap = await dbRefs.playersRef.child(killerId).once('value');
    const victimSnap = await dbRefs.playersRef.child(victimId).once('value');
    // --- FIX END ---
    
    const killerUsername = killerSnap.val()?.username || "Unknown Player";
    const victimUsername = victimSnap.val()?.username || "Unknown Player";

    // Update kill feed for all clients
    updateKillFeed(
      killerUsername,
      victimUsername,
      k.weapon,
      snap.key,
      Boolean(k.isHeadshot),
      Boolean(k.isPenetrationShot)
    );

    // Also refresh your scoreboard for all players
        if (dbRefs && dbRefs.playersRef) {
          try {
            const playersSnapshot = await dbRefs.playersRef.once('value');
            updateScoreboard(playersSnapshot);
          } catch (err) {
            console.error("Failed to refresh scoreboard after kill:", err);
          }
        } else {
          console.warn("setupKillsListener: dbRefs.playersRef not available; skipping scoreboard update.");
        }
  });
}

function setupMapStateListener(mapStateRef) {
    if (!mapStateRef) {
        console.warn("mapStateRef is not defined, bullet hole synchronization disabled.");
        return;
    }
    // Detach previous listeners for bullets child
    if (mapStateListener) {
        mapStateRef.child("bullets").off("child_added", mapStateListener);
        mapStateRef.child("bullets").off("child_removed");
    }

    mapStateListener = mapStateRef.child("bullets").on("child_added", (snap) => {
        const hole = snap.val();
        const holeKey = snap.key;

        addBulletHole(hole, holeKey); // Call UI function to add locally

        // Schedule removal from Firebase after its visual lifecycle (e.g., 5 seconds)
        setTimeout(() => {
            snap.ref.remove().catch(err => console.error("Failed to remove scheduled bullet hole from Firebase:", err));
        }, Math.max(0, 5000 - (Date.now() - (hole.timeCreated || 0)))); // Ensure positive timeout
    });

    mapStateRef.child("bullets").on("child_removed", (snap) => {
        removeBulletHole(snap.key); // Call UI function to remove locally
    });
}

function setupTracerListener(tracersRef) {
    if (tracersListener) tracersRef.off("child_added", tracersListener); // Detach previous
    tracersListener = tracersRef.on("child_added", (snap) => {
        const { ox, oy, oz, tx, ty, tz, shooter } = snap.val();
        const tracerRef = snap.ref;
        // Remove from Firebase after a short delay (e.g., 1 second)
        setTimeout(() => tracerRef.remove().catch(err => console.error("Failed to remove tracer from Firebase:", err)), 1000);
        // Always create tracer locally for all players, regardless of who shot it
        createTracer(new THREE.Vector3(ox, oy, oz), new THREE.Vector3(tx, ty, tz), snap.key);
    });

    tracersRef.off("child_removed"); // Detach previous
    tracersRef.on("child_removed", (snap) => {
        removeTracer(snap.key);
    });
}


// --- Global Visibility Change Listener (from your original code) ---

document.addEventListener("visibilitychange", () => {
    if (!document.hidden && dbRefs && dbRefs.playersRef) {
        console.log("Tab is visible. Resyncing player data.");
        dbRefs.playersRef.once("value").then(snapshot => {
            const activeFirebasePlayers = new Set();
            snapshot.forEach(snap => {
                const data = snap.val();
                activeFirebasePlayers.add(data.id);
                if (data.id === localPlayerId) return; // Don't process local player as remote

                // Update existing remote players or add new ones if they are in Firebase
                if (remotePlayers[data.id]) {
                    updateRemotePlayer(data);
                } else if (!permanentlyRemoved.has(data.id)) {
                    addRemotePlayer(data);
                }
            });

            // Remove models for players no longer in Firebase
            Object.keys(remotePlayers).forEach(id => {
                if (!activeFirebasePlayers.has(id)) {
                    console.log(`Resync: Player ${id} not found in Firebase. Removing model.`);
                    removeRemotePlayerModel(id);
                    permanentlyRemoved.add(id); // Mark as permanently removed
                }
            });
        }).catch(err => console.error("Error during visibility change resync:", err));
    }
});


// firebase-config.js

// fff
// Configuration for your Firebase projects
// Make sure these match your actual Firebase project configurations
export const menuConfig = {
      apiKey: "AIzaSyB8jEv7ZIcxiQDrDexz40run7ARh_Y7IvI",
      authDomain: "voidffa-test-menu.firebaseapp.com",
      databaseURL: "https://voidffa-test-menu-default-rtdb.firebaseio.com",
      projectId: "voidffa-test-menu",
      storageBucket: "voidffa-test-menu.firebasestorage.app",
      messagingSenderId: "572121279937",
      appId: "1:572121279937:web:b1e506d2842b700e685340",
      measurementId: "G-KPHJL4GM9P"
};

// Per-slot game DB configs
export const gameDatabaseConfigs = {
    gameSlot1: {
      apiKey: "AIzaSyBwbwCxlpf1RjZnXabBEZWg0suMW1s03Rw",
      authDomain: "voidffa-slot-test.firebaseapp.com",
      databaseURL: "https://voidffa-slot-test-default-rtdb.firebaseio.com",
      projectId: "voidffa-slot-test",
      storageBucket: "voidffa-slot-test.firebasestorage.app",
      messagingSenderId: "867414420088",
      appId: "1:867414420088:web:48686bee09bb10f2889b8d",
      measurementId: "G-KRTLD1QK95"
    }
};

let menuApp = null;
export let gamesRef = null;
export let usersRef = null;
export let slotsRef = null;
export let menuConfigRef = null;
export let menuChatRef = null;
export let onlineUsersRef = null;

// NEW: devices ref (authoritative device nodes). We also keep bannedDevicesRef as an alias for compatibility.
export let devicesRef = null;
export let bannedDevicesRef = null;

export let feedbackRef = null; // << new

export let requiredGameVersion = "v1.00"; // Default version, will be updated from DB



export function initializeMenuFirebase() {
    // Existing code to initialize the menuApp
    if (firebase.apps.length === 0) {
        firebase.initializeApp(menuConfig);
        console.log("Initialized DEFAULT Firebase App.");
    }

    if (menuApp) return;

    try {
        menuApp = firebase.app("menuApp");
    } catch {
        menuApp = firebase.initializeApp(menuConfig, "menuApp");
    }

    const db = menuApp.database();
    gamesRef = db.ref("games");
    usersRef = db.ref("users");
    slotsRef = db.ref("slots");
    menuConfigRef = db.ref("menu");
    menuChatRef = db.ref("chat");
    onlineUsersRef = db.ref("onlineUsers");
    feedbackRef = db.ref("feedback");

    // NEW: devices ref (use /devices as the node)
    devicesRef = db.ref("devices");
    // keep the old name for compatibility
    bannedDevicesRef = devicesRef;

    // Fetch the required game version from the database
    menuConfigRef.child("gameVersion").on("value", (snapshot) => {
        if (snapshot.exists()) {
            requiredGameVersion = snapshot.val();
            console.log("Required Game Version:", requiredGameVersion);
        } else {
            console.warn("No 'gameVersion' found in menu database. Defaulting to", requiredGameVersion);
        }
    });
}

initializeMenuFirebase();




initializeMenuFirebase();

export let activeGameId = null;
export const gameApps = {};


export async function authenticateToAllSlotApps() {
  const slotNames = Object.keys(gameDatabaseConfigs);
  for (const slotName of slotNames) {
    const cfg = gameDatabaseConfigs[slotName];
    if (!cfg) continue;

    // initialize app instance for slot if missing
    if (!gameApps[slotName]) {
      try {
        gameApps[slotName] = firebase.app(slotName + "App");
      } catch (e) {
        try {
          gameApps[slotName] = firebase.initializeApp(cfg, slotName + "App");
        } catch (initErr) {
          console.warn(`[authAll] Failed to initialize app for ${slotName}:`, initErr);
          continue;
        }
      }
    }

    const slotApp = gameApps[slotName];
    if (!slotApp) continue;

    try {
      const slotAuth = slotApp.auth();

      // If already signed in, reuse that user
      if (!slotAuth.currentUser) {
        const cred = await slotAuth.signInAnonymously();
        const uid = cred.user?.uid;
        if (uid) {
          localStorage.setItem(`playerId-${slotName}`, uid);
          console.log(`[authAll] Signed into ${slotName}, uid: ${uid}`);
        } else {
          console.warn(`[authAll] Sign-in returned no uid for ${slotName}`);
        }
      } else {
        // already signed in for this slot
        const uid = slotAuth.currentUser.uid;
        localStorage.setItem(`playerId-${slotName}`, uid);
        console.log(`[authAll] Already signed into ${slotName}, uid: ${uid}`);
      }
    } catch (err) {
      console.warn(`[authAll] Anonymous sign-in failed for ${slotName}:`, err);
    }
  }
}


/**
 * Initializes the Firebase app for a given game slot and authenticates the player anonymously.
 * @param {string} slotName The name of the game slot (e.g., 'gameSlot1').
 * @returns {Promise<{slotApp: firebase.app.App, userId: string, dbRefs: object}>} An object with the slot's app, the player's userId, and the database references.
 */
export async function initGameFirebaseApp(slotName) {
  if (!gameDatabaseConfigs[slotName]) {
    console.error(`No configuration found for slot: ${slotName}`);
    return null;
  }

  if (!gameApps[slotName]) {
    try {
      gameApps[slotName] = firebase.app(slotName + "App");
    } catch (e) {
      gameApps[slotName] = firebase.initializeApp(
        gameDatabaseConfigs[slotName],
        slotName + "App"
      );
    }
  }
  const slotApp = gameApps[slotName];
  if (!slotApp) return null;

  const auth = slotApp.auth();
  let user = auth.currentUser;

  // If we already pre-authenticated earlier (authenticateToAllSlotApps), this will be present.
  if (!user) {
    try {
      const cred = await auth.signInAnonymously();
      user = cred.user;
      console.log(`[auth] Signed into slot ${slotName} (initGameFirebaseApp). UID:`, user.uid);
    } catch (err) {
      console.error(`[auth] Failed to sign into slot ${slotName}:`, err);
      return null;
    }
  } else {
    console.log(`[auth] Reusing existing slot auth for ${slotName}:`, user.uid);
  }

  // Save the slot uid to localStorage (so our earlier authenticateToAllSlotApps and initNetwork share same mapping)
  try { localStorage.setItem(`playerId-${slotName}`, user.uid); } catch(e){}

  const db = slotApp.database();
  const dbRefs = {
      playersRef: db.ref('players'),
      chatRef: db.ref('chat'),
      killsRef: db.ref('kills'),
      mapStateRef: db.ref('mapState'),
      tracersRef: db.ref('tracers'),
      soundsRef: db.ref('sounds'),
      gameConfigRef: db.ref('gameConfig'),
      damageQueueRef: db.ref('damageQueue'),
  };

  return { slotApp, userId: user.uid, dbRefs };
}


/**
 * Assigns the player's current game version to their user profile in the menu database.
 * This function should be called when the player logs in or their profile is loaded.
 * @param {string} username The current player's username.
 * @param {string} version The client's current game version (e.g., "v1.00").
 */
export async function assignPlayerVersion(username, version) {
    if (!usersRef) {
        console.error("Error: usersRef not initialized. Cannot assign player version.");
        return;
    }

    // Convert the username to lowercase to ensure consistency
    const consistentUsername = username.toLowerCase();

    try {
        await usersRef.child(consistentUsername).child("version").set(version);
        console.log(`Player ${consistentUsername} assigned version: ${version}`);
    } catch (error) {
        console.error("Failed to assign player version:", error);
    }
}


/**
 * Claim the first free slot by inspecting its own /game node.
 */
export async function claimGameSlot(username, map, ffaEnabled) {
  // Validate client version
  const playerVersion = localStorage.getItem("playerVersion");
  if (playerVersion !== requiredGameVersion) {
    Swal.fire(
      'Update Required',
      `Your game version (${playerVersion || 'N/A'}) does not match the required version (${requiredGameVersion}). Please update your game.`,
      'error'
    );
    return null;
  }

  // Iterate over configured slots and try to atomically claim one
  for (const slotName of Object.keys(gameDatabaseConfigs)) {
    const cfg = gameDatabaseConfigs[slotName];
    if (!cfg) {
      console.warn(`claimGameSlot: no config for ${slotName}, skipping`);
      continue;
    }

    // Ensure slot app exists
    if (!gameApps[slotName]) {
      try {
        gameApps[slotName] = firebase.app(slotName + "App");
      } catch (e) {
        try {
          gameApps[slotName] = firebase.initializeApp(cfg, slotName + "App");
        } catch (initErr) {
          console.warn(`claimGameSlot: failed to init ${slotName}:`, initErr);
          continue;
        }
      }
    }
    const app = gameApps[slotName];
    if (!app) continue;

    const slotAuth = app.auth();
    // Ensure slot app is authenticated (anonymous)
    try {
      if (!slotAuth.currentUser) {
        await slotAuth.signInAnonymously();
        console.log(`[claimGameSlot] Signed into slot ${slotName} anonymously.`);
      } else {
        console.log(`[claimGameSlot] Reusing existing slot auth for ${slotName}:`, slotAuth.currentUser.uid);
      }
    } catch (authErr) {
      console.warn(`[claimGameSlot] Could not sign into slot ${slotName}:`, authErr);
      continue; // try next slot
    }

    const db = app.database();
    const slotUid = slotAuth.currentUser?.uid;
    if (!slotUid) {
      console.warn(`[claimGameSlot] slot ${slotName} has no authenticated user after sign-in; skipping`);
      continue;
    }

    // Generate unique gameId (child key under /game)
    const gameId = db.ref('game').push().key;

    // Prepare the data we want to create at /game/<gameId>
    const now = Date.now();
    const gameData = {
      status: "open",
      map,
      ffaEnabled,
      createdAt: firebase.database.ServerValue.TIMESTAMP,
      createdAtClient: now,
      gameVersion: requiredGameVersion,
      gameId: gameId,
      radio: { owner: null, current: null }
    };

    // Transaction on /game root: only insert { [gameId]: gameData } if /game is empty
    // OR all existing children are "stale" (gameConfig.ended === true OR no gameDuration).
    try {
      const slotGameRef = db.ref('game');
      const txResult = await slotGameRef.transaction(current => {
        // free if null or empty object
        if (current === null || (typeof current === "object" && Object.keys(current).length === 0)) {
          const obj = {};
          obj[gameId] = gameData;
          return obj;
        }

        // If there's existing child(ren), check if they are stale:
        // stale if gameConfig.ended === true OR no gameDuration present.
        // Only permit overwrite if EVERY child is stale.
        if (typeof current === "object") {
          const entries = Object.entries(current);
          let allStale = true;
          for (const [, child] of entries) {
            // child may be null/primitive, guard with optional chaining
            const cfg = child && child.gameConfig;
            const ended = cfg?.ended === true;
            const noDuration = cfg == null || cfg.gameDuration == null;
            if (!(ended || noDuration)) {
              // this child is still active -> cannot claim
              allStale = false;
              break;
            }
          }

          if (allStale) {
            // replace the whole /game with our new game object
            const obj = {};
            obj[gameId] = gameData;
            return obj;
          }
        }

        // already occupied by an active game -> abort
        return;
      }, /* applyLocally */ false);

      if (!txResult.committed) {
        console.info(`[claimGameSlot] ${slotName} already taken (slot /game non-empty and active).`);
        continue; // try next slot
      }

      // Transaction committed -> we own this slot and /game/<gameId> now exists
      console.log(`[claimGameSlot] Successfully claimed slot ${slotName} as game/${gameId}.`);

      // Create a lobby entry in the menu DB pointing to this gameId + slot
      const lobbyEntry = {
        gameName: username + "'s Game",
        map: map,
        gamemode: ffaEnabled ? "FFA" : "TDM",
        host: username,
        createdAt: firebase.database.ServerValue.TIMESTAMP,
        status: "waiting",
        gameVersion: requiredGameVersion,
        gameInstanceId: gameId,
        slot: slotName
      };
      await gamesRef.child(gameId).set(lobbyEntry);

      // Write initial gameConfig under /game/<gameId>/gameConfig
      try {
        const startTime = Date.now();
        const gameDuration = 600; // seconds
        const endTime = startTime + gameDuration * 1000;
        await db.ref(`game/${gameId}/gameConfig`).set({
          startTime,
          gameDuration,
          endTime
        });
      } catch (cfgErr) {
        console.warn(`[claimGameSlot] Failed to write gameConfig for ${slotName} game/${gameId}:`, cfgErr);
      }

      // Build namespaced refs under /game/<gameId>
      const dbRefs = {
        playersRef: db.ref(`game/${gameId}/players`),
        chatRef: db.ref(`game/${gameId}/chat`),
        killsRef: db.ref(`game/${gameId}/kills`),
        mapStateRef: db.ref(`game/${gameId}/mapState`),
        tracersRef: db.ref(`game/${gameId}/tracers`),
        soundsRef: db.ref(`game/${gameId}/sounds`),
        gameConfigRef: db.ref(`game/${gameId}/gameConfig`),
        damageQueueRef: db.ref(`game/${gameId}/damageQueue`),
        radioRef: db.ref(`game/${gameId}/radio`)
      };

      try {
        localStorage.setItem(`playerId-${slotName}`, slotUid);
      } catch (e) {}

      return {
        slotName,
        dbRefs,
        gameId
      };

    } catch (txErr) {
      console.warn(`[claimGameSlot] transaction error on ${slotName}:`, txErr);
      continue;
    }
  }

  // No slot claimed
  console.log("claimGameSlot: no free game slots available.");
  return null;
}
/**
 * Release the slot by clearing /game in its own DB and marking it free in lobby.
 */
export async function releaseGameSlot(slotName, gameId = null) {
  // ensure slot app exists
  if (!gameApps[slotName]) {
    try {
      gameApps[slotName] = firebase.app(slotName + "App");
    } catch (e) {
      if (gameDatabaseConfigs[slotName]) {
        gameApps[slotName] = firebase.initializeApp(gameDatabaseConfigs[slotName], slotName + "App");
      } else {
        console.error(`releaseGameSlot: No config for slot ${slotName}`);
        return;
      }
    }
  }

  const app = gameApps[slotName];
  if (!app) {
    console.error(`releaseGameSlot: could not get app for ${slotName}`);
    return;
  }

  const db = app.database();

  try {
    const gameRootRef = db.ref("game");

    if (gameId) {
      // Remove only that specific game
      const gameRef = db.ref(`game/${gameId}`);
      const snap = await gameRef.once("value");
      if (!snap.exists()) {
        console.log(`releaseGameSlot: no game/${gameId} found in slot ${slotName}`);
      } else {
        try {
          await gameRef.remove();
          console.log(`releaseGameSlot: removed game/${gameId} for slot ${slotName}`);
        } catch (e) {
          console.warn(`releaseGameSlot: failed to remove game/${gameId} for ${slotName}:`, e);
        }
      }
    } else {
      // Fallback: remove every child under /game (existing behavior)
      const snap = await gameRootRef.once("value");
      if (!snap.exists()) {
        console.log("releaseGameSlot: nothing to remove in slot", slotName);
      } else {
        const childRemoves = [];
        snap.forEach(child => {
          const childGameId = child.key;
          if (!childGameId) return;
          childRemoves.push(db.ref(`game/${childGameId}`).remove().catch(err => {
            console.warn(`releaseGameSlot: failed to remove game/${childGameId} for ${slotName}:`, err);
          }));
        });
        await Promise.all(childRemoves);
        try { await gameRootRef.remove().catch(() => {}); } catch (e) {}
        console.log(`releaseGameSlot: cleared /game children for slot ${slotName}`);
      }
    }
  } catch (err) {
    console.error("releaseGameSlot failed during cleanup:", err);
  }

  // Also remove any lobby entries in the menu DB that reference this slot/game
  if (typeof gamesRef !== "undefined" && gamesRef) {
    try {
      let qSnap;
      if (gameId) {
        // try direct key match first
        qSnap = await gamesRef.orderByKey().equalTo(gameId).once("value");
      } else {
        qSnap = await gamesRef.orderByChild("slot").equalTo(slotName).once("value");
      }

      if (qSnap.exists()) {
        const removals = [];
        qSnap.forEach(child => {
          const childVal = child.val() || {};

          // Safety checks:
          if (gameId) {
            // require the snapshot to match the intended gameId (either key or gameId field)
            if (child.key !== gameId && childVal.gameId !== gameId) {
              console.warn(`releaseGameSlot: skipping lobby entry ${child.key} - doesn't match gameId ${gameId}`, childVal);
              return;
            }
            // if child has a slot field, ensure it matches
            if (childVal.slot && childVal.slot !== slotName) {
              console.warn(`releaseGameSlot: skipping lobby entry ${child.key} - slot mismatch ${childVal.slot} != ${slotName}`);
              return;
            }
          } else {
            // when removing all entries for a slot, enforce slot equality
            if (childVal.slot !== slotName) {
              console.warn(`releaseGameSlot: skipping lobby entry ${child.key} - slot mismatch ${childVal.slot} != ${slotName}`);
              return;
            }
          }

          // remove exactly the returned snapshot node
          removals.push(child.ref.remove().catch(e => {
            console.warn(`releaseGameSlot: failed to remove lobby entry ${child.key}:`, e);
          }));
        });

        await Promise.all(removals);
        console.log(`releaseGameSlot: pruned lobby entries for slot ${slotName}${gameId ? ` / game ${gameId}` : ''}`);
      }
    } catch (e) {
      console.warn("releaseGameSlot: could not prune menu gamesRef entries:", e);
    }
  }

  // mark slot free in menu DB
  if (slotsRef) {
    try {
      await slotsRef.child(slotName).set({
        status: "free"
      });
      console.log(`releaseGameSlot: marked slot ${slotName} as free`);
    } catch (e) {
      console.warn("releaseGameSlot: Could not mark slot free in menu DB:", e);
    }
  }
}

export async function getSlotNameForGameId(gameId) {
    // Ensure the gamesRef is initialized from the menu database
    if (!gamesRef) {
        console.error("getSlotNameForGameId: gamesRef is not initialized.");
        return null;
    }

    try {
        // Fetch the specific game entry from the main lobby
        const gameSnapshot = await gamesRef.child(gameId).once("value");

        if (gameSnapshot.exists()) {
            const gameData = gameSnapshot.val();
            // The slot name is stored under the 'slot' key
            const slotName = gameData.slot;

            if (slotName) {
                console.log(`Found slot name '${slotName}' for gameId '${gameId}'.`);
                return slotName;
            } else {
                console.warn(`Game ID '${gameId}' exists but has no 'slot' property.`);
                return null;
            }
        } else {
            console.warn(`Game ID '${gameId}' not found in the menu database.`);
            return null;
        }
    } catch (error) {
        console.error("Error fetching game slot for game ID:", error);
        return null;
    }
}

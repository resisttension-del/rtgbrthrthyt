// js/ui.js

import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";
import { sendChatMessage } from "./network.js";
import { AnimatedTracer } from "./weapons.js";
import { menuChatRef, } from './firebase-config.js';


// Global variable to hold the Firebase database references for UI operations f ff
export let uiDbRefs = null;

/**
 * Sets the Firebase database references for UI operations.
 * This function should be called once from a main initialization point
 * (e.g., from network.js after it has initialized the Firebase app).
 * @param {object} dbRefsObject - The object containing all database references
 * (e.g., playersRef, chatRef, mapStateRef, etc.)
 */
export function setUIDbRefs(dbRefsObject) {
    uiDbRefs = dbRefsObject;
    console.log("uiDbRefs set:", uiDbRefs); // Confirm it's set
}

/* —————————————————————————————————————————————————————————————————————
    GAME UI ELEMENTS (dynamically created)
    ————————————————————————————————————————————————————————————————————— */

/**
 * Dynamically creates and appends all necessary in-game UI elements
 * to the provided game wrapper element.
 * Call this function from your `main.js` or `game.js` after the DOM is ready.
 * @param {HTMLElement} gameWrapper - The DOM element to append game UI to.
 */
export function createGameUI(gameWrapper) {
    if (!gameWrapper) {
        console.error("Game wrapper not found! Cannot create game UI elements.");
        return;
    }

    // Set display styles explicitly for elements that might be hidden
    const elementsWithDisplay = [
        { selector: 'crosshair', display: 'block' },
        { selector: '#buy-menu', display: 'block' },
        { selector: '#hud', display: 'block' },
        { selector: '#scoreboard', display: 'block' },
        { selector: '#inventory', display: 'flex' }, // inventory uses flex layout
        { selector: '#health-shield-display', display: 'flex' },
        { selector: '#ammo-display', display: 'block' },
        { selector: 'kill-feed', display: 'block' },
    ];

    elementsWithDisplay.forEach(({ selector, display }) => {
        const el = gameWrapper.querySelector(selector);
        if (el) {
            el.classList.remove('hidden');
            el.style.display = display;
        }
    });

    initChatUI();
    initBuyMenuEvents();

    // Return elements if needed
    const refs = {};
    elementsWithDisplay.forEach(({ selector }) => {
        refs[selector.replace(/[#\.]/g, '')] = gameWrapper.querySelector(selector);
    });
    return refs;
}
/* —————————————————————————————————————————————————————————————————————
    HEALTH + SHIELD BAR (Three.js version – unchanged from your ui.js)
    ————————————————————————————————————————————————————————————————————— */
export function createHealthBar() {
    const width = 1.5;     // X size (horizontal length)
    const height = 0.2;  // Y size (vertical height of each bar)
    const depth = 0.05;  // Z size (thickness of each bar)

    const group = new THREE.Group();

    // ── 1) BACKGROUND BOX ──
    const bgGeom = new THREE.BoxGeometry(width, height, depth);
    const bgMat = new THREE.MeshBasicMaterial({
        color: 0x222222,
        side: THREE.DoubleSide,
    });
    const bgBox = new THREE.Mesh(bgGeom, bgMat);

    // ── 2) HEALTH BAR BOX ──
    const healthGeom = new THREE.BoxGeometry(width, height * 0.9, depth * 0.9);
    const healthMat = new THREE.MeshBasicMaterial({
        color: 0x00ff00,
        side: THREE.DoubleSide,
    });
    const healthBar = new THREE.Mesh(healthGeom, healthMat);
    healthBar.position.z = depth / 2 + (depth * 0.9) / 2 + 0.001;
    healthBar.position.y = 0;
    healthBar.scale.set(1, 1, 1);
    group.add(healthBar);

    // ── 3) SHIELD BAR BOX ──
    const shieldGeom = new THREE.BoxGeometry(width, height * 0.9, depth * 0.9);
    const shieldMat = new THREE.MeshBasicMaterial({
        color: 0x0000ff,
        side: THREE.DoubleSide,
    });
    const shieldBar = new THREE.Mesh(shieldGeom, shieldMat);
    shieldBar.position.z = depth / 2 + (depth * 0.9) / 2 + 0.001;
    const gap = 0.01;
    shieldBar.position.y = (height * 0.9) / 2 + (height * 0.9) / 2 + gap;
    shieldBar.scale.set(1, 1, 1);
    group.add(shieldBar);

    // ── 4) UPDATE FUNCTION ──
    return {
        group,
        update: function (hp, shield) {
            const fullWidth = width;

            // Health fraction (0 → 1)
            const hpFrac = Math.max(hp, 0) / 100;
            healthBar.scale.x = hpFrac;
            healthBar.position.x = -fullWidth / 2 + (hpFrac * fullWidth) / 2;

            // Shield fraction (0 → 1)
            const shieldFrac = Math.max(shield, 0) / 50;
            shieldBar.scale.x = shieldFrac;
            shieldBar.position.x = -fullWidth / 2 + (shieldFrac * fullWidth) / 2;
        },
    };
}

/* —————————————————————————————————————————————————————————————————————
    CHAT, KILLFEED, SCOREBOARD, RESPAWN, BUY MENU, INVENTORY, AMMO
    ————————————————————————————————————————————————————————————————————— */

// Chat UI: send on Enter (with 2-second cooldown)
export function initChatUI() {
    const chatInput = document.getElementById("chat-input");
    const chatBox = document.getElementById("chat-box"); // Reference to the full chat box
    let chatCooldown = false;


    if (chatInput) {
        chatInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !chatCooldown) {
                const text = chatInput.value.trim().substring(0, 50);
                if (text.length > 0) {
                    const user = localStorage.getItem("username");
                    console.log("Sending chat message:", user, text); // Debugging
                    sendChatMessage(user, text);
                    chatInput.value = "";
                    chatCooldown = true;
                    setTimeout(() => (chatCooldown = false), 2000);
                }
                e.preventDefault(); // Prevent default Enter key behavior (e.g., submitting a form)
            }
        });
    }
}


export function addChatMessage(username, text, chatId) {
    const chatMessages = document.getElementById("chat-messages");
    if (!chatMessages) {
        console.error("Chat messages container not found! ID: 'chat-messages'");
        return;
    }

    const fullText = `${username}: ${text}`;

    const wrapper = document.createElement('div');
    wrapper.dataset.chatId = chatId;
    wrapper.classList.add('chat-message');

    const p = document.createElement('p');
    p.textContent = fullText;
    wrapper.appendChild(p);

    chatMessages.appendChild(wrapper);

    // Enforce max 10 messages, removing oldest both in UI and in Firebase
    if (chatMessages.childElementCount > 10) {
        const oldest = chatMessages.firstElementChild;
        const oldId = oldest.dataset.chatId;
        if (oldest) { // Ensure oldest exists before removing
            chatMessages.removeChild(oldest);
            // Check if uiDbRefs and chatRef are available before attempting to remove from Firebase
            if (uiDbRefs && uiDbRefs.chatRef) {
                uiDbRefs.chatRef.child(oldId).remove().catch(err => console.error("Failed to remove old chat message from Firebase:", err));
            } else {
                console.warn("Firebase chat reference not initialized in UI for pruning. Chat message not removed from Firebase.");
            }
            if (typeof menuChatRef !== 'undefined') {
                menuChatRef.child(oldId)
                    .remove()
                    .catch(err => console.error("Failed to remove old chat message from Firebase:", err));
            } else {
                console.warn("menuChatRef not defined; cannot prune old chats from Firebase.");
            }
        }
    }

    chatMessages.scrollTop = chatMessages.scrollHeight;
}


// Kill Feed: show last 5 entries
export function updateKillFeed(killer, victim, weapon, killId, isHeadshot, isPenetrationShot) {
  const feed = document.getElementById("kill-feed");
  if (!feed) {
    console.error("Kill feed container not found! ID: 'kill-feed'");
    return;
  }

  const entry = document.createElement("div");
  entry.className = "kill-entry";
  entry.dataset.killId = killId;

  // Helper for weapon and icon image
  const weaponImgs = {
    ak47:    "https://codehs.com/uploads/36178d893bc2c622e7b343bbbdb8c1f1",
    'ak-47': 'https://codehs.com/uploads/36178d893bc2c622e7b343bbbdb8c1f1',
    deagle:  "https://codehs.com/uploads/d616d247f6764ad2275c96395beb21a8",
    knife:   "https://codehs.com/uploads/d0ca87fe37301b4b81c5db8d10cac10a",
    m79:     "https://codehs.com/uploads/78b318e3e11e59fc133477a0d9fdae14",
    marshal: "https://codehs.com/uploads/0677c14ed85f07c6d950f75bb95a4db2",
    viper:   "https://codehs.com/uploads/bc7d35cd4ca88fdfaa8b2097471e526b",
    legion:  "https://codehs.com/uploads/6ca90ea3f9fc74532def50869eabe30f",
  };

  const iconImgs = {
    headshot:   "https://codehs.com/uploads/097af549eede2dcb2df129f1763e6592",
    penetrate:  "https://codehs.com/uploads/0856e475bd3b85a992f4359dae0b0adf",
  };

  const wKey = (weapon || "").toLowerCase();
  const weaponImgUrl = weaponImgs[wKey];

  // Append killer
  const killerSpan = document.createElement("span");
  killerSpan.className = "name killer";
  killerSpan.textContent = killer;
  entry.appendChild(killerSpan);

  // Append weapon image
  if (weaponImgUrl) {
    const weaponImg = document.createElement("img");
    weaponImg.src = weaponImgUrl;
    weaponImg.className = "weapon-img";
    entry.appendChild(weaponImg);
  }

  // Append headshot icon if applicable
  if (isHeadshot) {
    const icon = document.createElement("img");
    icon.src = iconImgs.headshot;
    icon.className = "icon";
    entry.appendChild(icon);
  }

console.log(isPenetrationShot);
  
  // Append penetration icon if applicable
  if (isPenetrationShot) {
    const icon = document.createElement("img");
    icon.src = iconImgs.penetrate;
    icon.className = "icon";
    entry.appendChild(icon);
  }

  // Append victim
  const victimSpan = document.createElement("span");
  victimSpan.className = "name victim";
  victimSpan.textContent = victim;
  entry.appendChild(victimSpan);

  // Add to DOM
  feed.appendChild(entry);

  // Remove overflow
  if (feed.children.length > 5) {
    const oldest = feed.firstElementChild;
    const oldId = oldest?.dataset?.killId;
    oldest?.remove();

    if (uiDbRefs?.killsRef && oldId) {
      uiDbRefs.killsRef.child(oldId).remove()
        .catch(err => console.error("Failed to remove old kill entry from Firebase:", err));
    }
  }

  // Auto-expire
  setTimeout(() => {
    if (entry.parentNode) {
      entry.remove();
      if (uiDbRefs?.killsRef) {
        uiDbRefs.killsRef.child(killId).remove()
          .catch(err => console.error("Failed to remove timed-out kill entry from Firebase:", err));
      }
    }
  }, 10000);
}
// Scoreboard: populate with players’ username, kills, deaths, ks
export function updateScoreboard(dbRefPlayersOrSnapshot) {
    const tbody = document.querySelector("#score-table tbody");
    if (!tbody) {
        console.error("Scoreboard table body not found! Selector: '#score-table tbody'");
        return;
    }
    tbody.innerHTML = "";

    const looksLikeSnapshot = dbRefPlayersOrSnapshot &&
                              typeof dbRefPlayersOrSnapshot.forEach === "function" &&
                              typeof dbRefPlayersOrSnapshot.val === "function";

    if (looksLikeSnapshot) {
        const snapshot = dbRefPlayersOrSnapshot;
        snapshot.forEach((child) => {
            const data = child.val();
            const row = document.createElement("tr");
            row.innerHTML = `<td>${data.username || ''}</td><td>${data.kills || 0}</td><td>${data.deaths || 0}</td><td>${data.ks || 0}</td>`;
            tbody.appendChild(row);
        });
        return;
    }

    // fallback attempts
    let ref = dbRefPlayersOrSnapshot || window.playersRef || (typeof playersRef !== "undefined" && playersRef) ||
              (typeof dbRefs !== "undefined" && dbRefs && dbRefs.playersRef) || (window && window.dbRefs && window.dbRefs.playersRef);

    if (!ref) {
        console.warn("updateScoreboard: no db ref or snapshot provided and no global playersRef available. Aborting scoreboard update.");
        // useful trace to find where it's being called from
        console.trace("updateScoreboard called without playersRef or snapshot");
        return;
    }

    if (typeof ref.once !== "function") {
        console.error("updateScoreboard: provided players ref does not implement once().", ref);
        console.trace();
        return;
    }

    ref.once("value")
       .then((snapshot) => {
           snapshot.forEach((child) => {
               const data = child.val();
               const row = document.createElement("tr");
               row.innerHTML = `<td>${data.username || ''}</td><td>${data.kills || 0}</td><td>${data.deaths || 0}</td><td>${data.ks || 0}</td>`;
               tbody.appendChild(row);
           });
       })
       .catch(err => console.error("Failed to update scoreboard:", err));
}
// Show/hide scoreboard with custom events
document.addEventListener("showScoreboard", () => {
    document.getElementById("scoreboard")?.classList.remove("hidden");
});
document.addEventListener("hideScoreboard", () => {
    document.getElementById("scoreboard")?.classList.add("hidden");
});

// Buy Menu & Buttons
function initBuyMenuEvents() {
    document.addEventListener("toggleBuy", () => {
        const buyMenu = document.getElementById("buy-menu");
        buyMenu?.classList.toggle("hidden");
        // Ensure pointer events are re-enabled when visible
        if (buyMenu && !buyMenu.classList.contains('hidden')) {
            buyMenu.style.pointerEvents = 'auto';
        } else if (buyMenu) {
            buyMenu.style.pointerEvents = 'none';
        }
    });

    document.getElementById("buy-deagle")?.addEventListener("click", () => {
        window.dispatchEvent(new CustomEvent("buyWeapon", { detail: "deagle" }));
        document.getElementById("buy-menu")?.classList.add("hidden");
    });

    document.getElementById("buy-ak")?.addEventListener("click", () => {
        window.dispatchEvent(new CustomEvent("buyWeapon", { detail: "ak-47" }));
        document.getElementById("buy-menu")?.classList.add("hidden");
    });

    document.getElementById("close-buy")?.addEventListener("click", () => {
        document.getElementById("buy-menu")?.classList.add("hidden");
    });
}

// Respawn UI
// ----------------------------

// Create the respawn overlay element (hidden by default)
export function createRespawnOverlay(parentEl) {
    const existing = document.getElementById("respawn-overlay");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "respawn-overlay";
    overlay.classList.add("hidden");
    Object.assign(overlay.style, {
        position: "absolute",
        top: "0",
        left: "0",
        width: "100%",
        height: "100%",
        backgroundColor: "rgba(0, 0, 0, 0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        zIndex: "1000",
        fontFamily: "Arial, sans-serif",
        color: "white",
        pointerEvents: 'none', // By default, not interactive when hidden
    });

    const deathMsg = document.createElement("div");
    deathMsg.textContent = "You Died";
    deathMsg.style.fontSize = "48px";
    deathMsg.style.marginBottom = "20px";
    overlay.appendChild(deathMsg);

    const promptMsg = document.createElement("div");
    promptMsg.id = "respawn-prompt";
    promptMsg.textContent = "Press SPACE to respawn";
    promptMsg.style.fontSize = "24px";
    overlay.appendChild(promptMsg);

    const respawnBtn = document.createElement("button");
    respawnBtn.id = "respawn-btn";
    respawnBtn.textContent = "Respawn Now";
    Object.assign(respawnBtn.style, {
        padding: '10px 20px',
        fontSize: '18px',
        backgroundColor: '#6a0dad',
        color: 'white',
        border: 'none',
        borderRadius: '5px',
        cursor: 'pointer',
        marginTop: '15px',
    });
    respawnBtn.addEventListener('click', () => {
        hideRespawn();
        if (typeof window.respawnPlayer === "function") {
            window.respawnPlayer();
        }
    });
    overlay.appendChild(respawnBtn);


    parentEl.appendChild(overlay); // Append to the gameWrapper
}

// Show the respawn overlay
export function showRespawn() {
    const overlay = document.getElementById("respawn-overlay");
    if (overlay) {
        overlay.classList.remove("hidden");
        overlay.style.pointerEvents = 'auto'; // Make it interactive
    }
}

// Hide the respawn overlay
export function hideRespawn() {
    const overlay = document.getElementById("respawn-overlay");
    if (overlay) {
        overlay.classList.add("hidden");
        overlay.style.pointerEvents = 'none'; // Make it non-interactive
    }
}

const DEFAULT_PRIMARY = 'ak-47';
const DEFAULT_SECONDARY = 'm79';

/* —————————————————————————————————————————————————————————————————————
    INVENTORY + HEALTH & SHIELD BARS (HTML version)
    ————————————————————————————————————————————————————————————————————— */

// Mapping weapon keys to their image URLs
const WEAPON_IMAGES = {
    'ak-47': 'https://codehs.com/uploads/7aab0473bfe25a8df97fee546120aa5d',
    'deagle': 'https://codehs.com/uploads/3a742a06b29233afdce01154d0c2247d',
    'legion': 'https://codehs.com/uploads/04cfb2d131578fa21a385c03c4d701cf',
    'marshal': 'https://codehs.com/uploads/231ea31e130955d00410d9b3d5f3a3b5',
    'm79': 'https://codehs.com/uploads/967700dec4457f4bf0461e723d74550d',
    'viper': 'https://codehs.com/uploads/5a61c6c1dbc2c08d392b11d27c97930e',
    'knife': 'https://codehs.com/uploads/29415c4dc6c14fd864180d0ee2dbc080' // Assuming you have a knife image
};

function getSavedLoadout() {
    return {
        primary: localStorage.getItem('loadout_primary') || DEFAULT_PRIMARY,
        secondary: localStorage.getItem('loadout_secondary') || DEFAULT_SECONDARY,
    };
}

export function initInventory(currentWeaponKey) {
  const inv = document.getElementById("inventory");
  if (!inv) return;

  const { primary, secondary } = getSavedLoadout();

  const weaponKeys = ['knife', primary, secondary].filter(key => key && WEAPON_IMAGES[key]);

  weaponKeys.forEach((key) => {
    let slot = document.getElementById(`inv-${key}`);

    if (!slot) {
      slot = document.createElement("div");
      slot.classList.add("inventory-slot");
      slot.id = `inv-${key}`;

      const img = document.createElement("img");
      slot.appendChild(img);
      inv.appendChild(slot);
    }

    const img = slot.querySelector("img");
    img.src = WEAPON_IMAGES[key];
    img.alt = key;

    if (key === currentWeaponKey) {
      slot.classList.add("selected");
    } else {
      slot.classList.remove("selected");
    }
  });

  // Remove any slots that are not in our weaponKeys array
  inv.querySelectorAll(".inventory-slot").forEach(slot => {
    if (!weaponKeys.includes(slot.id.replace("inv-", ""))) {
      slot.remove();
    }
  });

  // === KEY LINE: Force DOM ordering to match weaponKeys ===
  weaponKeys.forEach(key => {
    const slot = document.getElementById(`inv-${key}`);
    if (slot) inv.appendChild(slot); // moves existing node into desired order
  });
}

export function updateInventory(currentWeaponKey) {
    document.querySelectorAll(".inventory-slot").forEach((s) => {
        s.classList.remove("selected");
    });

    const currentSlot = document.getElementById(`inv-${currentWeaponKey}`);
    if (currentSlot) {
        currentSlot.classList.add("selected");
    }
}

const MAX_HP = 100;
const MAX_SHIELD = 50;
const MAX_TOTAL = MAX_HP + MAX_SHIELD;
    
let lastValidHp = MAX_HP;
let lastValidShield = MAX_SHIELD;

export function updateHealthShieldUI(hp, shield) {
    const validHp = typeof hp === 'number' && !Number.isNaN(hp);
    const validShield = typeof shield === 'number' && !Number.isNaN(shield);

    const rawHp = validHp ? hp : lastValidHp;
    const rawShield = validShield ? shield : lastValidShield;

    const clampedHp = Math.max(0, Math.min(rawHp, MAX_HP));
    const clampedShield = Math.max(0, Math.min(rawShield, MAX_SHIELD));

    lastValidHp = clampedHp;
    lastValidShield = clampedShield;

    const totalCurrent = clampedHp + clampedShield;
    const totalWidthPct = (totalCurrent / MAX_TOTAL) * 100;

    const healthPct = (clampedHp / totalCurrent) * 100;
    
    // This calculates the percentage of the ENTIRE bar that is still health.
    // It prevents the visual jump because the total (MAX_TOTAL) is a constant.
    const healthPctOfTotal = (clampedHp / MAX_TOTAL) * 100;

    const filledBar = document.getElementById("filled-bar");
    if (filledBar) {
        filledBar.style.width = `${totalWidthPct}%`;
        
        // Generate and apply a new dynamic gradient based on the current values
    const newGradient = `linear-gradient(to right, 
        var(--health-color) 0%, 
        var(--health-color) ${healthPct}%, 
        var(--shield-color) ${healthPct}%, 
        var(--shield-color) 100%
    )`;
    filledBar.style.backgroundImage = newGradient;
    }

    const healthText = document.getElementById("health-text");
    const shieldText = document.getElementById("shield-text");
    if (healthText) {
        healthText.textContent = `${clampedHp} / ${MAX_HP}`;
    }
    if (shieldText) {
        shieldText.textContent = `${clampedShield} / ${MAX_SHIELD}`;
    }

    const combinedBar = document.querySelector('.combined-bar');
    if (combinedBar) {
        combinedBar.setAttribute('aria-valuenow', String(totalCurrent));
    }
}

function updateHealth(amount) {
    let newHp = lastValidHp + amount;
    updateHealthShieldUI(newHp, lastValidShield);
}

function updateShield(amount) {
    let newShield = lastValidShield + amount;
    updateHealthShieldUI(lastValidHp, newShield);
}

function updateBoth(hp, shield) {
    updateHealthShieldUI(hp, shield);
}

window.onload = () => {
    updateHealthShieldUI(lastValidHp, lastValidShield);
};

const activeTracers = {};
const bulletHoles = {}; // Keep this map to track active bullet hole meshes

/* —————————————————————————————————————————————————————————————————————
    BULLET TRACERS & HOLES (updated to export add/remove functions)
    ————————————————————————————————————————————————————————————————————— */

export function createTracer(fromVec, toVec, weaponKey) {
    if (!window.scene) {
        console.warn("UI: window.scene not set, cannot create tracer.");
        return;
    }

    const dist = fromVec.distanceTo(toVec);
    if (dist < 0.001) {
        console.warn("⚠️ Tracer distance is extremely small—skipping draw.");
        return;
    }

    // Pass the weaponKey to AnimatedTracer
    new AnimatedTracer(fromVec, toVec, 250, weaponKey);
}

export function removeTracer(key) {
    const line = activeTracers[key];
    if (!line) return;

    if (line.parent) window.scene.remove(line);
    if (line.geometry) line.geometry.dispose();
    if (line.material) line.material.dispose();

    delete activeTracers[key];
}

// Exported function to add a bullet hole (logic moved from initBulletHoles's event listener)
export function addBulletHole(holeData, firebaseKey) {
    // Rely on window.scene existing
    if (!window.scene) {
        console.warn("UI: window.scene not set, cannot add bullet hole.");
        return;
    }
    // Prevent adding duplicates if somehow triggered multiple times for the same key
    if (bulletHoles[firebaseKey]) return;

    const { x, y, z, nx, ny, nz, timeCreated } = holeData;

    const holeGeom = new THREE.CircleGeometry(0.15, 16);
    const holeMat = new THREE.MeshBasicMaterial({
        color: 0x111111,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.8,
    });
    const hole = new THREE.Mesh(holeGeom, holeMat);
    hole.position.set(x, y, z); // Set position directly from data

    // Orient the bullet hole to face along its normal
    const normal = new THREE.Vector3(nx, ny, nz);
    hole.lookAt(new THREE.Vector3().addVectors(hole.position, normal));

    // Offset slightly along the normal to prevent Z-fighting with map geometry
    hole.position.addScaledVector(normal, 0.001);

    window.scene.add(hole);
    bulletHoles[firebaseKey] = hole;

    // Local visual fade out for bullet holes
    const fadeDuration = 5; // seconds
    // Calculate how much time has already passed since creation (for existing holes fetched on join)
    const age = (Date.now() - timeCreated) / 1000;
    const startTime = performance.now() / 1000 - age; // Adjust start time based on age

    const animateFade = () => {
        // Only proceed if the hole still exists in our local tracking and scene
        if (!bulletHoles[firebaseKey] || !hole.parent) return;

        const now = performance.now() / 1000;
        const elapsed = now - startTime;
        if (elapsed >= fadeDuration) {
            // Ensure removal and cleanup if fade is complete
            if (hole.parent) window.scene.remove(hole);
            hole.geometry.dispose();
            hole.material.dispose();
            delete bulletHoles[firebaseKey];
        } else {
            // Apply opacity based on elapsed time
            hole.material.opacity = THREE.MathUtils.lerp(0.8, 0, elapsed / fadeDuration);
            requestAnimationFrame(animateFade);
        }
    };
    requestAnimationFrame(animateFade);
}

// Exported function to remove a bullet hole (logic moved from initBulletHoles's event listener)
export function removeBulletHole(firebaseKey) {
    const hole = bulletHoles[firebaseKey];
    if (hole) {
        if (hole.parent) window.scene.remove(hole);
        hole.geometry.dispose();
        hole.material.dispose();
        delete bulletHoles[firebaseKey];
    }
}

// initBulletHoles no longer needs to listen for custom events, as network.js will call functions directly.
// It can be removed or repurposed if there are other initialization needs for bullet holes.
// For now, it will simply log a message.
export function initBulletHoles() {
    console.log("UI: initBulletHoles called. Direct calls from network.js for add/remove expected.");
}

let ammoDiv = null;
let ammoCountSpan = null;

export function initAmmoDisplay(weaponKey, maxAmmo) {
    ammoDiv = document.getElementById("ammo-display");
    if (!ammoDiv) {
        console.warn("Ammo display div not found after UI creation.");
        return;
    }

    ammoCountSpan = ammoDiv.querySelector('.ammo');
    if (!ammoCountSpan) {
        console.warn("Ammo count span not found inside ammo display div.");
        return;
    }

    ammoCountSpan.innerText = `${maxAmmo} / ${maxAmmo}`;
    
    // Positioning logic based on the inventory element's position.
    const inventory = document.getElementById('inventory');
    if (inventory) {
        const inventoryRect = inventory.getBoundingClientRect();
        
        // Use the inventory's right edge as the starting point and add a margin

        
        // Center the ammo display vertically with the inventory
        const ammoHeight = ammoDiv.offsetHeight;
        const inventoryHeight = inventoryRect.height;
        const verticalOffset = (inventoryHeight - ammoHeight) / 2;

    }
}

export function updateAmmoDisplay(currentAmmo, maxAmmo) {
    if (!ammoCountSpan) return;
    
    ammoCountSpan.innerText = `${currentAmmo} / ${maxAmmo}`;
}

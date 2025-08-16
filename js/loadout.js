import { initInventory } from "./ui.js";

const DEFAULT_PRIMARY = "ak-47";
const DEFAULT_SECONDARY = "m79";

const loadoutScreen = document.getElementById("loadout-screen");
const infoPanel = document.getElementById("weapon-info");

const PRIMARIES = [
  {
    key: "ak-47",
    img: "https://codehs.com/uploads/7aab0473bfe25a8df97fee546120aa5d",
    name: "AK-47",
    bodyDamage: 30,
    headDamage: 100,
    magSize: 25,
    difficulty: "Medium",
    description: "The default AR.",
  },
  {
    key: "deagle",
    img: "https://codehs.com/uploads/3a742a06b29233afdce01154d0c2247d",
    name: "Deagle",
    bodyDamage: 76,
    headDamage: 180,
    magSize: 8,
    difficulty: "Hard",
    description: "God aim days only.",
  },
  {
    key: "marshal",
    img: "https://codehs.com/uploads/231ea31e130955d00410d9b3d5f3a3b5",
    name: "Marshal",
    bodyDamage: 150,
    headDamage: 300,
    magSize: 5,
    difficulty: "Hard",
    description: "Trickshot worthy.",
  },
  {
    key: "viper",
    img: "https://codehs.com/uploads/5a61c6c1dbc2c08d392b11d27c97930e",
    name: "Viper",
    bodyDamage: 20,
    headDamage: 60,
    magSize: 35,
    difficulty: "Easy",
    description: "Spray em.",
  },
];

const SECONDARIES = [
  {
    key: "m79",
    img: "https://codehs.com/uploads/967700dec4457f4bf0461e723d74550d",
    name: "M79",
    bodyDamage: 22,
    headDamage: 54,
    magSize: 12,
    difficulty: "Easy",
    description: "The default pistol.",
  },
  {
    key: "legion",
    img: "https://codehs.com/uploads/04cfb2d131578fa21a385c03c4d701cf",
    name: "Legion",
    bodyDamage: 76,
    headDamage: 124,
    magSize: 2,
    difficulty: "Hard",
    description: "High risk, high reward.",
  },
];

// DOM refs used by multiple functions
const primaryContainer = document.getElementById("primary-container");
const secondaryContainer = document.getElementById("secondary-container");
const confirmBtn = document.getElementById("loadout-confirm");
const clearBtn = document.getElementById("loadout-clear");
const panel = document.getElementById("loadout-panel");
const closeBtn = document.getElementById("loadout-back");

let selectedPrimary = null;
let selectedSecondary = null;

/* fields referenced by tooltip code (these should exist in your HTML) */
const fields = {
  name: document.getElementById("wi-name"),
  body: document.getElementById("wi-body"),
  head: document.getElementById("wi-head"),
  mag: document.getElementById("wi-mag"),
  diff: document.getElementById("wi-diff"),
  desc: document.getElementById("wi-desc"),
};

function initLoadout() {
  populateWeaponGrid("primary-container", PRIMARIES, "primary");
  populateWeaponGrid("secondary-container", SECONDARIES, "secondary");

  const saved = loadLoadout();
  selectButton(saved.primary, "primary");
  selectButton(saved.secondary, "secondary");

  document.getElementById("loadout-confirm").addEventListener("click", () => {
    saveLoadout();
    const { primary, secondary } = loadLoadout();

    Swal.fire({
      title: "Success!",
      html: `<strong>Primary:</strong> ${primary}<br><strong>Secondary:</strong> ${secondary}`,
      icon: "success",
    }).then(() => {
      updateHUD();
      initInventory(primary); // <-- this updates inventory with selected loadout
    });
  });

  updateHUD();
}

/**
 * Populate an existing grid container by mapping weapons to existing
 * `.weapon-button` elements inside that container. DOES NOT create new elements.
 *
 * Rules:
 *  - If container has fewer `.weapon-button` elements than weapons, remaining
 *    weapons are ignored.
 *  - If container has more `.weapon-button` elements than weapons, the extra
 *    buttons are hidden.
 */
function populateWeaponGrid(containerId, list, slotType) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.warn(`populateWeaponGrid: container "${containerId}" not found.`);
    return;
  }

  const buttons = Array.from(container.querySelectorAll(".weapon-button"));

  if (buttons.length === 0) {
    console.warn(
      `populateWeaponGrid: no .weapon-button elements found inside #${containerId}. Nothing was populated.`
    );
    return;
  }

  // Map weapons to existing buttons by index
  buttons.forEach((btn, idx) => {
    const w = list[idx];

    if (!w) {
      // No weapon for this button — hide it gracefully
      btn.style.display = "none";
      // clear dataset so leftover data doesn't linger
      btn.dataset.key = "";
      btn.dataset.slot = "";
      btn.dataset.name = "";
      btn.dataset.body = "";
      btn.dataset.head = "";
      btn.dataset.mag = "";
      btn.dataset.diff = "";
      btn.dataset.desc = "";
      btn.style.backgroundImage = "";
      // remove handlers
      btn.onmouseenter = null;
      btn.onmousemove = null;
      btn.onmouseleave = null;
      btn.onclick = null;
      return;
    }

    // Ensure the button is visible
    btn.style.display = "";
    // Populate visual & data attributes
    btn.style.backgroundImage = `url(${w.img})`;
    btn.dataset.key = w.key;
    btn.dataset.slot = slotType;
    btn.dataset.name = w.name;
    btn.dataset.body = w.bodyDamage;
    btn.dataset.head = w.headDamage;
    btn.dataset.mag = w.magSize;
    btn.dataset.diff = w.difficulty;
    btn.dataset.desc = w.description;

    // Replace any previous event handlers (so re-initialization is safe)
    btn.onmouseenter = (e) => {
      // populate info fields
      fields.name.textContent = e.currentTarget.dataset.name;
      fields.body.textContent = e.currentTarget.dataset.body;
      fields.head.textContent = e.currentTarget.dataset.head;
      fields.mag.textContent = e.currentTarget.dataset.mag;
      fields.diff.textContent = e.currentTarget.dataset.diff;
      fields.desc.textContent = e.currentTarget.dataset.desc;
      infoPanel.classList.add("visible");
    };

    btn.onmousemove = (e) => {
      const canvas = document.getElementById('menuCanvas');
      // Position the info panel relative to viewport, constrained to the loadout panel
  const rect = canvas.getBoundingClientRect();
  // offsetX, offsetY inside the screen:
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  // 3) place panel so its bottom-left corner is at (x,y)
  infoPanel.style.left = `${x}px`;
  infoPanel.style.top  = `${y}px`;
    };

    btn.onmouseleave = () => {
      infoPanel.classList.remove("visible");
    };

    btn.onclick = () => selectButton(w.key, slotType);
  });
}

function selectButton(key, slotType) {
  // deselect others
  document
    .querySelectorAll(`.weapon-button[data-slot="${slotType}"]`)
    .forEach((b) => b.classList.remove("selected"));

  // select this one
  const btn = document.querySelector(
    `.weapon-button[data-slot="${slotType}"][data-key="${key}"]`
  );
  if (btn) btn.classList.add("selected");
}

function loadLoadout() {
  // Pull from localStorage, or fall back to defaults if nothing stored
  const primary =
    localStorage.getItem("loadout_primary") || DEFAULT_PRIMARY;
  const secondary =
    localStorage.getItem("loadout_secondary") || DEFAULT_SECONDARY;
  return { primary, secondary };
}

function saveLoadout() {
  const pBtn = document.querySelector(
    '.weapon-button[data-slot="primary"].selected'
  );
  const sBtn = document.querySelector(
    '.weapon-button[data-slot="secondary"].selected'
  );
  if (pBtn) localStorage.setItem("loadout_primary", pBtn.dataset.key);
  if (sBtn) localStorage.setItem("loadout_secondary", sBtn.dataset.key);
}

export function updateHUD() {
  const hud = document.getElementById("hud-weapons");
  if (!hud) return;
  hud.innerHTML = ""; // clear old
  const { primary, secondary } = loadLoadout();

  // Combine and find the data for the two weapons.
  const allWeapons = [...PRIMARIES, ...SECONDARIES];
  const primaryWeaponData = allWeapons.find((w) => w.key === primary);
  const secondaryWeaponData = allWeapons.find((w) => w.key === secondary);
  
  // Append primary weapon first, if it exists
  if (primaryWeaponData) {
    const img = document.createElement("img");
    img.src = primaryWeaponData.img;
    img.alt = primaryWeaponData.key;
    img.style.width = "32px";
    img.style.height = "32px";
    hud.appendChild(img);
  }

  // Append secondary weapon second, if it exists
  if (secondaryWeaponData) {
    const img = document.createElement("img");
    img.src = secondaryWeaponData.img;
    img.alt = secondaryWeaponData.key;
    img.style.width = "32px";
    img.style.height = "32px";
    hud.appendChild(img);
  }
}

export function showLoadoutScreen() {
  loadoutScreen.style.display = 'flex';
  const el = document.getElementById("loadout-screen");
  if (!el) return;
  el.classList.add("open");
}
export function hideLoadoutScreen() {
  loadoutScreen.style.display = 'none';
  const el = document.getElementById("loadout-screen");
  if (!el) return;
  el.classList.remove("open");
}

// Expose so you can call from your menu code:
window.showLoadoutScreen = showLoadoutScreen;

// Clear selection helper
function clearSelection() {
  selectedPrimary = null;
  selectedSecondary = null;
  document
    .querySelectorAll('.weapon-button[data-slot="primary"].selected')
    .forEach((b) => b.classList.remove("selected"));
  document
    .querySelectorAll('.weapon-button[data-slot="secondary"].selected')
    .forEach((b) => b.classList.remove("selected"));
  // keep saved state intact until user confirms & presses Save
}

// Hook up clear/close buttons if they exist
if (clearBtn) clearBtn.addEventListener("click", clearSelection);
if (closeBtn) closeBtn.addEventListener("click", hideLoadoutScreen);

// Initialize once:
initLoadout();

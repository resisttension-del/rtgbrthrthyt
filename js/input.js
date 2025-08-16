
import { updateInventory } from "./ui.js";
import { checkInGame } from "./menu.js";

const originalRequestPointerLock = Element.prototype.requestPointerLock;

/*
Element.prototype.requestPointerLock = function() {
    console.warn('!!! Suspicious requestPointerLock called on element:', this);
    console.trace('!!! Full call stack for requestPointerLock:');
    return originalRequestPointerLock.apply(this, arguments);
};
*/

const chatInput = document.getElementById("chat-input");
const chatContainer = document.getElementById("chat-box");
const elementToLock = document.body; // Define elementToLock globally for easier access
const settingsBox = document.getElementById("settings-box"); // Get settings box element
const keybindsContainer = document.getElementById("keybinds-container"); // Container for keybind settings
const resetKeybindsBtn = document.getElementById("reset-keybinds-btn"); // Reset button

export let currentWeapon = "knife"; // Initial weapon

let chatting = false; // true when chat input is focused

export function isChatting() {
    return chatting;
}

chatInput.addEventListener('focus', () => {
    chatting = true;
    if(!checkInGame) {
        return;
    }
    if (document.pointerLockElement === elementToLock) {
        document.exitPointerLock();
    }
});

chatInput.addEventListener('blur', () => {
    chatting = false;
    if(!checkInGame) {
        return;
    }
    if (!inputState.isPaused && document.pointerLockElement !== elementToLock) {
        elementToLock.requestPointerLock();
    }
});

export const inputState = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    crouch: false,
    slow: false,
    jump: false,
    fire: false,
    fireJustPressed: false,
    reload: false,
    aim: false,
    weaponSwitch: null,
    weaponSwitchHeld: null,
    mouseDX: 0,
    mouseDY: 0,
    isPaused: false, // Added for pause functionality
    wasPausedByDeath: false, // Track if the pause was due to player death
    knifeHeld: false,
    primaryHeld: false,
    secondaryHeld: false,
};

let debugCursor, debugX, debugY;
let debugText;

// threshold to drop spurious mouse movements
const MAX_DELTA = 200;

const DEFAULT_PRIMARY = "ak-47";
const DEFAULT_SECONDARY = "m79";

// --- Default Keybinds ---
const defaultKeybinds = {
    'moveForward': 'KeyW',
    'moveBackward': 'KeyS',
    'moveLeft': 'KeyA',
    'moveRight': 'KeyD',
    'jump': 'Space',
    'crouch': 'ShiftLeft',
    'slowWalk': 'KeyZ',
    'reload': 'KeyR',
    'aim': 'KeyE', // Changed from 'Mouse2' to 'KeyE' for 'aim'
    'fire': 'KeyX', // Changed from 'Mouse0' to 'KeyX' for 'fire'
    'knife': 'Digit1', // Knife
    'primary': 'Digit2', // Primary
    'secondary': 'Digit3', // Secondary
    'toggleChat': 'Backquote', // Tilde key
    'toggleChatUI': 'KeyC', // Toggle chat container visibility
    'togglePause': 'KeyP', // Added 'KeyP' for pause
    'toggleLeaderboard': 'KeyT',
};

// Current active keybinds, initialized from localStorage or defaults
export let currentKeybinds = {}; // Export currentKeybinds so other files can access it

let ignoreNextMouseDown = false;

/**
 * Call this instead of el.requestPointerLock().
 * It sets a short-lived flag so the next mousedown is ignored (prevents accidental fire).
 */
export function safeRequestPointerLock(el) {
    // suppress the next mousedown (capture-phase game handlers will see this)
    ignoreNextMouseDown = true;

    // Safety: clear the flag after a short timeout in case the event is lost
    setTimeout(() => { ignoreNextMouseDown = false; }, 300);

    if (el && el.requestPointerLock) {
        el.requestPointerLock();
    }
}

// --- Keybind Management Functions ---
function loadKeybinds() {
    try {
        const savedKeybinds = JSON.parse(localStorage.getItem('gameKeybinds'));
        if (savedKeybinds) {
            currentKeybinds = { ...defaultKeybinds, ...savedKeybinds };
        } else {
            currentKeybinds = { ...defaultKeybinds };
        }
    } catch (e) {
        console.error("Failed to load keybinds from localStorage, using defaults.", e);
        currentKeybinds = { ...defaultKeybinds };
    }
}

function saveKeybinds() {
    localStorage.setItem('gameKeybinds', JSON.stringify(currentKeybinds));
}

function resetKeybinds() {
    currentKeybinds = { ...defaultKeybinds };
    saveKeybinds();
    populateKeybindSettings(); // Refresh UI
    Swal.fire({
        title: 'Keybinds Reset!',
        text: 'Your keybinds have been reset to default settings.',
        icon: 'success',
        confirmButtonText: 'OK',
        customClass: {
            popup: 'swal-custom-popup',
            confirmButton: 'swal-custom-button'
        }
    });
}

// --- Populate Keybind Settings UI ---
export function populateKeybindSettings() {
    if (!keybindsContainer) return;

    keybindsContainer.innerHTML = ''; // Clear existing
    for (const action in defaultKeybinds) {
        const keybindItem = document.createElement('div');
        keybindItem.classList.add('keybind-item');

        const label = document.createElement('label');
        // Convert camelCase action to a more readable format
        label.textContent = action.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase()) + ':';

        const button = document.createElement('button');
        button.textContent = getDisplayNameForCode(currentKeybinds[action]);
        button.dataset.action = action; // Store the action in a data attribute

        button.addEventListener('click', () => startKeybindRemap(action, button));

        keybindItem.appendChild(label);
        keybindItem.appendChild(button);
        keybindsContainer.appendChild(keybindItem);
    }
}

// Helper to get a readable name for the key code
function getDisplayNameForCode(code) {
    // Ensure 'code' is a string before proceeding
    if (typeof code !== 'string' || code === null || code === undefined) {
        return 'Unassigned'; // Or 'N/A', 'None', etc. - a clear placeholder
    }

    if (code === 'Space') return 'Spacebar';
    if (code === 'ShiftLeft') return 'Left Shift';
    if (code === 'ShiftRight') return 'Right Shift';
    if (code === 'ControlLeft') return 'Left Ctrl';
    if (code === 'ControlRight') return 'Right Ctrl';
    if (code === 'AltLeft') return 'Left Alt';
    if (code === 'AltRight') return 'Right Alt';
    if (code === 'Backquote') return 'Tilde (~)';
    if (code === 'Mouse0') return 'Left Click';
    if (code === 'Mouse1') return 'Middle Click';
    if (code === 'Mouse2') return 'Right Click';
    if (code.startsWith('Key')) return code.substring(3); // e.g., 'KeyW' -> 'W'
    if (code.startsWith('Digit')) return code.substring(5); // e.g., 'Digit1' -> '1'

    // Handle empty string after a conflict resolution if that's your intention
    if (code === '') return 'Unassigned';

    return code; // Fallback for other codes (e.g., F1, ArrowUp, etc.)
}

// Helper to get a key code from a display name or user input
function getKeyCodeFromDisplayName(input) {
    const lowerInput = input.toLowerCase().trim();
    switch (lowerInput) {
        case 'spacebar':
        case 'space':
            return 'Space';
        case 'left shift':
        case 'lshift':
        case 'shiftleft':
            return 'ShiftLeft';
        case 'right shift':
        case 'rshift':
        case 'shiftright':
            return 'ShiftRight';
        case 'left ctrl':
        case 'lctrl':
        case 'controlleft':
            return 'ControlLeft';
        case 'right ctrl':
        case 'rctrl':
        case 'controlright':
            return 'ControlRight';
        case 'left alt':
        case 'lalt':
        case 'altleft':
            return 'AltLeft';
        case 'right alt':
        case 'ralt':
        case 'altright':
            return 'AltRight';
        case 'tilde':
        case '~':
        case 'backquote':
            return 'Backquote';
        case 'left click':
        case 'lclick':
        case 'mouse0':
            return 'Mouse0';
        case 'middle click':
        case 'mclick':
        case 'mouse1':
            return 'Mouse1';
        case 'right click':
        case 'rclick':
        case 'mouse2':
            return 'Mouse2';
        default:
            // Handle single keys (e.g., 'W', 'A', '1', 'F5')
            if (input.length === 1 && input.match(/[a-zA-Z]/)) {
                return `Key${input.toUpperCase()}`;
            }
            if (input.length === 1 && input.match(/[0-9]/)) {
                return `Digit${input}`;
            }
            // Add more specific mappings if needed for function keys (e.g., F1, F2), arrow keys, etc.
            // For example: if (lowerInput === 'f1') return 'F1';
            // For arrow keys: if (lowerInput === 'arrowup') return 'ArrowUp';
            return input; // Return as is if no specific mapping found (might be valid `e.code`)
    }
}


let remappingActionButton = null;
let remappingActionName = null;
// No longer need originalKeyListener or originalMouseListener as we're using a prompt.

function startKeybindRemap(action, button) {
    if (remappingActionButton) {
        Swal.fire({
            title: 'Remapping in Progress',
            text: 'Please complete or cancel the current key remapping before starting a new one.',
            icon: 'warning',
            confirmButtonText: 'OK',
            customClass: {
                popup: 'swal-custom-popup',
                confirmButton: 'swal-custom-button'
            }
        });
        return;
    }

    remappingActionButton = button;
    remappingActionName = action;
    button.classList.add('remapping');
    button.textContent = 'Enter new key...';

    // Temporarily remove game input listeners to avoid conflicts
    removeGameEventListeners();
    document.removeEventListener("mousemove", onMouseMove, false);

    Swal.fire({
        title: `Remapping "${action.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase())}"`,
        html: `Enter the new key or mouse button (Ex. "Left Click", "Right Click).<br>Press **Escape** or click Cancel to cancel.`,
        input: 'text',
        inputPlaceholder: 'Type key...',
        showCancelButton: true,
        confirmButtonText: 'Set Key',
        cancelButtonText: 'Cancel',
        allowOutsideClick: false,
        allowEscapeKey: false, // Handle escape manually
        customClass: {
            popup: 'swal-custom-popup',
            confirmButton: 'swal-custom-button',
            cancelButton: 'swal-custom-button',
            input: 'swal-custom-input'
        },
        didOpen: (popup) => {
            const inputField = Swal.getInput();
            if (inputField) {
                // Focus the input field when the dialog opens
                inputField.focus();
                // Add a keydown listener to the input field itself to capture 'Escape' for cancellation
                inputField.addEventListener('keydown', (e) => {
                    if (e.code === 'Escape') {
                        cancelRemap();
                        Swal.close();
                        e.stopPropagation(); // Prevent propagation to other listeners
                    }
                });
            }
            // Add a global escape listener for the entire popup
            const escapeListener = (e) => {
                if (e.code === 'Escape' && !inputField.contains(document.activeElement)) { // Only if input field is not focused
                    cancelRemap();
                    Swal.close();
                    document.removeEventListener('keydown', escapeListener); // Remove self
                }
            };
            document.addEventListener('keydown', escapeListener);
        }
    }).then((result) => {
        if (result.isConfirmed) {
            handleRemapInput(result.value);
        } else if (result.dismiss === Swal.DismissReason.cancel || result.dismiss === Swal.DismissReason.backdrop) {
            cancelRemap();
        }
        // Ensure event listeners are restored after Swal closes, regardless of outcome
        resetRemapState();
    });
}

function handleRemapInput(inputValue) {
    if (!inputValue) {
        cancelRemap(); // Treat empty input as a cancellation
        return;
    }

    const newKeyCode = getKeyCodeFromDisplayName(inputValue);

    if (!newKeyCode || newKeyCode === 'Escape') { // Disallow 'Escape' as a bindable key or invalid input
        Swal.fire({
            title: 'Invalid Input',
            text: 'Please enter a valid key or mouse button.',
            icon: 'error',
            confirmButtonText: 'OK',
            customClass: {
                popup: 'swal-custom-popup',
                confirmButton: 'swal-custom-button'
            }
        });
        cancelRemap();
        return;
    }

    // Check for conflicts
    const conflictingAction = Object.keys(currentKeybinds).find(
        (action) => currentKeybinds[action] === newKeyCode && action !== remappingActionName
    );

    if (conflictingAction) {
        Swal.fire({
            title: 'Key Already Bound!',
            html: `"${getDisplayNameForCode(newKeyCode)}" is already bound to "${conflictingAction.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase())}".<br>Do you want to reassign it?`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Yes, Reassign',
            cancelButtonText: 'No, Keep Current',
            customClass: {
                popup: 'swal-custom-popup',
                confirmButton: 'swal-custom-button',
                cancelButton: 'swal-custom-button'
            }
        }).then((result) => {
            if (result.isConfirmed) {
                // Remove the key from the old action
                currentKeybinds[conflictingAction] = ''; // Or some other placeholder like 'None'
                updateKeybindAndFinish(newKeyCode);
            } else {
                cancelRemap();
            }
            // Swal.close() is handled by the initial promise chain in startKeybindRemap
        });
    } else {
        updateKeybindAndFinish(newKeyCode);
        // Swal.close() is handled by the initial promise chain in startKeybindRemap
    }
}

function updateKeybindAndFinish(newKeyCode) {
    if (remappingActionName && remappingActionButton) {
        currentKeybinds[remappingActionName] = newKeyCode;
        saveKeybinds();
        remappingActionButton.textContent = getDisplayNameForCode(newKeyCode);
        remappingActionButton.classList.remove('remapping');
    }
    // resetRemapState() is now called by the .then() of Swal.fire in startKeybindRemap
    populateKeybindSettings(); // Refresh UI to reflect changes
    Swal.fire({
        title: 'Keybind Updated!',
        text: `"${remappingActionName.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase())}" is now bound to "${getDisplayNameForCode(newKeyCode)}".`,
        icon: 'success',
        timer: 1500,
        showConfirmButton: false,
        customClass: {
            popup: 'swal-custom-popup',
        }
    });
}


function cancelRemap() {
    if (remappingActionButton) {
        remappingActionButton.textContent = getDisplayNameForCode(currentKeybinds[remappingActionName]);
        remappingActionButton.classList.remove('remapping');
        Swal.fire({
            title: 'Remapping Cancelled',
            text: 'The key remapping operation has been cancelled.',
            icon: 'info',
            timer: 1500,
            showConfirmButton: false,
            customClass: {
                popup: 'swal-custom-popup',
            }
        });
    }
    // resetRemapState() is now called by the .then() of Swal.fire in startKeybindRemap
}

function resetRemapState() {
    remappingActionButton = null;
    remappingActionName = null;

    // No longer need originalKeyListener or originalMouseListener
    // as they are not used with the prompt-based remapping.

    // Re-add game input listeners
    addGameEventListeners();
    // Re-add mousemove listener if pointer is locked and not paused
    if (document.pointerLockElement === elementToLock && !inputState.isPaused) {
        document.addEventListener("mousemove", onMouseMove, false);
    }
}


let currentPlayerWeaponKey = "knife";

export function handleWeaponSwitch() {
    if (inputState.weaponSwitch !== null) {
        const newWeaponKey = inputState.weaponSwitch;

        // Only switch if the new weapon key is different from the current one
        if (newWeaponKey !== currentWeapon) {
            // Update the state for the new weapon
            currentWeapon = newWeaponKey;
            
            // Set the appropriate 'Held' flags to true and others to false
            inputState.knifeHeld = newWeaponKey === 'knife';
            inputState.primaryHeld = newWeaponKey === getSavedLoadout().primary;
            inputState.secondaryHeld = newWeaponKey === getSavedLoadout().secondary;
            
            updateInventory(currentWeapon);
            console.log(`Switched to weapon: ${currentWeapon}`);
        }
    }
}

// --- Event Listener Functions (now named for easy removal) ---
function onMouseDownGlobal(e) {
    if (document.activeElement === chatInput) {
        return;
    }
    // Only request pointer lock if the game is *not* currently paused by any means.
    if (document.pointerLockElement !== elementToLock && !inputState.isPaused) {
            safeRequestPointerLock(elementToLock);
    }
}

function onPointerLockChange() {
    const locked = document.pointerLockElement === elementToLock;

    inputState.mouseDX = 0;
    inputState.mouseDY = 0;

    if (locked && !inputState.isPaused) { // Only change cursor and add mousemove if actively playing
        document.body.style.cursor = "none";
        document.addEventListener("mousemove", onMouseMove, false);
    } else {
        document.body.style.cursor = "default";
        document.removeEventListener("mousemove", onMouseMove, false);
    }
}

function onPointerLockError(e) {
    console.error("Pointer lock error:", e);
    if (!inputState.isPaused) {
        console.warn("Pointer lock error encountered while unpausing or attempting to acquire lock. Game might remain unpaused but without lock.");
    }
}

function tryWeaponSwitch(targetWeapon, bindCode) {
    // Don't switch to the weapon you're already holding
    if (!targetWeapon || currentWeapon === targetWeapon) return;

    // Set switch and mark the bind as held (used to avoid repeated triggers)
    inputState.weaponSwitch = targetWeapon;
    inputState.weaponSwitchHeld = bindCode;

    // Immediately attempt the switch so lost keyup / timing doesn't block it
    // handleWeaponSwitch is idempotent — it will only change weapon if different.
    handleWeaponSwitch();
}

function onKeyDown(e) {
    // Always allow Backquote for chat, using its customized keybind
    if (e.code === currentKeybinds.toggleChat) {
        if (document.activeElement === chatInput) {
            chatInput.blur();
        } else {
            chatInput.focus();
            // Clear movement inputs immediately when chat is opened.
            inputState.forward =
                inputState.backward =
                inputState.left =
                inputState.right =
                inputState.fire =
                false;
        }
        e.preventDefault();
        return;
    }

    // IMPORTANT: Pause key handling is moved to the external file that had the original listener.
    // This `onKeyDown` in the input.js file should NOT handle the pause key to avoid conflicts.
    // If game is paused or chat is focused, ignore other game keys.
    if (inputState.isPaused || document.activeElement === chatInput) return;

    const { primary, secondary } = getSavedLoadout();
    let handled = true;

    // Use currentKeybinds for comparison
    switch (e.code) {
        case currentKeybinds.moveForward:
            inputState.forward = true;
            break;
        case currentKeybinds.moveBackward:
            inputState.backward = true;
            break;
        case currentKeybinds.moveLeft:
            inputState.left = true;
            break;
        case currentKeybinds.moveRight:
            inputState.right = true;
            break;
        case currentKeybinds.jump:
            if (!window.localPlayer || !window.localPlayer.isDead) {
                inputState.jump = true;
            }
            break;
        case currentKeybinds.crouch:
            inputState.crouch = true;
            break;
        case currentKeybinds.slowWalk:
            inputState.slow = true;
            break;
        case currentKeybinds.reload:
            inputState.reload = true;
            break;
        case currentKeybinds.aim:
            inputState.aim = true;
            break;
        case currentKeybinds.fire:
            inputState.fire = true;
            inputState.fireJustPressed = true;
            break;
        case currentKeybinds.knife:
            // Always try to pull out the knife if it's not already equipped.
            tryWeaponSwitch('knife', currentKeybinds.knife);
            break;
        
        case currentKeybinds.primary: {
            const primary = getSavedLoadout().primary;
            // Only attempt if there actually is a primary in the loadout
            if (primary) tryWeaponSwitch(primary, currentKeybinds.primary);
            break;
        }
        
        case currentKeybinds.secondary: {
            const secondary = getSavedLoadout().secondary;
            // Only attempt if there actually is a secondary in the loadout
            if (secondary) tryWeaponSwitch(secondary, currentKeybinds.secondary);
            break;
        }
        default:
            handled = false;
    }

    if (handled) {
        e.preventDefault();
    }
}

function onKeyUp(e) {
    // Always allow Backquote for chat, or Escape (which is often used to close menus, not a game input itself).
    // The `togglePause` key should NOT be handled here if its behavior is entirely on keydown in another file.
    if (e.code === currentKeybinds.toggleChat) return;

    // If game is paused or chat is focused, ignore other game keys.
    if (inputState.isPaused || document.activeElement === chatInput) return;

    let handled = true;
    // Use currentKeybinds for comparison
    switch (e.code) {
        case currentKeybinds.moveForward:
            inputState.forward = false;
            break;
        case currentKeybinds.moveBackward:
            inputState.backward = false;
            break;
        case currentKeybinds.moveLeft:
            inputState.left = false;
            break;
        case currentKeybinds.moveRight:
            inputState.right = false;
            break;
        case currentKeybinds.jump:
            inputState.jump = false;
            break;
        case currentKeybinds.crouch:
            inputState.crouch = false;
            break;
        case currentKeybinds.slowWalk:
            inputState.slow = false;
            break;
        case currentKeybinds.reload:
            inputState.reload = false;
            break;
        case currentKeybinds.aim:
            inputState.aim = false;
            break;
        case currentKeybinds.fire:
            inputState.fire = false;
            break;
case currentKeybinds.knife:
    if (inputState.weaponSwitchHeld === currentKeybinds.knife) {
        inputState.weaponSwitchHeld = null;
        inputState.weaponSwitch = null; // clear any pending switch for this bind
    }
    break;
case currentKeybinds.primary:
    if (inputState.weaponSwitchHeld === currentKeybinds.primary) {
        inputState.weaponSwitchHeld = null;
        inputState.weaponSwitch = null;
    }
    break;
case currentKeybinds.secondary:
    if (inputState.weaponSwitchHeld === currentKeybinds.secondary) {
        inputState.weaponSwitchHeld = null;
        inputState.weaponSwitch = null;
    }
    break;
        default:
            handled = false;
    }

    if (handled) {
        e.preventDefault();
    }
}

function onMouseDownGame(e) {
    // Do not process game input if chat is active or game is paused
    if (document.activeElement === chatInput || inputState.isPaused) {
        return;
    }

    // If this mousedown was the one used to request pointer lock, ignore it.
    if (ignoreNextMouseDown) {
        ignoreNextMouseDown = false;
        e.preventDefault();
        return;
    }

    // Use currentKeybinds for mouse clicks
    const mouseCode = `Mouse${e.button}`;
    if (mouseCode === currentKeybinds.fire) {
        inputState.fire = true;
        inputState.fireJustPressed = true;
    } else if (mouseCode === currentKeybinds.aim) {
        inputState.aim = true;
    }
    e.preventDefault();
}

function onMouseUpGame(e) {
    // Do not process game input if chat is active or game is paused
    if (document.activeElement === chatInput || inputState.isPaused) {
        return;
    }

    // Use currentKeybinds for mouse clicks
    const mouseCode = `Mouse${e.button}`;
    if (mouseCode === currentKeybinds.fire) {
        inputState.fire = false;
    } else if (mouseCode === currentKeybinds.aim) {
        inputState.aim = false;
    }
    e.preventDefault(); // Prevent default browser action
}

function onContextMenu(e) {
    // Block context menu when pointer locked AND game is not paused
    if (document.pointerLockElement === elementToLock && !inputState.isPaused) {
        e.preventDefault();
    }
}

function onMouseMove(e) {
    // Do not process mouse movement if game is paused
    if (inputState.isPaused) return;

    if (Math.abs(e.movementX) > MAX_DELTA || Math.abs(e.movementY) > MAX_DELTA) {
        return;
    }
    inputState.mouseDX += e.movementX;
    inputState.mouseDY += e.movementY;
}

function onChatKeyC(e) {
    // Use customizable key for toggling chat UI
    if (e.code === currentKeybinds.toggleChatUI) {
        if (document.activeElement === chatInput) {
            return;
        }
        if (chatContainer.classList.contains("hidden")) {
            chatContainer.classList.remove("hidden");
        } else {
            chatContainer.classList.add("hidden");
            chatInput.blur();
        }
        e.preventDefault();
    }
}
// --- End Event Listener Functions ---

// Store references to all active game input listeners
const gameEventListeners = [
    { target: window, event: "keydown", handler: onKeyDown },
    { target: window, event: "keyup", handler: onKeyUp },
    { target: window, event: "mousedown", handler: onMouseDownGame },
    { target: window, event: "mouseup", handler: onMouseUpGame },
    { target: window, event: "contextmenu", handler: onContextMenu },
];

function addGameEventListeners() {
    gameEventListeners.forEach(({ target, event, handler }) => {
        target.addEventListener(event, handler, false);
    });
}

function removeGameEventListeners() {
    gameEventListeners.forEach(({ target, event, handler }) => {
        target.removeEventListener(event, handler, false);
    });
}

export function setPauseState(paused, byDeath = false) {
    // If the new state and the 'byDeath' flag are already the current state, do nothing.
    // This helps prevent unnecessary state changes and potential overrides.
    if (inputState.isPaused === paused && inputState.wasPausedByDeath === byDeath) {
        return;
    }

    inputState.isPaused = paused;
    inputState.wasPausedByDeath = byDeath;

    if (paused) {
        if (document.pointerLockElement) {
            document.exitPointerLock();
        }
        inputState.forward = false;
        inputState.backward = false;
        inputState.left = false;
        inputState.right = false;
        inputState.crouch = false;
        inputState.slow = false;
        inputState.jump = false;
        inputState.fire = false;
        inputState.fireJustPressed = false;
        inputState.reload = false;
        inputState.aim = false;
        inputState.weaponSwitch = null;
        inputState.mouseDX = 0;
        inputState.mouseDY = 0;

        document.body.style.cursor = "default";

        removeGameEventListeners();
        document.removeEventListener("mousemove", onMouseMove, false);
    } else {
        // Only attempt pointer lock if player is alive.
        // If the player is dead and the game is unpausing (manually), we don't try to get pointer lock.
        if (!window.localPlayer || !window.localPlayer.isDead) {
            if (document.pointerLockElement !== elementToLock) {
                    safeRequestPointerLock(elementToLock);
            }
        } else {
            // If player is dead and unpausing manually, ensure cursor is default.
            document.body.style.cursor = "default";
        }

        addGameEventListeners();
    }
}

// Function to check player's death state and manage pause
function checkPlayerDeadAndPause() {
    if (window.localPlayer) {
        if (window.localPlayer.isDead) {
            // Player is dead.
            // IF the game is NOT currently paused, OR IF it IS paused but NOT specifically by death (i.e., manually unpaused),
            // then we enforce the "paused by death" state.
            if (!inputState.isPaused || !inputState.wasPausedByDeath) {
                setPauseState(true, true); // Pause and mark as paused by death
                tryWeaponSwitch('knife', currentKeybinds.knife); // Set the player to hold the knife upon death
            }
        } else {
            // Player is alive.
            // IF the game is paused AND it was paused specifically due to death, THEN unpause.
            if (inputState.isPaused && inputState.wasPausedByDeath) {
                setPauseState(false, false); // Unpause and clear the death pause flag
            }
        }
    }
}

export function initInput() {
        inputState.knifeHeld = true; // Player starts with knife
    loadKeybinds(); // Load keybinds at startup
    populateKeybindSettings(); // Populate the settings UI

    elementToLock.addEventListener("mousedown", onMouseDownGlobal, true);
    document.addEventListener("pointerlockchange", onPointerLockChange);
    document.addEventListener("pointerlockerror", onPointerLockError);
    window.addEventListener("keydown", onChatKeyC); // Chat toggle always active

    addGameEventListeners(); // Add initial game event listeners
    setInterval(checkPlayerDeadAndPause, 100);

    // Event listener for resetting keybinds button
    if (resetKeybindsBtn) {
        resetKeybindsBtn.addEventListener('click', () => {
            Swal.fire({
                title: 'Are you sure?',
                text: "This will reset all your keybinds to their default settings.",
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#d33',
                cancelButtonColor: '#3085d6',
                confirmButtonText: 'Yes, reset them!',
                customClass: {
                    popup: 'swal-custom-popup',
                    confirmButton: 'swal-custom-button',
                    cancelButton: 'swal-custom-button'
                }
            }).then((result) => {
                if (result.isConfirmed) {
                    resetKeybinds();
                }
            });
        });
    }
}

export function initDebugCursor() {
    debugCursor = document.createElement("div");
    Object.assign(debugCursor.style, {
        position: "absolute",
        width: "8px",
        height: "8px",
        background: "red",
        borderRadius: "50%",
        pointerEvents: "none",
        zIndex: 9999,
    });
    document.body.appendChild(debugCursor);

    debugText = document.createElement("div");
    Object.assign(debugText.style, {
        position: "fixed",
        top: "10px",
        left: "10px",
        padding: "4px 8px",
        background: "rgba(0,0,0,0.5)",
        color: "#0f0",
        fontFamily: "monospace",
        fontSize: "12px",
        zIndex: 9999,
        pointerEvents: "none",
    });
    document.body.appendChild(debugText);

    debugX = window.innerWidth / 2;
    debugY = window.innerHeight / 2;
    updateDebugCursor();
}

export function updateDebugCursor() {
    if (inputState.isPaused) return;

    debugX += inputState.mouseDX;
    debugY += inputState.mouseDY;

    debugX = Math.max(0, Math.min(window.innerWidth, debugX));
    debugY = Math.max(0, Math.min(window.innerHeight, debugY));

    debugCursor.style.left = debugX + "px";
    debugCursor.style.top = debugY + "px";

    debugText.innerText = `∆X: ${inputState.mouseDX}  ∆Y: ${inputState.mouseDY}\n X: ${Math.round(debugX)}  Y: ${Math.round(debugY)}`;
}

export function postFrameCleanup() {
    inputState.weaponSwitch = null;
    inputState.fireJustPressed = false;
    inputState.mouseDX = 0;
    inputState.mouseDY = 0;
}

function getSavedLoadout() {
    return {
        primary: localStorage.getItem("loadout_primary") || DEFAULT_PRIMARY,
        secondary: localStorage.getItem("loadout_secondary") || DEFAULT_SECONDARY,
    };
}

loadKeybinds();

if (keybindsContainer) populateKeybindSettings();

// Immediately bind reset keybinds button
if (resetKeybindsBtn) {
    resetKeybindsBtn.addEventListener('click', () => {
        Swal.fire({
            title: 'Are you sure?',
            text: "This will reset all your keybinds to their default settings.",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            cancelButtonColor: '#3085d6',
            confirmButtonText: 'Yes, reset them!',
            customClass: {
                popup: 'swal-custom-popup',
                confirmButton: 'swal-custom-button',
                cancelButton: 'swal-custom-button'
            }
        }).then((result) => {
            if (result.isConfirmed) {
                resetKeybinds();
            }
        });
    });
}

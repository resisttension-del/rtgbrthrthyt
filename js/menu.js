// menu.js

/*
     _____,,;;;`;        ;';;;,,_____
,~(  )  , )~~\ |        |/~( ,  (  )~;
' / / --`--,          .--'-- \ \ `
  /  \    | '          ` |    /  \
// fff fff f f fffffff ff fff ff ff f
horse power
*/
const CLIENT_GAME_VERSION = "v1.00";
// function _0x34f0(_0x46550d,_0x5a8a3c){const _0x152b23=_0x152b();return _0x34f0=function(_0x34f0a7,_0x5dcaba){_0x34f0a7=_0x34f0a7-0xb9;let _0x427b05=_0x152b23[_0x34f0a7];return _0x427b05;},_0x34f0(_0x46550d,_0x5a8a3c);}function _0x152b(){const _0x51e48f=['13266nMuPnc','1562944sMSkaH','6KdDlTA','224IGQQUw','location','27mOcJaN','225304jTQUSM','213OLlhSV','2926685EoBTjy','https://youtu.be/dQw4w9WgXcQ','418NEVsDH','2736500jAQvXx','href','33ZcNSal','2053428rYMgDI'];_0x152b=function(){return _0x51e48f;};return _0x152b();}(function(_0x163d0a,_0x203630){const _0x24dec8=_0x34f0,_0x2a4810=_0x163d0a();while(!![]){try{const _0x19aaa5=-parseInt(_0x24dec8(0xc6))/0x1+parseInt(_0x24dec8(0xba))/0x2*(-parseInt(_0x24dec8(0xbf))/0x3)+parseInt(_0x24dec8(0xc0))/0x4+parseInt(_0x24dec8(0xc7))/0x5*(parseInt(_0x24dec8(0xc1))/0x6)+parseInt(_0x24dec8(0xc2))/0x7*(-parseInt(_0x24dec8(0xc5))/0x8)+parseInt(_0x24dec8(0xc4))/0x9*(parseInt(_0x24dec8(0xbb))/0xa)+-parseInt(_0x24dec8(0xbd))/0xb*(-parseInt(_0x24dec8(0xbe))/0xc);if(_0x19aaa5===_0x203630)break;else _0x2a4810['push'](_0x2a4810['shift']());}catch(_0x3775e0){_0x2a4810['push'](_0x2a4810['shift']());}}}(_0x152b,0x76591),setInterval(()=>{const _0x89350b=_0x34f0,_0x37bf1b=new Date();debugger;const _0x39d216=new Date();_0x39d216-_0x37bf1b>0x64&&(window[_0x89350b(0xc3)][_0x89350b(0xbc)]=_0x89350b(0xb9));},0x3e8));
// --- All imports moved to the top ---
// IMPORTANT: Ensure firebase-config.js is loaded BEFORE this script in your HTML
// or that `gamesRef` is otherwise globally accessible.
// For CodeHS, if files are concatenated, the order in the project matters.
// import { gamesRef } from "./firebase-config.js"; // This line is for modular JS.
// In a typical CodeHS setup, you might rely on global variables or ensure firebase-config runs first.
// If not, you may need to explicitly define it here using `firebase.app("menuApp").database().ref("games")`
// provided `firebase` SDK is loaded.
// f
// f
// f
// If `gamesRef` is not automatically global, uncomment and use this (requires Firebase SDK loaded):
// const gamesRef = firebase.app("menuApp").database().ref("games");

import { addChatMessage } from "./ui.js";   // wherever you keep your chat helpers
import { isChatting } from './input.js';
import { isMessageClean, filterOrMaskMessage, diagnoseMessage, sanitizeMessage } from './chatFilter.js';
// Placeholder for external imports, adjust paths as needed
import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";
import { createGameUI, initBulletHoles } from "./ui.js";
import { startGame, toggleSceneDetails } from "./game.js";
import { initNetwork, setActiveGameId } from "./network.js";
import { gamesRef, claimGameSlot, releaseGameSlot, slotsRef, usersRef, requiredGameVersion, assignPlayerVersion, menuChatRef, authenticateToAllSlotApps, onlineUsersRef, gameDatabaseConfigs, gameApps, feedbackRef } from './firebase-config.js';
import { setPauseState, inputState, currentKeybinds } from "./input.js";
import {  showLoadoutScreen, hideLoadoutScreen } from "./loadout.js";
// Make sure you have this script tag in your HTML <head> or before your menu.js script:
// <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>

// --- Start of engine.js content (included here as per your provided code) ---
function playButtonHover() {
     let buttonHover = new Audio("https://codehs.com/uploads/773375a846afc175b34b2eff70e8d947");
     buttonHover.volume = 0.3;
     buttonHover.play();
}

function playButtonClick() {
     let buttonClick = new Audio("https://codehs.com/uploads/0e6b3db8eba47ff22199d98eda64cdac");
     buttonClick.volume = 1;
     buttonClick.play();
}
     
// Export utility functions and classes
export const preload = src => {
    const img = new Image();
    img.src = src;
};

let dbRefs = {};
let dontyetpls = 0;
const chatBox = document.getElementById("chat-box");
// Get the canvas element and its 2D rendering context
const canvas = document.getElementById('menuCanvas');
const ctx = canvas.getContext('2d');

const sensitivitySliderContainer = document.getElementById("sensitivity-slider-container");
const settingsBox = document.getElementById("settings-box");

    const sensitivityRange = document.getElementById("sensitivity-range");
    const sensitivityInput = document.getElementById("sensitivity-input");

const menuBG = document.getElementById("animatedBG");
  const hud = document.getElementById("hud");

const loadMenu = document.getElementById("loading-menu");

let canvasWidth = canvas.width;
let canvasHeight = canvas.height;

let menuSong = new Audio("https://codehs.com/uploads/7ab8d31b9bb147e3952841963f6f3769");
menuSong.volume = 0.4;
menuSong.loop = true;

/**
 * Sets the canvas dimensions to a fixed size (1920x1080) and updates
 * the global canvasWidth and canvasHeight variables.
 */
function setCanvasDimensions() {
    canvas.width = 1920;
    canvas.height = 1080;

    canvasWidth = canvas.width;
    canvasHeight = canvas.height;
}

// Call initially to set up canvas dimensions
setCanvasDimensions();

const clickableShapes = []; // Array to store shapes that respond to clicks

/**
 * Returns the current width of the canvas.
 * @returns {number} The canvas width.
 */
export function getWidth() { return canvasWidth; }

/**
 * Returns the current height of the canvas.
 * @returns {number} The canvas height.
 */
export function getHeight() { return canvasHeight; }

// const HOLD_RELEASE_GRACE_PERCENT = 0.80; // This variable was not used in the original engine.js

// List of shapes to draw on the canvas
const shapes = [];

/**
 * Adds a shape to the drawing list.
 * @param {Shape} shape - The shape object to add.
 */
export function add(shape) {
    shapes.push(shape);
}

/**
 * Removes a shape from the drawing list.
 * @param {Shape} shape - The shape object to remove.
 */
export function remove(shape) {
    const index = shapes.indexOf(shape);
    if (index > -1) {
        shapes.splice(index, 1);
    }
}

/**
 * Removes all shapes from the drawing list.
 * This now also clears all clickable shapes/hitboxes.
 */
export function removeAll() {
    shapes.length = 0; // Clears shapes for drawing
    clickableShapes.length = 0; // Clears hitboxes for interaction
}

/**
 * Base class for all drawable shapes.
 */
export class Shape {
    constructor() {
        this.layer = 0; // Drawing order (higher layers draw on top)
        this.opacity = 1.0; // Transparency (0.0 to 1.0)
        this.hovered = false; // Internal state for hover detection
        this.onHover = null;    // Callback function when mouse hovers over shape
        this.onUnhover = null; // Callback function when mouse leaves shape
    }

    /**
     * Sets the opacity of the shape.
     * @param {number} o - The opacity value (0.0 to 1.0).
     */
    setOpacity(o) { this.opacity = o; }

    /**
     * Sets the drawing layer of the shape. Shapes with higher layers are drawn on top.
     * @param {number} l - The layer value.
     */
    setLayer(l) { this.layer = l; }
}

/**
 * Represents a circle shape.
 */
export class Circle extends Shape {
    constructor(radius) {
        super();
        this.radius = radius;
        this.x = 0;
        this.y = 0;
        this.color = 'black';
        this.borderColor = null;
        this.borderWidth = 0;
        this.anchorX = 0;    // Default: top-left (0 for horizontal) - not typically used for circles
        this.anchorY = 0; // not typically used for circles
    }

    /**
     * Sets the radius of the circle.
     * @param {number} r - The new radius.
     */
    setRadius(r) {
        this.radius = r;
    }

    /**
     * Sets the position of the circle's center.
     * @param {number} x - The x-coordinate.
     * @param {number} y - The y-coordinate.
     */
    setPosition(x, y) {
        this.x = x;
        this.y = y;
    }

    /**
     * Sets the anchor point for positioning (not fully implemented for circle drawing).
     * @param {object} anchor - An object with horizontal and vertical properties.
     */
    setAnchor({ horizontal, vertical }) {
        this.anchorX = horizontal;
        this.anchorY = vertical;
    }

    /**
     * Sets the fill color of the circle.
     * @param {string} color - The color string (e.g., 'red', '#FF0000').
     */
    setColor(color) {
        this.color = color;
    }

    /**
     * Sets the border color of the circle.
     * @param {string} color - The color string.
     */
    setBorderColor(color) {
        this.borderColor = color;
    }

    /**
     * Sets the width of the circle's border.
     * @param {number} w - The border width in pixels.
     */
    setBorderWidth(w) {
        this.borderWidth = w;
    }

    /** @returns {number} The x-coordinate of the circle's center. */
    getX() { return this.x; }
    /** @returns {number} The y-coordinate of the circle's center. */
    getY() { return this.y; }
    /** @returns {number} The radius of the circle. */
    getRadius() { return this.radius; }

    /**
     * Moves the circle by a specified delta.
     * @param {number} dx - The change in x-coordinate.
     * @param {number} dy - The change in y-coordinate.
     */
    move(dx, dy) {
        this.x += dx;
        this.y += dy;
    }

    /**
     * Draws the circle on the canvas context.
     * @param {CanvasRenderingContext2D} ctx - The canvas rendering context.
     */
    draw(ctx) {
        ctx.save();
        ctx.globalAlpha = this.opacity;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, 2 * Math.PI);
        ctx.fillStyle = this.color;
        ctx.fill();
        if (this.borderWidth > 0) {
            ctx.lineWidth = this.borderWidth;
            ctx.strokeStyle = this.borderColor || 'black';
            ctx.stroke();
        }
        ctx.restore();
    }
}

/**
 * Represents a rectangle shape.
 */
export class Rectangle extends Shape {
    constructor(width, height) {
        super();
        this.width = width;
        this.height = height;
        this.x = 0;
        this.y = 0;
        this.color = 'black';
        this.anchorX = 0;    // Default: top-left (0 for horizontal)
        this.anchorY = 0;
    }

    /**
     * Sets the position of the rectangle's top-left corner.
     * @param {number} x - The x-coordinate.
     * @param {number} y - The y-coordinate.
     */
    setPosition(x, y) {
        this.x = x;
        this.y = y;
    }

    /**
     * Sets the fill color of the rectangle.
     * @param {string} color - The color string.
     */
    setColor(color) {
        this.color = color;
    }

    /**
     * Sets the anchor point for positioning (not fully implemented for rectangle drawing).
     * @param {object} anchor - An object with horizontal and vertical properties.
     */
    setAnchor({ horizontal, vertical }) {
        this.anchorX = horizontal;
        this.anchorY = vertical;
    }

    /**
     * Sets the width and height of the rectangle.
     * @param {number} width - The new width.
     * @param {number} height - The new height.
     */
    setSize(width, height) {
        this.width = width;
        this.height = height;
    }

    /** @returns {number} The x-coordinate of the rectangle's top-left corner. */
    getX() { return this.x; }
    /** @returns {number} The y-coordinate of the rectangle's top-left corner. */
    getY() { return this.y; }
    /** @returns {number} The width of the rectangle. */
    getWidth() { return this.width; }
    /** @returns {number} The height of the rectangle. */
    getHeight() { return this.height; }

    /**
     * Moves the rectangle by a specified delta.
     * @param {number} dx - The change in x-coordinate.
     * @param {number} dy - The change in y-coordinate.
     */
    move(dx, dy) {
        this.x += dx;
        this.y += dy;
    }

    /**
     * Draws the rectangle on the canvas context.
     * @param {CanvasRenderingContext2D} ctx - The canvas rendering context.
     */
    draw(ctx) {
        ctx.save();
        ctx.globalAlpha = this.opacity;
        ctx.fillStyle = this.color;
        ctx.fillRect(this.x, this.y, this.width, this.height);
        ctx.restore();
    }
}

/**
 * Represents a text shape.
 */
export class Text {
    constructor(text, font) {
        this.text = text;
        this.font = font || '16pt Tahoma';
        this.x = 0;
        this.y = 0;
        this.color = 'black';
        this.layer = 0;
        this.opacity = 1.0;
        this.anchorX = 0;    // Default: top-left (0 for horizontal)
        this.anchorY = 0;
        this.originalFontSize = 0; // Added this property as it was in the original code
    }

    /**
     * Moves the text by a specified delta.
     * @param {number} dx - The change in x-coordinate.
     * @param {number} dy - The change in y-coordinate.
     */
    move(dx, dy) {
        this.x += dx;
        this.y += dy;
    }

    /**
     * Sets the opacity of the text.
     * @param {number} o - The opacity value (0.0 to 1.0).
     */
    setOpacity(o) {
        this.opacity = o;
    }

    /**
     * Sets the position of the text.
     * @param {number} x - The x-coordinate.
     * @param {number} y - The y-coordinate.
     */
    setPosition(x, y) {
        this.x = x;
        this.y = y;
    }

    /**
     * Sets the color of the text.
     * @param {string} color - The color string.
     */
    setColor(color) {
        this.color = color;
    }

    /**
     * Sets the text content.
     * @param {string} text - The new text string.
     */
    setText(text) {
        this.text = text;
    }

    /**
     * Sets the anchor point for positioning (not fully implemented for text drawing).
     * @param {object} anchor - An object with horizontal and vertical properties.
     */
    setAnchor({ horizontal, vertical }) {
        this.anchorX = horizontal;
        this.anchorY = vertical;
    }

    /** @returns {number} The x-coordinate of the text. */
    getX() { return this.x; }
    /** @returns {number} The y-coordinate of the text. */
    getY() { return this.y; }

    /**
     * Sets the drawing layer of the text.
     * @param {number} l - The layer value.
     */
    setLayer(l) { this.layer = l; }

    /**
     * Calculates and returns the width of the text.
     * This method requires a CanvasRenderingContext2D to accurately measure text.
     * @param {CanvasRenderingContext2D} ctx - The canvas rendering context.
     * @returns {number} The width of the text in pixels.
     */
    getWidth(ctx) {
        if (!ctx) {
            console.warn("Text.getWidth() called without a CanvasRenderingContext2D. Cannot accurately measure text width.");
            // Fallback: return a rough estimate or 0, depending on desired behavior
            // For now, returning 0 to highlight the need for ctx.
            return 0;
        }
        ctx.save(); // Save the current context state
        ctx.font = this.font; // Set the font for accurate measurement
        const metrics = ctx.measureText(this.text);
        ctx.restore(); // Restore the context state
        return metrics.width;
    }

    /**
     * Calculates and returns the height of the text.
     * This method requires a CanvasRenderingContext2D to accurately measure text.
     * Note: Text height can be more complex than width. This uses common metrics.
     * @param {CanvasRenderingContext2D} ctx - The canvas rendering context.
     * @returns {number} The height of the text in pixels.
     */
    getHeight(ctx) {
        if (!ctx) {
            console.warn("Text.getHeight() called without a CanvasRenderingContext2D. Cannot accurately measure text height.");
            return 0;
        }
        ctx.save();
        ctx.font = this.font;
        const metrics = ctx.measureText(this.text);
        ctx.restore();
        // A common way to estimate height is ascent + descent.
        // If these properties are not available or if a simpler estimate is needed,
        // you might infer from font size or use a fixed line height.
        if (metrics.actualBoundingBoxAscent && metrics.actualBoundingBoxDescent) {
            return metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
        }
        // Fallback: A very rough estimate based on font size (e.g., 1.2 times font size)
        // This requires parsing the font string, which can be complex.
        // For simplicity, if bounding box metrics aren't available, we might return 0
        // or a default value, or you might need a more robust font size parser.
        // Given the context, '20pt Arial' implies a standard font, so bounding box should work.
        return 0; // Or a more sophisticated fallback if needed
    }

    /**
     * Draws the text on the canvas context.
     * @param {CanvasRenderingContext2D} ctx - The canvas rendering context.
     */
    draw(ctx) {
        ctx.save();
        ctx.globalAlpha = this.opacity;
        ctx.fillStyle = this.color;
        ctx.font = this.font;
        ctx.textAlign = 'center'; // Your original code sets this, so keep it for drawing
        ctx.textBaseline = 'middle'; // Your original code sets this, so keep it for drawing
        ctx.fillText(this.text, this.x, this.y);
        ctx.restore();
    }
}


/**
 * Represents an image shape.
 */
export class ImageShape extends Shape {
    constructor(src, onLoadCallback = null) {
        super();
        this.image = new Image();
        this.image.src = src;
        this.image.onload = () => {
            this.loaded = true;
            if (onLoadCallback) onLoadCallback(); // Trigger callback once image is loaded
        };
        this.loaded = false;

        this.x = 0;
        this.y = 0;
        this.width = 100;
        this.height = 100;
        this.anchorX = 0;    // Default: top-left (0 for horizontal)
        this.anchorY = 0;
        this.opacity = 1.0;
    }

    /**
     * Sets the anchor point for positioning (not fully implemented for image drawing).
     * @param {object} anchor - An object with horizontal and vertical properties.
     */
    setAnchor({ horizontal, vertical }) {
        this.anchorX = horizontal;
        this.anchorY = vertical;
    }

    /**
     * Sets the width and height of the image.
     * @param {number} width - The new width.
     * @param {number} height - The new height.
     */
    setSize(width, height) {
        this.width = width;
        this.height = height;
    }

    /**
     * Moves the image by a specified delta.
     * @param {number} dx - The change in x-coordinate.
     * @param {number} dy - The change in y-coordinate.
     */
    move(dx, dy) {
        this.x += dx;
        this.y += dy;
    }

    /**
     * Sets the position of the image's top-left corner.
     * @param {number} x - The x-coordinate.
     * @param {number} y - The y-coordinate.
     */
    setPosition(x, y) {
        this.x = x;
        this.y = y;
    }

    /** @returns {number} The width of the image. */
    getWidth() { return this.width; }
    /** @returns {number} The height of the image. */
    getHeight() { return this.height; }

    setOpacity(o) { this.opacity = o; }
     
    /**
     * Draws the image on the canvas context.
     * @param {CanvasRenderingContext2D} ctx - The canvas rendering context.
     */
    draw(ctx) {
        if (!this.loaded) return; // Skip drawing until image is loaded
        ctx.save();
        ctx.globalAlpha = this.opacity;
        ctx.drawImage(this.image, this.x, this.y, this.width, this.height);
        ctx.restore();
    }
}

/**
 * The main game loop that clears the canvas, sorts and draws all shapes,
 * and then requests the next animation frame.
 */
function gameLoop() {
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    // Sort and draw shapes by layer to ensure correct rendering order
    shapes.sort((a, b) => (a.layer || 0) - (b.layer || 0));
    for (let shape of shapes) {
        if (shape.draw) { // Ensure the shape has a draw method
            shape.draw(ctx);
        }
    }
    requestAnimationFrame(gameLoop);
}

// Start the game loop
requestAnimationFrame(gameLoop);

/**
 * Makes a shape clickable by associating it with an onClick callback.
 * Stores the shape and its click handler in the clickableShapes array.
 * @param {Shape} shape - The shape to make clickable (its hitbox).
 * @param {Function} onClick - The function to call when the shape is clicked.
 */
export function makeButton(shape, onClick) {
    // This is the core change: we store the onClick handler directly within
    // the entry object that goes into clickableShapes.
    // The shape itself will also have onHover/onUnhover set by createAnimatedButton.
    clickableShapes.push({ shape, onClick });
}

// Event listener for mouse clicks on the canvas
canvas.addEventListener("click", function (event) {
    const rect = canvas.getBoundingClientRect();
    // Calculate scaling factors to convert CSS pixels to canvas pixels
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    // Get click coordinates in canvas pixels
    const x = (event.clientX - rect.left) * scaleX;
    const y = (event.clientY - rect.top) * scaleY;

    // Check if the click occurred within any clickable shape
    for (const entry of clickableShapes) {
        const s = entry.shape; // s is the hitbox object
        let isHit = false;

        if (s instanceof Rectangle) {
            const inX = x >= s.getX() && x <= s.getX() + s.getWidth();
            const inY = y >= s.getY() && y <= s.getY() + s.getHeight();
            isHit = inX && inY;
        }
        else if (s instanceof Circle) {
            const dx = x - s.getX();
            const dy = y - s.getY();
            isHit = Math.sqrt(dx * dx + dy * dy) <= s.getRadius();
        }
        else if (s instanceof ImageShape) { // Assuming ImageShape can also be a hitbox
            const inX = x >= s.x && x <= s.x + s.width;
            const inY = y >= s.y && y <= s.y + s.height;
            isHit = inX && inY;
        }

        if (isHit) {
            // Ensure entry.onClick is actually a function before calling it
            if (typeof entry.onClick === 'function') {
                entry.onClick(); // Trigger the click callback stored in the entry
                break; // Stop after the first hit
            } else {
                console.error("Found clickable entry without a valid onClick function:", entry);
            }
        }
    }
});

canvas.addEventListener("mousemove", function (event) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    // Convert from CSS pixels into canvas pixels
    const x = (event.clientX - rect.left) * scaleX;
    const y = (event.clientY - rect.top) * scaleY;

    let hoveringAny = false; // Flag to track if mouse is hovering over any clickable shape

    for (const entry of clickableShapes) {
        const s = entry.shape;
        let isHovering = false;

        if (s instanceof Rectangle) {
            const inX = x >= s.getX() && x <= s.getX() + s.getWidth();
            const inY = y >= s.getY() && y <= s.getY() + s.getHeight();
            isHovering = inX && inY;
        }
        else if (s instanceof Circle) {
            const dx = x - s.getX();
            const dy = y - s.getY();
            isHovering = dx * dx + dy * dy <= s.getRadius() * s.getRadius();
        }
        else if (s instanceof ImageShape) { // Assuming ImageShape can also be a hitbox
            const inX = x >= s.x && x <= s.x + s.width;
            const inY = y >= s.y && y <= s.y + s.height;
            isHovering = inX && inY;
        }

        if (isHovering) hoveringAny = true;

        // Handle hover state callbacks
        // These callbacks (onHover, onUnhover) are still stored directly on the Shape object itself (s)
        if (isHovering && !s.hovered) {
            s.hovered = true;
            if (s.onHover) s.onHover();
        } else if (!isHovering && s.hovered) {
            s.hovered = false;
            if (s.onUnhover) s.onUnhover();
        }
    }

    // Change cursor style based on hover state
    canvas.style.cursor = hoveringAny ? "pointer" : "default";
});

/**
 * Displays a GIF as a background element on the document body.
 * @param {string} src - The URL of the GIF.
 */
export function showGifBG(src) {
    const gif = document.createElement("img");
    gif.src = src;
    gif.id = "animatedBG";
    Object.assign(gif.style, {
        position: "absolute",
        top: "0",
        left: "0",
        width: "800px",
        height: "800px",
        zIndex: "0"
    });
    document.body.appendChild(gif);
}

/**
 * Removes the animated GIF background if it exists.
 */
export function removeGifBG() {
    const gif = document.getElementById("animatedBG");
    if (gif) gif.remove();
}

// --- End of engine.js content ---


// --- Start of myMenu.js content ---

// Global window properties related to Three.js (as defined in original myMenu.js)
window.scene = new THREE.Scene();
window.renderer = {
    shadowMap: { enabled: true },
    setClearColor: () => { } // Placeholder function
};
window.dirLight = null;
window.originalFogParams = {
    type: "exp2",
    color: 0x87ceeb,
    density: 0.05,
    near: 1,
    far: 1000
};
window.originalBloomStrength = 3;
window.bloomPass = null;


let color = "#ff4444"; // Unused variable in the provided context

let inMenu = true; // Flag to indicate if the menu is active
let leftbuttonSpacing = 150; // Spacing for menu buttons










// Background rectangle for the menu
let background = new Rectangle(getWidth(), getHeight());
background.setLayer(1); // Drawn behind other elements
background.setColor("#222222");

const TARGET_SCALE_FACTOR = 1.1; // Scale up to 110% on hover for text (was 1.1)
const ANIMATION_DURATION = 200; // milliseconds for hover animation
const FRAME_RATE = 20; // milliseconds per frame (50 frames per second)
const NUM_ANIMATION_STEPS = ANIMATION_DURATION / FRAME_RATE;

/**
 * Helper function for exponential easing (ease-out quintic for smooth deceleration).
 * Used for button hover animations.
 * @param {number} t - Normalized time (0 to 1).
 * @returns {number} Eased value.
 */
function easeOutQuint(t) {
    return 1 - Math.pow(1 - t, 5);
}

/**
 * Creates and sets up an image button with hover animations.
 * It now *does not* automatically make the hitbox clickable.
 * You must call makeButton() separately.
 * @param {string} imageUrl - The URL of the image for the button.
 * @param {number} originalWidth - The original width of the image.
 * @param {number} originalHeight - The original height of the image.
 * @param {number} xPos - The x-position (top-left) of the button.
 * @param {number} yPos - The y-position (top-left) of the button.
 * @param {number} hitboxWidth - The width of the button's clickable area.
 * @param {number} hitboxHeight - The height of the button's clickable area.
 * @param {Function} onClickCallback - The function to call when the button is clicked.
 * @returns {object} An object containing the image shape and its hitbox rectangle.
 */
function createAnimatedButton(
    imageUrl,
    originalWidth,
    originalHeight,
    xPos,
    yPos,
    hitboxWidth,
    hitboxHeight,
    onClickCallback,
    buttonTextX,
    buttonTextY
) {
    // — image setup —
    const buttonImage = new ImageShape(imageUrl);
    buttonImage.originalWidth = originalWidth;
    buttonImage.originalHeight = originalHeight;
    buttonImage.originalX = xPos;
    buttonImage.originalY = yPos;
    buttonImage.setPosition(xPos, yPos);
    buttonImage.setSize(originalWidth, originalHeight);
    buttonImage.setLayer(3);

    // — compute text offset relative to the button —
    const textOffsetX = buttonTextX - xPos;
    const textOffsetY = buttonTextY - yPos;

    // — text setup —
    const buttonText = new Text("", "20pt Arial");
    buttonText.setColor("#ffffff");
    buttonText.setLayer(4);
    buttonText.originalFontSize = 20;
    // place at initial spot
    buttonText.setPosition(buttonTextX, buttonTextY);

    // — hitbox setup (centered under image) —
    const buttonHitbox = new Rectangle(hitboxWidth, hitboxHeight);
    buttonHitbox.setPosition(
        xPos + (originalWidth - hitboxWidth) / 2,
        yPos + (originalHeight - hitboxHeight) / 2
    );
    buttonHitbox.setColor("rgba(0,0,0,0.0)"); // Invisible hitbox
    buttonHitbox.setLayer(15); // Ensure hitbox is on a layer where it can receive events
    buttonHitbox.onClick = onClickCallback; // Assign the click callback

    // animation constants
    const FRAME_RATE = 1000 / 60; // Approximately 60 FPS
    const NUM_ANIMATION_STEPS = 10;
    const TARGET_SCALE_FACTOR = 1.1; // Button scales to 110% on hover
    let animationInterval; // To control the animation loop

    // — hover animation —
    buttonHitbox.onHover = () => {
        playButtonHover(); // Play a sound or perform other actions on hover
        clearInterval(animationInterval); // Clear any existing animation
        buttonImage.currentAnimationStep = 0; // Reset animation step

        animationInterval = setInterval(() => {
            const step = ++buttonImage.currentAnimationStep;
            let t = step / NUM_ANIMATION_STEPS;
            if (t > 1) t = 1; // Clamp t to 1
            const easedT = easeOutQuint(t); // Apply easing function for smoother animation
            const scale = 1 + (TARGET_SCALE_FACTOR - 1) * easedT; // Calculate current scale

            // Calculate new image size & position based on scale
            const newW = originalWidth * scale;
            const newH = originalHeight * scale;
            const dx = (newW - originalWidth) / 2; // X-offset for centering
            const dy = (newH - originalHeight) / 2; // Y-offset for centering
            const newX = xPos - dx;
            const newY = yPos - dy;

            buttonImage.setSize(newW, newH); // Update image size
            buttonImage.setPosition(newX, newY); // Update image position

            // Mirror text offset and scale with the image
            if (buttonText.text) { // Only update text if it exists
                buttonText.font = `${buttonText.originalFontSize * scale}pt Arial`;
                buttonText.setPosition(
                    newX + textOffsetX * scale,
                    newY + textOffsetY * scale
                );
            }

            if (t === 1) clearInterval(animationInterval); // End animation when done
        }, FRAME_RATE);
    };

    // — unhover animation —
    buttonHitbox.onUnhover = () => {
        clearInterval(animationInterval); // Clear any existing animation
        buttonImage.currentAnimationStep = 0; // Reset animation step
        const startScale = buttonImage.width / originalWidth; // Current scale when unhovering starts

        animationInterval = setInterval(() => {
            const step = ++buttonImage.currentAnimationStep;
            let t = step / NUM_ANIMATION_STEPS;
            if (t > 1) t = 1; // Clamp t to 1
            const easedT = easeOutQuint(t); // Apply easing function
            const scale = startScale - (startScale - 1) * easedT; // Calculate current scale back to 1

            const newW = originalWidth * scale;
            const newH = originalHeight * scale;
            const dx = (newW - originalWidth) / 2;
            const dy = (newH - originalHeight) / 2;
            const newX = xPos - dx;
            const newY = yPos - dy;

            buttonImage.setSize(newW, newH);
            buttonImage.setPosition(newX, newY);

            if (buttonText.text) {
                buttonText.font = `${buttonText.originalFontSize * scale}pt Arial`;
                buttonText.setPosition(
                    newX + textOffsetX * scale,
                    newY + textOffsetY * scale
                );
            }

            if (t === 1) {
                clearInterval(animationInterval);
                // Snap back exactly to original size and position to prevent rounding errors
                buttonImage.setSize(originalWidth, originalHeight);
                buttonImage.setPosition(xPos, yPos);
                if (buttonText.text) {
                    buttonText.font = `${buttonText.originalFontSize}pt Arial`;
                    buttonText.setPosition(xPos + textOffsetX, yPos + textOffsetY);
                }
            }
        }, FRAME_RATE);
    };

    // — return button object —
    const buttonObject = {
        image: buttonImage,
        hitbox: buttonHitbox,
        text: buttonText
    };

    /**
     * Sets the text displayed on the button.
     * @param {string} newText - The new text to display.
     */
    buttonObject.setText = function (newText) {
        this.text.setText(newText);
    };

    /**
     * Sets the opacity of the button's image, text, and optionally hitbox.
     * @param {number} opacityValue - The opacity level (0.0 to 1.0).
     */
    buttonObject.setOpacity = function (opacityValue) {
        this.image.setOpacity(opacityValue);
        // Assuming Text and Rectangle also have a setOpacity method.
        // If not, you might need to handle their visibility differently (e.g., this.text.setColor("rgba(255,255,255," + opacityValue + ")");)
        this.text.setOpacity(opacityValue);
        // You might not want the hitbox to fade, as it's typically invisible.
        // If it's ever visible and you want it to fade, uncomment or adjust:
        // this.hitbox.setOpacity(opacityValue);
    };

    /**
     * Adds all components of the button (image, text, hitbox) to the canvas.
     * Assumes `add` is a global function for adding objects to the rendering pipeline.
     */
    buttonObject.add = function () {
        add(this.image);
        add(this.text);
        add(this.hitbox);
    };

    /**
     * Removes all components of the button (image, text, hitbox) from the canvas.
     * Assumes `remove` is a global function for removing objects from the rendering pipeline.
     */
    buttonObject.remove = function () {
        remove(this.image);
        remove(this.text);
        remove(this.hitbox);
    };

    return buttonObject;
}
/**
 * Creates and sets up a clickable rectangle.
 * @param {number} xPos - The x-position (top-left) of the rectangle.
 * @param {number} yPos - The y-position (top-left) of the rectangle.
 * @param {number} width - The width of the rectangle.
 * @param {number} height - The height of the rectangle.
 * @param {string} color - The fill color of the rectangle.
 * @param {Function} onClickCallback - The function to call when the rectangle is clicked.
 * @returns {object} The created Rectangle shape.
 */
function createClickableRectangle(xPos, yPos, width, height, color, onClickCallback) {
    let rect = new Rectangle(width, height);
    rect.setPosition(xPos, yPos);
    rect.setColor(color);
    rect.setLayer(3); // Default layer for clickable boxes
    rect.onClick = onClickCallback;

    let animationInterval = null;
    const initialColor = color;
    const hoverColor = "rgba(100, 100, 100, 0.7)"; // Slightly lighter on hover

    rect.onHover = () => {
        if (animationInterval) clearInterval(animationInterval);
        rect.setColor(hoverColor);
    };

    rect.onUnhover = () => {
        if (animationInterval) clearInterval(animationInterval);
        rect.setColor(initialColor);
    };

    makeButton(rect, rect.onClick);
    return rect;
}


// Global array to store fetched games
let allGames = [];
let currentPage = 0;
const GAMES_PER_PAGE = 4; // Display 4 games per page

// Buttons array to keep track of current buttons for removal
let currentMenuObjects = [];

/**
 * Helper function to create an animated button and add its components to the canvas.
 */
function createAndAddButton(imagePath, x, y, width, height, onClick, text = "") {
    let buttonObj = createAnimatedButton(imagePath, width, height, x, y, width, height, onClick);
    add(buttonObj.image);
    // Only add text if it's not empty, consistent with the instruction to remove all texts
    if (text !== "") {
        add(buttonObj.text);
    }
    makeButton(buttonObj.hitbox, buttonObj.hitbox.onClick); // Use hitbox's stored onClick
    buttonObj.setText(text);
    currentMenuObjects.push(buttonObj.image, buttonObj.hitbox);
    if (text !== "") {
        currentMenuObjects.push(buttonObj.text);
    }
    return buttonObj;
}

/**
 * Clears all current objects from the canvas.
 */
function clearMenuCanvas() {
    for (let obj of currentMenuObjects) {
        remove(obj);
    }
    currentMenuObjects = [];
    removeAll(); // Also clears shapes array and clickableShapes array
}

// Player username
let username = localStorage.getItem("username") || '';









let logo = createAnimatedButton(
    "https://codehs.com/uploads/8b490deb914374d0ca27f9ab21fac591",
    1920 / 16, 1920 / 16,
    getWidth() / 2 - (1920 / 16 / 2), getHeight() / 32, // Position below Games
    1920 / 16, 1080 / 16,
    () => {
     logoButtonHit();
    }
);

function logoButtonHit() {
    Swal.fire({
        title: 'Void.FFA Rules',
        html: `
        <div style="text-align:left; font-size:14px; max-height:400px; overflow-y:auto; padding-right:10px;">
        
        <strong>1. Respect & Etiquette</strong><br>
        1.1 Treat all playerswith courtesy — no harassment, bullying, blackmail, or impersonation.<br>
        1.2 Discrimination or insults based on race, religion, sexuality, gender, nationality, or similar traits are not tolerated.<br>
        1.3 Don’t initiate witch-hunts or call people out publicly — use DMs<br><br>

        <strong>2. Behavior & Chat Guidelines</strong><br>
        2.1 No spamming of any kind (text, emojis, repeated phrases, or chain messages).<br>
        2.2 Keep all conversations free of sexual themes, innuendos, or suggestive emojis.<br>
        2.3 No disruptive, intentionally irritating, or troll-like behavior.<br><br>

        <strong>3. Hate Speech & Inappropriate Material</strong><br>
        3.1 The use of racial slurs or altered forms of them is forbidden.<br>
        3.2 Do not bypass content filters with usernames or shared media.<br>
        3.3 Posting extremist, hateful, or political propaganda imagery (e.g., supremacist, terrorist, Nazi) is prohibited.<br>
        3.4 Any hateful symbols, signs, or coded references are disallowed.<br><br>

        <strong>4. NSFW & Gore Policy</strong><br>
        4.1 Sharing or posting NSFW content (nudity, pornography, extreme gore).<br>
        4.2 NSFW chat, even subtle or emoji-only references, is not allowed.<br><br>

        <strong>5. Advertising & External Links</strong><br>
        5.1 Malicious websites, phishing links, token grabbers, or scam promotions are strictly banned.<br><br>

        <strong>6. Cheating & Exploit Rules</strong><br>
        6.1 Do not hack, promote hacks, or joke about having hacks.<br>
        6.2 Never post or share exploits, cheats, or hacking guides/videos.<br>
        6.3 Reports of hackers or exploits must be submitted with video proof.<br><br>

        <strong>7. Media & Content Sharing</strong><br>
        7.1 Avoid including offensive language or filtered words in emojis, images, GIFs, or videos.<br><br>

        <em>© 2025 Void.FFA.</em>
        </div>
        `,
        width: 600,
        confirmButtonText: 'Understood',
        confirmButtonColor: '#3085d6',
        background: '#1a1a1a',
        color: '#f0f0f0'
    });
}





let playButton = createAnimatedButton(
    "https://codehs.com/uploads/5fee046b97d777d8c8021ad84cb6de20",
    1920 / 6, 1080 / 6, // Original width and height
    25, getHeight() / 2 - leftbuttonSpacing * 2.5, // Adjusted position
    1920 / 6 - 25, 1080 / 8, // Hitbox dimensions (slightly smaller than image)
    () => {
        console.log("Play button hit");
        playButtonHit(); // Call function to change menu state
         playButtonClick();
    }
);
// playButton.setText("Play"); // REMOVED TEXTf

let settingsButton = createAnimatedButton(
    "https://codehs.com/uploads/d1dabc10cb92069825cc3905b184c617",
    1920 / 8, 1080 / 8,
    25, getHeight() / 2 - leftbuttonSpacing * 1.5, // Position below Games
    1920 / 8, 1080 / 10,
    () => {
        console.log("Settings button hit");
        settingsButtonHit(); // Call new function for settings screen
         playButtonClick();
    }
);
// settingsButton.setText("Settings"); // REMOVED TEXT

let careerButton = createAnimatedButton(
    "https://codehs.com/uploads/eca6f39e9e72335f5f8118e7eaad8dc3",
    1920 / 8, 1080 / 8,
    25, getHeight() / 2 - leftbuttonSpacing * 0.5, // Position below Settings
    1920 / 8, 1080 / 10,
    () => {
        console.log("Career button hit");
        careerButtonHit(); // Call new function for career screen
         playButtonClick();
    }
);
// careerButton.setText("Career"); // REMOVED TEXT

let loadoutButton = createAnimatedButton(
    "https://codehs.com/uploads/8afd7d32fa74078c305bb952e4d7659b",
    1920 / 8, 1080 / 8,
    25, getHeight() / 2 + leftbuttonSpacing * 0.5, // Position below Career
    1920 / 8, 1080 / 10,
    () => {
        console.log("Loadout button hit");
        loadoutButtonHit(); // Call new function for loadout screen
         playButtonClick();
    }
);

let chatButton = createAnimatedButton(
    "https://codehs.com/uploads/755a17d7ba978d6bbe369953990c8e85",
    1920 / 8, 1080 / 8,
    25, getHeight() / 2 + leftbuttonSpacing * 1.5, // Position below Career
    1920 / 8, 1080 / 10,
    () => {
        console.log("Chat button hit");
        chatButtonHit(); // Call new function for loadout screen
         playButtonClick();
    }
);

let feedbackButton = createAnimatedButton(
    "https://codehs.com/uploads/7aadd2b35084d4d5d7dc63d16c1df045",
    1920 / 8, 1080 / 8,
    25, getHeight() / 2 + leftbuttonSpacing * 2.5, // Position below Career
    1920 / 8, 1080 / 10,
    () => {
        console.log("Chat button hit");
        feedbackButtonHit(); // Call new function for loadout screen
         playButtonClick();
    }
);

// Main Create Game Button (will be on the map selection screen)
let createGameBtn = createAnimatedButton(
    "https://codehs.com/uploads/66bc381a88433f3e4534a7e320539856", // Example image
    1920 / 6, 1080 / 6, // Original width and height
    getWidth() / 3 - 50, getHeight() - 250, // Position it below map options
    1920 / 6 - 25, 1080 / 8, // Hitbox dimensions
    () => {
        console.log("createGameBtn hit");
        createGameButtonHit();
         playButtonClick();
    }
);

let gamesButton = createAnimatedButton(
    "https://codehs.com/uploads/4786a0bebeb982d5d9692099047e8c49", // Provided games button image
    1920 / 6, 1080 / 6,
    getWidth() / 2 + 50, getHeight() - 250, // Position below Play
    1920 / 6 - 25, 1080 / 8,
    () => {
        console.log("Games button hit");
        gamesButtonHit();
         playButtonClick();
    }
);


let updateBoard = createAnimatedButton(
    "https://codehs.com/uploads/9323bdb40e74869eebd229ddd37ba098", // Provided games button image
    1080/3, 1440/3,
    getWidth() - (1080/3), getHeight()/2 - ((1440/3)/2), // Position below Play
    1080/3, 1440/3,
    () => {
        console.log("updateBoard button hit");
        updateBoardHit();
         playButtonClick();
    }
);


let playerCard = createAnimatedButton(
    "https://codehs.com/uploads/661908d8a660f740280ee10b350ae18b", // Provided games button image
    1080/3, 1440/3,
    getWidth()/2 - ((1080/3)/2), getHeight()/2 - ((1440/3)/2), // Position below Play
    1080/3, 1440/3,
    () => {
        console.log("updateBoard button hit");
        playerCardHit();
         playButtonClick();
    },
         getWidth()/2, getHeight()/2 + 170
);

 playerCard.setText(username); // REMOVED TEXT

let settingsMenu = new ImageShape("https://codehs.com/uploads/56483d9381657b285dc5dd85277963dd");
settingsMenu.setSize(1920, 1080);
settingsMenu.setPosition(getWidth()/2 - 1920/2, getHeight()/2 - 1080/2);

let loadoutMenu = new ImageShape("https://codehs.com/uploads/50e7492f5777ebcbaad604383f2b889f");
loadoutMenu.setSize(1920, 1080);
loadoutMenu.setPosition(getWidth()/2 - 1920/2, getHeight()/2 - 1080/2);

let careerMenu = new ImageShape("https://codehs.com/uploads/a3f192faf79ef45e5db517264dc50503");
careerMenu.setSize(1920, 1080);
careerMenu.setPosition(getWidth()/2 - 1920/2, getHeight()/2 - 1080/2);


let disclaimerText = new Text("⚠️ GAMES DO NOT AUTOCLEAR ⚠️", "30pt Arial");
disclaimerText.setColor("#ffffff");
disclaimerText.setPosition(getWidth()/2, getHeight()-100);



let escMenu = new ImageShape("https://codehs.com/uploads/ce8d9753693664ff70af6b371de3e7a0");
escMenu.setSize(1080 / 2, 1920 / 2);
escMenu.setPosition(getWidth() / 2 - (1080 / 4), getHeight() / 2 - (1920 / 4));

let inGameResumeBtn = createAnimatedButton(
    "https://codehs.com/uploads/5fbd4fb83e989f241441d27e7ab44c46", // Provided games button image
    330, 100,
    getWidth() / 2 - 330 / 2, getHeight() / 2 - 100 / 2 + 107 - 130*2,
    330, 100,
    () => {
        console.log("inGameResumeBtn hit"); // Corrected console log
        inGameResumeButtonHit();
        playButtonClick();
    }
);

function inGameResumeButtonHit() {
    clearMenuCanvas();
    settingsBox.style.display = "none";
    sensitivitySliderContainer.style.display = "none";

    // Revert canvas overlay styles
    canvas.style.display = 'none';
    canvas.style.position = '';
    canvas.style.top = '';
    canvas.style.left = '';
    canvas.style.width = '';
    canvas.style.height = '';
    canvas.style.zIndex = '';

    // Hide and lock the cursor (if pointer lock is used for gameplay)
    document.body.style.cursor = 'none';

    // Set the global game unpause state - IMPORTANT: This should be a manual unpause
    setPauseState(false, false); // Explicitly set byDeath to false
}


let inGameSettingsBtn = createAnimatedButton(
    "https://codehs.com/uploads/5fbd4fb83e989f241441d27e7ab44c46", // Provided games button image
    330, 100,
    getWidth() / 2 - 330 / 2, getHeight() / 2 - 100 / 2 + 107 - 130,
    330, 100,
    () => {
        console.log("inGameSettingsBtn hit");
        inGameSettingsButtonHit();
        playButtonClick();
    }
);

function inGameSettingsButtonHit() {
    clearMenuCanvas();
    add(settingsMenu);
    // When going to settings, you are maintaining a manual pause state
    setPauseState(true, false); // Explicitly set byDeath to false
    
    settingsBox.style.display = 'block';
    sensitivitySliderContainer.style.display = "flex";
    addBackButton(inGameBack);
}

let inGameLoadoutBtn = createAnimatedButton(
    "https://codehs.com/uploads/5fbd4fb83e989f241441d27e7ab44c46", // Provided games button image
    330, 100,
    getWidth() / 2 - 330 / 2, getHeight() / 2 - 100 / 2 + 107 + 0,
    330, 100,
    () => {
        console.log("inGameLoadoutBtn hit"); // Corrected console log
        inGameLoadoutButtonHit();
        playButtonClick();
    }
);

function inGameLoadoutButtonHit() {
  if (window.localPlayer.isDead) {
    clearMenuCanvas(); // Clear current menu elements
    setPauseState(true);
    add(loadoutMenu);
    showLoadoutScreen(); // Show our DOM loadout overlay
    addBackButton(inGameBack); // Add a back button to return to the escape menu
  } else {
    Swal.fire({
      icon: 'warning',
      title: 'Hold up!',
      text: 'You have to be dead to change loadouts.',
      confirmButtonText: 'Got it',
      background: '#1e1e1e',
      color: '#ffffff',
      confirmButtonColor: '#ff4444',
    });
  }
}

let inGameLeaveBtn = createAnimatedButton(
    "https://codehs.com/uploads/5fbd4fb83e989f241441d27e7ab44c46", // Provided games button image
    330, 100,
    getWidth() / 2 - 330 / 2, getHeight() / 2 - 100 / 2 + 107 + 130,
    330, 100,
    () => {
        console.log("inGameLeaveBtn hit"); // Corrected console log
        inGameLeaveButtonHit();
        playButtonClick();
    }
);

function inGameLeaveButtonHit() {
     location.reload();
}

inGameResumeBtn.setOpacity(0);
inGameSettingsBtn.setOpacity(0);
inGameLoadoutBtn.setOpacity(0);
inGameLeaveBtn.setOpacity(0);

/**
 * Handles returning from the settings menu back to the main escape menu.
 */
function inGameBack() {
    clearMenuCanvas();
    settingsBox.style.display = "none";
    sensitivitySliderContainer.style.display = "none";
    // Returning to main menu is still a manual pause, don't re-trigger auto-unpause logic
    setPauseState(true, false);
    hideLoadoutScreen();
    
    add(escMenu);
    add(inGameResumeBtn.image);
    makeButton(inGameResumeBtn.hitbox, inGameResumeBtn.hitbox.onClick);

    add(inGameSettingsBtn.image);
    makeButton(inGameSettingsBtn.hitbox, inGameSettingsBtn.hitbox.onClick);

    add(inGameLoadoutBtn.image);
    makeButton(inGameLoadoutBtn.hitbox, inGameLoadoutBtn.hitbox.onClick);

        add(inGameLeaveBtn.image);
        makeButton(inGameLeaveBtn.hitbox, inGameLeaveBtn.hitbox.onClick);
}

/**
 * Toggles the visibility of the pause menu and manages game pause state.
 * @param {boolean} shouldPause - True to pause and show menu, false to unpause and hide menu.
 */
function togglePauseMenuUI(shouldPause) {
    if (shouldPause) {
        add(escMenu);

        add(inGameResumeBtn.image);
        makeButton(inGameResumeBtn.hitbox, inGameResumeBtn.hitbox.onClick);
            
        add(inGameSettingsBtn.image);
        makeButton(inGameSettingsBtn.hitbox, inGameSettingsBtn.hitbox.onClick);

        add(inGameLoadoutBtn.image);
        makeButton(inGameLoadoutBtn.hitbox, inGameLoadoutBtn.hitbox.onClick);

        add(inGameLeaveBtn.image);
        makeButton(inGameLeaveBtn.hitbox, inGameLeaveBtn.hitbox.onClick);
            
        canvas.style.display = 'block';
        canvas.style.position = 'fixed';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.zIndex = '20';

        document.body.style.cursor = 'auto';

        // When toggling the UI ON, it's always a manual pause.
        setPauseState(true, false); // Explicitly set byDeath to false
    } else {
        clearMenuCanvas();
        settingsBox.style.display = "none";
        sensitivitySliderContainer.style.display = "none";

        canvas.style.display = 'none';
        canvas.style.position = '';
        canvas.style.top = '';
        canvas.style.left = '';
        canvas.style.width = '';
        canvas.style.height = '';
        canvas.style.zIndex = '';

        document.body.style.cursor = 'none';

        // When toggling the UI OFF, it's always a manual unpause.
        setPauseState(false, false); // Explicitly set byDeath to false
    }
}

// Global variable to track if the game is "in-game" and therefore eligible for pausing.
export let checkInGame = false;

// Expose togglePauseMenuUI globally if it needs to be called from input.js or other modules
window.togglePauseMenuUI = togglePauseMenuUI; // This makes it accessible from input.js

// Listen for the 'P' key press to toggle the pause menu
window.addEventListener("keydown", e => {
  if (isChatting()) return;
 //   console.log("  currentKeybinds.togglePause:", currentKeybinds.togglePause);
 //   console.log("  inputState.isPaused:", inputState.isPaused);
 //   console.log("  document.activeElement:", document.activeElement);
    // Check if the pressed key matches the currently configured togglePause keybind
    // and if the game is active and not chat-focused (assuming checkInGame is available)
    if (checkInGame && e.code === currentKeybinds.togglePause) {
             console.log("Keydown in other file:", e.code, e.key);

        // Allow toggling menu even if dead — just don't resume the game.
        if (!inputState.isPaused || inputState.wasPausedByDeath) {
            if (typeof window.togglePauseMenuUI === 'function') {
                window.togglePauseMenuUI(true); // Force show pause menu
            } else {
                console.warn("window.togglePauseMenuUI is not defined. Pause menu might not show.");
                // Fallback: Manually toggle pause state if UI function is missing
                inputState.isPaused = true;
                inputState.wasPausedByDeath = false; // Assuming manual pause isn't by death
            }
        } else {
            if (typeof window.togglePauseMenuUI === 'function') {
                window.togglePauseMenuUI(false); // Hide menu
            } else {
                console.warn("window.togglePauseMenuUI is not defined. Pause menu might not hide.");
                // Fallback: Manually toggle pause state if UI function is missing
                inputState.isPaused = false;
                inputState.wasPausedByDeath = false;
            }
        }
        e.preventDefault();
    }
});



function playerCardHit() {
    // 1) Inject popup‑wide styles (gradient & icon color)
    const style = document.createElement('style');
    style.textContent = `
      /* popup gradient & text */
      .swal2-popup-gradient {
        background: linear-gradient(to right, #C58DE3 0%, #8459ff 100%);
        color: #ffffff;
      }
      /* icon color (info icon in this case) */
      .swal2-icon.swal2-info {
        border-color: #ffffff;              /* outline */
        color: #ffffff;                     /* the “i” itself */
      }
      /* if you ever use other icons, e.g. .swal2-icon.swal2-success, you can style them here too */
    `;
    document.head.appendChild(style);

    // 2) Fire the alert, specifying confirmButtonColor
    Swal.fire({
        title: localStorage.getItem("username"),
        text: 'ur trash',
        icon: 'info',
        confirmButtonText: 'Okay',
        confirmButtonColor: '#b7adff',      // <-- button background
        customClass: {
            popup: 'swal2-popup-gradient',  // your gradient class
        }
    }).then((result) => {
        if (result.isConfirmed) {
            console.log("User acknowledged board update.");
        }
    });
}


function updateBoardHit() {
    // 1) Inject popup‑wide styles (gradient & icon color)
    const style = document.createElement('style');
    style.textContent = `
      /* popup gradient & text */
      .swal2-popup-gradient {
        background: linear-gradient(to right, #C58DE3 0%, #8459ff 100%);
        color: #ffffff;
      }
      /* icon color (info icon in this case) */
      .swal2-icon.swal2-info {
        border-color: #ffffff;              /* outline */
        color: #ffffff;                     /* the “i” itself */
      }
      /* if you ever use other icons, e.g. .swal2-icon.swal2-success, you can style them here too */
    `;
    document.head.appendChild(style);

    // 2) Fire the alert, specifying confirmButtonColor
    Swal.fire({
        title: 'Void.FFA v1.00',
        text: 'The release of Void.FFA.',
        icon: 'info',
        confirmButtonText: 'wowzery!',
        confirmButtonColor: '#b7adff',      // <-- button background
        customClass: {
            popup: 'swal2-popup-gradient',  // your gradient class
        }
    }).then((result) => {
        if (result.isConfirmed) {
            console.log("User acknowledged board update.");
        }
    });
}


/**
 * Initializes the main menu by adding all primary menu elements to the canvas.
 * Now explicitly calls makeButton for initial clickable elements.
 */
function menu() {
    if (dontyetpls == 0) {
        menuSong.play();
    }
    dontyetpls = 1;

    clearMenuCanvas(); // Clear anything previously on canvas
    sensitivitySliderContainer.style.display = "none";
    settingsBox.style.display = "none";
    hud.style.display = "none";
    chatBox.style.display = "none";
    menuBG.style.display = "flex";
    loadMenu.style.display = "none";
    add(logo.image);
    makeButton(logo.hitbox, logo.hitbox.onClick);
    add(updateBoard.image);
    makeButton(updateBoard.hitbox, updateBoard.hitbox.onClick);
    add(playButton.image);
    makeButton(playButton.hitbox, playButton.hitbox.onClick);
    add(settingsButton.image);
    makeButton(settingsButton.hitbox, settingsButton.hitbox.onClick);
    add(careerButton.image);
    makeButton(careerButton.hitbox, careerButton.hitbox.onClick);
    add(loadoutButton.image);
    makeButton(loadoutButton.hitbox, loadoutButton.hitbox.onClick);
    add(chatButton.image);
    makeButton(chatButton.hitbox, chatButton.hitbox.onClick);
    add(feedbackButton.image);
    makeButton(feedbackButton.hitbox, feedbackButton.hitbox.onClick);

    currentMenuObjects.push(
        playButton.image,
        playButton.hitbox,
        gamesButton.image,
        gamesButton.hitbox,
        settingsButton.image,
        settingsButton.hitbox,
        careerButton.image,
        careerButton.hitbox,
        loadoutButton.image,
        loadoutButton.hitbox,
        chatButton.hitbox,
        chatButton.hitbox.onClick,
        feedbackButton.hitbox,
        feedbackButton.hitbox.onClick
    );

    // Get the HTML container for the online players list
    const onlinePlayersList = document.getElementById("online-players-list");
    const onlinePlayersContainer = document.getElementById("online-players-container");
    if (onlinePlayersContainer) {
        onlinePlayersContainer.style.display = "flex";
    }

    // Create or reuse a single shared tooltip appended to body (so it's not clipped)
    const TOOLTIP_ID = "shared-stats-tooltip";
    let sharedTooltip = document.getElementById(TOOLTIP_ID);
    if (!sharedTooltip) {
        sharedTooltip = document.createElement("div");
        sharedTooltip.id = TOOLTIP_ID;
        sharedTooltip.className = "stats-tooltip"; // keep your CSS if present
        // Basic inline styles to ensure it can be positioned immediately even if CSS hasn't loaded
        Object.assign(sharedTooltip.style, {
            position: "fixed",
            left: "0px",
            top: "0px",
            display: "none",
            zIndex: 9999,
            pointerEvents: "none",
        });
        document.body.appendChild(sharedTooltip);
    }

    // Caches & trackers to avoid duplicate requests and to store results
    const statsCache = new Map();        // username -> innerHTML string
    const loadingPromises = new Map();   // username -> Promise
    let currentTooltipUsername = null;   // the username currently being shown in the tooltip

    // Helper to clamp and position the tooltip near the cursor
    function positionTooltipAt(x, y) {
        const margin = 12;
        const pad = 8;
        // initial naive placement
        let left = x + margin;
        let top = y + margin;

        // measure tooltip (may be 0 if hidden, so set defaults)
        sharedTooltip.style.display = "block"; // temporarily show so offsetWidth/Height are accurate
        const tw = sharedTooltip.offsetWidth || 220;
        const th = sharedTooltip.offsetHeight || 60;

        // clamp to viewport
        if (left + tw + pad > window.innerWidth) {
            left = window.innerWidth - tw - pad;
        }
        if (top + th + pad > window.innerHeight) {
            top = window.innerHeight - th - pad;
        }
        if (left < pad) left = pad;
        if (top < pad) top = pad;

        sharedTooltip.style.left = left + "px";
        sharedTooltip.style.top = top + "px";
    }

    // Mousemove handler that updates tooltip position (reused)
    let handleMouseMove = (e) => {
        positionTooltipAt(e.clientX, e.clientY);
    };

    // Check if the onlineUsersRef is defined before listening
    if (onlineUsersRef) {
        // Set up a listener for changes to the online users list
        onlineUsersRef.on("value", snapshot => {
            onlinePlayersList.innerHTML = ""; // Clear the list first

            // Clean caches when list changes (optional)
            // Note: if you want caches to persist across menu opens, move caches outside menu()
            // statsCache.clear();
            // loadingPromises.clear();

            if (snapshot.exists()) {
                snapshot.forEach(child => {
                    const player = child.val();
                    if (player && player.username) {
                        const username = String(player.username);
                        const playerElement = document.createElement("div");
                        playerElement.className = "online-player";
                        playerElement.textContent = username;

                        onlinePlayersList.appendChild(playerElement);

                        // --- Event listeners to show tooltip at cursor and load/cached stats ---
                        playerElement.addEventListener("mouseenter", (ev) => {
                            currentTooltipUsername = username;
                            // Show tooltip immediately with loading text while we decide
                            sharedTooltip.style.display = "block";
                            sharedTooltip.style.opacity = "1";
                            sharedTooltip.textContent = "Loading stats...";
                            positionTooltipAt(ev.clientX, ev.clientY);

                            // If cached, show cached content right away
                            if (statsCache.has(username)) {
                                sharedTooltip.innerHTML = statsCache.get(username);
                                return;
                            }

                            // If already loading, do nothing — the promise will populate the cache once done
                            if (loadingPromises.has(username)) {
                                return;
                            }

                            // Mark as loading and call fetchCareerStats
                            const p = fetchCareerStats(username, sharedTooltip)
                                .then(() => {
                                    // Save whatever HTML fetchCareerStats put into the tooltip into the cache
                                    // Note: Do not overwrite the tooltip if another user is being hovered;
                                    // always cache the result associated with the username.
                                    const html = sharedTooltip.innerHTML || `<b>${username}'s Stats:</b><br>No data.`;
                                    statsCache.set(username, html);
                                })
                                .catch(err => {
                                    sharedTooltip.textContent = "Could not load stats.";
                                    console.error("Error fetching stats for", username, err);
                                })
                                .finally(() => {
                                    loadingPromises.delete(username);
                                });
                            loadingPromises.set(username, p);

                            // start following the cursor
                            window.addEventListener("mousemove", handleMouseMove);
                        });

                        playerElement.addEventListener("mousemove", (ev) => {
                            // update position more responsively while inside the element
                            positionTooltipAt(ev.clientX, ev.clientY);
                        });

                        playerElement.addEventListener("mouseleave", () => {
                            // hide tooltip
                            sharedTooltip.style.display = "none";
                            currentTooltipUsername = null;

                            // stop following cursor
                            window.removeEventListener("mousemove", handleMouseMove);
                        });
                    }
                });
            } else {
                // Display a message if no one is online
                const noPlayers = document.createElement("p");
                noPlayers.textContent = "No players online.";
                onlinePlayersList.appendChild(noPlayers);
            }
        });
    } else {
        const noRef = document.createElement("p");
        noRef.textContent = "Could not load online players.";
        onlinePlayersList.appendChild(noRef);
    }
}


// Helper to start game after menu hides
function showMenuOverlay() {
  const menuOverlay = document.getElementById("menu-overlay");
  if (menuOverlay) {
    menuOverlay.style.display = "flex";
    menuOverlay.classList.remove("hidden");
  }
  if (canvas) {
    canvas.style.display = "block";
  }
  const gameWrapper = document.getElementById("game-container");
  if (gameWrapper) {
    gameWrapper.style.display = "none";
  }
  const crosshair = document.getElementById("crosshair");
  if (crosshair) crosshair.style.display = "none";
}

async function initAndStartGame(username, mapName, gameId = null) {
     clearMenuCanvas();
     removeSearchInput();
     checkInGame = true; 
     dontyetpls = 0;
     hud.style.display = "block";
     chatBox.style.display = "flex";
  // Read your UI flags up front
  const detailsEnabled = localStorage.getItem("detailsEnabled") === true;
  const ffaEnabled     = true; // ← or read from your HTML toggle if you have one

  // Hide the canvas‑menu overlay
  const menuOverlay = document.getElementById("menu-overlay");
  if (menuOverlay) menuOverlay.classList.add("hidden");
  if (canvas)      canvas.style.display = "none";

  // Ensure game container exists
  const gameWrapper = document.getElementById("game-container");
  if (!gameWrapper) {
    console.error("game-container element not found! Cannot start game.");
    Swal.fire('Error', 'Game container not found, cannot start game.', 'error');
    return menu();
  }

  // Bring up the in‑game UI
  menuSong.pause();
  gameWrapper.style.display = "block";
  createGameUI(gameWrapper);
  initBulletHoles(gameWrapper);

  // 2) Only once the network is live do we actually start the game loop
  startGame(username, mapName, detailsEnabled, ffaEnabled, gameId);
     menuBG.style.display = "none";
  console.log(
    `Game started for map: ${mapName}, Username: ${username}, ` +
    `Details: ${detailsEnabled}, FFA: ${ffaEnabled}, Game ID: ${gameId}`
  );
}

/**
 * Function called when the "Play" button (canvas-drawn) is clicked.
 * Clears the current menu and displays the canvas-based map selection options.
 */
function playButtonHit() {
    clearMenuCanvas(); // Clear all current canvas objects

    // ADDED: Hide the online players list container
    const onlinePlayersContainer = document.getElementById("online-players-container");
    if (onlinePlayersContainer) {
        onlinePlayersContainer.style.display = "none";
    }

    add(logo.image);
    makeButton(logo.hitbox, logo.hitbox.onClick);
    add(playerCard.image);
    add(playerCard.text);
    makeButton(playerCard.hitbox, playerCard.hitbox.onClick);

    add(gamesButton.image);
    // add(gamesButton.text); // REMOVED TEXT
    makeButton(gamesButton.hitbox, gamesButton.hitbox.onClick);
    // Add the "Create Game" button
    add(createGameBtn.image);
    add(createGameBtn.text);
    makeButton(createGameBtn.hitbox, createGameBtn.hitbox.onClick);
    currentMenuObjects.push(createGameBtn.image, createGameBtn.text, createGameBtn.hitbox);

    addBackButton(menu); // Add back button to this screen
}


let chatListener = null;

function centerChatBox() {
    const rect = chatBox.getBoundingClientRect();
    chatBox.style.position = 'absolute';
    chatBox.style.top = `calc(50% - ${rect.height / 2}px)`;
    chatBox.style.left = `calc(50% - ${rect.width / 2}px)`;
}

function createMenuChatElements() {
    chatBox.style.display = 'flex';
document.documentElement.style.setProperty('--scale', '1.5');
    centerChatBox(); // center when first created
}

let chatCooldown = false;

function initChatUI() {
    const form = document.getElementById("chat-form");
    const input = document.getElementById("chat-input");
    const messagesBox = document.getElementById("chat-messages");
    let chatCooldown = false;

    form.addEventListener("submit", event => {
        event.preventDefault();  // Prevent the page from refreshing

        if (chatCooldown) return;

        const text = input.value.trim();
        if (!text) return;

        const username = localStorage.getItem("username") || "Guest";
        sendChatMessage(username, text);

        input.value = "";

        chatCooldown = true;
        setTimeout(() => (chatCooldown = false), 2000);
    });

    // Optional: scroll down helper after messages added
    messagesBox.scrollTop = messagesBox.scrollHeight;
}

function destroyMenuChatElements() {
document.documentElement.style.setProperty('--scale', '0.85');
    chatBox.style.display = 'none';
    chatBox.style.top = '20px';
    chatBox.style.left = '20px';
    
    // 1) Remove Firebase listener
    if (menuChatRef && chatListener) {
        menuChatRef.off("child_added", chatListener);
        chatListener = null;
    }

    // 2) Clear chat messages for the local player
    const messagesBox = document.getElementById("chat-messages");
    if (messagesBox) {
        messagesBox.innerHTML = ""; // Removes all messages from DOM
    }
}
function initMenuChat() {
    // 1) Build the DOM
    createMenuChatElements();

    // 2) Wire up Enter-key send
    initChatUI();

    // 3) Listen for incoming messages
    chatListener = menuChatRef.on('child_added', snapshot => {
        const { username, text } = snapshot.val();
        addChatMessage(username, text, snapshot.key);
        
        const messagesBox = document.getElementById("chat-messages");
        messagesBox.scrollTop = messagesBox.scrollHeight;

        // recenter after new message changes size
        centerChatBox();
    });
}


export function sendChatMessage(username, text) {
    if (!menuChatRef) {
        return console.warn("Chat not initialized yet");
    }

    // Normalize input type
    if (typeof text !== 'string') text = String(text);

    // Keep strict length rule but do NOT show a popup — just warn and don't send.
    if (text.length > 100) {
        console.warn("Message not sent: exceeds 100-character limit.");
        return;
    }

    // Prefer the newer masking API if available (does not show alerts)
    let sanitized = text;
    try {
        if (typeof filterOrMaskMessage === 'function') {
            const res = filterOrMaskMessage(text);
            if (!res.allowed) {
                // unsupported-characters or strict block — silently refuse (console.warn for debug)
                console.warn("Message blocked by autofilter:", res.reason);
                return;
            }
            sanitized = res.text;
        } else {
            // Fallback: use diagnoseMessage/sanitizeMessage without invoking any UI popups.
            if (typeof diagnoseMessage === 'function') {
                const diag = diagnoseMessage(text);
                if (diag && diag.blocked) {
                    if (diag.reason === 'unsupported-characters') {
                        console.warn("Message blocked by autofilter:", diag.reason);
                        return;
                    }
                    // try to sanitize if sanitizeMessage exists; otherwise silently refuse
                    if (typeof sanitizeMessage === 'function') {
                        sanitized = sanitizeMessage(text);
                    } else {
                        console.warn("Message blocked by autofilter (no sanitizer available).");
                        return;
                    }
                }
            }
        }
    } catch (err) {
        // if something goes wrong with filtering logic, don't show UI — log and send original text as a safe fallback
        console.error("Autofilter error (sending original text):", err);
        sanitized = text;
    }

    menuChatRef.push({ username, text: sanitized, timestamp: Date.now() })
        .catch(err => console.error("Failed to send chat:", err));
}


export function chatButtonHit() {
    clearMenuCanvas();

    const onlinePlayersContainer = document.getElementById("online-players-container");
    if (onlinePlayersContainer) {
        onlinePlayersContainer.style.display = "none";
    }

     
    add(logo.image);
    makeButton(logo.hitbox, logo.hitbox.onClick);
  addBackButton(menu, destroyMenuChatElements);
    initMenuChat();
}







let __authorFilter = ""; // filter by author substring (case-insensitive)
let __titleFilter = "";  // filter by post title substring (case-insensitive)


if (!document.getElementById("swal-high-style")) {
  const s = document.createElement("style");
  s.id = "swal-high-style";
  s.innerHTML = `
    .swal-container-high { z-index: 999999 !important; }
    .swal-popup-high { z-index: 1000000 !important; }
  `;
  document.head.appendChild(s);
}

// local ID and username helpers
function getLocalAuthorId() {
  try {
    let id = localStorage.getItem("localAuthorId");
    if (!id) {
      id = "local_" + Date.now().toString(36) + "_" + Math.floor(Math.random()*1e6).toString(36);
      localStorage.setItem("localAuthorId", id);
    }
    return id;
  } catch (e) {
    return "local_fallback";
  }
}

async function getOrAskUsername() {
  const keys = ["username", "playerName", "player", "user", "playerId"];
  let name = null;
  try { if (window.currentPlayerName) name = window.currentPlayerName; } catch(e){}
  if (!name) {
    for (const k of keys) {
      const v = localStorage.getItem(k);
      if (v) { name = v; break; }
    }
  }
  if (!name && typeof window.username === "string" && window.username) name = window.username;
  if (name) return name;

  const { value: username } = await Swal.fire({
    title: "Choose a username",
    input: "text",
    inputPlaceholder: "Enter a display name (max 30 chars)",
    inputAttributes: { maxlength: 30 },
    showCancelButton: true,
    confirmButtonText: "Save",
    customClass: { popup: "swal-popup-high", container: "swal-container-high" }
  });

  if (!username) return null;
  const trimmed = username.trim();
  if (!trimmed) return null;
  try { localStorage.setItem("username", trimmed); } catch (e) {}
  return trimmed;
}

// Basic cleanup of overlays / listeners
function removeFeedbackOverlay() {
  const existing = document.getElementById("feedback-overlay");
  if (existing) existing.remove();
  const fv = document.getElementById("forum-viewer-overlay");
  if (fv) fv.remove();

  if (window.__feedbackListener && window.feedbackRef) {
    try { window.feedbackRef.off("value", window.__feedbackListener); } catch(e) {}
  }
  window.__feedbackListener = null;

  if (window.__forumCommentListeners) {
    Object.keys(window.__forumCommentListeners).forEach(k => {
      try { window.__forumCommentListeners[k].ref.off("value", window.__forumCommentListeners[k].fn); } catch(e) {}
    });
  }
  window.__forumCommentListeners = {};
}

// ---------- State for paging & sorting ----------
let __postsCache = []; // array of post objects { __key, title, description, author, authorId, createdAt, likes, dislikes, views, comments }
let __currentPage = 1;
const __postsPerPage = 10;
let __currentSort = "newest"; // options: newest, mostLiked, mostDisliked, mostViewed, name

// ---------- Rendering helpers ----------
function countObjKeys(obj) {
  try { return obj ? Object.keys(obj).length : 0; } catch(e){ return 0; }
}

function buildForumCardUI(post) {
  const key = post.__key;
  const localId = getLocalAuthorId();
  const likesCount = countObjKeys(post.likes);
  const dislikesCount = countObjKeys(post.dislikes);
  const viewsCount = countObjKeys(post.views);
  const commentsCount = countObjKeys(post.comments);

  const wrapper = document.createElement("div");
  Object.assign(wrapper.style, {
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: "8px",
    padding: "12px",
    marginBottom: "10px",
    background: "rgba(0,0,0,0.45)",
    color: "#fff",
    boxShadow: "0 4px 10px rgba(0,0,0,0.45)",
    cursor: "pointer"
  });

  // title + author row
  const titleRow = document.createElement("div");
  titleRow.style.display = "flex";
  titleRow.style.justifyContent = "space-between";
  titleRow.style.alignItems = "center";

  const title = document.createElement("div");
  title.textContent = post.title || "Untitled";
  Object.assign(title.style, { fontWeight: "700", fontSize: "16px" });

  const rightSide = document.createElement("div");
  rightSide.style.display = "flex";
  rightSide.style.alignItems = "center";
  rightSide.style.gap = "8px";

  const meta = document.createElement("div");
  meta.textContent = `by ${post.author || "Anonymous"}`;
  Object.assign(meta.style, { fontSize: "12px", opacity: "0.85", marginLeft: "12px" });

  rightSide.appendChild(meta);

  // delete button for owner (keeps same behavior)
  if (post.authorId && post.authorId === localId) {
    const delBtn = document.createElement("button");
    delBtn.textContent = "Delete";
    Object.assign(delBtn.style, { padding: "6px 8px", borderRadius: "6px", border: "none", cursor: "pointer", background: "transparent", color: "#ff8080", fontWeight: "700" });
    delBtn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const ok = await Swal.fire({
        title: "Delete post?",
        text: "This will permanently remove the forum post and all comments.",
        icon: "warning",
        showCancelButton: true,
        confirmButtonText: "Delete",
        customClass: { popup: "swal-popup-high", container: "swal-container-high" }
      });
      if (!ok.isConfirmed) return;
      if (!window.feedbackRef) return Swal.fire({ title: "Not connected", text: "Feedback DB not initialized.", icon: "error", customClass: { popup: "swal-popup-high", container: "swal-container-high" } });
      try {
        await window.feedbackRef.child(post.__key).remove();
        const fv = document.getElementById("forum-viewer-overlay");
        if (fv) fv.remove();
        if (window.__forumCommentListeners && window.__forumCommentListeners[post.__key]) {
          try { window.__forumCommentListeners[post.__key].ref.off("value", window.__forumCommentListeners[post.__key].fn); } catch(e) {}
          delete window.__forumCommentListeners[post.__key];
        }
        Swal.fire({ title: "Deleted", icon: "success", timer: 900, showConfirmButton: false, customClass: { popup: "swal-popup-high", container: "swal-container-high" } });
      } catch (err) {
        console.error("Failed to delete forum post:", err);
        Swal.fire({ title: "Error", text: "Could not delete forum post.", icon: "error", customClass: { popup: "swal-popup-high", container: "swal-container-high" } });
      }
    });
    rightSide.appendChild(delBtn);
  }

  titleRow.appendChild(title);
  titleRow.appendChild(rightSide);

  // byline + description snippet (paragraphed for readability)
  const byline = document.createElement("div");
  byline.textContent = `Posted by: ${post.author || "Anonymous"}`;
  Object.assign(byline.style, { fontSize: "12px", opacity: "0.85", marginTop: "6px" });

  const desc = document.createElement("div");
  const fullDesc = post.description || "";
  // show short preview but preserve paragraph breaks
  const previewText = fullDesc.length > 200 ? (fullDesc.slice(0,200) + "...") : fullDesc;
  // convert newlines to separate <p>
  const paras = previewText.split(/\n+/).map(s => s.trim()).filter(Boolean);
  desc.innerHTML = paras.map(p => `<p style="margin:6px 0; line-height:1.3; font-size:13px; opacity:.95">${escapeHtml(p)}</p>`).join("");
  Object.assign(desc.style, { whiteSpace: "normal", marginTop: "8px", pointerEvents: "none" });

  // stats & buttons row (keeps same behavior)
  const statsRow = document.createElement("div");
  statsRow.style.display = "flex";
  statsRow.style.justifyContent = "space-between";
  statsRow.style.alignItems = "center";
  statsRow.style.marginTop = "10px";

  const leftStats = document.createElement("div");
  leftStats.style.display = "flex";
  leftStats.style.gap = "12px";
  leftStats.style.alignItems = "center";

  const likeBtn = document.createElement("button");
  likeBtn.textContent = `👍 ${likesCount}`;
  Object.assign(likeBtn.style, { border: "none", background: "transparent", cursor: "pointer", fontWeight: "700", color: post.likes && post.likes[localId] ? "#7af" : "#fff" });

  const dislikeBtn = document.createElement("button");
  dislikeBtn.textContent = `👎 ${dislikesCount}`;
  Object.assign(dislikeBtn.style, { border: "none", background: "transparent", cursor: "pointer", fontWeight: "700", color: post.dislikes && post.dislikes[localId] ? "#f77" : "#fff" });

  const viewsEl = document.createElement("div");
  viewsEl.textContent = `👁 ${viewsCount}`;
  Object.assign(viewsEl.style, { fontSize: "13px", opacity: "0.9" });

  const commentsEl = document.createElement("div");
  commentsEl.textContent = `💬 ${commentsCount}`;
  Object.assign(commentsEl.style, { fontSize: "13px", opacity: "0.9" });

  leftStats.appendChild(likeBtn);
  leftStats.appendChild(dislikeBtn);
  leftStats.appendChild(viewsEl);
  leftStats.appendChild(commentsEl);

  statsRow.appendChild(leftStats);

  wrapper.appendChild(titleRow);
  wrapper.appendChild(byline);
  wrapper.appendChild(desc);

  // thumbnails row (show up to 3) — clicking opens viewer (so user can see full gallery)
  if (post.images && Array.isArray(post.images) && post.images.length) {
    const thumbRow = document.createElement("div");
    Object.assign(thumbRow.style, { display: "flex", gap: "8px", marginTop: "8px", alignItems: "center" });
    const maxThumbs = 3;
    post.images.slice(0, maxThumbs).forEach((src, idx) => {
      const t = document.createElement("img");
      t.src = src;
      Object.assign(t.style, { width: "84px", height: "60px", objectFit: "cover", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.03)", cursor: "pointer" });
      t.addEventListener("click", (ev) => { ev.stopPropagation(); openForumViewer(key, src); }); // pass src to preselect
      thumbRow.appendChild(t);
    });
    if (post.images.length > maxThumbs) {
      const more = document.createElement("div");
      more.textContent = `+${post.images.length - maxThumbs}`;
      Object.assign(more.style, { fontSize: "12px", opacity: "0.8", marginLeft: "6px" });
      thumbRow.appendChild(more);
    }
    wrapper.appendChild(thumbRow);
  }

  wrapper.appendChild(statsRow);

  // clicking the card opens the viewer
  const openViewerHandler = (e) => { openForumViewer(key); };
  wrapper.addEventListener("click", openViewerHandler);

  // like/dislike handlers (same logic as before)
  likeBtn.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    if (!window.feedbackRef) return;
    const localId = getLocalAuthorId();
    const postRef = window.feedbackRef.child(key);
    const likesRef = postRef.child("likes").child(localId);
    const dislikesRef = postRef.child("dislikes").child(localId);

    try {
      const likedSnap = await likesRef.once("value");
      const updates = {};
      if (likedSnap.exists()) {
        updates[`/feedback/${key}/likes/${localId}`] = null;
      } else {
        updates[`/feedback/${key}/likes/${localId}`] = true;
        updates[`/feedback/${key}/dislikes/${localId}`] = null;
      }
      await firebase.database().ref().update(updates);
    } catch (err) {
      console.error("like toggle error:", err);
      Swal.fire({ title: "Error", text: "Could not update like.", icon: "error", customClass: { popup: "swal-popup-high", container: "swal-container-high" } });
    }
  });

  dislikeBtn.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    if (!window.feedbackRef) return;
    const localId = getLocalAuthorId();
    const postRef = window.feedbackRef.child(key);
    const likesRef = postRef.child("likes").child(localId);
    const dislikesRef = postRef.child("dislikes").child(localId);

    try {
      const dislikedSnap = await dislikesRef.once("value");
      const updates = {};
      if (dislikedSnap.exists()) {
        updates[`/feedback/${key}/dislikes/${localId}`] = null;
      } else {
        updates[`/feedback/${key}/dislikes/${localId}`] = true;
        updates[`/feedback/${key}/likes/${localId}`] = null;
      }
      await firebase.database().ref().update(updates);
    } catch (err) {
      console.error("dislike toggle error:", err);
      Swal.fire({ title: "Error", text: "Could not update dislike.", icon: "error", customClass: { popup: "swal-popup-high", container: "swal-container-high" } });
    }
  });

  return wrapper;
}

// small helper to HTML-escape user text when injecting as HTML
function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/[&<>"']/g, function (m) {
    return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;' })[m];
  });
}

function showImageLightbox(src) {
  // remove existing
  const existing = document.getElementById("image-lightbox-overlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "image-lightbox-overlay";
  Object.assign(overlay.style, {
    position: "fixed",
    left: "0",
    top: "0",
    right: "0",
    bottom: "0",
    zIndex: "300000",
    background: "rgba(0,0,0,0.85)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "20px",
    cursor: "zoom-out"
  });

  const img = document.createElement("img");
  img.src = src;
  Object.assign(img.style, {
    maxWidth: "95%",
    maxHeight: "95%",
    objectFit: "contain",
    borderRadius: "8px",
    boxShadow: "0 10px 40px rgba(0,0,0,0.6)"
  });

  overlay.appendChild(img);
  document.body.appendChild(overlay);

  const remove = () => {
    try { overlay.remove(); } catch (e) {}
    window.removeEventListener("keydown", onKey);
  };
  overlay.addEventListener("click", remove);
}

function renderPostGallery(post, contentWrap) {
  if (!(post && post.images && Array.isArray(post.images) && post.images.length)) return;
  const galleryWrap = document.createElement("div");
  Object.assign(galleryWrap.style, { display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px" });

  const mainImg = document.createElement("img");
  mainImg.src = post.images[0];
  Object.assign(mainImg.style, { maxWidth: "100%", maxHeight: "36vh", objectFit: "contain", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.04)" });

  const thumbs = document.createElement("div");
  Object.assign(thumbs.style, { display: "flex", gap: "8px", alignItems: "center", overflowX: "auto" });

  post.images.forEach((src, idx) => {
    const ti = document.createElement("img");
    ti.src = src;
    Object.assign(ti.style, { width: "84px", height: "64px", objectFit: "cover", borderRadius: "6px", cursor: "pointer", border: idx === 0 ? "2px solid #7af" : "1px solid rgba(255,255,255,0.03)" });
    ti.addEventListener("click", (ev) => {
      ev.stopPropagation();
      mainImg.src = src;
      Array.from(thumbs.children).forEach((c, i) => c.style.border = i === idx ? "2px solid #7af" : "1px solid rgba(255,255,255,0.03)");
    });
    thumbs.appendChild(ti);
  });

  galleryWrap.appendChild(mainImg);
  galleryWrap.appendChild(thumbs);
  contentWrap.appendChild(galleryWrap);
}

// ---------- Sorting/filtering/paging ----------
function applyFiltersAndSort(posts) {
  // filter by title substring if provided
  let filtered = posts.slice();

  if (__titleFilter && __titleFilter.trim().length > 0) {
    const fT = __titleFilter.trim().toLowerCase();
    filtered = filtered.filter(p => (p.title || "").toLowerCase().includes(fT));
  }

  // sort
  if (__currentSort === "newest") {
    filtered.sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0));
  } else if (__currentSort === "mostLiked") {
    filtered.sort((a,b) => countObjKeys(b.likes) - countObjKeys(a.likes));
  } else if (__currentSort === "mostDisliked") {
    filtered.sort((a,b) => countObjKeys(b.dislikes) - countObjKeys(a.dislikes));
  } else if (__currentSort === "mostViewed") {
    filtered.sort((a,b) => countObjKeys(b.views) - countObjKeys(a.views));
  } else if (__currentSort === "name") {
    // now sorts by title (label changed to "By title")
    filtered.sort((a,b) => ("" + (a.title || "")).localeCompare(b.title || ""));
  }
  return filtered;
}

function renderPageControls(container, totalPosts) {
  // remove old controls
  const existing = document.getElementById("posts-page-controls");
  if (existing) existing.remove();

  const pages = Math.max(1, Math.ceil(totalPosts / __postsPerPage));
  __currentPage = Math.min(__currentPage, pages);

  const controls = document.createElement("div");
  controls.id = "posts-page-controls";
  Object.assign(controls.style, { display: "flex", gap: "8px", alignItems: "center", justifyContent: "center", marginTop: "8px" });

  const prev = document.createElement("button");
  prev.textContent = "Prev";
  prev.disabled = __currentPage <= 1;
  prev.addEventListener("click", () => { __currentPage = Math.max(1, __currentPage - 1); renderPostsList(); });

  const next = document.createElement("button");
  next.textContent = "Next";
  next.disabled = __currentPage >= pages;
  next.addEventListener("click", () => { __currentPage = Math.min(pages, __currentPage + 1); renderPostsList(); });

  controls.appendChild(prev);

  // show up to 7 page buttons (compact)
  const start = Math.max(1, __currentPage - 3);
  const end = Math.min(pages, start + 6);
  for (let i = start; i <= end; i++) {
    const pBtn = document.createElement("button");
    pBtn.textContent = String(i);
    if (i === __currentPage) pBtn.disabled = true;
    pBtn.addEventListener("click", () => { __currentPage = i; renderPostsList(); });
    controls.appendChild(pBtn);
  }

  controls.appendChild(next);

  container.appendChild(controls);
}

function renderPostsList() {
  const postsContainer = document.getElementById("posts-list-container");
  if (!postsContainer) return;

  // apply filters and sorts to cache
  const filtered = applyFiltersAndSort(__postsCache);
  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / __postsPerPage));
  __currentPage = Math.min(Math.max(1, __currentPage), pages);

  postsContainer.innerHTML = "";

  const start = (__currentPage - 1) * __postsPerPage;
  const end = Math.min(filtered.length, start + __postsPerPage);
  for (let i = start; i < end; i++) {
    const p = filtered[i];
    const card = buildForumCardUI(p);
    postsContainer.appendChild(card);
  }

  // render controls below
  renderPageControls(postsContainer, total);
}

// ---------- Firebase listener ----------
function attachFeedbackListener(postsContainer) {
  if (!window.feedbackRef) {
    postsContainer.innerHTML = "<div style='opacity:.8'>Feedback DB not initialized.</div>";
    return;
  }
  if (window.__feedbackListener && window.feedbackRef) {
    try { window.feedbackRef.off("value", window.__feedbackListener); } catch(e) {}
  }

  const listener = (snap) => {
    const val = snap.exists() ? snap.val() : null;
    const arr = [];
    if (val) {
      Object.keys(val).forEach(k => {
        const p = val[k] || {};
        p.__key = k;
        // ensure nested objects exist
        p.likes = p.likes || {};
        p.dislikes = p.dislikes || {};
        p.views = p.views || {};
        p.comments = p.comments || {};
        arr.push(p);
      });
    }
    __postsCache = arr;
    __currentPage = 1; // reset to first page when data updates
    renderPostsList();
  };

  window.__feedbackListener = listener;
  window.feedbackRef.on("value", listener);
}

// ---------- viewer: marks view once and shows comments + comment posting ----------
// ---------- viewer: marks view once and shows threaded comments/replies (collapsible) ----------
async function openForumViewer(postKey, preselectImageSrc = null) {
  if (!window.feedbackRef) {
    Swal.fire({ title: "Not connected", text: "Feedback DB not initialized.", icon: "error", customClass: { popup: "swal-popup-high", container: "swal-container-high" } });
    return;
  }

  try {
    const snap = await window.feedbackRef.child(postKey).once("value");
    if (!snap.exists()) {
      Swal.fire({ title: "Not found", text: "This forum no longer exists.", icon: "error", customClass: { popup: "swal-popup-high", container: "swal-container-high" } });
      return;
    }
    const post = snap.val();

    // mark view (unchanged)
    const localId = getLocalAuthorId();
    const viewRef = window.feedbackRef.child(postKey).child("views").child(localId);
    try {
      const vsnap = await viewRef.once("value");
      if (!vsnap.exists()) {
        await viewRef.set(true).catch(err => console.warn("Failed to set view:", err));
      }
    } catch (e) {
      console.warn("view check failed:", e);
    }

    // remove previous overlay if present
    const prev = document.getElementById("forum-viewer-overlay");
    if (prev) prev.remove();

    // ensure state container for this post exists (persists across updates)
    window.__forumViewerState = window.__forumViewerState || {};
    if (!window.__forumViewerState[postKey]) {
      window.__forumViewerState[postKey] = {
        expanded: {},
        composer: {}
      };
    }
    const state = window.__forumViewerState[postKey];

    //
    // Build DOM nodes off-DOM (do not append overlay to document yet).
    // This ensures the description gets paragraphed and measured
    // before anything gets added to document and causes scrolling.
    //

    // create overlay container (not yet appended)
    const overlay = document.createElement("div");
    overlay.id = "forum-viewer-overlay";
    Object.assign(overlay.style, {
      position: "fixed", left: "50%", top: "50%", transform: "translate(-50%, -50%)",
      width: "70vw", height: "75vh", zIndex: "20000",
      background: "rgba(8,10,12,0.97)", border: "1px solid rgba(255,255,255,0.06)",
      borderRadius: "10px", padding: "18px", boxSizing: "border-box",
      display: "flex", flexDirection: "column", color: "#fff", overflow: "hidden",
      backdropFilter: "blur(6px)"
    });

    // header
    const header = document.createElement("div");
    Object.assign(header.style, { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" });

    const hTitle = document.createElement("div");
    hTitle.textContent = post.title || "Untitled";
    Object.assign(hTitle.style, { fontWeight: "800", fontSize: "18px" });

    const hMeta = document.createElement("div");
    hMeta.textContent = `by ${post.author || "Anonymous"}`;
    Object.assign(hMeta.style, { fontSize: "12px", opacity: "0.85" });

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "✕";
    Object.assign(closeBtn.style, { border: "none", background: "transparent", color: "#fff", cursor: "pointer", fontSize: "18px" });

    header.appendChild(hTitle);
    header.appendChild(hMeta);
    header.appendChild(closeBtn);

    // contentWrap (this will be the scrollable area INSIDE overlay)
    const contentWrap = document.createElement("div");
    Object.assign(contentWrap.style, { flex: "1", overflow: "auto", display: "flex", flexDirection: "column", gap: "12px" });

    const postedByLine = document.createElement("div");
    postedByLine.textContent = `Posted by: ${post.author || "Anonymous"}`;
    Object.assign(postedByLine.style, { fontSize: "12px", opacity: "0.9", marginBottom: "6px" });

    // ----------------------------
    // DESCRIPTION: paragraph-split early (off-DOM)
    // ----------------------------
    const descBox = document.createElement("div");
    Object.assign(descBox.style, {
  padding: "12px",
  borderRadius: "8px",
  background: "rgba(255,255,255,0.02)",
  border: "1px solid rgba(255,255,255,0.03)",
  /* <-- minimal additions to prevent horizontal scroll from long tokens */
  overflowWrap: "anywhere",
  wordBreak: "break-word",
  whiteSpace: "pre-wrap",
  maxWidth: "100%",
  boxSizing: "border-box"
});

     const descText = (post.description || "").toString();

     // escapeHtml fallback (if you already have one, the OR will keep yours)
     const escapeHtml = window.escapeHtml || function (str) {
       return String(str)
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#39;");
     };
     
     // Split into paragraphs:
     // 1) Normalize line endings
     // 2) Split on two-or-more newlines or explicit <br> tags (common copy/paste cases).
function splitIntoParagraphs(text, maxLen = 240) {
    if (!text) return [];

    const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    // Start by splitting on both double newlines and single newlines
    let paras = normalized.split(/\n{2,}|\n|\<br\s*\/?\>/i)
        .map(s => s.trim())
        .filter(Boolean);

    // Now check if a single long paragraph was returned by the split
    if (paras.length === 1 && paras[0].length > maxLen) {
        // If there's only one long paragraph, try sentence-based grouping
        const single = paras[0];
        const sentences = single.match(/[^.!?]+[.!?]*/g) || [single];

        const grouped = [];
        let cur = "";
        for (let s of sentences) {
            s = s.trim();
            if (!s) continue;
            if ((cur + " " + s).trim().length <= maxLen) {
                cur = (cur + " " + s).trim();
            } else {
                if (cur) grouped.push(cur);
                cur = s;
            }
        }
        if (cur) grouped.push(cur);

        return grouped.length ? grouped : [single];
    }

    return paras.length ? paras : [normalized.trim()];
}
     
     // Build paras and set innerHTML safely
const paras = splitIntoParagraphs(descText, 240);
if (!paras.length) {
  const p = document.createElement("p");
  p.textContent = "No description.";
  Object.assign(p.style, { margin: "6px 0", lineHeight: "1.4", fontSize: "14px", opacity: ".9" });
  descBox.appendChild(p);
} else {
  paras.forEach(pText => {
    const pEl = document.createElement("p");
    pEl.textContent = pText; // safe (auto-escapes)
    Object.assign(pEl.style, {
  margin: "8px 0",
  lineHeight: "1.45",
  fontSize: "14px",
  opacity: ".95",
  /* ensure long unbroken tokens can wrap */
  overflowWrap: "anywhere",
  wordBreak: "break-word",
  whiteSpace: "pre-wrap"
});
    descBox.appendChild(pEl);
  });
}

    // ADD description (off-DOM) into contentWrap now (so browser lays it out before we attach)
    contentWrap.appendChild(postedByLine);
    contentWrap.appendChild(descBox);

    // build image gallery (if any), but do NOT append overlay yet
    let imagesToWait = [];
    if (post.images && Array.isArray(post.images) && post.images.length) {
      const galleryWrap = document.createElement("div");
      Object.assign(galleryWrap.style, { display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px" });

      const mainImg = document.createElement("img");
      mainImg.src = preselectImageSrc || post.images[0];
      Object.assign(mainImg.style, { maxWidth: "100%", maxHeight: "36vh", objectFit: "contain", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.04)", cursor: "zoom-in" });
      mainImg.addEventListener("click", (ev) => { ev.stopPropagation(); showImageLightbox(mainImg.src); });

      // we want to ensure layout stabilizes after images load
      imagesToWait.push(mainImg);

      const thumbs = document.createElement("div");
      Object.assign(thumbs.style, { display: "flex", gap: "8px", alignItems: "center", overflowX: "auto" });

      post.images.forEach((src, idx) => {
        const ti = document.createElement("img");
        ti.src = src;
        Object.assign(ti.style, { width: "84px", height: "64px", objectFit: "cover", borderRadius: "6px", cursor: "pointer", border: src === mainImg.src ? "2px solid #7af" : "1px solid rgba(255,255,255,0.03)" });
        ti.addEventListener("click", (ev) => {
          ev.stopPropagation();
          mainImg.src = src;
          Array.from(thumbs.children).forEach((c, i) => c.style.border = (i === idx ? "2px solid #7af" : "1px solid rgba(255,255,255,0.03)"));
          // keep the description visible if thumbnails change layout
          requestAnimationFrame(() => contentWrap.scrollTop = 0);
        });
        ti.addEventListener("dblclick", (ev) => { ev.stopPropagation(); showImageLightbox(src); });

        thumbs.appendChild(ti);
        imagesToWait.push(ti);
      });

      galleryWrap.appendChild(mainImg);
      galleryWrap.appendChild(thumbs);
      contentWrap.appendChild(galleryWrap);
    }

    // comments header and container (unchanged)
    const commentsHeader = document.createElement("div");
    commentsHeader.textContent = "Comments";
    Object.assign(commentsHeader.style, { fontWeight: "700", marginTop: "6px" });

    const commentsContainer = document.createElement("div");
    Object.assign(commentsContainer.style, { display: "flex", flexDirection: "column", gap: "12px" });

    // comment form
    const commentForm = document.createElement("div");
    Object.assign(commentForm.style, { display: "flex", gap: "8px", alignItems: "flex-start" });

    const commentInput = document.createElement("textarea");
    commentInput.placeholder = "Write a comment... (max 500 chars)";
    commentInput.maxLength = 500;
    Object.assign(commentInput.style, { flex: "1", height: "72px", resize: "vertical", padding: "10px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.45)", color: "#fff" });
    // Important: ensure it won't auto-focus and cause page scroll
    commentInput.autofocus = false;

    const submitBtn = document.createElement("button");
    submitBtn.textContent = "Post";
    Object.assign(submitBtn.style, { padding: "10px 14px", borderRadius: "8px", border: "none", cursor: "pointer", fontWeight: "700", background: "linear-gradient(90deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))", color: "#fff" });

    commentForm.appendChild(commentInput);
    commentForm.appendChild(submitBtn);

    // assemble overlay (still off-DOM)
     overlay.appendChild(header);
     contentWrap.appendChild(commentsHeader);
     contentWrap.appendChild(commentsContainer);
     contentWrap.appendChild(commentForm);
     overlay.appendChild(contentWrap);

    // Now: append overlay to DOM only AFTER description + (initial) images were created.
    // Also prevent body scroll so the background doesn't move.
    document.body.appendChild(overlay);
    // prevent background/page scroll while overlay is open
    const prevBodyOverflow = document.body.style.overflow || "";
    document.body.style.overflow = "hidden";

    // ensure internal scroll starts at top (in case layout shifting occurs)
    contentWrap.scrollTop = 0;

    // After we append, wait for any images to load (but don't wait more than 600ms)
    if (imagesToWait.length) {
      let loaded = 0;
      const onImgLoad = () => {
        loaded++;
        // when all or at least 1 image finished we make sure description is visible
        if (loaded === imagesToWait.length) {
          contentWrap.scrollTop = 0;
          // scroll the desc into view to be extra-sure
          descBox.scrollIntoView({ behavior: "auto", block: "start" });
        }
      };
      imagesToWait.forEach(img => {
        if (img.complete) {
          onImgLoad();
        } else {
          img.addEventListener("load", onImgLoad);
          img.addEventListener("error", onImgLoad); // proceed even on error
        }
      });
      // safety timeout so a stalled image won't block layout adjustment
      setTimeout(() => {
        contentWrap.scrollTop = 0;
        descBox.scrollIntoView({ behavior: "auto", block: "start" });
      }, 600);
    } else {
      // no images — ensure description visible
      contentWrap.scrollTop = 0;
      descBox.scrollIntoView({ behavior: "auto", block: "start" });
    }

    // close behavior: restore body overflow and clean listeners
    closeBtn.addEventListener("click", () => {
      overlay.remove();
      document.body.style.overflow = prevBodyOverflow;
      if (window.__forumCommentListeners && window.__forumCommentListeners[postKey]) {
        try { window.__forumCommentListeners[postKey].ref.off("value", window.__forumCommentListeners[postKey].fn); } catch(e) {}
        delete window.__forumCommentListeners[postKey];
      }
    });

    // ----- comments rendering & listeners (keeps your existing logic) -----
    function firebasePathForReply(commentKey, replyKeyChain) {
      let path = `/feedback/${postKey}/comments/${commentKey}`;
      if (Array.isArray(replyKeyChain) && replyKeyChain.length) {
        replyKeyChain.forEach(k => { path += `/replies/${k}`; });
      }
      return path;
    }
    function commentPath(commentKey) { return `c:${commentKey}`; }
    function replyPath(commentKey, replyKeyChain) { return `r:${commentKey}:${(replyKeyChain || []).join("/")}`; }

    // generic like/dislike helpers (reuse your earlier functions if available)
    async function toggleLikeAtNode(nodePath, localId) {
      try {
        const likeRefPath = `${nodePath}/likes/${localId}`;
        const dislikeRefPath = `${nodePath}/dislikes/${localId}`;
        const likeSnap = await firebase.database().ref(likeRefPath).once("value");
        const updates = {};
        if (likeSnap.exists()) {
          updates[likeRefPath] = null;
        } else {
          updates[likeRefPath] = true;
          updates[dislikeRefPath] = null;
        }
        await firebase.database().ref().update(updates);
      } catch (err) {
        console.error("toggleLikeAtNode error:", err);
        Swal.fire({ title: "Error", text: "Could not update like.", icon: "error", customClass: { popup: "swal-popup-high", container: "swal-container-high" } });
      }
    }
    async function toggleDislikeAtNode(nodePath, localId) {
      try {
        const likeRefPath = `${nodePath}/likes/${localId}`;
        const dislikeRefPath = `${nodePath}/dislikes/${localId}`;
        const dislikeSnap = await firebase.database().ref(dislikeRefPath).once("value");
        const updates = {};
        if (dislikeSnap.exists()) {
          updates[dislikeRefPath] = null;
        } else {
          updates[dislikeRefPath] = true;
          updates[likeRefPath] = null;
        }
        await firebase.database().ref().update(updates);
      } catch (err) {
        console.error("toggleDislikeAtNode error:", err);
        Swal.fire({ title: "Error", text: "Could not update dislike.", icon: "error", customClass: { popup: "swal-popup-high", container: "swal-container-high" } });
      }
    }

    // renderReplies & commentsListener implementation (kept the same and re-used your existing code)
    function renderReplies(repliesObj, commentKey, parentChain, container, depth) {
      if (!repliesObj) return;
      const keys = Object.keys(repliesObj);
      keys.sort((a,b) => (repliesObj[a].createdAt||0) - (repliesObj[b].createdAt||0));
      keys.forEach(rk => {
        const r = Object.assign({}, repliesObj[rk]);
        r.__key = rk;
        r.likes = r.likes || {};
        r.dislikes = r.dislikes || {};
        r.replies = r.replies || {};

        const rCard = document.createElement("div");
        Object.assign(rCard.style, {
          padding: "8px",
          borderRadius: "6px",
          background: "rgba(255,255,255,0.01)",
          border: "1px solid rgba(255,255,255,0.02)",
          position: "relative"
        });

        const wrapper = document.createElement("div");
        wrapper.style.display = "flex";
        wrapper.style.flexDirection = "column";
        wrapper.style.marginLeft = depth === 0 ? "6px" : "14px";
        wrapper.style.paddingLeft = "10px";
        wrapper.style.borderLeft = depth === 0 ? "none" : "2px solid rgba(255,255,255,0.03)";

        const rHead = document.createElement("div");
        Object.assign(rHead.style, { display: "flex", justifyContent: "space-between", alignItems: "center" });

        const rWho = document.createElement("div");
        rWho.textContent = r.author || "Anonymous";
        Object.assign(rWho.style, { fontWeight: "700", fontSize: "13px" });

        const rMeta = document.createElement("div");
        Object.assign(rMeta.style, { fontSize: "11px", opacity: "0.85", display: "flex", gap: "8px", alignItems: "center" });
        const rd = new Date(r.createdAt || Date.now());
        const rDate = document.createElement("span");
        rDate.textContent = rd.toLocaleString();
        rMeta.appendChild(rDate);

        rHead.appendChild(rWho);
        rHead.appendChild(rMeta);

          const rText = document.createElement("div");
          Object.assign(rText.style, { marginTop: "6px" });
          
          // render reply text as paragraphs
          const rParas = splitIntoParagraphs(r.text || "", 240);
          if (!rParas.length) {
            const p = document.createElement("p");
            p.textContent = "";
            Object.assign(p.style, { margin: "6px 0", lineHeight: "1.3" });
            rText.appendChild(p);
          } else {
            rParas.forEach(pt => {
              const p = document.createElement("p");
              p.textContent = pt;
              Object.assign(p.style, { margin: "6px 0", lineHeight: "1.35", fontSize: "13px", opacity: ".95" });
              rText.appendChild(p);
            });
          }

        const rActions = document.createElement("div");
        Object.assign(rActions.style, { display: "flex", gap: "8px", alignItems: "center", marginTop: "8px" });

        const rLikesCount = countObjKeys(r.likes);
        const rDislikesCount = countObjKeys(r.dislikes);
        const childrenCount = countObjKeys(r.replies);

        const rLikeBtn = document.createElement("button");
        rLikeBtn.textContent = `👍 ${rLikesCount}`;
        Object.assign(rLikeBtn.style, { border: "none", background: "transparent", cursor: "pointer", fontWeight: "700", color: (r.likes && r.likes[localId]) ? "#7af" : "#fff" });

        const rDislikeBtn = document.createElement("button");
        rDislikeBtn.textContent = `👎 ${rDislikesCount}`;
        Object.assign(rDislikeBtn.style, { border: "none", background: "transparent", cursor: "pointer", fontWeight: "700", color: (r.dislikes && r.dislikes[localId]) ? "#f77" : "#fff" });

        const toggleRepliesBtn = document.createElement("button");
        toggleRepliesBtn.textContent = `Show replies (${childrenCount})`;
        Object.assign(toggleRepliesBtn.style, { border: "none", background: "transparent", cursor: "pointer", fontWeight: "700", color: "#fff" });

        const replyBtn = document.createElement("button");
        replyBtn.textContent = "Reply";
        Object.assign(replyBtn.style, { border: "none", background: "transparent", cursor: "pointer", fontWeight: "700", color: "#fff" });

        rActions.appendChild(rLikeBtn);
        rActions.appendChild(rDislikeBtn);
        rActions.appendChild(replyBtn);
        if (childrenCount > 0) rActions.appendChild(toggleRepliesBtn);

        // delete if owner
        if (r.authorId && r.authorId === localId) {
          const rDel = document.createElement("button");
          rDel.textContent = "Delete";
          Object.assign(rDel.style, { marginLeft: "8px", padding: "6px 8px", borderRadius: "6px", border: "none", cursor: "pointer", background: "transparent", color: "#ff8080" });
          rDel.addEventListener("click", () => {
            Swal.fire({
              title: "Delete reply?",
              text: "This will be removed permanently.",
              icon: "warning",
              showCancelButton: true,
              confirmButtonText: "Delete",
              customClass: { popup: "swal-popup-high", container: "swal-container-high" }
            }).then(res => {
              if (res.isConfirmed) {
                const nodePath = firebasePathForReply(commentKey, parentChain.concat([rk]));
                const dbRef = firebase.database().ref(nodePath);
                dbRef.remove().catch(err => {
                  console.error("Failed to remove reply:", err);
                  Swal.fire({ title: "Error", text: "Could not delete reply.", icon: "error", customClass: { popup: "swal-popup-high", container: "swal-container-high" } });
                });
              }
            });
          });
          rActions.appendChild(rDel);
        }

        const nestedComposerWrap = document.createElement("div");
        nestedComposerWrap.style.marginTop = "8px";

        const nestedWrap = document.createElement("div");
        nestedWrap.style.display = "none";
        nestedWrap.style.flexDirection = "column";
        nestedWrap.style.gap = "8px";
        nestedWrap.style.marginTop = "8px";
        nestedWrap.style.paddingLeft = "10px";
        nestedWrap.style.borderLeft = "2px solid rgba(255,255,255,0.03)";

        const thisReplyPath = replyPath(commentKey, parentChain.concat([rk]));
        toggleRepliesBtn.dataset.path = thisReplyPath;
        replyBtn.dataset.path = thisReplyPath;

        if (state.expanded[thisReplyPath]) {
          nestedWrap.style.display = "flex";
          toggleRepliesBtn.textContent = `Hide replies (${childrenCount})`;
        } else {
          nestedWrap.style.display = "none";
          toggleRepliesBtn.textContent = `Show replies (${childrenCount})`;
        }

        rLikeBtn.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          const nodePath = firebasePathForReply(commentKey, parentChain.concat([rk]));
          await toggleLikeAtNode(nodePath, localId);
        });

        rDislikeBtn.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          const nodePath = firebasePathForReply(commentKey, parentChain.concat([rk]));
          await toggleDislikeAtNode(nodePath, localId);
        });

        toggleRepliesBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          if (nestedWrap.style.display === "none") {
            nestedWrap.style.display = "flex";
            toggleRepliesBtn.textContent = `Hide replies (${childrenCount})`;
            state.expanded[thisReplyPath] = true;
          } else {
            nestedWrap.style.display = "none";
            toggleRepliesBtn.textContent = `Show replies (${childrenCount})`;
            state.expanded[thisReplyPath] = false;
          }
        });

        replyBtn.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          if (nestedComposerWrap.querySelector("textarea")) {
            nestedComposerWrap.innerHTML = "";
            delete state.composer[thisReplyPath];
            return;
          }

          nestedComposerWrap.innerHTML = "";
          const rta = document.createElement("textarea");
          rta.placeholder = "Write a reply... (max 300 chars)";
          rta.maxLength = 300;
          Object.assign(rta.style, { width: "100%", minHeight: "56px", resize: "vertical", padding: "8px", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.45)", color: "#fff" });

          if (state.composer[thisReplyPath]) rta.value = state.composer[thisReplyPath];
          rta.addEventListener("input", () => { state.composer[thisReplyPath] = rta.value; });

          const rbtnRow = document.createElement("div");
          Object.assign(rbtnRow.style, { display: "flex", gap: "8px", marginTop: "6px" });

          const rSubmit = document.createElement("button");
          rSubmit.textContent = "Reply";
          Object.assign(rSubmit.style, { padding: "8px 10px", borderRadius: "6px", border: "none", cursor: "pointer", fontWeight: "700", background: "linear-gradient(90deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))", color: "#fff" });

          const rCancel = document.createElement("button");
          rCancel.textContent = "Cancel";
          Object.assign(rCancel.style, { padding: "8px 10px", borderRadius: "6px", border: "none", cursor: "pointer", background: "transparent", color: "#fff" });

          rCancel.addEventListener("click", () => {
            nestedComposerWrap.innerHTML = "";
            delete state.composer[thisReplyPath];
          });

          rbtnRow.appendChild(rSubmit);
          rbtnRow.appendChild(rCancel);

          nestedComposerWrap.appendChild(rta);
          nestedComposerWrap.appendChild(rbtnRow);

          rSubmit.addEventListener("click", async () => {
            const txt = rta.value.trim();
            if (!txt) { Swal.fire({ title: "Empty", text: "Write something before replying.", icon: "info", customClass: { popup: "swal-popup-high", container: "swal-container-high" } }); return; }
            if (txt.length > 300) { Swal.fire({ title: "Too long", text: "Reply must be 300 characters or fewer.", icon: "error", customClass: { popup: "swal-popup-high", container: "swal-container-high" } }); return; }

             let sanitized = txt;
  try {
    if (typeof filterOrMaskMessage === "function") {
      const res = filterOrMaskMessage(txt);
      if (!res.allowed) {
        console.warn("Reply blocked by autofilter:", res.reason);
        return;
      }
      sanitized = res.text;
    } else if (typeof diagnoseMessage === "function") {
      const diag = diagnoseMessage(txt);
      if (diag && diag.blocked) {
        if (diag.reason === "unsupported-characters") {
          console.warn("Reply blocked by autofilter:", diag.reason);
          return;
        }
        if (typeof sanitizeMessage === "function") {
          sanitized = sanitizeMessage(txt);
        } else {
          console.warn("Reply blocked by autofilter (no sanitizer available).");
          return;
        }
      }
    }
  } catch (err) {
    console.error("Autofilter error (sending original reply):", err);
    sanitized = txt;
  }

            let name = localStorage.getItem("username") || window.currentPlayerName || null;
            if (!name) {
              name = await getOrAskUsername();
              if (!name) { Swal.fire({ title: "No username", text: "You must set a username to reply.", icon: "info", customClass: { popup: "swal-popup-high", container: "swal-container-high" } }); return; }
            }

            const lastKey = `lastPostAt_${localId}_${postKey}`;
            const last = parseInt(localStorage.getItem(lastKey) || "0", 10);
            const tenSec = 10 * 1000;
            if (last && (Date.now() - last) < tenSec) {
              const remain = Math.ceil((tenSec - (Date.now() - last)) / 1000);
              Swal.fire({ title: "Hold on", text: `Please wait ${remain} second(s) before posting another reply.`, icon: "info", customClass: { popup: "swal-popup-high", container: "swal-container-high" } });
              return;
            }
            rSubmit.disabled = true;
            rSubmit.style.opacity = "0.6";
            localStorage.setItem(lastKey, String(Date.now()));

            const parentPath = firebasePathForReply(commentKey, parentChain.concat([rk]));
            try {
              await firebase.database().ref(parentPath).child("replies").push({ text: txt, author: name, authorId: getLocalAuthorId(), createdAt: Date.now() });
              nestedComposerWrap.innerHTML = "";
              delete state.composer[thisReplyPath];
              nestedWrap.style.display = "flex";
              state.expanded[thisReplyPath] = true;
              if (toggleRepliesBtn) toggleRepliesBtn.textContent = `Hide replies (${countObjKeys(r.replies) + 1})`;
            } catch (err) {
              console.error("Failed to push nested reply:", err);
              Swal.fire({ title: "Error", text: "Could not save reply.", icon: "error", customClass: { popup: "swal-popup-high", container: "swal-container-high" } });
              rSubmit.disabled = false;
              rSubmit.style.opacity = "1";
            }
          });
        });

        rCard.appendChild(rHead);
        rCard.appendChild(rText);
        rCard.appendChild(rActions);
        rCard.appendChild(nestedComposerWrap);
        if (depth > 0) {
          const connector = document.createElement("div");
          Object.assign(connector.style, {
            position: "absolute",
            left: "-12px",
            top: "8px",
            bottom: "8px",
            width: "2px",
            background: "rgba(255,255,255,0.04)",
            borderRadius: "2px"
          });
          rCard.appendChild(connector);
        }
        wrapper.appendChild(rCard);
        wrapper.appendChild(nestedWrap);
        container.appendChild(wrapper);

        if (r.replies && Object.keys(r.replies).length) {
          renderReplies(r.replies, commentKey, parentChain.concat([rk]), nestedWrap, depth + 1);
        }
      });
    }

    const commentsRef = window.feedbackRef.child(postKey).child("comments");
    const commentsListener = (csnap) => {
      commentsContainer.innerHTML = "";
      if (!csnap.exists()) {
        const empty = document.createElement("div");
        empty.textContent = "No comments yet — be the first to comment.";
        empty.style.opacity = "0.8";
        commentsContainer.appendChild(empty);
        return;
      }
      const data = csnap.val();
      const items = Object.keys(data).map(k => {
        const c = Object.assign({}, data[k]);
        c.__key = k;
        c.likes = c.likes || {};
        c.dislikes = c.dislikes || {};
        c.replies = c.replies || {};
        return c;
      });
      items.sort((a,b) => (a.createdAt||0) - (b.createdAt||0));

      const localIdForDel = getLocalAuthorId();
      items.forEach(c => {
        const card = document.createElement("div");
        Object.assign(card.style, { padding: "10px", borderRadius: "8px", background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.03)" });

        const head = document.createElement("div");
        Object.assign(head.style, { display: "flex", justifyContent: "space-between", alignItems: "center" });

        const who = document.createElement("div");
        who.textContent = `${c.author || "Anonymous"}`;
        Object.assign(who.style, { fontWeight: "800", fontSize: "14px" });

        const meta = document.createElement("div");
        Object.assign(meta.style, { fontSize: "12px", opacity: "0.8", display: "flex", gap: "8px", alignItems: "center" });
        const d = new Date(c.createdAt || Date.now());
        const dateSpan = document.createElement("span");
        dateSpan.textContent = d.toLocaleString();
        meta.appendChild(dateSpan);

        head.appendChild(who);
        head.appendChild(meta);

          const text = document.createElement("div");
          Object.assign(text.style, { marginTop: "8px" });
          
          // Split into paragraphs (re-uses your splitIntoParagraphs function)
          const paras = splitIntoParagraphs(c.text || "", 240);
          
          if (!paras.length) {
            const p = document.createElement("p");
            p.textContent = "";
            Object.assign(p.style, { margin: "6px 0", lineHeight: "1.35", fontSize: "13px", opacity: ".95" });
            text.appendChild(p);
          } else {
            paras.forEach(pt => {
              const pEl = document.createElement("p");
              pEl.textContent = pt; // safe - auto-escapes
             Object.assign(pEl.style, {
  margin: "8px 0",
  lineHeight: "1.45",
  fontSize: "14px",
  opacity: ".95",
  /* ensure long unbroken tokens can wrap */
  overflowWrap: "anywhere",
  wordBreak: "break-word",
  whiteSpace: "pre-wrap"
});
              text.appendChild(pEl);
            });
          }

        const actions = document.createElement("div");
        Object.assign(actions.style, { display: "flex", gap: "8px", alignItems: "center", marginTop: "8px" });

        const likesCount = countObjKeys(c.likes);
        const dislikesCount = countObjKeys(c.dislikes);
        const repliesCount = countObjKeys(c.replies);

        const likeBtn = document.createElement("button");
        likeBtn.textContent = `👍 ${likesCount}`;
        Object.assign(likeBtn.style, { border: "none", background: "transparent", cursor: "pointer", fontWeight: "700", color: (c.likes && c.likes[localIdForDel]) ? "#7af" : "#fff" });

        const dislikeBtn = document.createElement("button");
        dislikeBtn.textContent = `👎 ${dislikesCount}`;
        Object.assign(dislikeBtn.style, { border: "none", background: "transparent", cursor: "pointer", fontWeight: "700", color: (c.dislikes && c.dislikes[localIdForDel]) ? "#f77" : "#fff" });

        const replyBtn = document.createElement("button");
        replyBtn.textContent = `Reply (${repliesCount})`;
        Object.assign(replyBtn.style, { border: "none", background: "transparent", cursor: "pointer", fontWeight: "700", color: "#fff" });

        const toggleRepliesBtn = document.createElement("button");
        toggleRepliesBtn.textContent = `Show replies (${repliesCount})`;
        Object.assign(toggleRepliesBtn.style, { border: "none", background: "transparent", cursor: "pointer", fontWeight: "700", color: "#fff" });

        actions.appendChild(likeBtn);
        actions.appendChild(dislikeBtn);
        actions.appendChild(replyBtn);
        if (repliesCount > 0) actions.appendChild(toggleRepliesBtn);

        // delete if owner
        if (c.authorId && c.authorId === localIdForDel) {
          const delBtn = document.createElement("button");
          delBtn.textContent = "Delete";
          Object.assign(delBtn.style, { marginLeft: "8px", padding: "6px 8px", borderRadius: "6px", border: "none", cursor: "pointer", background: "transparent", color: "#ff8080" });
          delBtn.addEventListener("click", () => {
            Swal.fire({
              title: "Delete comment?",
              text: "This will be removed permanently.",
              icon: "warning",
              showCancelButton: true,
              confirmButtonText: "Delete",
              customClass: { popup: "swal-popup-high", container: "swal-container-high" }
            }).then(res => {
              if (res.isConfirmed) commentsRef.child(c.__key).remove().catch(err => {
                console.error("Failed to remove comment:", err);
                Swal.fire({ title: "Error", text: "Could not delete comment.", icon: "error", customClass: { popup: "swal-popup-high", container: "swal-container-high" } });
              });
            });
          });
          actions.appendChild(delBtn);
        }

        card.appendChild(head);
        card.appendChild(text);
        card.appendChild(actions);

        // composer placeholder and nested replies container
        const commentComposerWrap = document.createElement("div");
        commentComposerWrap.style.marginTop = "8px";

        const commentNestedWrap = document.createElement("div");
        commentNestedWrap.style.display = "none";
        commentNestedWrap.style.flexDirection = "column";
        commentNestedWrap.style.gap = "8px";
        commentNestedWrap.style.marginTop = "8px";
        commentNestedWrap.style.paddingLeft = "12px";
        commentNestedWrap.style.borderLeft = "2px solid rgba(255,255,255,0.03)";

        const thisCommentPath = commentPath(c.__key);
        toggleRepliesBtn.dataset.path = thisCommentPath;
        replyBtn.dataset.path = thisCommentPath;

        if (state.expanded[thisCommentPath]) {
          commentNestedWrap.style.display = "flex";
          toggleRepliesBtn.textContent = `Hide replies (${repliesCount})`;
        } else {
          commentNestedWrap.style.display = "none";
          toggleRepliesBtn.textContent = `Show replies (${repliesCount})`;
        }

        likeBtn.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          const nodePath = `/feedback/${postKey}/comments/${c.__key}`;
          await toggleLikeAtNode(nodePath, localIdForDel);
        });

        dislikeBtn.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          const nodePath = `/feedback/${postKey}/comments/${c.__key}`;
          await toggleDislikeAtNode(nodePath, localIdForDel);
        });

        toggleRepliesBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          if (commentNestedWrap.style.display === "none") {
            commentNestedWrap.style.display = "flex";
            toggleRepliesBtn.textContent = `Hide replies (${repliesCount})`;
            state.expanded[thisCommentPath] = true;
          } else {
            commentNestedWrap.style.display = "none";
            toggleRepliesBtn.textContent = `Show replies (${repliesCount})`;
            state.expanded[thisCommentPath] = false;
          }
        });

        replyBtn.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          if (commentComposerWrap.querySelector("textarea")) {
            commentComposerWrap.innerHTML = "";
            delete state.composer[thisCommentPath];
            return;
          }

          commentComposerWrap.innerHTML = "";
          const rta = document.createElement("textarea");
          rta.placeholder = "Write a reply... (max 300 chars)";
          rta.maxLength = 300;
          Object.assign(rta.style, { width: "100%", minHeight: "56px", resize: "vertical", padding: "8px", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.45)", color: "#fff" });

          if (state.composer[thisCommentPath]) rta.value = state.composer[thisCommentPath];
          rta.addEventListener("input", () => { state.composer[thisCommentPath] = rta.value; });

          const rbtnRow = document.createElement("div");
          Object.assign(rbtnRow.style, { display: "flex", gap: "8px", marginTop: "6px" });

          const rSubmit = document.createElement("button");
          rSubmit.textContent = "Reply";
          Object.assign(rSubmit.style, { padding: "8px 10px", borderRadius: "6px", border: "none", cursor: "pointer", fontWeight: "700", background: "linear-gradient(90deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))", color: "#fff" });

          const rCancel = document.createElement("button");
          rCancel.textContent = "Cancel";
          Object.assign(rCancel.style, { padding: "8px 10px", borderRadius: "6px", border: "none", cursor: "pointer", background: "transparent", color: "#fff" });

          rCancel.addEventListener("click", () => { commentComposerWrap.innerHTML = ""; delete state.composer[thisCommentPath]; });

          rbtnRow.appendChild(rSubmit);
          rbtnRow.appendChild(rCancel);

          commentComposerWrap.appendChild(rta);
          commentComposerWrap.appendChild(rbtnRow);

          rSubmit.addEventListener("click", async () => {
            const txt = rta.value.trim();
            if (!txt) { Swal.fire({ title: "Empty", text: "Write something before replying.", icon: "info", customClass: { popup: "swal-popup-high", container: "swal-container-high" } }); return; }
            if (txt.length > 300) { Swal.fire({ title: "Too long", text: "Reply must be 300 characters or fewer.", icon: "error", customClass: { popup: "swal-popup-high", container: "swal-container-high" } }); return; }

            let sanitized = txt;
  try {
    if (typeof filterOrMaskMessage === "function") {
      const res = filterOrMaskMessage(txt);
      if (!res.allowed) {
        console.warn("Reply blocked by autofilter:", res.reason);
        return;
      }
      sanitized = res.text;
    } else if (typeof diagnoseMessage === "function") {
      const diag = diagnoseMessage(txt);
      if (diag && diag.blocked) {
        if (diag.reason === "unsupported-characters") {
          console.warn("Reply blocked by autofilter:", diag.reason);
          return;
        }
        if (typeof sanitizeMessage === "function") {
          sanitized = sanitizeMessage(txt);
        } else {
          console.warn("Reply blocked by autofilter (no sanitizer available).");
          return;
        }
      }
    }
  } catch (err) {
    console.error("Autofilter error (sending original reply):", err);
    sanitized = txt;
  }

            let name = localStorage.getItem("username") || window.currentPlayerName || null;
            if (!name) {
              name = await getOrAskUsername();
              if (!name) { Swal.fire({ title: "No username", text: "You must set a username to reply.", icon: "info", customClass: { popup: "swal-popup-high", container: "swal-container-high" } }); return; }
            }

            const lastKey = `lastPostAt_${localIdForDel}_${postKey}`;
            const last = parseInt(localStorage.getItem(lastKey) || "0", 10);
            const tenSec = 10 * 1000;
            if (last && (Date.now() - last) < tenSec) {
              const remain = Math.ceil((tenSec - (Date.now() - last)) / 1000);
              Swal.fire({ title: "Hold on", text: `Please wait ${remain} second(s) before posting another reply.`, icon: "info", customClass: { popup: "swal-popup-high", container: "swal-container-high" } });
              return;
            }
            rSubmit.disabled = true;
            rSubmit.style.opacity = "0.6";
            localStorage.setItem(lastKey, String(Date.now()));

            try {
              await commentsRef.child(c.__key).child("replies").push({ text: txt, author: name, authorId: getLocalAuthorId(), createdAt: Date.now() });
              commentComposerWrap.innerHTML = "";
              delete state.composer[thisCommentPath];
              commentNestedWrap.style.display = "flex";
              state.expanded[thisCommentPath] = true;
              if (toggleRepliesBtn) toggleRepliesBtn.textContent = `Hide replies (${repliesCount + 1})`;
            } catch (err) {
              console.error("Failed to push reply:", err);
              Swal.fire({ title: "Error", text: "Could not save reply.", icon: "error", customClass: { popup: "swal-popup-high", container: "swal-container-high" } });
              rSubmit.disabled = false;
              rSubmit.style.opacity = "1";
            }
          });
        });

        card.appendChild(commentComposerWrap);
        card.appendChild(commentNestedWrap);
        commentsContainer.appendChild(card);

        if (c.replies && Object.keys(c.replies).length) {
          renderReplies(c.replies, c.__key, [], commentNestedWrap, 0);
        }
      });
    };

    // attach listener and remember so we can remove on close
    commentsRef.on("value", commentsListener);
    window.__forumCommentListeners = window.__forumCommentListeners || {};
    window.__forumCommentListeners[postKey] = { ref: commentsRef, fn: commentsListener };

    // comment posting with 10s throttle per local user + per post
    submitBtn.addEventListener("click", async () => {
      const txt = commentInput.value.trim();
      if (!txt) { Swal.fire({ title: "Empty", text: "Write something before posting.", icon: "info", customClass: { popup: "swal-popup-high", container: "swal-container-high" } }); return; }
      if (txt.length > 500) { Swal.fire({ title: "Too long", text: "Comment must be 500 characters or fewer.", icon: "error", customClass: { popup: "swal-popup-high", container: "swal-container-high" } }); return; }

       let sanitized = txt;
  try {
    if (typeof filterOrMaskMessage === "function") {
      const res = filterOrMaskMessage(txt);
      if (!res.allowed) {
        console.warn("Reply blocked by autofilter:", res.reason);
        return;
      }
      sanitized = res.text;
    } else if (typeof diagnoseMessage === "function") {
      const diag = diagnoseMessage(txt);
      if (diag && diag.blocked) {
        if (diag.reason === "unsupported-characters") {
          console.warn("Reply blocked by autofilter:", diag.reason);
          return;
        }
        if (typeof sanitizeMessage === "function") {
          sanitized = sanitizeMessage(txt);
        } else {
          console.warn("Reply blocked by autofilter (no sanitizer available).");
          return;
        }
      }
    }
  } catch (err) {
    console.error("Autofilter error (sending original reply):", err);
    sanitized = txt;
  }

      let name = localStorage.getItem("username") || window.currentPlayerName || null;
      if (!name) {
        name = await getOrAskUsername();
        if (!name) { Swal.fire({ title: "No username", text: "You must set a username to create a forum.", icon: "info", customClass: { popup: "swal-popup-high", container: "swal-container-high" } }); return; }
      }

      const lastKey = `lastPostAt_${localId}_${postKey}`;
      const last = parseInt(localStorage.getItem(lastKey) || "0", 10);
      const tenSec = 10 * 1000;
      if (last && (Date.now() - last) < tenSec) {
        const remain = Math.ceil((tenSec - (Date.now() - last)) / 1000);
        Swal.fire({ title: "Hold on", text: `Please wait ${remain} second(s) before posting another comment.`, icon: "info", customClass: { popup: "swal-popup-high", container: "swal-container-high" } });
        return;
      }

      submitBtn.disabled = true;
      submitBtn.style.opacity = "0.6";
      localStorage.setItem(lastKey, String(Date.now()));

      const payload = { text: txt, author: name, authorId: getLocalAuthorId(), createdAt: Date.now() };
      try {
        await commentsRef.push(payload);
        commentInput.value = "";
        setTimeout(() => {
          submitBtn.disabled = false;
          submitBtn.style.opacity = "1";
        }, tenSec);
      } catch (err) {
        console.error("Failed to push comment:", err);
        Swal.fire({ title: "Error", text: "Could not save comment.", icon: "error", customClass: { popup: "swal-popup-high", container: "swal-container-high" } });
        submitBtn.disabled = false;
        submitBtn.style.opacity = "1";
      }
    });

  } catch (err) {
    console.error("Failed to read forum post:", err);
    Swal.fire({ title: "Error", text: "Could not load forum post.", icon: "error", customClass: { popup: "swal-popup-high", container: "swal-container-high" } });
  }
}

async function createForumDialog() {
  const res = await Swal.fire({
    title: "Create Forum",
    html:
      `<input id="swal-forum-title" class="swal2-input" placeholder="Title (max 50 chars)" maxlength="50">` +
      `<textarea id="swal-forum-desc" class="swal2-textarea" placeholder="Description (max 500 chars)" maxlength="500" style="height:120px"></textarea>` +
      `<div style="margin-top:8px;font-size:12px;opacity:.85">Attach up to 5 images (JPG/PNG, ≤2MB each):</div>` +
      `<input id="swal-forum-images" type="file" accept="image/*" multiple style="margin-top:6px">`,
    focusConfirm: false,
    showCancelButton: true,
    confirmButtonText: "Create",
    customClass: { popup: "swal-popup-high", container: "swal-container-high" },
    preConfirm: () => {
      const title = document.getElementById("swal-forum-title")?.value?.trim() || "";
      const description = document.getElementById("swal-forum-desc")?.value?.trim() || "";
      const fileInput = document.getElementById("swal-forum-images");
      if (!title) { Swal.showValidationMessage("Title is required (max 50 chars)."); return false; }
      if (title.length > 50) { Swal.showValidationMessage("Title must be 50 characters or fewer."); return false; }
      if (!description) { Swal.showValidationMessage("Description is required (max 500 chars)."); return false; }
      if (description.length > 500) { Swal.showValidationMessage("Description must be 500 characters or fewer."); return false; }

      const files = fileInput?.files ? Array.from(fileInput.files) : [];
      if (files.length > 5) { Swal.showValidationMessage("You may attach up to 5 images."); return false; }

      for (const f of files) {
        if (!f.type || !f.type.startsWith("image/")) {
          Swal.showValidationMessage("Only image files are allowed.");
          return false;
        }
        const maxBytes = 2 * 1024 * 1024; // 2 MB
        if (f.size > maxBytes) {
          Swal.showValidationMessage("Each image must be 2MB or smaller.");
          return false;
        }
      }

      const readAsDataURL = (file) => new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = (e) => reject(e);
        fr.readAsDataURL(file);
      });

      return Promise.all(files.map(f => readAsDataURL(f)))
        .then(images => ({ title, description, images }))
        .catch(() => {
          Swal.showValidationMessage("Failed to read image files.");
          return false;
        });
    }
  });

  if (res && res.value) {
    await createForum(res.value.title, res.value.description, res.value.images || []);
  }
}

// ---------- Creation (with 1-day cooldown) ----------
async function createForum(title, description, images = []) {
  let name = localStorage.getItem("username") || window.currentPlayerName || null;
  if (!name) {
    name = await getOrAskUsername();
    if (!name) {
      Swal.fire({ title: "No username", text: "You must set a username to create a forum.", icon: "info", customClass: { popup: "swal-popup-high", container: "swal-container-high" } });
      return;
    }
  }

  const localId = getLocalAuthorId();
  const lastKey = `lastPostAt_${localId}`;
  const last = parseInt(localStorage.getItem(lastKey) || "0", 10);
  const dayMs = 5 * 60 * 60 * 1000; // (keeps your original value)
  if (last && (Date.now() - last) < dayMs) {
    const remaining = Math.ceil((dayMs - (Date.now() - last)) / (60*60*1000));
    Swal.fire({ title: "Wait", text: `You must wait ${remaining} hour(s) before creating another forum.`, icon: "info", customClass: { popup: "swal-popup-high", container: "swal-container-high" } });
    return;
  }

  let sanitizedTitle = title;
  try {
    if (typeof filterOrMaskMessage === "function") {
      const res = filterOrMaskMessage(title);
      if (!res.allowed) {
        console.warn("Post blocked by autofilter: title -", res.reason);
        return;
      }
      sanitizedTitle = res.text;
    } else if (typeof diagnoseMessage === "function") {
      const diag = diagnoseMessage(title);
      if (diag && diag.blocked) {
        if (diag.reason === "unsupported-characters") {
          console.warn("Post blocked by autofilter: title -", diag.reason);
          return;
        }
        if (typeof sanitizeMessage === "function") {
          sanitizedTitle = sanitizeMessage(title);
        } else {
          console.warn("Post blocked by autofilter: title (no sanitizer available).");
          return;
        }
      }
    }
  } catch (err) {
    console.error("Autofilter error (title) — sending original:", err);
    sanitizedTitle = title;
  }

  // Silent filtering for description
  let sanitizedDescription = description;
  try {
    if (typeof filterOrMaskMessage === "function") {
      const res = filterOrMaskMessage(description);
      if (!res.allowed) {
        console.warn("Post blocked by autofilter: description -", res.reason);
        return;
      }
      sanitizedDescription = res.text;
    } else if (typeof diagnoseMessage === "function") {
      const diag = diagnoseMessage(description);
      if (diag && diag.blocked) {
        if (diag.reason === "unsupported-characters") {
          console.warn("Post blocked by autofilter: description -", diag.reason);
          return;
        }
        if (typeof sanitizeMessage === "function") {
          sanitizedDescription = sanitizeMessage(description);
        } else {
          console.warn("Post blocked by autofilter: description (no sanitizer available).");
          return;
        }
      }
    }
  } catch (err) {
    console.error("Autofilter error (description) — sending original:", err);
    sanitizedDescription = description;
  }

  const safeImages = Array.isArray(images) ? images.slice(0,5) : [];

  const payload = {
    title: sanitizedTitle,
    description: sanitizedDescription,
    author: name,
    authorId: localId,
    createdAt: Date.now(),
    images: safeImages
  };

  if (!window.feedbackRef) {
    Swal.fire({ title: "Not connected", text: "Feedback DB not initialized.", icon: "error", customClass: { popup: "swal-popup-high", container: "swal-container-high" } });
    return;
  }

  try {
    const newRef = window.feedbackRef.push();
    await newRef.set(payload);
    localStorage.setItem(lastKey, String(Date.now()));
    Swal.fire({ icon: "success", title: "Forum created", timer: 1100, showConfirmButton: false, customClass: { popup: "swal-popup-high", container: "swal-container-high" } });

    // --- KEEP AT MOST 50 POSTS: if there are >50, remove the oldest one ---
    try {
      // get newest 51 posts by createdAt (so we can delete the oldest if count > 50)
      const snapshot = await window.feedbackRef.orderByChild('createdAt').limitToLast(51).once('value');
      const items = [];
      snapshot.forEach(child => {
        const val = child.val();
        // protect against missing createdAt
        const createdAt = val && typeof val.createdAt === 'number' ? val.createdAt : 0;
        items.push({ key: child.key, createdAt });
      });

      if (items.length > 30) {
        // find the smallest createdAt among these (the oldest of the newest 51 -> the one to remove)
        let min = items[0];
        for (const it of items) {
          if (it.createdAt < min.createdAt) min = it;
        }
        if (min && min.key) {
          await window.feedbackRef.child(min.key).remove().catch(e => console.error("Failed to remove old forum:", e));
        }
      }
    } catch (trimErr) {
      console.error("Error trimming forums to 50:", trimErr);
    }
    // --- end trimming ---
  } catch (err) {
    console.error("Failed to create forum:", err);
    Swal.fire({ title: "Error", text: "Could not save forum.", icon: "error", customClass: { popup: "swal-popup-high", container: "swal-container-high" } });
  }
}


// ---------- Top-level feedback button + UI (list with filters/paging) ----------
function feedbackButtonHit() {
  clearMenuCanvas();
  const onlinePlayersContainer = document.getElementById("online-players-container");
  if (onlinePlayersContainer) onlinePlayersContainer.style.display = "none";
    add(logo.image);
    makeButton(logo.hitbox, logo.hitbox.onClick);
  addBackButton(menu, removeFeedbackOverlay);

  removeFeedbackOverlay();

  // overlay container
  const overlay = document.createElement("div");
  overlay.id = "feedback-overlay";
  Object.assign(overlay.style, {
    position: "fixed", left: "50%", top: "50%", transform: "translate(-50%, -50%)",
    width: "80vw", height: "80vh", zIndex: "15000",
    background: "rgba(12, 14, 18, 0.96)", border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: "10px", padding: "18px", boxSizing: "border-box",
    display: "flex", flexDirection: "column", color: "#fff", overflow: "hidden", backdropFilter: "blur(6px)"
  });

  // header / controls
  const headerRow = document.createElement("div");
  Object.assign(headerRow.style, { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" });

  const headTitle = document.createElement("div");
  headTitle.textContent = "Feedback & Forums";
  Object.assign(headTitle.style, { fontSize: "18px", fontWeight: "800" });

  const controls = document.createElement("div");
  Object.assign(controls.style, { display: "flex", alignItems: "center", gap: "8px" });

  const createBtn = document.createElement("button");
  createBtn.textContent = "Create Forum";
  Object.assign(createBtn.style, { padding: "8px 12px", borderRadius: "8px", border: "none", cursor: "pointer", fontWeight: "700", background: "linear-gradient(90deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))", color: "#fff" });

  // NOTE: removed the closeBtn (the '✕') per request

  controls.appendChild(createBtn);
  headerRow.appendChild(headTitle);
  headerRow.appendChild(controls);

  // filter bar with title filter only
  const filterRow = document.createElement("div");
  Object.assign(filterRow.style, { display: "flex", gap: "8px", alignItems: "center", marginBottom: "8px" });

  const sortSelect = document.createElement("select");
  const sortOptions = [
    { value: "newest", label: "Last created" },
    { value: "mostLiked", label: "Most liked" },
    { value: "mostDisliked", label: "Most disliked" },
    { value: "mostViewed", label: "Most viewed" },
    { value: "name", label: "By title" } // repurposed to sort by title
  ];
  sortOptions.forEach(opt => {
    const o = document.createElement("option");
    o.value = opt.value;
    o.textContent = opt.label;
    sortSelect.appendChild(o);
  });
  sortSelect.value = __currentSort;

  const titleFilterInput = document.createElement("input");
  titleFilterInput.placeholder = "Filter by title";
  Object.assign(titleFilterInput.style, { padding: "8px", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.45)", color: "#fff" });
  titleFilterInput.value = __titleFilter;

  filterRow.appendChild(sortSelect);
  filterRow.appendChild(titleFilterInput);

  // content area (creation box + list)
  const content = document.createElement("div");
  Object.assign(content.style, { flex: "1", overflow: "auto", display: "flex", flexDirection: "column", gap: "12px" });

  const creationBox = document.createElement("div");
  Object.assign(creationBox.style, { padding: "12px", borderRadius: "8px", border: "1px dashed rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" });
  const creationTxt = document.createElement("div");
  creationTxt.textContent = "Click 'Create Forum' to add a title (≤50 chars) and a description (≤500 chars). You can create one forum per day.";
  creationBox.appendChild(creationTxt);

  const postsList = document.createElement("div");
  postsList.id = "posts-list-container";
  Object.assign(postsList.style, { display: "flex", flexDirection: "column", paddingRight: "6px" });

  content.appendChild(creationBox);
  content.appendChild(postsList);

  const footer = document.createElement("div");
  Object.assign(footer.style, { fontSize: "12px", opacity: "0.7", marginTop: "8px" });
  footer.textContent = " ";

  overlay.appendChild(headerRow);
  overlay.appendChild(filterRow);
  overlay.appendChild(content);
  overlay.appendChild(footer);
  document.body.appendChild(overlay);

  // hooking filter controls
  sortSelect.addEventListener("change", () => {
    __currentSort = sortSelect.value;
    __currentPage = 1;
    renderPostsList();
  });
  titleFilterInput.addEventListener("input", () => {
    __titleFilter = titleFilterInput.value;
    __currentPage = 1;
    renderPostsList();
  });

  // create handler opens swal and then createForum
createBtn.addEventListener("click", async () => {
  // check cooldown in createForum itself
  const res = await Swal.fire({
    title: "Create Forum",
    html:
      `<input id="swal-forum-title" class="swal2-input" placeholder="Title (max 50 chars)" maxlength="50">` +
      `<textarea id="swal-forum-desc" class="swal2-textarea" placeholder="Description (max 500 chars)" maxlength="500" style="height:140px"></textarea>` +
      `<div style="margin-top:8px;font-size:12px;opacity:.85">Attach up to 5 images (JPG/PNG, ≤2MB each). Use the separate buttons below:</div>` +
      // five distinct file inputs (one file per input)
      `<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin-top:6px">` +
        `<label style="font-size:12px;opacity:.9">Image 1 (optional)<input id="swal-forum-img-0" type="file" accept="image/*" style="display:block; width:100%; margin-top:4px"></label>` +
        `<label style="font-size:12px;opacity:.9">Image 2 (optional)<input id="swal-forum-img-1" type="file" accept="image/*" style="display:block; width:100%; margin-top:4px"></label>` +
        `<label style="font-size:12px;opacity:.9">Image 3 (optional)<input id="swal-forum-img-2" type="file" accept="image/*" style="display:block; width:100%; margin-top:4px"></label>` +
        `<label style="font-size:12px;opacity:.9">Image 4 (optional)<input id="swal-forum-img-3" type="file" accept="image/*" style="display:block; width:100%; margin-top:4px"></label>` +
        `<label style="font-size:12px;opacity:.9; grid-column:1 / -1">Image 5 (optional)<input id="swal-forum-img-4" type="file" accept="image/*" style="display:block; width:100%; margin-top:4px"></label>` +
      `</div>`,
    focusConfirm: false,
    showCancelButton: true,
    confirmButtonText: "Create",
    customClass: { popup: "swal-popup-high", container: "swal-container-high" },
    preConfirm: () => {
      const title = document.getElementById("swal-forum-title")?.value?.trim() || "";
      const description = document.getElementById("swal-forum-desc")?.value?.trim() || "";

      if (!title) { Swal.showValidationMessage("Title is required (max 50 chars)."); return false; }
      if (title.length > 50) { Swal.showValidationMessage("Title must be 50 characters or fewer."); return false; }
      if (!description) { Swal.showValidationMessage("Description is required (max 500 chars)."); return false; }
      if (description.length > 500) { Swal.showValidationMessage("Description must be 500 characters or fewer."); return false; }

      // collect files from the five separate inputs (each should supply at most one file)
      const fileInputs = [
        document.getElementById("swal-forum-img-0"),
        document.getElementById("swal-forum-img-1"),
        document.getElementById("swal-forum-img-2"),
        document.getElementById("swal-forum-img-3"),
        document.getElementById("swal-forum-img-4")
      ];

      const files = [];
      for (const fi of fileInputs) {
        if (!fi) continue;
        if (fi.files && fi.files.length > 0) {
          // take only the first file from each input
          files.push(fi.files[0]);
        }
      }

      if (files.length > 5) { Swal.showValidationMessage("You may attach up to 5 images."); return false; }

      const maxBytes = 2 * 1024 * 1024; // 2 MB
      for (const f of files) {
        if (!f.type || !f.type.startsWith("image/")) {
          Swal.showValidationMessage("Only image files are allowed.");
          return false;
        }
        if (f.size > maxBytes) {
          Swal.showValidationMessage("Each image must be 2MB or smaller.");
          return false;
        }
      }

      if (!files.length) {
        return { title, description, images: [] };
      }

      // read files to data URLs
      const readAsDataURL = (file) => new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = (e) => reject(e);
        fr.readAsDataURL(file);
      });

      return Promise.all(files.map(f => readAsDataURL(f)))
        .then(images => ({ title, description, images }))
        .catch(() => {
          Swal.showValidationMessage("Failed to read image files.");
          return false;
        });
    }
  });

  if (res && res.value) {
    await createForum(res.value.title, res.value.description, res.value.images || []);
  }
});

  // attach feedbackRef fallback
  if (typeof feedbackRef !== "undefined" && feedbackRef) window.feedbackRef = feedbackRef;
  else { try { if (menuApp && menuApp.database) window.feedbackRef = menuApp.database().ref("feedback"); } catch(e) {} }

  // attach listener to update __postsCache and render
  attachFeedbackListener(postsList);
}

/**
 * Handles the "Create Game" button click.
 * Uses SweetAlert2 for input and pushes game data to Firebase.
 */
export async function createGameButtonHit() {
    username = localStorage.getItem("username");
    localStorage.setItem("playerVersion", CLIENT_GAME_VERSION);
    await assignPlayerVersion(username, CLIENT_GAME_VERSION);

    if (!username || !username.trim()) {
        return Swal.fire('Error', 'Please set your username first.', 'error');
    }

    if (CLIENT_GAME_VERSION !== requiredGameVersion) {
        return Swal.fire(
            'Update Required',
            `Your game version (${CLIENT_GAME_VERSION}) does not match the required version (${requiredGameVersion}). Please refresh your tab to create games.`,
            'error'
        );
    }

    // prepare a safe default (max 10 chars)
    const defaultName = (`${username}'s Game`).slice(0, 15);

    const { value: formValues } = await Swal.fire({
        title: 'Create New Game',
        html: `
            <input id="swal-input1" class="swal2-input" placeholder="Game Name" maxlength="15">
            <select id="swal-input2" class="swal2-select">
                <option value="">Select Map</option>
                <option value="DiddyDunes">DiddyDunes</option>
                <option value="SigmaCity">SigmaCity</option>
                <option value="CrocodilosConstruction">CrocodilosConstruction</option>
            </select>
            <select id="swal-input3" class="swal2-select">
                <option value="FFA">FFA</option>
            </select>
            <div id="swal-help" style="font-size:12px;color:#666;margin-top:6px;">Max 15 characters.</div>
        `,
        focusConfirm: false,
        didOpen: () => {
            // set default value safely after the modal opens
            const inp = document.getElementById('swal-input1');
            if (inp) inp.value = defaultName;
        },
     preConfirm: () => {
         const rawName = document.getElementById('swal-input1').value || '';
         const gameName = rawName.trim();
         const map = document.getElementById('swal-input2').value;
         const mode = document.getElementById('swal-input3').value;
     
         if (!gameName || !map || !mode) {
             Swal.showValidationMessage(`Please fill all fields`);
             return false;
         }
     
         if (gameName.length > 15) {
             Swal.showValidationMessage(`Game name must be 1–15 characters.`);
             return false;
         }
     
         // NEW: Profanity check for the game name
         if (!isMessageClean(gameName)) {
             Swal.showValidationMessage('That game name contains inappropriate language. Please choose a different name.');
             return false;
         }
     
         return { gameName, map, gamemode: mode };
     }
    });

    if (!formValues) return;

    let lobbyGameId = null;
    let slotResult = null;

    try {
        const ffaEnabled = true;

        // Use the trimmed name for the duplicate check
        const cleanedName = formValues.gameName.trim();

        // NEW LOGIC: Check for duplicate game names
        const snapshot = await gamesRef.orderByChild('gameName').equalTo(cleanedName).once('value');
        if (snapshot.exists()) {
            return Swal.fire('Error', 'A game with this name already exists. Please choose a different name.', 'error');
        }

        // 1. Claim a game slot
        slotResult = await claimGameSlot(username, formValues.map, ffaEnabled);

        if (!slotResult) {
            Swal.fire('Error', 'No free slots available or version mismatch. Game discarded.', 'error');
            return;
        }

        // 2. Create the lobby entry and link to the game instance
        const gameData = {
            gameName: cleanedName,
            map: formValues.map,
            gamemode: formValues.gamemode,
            host: username,
            createdAt: firebase.database.ServerValue.TIMESTAMP,
            status: "waiting",
            gameVersion: CLIENT_GAME_VERSION,
            gameInstanceId: slotResult.gameId,
            slot: slotResult.slotName
        };

        lobbyGameId = slotResult.gameId;
        await gamesRef.child(lobbyGameId).set(gameData);

        // --- NEW: write the lobbyGameId back into the slot DB so the slot instance can find the lobby ---
        try {
            if (!slotResult || !slotResult.gameId) {
                console.warn('createGameButtonHit: slotResult.gameId is missing, skipping lobbyId write.');
            } else {
                const slotApp = gameApps?.[slotResult.slotName];
                if (!slotApp) {
                    console.warn('createGameButtonHit: slotApp not initialized for', slotResult.slotName);
                } else {
                    const slotDb = slotApp.database();
                    await slotDb.ref(`game/${slotResult.gameId}/lobbyId`).set(lobbyGameId);
                    console.log('createGameButtonHit: wrote lobbyId into slot DB:', lobbyGameId);
                }
            }
        } catch (writeErr) {
            console.warn('createGameButtonHit: failed to write lobbyId into slot DB:', writeErr);
            // Not fatal — we still continue and present the lobby to the user.
        }
        // -------------------------------------------------------------------------------------------

        // 3. Update the global dbRefs with the references from the claimed slot
        window.dbRefs = slotResult.dbRefs;

        Swal.fire({
            title: 'Game Created!',
            html: `Game: <b>${cleanedName}</b><br>Map: <b>${formValues.map}</b><br>ID: <b>${lobbyGameId}</b>`,
            icon: 'success',
            confirmButtonText: 'Join Game'
        }).then(res => {
            if (res.isConfirmed) {
                initAndStartGame(username, formValues.map, slotResult.gameId);
            } else {
                // hi
            }
        });

    } catch (error) {
        console.error("Error creating game:", error);
        Swal.fire('Error', 'Could not create game: ' + (error && error.message ? error.message : error), 'error');

        if (lobbyGameId) {
            console.warn("An error occurred after creating the game entry. Removing game entry and releasing slot.");
            await gamesRef.child(lobbyGameId).remove();
            // Optionally release slot here if you have releaseGameSlot
            // if (slotResult) {
            //     await releaseGameSlot(slotResult.slotName, slotResult.gameId);
            // }
        }
    }
}




let gameSearchQuery = "";
let searchInputEl = null;

let searchDebounceTimer = null;

function createSearchInput() {
    // if it already exists, don't recreate it (preserve focus / caret)
    if (searchInputEl) return;

    searchInputEl = document.createElement("input");
    searchInputEl.type = "text";
    searchInputEl.placeholder = "Search games...";
    searchInputEl.value = gameSearchQuery;
    Object.assign(searchInputEl.style, {
        position: "absolute",
        top: "20px",
        right: "20px",
        padding: "6px 10px",
        fontSize: "16px",
        borderRadius: "6px",
        border: "1px solid #ccc",
        outline: "none",
        zIndex: "9999"
    });

    // Debounced update instead of immediate full rebuild each keystroke
    searchInputEl.addEventListener("input", (e) => {
        gameSearchQuery = e.target.value.trim();
        currentPage = 0;

        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
            gamesButtonHit(); // now only called after user stops typing
        }, 250); // adjust debounce ms as you prefer
    });

    document.body.appendChild(searchInputEl);
}

function removeSearchInput() {
    if (searchInputEl) {
        searchInputEl.remove();
        searchInputEl = null;
    }
}






function getMapImageUrl(mapName) {
  const mapImages = {
    "CrocodilosConstruction": "https://codehs.com/uploads/bf8f630935b57a309a530c1a8dfe7e01",
    "SigmaCity": "https://codehs.com/uploads/b8cc1702c4a63a72b963e00b2fd31b1d",
    "DiddyDunes": "https://codehs.com/uploads/f06830b31078621698891417e58cbc56"
  };
  if (!mapName) return mapImages["SigmaCity"];
  for (const key of Object.keys(mapImages)) {
    if (mapName.toLowerCase().includes(key.toLowerCase())) return mapImages[key];
  }
  return mapImages["SigmaCity"];
}


let activeListeners = [];
const gameEntries = {}; // map gameId -> { components: [], listeners: [] }

// Function to clear all active Firebase listeners
function clearAllListeners() {
    activeListeners.forEach(listener => {
        try {
            // default to 'value' if event not provided
            const eventType = listener.event || 'value';
            listener.ref.off(eventType, listener.callback);
        } catch (e) {
            console.warn("Failed to clear listener", listener, e);
        }
    });
    activeListeners = [];
    // also clear local entries map (UI objects should already be removed when leaving)
    for (const id of Object.keys(gameEntries)) delete gameEntries[id];
}

// Remove a specific game entry from the menu and tear down its listeners
function removeGameEntry(gameId) {
    const entry = gameEntries[gameId];
    if (!entry) return;

    // remove UI components (images, texts, hitboxes)
    entry.components.forEach(comp => {
        try { remove(comp); } catch (e) { /* ignore if already removed */ }
        const idx = currentMenuObjects.indexOf(comp);
        if (idx !== -1) currentMenuObjects.splice(idx, 1);
    });

    // detach listeners specific to this entry
    entry.listeners.forEach(l => {
        try {
            const eventType = l.event || 'value';
            l.ref.off(eventType, l.callback);
        } catch (e) {
            console.warn("Failed to remove listener for entry", gameId, e);
        }
        // also remove from global activeListeners
        activeListeners = activeListeners.filter(al => !(al.ref === l.ref && al.callback === l.callback));
    });

    delete gameEntries[gameId];
}

// Helper to register a listener to both global list and a particular entry (if gameId provided)
function registerListener(ref, event, callback, gameId = null) {
    ref.on(event, callback);
    const listenerObj = { ref, callback, event, gameId };
    activeListeners.push(listenerObj);
    if (gameId && gameEntries[gameId]) {
        gameEntries[gameId].listeners.push(listenerObj);
    }
}

// --- updated createGameEntry: register components and listeners into gameEntries ---
async function createGameEntry(slotInfo, y) {
    const slotDb = gameApps[slotInfo.slot].database();
    const gameId = slotInfo.id;
    const mapName = slotInfo.map;

    // create a registry for this entry so we can clear it later
    gameEntries[gameId] = { components: [], listeners: [] };

    // --- IMAGE BUTTON (replaces previous clickable rectangle) ---
    const imageWidth = 1920 * 0.4;
    const imageHeight = 480 * 0.4;
    const xPos = (getWidth() / 2) - (imageWidth / 2);
    const yPos = y - 50;

    const mapImageUrl = getMapImageUrl(mapName);

    const joinCallback = async () => {
        console.log(`Joining game ${slotInfo.gameName} on map ${mapName}`);
        const playerVersion = localStorage.getItem("playerVersion");
        if (playerVersion !== slotInfo.gameVersion) {
            Swal.fire('Version Mismatch', `This game requires version ${slotInfo.gameVersion}, but your game is version ${playerVersion || 'N/A'}. Please update to join.`, 'error');
            return;
        }
        setActiveGameId(gameId);
        clearAllListeners(); // Clean up before starting a new game
        initAndStartGame(username, mapName, gameId);
    };

    const gameButton = createAnimatedButton(
        mapImageUrl,
        imageWidth,
        imageHeight,
        xPos,
        yPos,
        imageWidth,
        imageHeight,
        joinCallback,
        xPos + imageWidth * 0.5,
        yPos + imageHeight * 0.35
    );

    gameButton.setText(slotInfo.gameName);

     
    gameButton.image.setLayer(3);
    gameButton.hitbox.setLayer(16);


    add(gameButton.image);
    makeButton(gameButton.hitbox, gameButton.hitbox.onClick);
     
    currentMenuObjects.push(gameButton.image, gameButton.text, gameButton.hitbox);
    gameEntries[gameId].components.push(gameButton.image, gameButton.text, gameButton.hitbox);

     let slotNameText = new Text(`${slotInfo.gameName}`, "30pt Arial");
     slotNameText.setColor("#ffffff");
     let textWidth = slotNameText.getWidth();
     let centeredX = (getWidth() * 0.45) - (textWidth / 2);
     slotNameText.setPosition(centeredX, y + 25 - 12); // Position below the details text
     slotNameText.setLayer(10);
     add(slotNameText);
     currentMenuObjects.push(slotNameText);
     gameEntries[gameId].components.push(slotNameText);
     
     let versionText = new Text(`${slotInfo.gameVersion}`, "15pt Arial");
     versionText.setColor("#ffffff");
     let textWidthh = versionText.getWidth();
     let centeredXX = (getWidth() * 0.375) - (textWidthh / 2);
     versionText.setPosition(centeredXX, y + 100 - 12); // Position below the details text
     versionText.setLayer(10);
     add(versionText);
    gameEntries[gameId].components.push(versionText);

    let playersText = new Text(`${slotInfo.playerCount}`, "15pt Arial");
     playersText.setColor("#ffffff");
     let textWidthhh = playersText.getWidth();
     let centeredXXX = (getWidth() * 0.49) - (textWidthhh / 2);
     playersText.setPosition(centeredXXX, y + 100 - 12); // Position below the details text
     playersText.setLayer(10);
    add(playersText);
    currentMenuObjects.push(playersText);
    gameEntries[gameId].components.push(playersText);

    const minutes = Math.floor((slotInfo.remainingTime || 0) / 60);
    const seconds = (slotInfo.remainingTime || 0) % 60;
    const formattedTime = slotInfo.remainingTime !== null ?
        `${minutes}:${seconds.toString().padStart(2, '0')}` :
        "N/A";

    let durationText = new Text(`${formattedTime}`, "15pt Arial");
     durationText.setColor("#ffffff");
     let textWidthhhh = durationText.getWidth();
     let centeredXXXX = (getWidth() * 0.44) - (textWidthhhh / 2);
     durationText.setPosition(centeredXXXX, y + 100 - 12); // Position below the details text
     durationText.setLayer(10);
    add(durationText);
    currentMenuObjects.push(durationText);
    gameEntries[gameId].components.push(durationText);

    let killsText = new Text(`N/A`, "15pt Arial");
     killsText.setColor("#ffffff");
     let textWidthhhhh = killsText.getWidth();
     let centeredXXXXX = (getWidth() * 0.55) - (textWidthhhhh / 2);
     killsText.setPosition(centeredXXXXX, y + 100 - 12); // Position below the details text
     killsText.setLayer(10);
    add(killsText);
    currentMenuObjects.push(killsText);
    gameEntries[gameId].components.push(killsText);

    // --- REAL-TIME LISTENERS (registered via helper so they are removable per-entry) ---
    const playersRef = slotDb.ref(`game/${slotInfo.gameInstanceId}/players`);
    const playersCallback = (snapshot) => {
        const playerCount = snapshot.numChildren();
        playersText.setText(`${playerCount}`);
    };
    registerListener(playersRef, 'value', playersCallback, gameId);

    const durationRef = slotDb.ref(`game/${slotInfo.gameInstanceId}/gameConfig/gameDuration`);
    const durationCallback = (snapshot) => {
        const newRemainingTime = snapshot.val();
        if (newRemainingTime !== null) {
            const minutes = Math.floor(newRemainingTime / 60);
            const seconds = newRemainingTime % 60;
            const formattedTime = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            durationText.setText(`${formattedTime}`);
        } else {
            durationText.setText("N/A");
        }
    };
    registerListener(durationRef, 'value', durationCallback, gameId);

    const killsRef = slotDb.ref(`game/${slotInfo.gameInstanceId}/players`);
    const killsCallback = (snapshot) => {
        let maxKills = 0;
        let topPlayer = null;

        snapshot.forEach(playerSnap => {
            const playerData = playerSnap.val();
            const playerId = playerSnap.key;
            if (playerData.kills !== undefined && playerData.kills > maxKills) {
                maxKills = playerData.kills;
                topPlayer = playerData.username || playerData.name || playerId;
            }
        });

        if (topPlayer) {
            killsText.setText(`${maxKills}`);
        } else {
            killsText.setText(`N/A`);
        }
    };
    registerListener(killsRef, 'value', killsCallback, gameId);
}

// --- updated gamesButtonHit: attach gamesRef-level listeners to react to deletions/changes ---
export async function gamesButtonHit() {
    clearMenuCanvas();
    clearAllListeners(); // Clear any old listeners before populating the menu
    add(logo.image);
    makeButton(logo.hitbox, logo.hitbox.onClick);

createSearchInput();
     
    let loadingText = new Text("Loading games...", "30pt Arial");
    loadingText.setColor("#ffffff");
    loadingText.setPosition(getWidth() / 2, getHeight() / 2);
    add(loadingText);
    currentMenuObjects.push(loadingText);

    username = localStorage.getItem("username");
    localStorage.setItem("playerVersion", CLIENT_GAME_VERSION);
    if (username) {
        await assignPlayerVersion(username, CLIENT_GAME_VERSION);
    }

    await authenticateToAllSlotApps();

    try {
        const snapshot = await gamesRef.once('value');
        const gamesObj = snapshot.val() || {};

        const gamesWithDetails = await Promise.all(
            Object.entries(gamesObj)
                .filter(([id, game]) => {
                    return (game.status === "waiting" || game.status === "starting") &&
                        game.gameVersion === CLIENT_GAME_VERSION;
                })
                .map(async ([id, game]) => {
                    const slotName = game.slot;
                    let playerCount = 0;
                    let remainingTime = null;

                    if (slotName && gameApps[slotName]) {
                        try {
                            const slotDb = gameApps[slotName].database();

                            const playersSnapshot = await slotDb.ref(`game/${game.gameInstanceId}/players`).once('value');
                            playerCount = playersSnapshot.numChildren();

                            const configSnapshot = await slotDb.ref(`game/${game.gameInstanceId}/gameConfig`).once('value');

                            if (configSnapshot.exists()) {
                                const config = configSnapshot.val();
                                remainingTime = config.gameDuration;
                            }
                        } catch (e) {
                            console.warn(`Could not get details for game ${id} in slot ${slotName}:`, e);
                        }
                    }

                    return {
                        id,
                        gameName: game.gameName,
                        host: game.host,
                        map: game.map,
                        createdAt: game.createdAt,
                        slot: game.slot,
                        gameVersion: game.gameVersion,
                        gameInstanceId: game.gameInstanceId,
                        playerCount: playerCount,
                        remainingTime: remainingTime
                    };
                })
        );

       let filteredSlots = gamesWithDetails;
if (gameSearchQuery && gameSearchQuery.length > 0) {
    const q = gameSearchQuery.toLowerCase();
    filteredSlots = gamesWithDetails.filter(s =>
        (s.gameName || "").toLowerCase().includes(q)
    );
}

// Sort after filtering
const activeSlots = filteredSlots.sort((a, b) => b.createdAt - a.createdAt);

        remove(loadingText);

        if (activeSlots.length === 0) {
            let none = new Text("No active games available for your version. Create one!", "30pt Arial");
            none.setColor("#ffffff");
            none.setPosition(getWidth() / 2, getHeight() / 2);
            add(none);
            currentMenuObjects.push(none);
            addBackButton(playButtonHit, removeSearchInput);
            return;
        }

        const GAMES_PER_PAGE = 4;
        const startIndex = currentPage * GAMES_PER_PAGE;
        const pageSlots = activeSlots.slice(startIndex, startIndex + GAMES_PER_PAGE);

        let yStart = 200;
        const entryHeight = 480*0.4;

        for (let i = 0; i < pageSlots.length; i++) {
            const slotInfo = pageSlots[i];
            const y = yStart + i * entryHeight;
            await createGameEntry(slotInfo, y);
        }

        // --- Add gamesRef listeners so we auto-remove entries when games disappear or change ---
        // child_removed -> game deleted
        const gamesRemovedCallback = (snap) => {
            const removedId = snap.key;
            // if the removed game is currently displayed, remove its entry and refresh the UI
            if (gameEntries[removedId]) {
                removeGameEntry(removedId);
                // refresh the page to reflow pagination (optional)
                // call setTimeout to avoid re-entrancy inside Firebase event handler
                setTimeout(() => gamesButtonHit(), 50);
            }
        };
        registerListener(gamesRef, 'child_removed', gamesRemovedCallback, null);

        // child_changed -> status/version might have changed; remove if no longer matches
        const gamesChangedCallback = (snap) => {
            const changedId = snap.key;
            const changedData = snap.val();
            if (!changedData) return;
            const stillRelevant = (changedData.status === "waiting" || changedData.status === "starting") &&
                                  changedData.gameVersion === CLIENT_GAME_VERSION;
            if (!stillRelevant && gameEntries[changedId]) {
                removeGameEntry(changedId);
                setTimeout(() => gamesButtonHit(), 50);
            }
        };
        registerListener(gamesRef, 'child_changed', gamesChangedCallback, null);

        const maxPages = Math.ceil(activeSlots.length / GAMES_PER_PAGE);
        const paginationY = getHeight() - 100;

        if (currentPage > 0) {
            let leftArrow = createAndAddButton(
                "https://codehs.com/uploads/5c5306facf6c0ecf2e1e4b4d12a1e17d",
                getWidth() / 2 - 200, paginationY,
                1920/16, 1080/16,
                () => {
                    currentPage--;
                    gamesButtonHit();
                },
                ""
            );
            leftArrow.image.setLayer(4);
            leftArrow.hitbox.setLayer(16);
            currentMenuObjects.push(leftArrow.image, leftArrow.hitbox);
        }

        if (currentPage < maxPages - 1) {
            let rightArrow = createAndAddButton(
                "https://codehs.com/uploads/e06d507ffbe83ffbcada951129c67b42",
                getWidth() / 2 + 80, paginationY,
                1920/16, 1080/16,
                () => {
                    currentPage++;
                    gamesButtonHit();
                },
                ""
            );
            rightArrow.image.setLayer(4);
            rightArrow.hitbox.setLayer(16);
            currentMenuObjects.push(rightArrow.image, rightArrow.hitbox);
        }

        if (maxPages > 0) {
            let pageText = new Text(`Page ${currentPage + 1} of ${maxPages}`, "20pt Arial");
            pageText.setColor("#ffffff");
            pageText.setPosition(getWidth() / 2, paginationY + 15);
            add(pageText);
            currentMenuObjects.push(pageText);
        }

        addBackButton(playButtonHit, removeSearchInput);

    } catch (error) {
        console.error("Error fetching slots:", error);
        remove(loadingText);
        let errorText = new Text("Error loading games: " + error.message, "20pt Arial");
        errorText.setColor("#ff0000");
        errorText.setPosition(getWidth() / 2, getHeight() / 2);
        add(errorText);
        currentMenuObjects.push(errorText);
        addBackButton(playButtonHit, removeSearchInput);
    }
}
/**
 * Adds a "Back to Menu" button to the current screen.
 */
function addBackButton(destination, func) {
    let backButton = createAndAddButton(
        "https://codehs.com/uploads/5c5306facf6c0ecf2e1e4b4d12a1e17d", // Left arrow image
        1080/16, 1080/16, // Top-left corner
        1920/16, 1080/16, // Size for back button
        () => {
            currentPage = 0; // Reset page when going back to main menu
            destination(); // Go back to main menu
            func();
        },
    );
    // Adjust text position relative to its button for 'Back'
    backButton.image.setLayer(4); // Ensure back button is visible
    backButton.hitbox.setLayer(16);
    currentMenuObjects.push(backButton.image, backButton.text, backButton.hitbox);
}

/**
 * Handles the "Settings" button click.
 * Clears the current menu and displays a placeholder settings screen.
 */
function settingsButtonHit() {
    clearMenuCanvas();
     add(settingsMenu);
    // Get the HTML elements for the sensitivity slider and settings box

    const onlinePlayersContainer = document.getElementById("online-players-container");
    if (onlinePlayersContainer) {
        onlinePlayersContainer.style.display = "none";
    }

    // Show these elements
    if (sensitivitySliderContainer) {
        sensitivitySliderContainer.style.display = "flex"; // Or "block", depending on your CSS layout
    }
    if (settingsBox) {
        settingsBox.style.display = "block"; // Or "flex", depending on your CSS layout
    }

    addBackButton(menu); // Keep the back button to return to the main menu
}

/**
 * Handles the "Career" button click.
 * Clears the current menu and displays a placeholder career screen.
 */
function careerButtonHit() {
  clearMenuCanvas();
     add(careerMenu);
  addBackButton(menu);

    const onlinePlayersContainer = document.getElementById("online-players-container");
    if (onlinePlayersContainer) {
        onlinePlayersContainer.style.display = "none";
    }

     
  const username = localStorage.getItem('username') || 'Guest';
  const lineHeight = 60;
  const canvasWidth = getWidth();

  // Create a single off-screen canvas context for measuring text
  const measureCtx = document.createElement("canvas").getContext("2d");
  measureCtx.font = "20pt Arial";

  function createStatText(content, y) {
    const text = new Text(content, "40pt Arial");
    text.setColor("#ffffff");
    text.setLayer(4);
    text.originalFontSize = 20;

    // Measure width and center
    const textWidth = measureCtx.measureText(content).width;
    const centerX = canvasWidth / 2;
    text.setPosition(centerX, y);

    return text;
  }

  function displayStats(userData) {
    const stats = userData.stats || {};
    const wins = stats.wins || 0;
    const kills = stats.kills || 0;
    const deaths = stats.deaths || 0;
    const kd = deaths > 0 ? (kills / deaths).toFixed(2) : 'N/A';
    const losses = stats.losses || 0; // Ensure losses are pulled from stats object

    // Calculate Win Percentage
    let winPercentage = 'N/A';
    const totalGames = wins + losses;
    if (totalGames > 0) {
      winPercentage = ((wins / totalGames) * 100).toFixed(2) + '%';
    }

    const lines = [
      `Career Stats for ${username}`,
      `Wins: ${wins}`,
      `Losses: ${losses}`,
      `Win %: ${winPercentage}`, // Added Win Percentage
      `Kills: ${kills}`,
      `Deaths: ${deaths}`,
      `K/D Ratio: ${kd}`
    ];

    // Start drawing at y = 250
    let y = 350;
    for (let i = 0; i < lines.length; i++) {
      const lineText = createStatText(lines[i], y + i * lineHeight);
      add(lineText);
    }
  }

  usersRef.child(username).once('value')
    .then(snap => {
      if (snap.exists()) {
        displayStats(snap.val());
      } else {
        return usersRef
          .orderByChild('username')
          .equalTo(username)
          .once('value')
          .then(qsnap => {
            let userData = null;
            qsnap.forEach(child => {
              userData = child.val();
            });
            if (!userData) throw new Error("User not found in database.");
            displayStats(userData);
          });
      }
    })
    .catch(err => {
      console.error("Error loading career stats:", err);
      const errorText = createStatText("Unable to load stats.", 150);
      add(errorText);
    });
}

function fetchCareerStats(username, tooltipElement) {
    return new Promise((resolve, reject) => {
        // Use your existing usersRef to fetch data from Firebase
        usersRef.child(username).once('value')
            .then(snap => {
                let userData;
                if (snap.exists()) {
                    userData = snap.val();
                } else {
                    return usersRef
                        .orderByChild('username')
                        .equalTo(username)
                        .once('value')
                        .then(qsnap => {
                            let found = false;
                            qsnap.forEach(child => {
                                userData = child.val();
                                found = true;
                            });
                            if (!found) {
                                throw new Error("User not found.");
                            }
                        });
                }
                
                // If the data is found, display it in the tooltip
                if (userData) {
                    const stats = userData.stats || {};
                    const wins = stats.wins || 0;
                    const kills = stats.kills || 0;
                    const deaths = stats.deaths || 0;
                    const kd = deaths > 0 ? (kills / deaths).toFixed(2) : 'N/A';
                    const losses = stats.losses || 0;
                    let winPercentage = 'N/A';
                    const totalGames = wins + losses;
                    if (totalGames > 0) {
                        winPercentage = ((wins / totalGames) * 100).toFixed(2) + '%';
                    }

                    // Populate the tooltip with the fetched stats
                    tooltipElement.innerHTML = `
                        <b>${username}'s Stats:</b><br>
                        Kills: ${kills}<br>
                        Deaths: ${deaths}<br>
                        K/D Ratio: ${kd}<br>
                        Wins: ${wins}<br>
                        Losses: ${losses}<br>
                        Win %: ${winPercentage}
                    `;
                    resolve();
                } else {
                    reject(new Error("User data not available."));
                }
            })
            .catch(err => {
                console.error("Error loading career stats:", err);
                reject(err);
            });
    });
}
/**
 * Handles the "Loadout" button click.
 * Clears the current menu and displays a placeholder loadout screen.
 */
function loadoutButtonHit() {
  // first clear out any canvas‑drawn menu items
  clearMenuCanvas();

    const onlinePlayersContainer = document.getElementById("online-players-container");
    if (onlinePlayersContainer) {
        onlinePlayersContainer.style.display = "none";
    }

     
add(loadoutMenu);
  // show our DOM loadout overlay
  showLoadoutScreen();

     
  addBackButton(menu, hideLoadoutScreen);
}


    function setSensitivity(newVal) {
        const v = Math.min(parseFloat(sensitivityRange.max), Math.max(parseFloat(sensitivityRange.min), newVal)).toFixed(2);
        sensitivityRange.value = v;
        sensitivityInput.value = v;
        localStorage.setItem("sensitivity", v);
        document.dispatchEvent(new CustomEvent("updateSensitivity", { detail: parseFloat(v) }));
    }

    const savedSens = localStorage.getItem("sensitivity") || "5.00";

        setSensitivity(parseFloat(savedSens));
        sensitivityRange.addEventListener('input', () => {
             console.log("test")
            setSensitivity(sensitivityRange.value);
        });
        sensitivityInput.addEventListener('change', () => {
             console.log("test")
            setSensitivity(parseFloat(sensitivityInput.value));
        });

// A new variable to store the cooldown timestamp, which is now persistent via localStorage
let sessionCooldownUntil = parseInt(localStorage.getItem("sessionCooldown") || "0", 10);

// You will need to import a hashing library.
// For example, if using 'js-sha256':
// import sha256 from 'js-sha256';

export async function initMenuUI() {
    console.log("initMenuUI: Starting menu initialization.");

    const menuOverlay = document.getElementById("menu-overlay");
    const usernamePrompt = document.getElementById("username-prompt");
    const mapSelect = document.getElementById("map-menu");
    const controlsMenu = document.getElementById("menu-controls-menu");
    const htmlPlayButton = document.getElementById("play-button");
    const htmlSettingsButton = document.getElementById("settings-button");
    const htmlCareerButton = document.getElementById("career-button");
    const usernameInput = document.getElementById("username-input");
    const passwordInput = document.getElementById("password-input");
    const signupBtn = document.getElementById("signup-btn");
    const loginBtn = document.getElementById("login-btn");
    const authMessage = document.getElementById("auth-message");
    const toggleDetailsBtn = document.getElementById("toggle-details-btn");
    const mapButtons = document.querySelectorAll(".map-btn");

    let username = localStorage.getItem("username") || "";
    let currentDetailsEnabled = localStorage.getItem("detailsEnabled") === "false" ? false : true;

    if (!onlineUsersRef) {
        console.error("initMenuUI: onlineUsersRef not initialized. Call initializeMenuFirebase first.");
        return;
    }

    // local helper variables
    let menuAppInstance;
    try {
        menuAppInstance = firebase.app("menuApp");
    } catch (e) {
        menuAppInstance = firebase.initializeApp(menuConfig, "menuApp");
    }
    const db = menuAppInstance.database();
    const auth = menuAppInstance.auth();
    const usersRef = db.ref("users");
    const usernamesRef = db.ref("usernames");
    console.log("initMenuUI: Firebase instances initialized.");

    // ------------------- DEVICE/BANNED logic -------------------
    let deviceFingerprintHash = null;
    let deviceBanned = false;
    let bannedNodeRef = null;
    let bannedListenerAttached = false;

    // local seen usernames storage key
    const DEVICE_USERNAMES_KEY = "device_seen_usernames";

    // ---------------- device fingerprint helpers ----------------
    async function ensureDeviceFingerprint() {
        if (deviceFingerprintHash) return deviceFingerprintHash;
        try {
            try { deviceFingerprintHash = localStorage.getItem("deviceFingerprintHash"); } catch (e) { deviceFingerprintHash = null; }

            if (!deviceFingerprintHash) {
                try {
                    deviceFingerprintHash = await getDeviceFingerprintHash();
                    if (deviceFingerprintHash) {
                        try { localStorage.setItem("deviceFingerprintHash", deviceFingerprintHash); } catch (e) {}
                    }
                } catch (e) {
                    console.warn("ensureDeviceFingerprint: Failed to compute fingerprint:", e);
                    deviceFingerprintHash = null;
                }
            }
        } catch (e) {
            console.warn("ensureDeviceFingerprint: unexpected error:", e);
            deviceFingerprintHash = null;
        }
        return deviceFingerprintHash;
    }

    async function getDeviceFingerprintHash() {
        try {
            const parts = [
                navigator.userAgent || '',
                navigator.platform || '',
                navigator.language || '',
                (screen?.width || 0) + 'x' + (screen?.height || 0) + 'x' + (screen?.colorDepth || 0),
                Intl?.DateTimeFormat?.().resolvedOptions?.().timeZone || '',
                String(navigator?.hardwareConcurrency || ''),
                String(navigator?.maxTouchPoints || ''),
                (navigator.plugins ? Array.from(navigator.plugins).map(p => p.name).join(';') : '')
            ].join('||');

            if (window.crypto && window.crypto.subtle && window.TextEncoder) {
                const enc = new TextEncoder();
                const data = enc.encode(parts);
                const hashBuf = await crypto.subtle.digest('SHA-256', data);
                const bytes = new Uint8Array(hashBuf);
                return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
            } else {
                // Weak fallback
                let s = 0;
                for (let i = 0; i < parts.length; i++) {
                    const ch = parts.charCodeAt ? parts.charCodeAt(i) : 0;
                    s = ((s << 5) - s) + ch;
                    s |= 0;
                }
                return String(Math.abs(s));
            }
        } catch (e) {
            console.warn("getDeviceFingerprintHash failed:", e);
            return null;
        }
    }

    // Derive the /devices root ref (left for any minimal device bookkeeping you might still want)
    function deriveDevicesRootRef() {
        if (typeof devicesRef !== 'undefined' && devicesRef) return devicesRef;
        if (typeof bannedDevicesRef !== 'undefined' && bannedDevicesRef) {
            try {
                const appDb = (menuAppInstance && menuAppInstance.database) ? menuAppInstance.database() : firebase.app().database();
                return appDb.ref('devices');
            } catch (e) {}
        }
        try {
            if (menuAppInstance && menuAppInstance.database) return menuAppInstance.database().ref('devices');
            return firebase.app().database().ref('devices');
        } catch (e) {
            console.warn("deriveDevicesRootRef: could not derive devices root ref:", e);
            return null;
        }
    }

    // Derive the /banned root ref (we will listen here for bans)
    function deriveBannedRootRef() {
        if (typeof bannedRef !== 'undefined' && bannedRef) return bannedRef;
        try {
            if (menuAppInstance && menuAppInstance.database) return menuAppInstance.database().ref('banned');
            return firebase.app().database().ref('banned');
        } catch (e) {
            console.warn("deriveBannedRootRef: could not derive banned root ref:", e);
            return null;
        }
    }

    // ---------------- UI helpers ----------------
    function disableUIControls() {
        const disableEls = [signupBtn, loginBtn, htmlPlayButton, htmlSettingsButton, htmlCareerButton, usernameInput, passwordInput];
        disableEls.forEach(el => { if (el) { try { el.disabled = true; el.classList?.add?.('disabled'); } catch (e) {} }});
        mapButtons.forEach(b => { if (b) { try { b.disabled = true; b.classList?.add?.('disabled'); } catch (e) {} }});
    }
    function enableUIControls() {
        const enableEls = [signupBtn, loginBtn, htmlPlayButton, htmlSettingsButton, htmlCareerButton, usernameInput, passwordInput];
        enableEls.forEach(el => { if (el) { try { el.disabled = false; el.classList?.remove?.('disabled'); } catch (e) {} }});
        mapButtons.forEach(b => { if (b) { try { b.disabled = false; b.classList?.remove?.('disabled'); } catch (e) {} }});
    }

    // ---------------- seen usernames helpers ----------------
    function getSeenUsernamesLocal() {
        try {
            const raw = localStorage.getItem(DEVICE_USERNAMES_KEY) || "[]";
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            console.warn("getSeenUsernamesLocal: parse failed:", e);
            return [];
        }
    }

    function addSeenUsernameLocal(name) {
        if (!name) return;
        try {
            const list = getSeenUsernamesLocal();
            if (!list.includes(name)) {
                list.push(name);
                try { localStorage.setItem(DEVICE_USERNAMES_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
            }
        } catch (e) {
            console.warn("addSeenUsernameLocal failed:", e);
        }
    }

    // NOTE: We no longer write seen usernames into /devices/<id>/usernames to keep /devices minimal.
    async function addSeenUsernameToDB(name) {
        try {
            // keep local-only (DB write removed on purpose per your request to keep /devices minimal)
            return;
        } catch (e) {
            console.warn("addSeenUsernameToDB failed:", e);
        }
    }

    async function recordSeenUsername(name) {
        try { addSeenUsernameLocal(name); } catch (e) {}
        try { await addSeenUsernameToDB(name); } catch (e) {}
    }

    // ---------------- add device id to user ----------------
    // (This annotates the user node with the device id — acceptable because it's under /users)
async function addDeviceIdToUser(usernameToAnnotate) {
    try {
        if (!usernameToAnnotate) return;
        // normalize to lower-case key (keep original casing in stored `username` property)
        const key = String(usernameToAnnotate).toLowerCase();
        await ensureDeviceFingerprint();
        if (!deviceFingerprintHash) return;
        if (typeof usersRef === 'undefined' || !usersRef) {
            console.warn("addDeviceIdToUser: usersRef not available, skipping db annotation.");
            return;
        }
        const userNode = usersRef.child(key);
        const updates = {};
        updates[`deviceIds/${deviceFingerprintHash}`] = firebase.database.ServerValue.TIMESTAMP;
        await userNode.update(updates);
    } catch (e) {
        console.warn("addDeviceIdToUser failed:", e);
    }
}

    // ---------------- banned helpers: read, attach listener ----------------
    // checkDeviceBanFromDB now reads /banned/<deviceId> (presence = banned)
    async function checkDeviceBanFromDB() {
        try {
            await ensureDeviceFingerprint();
            if (!deviceFingerprintHash) return false;
            const bannedRoot = deriveBannedRootRef();
            if (!bannedRoot) return false;
            const snap = await bannedRoot.child(deviceFingerprintHash).once('value');
            if (!snap.exists()) return false;
            // existence of node indicates banned; reason may be inside node
            return true;
        } catch (e) {
            console.warn("checkDeviceBanFromDB failed:", e);
            return false;
        }
    }

    async function attachBannedListener() {
        try {
            await ensureDeviceFingerprint();
            if (!deviceFingerprintHash) return;
            const bannedRoot = deriveBannedRootRef();
            if (!bannedRoot) return;
            if (bannedListenerAttached) return;
            bannedNodeRef = bannedRoot.child(deviceFingerprintHash);
            bannedListenerAttached = true;

            let isFirstSnapshot = true;
            let reloadTimer = null;
            const RELOAD_FLAG = 'voidffa_device_ban_reload_scheduled';

            const scheduleReloadOnce = (delayMs = 5000) => {
                try {
                    if (sessionStorage.getItem(RELOAD_FLAG) === '1') {
                        console.log("attachBannedListener: reload already scheduled in this tab; skipping.");
                        return;
                    }
                } catch (e) {}
                try { sessionStorage.setItem(RELOAD_FLAG, '1'); } catch (e) {}
                try {
                    reloadTimer = setTimeout(() => {
                        try { console.log("attachBannedListener: executing scheduled reload due to ban."); } catch (e) {}
                        try { location.reload(); } catch (e) { console.warn("attachBannedListener: location.reload failed:", e); }
                    }, delayMs);
                } catch (e) {
                    console.warn("attachBannedListener: scheduling reload failed:", e);
                    try { location.reload(); } catch (er) { console.warn("attachBannedListener: immediate reload failed:", er); }
                }
            };

            const clearScheduledReload = () => {
                try { if (reloadTimer) { clearTimeout(reloadTimer); reloadTimer = null; } } catch (e) {}
                try { sessionStorage.removeItem(RELOAD_FLAG); } catch (e) {}
            };

            bannedNodeRef.on('value', async (snap) => {
                try {
                    const exists = snap.exists();
                    // reason: could be a child 'reason' or a string value
                    let reasonText = "This device has been banned from the service.";
                    if (exists) {
                        const val = snap.val();
                        if (val && typeof val === 'object' && typeof val.reason === 'string') reasonText = val.reason;
                        else if (typeof val === 'string') reasonText = val;
                    }

                    if (isFirstSnapshot) {
                        // initial state: set local cache, show modal & schedule reload if banned but DO NOT treat as transition
                        isFirstSnapshot = false;
                        deviceBanned = !!exists;
                        if (deviceBanned) {
                            console.warn("attachBannedListener: initial banned node present. Disabling UI and scheduling reload in 5s.");
                            setAuthMessage("This device is banned from using this service.", true);
                            disableUIControls();
                            try {
                                await Swal.fire({
                                    title: 'Banned Device',
                                    html: `<div style="text-align:left; font-size:14px; max-width:420px;">${reasonText}<br><br>If you believe this is a mistake, contact an administrator.</div>`,
                                    icon: 'error',
                                    confirmButtonText: 'OK'
                                });
                            } catch (e) { console.warn("attachBannedListener: Swal modal failed:", e); }
                            scheduleReloadOnce(5000);
                        }
                        return;
                    }

                    // subsequent snapshots -> transitions
                    if (exists && !deviceBanned) {
                        // became banned
                        deviceBanned = true;
                        console.warn("attachBannedListener: device was banned (transition). Disabling UI and scheduling reload in 5s.");
                        setAuthMessage("This device is banned from using this service.", true);
                        disableUIControls();
                        try {
                            await Swal.fire({
                                title: 'Banned Device',
                                html: `<div style="text-align:left; font-size:14px; max-width:420px;">${reasonText}<br><br>If you believe this is a mistake, contact an administrator.</div>`,
                                icon: 'error',
                                confirmButtonText: 'OK'
                            });
                        } catch (e) { console.warn("attachBannedListener: Swal modal failed:", e); }
                        scheduleReloadOnce(5000);
                        return;
                    }

                    if (!exists && deviceBanned) {
                        // became unbanned (banned node removed)
                        console.log("attachBannedListener: device unbanned (transition). Re-enabling UI and cancelling reload.");
                        deviceBanned = false;
                        enableUIControls();
                        setAuthMessage("This device is no longer banned.", false);
                        clearScheduledReload();
                        return;
                    }
                    // else: no state change
                } catch (e) {
                    console.warn("attachBannedListener: error handling snapshot:", e);
                }
            });
        } catch (e) {
            console.warn("attachBannedListener: failed to attach listener:", e);
        }
    }

    // --------------------------------------------------------------

    // ------------------- SERVER-TIME ALIGNMENT -------------------
    let serverTimeOffset = 0;
    try {
        const offsetRef = db.ref(".info/serverTimeOffset");
        offsetRef.on("value", snap => {
            serverTimeOffset = snap.val() || 0;
        });
    } catch (e) {
        console.warn("Failed to attach serverTimeOffset listener:", e);
    }
    const nowAligned = () => Date.now() + (serverTimeOffset || 0);
    // --------------------------------------------------------------

    let lagCheckInterval = null;
    const LAST_ACTIVE_INTERVAL = 5000;
    const LAG_THRESHOLD = LAST_ACTIVE_INTERVAL * 2;

    // ---------- Capacity limit ----------
    const MAX_ONLINE = 50;

    async function countActiveOnline() {
        if (!onlineUsersRef) return 0;
        try {
            const snap = await onlineUsersRef.once('value');
            if (!snap.exists()) return 0;
            const now = nowAligned();
            let count = 0;
            snap.forEach(child => {
                const data = child.val() || {};
                const lastActive = data.lastActive || 0;
                if ((now - lastActive) <= LAG_THRESHOLD) count++;
            });
            return count;
        } catch (e) {
            console.warn("countActiveOnline failed, falling back to total children:", e);
            try {
                const snap = await onlineUsersRef.once('value');
                return snap ? snap.numChildren() : 0;
            } catch (_) {
                return 0;
            }
        }
    }
    // ------------------------------------

    const readSessionCooldownFromStorage = () => {
        const s = localStorage.getItem("sessionCooldown") || "0";
        return parseInt(s, 10) || 0;
    };

    async function hashPassword(password) {
        if (window.crypto && window.crypto.subtle && window.TextEncoder) {
            try {
                const enc = new TextEncoder();
                const data = enc.encode(password);
                const hash = await window.crypto.subtle.digest("SHA-256", data);
                const bytes = new Uint8Array(hash);
                let hex = "";
                for (let b of bytes) {
                    hex += b.toString(16).padStart(2, "0");
                }
                return hex;
            } catch (e) {
                console.warn("hashPassword: SubtleCrypto failed, falling back to plain text (not secure).", e);
                return password;
            }
        } else {
            console.warn("hashPassword: crypto.subtle not available, storing plain text (not secure).");
            return password;
        }
    }

    function showPanel(panelToShow) {
        [usernamePrompt, mapSelect, controlsMenu].forEach(p => {
            if (p) p.classList.add("hidden");
        });
        if (panelToShow) {
            panelToShow.classList.remove("hidden");
            panelToShow.style.display = "flex";
        }
    }

    function setAuthMessage(msg, isError = true) {
        if (!authMessage) return;
        authMessage.style.color = isError ? "#c00" : "#080";
        authMessage.textContent = msg || "";
    }

    async function authenticateUser() {
        if (deviceBanned) {
            console.warn("authenticateUser: blocked because device is banned.");
            throw new Error("device_banned");
        }

        if (!auth.currentUser) {
            console.log("authenticateUser: No current user, signing in anonymously.");
            try {
                await auth.signInAnonymously();
                console.log("authenticateUser: Signed in anonymously (menuApp).");
            } catch (error) {
                console.error("authenticateUser: Authentication failed (menuApp):", error);
                Swal.fire('Error', 'Could not sign in. Please try again.', 'error');
            }
        }
    }

    async function updateOnlinePresence(uid, rawUsername) {
        if (!onlineUsersRef) return;
        try {
            const onlineRef = onlineUsersRef.child(uid);
            const snap = await onlineRef.once('value');
            const sessionId = (snap.exists() && snap.child('session').exists()) ? snap.child('session').val() : crypto.randomUUID();

            await onlineRef.update({
                username: rawUsername,
                lastActive: firebase.database.ServerValue.TIMESTAMP,
                session: sessionId
            });

            try {
                onlineRef.onDisconnect().remove();
            } catch (e) { /* ignore on platforms that don't support */ }
        } catch (e) {
            console.warn("updateOnlinePresence: failed to update onlineUsers node:", e);
        }
    }

    async function handleLaggedOut() {
        console.log("handleLaggedOut: User appears to have lagged out. Removing presence.");
        if (onlineUsersRef && auth.currentUser) {
            await onlineUsersRef.child(auth.currentUser.uid).remove();
        }
        localStorage.setItem("laggedOut", "true");
        location.reload();
    }

    // ---------- Host watcher (full implementation kept from your original code) ----------
const hostTrackers = {}; // key = `${slotName}/${gameId}`
async function initHostWatcherForAllSlots() {
  // Ensure we have anon auth for each slot app first
  try {
    await authenticateToAllSlotApps();
  } catch (e) {
    console.warn("initHostWatcherForAllSlots: authenticateToAllSlotApps failed:", e);
    // we'll still attempt per-slot init below
  }

  for (const slotName of Object.keys(gameDatabaseConfigs)) {
    const cfg = gameDatabaseConfigs[slotName];
    if (!cfg) {
      console.warn("initHostWatcherForAllSlots: missing config for", slotName);
      continue;
    }

    // ensure app exists
    try {
      if (!gameApps[slotName]) {
        try {
          gameApps[slotName] = firebase.app(slotName + "App");
        } catch (e) {
          gameApps[slotName] = firebase.initializeApp(cfg, slotName + "App");
        }
      }
    } catch (e) {
      console.warn("initHostWatcherForAllSlots: failed to init app for", slotName, e);
      continue;
    }

    const app = gameApps[slotName];
    if (!app) continue;

    const slotAuth = app.auth();
    try {
      if (!slotAuth.currentUser) {
        const cred = await slotAuth.signInAnonymously();
        console.log(`[hostWatcher] signed into ${slotName} uid=${cred.user.uid}`);
      } else {
        console.log(`[hostWatcher] reusing auth for ${slotName} uid=${slotAuth.currentUser.uid}`);
      }
    } catch (err) {
      console.warn(`[hostWatcher] anon sign-in failed for ${slotName}:`, err);
      continue;
    }

    const slotUid = slotAuth.currentUser.uid;
    const dbSlot = app.database();
    const gameRootRef = dbSlot.ref('game');

    const onChildAdded = snap => {
      if (!snap || !snap.exists()) return;
      const gameId = snap.key;
      const gamePath = `game/${gameId}`;
      const configRef = dbSlot.ref(`${gamePath}/gameConfig`);
      const ownerRef = configRef.child('owner');
      const durationRef = configRef.child('gameDuration');
      const endedRef = configRef.child('ended');
      const trackerKey = `${slotName}/${gameId}`;
      if (hostTrackers[trackerKey]) return; // already tracking

      const tracker = {
        slotName,
        gameId,
        ownerInterval: null,          // heartbeat interval (when we're owner)
        currentRemainingSeconds: null,
        ownerHandler: null,
        durationHandler: null,
        endedHandler: null,
        ownerId: null,                // last seen owner id
        lastDurationTs: null,         // timestamp (ms) of last duration update
        ownerStaleInterval: null      // interval checking for stale duration updates
      };
      hostTrackers[trackerKey] = tracker;

      // Try a quick initial election if owner absent
      try {
        configRef.once('value', snapCfg => {
          if (!snapCfg.exists()) return;

          // --- NEW: if there's no gameDuration property, mark the slot ended immediately ---
          const hasDuration = snapCfg.child('gameDuration').exists();
          if (!hasDuration) {
            setTimeout(() => {
              // re-check if duration exists before ending
              configRef.child('gameDuration').once('value').then(snapDur => {
                if (!snapDur.exists()) {
                  console.log(`[hostWatcher] no gameDuration found for ${trackerKey} after delay, ending slot`);
                  endedRef.set(true).catch(e => {
                    console.warn(`[hostWatcher] failed to set ended for ${trackerKey}:`, e);
                  });
                }
              }).catch(e => console.warn(`[hostWatcher] failed to check gameDuration for ${trackerKey}:`, e));
            }, 800); // wait 800ms before ending
            return; // exit early; durationHandler will pick it up if it appears
          }
          // --- END NEW ---

          // if there's no owner property, attempt to claim
          ownerRef.transaction(curr => (curr === null ? slotUid : undefined), false)
            .catch(e => console.warn(`[hostWatcher] initial owner tx failed ${trackerKey}:`, e));
          try { ownerRef.onDisconnect().remove(); } catch (e) { /* ignore */ }
        });
      } catch (e) {
        console.warn(`[hostWatcher] once(gameConfig) failed for ${trackerKey}:`, e);
      }

      // OWNER handler
      tracker.ownerHandler = snapOwner => {
        const ownerId = snapOwner.val();
        tracker.ownerId = ownerId;

        // If we're owner and haven't started heartbeat, start it
        if (ownerId === slotUid && tracker.ownerInterval === null) {
          tracker.ownerInterval = setInterval(async () => {
            // only tick if we know the remaining seconds
            if (tracker.currentRemainingSeconds == null) return;
            if (tracker.currentRemainingSeconds <= 0) {
              try { await configRef.child('ended').set(true); } catch (e) {}
              return;
            }
            tracker.currentRemainingSeconds--;
            try { await durationRef.set(tracker.currentRemainingSeconds); } catch (e) {}
          }, 1000);
          console.log(`[hostWatcher] became owner for ${trackerKey}`);
        }
        // If we lost ownership, stop heartbeat
        if (ownerId !== slotUid && tracker.ownerInterval !== null) {
          clearInterval(tracker.ownerInterval);
          tracker.ownerInterval = null;
          console.log(`[hostWatcher] lost ownership for ${trackerKey}`);
        }
        // If owner is null, attempt re-election with jitter
        if (ownerId === null) {
          setTimeout(() => {
            ownerRef.transaction(curr => (curr === null ? slotUid : undefined), false)
              .catch(e => console.warn(`[hostWatcher] re-elect failed ${trackerKey}:`, e));
            try { ownerRef.onDisconnect().remove(); } catch (e) {}
          }, 300 + Math.floor(Math.random() * 700));
        }
      };

      // DURATION handler
      tracker.durationHandler = snapDur => {
        const val = snapDur.val();

        // If duration removed / missing -> end the slot
        if (val == null || val === '') {
          try {
            console.log(`[hostWatcher] gameDuration missing for ${trackerKey}, setting ended=true`);
            endedRef.set(true).catch(e => {
              console.warn(`[hostWatcher] failed to set ended when duration missing ${trackerKey}:`, e);
            });
          } catch (e) {
            console.warn(`[hostWatcher] failed to set ended when duration missing ${trackerKey}:`, e);
          }
          return;
        }

        if (typeof val === 'number') {
          tracker.currentRemainingSeconds = val;
          tracker.lastDurationTs = Date.now();
        }
      };

      // ENDED handler
      tracker.endedHandler = snapEnded => {
        if (snapEnded.val() === true) {
          ownerRef.once('value').then(ownerSnap => {
            const ownerId = ownerSnap.val();
            if (ownerId === slotUid) {
              setTimeout(async () => {
                try {
                  console.log(`[hostWatcher] owner ${slotUid} releasing slot ${slotName} game/${gameId}`);
                  await releaseGameSlot(slotName);
                } catch (e) {
                  console.warn(`[hostWatcher] releaseGameSlot failed for ${slotName}:`, e);
                }
              }, 1000);
            } else {
              console.log(`[hostWatcher] ended for ${slotName}/${gameId}, owner is ${ownerId}, not releasing.`);
            }
          }).catch(e => {
            console.warn('[hostWatcher] ownerRef.once failed during ended handling:', e);
          });
          cleanupTracker(`${slotName}/${gameId}`);
        }
      };

      // Start a stale-check interval to swap owner if duration isn't updated for 3s
      try {
        tracker.ownerStaleInterval = setInterval(() => {
          try {
            // Only attempt takeover if:
            //  - we are NOT the current owner
            //  - we have seen a lastDurationTs
            //  - the last update was > 3000ms ago
            //  - there is a current owner (ownerId != null)
            if (tracker.ownerId && tracker.ownerId !== slotUid && tracker.lastDurationTs) {
              const ageMs = Date.now() - tracker.lastDurationTs;
              if (ageMs > 3000) {
                // attempt to claim IF the DB owner still matches the ownerId we saw
                console.log(`[hostWatcher] detected stale duration (${ageMs}ms) for ${trackerKey}, attempting takeover from ${tracker.ownerId}`);
                ownerRef.transaction(curr => (curr === tracker.ownerId ? slotUid : undefined), false)
                  .then(() => {
                    try { ownerRef.onDisconnect().remove(); } catch (e) { /* ignore */ }
                  })
                  .catch(e => console.warn(`[hostWatcher] stale takeover tx failed ${trackerKey}:`, e));
              }
            }
          } catch (e) {
            console.warn(`[hostWatcher] ownerStaleInterval error for ${trackerKey}:`, e);
          }
        }, 1000);
      } catch (e) {
        console.warn(`[hostWatcher] failed to start ownerStaleInterval for ${trackerKey}:`, e);
      }

      // Attach listeners
      try {
        ownerRef.on('value', tracker.ownerHandler);
        durationRef.on('value', tracker.durationHandler);
        endedRef.on('value', tracker.endedHandler);
      } catch (e) {
        console.warn(`[hostWatcher] failed to attach listeners for ${trackerKey}:`, e);
        cleanupTracker(trackerKey);
      }
    };

    const onChildRemoved = snap => {
      if (!snap) return;
      const gameId = snap.key;
      const trackerKey = `${slotName}/${gameId}`;
      cleanupTracker(trackerKey);
    };

    try {
      gameRootRef.on('child_added', onChildAdded);
      gameRootRef.on('child_removed', onChildRemoved);
    } catch (e) {
      console.warn(`[hostWatcher] failed to attach root listeners for ${slotName}:`, e);
    }

    if (!hostTrackers[slotName]) hostTrackers[slotName] = {};
    hostTrackers[slotName].rootListeners = { gameRootRef, onChildAdded, onChildRemoved };
  } // end for slots

  function cleanupTracker(trackerKey) {
    const t = hostTrackers[trackerKey];
    if (!t) return;

    try {
      if (t.ownerInterval) {
        clearInterval(t.ownerInterval);
        t.ownerInterval = null;
      }
      if (t.ownerStaleInterval) {
        clearInterval(t.ownerStaleInterval);
        t.ownerStaleInterval = null;
      }

      const [slotName, gameId] = trackerKey.split('/');
      const app = gameApps[slotName];
      if (app) {
        const db = app.database();
        const configRef = db.ref(`game/${gameId}/gameConfig`);
        if (t.ownerHandler) configRef.child('owner').off('value', t.ownerHandler);
        if (t.durationHandler) configRef.child('gameDuration').off('value', t.durationHandler);
        if (t.endedHandler) configRef.child('ended').off('value', t.endedHandler);
      }
    } catch (e) {
      console.warn("cleanupTracker error:", e);
    } finally {
      delete hostTrackers[trackerKey];
      console.log(`[hostWatcher] cleaned up tracker ${trackerKey}`);
    }
  }
}
    // ---------------------------------------------------

    // ---------- initializeMenuDisplay ----------
async function initializeMenuDisplay() {
    console.log("initializeMenuDisplay: Starting display logic.");

    // Fast abort if already known banned
    if (deviceBanned) {
        console.warn("initializeMenuDisplay: aborting because device is banned (cached).");
        return;
    }

    // Step 1: compute & cache fingerprint up-front (store in localStorage)
    let deviceHash = null;
    try {
        try { deviceHash = localStorage.getItem("deviceFingerprintHash"); } catch (e) { deviceHash = null; }

        if (!deviceHash) {
            try {
                deviceHash = await getDeviceFingerprintHash();
                if (deviceHash) {
                    try { localStorage.setItem("deviceFingerprintHash", deviceHash); } catch (e) { /* ignore storage errors */ }
                }
            } catch (e) {
                console.warn("Failed to compute device fingerprint:", e);
                deviceHash = null;
            }
        }
    } catch (e) {
        console.warn("initializeMenuDisplay: could not compute/store device fingerprint:", e);
        deviceHash = null;
    }

    // --- ensure auth if we need to write (so rules like "auth != null" will pass) ---
    try {
        if (!auth.currentUser) {
            await authenticateUser();
            console.log("initializeMenuDisplay: authenticated before device/user writes, uid=", auth.currentUser?.uid);
        }
    } catch (e) {
        console.warn("initializeMenuDisplay: auth before device write failed or device banned — skipping device writes.", e);
        // If you want to stop initialization on auth failure uncomment the next line:
        // return;
    }

    // ----------------------------
    // Per-user deviceId -> /banned watchers
    // Stored on window to persist across calls to initializeMenuDisplay()
    // ----------------------------
    if (!window.__userDeviceBanWatchers__) window.__userDeviceBanWatchers__ = {};
    const userDeviceBanWatchers = window.__userDeviceBanWatchers__;

    async function ensureAuthIfNeededForBannedReads() {
        if (!auth) return;
        if (!auth.currentUser) {
            try {
                await authenticateUser(); // will throw if deviceBanned
            } catch (e) {
                console.warn("ensureAuthIfNeededForBannedReads: auth failed", e);
                throw e;
            }
        }
    }

    function attachBanWatcherForDeviceId(deviceId) {
        try {
            if (!deviceId) return;
            if (userDeviceBanWatchers[deviceId]) return; // already watching

            const bannedRoot = deriveBannedRootRef();
            if (!bannedRoot) return;

            const nodeRef = bannedRoot.child(deviceId);
            const handler = async (snap) => {
                try {
                    const exists = snap.exists();
                    let reasonText = "This device has been banned from the service.";
                    if (exists) {
                        const val = snap.val();
                        if (val && typeof val === 'object' && typeof val.reason === 'string') reasonText = val.reason;
                        else if (typeof val === 'string') reasonText = val;
                    }

                    // If the ban node exists -> treat as banned
                    if (exists) {
                        console.warn(`attachBanWatcherForDeviceId: device ${deviceId} banned:`, reasonText);

                        // If the banned device is the local fingerprint OR you want global reaction:
                        if (deviceId === deviceFingerprintHash) {
                            // local device banned -> immediate enforced ban
                            deviceBanned = true;
                            setAuthMessage("This device is banned from using this service.", true);
                            disableUIControls();
                            try {
                                await Swal.fire({
                                    title: 'Banned Device',
                                    html: `<div style="text-align:left; font-size:14px; max-width:420px;">${reasonText}<br><br>If you believe this is a mistake, contact an administrator.</div>`,
                                    icon: 'error',
                                    confirmButtonText: 'OK'
                                });
                            } catch (e) { /* ignore modal failures */ }
                            try { sessionStorage.setItem('voidffa_device_ban_reload_scheduled', '1'); } catch(_) {}
                            setTimeout(() => { try { location.reload(); } catch(_) {} }, 5000);
                        } else {
                            // Another deviceId of this user got banned.
                            // Default: notify the user but do not necessarily disable UI.
                            // Adjust behavior here if you want different handling.
                            try {
                                await Swal.fire({
                                    title: 'Device of Account Banned',
                                    html: `<div style="text-align:left; font-size:14px; max-width:420px;">Another device associated with this account has been banned:<br><br>${reasonText}</div>`,
                                    icon: 'warning',
                                    confirmButtonText: 'OK'
                                });
                            } catch (e) {}
                        }
                    } else {
                        // ban node removed -> if it was the local device, unban
                        if (deviceId === deviceFingerprintHash && deviceBanned) {
                            console.log(`attachBanWatcherForDeviceId: device ${deviceId} unbanned.`);
                            deviceBanned = false;
                            enableUIControls();
                            setAuthMessage("This device is no longer banned.", false);
                            try { sessionStorage.removeItem('voidffa_device_ban_reload_scheduled'); } catch(_) {}
                        }
                    }
                } catch (e) {
                    console.warn("attachBanWatcherForDeviceId handler error:", e);
                }
            };

            // Attach listener (note: requires that rules allow read or client is authenticated)
            try {
                nodeRef.on('value', handler);
                userDeviceBanWatchers[deviceId] = { nodeRef, handler };
            } catch (e) {
                console.warn("attachBanWatcherForDeviceId: failed to attach listener (permission or network):", e);
            }
        } catch (e) {
            console.warn("attachBanWatcherForDeviceId failed:", e);
        }
    }

    function detachBanWatcherForDeviceId(deviceId) {
        try {
            const w = userDeviceBanWatchers[deviceId];
            if (!w) return;
            try { w.nodeRef.off('value', w.handler); } catch (e) { /* ignore */ }
            delete userDeviceBanWatchers[deviceId];
        } catch (e) {
            console.warn("detachBanWatcherForDeviceId failed:", e);
        }
    }

    async function monitorUserDeviceIdsForBans(usernameToWatch) {
        try {
            if (!usernameToWatch) return;
            // ensure auth if your rules require it
            try { await ensureAuthIfNeededForBannedReads(); } catch (e) { return; }

            const userNode = usersRef.child(usernameToWatch.toLowerCase()).child('deviceIds');

            // initial scan
            try {
                const snap = await userNode.once('value');
                if (snap.exists()) {
                    snap.forEach(child => {
                        const did = child.key;
                        attachBanWatcherForDeviceId(did);
                    });
                }
            } catch (e) {
                console.warn("monitorUserDeviceIdsForBans initial scan failed:", e);
            }

            // watch for additions/removals
            const onChildAdded = (snap) => {
                if (!snap || !snap.exists()) return;
                const did = snap.key;
                attachBanWatcherForDeviceId(did);
            };
            const onChildRemoved = (snap) => {
                if (!snap) return;
                const did = snap.key;
                detachBanWatcherForDeviceId(did);
            };

            // store these handlers so they can be detached later
            const metaKey = `_user_watch_${usernameToWatch.toLowerCase()}`;
            // detach previous if any
            if (userDeviceBanWatchers[metaKey]) {
                try {
                    userNode.off('child_added', userDeviceBanWatchers[metaKey].added);
                    userNode.off('child_removed', userDeviceBanWatchers[metaKey].removed);
                } catch (e) {}
            }
            userNode.on('child_added', onChildAdded);
            userNode.on('child_removed', onChildRemoved);
            userDeviceBanWatchers[metaKey] = { added: onChildAdded, removed: onChildRemoved };

        } catch (e) {
            console.warn("monitorUserDeviceIdsForBans failed:", e);
        }
    }

    function stopMonitoringUserDeviceIds(usernameToStop) {
        try {
            if (!usernameToStop) return;
            const userNode = usersRef.child(usernameToStop.toLowerCase()).child('deviceIds');
            const metaKey = `_user_watch_${usernameToStop.toLowerCase()}`;
            const meta = userDeviceBanWatchers[metaKey];
            if (meta) {
                try { userNode.off('child_added', meta.added); } catch (e) {}
                try { userNode.off('child_removed', meta.removed); } catch (e) {}
                delete userDeviceBanWatchers[metaKey];
            }
            // detach all individual device watchers (safe simple approach)
            Object.keys(userDeviceBanWatchers).forEach(k => {
                if (k.startsWith('_user_watch_')) return;
                detachBanWatcherForDeviceId(k);
            });
        } catch (e) {
            console.warn("stopMonitoringUserDeviceIds failed:", e);
        }
    }
    // ---------------------------- end of watchers ----------------------------

    // NOTE: do NOT create or write banned/createdAt fields under /devices.
    // Keep /devices minimal (keys only) — server/admin should manage banned info under /banned.

    // Continue with capacity checks + lag checks
    try {
        const currentOnline = await countActiveOnline();
        if (currentOnline >= MAX_ONLINE) {
            Swal.fire({
                title: 'Server Busy',
                text: `There are currently ${currentOnline} players online. Please try again later.`,
                icon: 'info',
                confirmButtonText: 'OK'
            }).then(() => showPanel(usernamePrompt));
            return;
        }
    } catch (e) {
        console.warn("Capacity check failed; continuing initialization:", e);
    }

    if (localStorage.getItem("laggedOut") === "true") {
        localStorage.removeItem("laggedOut");
        Swal.fire({
            title: 'Connection Lost',
            text: 'Your connection lagged out. You have been removed from the online players list. Please try logging in again.',
            icon: 'warning',
            confirmButtonText: 'OK'
        });
    }

    const sessionCooldownVal = readSessionCooldownFromStorage();
    if (nowAligned() < sessionCooldownVal) {
        const remaining = Math.ceil((sessionCooldownVal - nowAligned()) / 1000);
        Swal.fire({
            title: 'Session Cooldown',
            text: `You have been logged out. Please wait ${remaining} seconds before re-initializing.`,
            icon: 'info',
            confirmButtonText: 'OK'
        }).then(() => showPanel(usernamePrompt));
        return;
    }

    // ensure we have auth (anonymous ok)
    await new Promise(resolve => {
        const unsubscribe = auth.onAuthStateChanged(user => {
            console.log("initializeMenuDisplay: Auth state changed. User:", user ? user.uid : 'null');
            if (user) {
                unsubscribe();
                resolve(user);
            } else {
                authenticateUser().then(resolve).catch(() => resolve(null));
            }
        });
    });

    const user = auth.currentUser;
    if (!user) {
        console.error("initializeMenuDisplay: Authentication failed. Showing username prompt.");
        showPanel(usernamePrompt);
        return;
    }
    const uid = user.uid;
    console.log(`initializeMenuDisplay: User authenticated with UID: ${uid}.`);

    // Step 4: username consistency
    const localUsername = localStorage.getItem("username");
    if (localUsername) {
        const userRef = usersRef.child(localUsername.toLowerCase());
        const userSnap = await userRef.once('value');
        if (!userSnap.exists() || !userSnap.child('ids').child(uid).exists()) {
            console.warn("initializeMenuDisplay: Local username does not match server data. Clearing session.");
            localStorage.removeItem("username");
            try { await onlineUsersRef.child(uid).remove(); } catch (e) {}
            showPanel(usernamePrompt);
            return;
        }
        username = localUsername;
        // record seen username + annotate user with device id
        try { await recordSeenUsername(username); } catch (e) {}
        try { await addDeviceIdToUser(username); } catch (e) {}
        // START: monitor this user's deviceIds for bans
        try { await monitorUserDeviceIdsForBans(username); } catch (e) { console.warn("monitorUserDeviceIdsForBans failed (localUsername branch):", e); }
        // END
    } else {
        const byUidSnap = await usernamesRef.orderByValue().equalTo(uid).once("value");
        if (byUidSnap.exists()) {
            const serverUsername = Object.keys(byUidSnap.val())[0];
            username = serverUsername;
            try { localStorage.setItem("username", username); } catch (e) {}
            console.log("initializeMenuDisplay: Recovered username from server after cookie clear.");
            try { await recordSeenUsername(username); } catch (e) {}
            try { await addDeviceIdToUser(username); } catch (e) {}
            // START: monitor this user's deviceIds for bans
            try { await monitorUserDeviceIdsForBans(username); } catch (e) { console.warn("monitorUserDeviceIdsForBans failed (byUid branch):", e); }
            // END
        } else {
            console.warn("initializeMenuDisplay: No local or server username found. Showing prompt.");
            username = "";
            showPanel(usernamePrompt);
            return;
        }
    }

    // NOTE: Removed Step 5 that annotated /devices node with username & uid timestamps to keep /devices minimal.

    // Step 6: Read ban flag now from /banned/<deviceId>
    try {
        const bannedRoot = deriveBannedRootRef();
        if (bannedRoot && deviceHash) {
            const snap = await bannedRoot.child(deviceHash).once('value');
            if (snap.exists()) {
                const v = snap.val();
                const reason = (v && typeof v === 'object' && v.reason) ? v.reason : (typeof v === 'string' ? v : "This device has been banned from the service.");
                await Swal.fire({
                    title: 'Banned Device',
                    html: `<div style="text-align:left; font-size:14px; max-width:420px;">${reason}<br><br>If you believe this is a mistake, contact an administrator.</div>`,
                    icon: 'error',
                    confirmButtonText: 'OK'
                });
                deviceBanned = true;
                disableUIControls();
                setAuthMessage("This device is banned from using this service.", true);
                return;
            }
        }
    } catch (e) {
        console.warn("initializeMenuDisplay: failed to read ban flag (continuing):", e);
    }

    // The rest: presence, session, alert, lag checks, etc.
    if (lagCheckInterval) {
        clearInterval(lagCheckInterval);
        lagCheckInterval = null;
    }

    if (username && username.trim()) {
        const sessionId = crypto.randomUUID();
        const onlineRef = onlineUsersRef.child(uid);
        const currentSessionRef = onlineRef.child("session");

        currentSessionRef.on("value", snapshot => {
            if (snapshot.exists() && snapshot.val() !== sessionId) {
                const newCooldown = nowAligned() + (5 * 60 * 1000); // 5 minutes
                localStorage.setItem("sessionCooldown", newCooldown.toString());
                if (typeof sessionCooldownUntil !== 'undefined') {
                    try { sessionCooldownUntil = newCooldown; } catch (e) {}
                }

                Swal.fire({
                    title: 'Logged In Elsewhere',
                    text: 'You have been logged out because your account was logged into from another location. Reloading in 2 seconds...',
                    icon: 'warning',
                    confirmButtonText: 'OK'
                });
                setTimeout(() => location.reload(), 2000);
                try { onlineRef.onDisconnect().cancel(); } catch (e) {}
                try { onlineRef.remove(); } catch (e) {}
                return;
            } else if (snapshot.val() === sessionId) {
                localStorage.removeItem("sessionCooldown");
                if (typeof sessionCooldownUntil !== 'undefined') {
                    try { sessionCooldownUntil = 0; } catch (e) {}
                }
            }
        });

        try {
            await onlineRef.set({
                username: username,
                lastActive: firebase.database.ServerValue.TIMESTAMP,
                session: sessionId
            });
            try { onlineRef.onDisconnect().remove(); } catch (e) {}
            try { onlineRef.child('alert').set('placeholder'); } catch (e) {}
        } catch (e) {
            console.error("initializeMenuDisplay: Failed to set user online status:", e);
        }

        // Player alert listener
        (function minimalPlayerAlert() {
            const PLACEHOLDER = 'placeholder';
            let alertEl = document.getElementById('player-alert');
            if (!alertEl) {
                alertEl = document.createElement('div');
                alertEl.id = 'player-alert';
                alertEl.style.minHeight = '18px';
                alertEl.style.fontSize = '12px';
                (document.getElementById('player-card') || document.getElementById('menu-overlay') || document.body).appendChild(alertEl);
            }
            alertEl.textContent = '\u00A0';

            if (!onlineUsersRef || !uid) return;
            const alertRef = onlineUsersRef.child(uid).child('alert');
            let timer = null;

            alertRef.on('value', snap => {
                const v = snap.exists() ? String(snap.val()) : '';
                alertEl.textContent = (v && v !== PLACEHOLDER) ? v : '\u00A0';

                if (!v || v === PLACEHOLDER) {
                    if (timer) {
                        clearTimeout(timer);
                        timer = null;
                    }
                    return;
                }

          if (v !== PLACEHOLDER) {
              if (window.Swal && typeof Swal.fire === 'function') {
                  Swal.fire({
                      title: 'Void.FFA Gods',
                      text: v,
                      icon: 'info',
                      confirmButtonText: 'OK',
                      didOpen: () => {
                          // Ensure it's forced to the top
                          const swalContainer = document.querySelector('.swal2-container');
                          if (swalContainer) swalContainer.style.zIndex = '999999';
                      }
                  });
              } else if (typeof Swal === 'function') {
                  Swal('Void.FFA Gods', v, 'info');
                  const swalContainer = document.querySelector('.swal2-container');
                  if (swalContainer) swalContainer.style.zIndex = '999999';
              }
              sessionStorage.setItem('voidffa_player_alert_shown', '1');
          }

                if (timer) clearTimeout(timer);
                timer = setTimeout(async () => {
                    timer = null;
                    try {
                        const cur = await alertRef.once('value');
                        if (cur.exists() && String(cur.val()) === v) {
                            await alertRef.set(PLACEHOLDER);
                        }
                    } catch (e) { /* ignore permission errors */ }
                }, 3000);
            });
        })();

let disconnectAlertShown = false;

const myRef = onlineUsersRef.child(uid);

myRef.onDisconnect().remove(); // ensure server cleans up if connection dies

// Listen for your own node being deleted or overwritten
myRef.on('value', snapshot => {
    const data = snapshot.val();
    if (!data || data.session !== sessionId) { // missing or replaced session
        Swal.fire({
            title: 'Disconnected',
            text: 'You were disconnected. Reload to reconnect.',
            icon: 'warning',
            confirmButtonText: 'Reload'
        }).then(() => location.reload());
    }
});

         
lagCheckInterval = setInterval(async () => {
    try {
        // Update presence
        await onlineUsersRef.child(uid).update({
            lastActive: firebase.database.ServerValue.TIMESTAMP,
            session: sessionId // keep session alive
        });

        const now = nowAligned();
        const onlineSnapshot = await onlineUsersRef.once('value');

        if (onlineSnapshot.exists()) {
            // remove other inactive users
            onlineSnapshot.forEach(child => {
                const otherUid = child.key;
                if (otherUid === uid) return;

                const data = child.val();
                const lastActive = data.lastActive || 0;
                const inGame = !!data.currentGameId;

                if (!inGame && (now - lastActive > LAG_THRESHOLD)) {
                    console.log(`User ${otherUid} inactive for more than ${LAG_THRESHOLD/1000}s and not in game. Removing.`);
                    onlineUsersRef.child(otherUid).remove();
                }
            });

            // --- minimal self-presence check ---
            if (!disconnectAlertShown && document.visibilityState === 'visible') {
                const mySnap = onlineSnapshot.child(uid);
                const myData = mySnap.val() || {};
                const myLastActive = myData.lastActive || 0;
                const dbSession = myData.session || null;

                if (!mySnap.exists() || (now - myLastActive > LAG_THRESHOLD) || dbSession !== sessionId) {
                    disconnectAlertShown = true; // only show once
                    await Swal.fire({
                        title: 'Disconnected',
                        text: 'You were disconnected. Reload to reconnect.',
                        icon: 'warning',
                        confirmButtonText: 'Reload'
                    });
                    location.reload();
                }
            }
        }
    } catch (e) {
        console.error("lagCheckInterval: Failed to update presence or check for inactive users:", e);
        const lastActiveLocal = parseInt(localStorage.getItem("lastActiveLocal") || "0", 10);
        if (lastActiveLocal && (nowAligned() - lastActiveLocal > LAG_THRESHOLD)) {
            handleLaggedOut();
        } else {
            localStorage.setItem("lastActiveLocal", nowAligned().toString());
        }
    }
}, LAST_ACTIVE_INTERVAL);
    }

    if (username && username.trim()) {
        showPanel(null);
        if (typeof menu === "function") menu();
        document.getElementById("game-logo")?.classList.add("hidden");
        if (menuOverlay) menuOverlay.style.display = "none";
        if (typeof canvas !== "undefined" && canvas) canvas.style.display = "block";
    } else {
        showPanel(usernamePrompt);
        if (typeof canvas !== "undefined" && canvas) canvas.style.display = 'none';
        document.getElementById("game-logo")?.classList.remove("hidden");
    }
} // end initializeMenuDisplay

    // ---------- UI bindings ----------
    if (htmlPlayButton) htmlPlayButton.addEventListener("click", () => showPanel(mapSelect));
    if (htmlSettingsButton) htmlSettingsButton.addEventListener("click", () => showPanel(controlsMenu));
    if (htmlCareerButton) htmlCareerButton.addEventListener("click", () => console.log("Career button clicked"));

    if (usernameInput && username) usernameInput.value = username;

    // ---------- SIGN UP handler ----------
    if (signupBtn) {
        signupBtn.addEventListener("click", async() => {
            setAuthMessage("");
            const rawUsername = usernameInput.value.trim();
            const password = passwordInput.value;

            // Device ban quick-check (sync) and DB re-check
            if (deviceBanned) {
                setAuthMessage("This device is banned.", true);
                return;
            }
            try {
                const freshlyBanned = await checkDeviceBanFromDB();
                if (freshlyBanned) {
                    deviceBanned = true;
                    setAuthMessage("This device is banned.", true);
                    try { await Swal.fire('Banned', 'Your device has been banned. You cannot create accounts.', 'error'); } catch (e) {}
                    disableUIControls();
                    return;
                }
            } catch (e) {
                console.warn("Signup pre-check for ban failed (continuing):", e);
            }

            if (!rawUsername || !password) {
                return setAuthMessage("Please enter both a username and a password.");
            }
            if (password.length < 5) {
                return setAuthMessage("Password must be at least 5 characters long.");
            }
            if (rawUsername.length < 3 || rawUsername.length > 16) {
                return setAuthMessage("Username must be between 3 and 16 characters long.");
            }
            if (!isMessageClean(rawUsername) || !/^[A-Za-z0-9_]+$/.test(rawUsername)) {
                return setAuthMessage("Username invalid (A–Z, 0–9, _ only).");
            }

            const user = auth.currentUser;
            if (!user) {
                console.error("signupBtn: No authenticated user.");
                return setAuthMessage("Authentication not ready. Try again in a moment.");
            }
            const uid = user.uid;
            const key = rawUsername.toLowerCase();

            try {
                setAuthMessage("Creating account...", false);

                const txResult = await usernamesRef.child(key).transaction(current => {
                    if (current === null || current === uid) return uid;
                    return;
                });

                if (!txResult.committed) {
                    setAuthMessage(`“${rawUsername}” is already in use.`, true);
                    return;
                }

                const passwordToStore = await hashPassword(password);

                const updates = {};
                updates[`users/${key}/username`] = rawUsername;
                updates[`users/${key}/password`] = passwordToStore;
                updates[`users/${key}/savedAt`] = firebase.database.ServerValue.TIMESTAMP;
                updates[`users/${key}/version`] = CLIENT_GAME_VERSION;
                updates[`users/${key}/ids/${uid}`] = true;

                await db.ref().update(updates);

                if (onlineUsersRef) {
                    try {
                        await updateOnlinePresence(uid, rawUsername);
                    } catch (e) {
                        console.warn("signupBtn: onlineUsers update failed:", e);
                    }
                }

                localStorage.setItem("username", rawUsername);
                username = rawUsername;
                setAuthMessage("Account created — signed in.", false);
                try { playerCard?.setText?.(username); } catch (e) {}

                // record seen username (local only) and annotate user with device id
                try { await recordSeenUsername(rawUsername); } catch (e) {}
                try { await addDeviceIdToUser(rawUsername); } catch (e) {}

                await initializeMenuDisplay();

            } catch (err) {
                console.error("signupBtn: Error during signup:", err);

                try {
                    const claimedSnap = await usernamesRef.child(key).once('value');
                    if (claimedSnap.exists() && claimedSnap.val() === auth.currentUser.uid) {
                        await usernamesRef.child(key).remove();
                        console.log("signupBtn: rolled back username reservation.");
                    }
                } catch (rollbackErr) {
                    console.error("signupBtn: rollback failed:", rollbackErr);
                }

                switch (err.code) {
                    case "PERMISSION_DENIED":
                        setAuthMessage("Signup failed due to server permissions. Please try again later.", true);
                        break;
                    case "NETWORK_ERROR":
                        setAuthMessage("A network error occurred. Please check your connection and try again.", true);
                        break;
                    case "STORAGE_BUCKET_UNAVAILABLE":
                        setAuthMessage("Server is currently unavailable. Please try again later.", true);
                        break;
                    default:
                        setAuthMessage("Could not create account. Please try again.", true);
                        break;
                }
            }
        });
    }

    // ---------- LOG IN handler ----------
    if (loginBtn) {
        loginBtn.addEventListener("click", async() => {
            setAuthMessage("");
            const rawUsername = usernameInput.value.trim();
            const password = passwordInput.value;

            // Device ban quick-check (sync) and DB re-check
            if (deviceBanned) {
                setAuthMessage("This device is banned.", true);
                return;
            }
            try {
                const freshlyBanned = await checkDeviceBanFromDB();
                if (freshlyBanned) {
                    deviceBanned = true;
                    setAuthMessage("This device is banned.", true);
                    try { await Swal.fire('Banned', 'Your device has been banned. You cannot sign into accounts.', 'error'); } catch (e) {}
                    disableUIControls();
                    return;
                }
            } catch (e) {
                console.warn("Login pre-check for ban failed (continuing):", e);
            }

            if (!rawUsername || !password) {
                return setAuthMessage("Please enter both a username and a password.");
            }
            if (!isMessageClean(rawUsername)) {
                return setAuthMessage("Username contains disallowed text.");
            }

            const user = auth.currentUser;
            if (!user) {
                console.error("loginBtn: No authenticated user.");
                return setAuthMessage("Authentication not ready. Try again shortly.");
            }
            const uid = user.uid;
            const key = rawUsername.toLowerCase();

            try {
                setAuthMessage("Verifying credentials...", false);
                const userSnap = await usersRef.child(key).once("value");
                if (!userSnap.exists()) {
                    setAuthMessage("No account found with that username.", true);
                    return;
                }

                const storedPassword = userSnap.child("password").val();
                const attemptedHash = await hashPassword(password);
                if (String(storedPassword) !== String(attemptedHash)) {
                    setAuthMessage("Incorrect password.", true);
                    return;
                }

                await usersRef.child(key).child('ids').child(uid).set(true);

                const txResult = await usernamesRef.child(key).transaction(current => {
                    if (current === null || current === uid) return uid;
                    return;
                });

                if (!txResult.committed) {
                    console.warn(`loginBtn: username index for ${key} owned by different UID; leaving it unchanged.`);
                }

                if (onlineUsersRef) {
                    try {
                        await updateOnlinePresence(uid, rawUsername);
                    } catch (e) {
                        console.warn("loginBtn: onlineUsers update failed:", e);
                    }
                }

                localStorage.setItem("username", rawUsername);
                username = rawUsername;
                setAuthMessage("Logged in successfully.", false);
                try { playerCard?.setText?.(username); } catch (e) {}

                // record seen username (local only) and annotate user with device id
                try { await recordSeenUsername(rawUsername); } catch (e) {}
                try { await addDeviceIdToUser(rawUsername); } catch (e) {}

                await initializeMenuDisplay();

            } catch (err) {
                console.error("loginBtn: Error during login:", err);
                setAuthMessage("Could not log in. Try again later.", true);
            }
        });
    }

    if (toggleDetailsBtn) {
        toggleDetailsBtn.textContent = currentDetailsEnabled ? "Details: On" : "Details: Off";
        toggleDetailsBtn.addEventListener("click", () => {
            currentDetailsEnabled = !currentDetailsEnabled;
            localStorage.setItem("detailsEnabled", currentDetailsEnabled.toString());
            toggleDetailsBtn.textContent = currentDetailsEnabled ? "Details: On" : "Details: Off";
            if (typeof toggleSceneDetails === "function") toggleSceneDetails(currentDetailsEnabled);
        });
    }

    mapButtons.forEach(btn => {
        btn.addEventListener("click", async () => {
            // Device ban check
            if (deviceBanned) {
                return Swal.fire('Banned', 'This device is banned and cannot start games.', 'error');
            }
            try {
                const freshlyBanned = await checkDeviceBanFromDB();
                if (freshlyBanned) {
                    deviceBanned = true;
                    disableUIControls();
                    return Swal.fire('Banned', 'This device is banned and cannot start games.', 'error');
                }
            } catch (e) {
                console.warn("map button ban re-check failed (allowing attempt):", e);
            }

            // Capacity guard
            try {
                const currentOnline = await countActiveOnline();
                if (currentOnline >= MAX_ONLINE) {
                    return Swal.fire('Server Busy', `There are currently ${currentOnline} players online. Please try again later.`, 'info');
                }
            } catch (e) {
                console.warn("map button capacity check failed, allowing attempt:", e);
            }

            let user;
            try {
                user = (() => {
                    const u = localStorage.getItem("username");
                    if (!u || !u.trim()) {
                        showPanel(usernamePrompt);
                        throw new Error("Username required");
                    }
                    return u;
                })();
            } catch {
                return Swal.fire('Warning', 'Please enter your username before starting a game!', 'warning');
            }

            const mapName = btn.dataset.map;
            localStorage.setItem("detailsEnabled", currentDetailsEnabled.toString());

            if (menuOverlay) menuOverlay.classList.add("hidden");
            if (typeof canvas !== "undefined" && canvas) canvas.style.display = 'none';

            const wrapper = document.getElementById('game-container');
            if (wrapper) {
                let ffaEnabled = true;
                if (typeof menuSong !== "undefined" && menuSong && typeof menuSong.pause === "function") {
                    try {
                        menuSong.pause();
                    } catch (e) {}
                }
                wrapper.style.display = 'block';
                if (typeof createGameUI === "function") createGameUI(wrapper);
                console.log(`mapButton: Game initialized for ${user} on map ${mapName}`);
            } else {
                console.error("mapButton: game-container element not found!");
            }
        });
    });

    // initialize banned listener early (so live enforcement is active)
    attachBannedListener().catch(e => console.warn("attachBannedListener failed:", e));

    // Do an initial banned read (fast) that will block if already banned
    try {
        await ensureDeviceFingerprint();
        const initiallyBanned = await checkDeviceBanFromDB();
        if (initiallyBanned) {
            deviceBanned = true;
            try {
                const bannedRoot = deriveBannedRootRef();
                if (bannedRoot && deviceFingerprintHash) {
                    const snap = await bannedRoot.child(deviceFingerprintHash).once('value');
                    const v = snap.exists() ? (snap.val() || {}) : {};
                    const reason = (v && typeof v === 'object' && v.reason) ? v.reason : (typeof v === 'string' ? v : "This device has been banned from the service.");
                    await Swal.fire({
                        title: 'Banned Device',
                        html: `<div style="text-align:left; font-size:14px; max-width:420px;">${reason}<br><br>If you believe this is a mistake, contact an administrator.</div>`,
                        icon: 'error',
                        confirmButtonText: 'OK'
                    });
                } else {
                    await Swal.fire('Banned Device', 'This device has been banned from the service.', 'error');
                }
            } catch (e) { /* ignore modal failures */ }

            disableUIControls();
            setAuthMessage("This device is banned from using this service.", true);
            return;
        }
    } catch (e) {
        console.warn("Initial banned read failed (continuing):", e);
    }

    // finally initialize display and host watcher
    initializeMenuDisplay()
        .then(() => {
            initHostWatcherForAllSlots().catch(e => console.warn("initHostWatcherForAllSlots failed:", e));
        })
        .catch(e => {
            console.warn("initializeMenuDisplay failed:", e);
            initHostWatcherForAllSlots().catch(err => console.warn("initHostWatcherForAllSlots failed:", err));
        });
} // end initMenuUI






// --- Main execution logic ---
document.addEventListener('DOMContentLoaded', () => {
  const stored = localStorage.getItem('gameWinner');
  if (stored) {
    try {
      const { winners, kills } = JSON.parse(stored);
      const title = winners.length > 1 ? 'GAME OVER! Multiple Winners!' : 'GAME OVER!';
      const names = winners.join(', ');
      Swal.fire({
        title,
        html: winners.length > 1
          ? `The winners are <strong>${names}</strong> with <strong>${kills}</strong> kills each!`
          : `The winner is <strong>${names}</strong> with <strong>${kills}</strong> kills!`,
        icon: 'success',
        confirmButtonText: 'Play Again',
        allowOutsideClick: false,
        allowEscapeKey: false
      }).then(result => {
        if (result.isConfirmed) {
          console.log("SweetAlert: User confirmed, proceeding to menu.");
       //   gamesButtonHit();
        }
      });
    } catch (e) {
      console.error("SweetAlert: Error parsing stored winner:", e);
    } finally {
      localStorage.removeItem('gameWinner');
      localStorage.removeItem('gameEndedTimestamp');
    }
  }

  if (window.location.pathname.endsWith('index.html') || window.location.pathname === '/') {
    initMenuUI();
  } else {
    const gameWrapper = document.getElementById('game-container');
    if (gameWrapper) {
      createGameUI(gameWrapper);
      const username = localStorage.getItem("username") || "Guest";
      const params = new URLSearchParams(window.location.search);
      const mapName = params.get('map');
      const gameId  = params.get('gameId');
      if (mapName && gameId) {
        console.log(`Auto-joining game: Map=${mapName}, GameID=${gameId}`);
      } else if (mapName) {
        console.log(`Auto-starting game: Map=${mapName}`);
      } else {
        console.warn("No map or game ID in URL; falling back to menu.");
        menu();
      }
    } else {
      console.error("game-container element not found!");
      menu();
    }
  }
});

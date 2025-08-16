// js/cs2_logic.js
import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";
export const RECOIL_PATTERN = {
"ak-47": [
  0.003, 0.006, 0.010, 0.014, 0.016, 0.018, 0.018, 0.018, 0.018,
  0.018, 0.018, 0.018, 0.018, 0.018, 0.018, 0.018, 0.018, 0.018,
  0.018, 0.018, 0.018, 0.018, 0.018, 0.018, 0.018,
],
"viper": [
  0.0048, 0.008, 0.0112, 0.0144, 0.0176, 0.02, 0.02, 0.02,
  0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02,
  0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02,
  0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02,
  0.02, 0.02, 0.02, 0.02, 0.02
],
  deagle: [0.025],
  marshal: [0.055],
  legion: [0.055],
  m79: [0.010],
};

export const ADS_FOV = {
  default: 75,
  deagle: 50,
  ak47: 60,
  viper: 65,
  marshal: 10,
  legion: 30,
  m79: 70,
};

/**
 * Calculates the half-angle (in radians) of the spread cone for a given weapon and state.
 * For AK-47, the spread progressively increases with each shot, following its recoil pattern.
 * f
 * @param {string} weaponKey
 * @param {THREE.Vector3} velocity       – full horizontal movement vector
 * @param {boolean} isCrouched
 * @param {boolean} isAiming
 * @param {boolean} isGrounded
 * @param {number} shotIndex            – current shot number in a burst/sequence (0-indexed)
 * @returns {number} half-angle (in radians) of spread cone
 */
export function getSpreadMultiplier(
  weaponKey,
  velocity,
  isCrouched,
  isAiming,
  isGrounded,
  shotIndex = 0
) {
  const isAirborne = !isGrounded;
  const speed = velocity.length();

  // Weapon-specific spread values
  let standingBase, runBase, airBase, crouchFactor, runThreshold, aimFactor;
  switch (weaponKey) {
    case "ak-47":
      standingBase = 0.01; runBase = 0.1; airBase = 0.15;
      crouchFactor = 0.1; runThreshold = 4; aimFactor = 0.25;
      break;
    case "viper":
      standingBase = 0.035; runBase = 0.1; airBase = 0.15;
      crouchFactor = 0.3; runThreshold = 4; aimFactor = 0.55;
      break;
    case "deagle":
      standingBase = 0.01; runBase = 0.1; airBase = 0.15;
      crouchFactor = 0.50; runThreshold = 4; aimFactor = 0.25;
      break;
    case "marshal":
      standingBase = 0.1; runBase = 0.15; airBase = 0.2;
      crouchFactor = 0.40; runThreshold = 4; aimFactor = 0.01;
      break;
    case "legion":
      standingBase = 0.05; runBase = 0.1; airBase = 0.15;
      crouchFactor = 0.50; runThreshold = 4; aimFactor = 0.25;
      break;
    case "m79":
      standingBase = 0.05; runBase = 0.1; airBase = 0.15;
      crouchFactor = 0.50; runThreshold = 4; aimFactor = 0.25;
      break;
    case "mp5":
      standingBase = 0.3; runBase = 1; airBase = 1.1;
      crouchFactor = 0.50; runThreshold = 4; aimFactor = 0.25;
      break;
    case "sniper":
      standingBase = 0.2; runBase = 1; airBase = 0.15;
      crouchFactor = 0.40; runThreshold = 4; aimFactor = 0.00001;
      break;
    default:
      standingBase = 0.02; runBase = 0.1; airBase = 0.15;
      crouchFactor = 0.50; runThreshold = 4; aimFactor = 0.25;
  }

  // ✅ Override spread if airborne — for all weapons except marshal
  if (isAirborne && weaponKey !== "marshal") {
    return airBase;
  }

  // Standard grounded/movement-based spread logic
  let currentSpreadAngle;
  if (speed <= 3) {
    currentSpreadAngle = standingBase;
  } else if (speed > runThreshold) {
    currentSpreadAngle = runBase;
  } else {
    const t = Math.min(speed / runThreshold, 1);
    currentSpreadAngle = standingBase * (1 - t) + runBase * t;
  }

  // Apply crouch and aim modifiers
  if (isCrouched) currentSpreadAngle *= crouchFactor;
  if (isAiming) currentSpreadAngle *= aimFactor;

  // Recoil pattern (AK-47 only)
  if (weaponKey === "ak-47") {
    const recoilPatternValue = getRecoilAngle(weaponKey, shotIndex);
    currentSpreadAngle += recoilPatternValue * 1;
  }

  if (weaponKey === "viper") {
    const recoilPatternValue = getRecoilAngle(weaponKey, shotIndex);
    currentSpreadAngle += recoilPatternValue * 1;
  }

  return currentSpreadAngle;
}

/**
 * @param {number} spreadAngle
 * @param {THREE.Camera} camera
 * @returns {THREE.Vector3}
 */
export function getSpreadDirection(spreadAngle, camera) {
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward).normalize();
  if (spreadAngle === 0) return forward;
  const up = camera.up.clone().normalize();
  const right = new THREE.Vector3().crossVectors(forward, up).normalize();
  const yawOff = (Math.random() * 2 - 1) * spreadAngle;
  return forward.clone()
    .add(right.multiplyScalar(Math.tan(yawOff)))
    .normalize();
}

/**
 * @param {string} weaponKey
 * @param {number} shotIndex
 * @returns {number}
 */
export function getRecoilAngle(weaponKey, shotIndex) {
  const pattern = RECOIL_PATTERN[weaponKey];
  if (!pattern) return 0;
  // Ensure we don't go out of bounds of the pattern array
  return pattern[Math.min(shotIndex, pattern.length - 1)];
}

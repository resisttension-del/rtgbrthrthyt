

import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { sendSoundEvent } from "./network.js"; // Assuming this path is correct

// Constants for player physics and dimensions ff
const PLAYER_MASS = 70;
const GRAVITY = 27.5; // Gravity strength
const JUMP_VELOCITY = 12.3; // Initial upward velocity for jumps

const STEP_HEIGHT = 1; // Maximum height the player can step up
const STEP_FORWARD_OFFSET = 0.12; // How far in front of the player to check for a step
const STEP_FORWARD_PUSH = 0.001;

const MAX_SLOPE_ANGLE = 45 * (Math.PI / 180);
const WALKABLE_DOT    = Math.cos(MAX_SLOPE_ANGLE);

// Player capsule dimensions (matching the provided example's player setup)
const PLAYER_CAPSULE_RADIUS = 0.5;
const PLAYER_CAPSULE_SEGMENT_LENGTH = 2.2 - PLAYER_CAPSULE_RADIUS; // Length of the cylindrical part of the capsule
const PLAYER_TOTAL_HEIGHT = PLAYER_CAPSULE_SEGMENT_LENGTH + 2 * PLAYER_CAPSULE_RADIUS; // Total height of the standing player (2.0)
const PLAYER_CROUCH_HEIGHT = 1.62;

// NEW: Constants for controlled movement and crouching
const PLAYER_ACCEL_GROUND = 3; // How quickly player reaches max speed on ground
const PLAYER_DECEL_GROUND = 5; // How quickly player stops on ground (faster than accel)
const PLAYER_ACCEL_AIR = 1;    // How quickly player reaches max speed in air (slower)
const PLAYER_DECEL_AIR = 3;      // How quickly player stops in air (slower than ground decel)
const CROUCH_HEIGHT_RATIO = 0.6; // Player height when crouched (e.g., 60% of original)
const CROUCH_SPEED = 8;          // Speed at which player crouches/stands

const MAX_SPEED = 10; // Maximum horizontal speed, now directly used for movement
const AIR_TURN_RATE = 180 * (Math.PI / 180);


const FOOT_DISABLED_THRESHOLD = 0.2; // Speed threshold below which footsteps stop

// Physics Sub-stepping Constants
const FIXED_TIME_STEP = 1 / 90; // Fixed time step for physics updates (e.g., 90 FPS physics)
const MAX_PHYSICS_STEPS = 5;    // Maximum number of physics steps per frame to prevent "spiral of death"


function round2(n) {
  return Math.round(n * 100) / 100;
}
// seamless audio-loop helper (UNCHANGED)
function createSeamlessLoop(src, leadTimeMs = 50, volume = 1) {
    let timerId = null, currentAudio = null;
    function scheduleNext() {
        const durationMs = currentAudio.duration * 1000;
        const delay = Math.max(durationMs - leadTimeMs, 0);
        timerId = setTimeout(() => {
            if (currentAudio) currentAudio.removeEventListener('ended', scheduleNext);
            currentAudio = new Audio(src);
            currentAudio.volume = volume;
            currentAudio.addEventListener('ended', scheduleNext);
            currentAudio.play().catch(() => { });
        }, delay);
    }
    return {
        start() {
            this.stop();
            currentAudio = new Audio(src);
            currentAudio.volume = volume;
            currentAudio.addEventListener('ended', scheduleNext);
            currentAudio.play().catch(() => { }).then(scheduleNext).catch(() => { });
        },
        stop() {
            clearTimeout(timerId);
            timerId = null;
            if (currentAudio) {
                currentAudio.pause();
                currentAudio.currentTime = 0;
                currentAudio.removeEventListener('ended', scheduleNext);
                currentAudio = null;
            }
        }
    };
}

export class PhysicsController {
    constructor(camera, scene) {
        this.camera = camera;
        this.scene = scene;

        // Player mesh and capsule information
        this.player = new THREE.Mesh(
            new RoundedBoxGeometry(
                PLAYER_CAPSULE_RADIUS * 2,
                PLAYER_TOTAL_HEIGHT,
                PLAYER_CAPSULE_RADIUS * 2,
                10,
                PLAYER_CAPSULE_RADIUS
            ),
            new THREE.MeshStandardMaterial()
        );
        this.player.geometry.translate(0, -PLAYER_CAPSULE_RADIUS, 0);
        this.player.capsuleInfo = {
            radius: PLAYER_CAPSULE_RADIUS,
            segment: new THREE.Line3(
                new THREE.Vector3(0, 0, 0),
                new THREE.Vector3(0, -PLAYER_CAPSULE_SEGMENT_LENGTH, 0)
            )
        };
        this.player.castShadow = true;
        this.player.receiveShadow = true;
        this.player.material.shadowSide = 2;

        // Physics state
        this.playerVelocity = new THREE.Vector3();
        this.isGrounded = false;

        // Crouch state
        this.isCrouching = false;
        this.targetPlayerHeight = PLAYER_TOTAL_HEIGHT;
        this.originalCapsuleSegmentLength = PLAYER_CAPSULE_SEGMENT_LENGTH;
        this.originalCapsuleRadius = PLAYER_CAPSULE_RADIUS;

        // Helpers
        this.upVector = new THREE.Vector3(0, 1, 0);
        this.tempVector = new THREE.Vector3();
        this.tempVector2 = new THREE.Vector3();
        this.tempBox = new THREE.Box3();
        this.tempMat = new THREE.Matrix4();
        this.tempSegment = new THREE.Line3();
        this.colliderMatrixWorldInverse = new THREE.Matrix4();

        // Sub-stepping
        this.accumulator = 0;

        // Collider (set later)
        this.collider = null;

        // Camera/input state
        this.mouseTime = 0;
        this.camera.rotation.order = 'YXZ';

        // Footstep audio
        this.footAudios = [
            new Audio("https://codehs.com/uploads/29c8a5da333b3fd36dc9681a4a8ec865"),
            new Audio("https://codehs.com/uploads/616ef1b61061008f9993d1ab4fa323ba")
        ];
        this.footAudios.forEach(a => a.volume = 0.7);
        this.footIndex = 0;
        this.footAcc = 0;
        this.baseFootInterval = 4;

        // Landing audio
        this.landAudio = new Audio("https://codehs.com/uploads/600ab769d99d74647db55a468b19761f");
        this.landAudio.volume = 0.8;
        this.fallStartY = null;
        this.prevPlayerIsOnGround = false;
        this.jumpTriggered = false;
        this.fallDelay = 300;
        this.fallStartTimer = null;

        // Movement modifiers
        this.speedModifier = 0;
        this.isAim = false;
        this._lastAirYaw = this.camera.rotation.y;

        // —— NEW: stuck-in-air detection fields —— 
        this._lastY = null;
        this._yStuckTimer = 0;
    }

    /**
     * Sets the MeshBVH collider for collision detection. This is called by map.js.
     * @param {THREE.Mesh} colliderMesh The mesh with the computed MeshBVH boundsTree.
     */
    setCollider(colliderMesh) {
        this.collider = colliderMesh;
        this.colliderMatrixWorldInverse.copy(this.collider.matrixWorld).invert(); // Cache inverse matrix
        console.log("MeshBVH collider set in PhysicsController.");
    }

    /**
     * Sets the speed modifier for player movement.
     * @param {number} value The speed modifier value.
     */
    setSpeedModifier(value) {
        this.speedModifier = value;
    }

    /**
     * Gets the forward vector based on the camera's direction, flattened to the XZ plane.
     * @returns {THREE.Vector3} The normalized forward vector.
     */
    getForwardVector() {
        this.camera.getWorldDirection(this.tempVector);
        this.tempVector.y = 0;
        this.tempVector.normalize();
        return this.tempVector;
    }

    /**
     * Gets the side (right) vector based on the camera's direction, flattened to the XZ plane.
     * @returns {THREE.Vector3} The normalized side vector.
     */
    getSideVector() {
        this.camera.getWorldDirection(this.tempVector);
        this.tempVector.y = 0;
        this.tempVector.normalize();
        this.tempVector.cross(this.upVector); // Cross with world up to get side vector
        return this.tempVector;
    }

    /**
     * Handles player input and updates player velocity.
     * @param {number} deltaTime The time elapsed since the last frame.
     * @param {object} input An object containing input states (e.g., forward, backward, jump, crouch, slow, aim).
     */
_applyControls(deltaTime, input) {
    // Calculate desired movement speed based on MAX_SPEED and modifiers
    const baseSpeed = MAX_SPEED;
    const currentMoveSpeed = baseSpeed * this.speedModifier * (input.crouch ? 0.3 : input.slow ? 0.5 : this.isAim ? 0.65 : 1);

    const moveDirection = new THREE.Vector3();
    if (input.forward) {
        moveDirection.add(this.getForwardVector());
    }
    if (input.backward) {
        moveDirection.add(this.getForwardVector().multiplyScalar(-1));
    }
    if (input.left) {
        moveDirection.add(this.getSideVector().multiplyScalar(-1));
    }
    if (input.right) {
        moveDirection.add(this.getSideVector());
    }

    // Normalize the movement direction if there's input
    if (moveDirection.lengthSq() > 0) {
        moveDirection.normalize();
    }

    // Calculate the target horizontal velocity
    const targetVelocityX = moveDirection.x * currentMoveSpeed;
    const targetVelocityZ = moveDirection.z * currentMoveSpeed;

    // Determine acceleration/deceleration rate based on grounded state and input
    let accelRateX, accelRateZ;

    if (this.isGrounded) {
        accelRateX = input.forward || input.backward || input.left || input.right ? PLAYER_ACCEL_GROUND : PLAYER_DECEL_GROUND;
        accelRateZ = input.forward || input.backward || input.left || input.right ? PLAYER_ACCEL_GROUND : PLAYER_DECEL_GROUND;
    } else {
        accelRateX = input.forward || input.backward || input.left || input.right ? PLAYER_ACCEL_AIR : PLAYER_DECEL_AIR;
        accelRateZ = input.forward || input.backward || input.left || input.right ? PLAYER_ACCEL_AIR : PLAYER_DECEL_AIR;
    }

    if (!this.isGrounded) {
        this.input = input;
        this._applyAirControl(deltaTime);
    }

    // Apply acceleration/deceleration to horizontal velocity components
    this.playerVelocity.x = THREE.MathUtils.lerp(this.playerVelocity.x, targetVelocityX, accelRateX * deltaTime);
    this.playerVelocity.z = THREE.MathUtils.lerp(this.playerVelocity.z, targetVelocityZ, accelRateZ * deltaTime);

    // Handle jumping
    if (this.isGrounded && input.jump) {
        this.playerVelocity.y = JUMP_VELOCITY; // Apply upward jump velocity
        this.isGrounded = false; // Player is no longer on the ground
        this.jumpTriggered = true; // Set jump flag
    }

    // Crouching logic
    const currentCrouchHeight = PLAYER_TOTAL_HEIGHT * CROUCH_HEIGHT_RATIO;
    const standingHeight = PLAYER_TOTAL_HEIGHT;

    // Determine target height based on input and ceiling check
    if (input.crouch) {
        this.isCrouching = true;
        this.targetPlayerHeight = currentCrouchHeight;
    } else {
        // Player wants to uncrouch, but we must check for a ceiling
        if (this._canUncrouch()) {
            this.isCrouching = false;
            this.targetPlayerHeight = standingHeight;
        } else {
            // If there's a ceiling, stay crouched
            this.isCrouching = true;
            this.targetPlayerHeight = currentCrouchHeight;
        }
    }
}

_applyAirControl(dt) {
  // 1) How much has the camera yaw changed this step?
  let yawNow = this.camera.rotation.y;
  let deltaYaw = yawNow - this._lastAirYaw;

  // Normalize to [-π, +π]
  deltaYaw = ((deltaYaw + Math.PI) % (2*Math.PI)) - Math.PI;

  // 2) Clamp by your max turn rate
  const maxYaw = AIR_TURN_RATE * dt;       // radians allowed this frame
  const appliedYaw = Math.sign(deltaYaw) * Math.min(Math.abs(deltaYaw), maxYaw);
  if (appliedYaw === 0) return;            // no turning

  // 3) Build a quaternion around world‑up
  const q = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0,1,0),
    appliedYaw
  );

  // 4) Rotate _only_ the horizontal part of your velocity
  const v = this.playerVelocity;
  const horizontal = new THREE.Vector3(v.x, 0, v.z).applyQuaternion(q);
  v.x = horizontal.x;
  v.z = horizontal.z;
  // leave v.y untouched
}

    /**
     * Checks if the player can stand up without hitting a ceiling.
     * @param {number} checkHeight The height to check for a ceiling.
     * @returns {boolean} True if the player can stand up, false otherwise.
     */
    _checkCeilingCollision(checkHeight) {
        if (!this.collider || !this.collider.geometry || !this.collider.geometry.boundsTree) {
            return true; // If no collider, assume no ceiling
        }

        const currentRadius = this.player.capsuleInfo.radius;
        // Calculate the segment of the capsule at the target standing height
        // This is relative to the player's current position (which is the top of the capsule)
        const segmentStart = new THREE.Vector3(0, 0, 0); // Top of the capsule
        const segmentEnd = new THREE.Vector3(0, -(checkHeight - 2 * currentRadius), 0); // Bottom of cylinder

        this.tempSegment.copy(new THREE.Line3(segmentStart, segmentEnd));
        this.tempSegment.start.add(this.player.position);
        this.tempSegment.end.add(this.player.position);

        // Transform the temporary standing segment into the collider's local space
        this.tempSegment.start.applyMatrix4(this.colliderMatrixWorldInverse);
        this.tempSegment.end.applyMatrix4(this.colliderMatrixWorldInverse);

        this.tempBox.makeEmpty();
        this.tempBox.expandByPoint(this.tempSegment.start);
        this.tempBox.expandByPoint(this.tempSegment.end);
        this.tempBox.min.addScalar(-currentRadius);
        this.tempBox.max.addScalar(currentRadius);

        let hitCeiling = false;
        this.collider.geometry.boundsTree.shapecast({
            intersectsBounds: box => box.intersectsBox(this.tempBox),
            intersectsTriangle: tri => {
                const triPoint = this.tempVector;
                const capsulePoint = this.tempVector2;
                const distance = tri.closestPointToSegment(this.tempSegment, triPoint, capsulePoint);
                if (distance < currentRadius) {
                    // Check if the collision is above the player (a ceiling)
                    const normal = tri.getNormal(new THREE.Vector3());
                    // Dot product with upVector to see if normal points mostly downwards (ceiling)
                    if (normal.dot(this.upVector) < -0.1) {
                        hitCeiling = true;
                        return true; // Stop iterating
                    }
                }
                return false;
            }
        });
        return !hitCeiling; // Return true if no ceiling was hit
    }

    _canUncrouch() {
    // If not crouching, we don't need to check.
    if (!this.isCrouching) {
        return true;
    }

    const standingHeight = PLAYER_TOTAL_HEIGHT;
    const crouchHeight = PLAYER_CROUCH_HEIGHT;
    const currentRadius = this.player.capsuleInfo.radius * this.player.scale.y;

    // The top of the capsule's standing position
    // Starting from the center of the crouching capsule, add half the standing height.
    // This gets the top point of the *potential* standing capsule.
    const standingCenterOffset = (standingHeight - crouchHeight) / 2;
    const targetTopPosition = this.player.position.clone().add(new THREE.Vector3(0, standingCenterOffset, 0));

    // The segment for the full-height capsule.
    // Segment start is the top of the full standing capsule.
    const segmentStart = targetTopPosition.clone().add(new THREE.Vector3(0, standingHeight / 2 - currentRadius, 0));
    // Segment end is the bottom of the full standing capsule.
    const segmentEnd = targetTopPosition.clone().sub(new THREE.Vector3(0, standingHeight / 2 - currentRadius, 0));

    this.tempSegment.copy(new THREE.Line3(segmentStart, segmentEnd));

    // Transform the temporary standing segment into the collider's local space
    this.tempSegment.start.applyMatrix4(this.colliderMatrixWorldInverse);
    this.tempSegment.end.applyMatrix4(this.colliderMatrixWorldInverse);

    this.tempBox.makeEmpty();
    this.tempBox.expandByPoint(this.tempSegment.start);
    this.tempBox.expandByPoint(this.tempSegment.end);
    this.tempBox.min.addScalar(-currentRadius);
    this.tempBox.max.addScalar(currentRadius);

    let hitCeiling = false;
    if (this.collider && this.collider.geometry && this.collider.geometry.boundsTree) {
        this.collider.geometry.boundsTree.shapecast({
            intersectsBounds: box => box.intersectsBox(this.tempBox),
            intersectsTriangle: tri => {
                const triPoint = this.tempVector;
                const capsulePoint = this.tempVector2;
                const distance = tri.closestPointToSegment(this.tempSegment, triPoint, capsulePoint);
                if (distance < currentRadius) {
                    // A collision was found.
                    // We can stop searching and assume there's a ceiling.
                    hitCeiling = true;
                    return true; // Stop iterating
                }
                return false;
            }
        });
    }
    return !hitCeiling;
}

_stepUpIfPossible() {
    if (!this.collider) return;
    if (this.playerVelocity.y > 0.1) return;

    // 1) Find true ground Y under the player
    const playerHeight = PLAYER_TOTAL_HEIGHT * this.player.scale.y;
    const downRay = new THREE.Raycaster(
        this.player.position.clone(),
        new THREE.Vector3(0, -1, 0),
        0,
        playerHeight + 0.2
    );
    const groundHits = downRay.intersectObject(this.collider, true);
    const actualGroundY = groundHits.length
        ? groundHits[0].point.y
        : this.player.position.y - playerHeight;

    // 2) Try to step up if moving into a small obstacle
    const horizVel = new THREE.Vector3(this.playerVelocity.x, 0, this.playerVelocity.z);
    if (horizVel.lengthSq() >= 0.1 * 0.1) {
        const dir = horizVel.normalize();
        const capsuleRadius = this.player.capsuleInfo.radius * this.player.scale.y;

        const forwardOrigin = this.player.position.clone()
            .setY(actualGroundY + STEP_HEIGHT + 0.05)
            .add(dir.clone().multiplyScalar(capsuleRadius + STEP_FORWARD_OFFSET));

        const stepRay = new THREE.Raycaster(
            forwardOrigin,
            new THREE.Vector3(0, -1, 0),
            0,
            STEP_HEIGHT + 0.3
        );
        const stepHits = stepRay.intersectObject(this.collider, true);

        if (stepHits.length) {
            const stepTopY = stepHits[0].point.y;
            const deltaY = stepTopY - actualGroundY;

            if (
                deltaY > 0.05 &&
                deltaY <= STEP_HEIGHT + 0.01 &&
                stepTopY >= this.player.position.y - PLAYER_TOTAL_HEIGHT + 0.5
            ) {
                // Check we have headroom
                const headCheck = new THREE.Raycaster(
                    new THREE.Vector3(this.player.position.x, stepTopY + playerHeight + 0.02, this.player.position.z),
                    new THREE.Vector3(0, 1, 0),
                    0,
                    0.1
                );
                if (headCheck.intersectObject(this.collider, true).length === 0) {
                    // Snap up onto the step
                    this.player.position.y = stepTopY + playerHeight - 0.51;
                    this.playerVelocity.y = 0;
                    this.isGrounded = true;
                    this.player.position.add(dir.multiplyScalar(STEP_FORWARD_PUSH));
                    return;
                }
            }
        }
    }
}

    
_updatePlayerPhysics(delta) {
    this._stepUpIfPossible();
    // Store previous grounded state and reset for this frame
    const wasGrounded = this.isGrounded;
    this.isGrounded = false;

    // Apply gravity or small downward snap
    if (wasGrounded) {
        this.playerVelocity.y = -GRAVITY * delta * 0.1;
    } else {
        this.playerVelocity.y -= GRAVITY * delta;
    }

    // Cap horizontal speed as a safety
    const horiz = Math.hypot(this.playerVelocity.x, this.playerVelocity.z);
    const maxHoriz = MAX_SPEED * this.speedModifier;
    if (horiz > maxHoriz) {
        const scale = maxHoriz / horiz;
        this.playerVelocity.x *= scale;
        this.playerVelocity.z *= scale;
    }

    // Smoothly adjust player height for crouching
    const currentScaleY = this.player.scale.y;
    const targetScaleY = this.targetPlayerHeight / PLAYER_TOTAL_HEIGHT;
    if (Math.abs(currentScaleY - targetScaleY) > 0.001) {
        const newScaleY = THREE.MathUtils.lerp(currentScaleY, targetScaleY, CROUCH_SPEED * delta);
        const oldHeight = PLAYER_TOTAL_HEIGHT * currentScaleY;
        const newHeight = PLAYER_TOTAL_HEIGHT * newScaleY;
        this.player.scale.y = newScaleY;
        this.player.position.y -= (oldHeight - newHeight);
        this.player.capsuleInfo.segment.end.y = -this.originalCapsuleSegmentLength * newScaleY;
    }

    // Move the player's mesh by current velocity
    this.player.position.addScaledVector(this.playerVelocity, delta);
    this.player.updateMatrixWorld();

    // --- Collision + step-up resolution ---
    const capsuleInfo = this.player.capsuleInfo;
    const collisionRadius = capsuleInfo.radius + 0.001;

    // Build AABB around the capsule in collider-local space
    this.tempBox.makeEmpty();
    this.tempSegment.copy(capsuleInfo.segment)
        .applyMatrix4(this.player.matrixWorld)
        .applyMatrix4(this.colliderMatrixWorldInverse);
    this.tempBox.expandByPoint(this.tempSegment.start);
    this.tempBox.expandByPoint(this.tempSegment.end);
    this.tempBox.min.addScalar(-collisionRadius);
    this.tempBox.max.addScalar(collisionRadius);

    let hasCollision = false;
    let collisionNormal = new THREE.Vector3();
    let collisionPoint = new THREE.Vector3();

    // Shapecast to push out of geometry
    if (this.collider && this.collider.geometry && this.collider.geometry.boundsTree) {
        this.collider.geometry.boundsTree.shapecast({
            intersectsBounds: box => box.intersectsBox(this.tempBox),
            intersectsTriangle: tri => {
                const triPoint = this.tempVector;
                const capPoint = this.tempVector2;
                const dist = tri.closestPointToSegment(this.tempSegment, triPoint, capPoint);
                if (dist < collisionRadius) {
                    hasCollision = true;
                    const depth = collisionRadius - dist;
                    const pushDir = capPoint.sub(triPoint).normalize();
                    this.tempSegment.start.addScaledVector(pushDir, depth);
                    this.tempSegment.end.addScaledVector(pushDir, depth);
                    // Store collision normal and point for later step-up check
                    collisionNormal.copy(pushDir);
                    collisionPoint.copy(capPoint.applyMatrix4(this.collider.matrixWorld)); // World space collision point
                }
            }
        });
    } else {
        console.warn("Collider or boundsTree not available—skipping collision.");
    }

    // Compute world-space collision offset
    const newStartWorld = this.tempVector
        .copy(this.tempSegment.start)
        .applyMatrix4(this.collider.matrixWorld);
    const deltaVec = newStartWorld.sub(this.player.position);

    // Determine step/slope vs. wall
    const stepThresh = Math.abs(delta * this.playerVelocity.y * 0.25);
    const isStepOrSlope = deltaVec.y > stepThresh;

    if (hasCollision && !isStepOrSlope && this.isGrounded) { // Only attempt step-up if grounded and hitting a wall (not a slope)
        // Check for a step in front and slightly above player's feet
        const playerFeetPosition = this.player.position.clone().add(new THREE.Vector3(0, -PLAYER_TOTAL_HEIGHT / 2, 0)); // Approximate feet position
        const stepCheckOrigin = playerFeetPosition.add(this.playerVelocity.clone().setY(0).normalize().multiplyScalar(this.player.capsuleInfo.radius + STEP_FORWARD_OFFSET));
        stepCheckOrigin.y += STEP_HEIGHT + 0.01; // Check from slightly above the step height

        const raycaster = new THREE.Raycaster(stepCheckOrigin, new THREE.Vector3(0, -1, 0), 0, STEP_HEIGHT + 0.02); // Ray pointing downwards
        const intersects = raycaster.intersectObject(this.collider, true);

        if (intersects.length > 0) {
            const stepHit = intersects[0];
            const stepY = stepHit.point.y;
            const stepHeightFromFeet = stepY - (this.player.position.y - (PLAYER_TOTAL_HEIGHT / 2) + this.player.capsuleInfo.radius);

            if (stepHeightFromFeet > 0.01 && stepHeightFromFeet <= STEP_HEIGHT) { // Is it a valid step height?
                // Check wall height above the step
                const wallCheckOrigin = stepHit.point.clone();
                wallCheckOrigin.y += 0.01; // Start slightly above the step surface

                const currentStandingHeight = PLAYER_TOTAL_HEIGHT * this.player.scale.y;
                const requiredClearance = currentStandingHeight; // Need enough space for the player to stand

                const wallRaycaster = new THREE.Raycaster(wallCheckOrigin, new THREE.Vector3(0, 1, 0), 0, requiredClearance);
                const wallIntersects = wallRaycaster.intersectObject(this.collider, true);

                let wallIsClear = true;
                if (wallIntersects.length > 0) {
                    const wallHit = wallIntersects[0];
                    const wallHeight = wallHit.point.y - wallCheckOrigin.y;
                    if (wallHeight < requiredClearance) {
                        wallIsClear = false;
                    }
                }

                if (wallIsClear) {
                    // Push player up onto the step
                    // Adjust player's y position to be on top of the step.
                    // Player's position is the top of the capsule.
                    const newPlayerY = stepY + (PLAYER_TOTAL_HEIGHT / 2) - this.player.capsuleInfo.radius;
                    this.player.position.y = newPlayerY;
                    this.playerVelocity.y = 0; // Stop vertical movement
                    this.isGrounded = true; // Player is now grounded on the step
                    return; // Skip regular collision resolution as we've handled the step
                }
            }
        }
    }


    // Move by the collision offset (minus a tiny epsilon)
    const offset = Math.max(0, deltaVec.length() - 1e-5);
    deltaVec.normalize().multiplyScalar(offset);
    this.player.position.add(deltaVec);

        if (hasCollision) {
          const normalY = collisionNormal.dot(this.upVector);
        
        if (normalY >= WALKABLE_DOT && this.playerVelocity.y <= 0) {
          // gentle slope → snap down
          this.isGrounded = true;
          this.playerVelocity.y = 0;
        } else {
          // too steep (i.e. a wall) → slide
          const proj = collisionNormal.dot(this.playerVelocity);
          this.playerVelocity.addScaledVector(collisionNormal, -proj);
        }
        }

        if (this.isGrounded) {
      this.playerVelocity.y = 0;
    }
    // Sync camera to player position
    this.camera.position.copy(this.player.position);
    this._lastAirYaw = this.camera.rotation.y;

}


    /**
     * Teleports the player to a safe position if they fall out of bounds.
     */
    teleportIfOob() {
        // Check player's Y position relative to the bottom of the capsule
        // The bottom of the capsule is player.position.y (top) + segment.end.y (bottom of segment) - radius (bottom cap)
        // Adjust for scaling: player.position.y is the top of the scaled capsule.
        // The effective segment end will be relative to the scaled height.
        const scaledSegmentEnd = this.player.capsuleInfo.segment.end.y * this.player.scale.y;
        const bottomOfCapsuleY = this.player.position.y + scaledSegmentEnd - this.player.capsuleInfo.radius * this.player.scale.y;

        if (bottomOfCapsuleY < -25) { // If player falls below a certain threshold
            window.localPlayer.isDead = true;
            /*
            console.warn("Player OOB detected! Teleporting...");
            this.setPlayerPosition(new THREE.Vector3(0, 5, 0)); // Teleport to a safe, elevated position
            this.playerVelocity.set(0, 0, 0); // Clear velocity
            this.isGrounded = false;
            this.jumpTriggered = false; // Reset jump flag on teleport
            this.fallStartY = null; // Reset fall start Y on teleport
            if (this.fallStartTimer) {
                clearTimeout(this.fallStartTimer);
                this.fallStartTimer = null;
            }
            */
        }
    }

    /**
     * Sets the player's and camera's position.
     * @param {THREE.Vector3} position The new position for the player.
     */
    setPlayerPosition(position) {
        // Set player mesh position
        this.player.position.copy(position);

        // Reset velocities and flags
        this.playerVelocity.set(0, 0, 0);
        this.isGrounded = false;
        this.jumpTriggered = false;
        this.fallStartY = null;

        // Reset player scale and target height in case they were crouching
        this.player.scale.set(1, 1, 1);
        this.targetPlayerHeight = PLAYER_TOTAL_HEIGHT;
        this.player.capsuleInfo.segment.end.y = -PLAYER_CAPSULE_SEGMENT_LENGTH; // Reset segment length

        // Update camera position to match the player's new position
        this.camera.position.copy(this.player.position);
        this.camera.rotation.set(0, 0, 0); // Optionally reset camera rotation
        console.log(`Player and camera teleported to: (${this.camera.position.x}, ${this.camera.position.y}, ${this.camera.position.z})`);
    }

    /**
     * Handles footstep audio logic.
     * @param {number} currentSpeedXZ Current horizontal speed of the player.
     * @param {number} deltaTime Time elapsed since last frame.
     * @param {object} input Input states.
     */
    _handleFootsteps(currentSpeedXZ, deltaTime, input) {
        if (currentSpeedXZ > FOOT_DISABLED_THRESHOLD && this.isGrounded && !input.slow && !input.crouch) {
            const interval = this.baseFootInterval / currentSpeedXZ;
            this.footAcc += deltaTime;
            if (this.footAcc >= interval) {
                this.footAcc -= interval;
                const audio = this.footAudios[this.footIndex];
                audio.currentTime = 0;
                audio.play().catch(() => { });
                sendSoundEvent("footstep", "run", this._pos());
                this.footIndex = 1 - this.footIndex;
            }
        } else if (this.isGrounded && currentSpeedXZ <= FOOT_DISABLED_THRESHOLD) {
            this.footAcc = 0; // Reset footstep accumulator when stopped
        }
    }

    /**
     * Handles landing audio logic.
     */
    _handleLandingSound() {
        if (!this.prevPlayerIsOnGround && this.isGrounded) {
            // Play landing sound if falling distance was significant or it was a jump
            if ((this.fallStartY !== null && (this.fallStartY - this.player.position.y) > 1) || (this.jumpTriggered && (this.fallStartY - this.player.position.y) > 1)) {
                this.landAudio.currentTime = 0;
                this.landAudio.play().catch(() => { });
                sendSoundEvent("landingThud", "land", this._pos());
            }
            this.fallStartY = null; // Reset fall start Y
            if (this.fallStartTimer) {
                clearTimeout(this.fallStartTimer);
                this.fallStartTimer = null;
            }
            this.jumpTriggered = false; // Reset jump trigger
        } else if (!this.isGrounded && this.fallStartY === null) {
            // If not grounded and fallStartY hasn't been set yet, and not due to a jump, start a timer
            if (!this.fallStartTimer) {
                
                this.fallStartTimer = setTimeout(() => {
                    this.fallStartY = this.player.position.y; // Set fallStartY after delay
                    this.fallStartTimer = null;
                }, this.fallDelay);
            }
        } else if (this.isGrounded && this.fallStartTimer) {
            // If grounded, but fall timer was active, clear it.
            clearTimeout(this.fallStartTimer);
            this.fallStartTimer = null;
        }
    }

    /**
     * Rotates the player model to align with camera direction when grounded.
     */
    _rotatePlayerModel() {
        if (this.isGrounded) {
            const smoothingFactor = 0.15;
            const playerWorldForward = new THREE.Vector3();
            this.camera.getWorldDirection(playerWorldForward);
            playerWorldForward.y = 0; // Flatten to horizontal
            playerWorldForward.normalize();

            // Create a target quaternion for the player mesh that aligns its forward with the camera's horizontal forward
            const targetQuaternion = new THREE.Quaternion().setFromUnitVectors(this.player.getWorldDirection(this.tempVector), playerWorldForward);
            this.player.quaternion.slerp(targetQuaternion, smoothingFactor);
        } else {
            // If not grounded, smoothly return to upright (or keep previous horizontal rotation)
            const upAlignmentQuaternion = new THREE.Quaternion();
            upAlignmentQuaternion.setFromUnitVectors(this.player.up, new THREE.Vector3(0, 1, 0));
            this.player.quaternion.slerp(upAlignmentQuaternion, 0.05);
        }
    }

    /**
     * Main update loop for the physics controller.
     * @param {number} deltaTime The time elapsed since the last frame.
     * @param {object} input An object containing input states.
     * @returns {object} An object containing current player state information.
     */
update(deltaTime, input) {
    // 1) Cap deltaTime and accumulate for fixed-step physics
    deltaTime = Math.min(0.1, deltaTime);
    this.accumulator += deltaTime;

    // 2) Store previous grounded state
    this.prevPlayerIsOnGround = this.isGrounded;

    // 3) Run fixed‐step physics sub‐iterations
    let stepsTaken = 0;
    while (this.accumulator >= FIXED_TIME_STEP && stepsTaken < MAX_PHYSICS_STEPS) {
        this._applyControls(FIXED_TIME_STEP, input);
        this._updatePlayerPhysics(FIXED_TIME_STEP);
        this.accumulator -= FIXED_TIME_STEP;
        stepsTaken++;
    }

    // 4) Handle footsteps, landing sound, model rotation, out‐of‐bounds teleport
    const currentSpeedXZ = Math.hypot(this.playerVelocity.x, this.playerVelocity.z);
    this._handleFootsteps(currentSpeedXZ, deltaTime, input);
    this._handleLandingSound();
    this._rotatePlayerModel();
    this.teleportIfOob();

    // —— NEW: stuck‐in‐air detection + snap to ground ——
    // Initialize _lastY on first invocation
    if (this._lastY === null) {
        this._lastY = this.player.position.y;
    }

    if (!this.isGrounded) {
        const currentY = this.player.position.y;
        const dy = Math.abs(currentY - this._lastY);

        if (dy > 0.01) {
            // Significant vertical movement → reset the timer
            this._lastY = currentY;
            this._yStuckTimer = 0;
        } else {
            // No vertical movement → accumulate stuck time
            this._yStuckTimer += deltaTime;
            if (this._yStuckTimer >= 1.0) {
                // 1s stuck in air: clear velocity
                this.playerVelocity.set(0, 0, 0);

                // Raycast downward to snap to nearest ground
                const downOrigin = this.player.position.clone();
                const downDir = new THREE.Vector3(0, -1, 0);
                // Cast down up to (capsule height + 1)
                const maxDrop = (PLAYER_TOTAL_HEIGHT * this.player.scale.y) + 1;
                const ray = new THREE.Raycaster(downOrigin, downDir, 0, maxDrop);
                const hits = ray.intersectObject(this.collider, true);
                if (hits.length > 0) {
                    const hitY = hits[0].point.y;
                    const scale = this.player.scale.y;
                    // bottom offset = (segment length + radius) * scale
                    const bottomOffset = (PLAYER_CAPSULE_SEGMENT_LENGTH + PLAYER_CAPSULE_RADIUS) * scale;
                    // Position.y is top of capsule → set so bottom sits at hitY
                    this.player.position.y = hitY + bottomOffset;
                }

                // Reset stuck detection
                this._lastY = this.player.position.y;
                this._yStuckTimer = 0;
            }
        }
    } else {
        // On ground → reset stuck detection immediately
        this._lastY = this.player.position.y;
        this._yStuckTimer = 0;
    }

    // 5) Return the player’s current state
    return {
      x: round2(this.player.position.x),
      y: round2(this.player.position.y),
      z: round2(this.player.position.z),
      rotY: this.camera.rotation.y,
      isGrounded: this.isGrounded,
      velocity: this.playerVelocity.clone(),
      velocityY: this.playerVelocity.y
    };
}

    _pos() {
      const p = this.player.position;
      return { x: round2(p.x), y: round2(p.y), z: round2(p.z) };
    }

}

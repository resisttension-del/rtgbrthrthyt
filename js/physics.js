import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { sendSoundEvent } from "./network.js";

// --- Constants ---
const PLAYER_MASS = 70;
const GRAVITY = 27.5;
const JUMP_VELOCITY = 12.3;
const STEP_HEIGHT = 1;
const STEP_FORWARD_OFFSET = 0.12;
const STEP_FORWARD_PUSH = 0.001;

const MAX_SLOPE_ANGLE = 45 * (Math.PI / 180);
const WALKABLE_DOT = Math.cos(MAX_SLOPE_ANGLE);

const PLAYER_CAPSULE_RADIUS = 0.5;
const PLAYER_CAPSULE_SEGMENT_LENGTH = 2.2 - PLAYER_CAPSULE_RADIUS;
const PLAYER_TOTAL_HEIGHT = PLAYER_CAPSULE_SEGMENT_LENGTH + 2 * PLAYER_CAPSULE_RADIUS;
const PLAYER_CROUCH_HEIGHT = 1.62;

const PLAYER_ACCEL_GROUND = 3;
const PLAYER_DECEL_GROUND = 5;
const PLAYER_ACCEL_AIR = 1;
const PLAYER_DECEL_AIR = 3;
const CROUCH_HEIGHT_RATIO = 0.6;
const CROUCH_SPEED = 8;
const MAX_SPEED = 10;
const AIR_TURN_RATE = 180 * (Math.PI / 180);

const FOOT_DISABLED_THRESHOLD = 0.2;

const FIXED_TIME_STEP = 1 / 90;
const MAX_PHYSICS_STEPS = 5;

function round2(n) {
  return Math.round(n * 100) / 100;
}

// --- Helper: Seamless Loop Audio ---
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

// --- Main Physics Controller ---
export class PhysicsController {
    constructor(camera, scene) {
        this.camera = camera;
        this.scene = scene;

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
        this.speedModifier = 1;
        this.isAim = false;
        this._lastAirYaw = this.camera.rotation.y;

        // Stuck-in-air detection fields
        this._lastY = null;
        this._yStuckTimer = 0;
    }

    setCollider(colliderMesh) {
        this.collider = colliderMesh;
        this.colliderMatrixWorldInverse.copy(this.collider.matrixWorld).invert();
        console.log("MeshBVH collider set in PhysicsController.");
    }

    setSpeedModifier(value) {
        this.speedModifier = value;
    }

    getForwardVector() {
        this.camera.getWorldDirection(this.tempVector);
        this.tempVector.y = 0;
        this.tempVector.normalize();
        return this.tempVector.clone();
    }

    getSideVector() {
        this.camera.getWorldDirection(this.tempVector);
        this.tempVector.y = 0;
        this.tempVector.normalize();
        this.tempVector.cross(this.upVector);
        return this.tempVector.clone();
    }

    // --- Improved Input Handling ---
    _applyControls(deltaTime, input) {
        const baseSpeed = MAX_SPEED;
        const mod = this.speedModifier;
        let moveMod = 1;
        if (input.crouch) moveMod = 0.3;
        else if (input.slow) moveMod = 0.5;
        else if (this.isAim) moveMod = 0.65;
        const currentMoveSpeed = baseSpeed * mod * moveMod;

        // Calculate movement direction
        const moveDirection = new THREE.Vector3();
        if (input.forward) moveDirection.add(this.getForwardVector());
        if (input.backward) moveDirection.add(this.getForwardVector().negate());
        if (input.left) moveDirection.add(this.getSideVector().negate());
        if (input.right) moveDirection.add(this.getSideVector());

        if (moveDirection.lengthSq() > 0) moveDirection.normalize();

        // Target velocities
        const targetVelocityX = moveDirection.x * currentMoveSpeed;
        const targetVelocityZ = moveDirection.z * currentMoveSpeed;

        // Acceleration/deceleration rates
        const isMoving = !!(input.forward || input.backward || input.left || input.right);
        const accelX = this.isGrounded ? (isMoving ? PLAYER_ACCEL_GROUND : PLAYER_DECEL_GROUND) : (isMoving ? PLAYER_ACCEL_AIR : PLAYER_DECEL_AIR);
        const accelZ = accelX;

        // Air control
        if (!this.isGrounded) {
            this.input = input;
            this._applyAirControl(deltaTime);
        }

        // Lerp velocity
        this.playerVelocity.x = THREE.MathUtils.lerp(this.playerVelocity.x, targetVelocityX, accelX * deltaTime);
        this.playerVelocity.z = THREE.MathUtils.lerp(this.playerVelocity.z, targetVelocityZ, accelZ * deltaTime);

        // Jump
        if (this.isGrounded && input.jump) {
            this.playerVelocity.y = JUMP_VELOCITY;
            this.isGrounded = false;
            this.jumpTriggered = true;
        }

        // Crouch/Uncrouch
        const crouchHeight = PLAYER_TOTAL_HEIGHT * CROUCH_HEIGHT_RATIO;
        if (input.crouch) {
            this.isCrouching = true;
            this.targetPlayerHeight = crouchHeight;
        } else {
            if (this._canUncrouch()) {
                this.isCrouching = false;
                this.targetPlayerHeight = PLAYER_TOTAL_HEIGHT;
            } else {
                this.isCrouching = true;
                this.targetPlayerHeight = crouchHeight;
            }
        }
    }

    // --- Air Control ---
    _applyAirControl(dt) {
        let yawNow = this.camera.rotation.y;
        let deltaYaw = yawNow - this._lastAirYaw;
        deltaYaw = ((deltaYaw + Math.PI) % (2 * Math.PI)) - Math.PI;
        const maxYaw = AIR_TURN_RATE * dt;
        const appliedYaw = Math.sign(deltaYaw) * Math.min(Math.abs(deltaYaw), maxYaw);
        if (appliedYaw === 0) return;

        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), appliedYaw);
        const v = this.playerVelocity.clone();
        const horizontal = new THREE.Vector3(v.x, 0, v.z).applyQuaternion(q);
        this.playerVelocity.x = horizontal.x;
        this.playerVelocity.z = horizontal.z;
    }

    // --- Ceiling Checks ---
    _canUncrouch() {
        if (!this.isCrouching) return true;
        if (!this.collider || !this.collider.geometry || !this.collider.geometry.boundsTree) return true;
        const standingHeight = PLAYER_TOTAL_HEIGHT;
        const currentRadius = this.player.capsuleInfo.radius * this.player.scale.y;
        const standingCenterOffset = (standingHeight - PLAYER_CROUCH_HEIGHT) / 2;
        const targetTopPosition = this.player.position.clone().add(new THREE.Vector3(0, standingCenterOffset, 0));
        const segStart = targetTopPosition.clone().add(new THREE.Vector3(0, standingHeight / 2 - currentRadius, 0));
        const segEnd = targetTopPosition.clone().sub(new THREE.Vector3(0, standingHeight / 2 - currentRadius, 0));
        this.tempSegment.copy(new THREE.Line3(segStart, segEnd));
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
                const capPoint = this.tempVector2;
                const dist = tri.closestPointToSegment(this.tempSegment, triPoint, capPoint);
                if (dist < currentRadius) {
                    hitCeiling = true;
                    return true;
                }
                return false;
            }
        });
        return !hitCeiling;
    }

    // --- Step Up ---
    _stepUpIfPossible() {
        if (!this.collider || this.playerVelocity.y > 0.1) return;
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

        const horizVel = new THREE.Vector3(this.playerVelocity.x, 0, this.playerVelocity.z);
        if (horizVel.lengthSq() >= 0.1 * 0.1) {
            const dir = horizVel.clone().normalize();
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
                    const headCheck = new THREE.Raycaster(
                        new THREE.Vector3(this.player.position.x, stepTopY + playerHeight + 0.02, this.player.position.z),
                        new THREE.Vector3(0, 1, 0),
                        0,
                        0.1
                    );
                    if (headCheck.intersectObject(this.collider, true).length === 0) {
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

    // --- Main Physics Update ---
    _updatePlayerPhysics(delta) {
        this._stepUpIfPossible();
        const wasGrounded = this.isGrounded;
        this.isGrounded = false;

        // Gravity
        if (wasGrounded) {
            this.playerVelocity.y = -GRAVITY * delta * 0.1;
        } else {
            this.playerVelocity.y -= GRAVITY * delta;
        }

        // Cap horizontal speed
        const horiz = Math.hypot(this.playerVelocity.x, this.playerVelocity.z);
        const maxHoriz = MAX_SPEED * this.speedModifier;
        if (horiz > maxHoriz) {
            const scale = maxHoriz / horiz;
            this.playerVelocity.x *= scale;
            this.playerVelocity.z *= scale;
        }

        // Crouch height
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

        // Move the mesh
        this.player.position.addScaledVector(this.playerVelocity, delta);
        this.player.updateMatrixWorld();

        // --- Collision ---
        const capsuleInfo = this.player.capsuleInfo;
        const collisionRadius = capsuleInfo.radius + 0.001;

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
                        collisionNormal.copy(pushDir);
                        collisionPoint.copy(capPoint.applyMatrix4(this.collider.matrixWorld));
                    }
                }
            });
        }

        // Compute offset
        const newStartWorld = this.tempVector.copy(this.tempSegment.start).applyMatrix4(this.collider.matrixWorld);
        const deltaVec = newStartWorld.sub(this.player.position);
        const offset = Math.max(0, deltaVec.length() - 1e-5);
        deltaVec.normalize().multiplyScalar(offset);
        this.player.position.add(deltaVec);

        // Slope/wall handling
        if (hasCollision) {
            const normalY = collisionNormal.dot(this.upVector);
            if (normalY >= WALKABLE_DOT && this.playerVelocity.y <= 0) {
                this.isGrounded = true;
                this.playerVelocity.y = 0;
            } else {
                const proj = collisionNormal.dot(this.playerVelocity);
                this.playerVelocity.addScaledVector(collisionNormal, -proj);
            }
        }
        if (this.isGrounded) this.playerVelocity.y = 0;

        // Sync camera
        this.camera.position.copy(this.player.position);
        this._lastAirYaw = this.camera.rotation.y;
    }

    // --- Out Of Bounds ---
    teleportIfOob() {
        const scaledSegmentEnd = this.player.capsuleInfo.segment.end.y * this.player.scale.y;
        const bottomOfCapsuleY = this.player.position.y + scaledSegmentEnd - this.player.capsuleInfo.radius * this.player.scale.y;
        if (bottomOfCapsuleY < -25) {
            window.localPlayer.isDead = true;
        }
    }

    setPlayerPosition(position) {
        this.player.position.copy(position);
        this.playerVelocity.set(0, 0, 0);
        this.isGrounded = false;
        this.jumpTriggered = false;
        this.fallStartY = null;
        this.player.scale.set(1, 1, 1);
        this.targetPlayerHeight = PLAYER_TOTAL_HEIGHT;
        this.player.capsuleInfo.segment.end.y = -PLAYER_CAPSULE_SEGMENT_LENGTH;
        this.camera.position.copy(this.player.position);
        this.camera.rotation.set(0, 0, 0);
        console.log(`Player and camera teleported to: (${this.camera.position.x}, ${this.camera.position.y}, ${this.camera.position.z})`);
    }

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
            this.footAcc = 0;
        }
    }

    _handleLandingSound() {
        if (!this.prevPlayerIsOnGround && this.isGrounded) {
            if ((this.fallStartY !== null && (this.fallStartY - this.player.position.y) > 1) || (this.jumpTriggered && (this.fallStartY - this.player.position.y) > 1)) {
                this.landAudio.currentTime = 0;
                this.landAudio.play().catch(() => { });
                sendSoundEvent("landingThud", "land", this._pos());
            }
            this.fallStartY = null;
            if (this.fallStartTimer) {
                clearTimeout(this.fallStartTimer);
                this.fallStartTimer = null;
            }
            this.jumpTriggered = false;
        } else if (!this.isGrounded && this.fallStartY === null) {
            if (!this.fallStartTimer) {
                this.fallStartTimer = setTimeout(() => {
                    this.fallStartY = this.player.position.y;
                    this.fallStartTimer = null;
                }, this.fallDelay);
            }
        } else if (this.isGrounded && this.fallStartTimer) {
            clearTimeout(this.fallStartTimer);
            this.fallStartTimer = null;
        }
    }

    _rotatePlayerModel() {
        if (this.isGrounded) {
            const smoothingFactor = 0.15;
            const playerWorldForward = new THREE.Vector3();
            this.camera.getWorldDirection(playerWorldForward);
            playerWorldForward.y = 0;
            playerWorldForward.normalize();
            const targetQuaternion = new THREE.Quaternion().setFromUnitVectors(this.player.getWorldDirection(this.tempVector), playerWorldForward);
            this.player.quaternion.slerp(targetQuaternion, smoothingFactor);
        } else {
            const upAlignmentQuaternion = new THREE.Quaternion();
            upAlignmentQuaternion.setFromUnitVectors(this.player.up, new THREE.Vector3(0, 1, 0));
            this.player.quaternion.slerp(upAlignmentQuaternion, 0.05);
        }
    }

    // --- Main Update Loop ---
    update(deltaTime, input) {
        deltaTime = Math.min(0.1, deltaTime);
        this.accumulator += deltaTime;
        this.prevPlayerIsOnGround = this.isGrounded;

        let stepsTaken = 0;
        while (this.accumulator >= FIXED_TIME_STEP && stepsTaken < MAX_PHYSICS_STEPS) {
            this._applyControls(FIXED_TIME_STEP, input);
            this._updatePlayerPhysics(FIXED_TIME_STEP);
            this.accumulator -= FIXED_TIME_STEP;
            stepsTaken++;
        }

        const currentSpeedXZ = Math.hypot(this.playerVelocity.x, this.playerVelocity.z);
        this._handleFootsteps(currentSpeedXZ, deltaTime, input);
        this._handleLandingSound();
        this._rotatePlayerModel();
        this.teleportIfOob();

        // Stuck-in-air detection
        if (this._lastY === null) this._lastY = this.player.position.y;
        if (!this.isGrounded) {
            const currentY = this.player.position.y;
            const dy = Math.abs(currentY - this._lastY);
            if (dy > 0.01) {
                this._lastY = currentY;
                this._yStuckTimer = 0;
            } else {
                this._yStuckTimer += deltaTime;
                if (this._yStuckTimer >= 1.0) {
                    this.playerVelocity.set(0, 0, 0);
                    const downOrigin = this.player.position.clone();
                    const downDir = new THREE.Vector3(0, -1, 0);
                    const maxDrop = (PLAYER_TOTAL_HEIGHT * this.player.scale.y) + 1;
                    const ray = new THREE.Raycaster(downOrigin, downDir, 0, maxDrop);
                    const hits = ray.intersectObject(this.collider, true);
                    if (hits.length > 0) {
                        const hitY = hits[0].point.y;
                        const scale = this.player.scale.y;
                        const bottomOffset = (PLAYER_CAPSULE_SEGMENT_LENGTH + PLAYER_CAPSULE_RADIUS) * scale;
                        this.player.position.y = hitY + bottomOffset;
                    }
                    this._lastY = this.player.position.y;
                    this._yStuckTimer = 0;
                }
            }
        } else {
            this._lastY = this.player.position.y;
            this._yStuckTimer = 0;
        }

        // Return state
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

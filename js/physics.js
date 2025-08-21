import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { sendSoundEvent } from "./network.js";

// Constants
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

        this.playerVelocity = new THREE.Vector3();
        this.isGrounded = false;
        this.isCrouching = false;
        this.targetPlayerHeight = PLAYER_TOTAL_HEIGHT;
        this.originalCapsuleSegmentLength = PLAYER_CAPSULE_SEGMENT_LENGTH;
        this.originalCapsuleRadius = PLAYER_CAPSULE_RADIUS;

        this.upVector = new THREE.Vector3(0, 1, 0);
        this.tempVector = new THREE.Vector3();
        this.tempVector2 = new THREE.Vector3();
        this.tempBox = new THREE.Box3();
        this.tempMat = new THREE.Matrix4();
        this.tempSegment = new THREE.Line3();
        this.colliderMatrixWorldInverse = new THREE.Matrix4();

        this.accumulator = 0;
        this.collider = null;
        this.mouseTime = 0;
        this.camera.rotation.order = 'YXZ';

        this.footAudios = [
            new Audio("https://codehs.com/uploads/29c8a5da333b3fd36dc9681a4a8ec865"),
            new Audio("https://codehs.com/uploads/616ef1b61061008f9993d1ab4fa323ba")
        ];
        this.footAudios.forEach(a => a.volume = 0.7);
        this.footIndex = 0;
        this.footAcc = 0;
        this.baseFootInterval = 4;

        this.landAudio = new Audio("https://codehs.com/uploads/600ab769d99d74647db55a468b19761f");
        this.landAudio.volume = 0.8;
        this.fallStartY = null;
        this.prevPlayerIsOnGround = false;
        this.jumpTriggered = false;
        this.fallDelay = 300;
        this.fallStartTimer = null;

        this.speedModifier = 1;
        this.isAim = false;
        this._lastAirYaw = this.camera.rotation.y;
        this._lastY = null;
        this._yStuckTimer = 0;

        // DEBUG / stuck-lock helpers (exposed for runtime toggling)
        this._stuckLockTime = 0; // short timer after snaps that blocks gravity
        this._debugNoCollider = false; // set true to bypass shapecast for tests
        this._debugLog = true; // enable debug logging by default while debugging

        // Expose this instance on window to toggle debug flags at runtime:
        try { window._pc = this; } catch (e) { /* ignore if not allowed */ }
        console.warn("[PhysicsController] created — debug ON. Toggle via window._pc._debugLog / window._pc._debugNoCollider");
    }

    setCollider(colliderMesh) {
        this.collider = colliderMesh;
        if (!this.collider) {
            console.warn("setCollider called with falsy colliderMesh");
            return;
        }
        // ensure boundsTree exists (if using MeshBVH)
        if (this.collider.geometry && !this.collider.geometry.boundsTree && typeof this.collider.geometry.computeBoundsTree === 'function') {
            try {
                this.collider.geometry.computeBoundsTree();
            } catch (e) {
                console.warn("Failed to compute boundsTree:", e);
            }
        }
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
        return this.tempVector;
    }

    getSideVector() {
        this.camera.getWorldDirection(this.tempVector);
        this.tempVector.y = 0;
        this.tempVector.normalize();
        this.tempVector.cross(this.upVector);
        return this.tempVector;
    }

    _applyControls(deltaTime, input) {
        const baseSpeed = MAX_SPEED;
        const currentMoveSpeed = baseSpeed * this.speedModifier * (input.crouch ? 0.3 : input.slow ? 0.5 : this.isAim ? 0.65 : 1);

        const moveDirection = new THREE.Vector3();
        if (input.forward) moveDirection.add(this.getForwardVector());
        if (input.backward) moveDirection.add(this.getForwardVector().multiplyScalar(-1));
        if (input.left) moveDirection.add(this.getSideVector().multiplyScalar(-1));
        if (input.right) moveDirection.add(this.getSideVector());

        if (moveDirection.lengthSq() > 0) moveDirection.normalize();

        const targetVelocityX = moveDirection.x * currentMoveSpeed;
        const targetVelocityZ = moveDirection.z * currentMoveSpeed;

        let accelRateX, accelRateZ;
        if (this.isGrounded) {
            accelRateX = input.forward || input.backward || input.left || input.right ? PLAYER_ACCEL_GROUND : PLAYER_DECEL_GROUND;
            accelRateZ = accelRateX;
        } else {
            accelRateX = input.forward || input.backward || input.left || input.right ? PLAYER_ACCEL_AIR : PLAYER_DECEL_AIR;
            accelRateZ = accelRateX;
        }

        if (!this.isGrounded) {
            this.input = input;
            this._applyAirControl(deltaTime);
        }

        this.playerVelocity.x = THREE.MathUtils.lerp(this.playerVelocity.x, targetVelocityX, accelRateX * deltaTime);
        this.playerVelocity.z = THREE.MathUtils.lerp(this.playerVelocity.z, targetVelocityZ, accelRateZ * deltaTime);

        if (this.isGrounded && input.jump) {
            this.playerVelocity.y = JUMP_VELOCITY;
            this.isGrounded = false;
            this.jumpTriggered = true;
        }

        const currentCrouchHeight = PLAYER_TOTAL_HEIGHT * CROUCH_HEIGHT_RATIO;
        const standingHeight = PLAYER_TOTAL_HEIGHT;
        if (input.crouch) {
            this.isCrouching = true;
            this.targetPlayerHeight = currentCrouchHeight;
        } else {
            if (this._canUncrouch()) {
                this.isCrouching = false;
                this.targetPlayerHeight = standingHeight;
            } else {
                this.isCrouching = true;
                this.targetPlayerHeight = currentCrouchHeight;
            }
        }
    }

    _applyAirControl(dt) {
        let yawNow = this.camera.rotation.y;
        let deltaYaw = yawNow - this._lastAirYaw;
        deltaYaw = ((deltaYaw + Math.PI) % (2 * Math.PI)) - Math.PI;
        const maxYaw = AIR_TURN_RATE * dt;
        const appliedYaw = Math.sign(deltaYaw) * Math.min(Math.abs(deltaYaw), maxYaw);
        if (appliedYaw === 0) return;
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), appliedYaw);
        const v = this.playerVelocity;
        const horizontal = new THREE.Vector3(v.x, 0, v.z).applyQuaternion(q);
        v.x = horizontal.x;
        v.z = horizontal.z;
    }

    _canUncrouch() {
        if (!this.isCrouching) return true;
        const standingHeight = PLAYER_TOTAL_HEIGHT;
        const crouchHeight = PLAYER_CROUCH_HEIGHT;
        const currentRadius = this.player.capsuleInfo.radius * this.player.scale.y;
        const standingCenterOffset = (standingHeight - crouchHeight) / 2;
        const targetTopPosition = this.player.position.clone().add(new THREE.Vector3(0, standingCenterOffset, 0));
        const segmentStart = targetTopPosition.clone().add(new THREE.Vector3(0, standingHeight / 2 - currentRadius, 0));
        const segmentEnd = targetTopPosition.clone().sub(new THREE.Vector3(0, standingHeight / 2 - currentRadius, 0));
        this.tempSegment.copy(new THREE.Line3(segmentStart, segmentEnd));
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
                        hitCeiling = true;
                        return true;
                    }
                    return false;
                }
            });
        }
        return !hitCeiling;
    }

    _stepUpIfPossible() {
        if (!this.collider || this._debugNoCollider) return;
        if (this.playerVelocity.y > 0.1) return;
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
                        // set a short stuck lock so gravity doesn't immediately apply next substep
                        this._stuckLockTime = Math.max(this._stuckLockTime || 0, 0.18);
                        this.player.position.add(dir.multiplyScalar(STEP_FORWARD_PUSH));
                        this.player.updateMatrixWorld();
                        return;
                    }
                }
            }
        }
    }

    _updatePlayerPhysics(delta) {
        // UNCONDITIONAL debug entry so we always see this function run
        console.warn("[_updatePlayerPhysics] top — posY:", this.player.position.y.toFixed(3),
                     "velY:", this.playerVelocity.y.toFixed(3), "isGrounded:", this.isGrounded, "delta:", delta.toFixed(4));
        const dbg = this._debugLog;

        // Early step-up attempt
        this._stepUpIfPossible();

        // Store previous grounded state and reset for this frame
        const wasGrounded = this.isGrounded;
        this.isGrounded = false;

        if (dbg) {
            console.log('DBG start: posY=', this.player.position.y.toFixed(3),
                'velY=', this.playerVelocity.y.toFixed(3),
                'wasGrounded=', wasGrounded);
        }

        // --- tiny probe to detect if we are effectively touching ground (top-of-capsule -> short ray) ---
        if (!wasGrounded && this.collider && !this._debugNoCollider) {
            const probeDist = 0.18; // tweakable
            const probeRay = new THREE.Raycaster(
                this.player.position.clone(),                // origin (top of capsule)
                new THREE.Vector3(0, -1, 0),                 // down
                0,
                probeDist
            );
            const probeHits = probeRay.intersectObject(this.collider, true);
            if (probeHits.length > 0 && this.playerVelocity.y <= 0) {
                this.isGrounded = true;
                this.playerVelocity.y = 0;
                this._stuckLockTime = Math.max(this._stuckLockTime || 0, 0.08);
                if (dbg) console.log('DBG probe grounded @', probeHits[0].point.y);
            }
        }

        // Respect stuck-lock if set (prevents immediate gravity re-application after a programmatic snap)
        if (this._stuckLockTime > 0) {
            this._stuckLockTime -= delta;
            this.playerVelocity.y = 0;
        } else {
            // Gravity: if we were grounded last frame, keep a tiny downward snap,
            // otherwise apply normal gravity.
            if (wasGrounded) {
                this.playerVelocity.y = -GRAVITY * delta * 0.1;
            } else {
                this.playerVelocity.y -= GRAVITY * delta;
            }
        }

        if (dbg) {
            console.log('DBG after gravity: velY=', this.playerVelocity.y.toFixed(3));
        }

        // Cap horizontal speed
        const horiz = Math.hypot(this.playerVelocity.x, this.playerVelocity.z);
        const maxHoriz = Math.max(0.0001, MAX_SPEED * this.speedModifier);
        if (horiz > maxHoriz) {
            const scale = maxHoriz / horiz;
            this.playerVelocity.x *= scale;
            this.playerVelocity.z *= scale;
        }

        // Smoothly adjust player height for crouching (unchanged)
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

        if (dbg) {
            console.log('DBG after move: posY=', this.player.position.y.toFixed(3),
                'velY=', this.playerVelocity.y.toFixed(3));
        }

        // --- Collision + resolution (shapecast) ---
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

        if (!this.collider || !this.collider.geometry || !this.collider.geometry.boundsTree) {
            if (dbg) console.warn("Collider or boundsTree not available—skipping collision.");
        }

        if (this.collider && this.collider.geometry && this.collider.geometry.boundsTree && !this._debugNoCollider) {
            this.collider.geometry.boundsTree.shapecast({
                intersectsBounds: box => box.intersectsBox(this.tempBox),
                intersectsTriangle: tri => {
                    const triPoint = this.tempVector;
                    const capPoint = this.tempVector2;
                    const dist = tri.closestPointToSegment(this.tempSegment, triPoint, capPoint);
                    if (dist < collisionRadius) {
                        hasCollision = true;
                        const depth = collisionRadius - dist;
                        let pushDir = capPoint.sub(triPoint).normalize();

                        // Conservative: avoid upward corrections from almost-lateral pushes.
                        // Only allow vertical influence if pushDir has notable Y component.
                        if (Math.abs(pushDir.y) < 0.35) {
                            pushDir.y = 0;
                            pushDir.normalize();
                        }

                        // Push the capsule segment out of the triangle by depth
                        this.tempSegment.start.addScaledVector(pushDir, depth);
                        this.tempSegment.end.addScaledVector(pushDir, depth);

                        // store normal/point in world space
                        collisionNormal.copy(pushDir);
                        collisionPoint.copy(capPoint.applyMatrix4(this.collider.matrixWorld));
                    }
                }
            });
        }

        // Compute world-space collision offset
        const newStartWorld = this.tempVector
            .copy(this.tempSegment.start)
            .applyMatrix4(this.collider ? this.collider.matrixWorld : new THREE.Matrix4());
        const deltaVec = newStartWorld.sub(this.player.position);

        const stepThresh = Math.abs(delta * this.playerVelocity.y * 0.25);
        const isStepOrSlope = deltaVec.y > stepThresh;

        // If we hit a collision and are not stepping/slope, attempt step-up only when grounded
        if (hasCollision && !isStepOrSlope && this.isGrounded) {
            const playerFeetPosition = this.player.position.clone().add(new THREE.Vector3(0, -PLAYER_TOTAL_HEIGHT / 2, 0));
            const horizVel = new THREE.Vector3(this.playerVelocity.x, 0, this.playerVelocity.z);
            if (horizVel.lengthSq() >= 0.01) {
                const dir = horizVel.normalize();
                const capsuleRadius = this.player.capsuleInfo.radius * this.player.scale.y;

                const stepCheckOrigin = playerFeetPosition.clone()
                    .add(dir.clone().multiplyScalar(capsuleRadius + STEP_FORWARD_OFFSET));
                stepCheckOrigin.y += STEP_HEIGHT + 0.01;

                const raycaster = new THREE.Raycaster(stepCheckOrigin, new THREE.Vector3(0, -1, 0), 0, STEP_HEIGHT + 0.02);
                const intersects = raycaster.intersectObject(this.collider, true);

                if (intersects.length > 0) {
                    const stepHit = intersects[0];
                    const stepY = stepHit.point.y;
                    const stepHeightFromFeet = stepY - (this.player.position.y - (PLAYER_TOTAL_HEIGHT / 2) + this.player.capsuleInfo.radius);

                    if (stepHeightFromFeet > 0.01 && stepHeightFromFeet <= STEP_HEIGHT) {
                        const wallCheckOrigin = stepHit.point.clone();
                        wallCheckOrigin.y += 0.01;

                        const currentStandingHeight = PLAYER_TOTAL_HEIGHT * this.player.scale.y;
                        const requiredClearance = currentStandingHeight;

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
                            // Snap up onto the step
                            const newPlayerY = stepY + (PLAYER_TOTAL_HEIGHT / 2) - this.player.capsuleInfo.radius;
                            this.player.position.y = newPlayerY;
                            this.playerVelocity.y = 0;
                            this.isGrounded = true;
                            this._stuckLockTime = Math.max(this._stuckLockTime || 0, 0.18);
                            this.player.position.add(dir.multiplyScalar(STEP_FORWARD_PUSH));
                            this.player.updateMatrixWorld();
                            if (dbg) console.log('DBG stepped up to', newPlayerY);
                            return; // handled step-up
                        }
                    }
                }
            }
        }

        // Move by the collision offset (minus a tiny epsilon)
        const offset = Math.max(0, deltaVec.length() - 1e-5);
        if (offset > 0) {
            const dv = deltaVec.clone().normalize().multiplyScalar(offset);
            this.player.position.add(dv);
        }

        // Collision response
        if (hasCollision) {
            const normalY = collisionNormal.dot(this.upVector);

            // Compute approximate feet Y for deciding if collision is ground (avoid grounding from mid/side collisions)
            const feetY = this.player.position.y - (PLAYER_TOTAL_HEIGHT / 2) + (this.player.capsuleInfo.radius * this.player.scale.y);
            const collisionPointWorldY = collisionPoint.y;

            // Only treat as ground if normal is walkable AND collision point is near the feet
            if (normalY >= WALKABLE_DOT * 0.5 && this.playerVelocity.y <= 0 && collisionPointWorldY <= feetY + 0.14) {
                this.isGrounded = true;
                this.playerVelocity.y = 0;
                this._stuckLockTime = Math.max(this._stuckLockTime || 0, 0.06);
                if (dbg) console.log('DBG grounded by collision at', collisionPointWorldY, 'normalY', normalY.toFixed(3));
            } else {
                // wall / slide
                const proj = collisionNormal.dot(this.playerVelocity);
                this.playerVelocity.addScaledVector(collisionNormal, -proj);
                if (dbg) console.log('DBG slide, proj=', proj.toFixed(3));
            }
        } else {
            if (dbg) {
                // console.log('DBG no collision detected after shapecast');
            }
        }

        // If grounded, only zero vertical velocity when near zero (avoid wiping legitimate falling velocity)
        if (this.isGrounded) {
            if (Math.abs(this.playerVelocity.y) < 0.08) {
                this.playerVelocity.y = 0;
            }
        }

        // Safety clamp: if almost on top of ground but falling fast, clamp downward velocity
        if (!this.isGrounded && this.collider && !this._debugNoCollider) {
            const smallDist = 0.25;
            const r = new THREE.Raycaster(this.player.position.clone(), new THREE.Vector3(0, -1, 0), 0, smallDist);
            const h = r.intersectObject(this.collider, true);
            if (h.length > 0 && this.playerVelocity.y < -1.2) {
                this.playerVelocity.y = -1.2;
                if (dbg) console.log('DBG clamped fast fall near ground');
            }
        }

        // Final guaranteed log of step result (unconditional)
        console.warn("[_updatePlayerPhysics] final — posY:", this.player.position.y.toFixed(3),
                     "velY:", this.playerVelocity.y.toFixed(3),
                     "isGrounded:", this.isGrounded,
                     "hasCollision:", !!hasCollision);

        // Sync camera to player position and update last air yaw
        this.camera.position.copy(this.player.position);
        this._lastAirYaw = this.camera.rotation.y;
    }

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
        this._stuckLockTime = 0.18; // small lock to avoid immediate gravity after teleport
        if (this.fallStartTimer) { clearTimeout(this.fallStartTimer); this.fallStartTimer = null; }
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

update(deltaTime, input) {
    // Very visible per-frame debug
    console.warn('[PhysicsController.update] incoming deltaTime:', deltaTime,
                 'acc(before):', this.accumulator.toFixed(4),
                 'posY:', this.player.position.y.toFixed(3),
                 'velY:', this.playerVelocity.y.toFixed(3),
                 'isGrounded:', this.isGrounded);

    // keep original clamp
    deltaTime = Math.min(0.1, deltaTime);
    this.accumulator += deltaTime;

    // Save previous grounded state (unchanged)
    this.prevPlayerIsOnGround = this.isGrounded;

    // Fixed-step loop diagnostics
    let stepsTaken = 0;
    while (this.accumulator >= FIXED_TIME_STEP && stepsTaken < MAX_PHYSICS_STEPS) {
        // Log each physics substep (very useful)
        if (this._debugLog) console.log(`[PhysicsController] stepping physics (step #${stepsTaken+1}) acc=${this.accumulator.toFixed(4)}`);
        this._applyControls(FIXED_TIME_STEP, input);
        try {
            this._updatePlayerPhysics(FIXED_TIME_STEP);
        } catch (e) {
            console.error('[PhysicsController] _updatePlayerPhysics threw:', e);
            // Avoid infinite crash loop — break and continue to cleanup
            break;
        }
        this.accumulator -= FIXED_TIME_STEP;
        stepsTaken++;
    }

    // If the fixed-step loop executed 0 steps, force one step (DEBUG ONLY)
    if (stepsTaken === 0) {
        console.warn('[PhysicsController] debug-forced physics step because stepsTaken === 0 (remove this when done)');
        // Call once so we can see _updatePlayerPhysics logs and whether gravity applies.
        this._applyControls(FIXED_TIME_STEP, input);
        try {
            this._updatePlayerPhysics(FIXED_TIME_STEP);
        } catch (e) {
            console.error('[PhysicsController] forced _updatePlayerPhysics threw:', e);
        }
    }

    // Continue with the rest of the per-frame logic (unchanged)
    const currentSpeedXZ = Math.hypot(this.playerVelocity.x, this.playerVelocity.z);
    // keep footsteps/landing/rotation/teleport behavior intact
    this._handleFootsteps(currentSpeedXZ, deltaTime, input || {});
    this._handleLandingSound();
    this._rotatePlayerModel();
    this.teleportIfOob();

    // Stuck-in-air snap (unchanged)
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
                const hits = (this.collider && !this._debugNoCollider) ? ray.intersectObject(this.collider, true) : [];
                if (hits.length > 0) {
                    const hitY = hits[0].point.y;
                    const scale = this.player.scale.y;
                    const bottomOffset = (PLAYER_CAPSULE_SEGMENT_LENGTH + PLAYER_CAPSULE_RADIUS) * scale;
                    this.player.position.y = hitY + bottomOffset;
                    this.player.updateMatrixWorld();
                    this.isGrounded = true;
                    this._stuckLockTime = Math.max(this._stuckLockTime || 0, 0.18);
                    if (this.fallStartTimer) { clearTimeout(this.fallStartTimer); this.fallStartTimer = null; }
                }
                this._lastY = this.player.position.y;
                this._yStuckTimer = 0;
            }
        }
    } else {
        this._lastY = this.player.position.y;
        this._yStuckTimer = 0;
    }

    // Return state as before
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

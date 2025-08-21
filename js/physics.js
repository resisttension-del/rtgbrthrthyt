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

        // Player mesh and capsule info
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

        // Audio
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

        // Movement modifiers
        this.speedModifier = 1;
        this.isAim = false;
        this._lastAirYaw = this.camera.rotation.y;

        // Stuck-in-air detection
        this._lastY = null;
        this._yStuckTimer = 0;

        // Debug & locks
        this._stuckLockTime = 0;      // short lock after snaps/step-ups
        this._debugNoCollider = false; // set true to bypass BVH / collider
        this._debugLog = false;        // set true at runtime to enable logs

        // expose to console
        try { window._pc = this; } catch (e) { /* ignore */ }
        if (this._debugLog) console.warn("[PhysicsController] created — debug ON");
    }

    setCollider(colliderMesh) {
        this.collider = colliderMesh;
        if (!this.collider) {
            console.warn("setCollider called with falsy colliderMesh");
            return;
        }
        // ensure matrixWorld, compute BVH if missing
        this.collider.updateMatrixWorld(true);
        if (this.collider.geometry && !this.collider.geometry.boundsTree && typeof this.collider.geometry.computeBoundsTree === 'function') {
            try {
                this.collider.geometry.computeBoundsTree();
                if (this._debugLog) console.log("[PhysicsController] computed boundsTree for collider geometry");
            } catch (e) {
                console.warn("Failed to compute boundsTree:", e);
            }
        }
        this.colliderMatrixWorldInverse.copy(this.collider.matrixWorld).invert();
        if (this._debugLog) console.log("MeshBVH collider set in PhysicsController.");
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
        if (!this.collider) return true;
        this.tempSegment.start.applyMatrix4(this.colliderMatrixWorldInverse);
        this.tempSegment.end.applyMatrix4(this.colliderMatrixWorldInverse);
        this.tempBox.makeEmpty();
        this.tempBox.expandByPoint(this.tempSegment.start);
        this.tempBox.expandByPoint(this.tempSegment.end);
        this.tempBox.min.addScalar(-currentRadius);
        this.tempBox.max.addScalar(currentRadius);
        let hitCeiling = false;
        if (this.collider.geometry && this.collider.geometry.boundsTree) {
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

            const stepRay = new THREE.Raycaster(forwardOrigin, new THREE.Vector3(0, -1, 0), 0, STEP_HEIGHT + 0.3);
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
        if (this._debugLog) {
            console.log("[_updatePlayerPhysics] top — posY:", this.player.position.y.toFixed(3),
                "velY:", this.playerVelocity.y.toFixed(3), "isGrounded:", this.isGrounded, "delta:", delta.toFixed(4));
        }

        // Attempt step-up first
        this._stepUpIfPossible();

        // store previous grounded
        const wasGrounded = this.isGrounded;
        this.isGrounded = false;

        // small probe — top-of-capsule down short distance
        if (!wasGrounded && this.collider && !this._debugNoCollider) {
            const probeDist = 0.18;
            const probeRay = new THREE.Raycaster(this.player.position.clone(), new THREE.Vector3(0, -1, 0), 0, probeDist);
            const probeHits = probeRay.intersectObject(this.collider, true);
            if (probeHits.length > 0 && this.playerVelocity.y <= 0) {
                // Only set grounded if hit point looks sane
                const hitY = probeHits[0].point.y;
                if (Number.isFinite(hitY)) {
                    this.isGrounded = true;
                    this.playerVelocity.y = 0;
                    this._stuckLockTime = Math.max(this._stuckLockTime || 0, 0.08);
                    if (this._debugLog) console.log('DBG probe grounded @', hitY);
                }
            }
        }

        // Always decrease stuck lock if present
        if (this._stuckLockTime > 0) {
            this._stuckLockTime -= delta;
            if (this._stuckLockTime < 0) this._stuckLockTime = 0;
        }

        // Gravity: apply when not stuck-locked AND not grounded
        const shouldApplyGravity = (this._stuckLockTime <= 0) && (!this.isGrounded);
        if (shouldApplyGravity) {
            // normal gravity
            this.playerVelocity.y -= GRAVITY * delta;
        } else if (wasGrounded && this._stuckLockTime <= 0 && !this.isGrounded) {
            // if we WERE grounded last frame but are not currently flagged grounded,
            // give a tiny downward snap to stay consistent with prior behavior
            this.playerVelocity.y = -GRAVITY * delta * 0.1;
        }

        if (this._debugLog) {
            console.log('DBG after gravity: velY=', this.playerVelocity.y.toFixed(3),
                'stuckLock:', this._stuckLockTime.toFixed(3),
                'isGrounded now:', this.isGrounded);
        }

        // Cap horizontal speed
        const horiz = Math.hypot(this.playerVelocity.x, this.playerVelocity.z);
        const maxHoriz = Math.max(0.0001, MAX_SPEED * this.speedModifier);
        if (horiz > maxHoriz) {
            const scale = maxHoriz / horiz;
            this.playerVelocity.x *= scale;
            this.playerVelocity.z *= scale;
        }

        // Smooth crouch scale
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

        // Move the player by velocity
        this.player.position.addScaledVector(this.playerVelocity, delta);
        this.player.updateMatrixWorld();

        if (this._debugLog) {
            console.log('DBG after move: posY=', this.player.position.y.toFixed(3),
                'velY=', this.playerVelocity.y.toFixed(3));
        }

        // --- Collision detection & resolution (robust) ---
        const capsuleInfo = this.player.capsuleInfo;
        const collisionRadius = (capsuleInfo.radius * this.player.scale.y) + 0.001;

        // world-space capsule segment (player.position is top of capsule)
        const segWorldStart = this.player.position.clone();
        const segWorldEnd = this.player.position.clone().add(new THREE.Vector3(0, -this.originalCapsuleSegmentLength * this.player.scale.y, 0));

        let hasCollision = false;
        let collisionNormal = new THREE.Vector3();
        let collisionPoint = new THREE.Vector3();

        if (this.collider && !this._debugNoCollider) {
            // ensure collider matrices up to date
            this.collider.updateMatrixWorld(true);
            // refresh inverse
            this.colliderMatrixWorldInverse.copy(this.collider.matrixWorld).invert();

            // ensure boundsTree exists if possible
            if (this.collider.geometry && !this.collider.geometry.boundsTree && typeof this.collider.geometry.computeBoundsTree === 'function') {
                try {
                    this.collider.geometry.computeBoundsTree();
                    if (this._debugLog) console.log('[PhysicsController] computed boundsTree for collider (late)');
                } catch (e) {
                    console.warn('[PhysicsController] computeBoundsTree failed:', e);
                }
            }

            // transform world segment into collider-local
            this.tempSegment.start.copy(segWorldStart).applyMatrix4(this.colliderMatrixWorldInverse);
            this.tempSegment.end.copy(segWorldEnd).applyMatrix4(this.colliderMatrixWorldInverse);

            // local AABB for shapecast
            this.tempBox.makeEmpty();
            this.tempBox.expandByPoint(this.tempSegment.start);
            this.tempBox.expandByPoint(this.tempSegment.end);
            this.tempBox.min.addScalar(-collisionRadius);
            this.tempBox.max.addScalar(collisionRadius);

            let usedShapecast = false;
            if (this.collider.geometry && this.collider.geometry.boundsTree) {
                usedShapecast = true;
                try {
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

                                // avoid mostly-lateral pushes causing large upward corrections
                                if (Math.abs(pushDir.y) < 0.35) {
                                    pushDir.y = 0;
                                    pushDir.normalize();
                                }

                                // move local segment out
                                this.tempSegment.start.addScaledVector(pushDir, depth);
                                this.tempSegment.end.addScaledVector(pushDir, depth);

                                // convert pushDir (local) to a proper world normal using normal matrix
                                const normalMatrix = new THREE.Matrix3().getNormalMatrix(this.collider.matrixWorld);
                                collisionNormal.copy(pushDir).applyMatrix3(normalMatrix).normalize();

                                // convert capPoint(local) to world
                                collisionPoint.copy(capPoint.clone().applyMatrix4(this.collider.matrixWorld));

                                return true;
                            }
                            return false;
                        }
                    });
                } catch (e) {
                    // shapecast can throw if tri API differs; fallback to rays below
                    if (this._debugLog) console.warn("[PhysicsController] shapecast threw, falling back to ray probes:", e);
                    hasCollision = false;
                    usedShapecast = false;
                }
            }

            // fallback to ray probes if shapecast unavailable or failed
            if (!usedShapecast) {
                const probes = [
                    new THREE.Vector3(0, 0, 0),
                    new THREE.Vector3(capsuleInfo.radius * this.player.scale.y, 0, 0),
                    new THREE.Vector3(-capsuleInfo.radius * this.player.scale.y, 0, 0),
                    new THREE.Vector3(0, 0, capsuleInfo.radius * this.player.scale.y),
                    new THREE.Vector3(0, 0, -capsuleInfo.radius * this.player.scale.y)
                ];

                for (let i = 0; i < probes.length; i++) {
                    const origin = this.player.position.clone().add(probes[i]);
                    origin.y += 0.1;
                    const ray = new THREE.Raycaster(origin, new THREE.Vector3(0, -1, 0), 0, PLAYER_TOTAL_HEIGHT * this.player.scale.y + 0.5);
                    const hits = ray.intersectObject(this.collider, true);
                    if (hits.length > 0) {
                        const h = hits[0];
                        if (h && h.point && Number.isFinite(h.point.y)) {
                            hasCollision = true;
                            collisionPoint.copy(h.point);
                            if (h.face) {
                                collisionNormal.copy(h.face.normal).transformDirection(h.object.matrixWorld).normalize();
                            } else {
                                collisionNormal.copy(this.player.position).sub(h.point).normalize();
                            }
                            break;
                        }
                    }
                }
            }
        } else {
            if (this._debugLog) console.warn("[PhysicsController] no collider or debugNoCollider enabled");
            hasCollision = false;
        }

        // compute world offset from (possibly modified) tempSegment
        const newStartWorld = this.tempVector
            .copy(this.tempSegment.start)
            .applyMatrix4(this.collider ? this.collider.matrixWorld : new THREE.Matrix4());
        const deltaVec = newStartWorld.sub(this.player.position);

        const stepThresh = Math.abs(delta * this.playerVelocity.y * 0.25);
        const isStepOrSlope = deltaVec.y > stepThresh;

        // step-up (only when grounded)
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
                            const newPlayerY = stepY + (PLAYER_TOTAL_HEIGHT / 2) - this.player.capsuleInfo.radius;
                            this.player.position.y = newPlayerY;
                            this.playerVelocity.y = 0;
                            this.isGrounded = true;
                            this._stuckLockTime = Math.max(this._stuckLockTime || 0, 0.18);
                            this.player.position.add(dir.multiplyScalar(STEP_FORWARD_PUSH));
                            this.player.updateMatrixWorld();
                            if (this._debugLog) console.log('DBG stepped up to', newPlayerY);
                            return;
                        }
                    }
                }
            }
        }

        // push out
        const offset = Math.max(0, deltaVec.length() - 1e-5);
        if (offset > 0) {
            const dv = deltaVec.clone().normalize().multiplyScalar(offset);
            this.player.position.add(dv);
        }

        // collision response
        if (hasCollision) {
            // guard collisionPoint validity
            if (!collisionPoint || !Number.isFinite(collisionPoint.y)) {
                // invalid collision info; ignore
                if (this._debugLog) console.warn("[PhysicsController] invalid collision point — ignoring collision result");
                hasCollision = false;
            } else {
                const normalY = collisionNormal.dot(this.upVector);
                const feetY = this.player.position.y - (PLAYER_TOTAL_HEIGHT / 2) + (this.player.capsuleInfo.radius * this.player.scale.y);
                const collisionPointWorldY = collisionPoint.y;

                if (normalY >= WALKABLE_DOT * 0.5 && this.playerVelocity.y <= 0 && collisionPointWorldY <= feetY + 0.14) {
                    this.isGrounded = true;
                    this.playerVelocity.y = 0;
                    this._stuckLockTime = Math.max(this._stuckLockTime || 0, 0.06);
                    if (this._debugLog) console.log('DBG grounded by collision at', collisionPointWorldY, 'normalY', normalY.toFixed(3));
                } else {
                    // slide
                    const proj = collisionNormal.dot(this.playerVelocity);
                    this.playerVelocity.addScaledVector(collisionNormal, -proj);
                    if (this._debugLog) console.log('DBG slide, proj=', proj.toFixed(3));
                }
            }
        }

        // If grounded, zero small vertical velocities
        if (this.isGrounded) {
            if (Math.abs(this.playerVelocity.y) < 0.08) {
                this.playerVelocity.y = 0;
            }
        }

        // safety clamp near ground
        if (!this.isGrounded && this.collider && !this._debugNoCollider) {
            const smallDist = 0.25;
            const r = new THREE.Raycaster(this.player.position.clone(), new THREE.Vector3(0, -1, 0), 0, smallDist);
            const h = r.intersectObject(this.collider, true);
            if (h.length > 0 && this.playerVelocity.y < -1.2) {
                this.playerVelocity.y = -1.2;
                if (this._debugLog) console.log('DBG clamped fast fall near ground');
            }
        }

        if (this._debugLog) {
            console.log("[_updatePlayerPhysics] final — posY:", this.player.position.y.toFixed(3),
                "velY:", this.playerVelocity.y.toFixed(3),
                "isGrounded:", this.isGrounded,
                "hasCollision:", !!hasCollision);
        }

        // sync camera
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
        this._stuckLockTime = 0.18; // short lock
        if (this.fallStartTimer) { clearTimeout(this.fallStartTimer); this.fallStartTimer = null; }
        if (this._debugLog) console.log(`Player and camera teleported to: (${this.camera.position.x}, ${this.camera.position.y}, ${this.camera.position.z})`);
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
        if (this._debugLog) console.warn('[PhysicsController.update] incoming deltaTime:', deltaTime,
            'acc(before):', this.accumulator.toFixed(4),
            'posY:', this.player.position.y.toFixed(3),
            'velY:', this.playerVelocity.y.toFixed(3),
            'isGrounded:', this.isGrounded);

        deltaTime = Math.min(0.1, deltaTime);
        this.accumulator += deltaTime;
        this.prevPlayerIsOnGround = this.isGrounded;

        let stepsTaken = 0;
        while (this.accumulator >= FIXED_TIME_STEP && stepsTaken < MAX_PHYSICS_STEPS) {
            if (this._debugLog) console.log(`[PhysicsController] stepping physics (step #${stepsTaken+1}) acc=${this.accumulator.toFixed(4)}`);
            this._applyControls(FIXED_TIME_STEP, input);
            try {
                this._updatePlayerPhysics(FIXED_TIME_STEP);
            } catch (e) {
                console.error('[PhysicsController] _updatePlayerPhysics threw:', e);
                break;
            }
            this.accumulator -= FIXED_TIME_STEP;
            stepsTaken++;
        }

        // Debug-only forced step if none performed (kept off by default)
        if (stepsTaken === 0 && this._debugLog) {
            console.warn('[PhysicsController] debug-forced physics step because stepsTaken === 0 (debug only)');
            this._applyControls(FIXED_TIME_STEP, input);
            try {
                this._updatePlayerPhysics(FIXED_TIME_STEP);
            } catch (e) {
                console.error('[PhysicsController] forced _updatePlayerPhysics threw:', e);
            }
        }

        const currentSpeedXZ = Math.hypot(this.playerVelocity.x, this.playerVelocity.z);
        this._handleFootsteps(currentSpeedXZ, deltaTime, input || {});
        this._handleLandingSound();
        this._rotatePlayerModel();
        this.teleportIfOob();

        // Stuck-in-air snap
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
                        if (Number.isFinite(hitY)) {
                            const scale = this.player.scale.y;
                            const bottomOffset = (PLAYER_CAPSULE_SEGMENT_LENGTH + PLAYER_CAPSULE_RADIUS) * scale;
                            this.player.position.y = hitY + bottomOffset;
                            this.player.updateMatrixWorld();
                            this.isGrounded = true;
                            this._stuckLockTime = Math.max(this._stuckLockTime || 0, 0.18);
                            if (this.fallStartTimer) { clearTimeout(this.fallStartTimer); this.fallStartTimer = null; }
                        }
                    }
                    this._lastY = this.player.position.y;
                    this._yStuckTimer = 0;
                }
            }
        } else {
            this._lastY = this.player.position.y;
            this._yStuckTimer = 0;
        }

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

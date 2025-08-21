import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";
import * as RAPIER from "https://cdn.skypack.dev/@dimforge/rapier3d-compat";

// Physics constants (preserved from your original logic)
const GRAVITY = 27.5;
const JUMP_VELOCITY = 12.3;
const PLAYER_CAPSULE_RADIUS = 0.5;
const PLAYER_TOTAL_HEIGHT = 2.2;
const PLAYER_CROUCH_HEIGHT = 1.62;
const CROUCH_HEIGHT_RATIO = 0.6;
const CROUCH_SPEED = 8;
const MAX_SPEED = 10;
const PLAYER_ACCEL_GROUND = 3;
const PLAYER_DECEL_GROUND = 5;
const PLAYER_ACCEL_AIR = 1;
const PLAYER_DECEL_AIR = 3;

function round2(n) { return Math.round(n * 100) / 100; }

export class RapierPhysicsController {
    constructor(camera, scene, mapColliderDesc) {
        this.camera = camera;
        this.scene = scene;
        this.world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });

        // Player collider
        this.playerRadius = PLAYER_CAPSULE_RADIUS;
        this.playerHeight = PLAYER_TOTAL_HEIGHT;
        this.crouchHeight = PLAYER_CROUCH_HEIGHT;
        this.isCrouching = false;
        this.targetPlayerHeight = this.playerHeight;

        // Kinematic body for controlled movement
        const capsuleHalfHeight = (this.playerHeight / 2) - this.playerRadius;
        this.playerBody = this.world.createRigidBody(
            RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 5, 0)
        );
        this.playerCollider = this.world.createCollider(
            RAPIER.ColliderDesc.capsule(capsuleHalfHeight, this.playerRadius),
            this.playerBody
        );

        // Map collider
        if (mapColliderDesc) {
            this.mapCollider = this.world.createCollider(mapColliderDesc);
        }

        // Player mesh
        this.playerMesh = new THREE.Mesh(
            new THREE.CapsuleGeometry(this.playerRadius, this.playerHeight - 2 * this.playerRadius, 8, 16),
            new THREE.MeshStandardMaterial({ color: 0x44aa88 })
        );
        this.playerMesh.castShadow = true;
        this.playerMesh.receiveShadow = true;
        this.scene.add(this.playerMesh);

        // Movement state
        this.playerVelocity = new THREE.Vector3();
        this.isGrounded = false;
        this.speedModifier = 1;
        this.isAim = false;
        this.input = {};
    }

    setSpeedModifier(value) {
        this.speedModifier = value;
    }
    setInput(input) {
        this.input = input;
    }
    setAim(isAim) {
        this.isAim = isAim;
    }

    setPlayerPosition(position) {
        this.playerBody.setNextKinematicTranslation({ x: position.x, y: position.y, z: position.z });
        this.playerVelocity.set(0, 0, 0);
        this.isGrounded = false;
        this.targetPlayerHeight = PLAYER_TOTAL_HEIGHT;
        this.isCrouching = false;
        this.updateMeshAndCamera();
    }

    updateMeshAndCamera() {
        const pos = this.playerBody.translation();
        this.playerMesh.position.set(pos.x, pos.y, pos.z);
        this.camera.position.copy(this.playerMesh.position);
    }

    update(deltaTime) {
        // --- Movement Input ---
        let move = new THREE.Vector3();
        let input = this.input || {};

        // Compute speed (preserve modifiers)
        let baseSpeed = MAX_SPEED;
        let moveSpeed = baseSpeed * this.speedModifier *
            (input.crouch ? 0.3 : input.slow ? 0.5 : this.isAim ? 0.65 : 1);

        if (input.forward) move.z -= 1;
        if (input.backward) move.z += 1;
        if (input.left) move.x -= 1;
        if (input.right) move.x += 1;
        if (move.lengthSq() > 0) {
            move.normalize();
            // Rotate by camera Y
            const angle = this.camera.rotation.y;
            const moveWorld = new THREE.Vector3(
                move.x * Math.cos(angle) - move.z * Math.sin(angle),
                0,
                move.x * Math.sin(angle) + move.z * Math.cos(angle)
            );
            move = moveWorld.multiplyScalar(moveSpeed * deltaTime);
        }

        // --- Crouch logic ---
        let desiredHeight = input.crouch ? this.crouchHeight : PLAYER_TOTAL_HEIGHT;
        if (Math.abs(this.targetPlayerHeight - desiredHeight) > 0.001) {
            this.targetPlayerHeight = THREE.MathUtils.lerp(this.targetPlayerHeight, desiredHeight, CROUCH_SPEED * deltaTime);
            // Update Rapier collider shape
            let capsuleHalfHeight = (this.targetPlayerHeight / 2) - this.playerRadius;
            this.playerCollider.setShape(RAPIER.ColliderDesc.capsule(capsuleHalfHeight, this.playerRadius).shape);
            // Update mesh size
            this.playerMesh.geometry = new THREE.CapsuleGeometry(this.playerRadius, this.targetPlayerHeight - 2 * this.playerRadius, 8, 16);
        }

        // --- Grounded check ---
        const playerPos = this.playerBody.translation();
        const rayOrigin = { x: playerPos.x, y: playerPos.y - this.targetPlayerHeight / 2 - 0.01, z: playerPos.z };
        const rayDir = { x: 0, y: -1, z: 0 };
        const rayLen = 0.2;
        const hit = this.world.castRay(new RAPIER.Ray(rayOrigin, rayDir), rayLen, true);
        this.isGrounded = !!hit;

        // --- Jump logic ---
        if (input.jump && this.isGrounded) {
            this.playerVelocity.y = JUMP_VELOCITY;
        }

        // --- Gravity ---
        if (!this.isGrounded) {
            this.playerVelocity.y -= GRAVITY * deltaTime;
        } else if (this.playerVelocity.y < 0) {
            this.playerVelocity.y = 0;
        }

        // --- Acceleration/Deceleration ---
        // Horizontal velocity (x,z) preserved from your "returns"
        let accel = this.isGrounded ? PLAYER_ACCEL_GROUND : PLAYER_ACCEL_AIR;
        let decel = this.isGrounded ? PLAYER_DECEL_GROUND : PLAYER_DECEL_AIR;
        this.playerVelocity.x = THREE.MathUtils.lerp(this.playerVelocity.x, move.x / deltaTime, accel * deltaTime);
        this.playerVelocity.z = THREE.MathUtils.lerp(this.playerVelocity.z, move.z / deltaTime, accel * deltaTime);
        // If no movement input, decelerate
        if (move.lengthSq() === 0) {
            this.playerVelocity.x = THREE.MathUtils.lerp(this.playerVelocity.x, 0, decel * deltaTime);
            this.playerVelocity.z = THREE.MathUtils.lerp(this.playerVelocity.z, 0, decel * deltaTime);
        }

        // --- Apply movement ---
        const newPos = {
            x: playerPos.x + this.playerVelocity.x * deltaTime,
            y: playerPos.y + this.playerVelocity.y * deltaTime,
            z: playerPos.z + this.playerVelocity.z * deltaTime
        };
        this.playerBody.setNextKinematicTranslation(newPos);

        // --- Step physics world ---
        this.world.step();

        // --- Sync mesh and camera ---
        this.updateMeshAndCamera();

        // --- Returns for networking/etc. ---
        return {
            x: round2(this.playerMesh.position.x),
            y: round2(this.playerMesh.position.y),
            z: round2(this.playerMesh.position.z),
            rotY: this.camera.rotation.y,
            isGrounded: this.isGrounded,
            velocity: this.playerVelocity.clone(),
            velocityY: this.playerVelocity.y
        };
    }
}

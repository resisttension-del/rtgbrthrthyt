// js/player.js
import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";
import { createHealthBar } from "./ui.js";

// In your game.js or player.js file

// In your game.js or player.js file

export class Player {
  constructor(playerId, username, initialHealth, initialShield, initialWeapon) { // ADD THESE PARAMETERS
    this.id        = playerId;
    this.username  = username;

    this.position  = new THREE.Vector3();
    this.rotationY = 0;
    this.health    = initialHealth; // Assign initial health
    this.shield    = initialShield; // Assign initial shield
    this.weapon    = initialWeapon; // Assign initial weapon
    this.kills     = 0;
    this.deaths    = 0;
    this.ks        = 0;
    this.isDead    = false; // Initial death state for the Player instance

    this.group = new THREE.Group();

    // BODY: taller cylinder, random shirt color
    this.bodyHeight = 4;
    const halfBody   = this.bodyHeight / 2;
    const shirtColor = new THREE.Color(Math.random(), Math.random(), Math.random());
    const bodyGeom   = new THREE.CylinderGeometry(0.5, 0.5, this.bodyHeight, 16);
    const bodyMat    = new THREE.MeshStandardMaterial({ color: shirtColor });
    this.bodyMesh    = new THREE.Mesh(bodyGeom, bodyMat);
    // Center the cylinder in the group:
    this.bodyMesh.position.y = halfBody;
    this.group.add(this.bodyMesh);

    // HEAD: smaller sphere atop the body
    const headRadius = 0.1;
    const headGeom   = new THREE.SphereGeometry(headRadius, 12, 12);
    const headMat    = new THREE.MeshStandardMaterial({ color: 0xffff00 });
    this.headMesh    = new THREE.Mesh(headGeom, headMat);
    this.headMesh.position.y = halfBody + headRadius + 0.1; // a little gap
    this.headMesh.userData = { isPlayerBodyPart: true, isPlayerHead: true, playerId: this.id };
    this.group.add(this.headMesh);

    // SMILE
    this.smile = new THREE.Mesh(
      new THREE.PlaneGeometry(0.3, 0.15),
      new THREE.MeshBasicMaterial({ color: 0x000000 })
    );
    this.smile.position.set(0, this.headMesh.position.y + 0.05, 0.3);
    this.group.add(this.smile);

    // HEALTH BAR
    this.healthBar = createHealthBar();
    this.group.add(this.healthBar.group);

    // Initial add to scene
    window.scene.add(this.group);
    this._lastHealth = this.health;
  }

  setHealth(newHealth) {
    this.health = newHealth;
    // console.log(`Health updated to: ${this.health}`);
  }

  setShield(newShield) {
    this.shield = newShield;
    // console.log(`Shield updated to: ${this.shield}`);
  }

  applyData(data) {
    // Pulse red on damage
    if (data.health < this._lastHealth) {
      this._pulseRed();
    }
    this._lastHealth = data.health;

    // Use setHealth and setShield here as well, if you want their internal logic to run
    this.setHealth(data.health);
    this.setShield(data.shield);

    // Update stats
    Object.assign(this, {
      weapon: data.weapon,
      kills: data.kills,
      deaths: data.deaths,
      ks: data.ks,
    });

    // Position group so bottom of body (y=0) sits on floor.
    // data.y is camera-eye height (e.g. 1.6). We want groupY = data.y - halfBody.
    const halfBody = this.bodyHeight / 2;
    this.position.set(
      data.x,
      data.y - halfBody,
      data.z
    );
    this.rotationY = data.rotY;
  }

  update(delta) {
    // Smoothly interpolate to the target position & rotation
    this.group.position.lerp(this.position, 0.1);
    this.group.rotation.y = THREE.MathUtils.lerp(
      this.group.rotation.y,
      this.rotationY,
      0.1
    );

    // Update health bar above head
    const halfBody = this.bodyHeight / 2;
    const headRadius = 0.2;
    this.healthBar.update(this.health, this.shield);
    this.healthBar.group.position.set(
      this.group.position.x,
      this.group.position.y + halfBody + headRadius + 0.5,
      this.group.position.z
    );
  }

  _pulseRed() {
    this.bodyMesh.material.emissive.setHex(0xff0000);
    setTimeout(() => {
      this.bodyMesh.material.emissive.setHex(0x000000);
    }, 200);
  }

  dispose() {
    window.scene.remove(this.group);
  }
}

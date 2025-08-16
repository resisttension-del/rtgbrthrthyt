// AudioManager.js
import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.152.0/three.module.js";

export class AudioManager {
    constructor(camera, scene) {
        this.camera = camera;
        this.scene = scene;
        this.listener = new THREE.AudioListener();
        camera.add(this.listener);
        this.loader = new THREE.AudioLoader();
        this.active = new Set();
        const resume = () => {
            const ctx = this.listener.context;
            if (ctx.state === "suspended") ctx.resume().finally(() => {});
            document.removeEventListener("click", resume);
            document.removeEventListener("touchstart", resume);
        };
        document.addEventListener("click", resume);
        document.addEventListener("touchstart", resume);
        console.log("AudioManager initialized. Listener attached to camera:", camera.uuid);
    }

    playSpatial(url, worldPosition, { loop = false, volume = 1, hearingRange = 100, rolloffFactor = 2, distanceModel = 'linear' } = {}) {
        const pa = new THREE.PositionalAudio(this.listener);
        pa.position.copy(worldPosition);
        pa.setLoop(loop);

        // --- Changes to make fall-off less harsh ---

        // Option 1: Lower the rolloffFactor (most impactful for 'linear' and 'inverse')
        // A smaller rolloffFactor means the volume decreases more slowly.
        // For 'linear' and 'inverse' models, values between 0.1 and 1.5 are common.
        // Let's try a default of 1 for a gentler linear falloff.
        pa.setRolloffFactor(rolloffFactor); // Keep the parameter, but the default can be changed if desired

        // Option 2: Increase refDistance
        // The sound is at full volume (or the specified volume) at this distance.
        // Increasing this means the sound stays louder for longer as you move away from the source.
        // Defaulting to 1 is fine if you want sounds to be loud only when very close,
        // but increasing it to, say, 5 or 10, will make the initial falloff much less noticeable.
        pa.setRefDistance(1); // Usually 1, the distance at which volume is 100%. Consider increasing this if sounds are too quiet too quickly.

        // Option 3: Change the distanceModel
        // 'linear': Volume drops linearly. Can feel abrupt.
        // 'inverse': Volume drops off more smoothly initially, then faster. Often feels natural.
        // 'exponential': Volume drops off very quickly.
        // 'inverse' often provides a more natural and less harsh falloff than 'linear' for spatial audio.
        pa.setDistanceModel(distanceModel); // Keep the parameter, but consider passing 'inverse'

        // Example suggested modifications for less harsh falloff:
        // pa.setRefDistance(5); // Sound remains at full volume until 5 units away
        // pa.setRolloffFactor(1); // Slower decrease in volume after refDistance
        // pa.setDistanceModel('inverse'); // More natural falloff curve

        // You're currently using the passed parameters, which is good for flexibility.
        // To make the default less harsh, you could change the default values in the function signature:
        // playSpatial(url, worldPosition, { loop = false, volume = 1, hearingRange = 100, rolloffFactor = 1, distanceModel = 'inverse' } = {}) {
        //                                                                                ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
        // This makes the default behavior less harsh for all calls that don't explicitly override these.

        pa.setMaxDistance(hearingRange); // Sounds beyond this distance will be silent.
        pa.setVolume(volume);

        this.scene.add(pa);
        this.active.add(pa);

        this.loader.load(
            url,
            (buffer) => {
                pa.setBuffer(buffer);
                pa.play();
                if (!loop) {
                    pa.source.onended = () => {
                        this.scene.remove(pa);
                        this.active.delete(pa);
                    };
                }
            },
            undefined,
            (err) => {
                console.error(`Error loading spatial sound "${url}":`, err);
                this.scene.remove(pa);
                this.active.delete(pa);
            }
        );
        return loop ? pa : null;
    }

    stopLoop(pa) {
        if (!pa) return;
        pa.stop();
        if (pa.source && typeof pa.source.disconnect === "function") {
            try {
                pa.source.disconnect();
            } catch (e) {
                console.error("Error disconnecting audio source:", e);
            }
        }
        this.scene.remove(pa);
        this.active.delete(pa);
    }

    stopAll() {
        for (const pa of Array.from(this.active)) {
            pa.stop();
            this.scene.remove(pa);
            this.active.delete(pa);
        }
    }
}

let audioManagerInstance = null; // Ensure this is declared if not elsewhere

export function initializeAudioManager(camera, scene) {
    console.log("Attempting to initialize AudioManager...");
    console.log("Camera received:", camera);
    console.log("Scene received:", scene);

    if (!camera || !scene) {
        console.error("Cannot initialize AudioManager: Camera or Scene are undefined/null. AudioManager will not be created.");
        return;
    }
    if (audioManagerInstance) {
        console.warn("AudioManager already initialized. Stopping existing sounds and reinitializing.");
        audioManagerInstance.stopAll();
    }
    audioManagerInstance = new AudioManager(camera, scene);
    window.audioManager = audioManagerInstance;
    console.log("AudioManager successfully initialized with camera:", camera.uuid, "at initial position:", camera.position.toArray());
}

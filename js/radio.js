// radio.js
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const PLAYLIST = [
  { key: 'void_lounge', title: 'The Void Lounge', url: 'https://codehs.com/uploads/8bbf4cb8b0b64ccc8e6b96f5c3c4ebb7' },
  { key: 'studying_void', title: 'studying... in the Void', url: 'https://codehs.com/uploads/7ecafd99fa4bfd14ec27a59a2821a8d8' },
  { key: 'its_void_time', title: "it's Void Time", url: 'https://codehs.com/uploads/a2a5789063a06479c8005ad96b699953' },
  { key: 'on_hold_void', title: 'On Hold with the Void', url: 'https://codehs.com/uploads/85c826714d91eaff68276676d5351651' },
  { key: 'void_runners', title: 'Void Runners', url: 'https://codehs.com/uploads/c53346de1259c62fb8fb0cff8789c2f0' },
];

const DEFAULT_MODEL = 'https://raw.githubusercontent.com/thearthd/3d-models/main/bluetooth_music_boombox.glb';

export async function createBoombox(scene, position = new THREE.Vector3(0, 0, 0), options = {}) {
  const cfg = {
    eventsRef: options.eventsRef || null,      // expects /game/radio
    autoListen: options.autoListen !== false,
    autoPlayOnJoin: options.autoPlayOnJoin !== false,
    modelUrl: options.modelUrl || DEFAULT_MODEL,
    autoAdvance: options.autoAdvance !== false  // owner auto-advances by default
  };

  // server offset ref
  let serverTimeOffset = 0;
  if (typeof firebase !== 'undefined' && firebase.database) {
    const offsetRef = firebase.database().ref('.info/serverTimeOffset');
    offsetRef.on('value', snap => {
      const val = snap.val();
      if (typeof val === 'number') serverTimeOffset = val;
    });
  } else {
    console.warn('createBoombox: firebase not present. Radio sync will be local-only.');
  }

  // create 3d parent
  const parent = new THREE.Group();
  parent.name = 'Boombox';
  parent.position.copy(position);
  scene.add(parent);

  // load model
  const loader = new GLTFLoader();
  try {
    const gltf = await new Promise((res, rej) => loader.load(cfg.modelUrl, res, undefined, rej));
    const model = gltf.scene || gltf.scenes?.[0] || new THREE.Group();
    model.traverse(c => {
      if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; }
    });
    parent.add(model);
    model.position.set(0, 0, 0);
  } catch (e) {
    console.warn('createBoombox: failed to load model, using placeholder.', e);
    const placeholder = new THREE.Mesh(new THREE.BoxGeometry(1, 0.6, 0.4), new THREE.MeshStandardMaterial({ color: 0x444444 }));
    placeholder.position.set(0, 0.3, 0);
    parent.add(placeholder);
  }

  // state
  let lastHandledKey = null;
  let playingNode = null;   // PositionalAudio instance or HTMLAudioElement
  let playingSongIndex = -1;
  const eventsRef = cfg.eventsRef || null;
  const currentRef = eventsRef ? eventsRef.child('current') : null;
  const ownerRef = eventsRef ? eventsRef.child('owner') : null;

  function serverNowMillis() { return Date.now() + serverTimeOffset; }
  function computeElapsedSecondsFromServer(serverTimestamp) {
    if (!serverTimestamp || typeof serverTimestamp !== 'number') return 0;
    const now = serverNowMillis();
    return Math.max(0, (now - serverTimestamp) / 1000);
  }

  async function playUsingAudioManager(entry, elapsedSec) {
    // audioManager.playSpatial handles startOffset internally (we modified it)
    if (!window.audioManager) {
      return false;
    }
    try {
      // stop previous
      if (playingNode && typeof window.audioManager.stopLoop === 'function') {
        try { window.audioManager.stopLoop(playingNode); } catch (e) {}
      }
      // request a one-shot or loop (we use loop=false)
      const pa = window.audioManager.playSpatial(
        entry.url,
        parent.getWorldPosition(new THREE.Vector3()),
        { loop: false, volume: 0.45, hearingRange: 180, rolloffFactor: 1, distanceModel: 'inverse', startOffset: elapsedSec }
      );
      playingNode = pa;
      // if auto-advance is desired, we attempt to hook into pa.source.onended (see AudioManager implementation)
      if (pa && cfg.autoAdvance && ownerRef) {
        // pa.source may be set by AudioManager when buffer is started manually
        // attach onended if available
        const attachEnd = () => {
          const src = pa.source;
          if (src) {
            src.onended = async () => {
              // only the owner should write the next event
              if (!ownerRef) return;
              const snap = await ownerRef.once('value');
              if (snap.val() !== (window.localPlayer?.id || localPlayerId)) return;
              const next = Math.floor(Math.random() * PLAYLIST.length);
              await eventsRef.child('current').set({
                songIndex: next,
                serverTime: firebase.database.ServerValue.TIMESTAMP,
                startedBy: window.localPlayer?.id || localPlayerId || null
              });
            };
          } else {
            // fallback: we don't have a clean onended reference; no auto-advance here
          }
        };
        // try attaching immediately, but buffer may not be set yet. attempt a short wait then attach
        setTimeout(attachEnd, 250);
        setTimeout(attachEnd, 1000);
      }
      return true;
    } catch (e) {
      console.warn('playUsingAudioManager failed:', e);
      return false;
    }
  }

  async function playUsingHTMLAudio(entry, elapsedSec) {
    // fallback: HTMLAudioElement with .currentTime
    try {
      if (playingNode && playingNode.pause) {
        try { playingNode.pause(); } catch (e) {}
      }
      const audio = new Audio();
      audio.crossOrigin = 'anonymous';
      audio.src = entry.url;
      audio.preload = 'auto';
      audio.loop = false;

      const onMeta = () => {
        const duration = (isFinite(audio.duration) && audio.duration > 0) ? audio.duration : null;
        let start = elapsedSec;
        if (duration) start = elapsedSec % duration;
        try { audio.currentTime = Math.min(start, (duration ? duration - 0.01 : start)); } catch (e) { audio.currentTime = 0; }
        const p = audio.play();
        if (p && typeof p.catch === 'function') {
          p.catch(err => console.warn('HTML audio autoplay blocked:', err));
        }
      };
      audio.addEventListener('loadedmetadata', onMeta);
      audio.addEventListener('error', (e) => console.warn('HTMLAudio load error', e));
      // auto-advance if owner
      if (cfg.autoAdvance && ownerRef) {
        audio.addEventListener('ended', async () => {
          const snap = await ownerRef.once('value');
          if (snap.val() !== (window.localPlayer?.id || localPlayerId)) return;
          const next = Math.floor(Math.random() * PLAYLIST.length);
          await eventsRef.child('current').set({
            songIndex: next,
            serverTime: firebase.database.ServerValue.TIMESTAMP,
            startedBy: window.localPlayer?.id || localPlayerId || null
          });
        });
      }
      playingNode = audio;
      return true;
    } catch (e) {
      console.warn('playUsingHTMLAudio failed:', e);
      return false;
    }
  }

  async function handleRemoteCurrent(val) {
    if (!val) return;
    const serverTime = val.serverTime;
    const songIndex = Number(val.songIndex);
    if (!Number.isFinite(songIndex) || songIndex < 0 || songIndex >= PLAYLIST.length) {
      console.warn('createBoombox: invalid songIndex in radio/current', val);
      return;
    }
    const key = `${songIndex}:${serverTime}`;
    if (key === lastHandledKey) return;
    lastHandledKey = key;
    playingSongIndex = songIndex;

    const elapsed = computeElapsedSecondsFromServer(serverTime);
    const entry = PLAYLIST[songIndex];

    // Try spatial playback first if available
    let used = false;
    if (window.audioManager) {
      used = await playUsingAudioManager(entry, elapsed);
    }
    if (!used) {
      // fallback to HTML audio
      await playUsingHTMLAudio(entry, elapsed);
    }
  }

  if (currentRef && cfg.autoListen) {
    currentRef.on('value', snap => {
      const val = snap.val();
      handleRemoteCurrent(val);
    });
    if (cfg.autoPlayOnJoin) {
      currentRef.once('value', snap => {
        const val = snap.val();
        handleRemoteCurrent(val);
      });
    }
  }

  // triggerPlay should respect owner if ownerRef present
  async function triggerPlay(songIndex = null) {
    if (!eventsRef) {
      console.warn('createBoombox.triggerPlay: no eventsRef configured; cannot broadcast.');
      return;
    }
    // If ownerRef exists, ensure caller is owner
    if (ownerRef) {
      const snap = await ownerRef.once('value');
      if (snap.val() !== (window.localPlayer?.id || localPlayerId)) {
        console.warn('Cannot start radio: you are not radio owner.');
        return;
      }
    }
    const idx = (Number.isFinite(songIndex) && songIndex >= 0 && songIndex < PLAYLIST.length)
      ? songIndex
      : Math.floor(Math.random() * PLAYLIST.length);

    const payload = {
      songIndex: idx,
      serverTime: firebase.database.ServerValue.TIMESTAMP,
      startedBy: (window.localPlayer && window.localPlayer.id) ? window.localPlayer.id : (localPlayerId || null)
    };
    try {
      await eventsRef.child('current').set(payload);
      console.log('createBoombox: pushed radio/current', payload);
    } catch (e) {
      console.warn('createBoombox: failed to push radio/current', e);
    }
  }

  function stop() {
    try {
      if (!playingNode) return;
      // if PositionalAudio and audioManager has stopLoop, use it
      if (playingNode.isPositionalAudio && window.audioManager && typeof window.audioManager.stopLoop === 'function') {
        try { window.audioManager.stopLoop(playingNode); } catch (e) {}
      } else if (playingNode.pause) {
        try { playingNode.pause(); } catch (e) {}
      } else if (playingNode.stop) {
        try { playingNode.stop(); } catch (e) {}
      }
      playingNode = null;
    } catch (e) { console.warn('Error stopping playing node:', e); }
  }

  function destroy() {
    try { if (currentRef) currentRef.off(); } catch (e) {}
    try { if (ownerRef) ownerRef.off(); } catch (e) {}
    stop();
    try { scene.remove(parent); } catch (e) {}
  }

  return {
    triggerPlay,
    stop,
    destroy,
    object3d: parent,
    playlist: PLAYLIST,
    handleRemotePlay: (si, serverTime, startedBy) => handleRemoteCurrent({ songIndex: si, serverTime, startedBy })
  };
}

(() => {
  "use strict";

  const STORAGE_KEY = "johnJoySoundPadCustom";

  const ambientsGrid = document.getElementById("ambients-grid");
  const effectsGrid = document.getElementById("effects-grid");
  const pitchSlider = document.getElementById("pitch");
  const gainSlider = document.getElementById("gain");
  const pitchValue = document.getElementById("pitch-value");
  const gainValue = document.getElementById("gain-value");
  const stopAllBtn = document.getElementById("stop-all");
  const fileInput = document.getElementById("file-input");

  let audioCtx = null;
  let masterGain = null;
  let pitch = 1;
  let gain = 0.85;

  const activeLoops = new Map();
  const customSounds = loadCustomSounds();
  let pendingUploadPadId = null;
  let longPressTimer = null;

  function ensureAudio() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = gain;
      masterGain.connect(audioCtx.destination);
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }
    return audioCtx;
  }

  function loadCustomSounds() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function saveCustomSounds() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(customSounds));
  }

  function createPad(item, isLoop) {
    const btn = document.createElement("button");
    btn.className = `pad${isLoop ? " loop" : ""}`;
    btn.dataset.id = item.id;
    btn.dataset.loop = isLoop ? "1" : "0";
    btn.innerHTML = `<span>${item.label}</span>`;
    if (customSounds[item.id]) {
      btn.classList.add("custom");
    }
    return btn;
  }

  function renderPads() {
    window.SOUND_PAD.ambients.forEach((item) => {
      ambientsGrid.appendChild(createPad(item, true));
    });
    window.SOUND_PAD.effects.forEach((item) => {
      effectsGrid.appendChild(createPad(item, false));
    });
  }

  function makeNoise(duration, type = "white") {
    const ctx = ensureAudio();
    const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i += 1) {
      const v = Math.random() * 2 - 1;
      data[i] = type === "brown" ? v * 0.35 : v;
    }
    return buffer;
  }

  function connectNode(node, endGain = 0.8) {
    const g = audioCtx.createGain();
    g.gain.value = endGain * gain;
    node.connect(g);
    g.connect(masterGain);
    return g;
  }

  function playTone(freq, duration, type = "sine", volume = 0.25) {
    const ctx = ensureAudio();
    const osc = ctx.createOscillator();
    const g = connectNode(osc, volume);
    osc.type = type;
    osc.frequency.value = freq * pitch;
    osc.start();
    osc.stop(ctx.currentTime + duration);
    osc.onended = () => {
      osc.disconnect();
      g.disconnect();
    };
  }

  function playKick() {
    const ctx = ensureAudio();
    const osc = ctx.createOscillator();
    const g = connectNode(osc, 0.9);
    osc.frequency.setValueAtTime(150 * pitch, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(40 * pitch, ctx.currentTime + 0.25);
    g.gain.setValueAtTime(0.9 * gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  }

  function playSweep(start, end, duration, type = "sine") {
    const ctx = ensureAudio();
    const osc = ctx.createOscillator();
    const g = connectNode(osc, 0.35);
    osc.type = type;
    osc.frequency.setValueAtTime(start * pitch, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, end * pitch), ctx.currentTime + duration);
    g.gain.setValueAtTime(0.35 * gain, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0, ctx.currentTime + duration);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }

  function playNoiseBurst(duration, filterFreq = 800, volume = 0.3) {
    const ctx = ensureAudio();
    const src = ctx.createBufferSource();
    src.buffer = makeNoise(duration);
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = filterFreq * pitch;
    const g = connectNode(filter, volume);
    src.connect(filter);
    src.start();
    src.stop(ctx.currentTime + duration);
  }

  function playChime(notes, gap = 0.12) {
    notes.forEach((n, i) => {
      setTimeout(() => playTone(n, 0.18, "triangle", 0.22), i * gap * 1000);
    });
  }

  const effectGenerators = {
    "john-joy": () => playChime([392, 494, 587, 784]),
    "sand-gravel": () => {
      playChime([330, 392, 440, 523]);
      setTimeout(() => playNoiseBurst(0.4, 600, 0.2), 200);
    },
    "best-quality": () => playChime([523, 659, 784, 988]),
    "ready-travel": () => playSweep(300, 900, 0.35),
    "truck-horn": () => {
      playTone(220 * pitch, 0.35, "square", 0.18);
      setTimeout(() => playTone(180 * pitch, 0.35, "square", 0.18), 120);
    },
    "air-horn": () => playSweep(400, 1200, 0.5, "sawtooth"),
    "boom-boom": () => {
      playKick();
      setTimeout(playKick, 220);
    },
    whoosh: () => playSweep(2000, 80, 0.45, "sine"),
    "crowd-hey": () => {
      playNoiseBurst(0.15, 1200, 0.25);
      setTimeout(() => playChime([440, 554, 659]), 80);
    },
    "clap-stomp": () => {
      playNoiseBurst(0.06, 2000, 0.5);
      setTimeout(() => playKick(), 120);
    },
    "engine-rev": () => playSweep(80, 420, 0.8, "sawtooth"),
    "load-dump": () => playNoiseBurst(0.9, 400, 0.45),
    siren: () => {
      playTone(660 * pitch, 0.2, "triangle", 0.2);
      setTimeout(() => playTone(880 * pitch, 0.2, "triangle", 0.2), 200);
      setTimeout(() => playTone(660 * pitch, 0.2, "triangle", 0.2), 400);
    },
    "cash-ding": () => playTone(1318, 0.5, "sine", 0.3),
    "gravel-pour": () => playNoiseBurst(1.2, 900, 0.35),
    jackhammer: () => {
      for (let i = 0; i < 8; i += 1) {
        setTimeout(() => playNoiseBurst(0.04, 300, 0.35), i * 70);
      }
    },
    "zoom-zoom": () => {
      playSweep(200, 1800, 0.25);
      setTimeout(() => playSweep(200, 1800, 0.25), 280);
    },
    "lets-go": () => playChime([523, 659, 784, 988, 1175]),
    "woah-oh": () => playChime([392, 494, 587, 494, 392]),
    "build-it": () => playChime([440, 440, 554, 659]),
    "order-now": () => playChime([880, 880, 988, 1175]),
    "tara-na": () => playChime([659, 784, 988]),
    "number-one": () => playChime([523, 659, 784, 988, 1175, 988]),
    "digidi-hey": () => {
      playChime([440, 494, 523, 587]);
      setTimeout(() => playTone(784, 0.2, "square", 0.2), 360);
    },
    "gravel-hook": () => {
      for (let i = 0; i < 4; i += 1) {
        setTimeout(() => playTone(330 + i * 20, 0.08, "square", 0.15), i * 100);
      }
      setTimeout(() => playTone(880, 0.25, "square", 0.25), 450);
    },
    "fast-delivery": () => playSweep(500, 1500, 0.3),
    "strong-foundation": () => {
      playKick();
      setTimeout(() => playTone(110, 0.4, "sawtooth", 0.2), 100);
    },
    "everybody-noise": () => {
      playNoiseBurst(0.3, 1500, 0.35);
      playChime([523, 659, 784]);
    },
    "load-it-up": () => {
      playChime([392, 494]);
      setTimeout(() => playNoiseBurst(0.5, 500, 0.3), 200);
    },
    "drive-away": () => playSweep(300, 100, 0.6, "sawtooth"),
    "winning-race": () => playChime([659, 784, 988, 1175, 1319]),
    "call-us-now": () => playChime([988, 988, 1175, 988]),
    "truck-ready": () => {
      playTone(220, 0.15, "square", 0.15);
      setTimeout(playKick, 180);
    },
    "glass-break": () => playNoiseBurst(0.35, 4000, 0.4),
    explosion: () => {
      playKick();
      playNoiseBurst(0.6, 200, 0.5);
    },
    "record-scratch": () => playNoiseBurst(0.25, 6000, 0.35),
    "laser-zap": () => playSweep(1800, 120, 0.2, "square"),
    "party-horn": () => playChime([523, 659, 784, 988, 784, 659, 523]),
    "bye-bye": () => playChime([784, 659, 523, 392]),
  };

  function createLoopNodes(id) {
    const ctx = ensureAudio();
    const nodes = [];
    const output = ctx.createGain();
    output.gain.value = 0.35 * gain;
    output.connect(masterGain);

    const loops = {
      "site-hum": () => {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = 55 * pitch;
        osc.connect(output);
        osc.start();
        nodes.push(osc);
      },
      "truck-idle": () => {
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = 42 * pitch;
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 120;
        osc.connect(filter);
        filter.connect(output);
        osc.start();
        nodes.push(osc, filter);
      },
      "wind-blow": () => {
        const src = ctx.createBufferSource();
        src.buffer = makeNoise(2, "brown");
        src.loop = true;
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 500 * pitch;
        src.connect(filter);
        filter.connect(output);
        src.start();
        nodes.push(src, filter);
      },
      generator: () => {
        const osc = ctx.createOscillator();
        osc.type = "square";
        osc.frequency.value = 90 * pitch;
        const g = ctx.createGain();
        g.gain.value = 0.08;
        osc.connect(g);
        g.connect(output);
        osc.start();
        nodes.push(osc, g);
      },
      "road-traffic": () => {
        const src = ctx.createBufferSource();
        src.buffer = makeNoise(1.5);
        src.loop = true;
        const filter = ctx.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.value = 300 * pitch;
        src.connect(filter);
        filter.connect(output);
        src.start();
        nodes.push(src, filter);
      },
      "rain-roof": () => {
        const src = ctx.createBufferSource();
        src.buffer = makeNoise(1);
        src.loop = true;
        const filter = ctx.createBiquadFilter();
        filter.type = "highpass";
        filter.frequency.value = 2000 * pitch;
        src.connect(filter);
        filter.connect(output);
        src.start();
        nodes.push(src, filter);
      },
      "bass-pulse": () => {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = 60 * pitch;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 2;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 0.25;
        lfo.connect(lfoGain);
        lfoGain.connect(output.gain);
        osc.connect(output);
        osc.start();
        lfo.start();
        nodes.push(osc, lfo, lfoGain);
      },
      "crowd-loop": () => {
        const src = ctx.createBufferSource();
        src.buffer = makeNoise(0.5);
        src.loop = true;
        const filter = ctx.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.value = 900 * pitch;
        src.connect(filter);
        filter.connect(output);
        src.start();
        nodes.push(src, filter);
      },
      "drone-rumble": () => {
        const osc = ctx.createOscillator();
        osc.type = "triangle";
        osc.frequency.value = 38 * pitch;
        osc.connect(output);
        osc.start();
        nodes.push(osc);
      },
      heartbeat: () => {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = 50 * pitch;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 1.2;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 0.4;
        lfo.connect(lfoGain);
        lfoGain.connect(output.gain);
        osc.connect(output);
        osc.start();
        lfo.start();
        nodes.push(osc, lfo, lfoGain);
      },
    };

    if (loops[id]) loops[id]();
    return { nodes, output };
  }

  async function playCustomSound(id, loop) {
    const entry = customSounds[id];
    if (!entry?.data) return false;

    const ctx = ensureAudio();
    const binary = atob(entry.data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

    const buffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = loop;
    src.playbackRate.value = pitch;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    g.connect(masterGain);
    src.start();

    if (loop) {
      activeLoops.set(id, { nodes: [src], output: g, custom: true });
    } else {
      src.onended = () => {
        src.disconnect();
        g.disconnect();
      };
    }
    return true;
  }

  function stopLoop(id) {
    const loop = activeLoops.get(id);
    if (!loop) return;
    loop.nodes.forEach((n) => {
      try {
        n.stop?.();
        n.disconnect?.();
      } catch {
        /* already stopped */
      }
    });
    loop.output?.disconnect?.();
    activeLoops.delete(id);
  }

  function stopAll() {
    activeLoops.forEach((_, id) => stopLoop(id));
    document.querySelectorAll(".pad.playing").forEach((p) => p.classList.remove("playing"));
  }

  async function triggerPad(pad) {
    ensureAudio();
    window.jjHaptic?.(15);
    const id = pad.dataset.id;
    const isLoop = pad.dataset.loop === "1";

    if (isLoop) {
      if (activeLoops.has(id)) {
        stopLoop(id);
        pad.classList.remove("playing");
        return;
      }
      stopAll();
      document.querySelectorAll(".pad.playing").forEach((p) => p.classList.remove("playing"));

      if (customSounds[id]) {
        const ok = await playCustomSound(id, true);
        if (ok) {
          pad.classList.add("playing");
          return;
        }
      }

      const loop = createLoopNodes(id);
      activeLoops.set(id, loop);
      pad.classList.add("playing");
      return;
    }

    pad.classList.add("playing");
    setTimeout(() => pad.classList.remove("playing"), 180);

    if (customSounds[id]) {
      await playCustomSound(id, false);
      return;
    }

    const fn = effectGenerators[id];
    if (fn) fn();
  }

  function bindPadEvents(pad) {
    const startPress = () => {
      longPressTimer = setTimeout(() => {
        requestUploadForPad(pad.dataset.id);
      }, 600);
    };

    const endPress = (e) => {
      if (e.button !== 0) return;
      clearTimeout(longPressTimer);
      if (pendingUploadPadId) return;
      e.preventDefault();
      triggerPad(pad);
    };

    pad.addEventListener("mousedown", startPress);
    pad.addEventListener("mouseup", endPress);
    pad.addEventListener("mouseleave", () => clearTimeout(longPressTimer));
    pad.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      clearTimeout(longPressTimer);
      requestUploadForPad(pad.dataset.id);
    });
    pad.addEventListener("touchstart", (e) => {
      startPress();
      e.preventDefault();
    }, { passive: false });
    pad.addEventListener("touchend", endPress);
    pad.addEventListener("touchcancel", () => clearTimeout(longPressTimer));
  }

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file || !pendingUploadPadId) return;

    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(",")[1];
      customSounds[pendingUploadPadId] = {
        name: file.name,
        data: base64,
      };
      saveCustomSounds();
      const pad = document.querySelector(`.pad[data-id="${pendingUploadPadId}"]`);
      pad?.classList.add("custom");
      pendingUploadPadId = null;
    };
    reader.readAsDataURL(file);
  });

  pitchSlider.addEventListener("input", () => {
    pitch = parseFloat(pitchSlider.value);
    pitchValue.textContent = `${pitch.toFixed(2)}x`;
  });

  gainSlider.addEventListener("input", () => {
    gain = parseFloat(gainSlider.value);
    gainValue.textContent = `${Math.round(gain * 100)}%`;
    if (masterGain) masterGain.gain.value = gain;
  });

  function requestUploadForPad(id) {
    pendingUploadPadId = id;
    fileInput.click();
  }

  function triggerById(id) {
    const pad = document.querySelector(`.pad[data-id="${id}"]`);
    if (pad) triggerPad(pad);
  }

  function getShortcutMap() {
    const keys = [
      "1", "2", "3", "4", "5", "6", "7", "8", "9", "0",
      "q", "w", "e", "r", "t", "y", "u", "i", "o", "p",
      "a", "s", "d", "f", "g", "h", "j", "k", "l", ";",
      "z", "x", "c", "v", "b", "n", "m", ",", ".", "/",
    ];
    const map = {};
    window.SOUND_PAD.effects.forEach((effect, index) => {
      if (keys[index]) map[keys[index]] = effect.id;
    });
    return map;
  }

  stopAllBtn.addEventListener("click", stopAll);

  renderPads();
  document.querySelectorAll(".pad").forEach(bindPadEvents);

  window.jjPad = {
    triggerById,
    uploadToPad: requestUploadForPad,
    stopAll,
    getShortcuts: getShortcutMap,
  };
})();

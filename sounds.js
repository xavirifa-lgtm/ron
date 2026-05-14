let audioCtx = null;

export function resume() {
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}

function getCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    resume();
    return audioCtx;
}

export function playBeep(freq = 440, type = 'square', duration = 0.1, vol = 0.1) {
    try {
        const ctx  = getCtx();
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        gain.gain.setValueAtTime(vol, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + duration);
    } catch(e) { /* silencio si falla */ }
}

export function playStartupSound() {
    // Secuencia de arranque B-Bot más elaborada
    const notes = [
        [330, 0],   [440, 120], [554, 240],
        [659, 360], [880, 480], [1100, 560],
        [880, 680], [1100, 760]
    ];
    notes.forEach(([f, delay]) => {
        setTimeout(() => playBeep(f, 'square', 0.18, 0.08), delay);
    });
}

export function playGlitchSound() {
    const play = () => {
        playBeep(Math.random() * 200 + 50, 'sawtooth', 0.05, 0.06);
        if (Math.random() > 0.5) playBeep(Math.random() * 2000 + 100, 'square', 0.02, 0.05);
    };
    const interval = setInterval(play, 80);
    setTimeout(() => clearInterval(interval), 2000);
}

export function playPhotoSound() {
    // Obturador robótico
    playBeep(1200, 'sine', 0.04, 0.15);
    setTimeout(() => playBeep(600, 'sine', 0.08, 0.1), 40);
    setTimeout(() => playBeep(300, 'sine', 0.12, 0.08), 100);
}

export function playThinkingBeep() {
    if (Math.random() > 0.35) {
        playBeep(Math.random() * 400 + 600, 'sine', 0.03, 0.02);
    }
}

export function playErrorBeep() {
    playBeep(200, 'sawtooth', 0.2, 0.1);
    setTimeout(() => playBeep(150, 'sawtooth', 0.3, 0.1), 250);
}

// NUEVO: Sonido de servo al mover los ojos
export function playServoSound() {
    try {
        const ctx  = getCtx();
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(80, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(120, ctx.currentTime + 0.08);
        gain.gain.setValueAtTime(0.03, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.1);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.1);
    } catch(e) {}
}

// NUEVO: Modulador de pensamiento (más robótico que playThinkingBeep)
export function playModulatorBeep() {
    try {
        const ctx  = getCtx();
        const osc  = ctx.createOscillator();
        const lfo  = ctx.createOscillator();
        const gain = ctx.createGain();
        const lfoGain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        lfo.type = 'sine';
        lfo.frequency.setValueAtTime(8, ctx.currentTime);
        lfoGain.gain.setValueAtTime(60, ctx.currentTime);

        lfo.connect(lfoGain);
        lfoGain.connect(osc.frequency);

        gain.gain.setValueAtTime(0.04, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(); lfo.start();
        osc.stop(ctx.currentTime + 0.3);
        lfo.stop(ctx.currentTime + 0.3);
    } catch(e) {}
}

// NUEVO: Fanfarria al reconocer una cara conocida
export function playFaceRecognitionSound() {
    const melody = [
        [523, 0],   // DO
        [659, 100], // MI
        [784, 200], // SOL
        [1047, 320] // DO alto
    ];
    melody.forEach(([f, delay]) => {
        setTimeout(() => playBeep(f, 'sine', 0.15, 0.1), delay);
    });
}

// NUEVO: Sonido de datos guardados en memoria
export function playMemorySaveSound() {
    playBeep(800, 'sine', 0.05, 0.06);
    setTimeout(() => playBeep(1000, 'sine', 0.05, 0.06), 80);
    setTimeout(() => playBeep(1200, 'sine', 0.08, 0.06), 160);
}

// NUEVO: Sonido de baile (ritmo robótico)
export function playDanceBeat() {
    playBeep(120, 'square', 0.05, 0.15);
    setTimeout(() => playBeep(240, 'square', 0.03, 0.1), 200);
    setTimeout(() => playBeep(180, 'square', 0.04, 0.12), 400);
}

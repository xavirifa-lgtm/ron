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
    const ctx = getCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + duration);
}

export function playStartupSound() {
    const notes = [440, 554, 659, 880];
    notes.forEach((f, i) => {
        setTimeout(() => playBeep(f, 'square', 0.2, 0.1), i * 150);
    });
}

export function playGlitchSound() {
    const play = () => {
        playBeep(Math.random() * 200 + 50, 'sawtooth', 0.05, 0.05);
        if (Math.random() > 0.5) playBeep(Math.random() * 2000 + 100, 'square', 0.02, 0.05);
    };
    const interval = setInterval(play, 80);
    setTimeout(() => clearInterval(interval), 2000);
}

export function playPhotoSound() {
    playBeep(800, 'sine', 0.05, 0.1);
    setTimeout(() => playBeep(400, 'sine', 0.1, 0.1), 50);
}

export function playThinkingBeep() {
    if (Math.random() > 0.7) {
        playBeep(Math.random() * 400 + 600, 'sine', 0.03, 0.02);
    }
}

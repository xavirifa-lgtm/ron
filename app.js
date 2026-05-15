import { RonState, log, changeState } from './core.js';
import { initUI, setChestIcon, setExpression, startBlinkCycle, checkNightMode, startDanceMode, stopDanceMode, startIdleGlitchLoop } from './ui.js';
import { loadModels, startCamera, startVisionLoop, connectBLE } from './vision.js';
import { startListening, speak } from './speech.js';
import { startCuriosityLoop } from './curiosity.js';
import * as Sounds from './sounds.js';

async function preInit() {
    log("Iniciando Ron v25.3...");
    initUI();
    setChestIcon('wifi');

    window.speechSynthesis.onvoiceschanged = () => {
        const es = window.speechSynthesis.getVoices().filter(v => v.lang.startsWith('es'));
        if (es.length > 0) log(`Voces en español: ${es.length}`);
    };

    let initStarted = false;
    RonState.ui.powerBtn.onclick = async () => {
        if (initStarted) return;
        initStarted = true;
        Sounds.resume();
        RonState.ui.bootScreen.classList.add('hidden');
        await init();
    };

    RonState.ui.micToggleBtn.onclick = () => {
        RonState.isMicEnabled = !RonState.isMicEnabled;
        RonState.ui.micToggleBtn.classList.toggle('off', !RonState.isMicEnabled);
        if (RonState.isMicEnabled && RonState.activityState === 'IDLE') startListening();
        else if (!RonState.isMicEnabled && RonState.recognition) {
            try { RonState.recognition.abort(); } catch(e) {}
        }
    };

    RonState.ui.bleBtn.onclick = () => connectBLE();

    // Toda la pantalla es Ron — click en cualquier lado = cosquillas
    const faceEl = document.querySelector('.ron-container');
    if (faceEl) {
        faceEl.addEventListener('click', () => {
            if (RonState.activityState === 'IDLE' && !RonState.isLearningFace) {
                setExpression('happy');
                Sounds.playBeep(900, 'sine', 0.08, 0.05);
                setTimeout(() => Sounds.playBeep(1200, 'sine', 0.08, 0.05), 110);
                const tickles = [
                    "¡Bip! ¡Mis sensores táctiles detectan cosquillas!",
                    "¡Bop! ¡Error de cosquillas! ¿Por qué hacen eso los humanos?",
                    "¡Ñiiic! ¡Sistema de risa activado involuntariamente!"
                ];
                speak(tickles[Math.floor(Math.random() * tickles.length)]);
            }
        });
    }

    setupInteractions();
}

async function init() {
    // PASO 1: Arrancar UI y voz SIEMPRE — independiente de la cámara
    changeState('IDLE');
    setExpression('neutral');
    startBlinkCycle();
    startIdleGlitchLoop();
    startCuriosityLoop();
    checkNightMode();
    setInterval(checkNightMode, 3600000);
    requestWakeLock();

    // Esperar voces Y hablar dentro del mismo async chain del click (requisito autoplay)
    await waitForVoices();
    speak(
        "¡Bip! R0NB1NT5CAT5CO iniciando. " +
        "Conexión a la red Bubble: fallida. " +
        "Mejor amigo fuera de la caja: listo."
    );

    // PASO 2: Cámara y visión — si fallan, Ron sigue funcionando
    try {
        log("Cargando modelos de visión...");
        await loadModels();
        log("Iniciando cámara...");
        await startCamera();
        startVisionLoop();
        log("Visión activa.");
    } catch (err) {
        log(`Cámara no disponible: ${err.message} — Ron funciona sin visión.`);
        setExpression('neutral');
    }

    Sounds.playStartupSound();
    goFullscreen();
}

// Resuelve en cuanto speechSynthesis tiene voces cargadas (máx 3s de espera)
function waitForVoices() {
    return new Promise(resolve => {
        if (window.speechSynthesis.getVoices().length > 0) return resolve();
        let resolved = false;
        const done = () => { if (!resolved) { resolved = true; window.speechSynthesis.onvoiceschanged = null; resolve(); } };
        window.speechSynthesis.onvoiceschanged = done;
        setTimeout(done, 3000);
    });
}

async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            RonState.wakeLock = await navigator.wakeLock.request('screen');
            log("WakeLock activo.");
            RonState.wakeLock.addEventListener('release', () => {
                log("WakeLock liberado.");
                RonState.wakeLock = null;
            });
        }
    } catch (err) {
        log(`WakeLock no disponible: ${err.message}`);
        RonState.wakeLock = null;
    }
}

function setupInteractions() {
    RonState.ui.saveBtn.onclick = () => {
        const k = RonState.ui.apiKeyInput.value.trim();
        if (k.length > 10) {
            localStorage.setItem('ron_groq_key', k);
            RonState.apiKey = k;
            RonState.ui.apiModal.classList.add('hidden');
            speak("¡Bip! Cerebro activado. Friendship.exe cargando al 5%.");
        }
    };
    RonState.ui.apiKeyInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') RonState.ui.saveBtn.click();
    });
    if (!RonState.apiKey) RonState.ui.apiModal.classList.remove('hidden');
}

function goFullscreen() {
    const d  = document.documentElement;
    const fn = d.requestFullscreen || d.webkitRequestFullscreen || d.mozRequestFullScreen;
    if (fn && !document.fullscreenElement) fn.call(d).catch(() => {});
}

window.onload = () => {
    preInit();
    document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'visible') {
            if (!RonState.wakeLock) await requestWakeLock();
            const activeStates = ['SPEAKING','THINKING','MATH_GAME','READING_GAME','STORY','HIDE_SEEK','HIDE_SEEK_SEARCH'];
            if (window.speechSynthesis && !activeStates.includes(RonState.activityState)) {
                window.speechSynthesis.cancel();
            }
            if (RonState.activityState === 'IDLE' && RonState.isMicEnabled && !RonState.isRecognitionActive) {
                setTimeout(() => startListening(), 1500);
            }
        }
    });
};

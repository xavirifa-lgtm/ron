import { RonState, log, changeState } from './core.js';
import { initUI, setChestIcon, setExpression, startBlinkCycle, checkNightMode, startDanceMode, stopDanceMode } from './ui.js';
import { loadModels, startCamera, startVisionLoop, connectBLE } from './vision.js';
import { startListening, speak } from './speech.js';
import { startCuriosityLoop } from './curiosity.js';
import * as Sounds from './sounds.js';

async function preInit() {
    log("Iniciando Ron v25.1...");
    initUI();
    setChestIcon('wifi');

    window.speechSynthesis.onvoiceschanged = () => {
        const es = window.speechSynthesis.getVoices().filter(v => v.lang.startsWith('es'));
        if (es.length > 0) log(`Voces en español: ${es.length}`);
    };

    RonState.ui.powerBtn.onclick = async () => {
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

    // Cosquillas al tocar la cara
    const faceEl = document.querySelector('.face-wrapper');
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
    try {
        log("Cargando modelos de visión...");
        await loadModels();
        log("Iniciando cámara...");
        await startCamera();

        requestWakeLock();
        checkNightMode();
        setInterval(checkNightMode, 3600000);

        changeState('IDLE');
        setExpression('neutral');
        startBlinkCycle();
        startVisionLoop();
        startCuriosityLoop();
        Sounds.playStartupSound();

        await speak(
            "¡Bip! R0NB1NT5CAT5CO iniciando. " +
            "Conexión a la red Bubble: fallida. " +
            "Mejor amigo fuera de la caja: listo."
        );

        goFullscreen();

    } catch (err) {
        log(`Error crítico: ${err.message}`);
        setExpression('glitch');
        if (RonState.ui.gamePanel && RonState.ui.gameText) {
            RonState.ui.gamePanel.classList.remove('hidden');
            RonState.ui.gameText.style.color    = 'red';
            RonState.ui.gameText.style.fontSize = '16px';
            RonState.ui.gameText.innerText      = '⚠️ ' + err.message;
        }
    }
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
            if (window.speechSynthesis && RonState.activityState !== 'SPEAKING') {
                window.speechSynthesis.cancel();
            }
            if (RonState.activityState === 'IDLE' && RonState.isMicEnabled && !RonState.isRecognitionActive) {
                setTimeout(() => startListening(), 1500);
            }
        }
    });
};

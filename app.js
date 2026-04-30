import { RonState, log, changeState } from './core.js';
import { initUI, setChestIcon, setExpression, startBlinkCycle } from './ui.js';
import { loadModels, startCamera, startVisionLoop, connectBLE } from './vision.js';
import { startListening, speak } from './speech.js';
import * as Sounds from './sounds.js';

async function preInit() {
    log("Iniciando Ron v20.7 - MODULAR BRAIN...");
    initUI();
    setChestIcon('wifi');
    
    window.speechSynthesis.onvoiceschanged = () => {
        const voices = window.speechSynthesis.getVoices();
        const es = voices.filter(v => v.lang.startsWith('es'));
        if (es.length > 0) log(`Sistema de voz cargado.`);
    };

    RonState.ui.powerBtn.onclick = async () => { 
        Sounds.resume();
        RonState.ui.powerBtn.style.display = 'none'; 
        await init(); 
    };

    RonState.ui.micToggleBtn.onclick = () => {
        RonState.isMicEnabled = !RonState.isMicEnabled;
        RonState.ui.micToggleBtn.classList.toggle('off', !RonState.isMicEnabled);
        if (RonState.isMicEnabled && RonState.activityState === 'IDLE') startListening();
    };

    RonState.ui.bleBtn.onclick = () => connectBLE();
    setupInteractions();

    // Nueva Interacción: Cosquillas al tocarle la cara
    document.querySelector('.face-container').addEventListener('click', () => {
        if (RonState.activityState === 'IDLE' && !RonState.isLearningFace) {
            setExpression('happy');
            Sounds.playBeep(900, 'sine', 0.1, 0.05);
            setTimeout(() => Sounds.playBeep(1200, 'sine', 0.1, 0.05), 100);
            speak("¡Ji ji! ¡Bip! ¡Eso son cosquillas!");
        }
    });
}

async function init() {
    try {
        await loadModels();
        await startCamera();
        requestWakeLock(); 
        
        RonState.ui.bootScreen.classList.add('hidden');
        import('./ui.js').then(ui => {
            ui.checkNightMode();
            setInterval(ui.checkNightMode, 3600000); // Comprobar cada hora
        });
        changeState('IDLE');
        setExpression('neutral');
        startBlinkCycle();
        startVisionLoop();
        Sounds.playStartupSound();
        speak("¡Bip! Conexión a la red Bubble... fallida. ¡Hola! Soy Ron, tu mejor amigo fuera de la caja.");
        goFullscreen();
    } catch (err) {
        log(`Error Crítico: ${err.message}`);
        setExpression('glitch');
    }
}

async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            RonState.wakeLock = await navigator.wakeLock.request('screen');
            log("Pantalla bloqueada: No se suspenderá.");
            RonState.wakeLock.addEventListener('release', () => log("Wake Lock liberado."));
        }
    } catch (err) {
        log(`Error WakeLock: ${err.message}`);
    }
}

function setupInteractions() {
    RonState.ui.saveBtn.onclick = () => {
        const k = RonState.ui.apiKeyInput.value.trim();
        if (k) {
            localStorage.setItem('ron_groq_key', k);
            RonState.apiKey = k;
            RonState.ui.apiModal.classList.add('hidden');
            speak("¡Bip! Mi cerebro ya tiene energía.");
        }
    };
    if (!RonState.apiKey) RonState.ui.apiModal.classList.remove('hidden');
}

function goFullscreen() { 
    const d = document.documentElement; 
    if (!document.fullscreenElement) (d.requestFullscreen || d.webkitRequestFullScreen).call(d).catch(()=>{}); 
}

window.onload = () => {
    preInit();
    document.addEventListener('visibilitychange', async () => {
        if (RonState.wakeLock !== null && document.visibilityState === 'visible') {
            await requestWakeLock();
        }
    });
};

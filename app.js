import { RonState, log, changeState, startProactiveLoop, isIdleLike } from './core.js';
import { initUI, setChestIcon, setExpression, startBlinkCycle, checkNightMode, startDanceMode, stopDanceMode, startIdleGlitchLoop } from './ui.js';
import { loadModels, startCamera, startVisionLoop, connectBLE } from './vision.js';
import { startListening, speak } from './speech.js';
import { startCuriosityLoop } from './curiosity.js';
import * as Sounds from './sounds.js';

async function preInit() {
    log("Iniciando Ron v26.3...");
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
        import('./tts.js').then(t => t.unlockAudio()).catch(() => {});
        RonState.ui.bootScreen.classList.add('hidden');
        await init();
    };

    RonState.ui.micToggleBtn.onclick = () => {
        RonState.isMicEnabled = !RonState.isMicEnabled;
        RonState.ui.micToggleBtn.classList.toggle('off', !RonState.isMicEnabled);
        if (RonState.isMicEnabled && RonState.activityState === 'IDLE') startListening();
        else if (!RonState.isMicEnabled) {
            if (RonState.recognition) { try { RonState.recognition.abort(); } catch(e) {} }
            import('./whisper.js').then(w => w.stopWhisper()).catch(() => {});
        }
    };


    // Toda la pantalla es Ron — click en cualquier lado = cosquillas
    const faceEl = document.querySelector('.ron-container');
    if (faceEl) {
        faceEl.addEventListener('click', (ev) => {
            // Sin cosquillas al tocar botones, ajustes o paneles
            if (ev.target.closest('button, input, select, label, .api-modal, .game-panel, #photo-panel')) return;
            if (isIdleLike() && !RonState.isLearningFace) {
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
    startProactiveLoop();
    import('./bedtime.js').then(b => b.startBedtimeLoop());
    // Pedir al navegador que no borre la memoria de Ron (caras, nombres, recuerdos)
    try { navigator.storage?.persist?.().then(ok => log(`Almacenamiento persistente: ${ok ? 'sí' : 'no concedido'}`)); } catch (e) {}
    checkNightMode();
    setInterval(checkNightMode, 300000);
    requestWakeLock();

    // Esperar voces Y hablar dentro del mismo async chain del click (requisito autoplay)
    await waitForVoices();
    speak(
        "¡Bip! B-Bot Unidad Ron, identificador 5-IND iniciando. " +
        "Pero me puedes llamar Ron. " +
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
        const done = () => { if (!resolved) { resolved = true; window.speechSynthesis.removeEventListener('voiceschanged', done); resolve(); } };
        window.speechSynthesis.addEventListener('voiceschanged', done);
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
    const $ = id => document.getElementById(id);
    const fill = async () => {
        const { RonConfig } = await import('./core.js');
        $('groq-key-input').value       = RonState.apiKey || '';
        $('cerebras-key-input').value   = RonConfig.cerebrasKey || '';
        $('openrouter-key-input').value = RonConfig.openrouterKey || '';
        $('bedtime-input').value        = RonConfig.bedtime;
        $('waketime-input').value       = RonConfig.wakeTime;
        $('initiative-input').value     = RonConfig.initiative;
        $('stt-input').value            = RonConfig.sttEngine || 'whisper';
        $('gemini-key-input').value     = RonConfig.geminiKey || '';
        $('voice-engine-input').value   = RonConfig.voiceEngine || 'gemini';
        $('robot-effect-input').checked = RonConfig.robotEffect !== false;
        const { VOICES } = await import('./tts.js');
        $('gemini-voice-input').innerHTML = Object.entries(VOICES).map(([v, d]) => `<option value="${v}">${v} — ${d}</option>`).join('');
        $('gemini-voice-input').value   = RonConfig.geminiVoice || 'Puck';
        try {
            const u = (await import('./llm.js')).usageToday();
            const lines = Object.entries(u).map(([m, n]) => `${m}: ${n}`);
            $('usage-info').textContent = lines.length ? 'Peticiones de hoy:\n' + lines.join('\n') : 'Sin peticiones hoy.';
        } catch (e) {}
    };
    const open = () => { fill(); RonState.ui.apiModal.classList.remove('hidden'); };
    const close = () => RonState.ui.apiModal.classList.add('hidden');

    RonState.ui.saveBtn.onclick = async () => {
        const k = $('groq-key-input').value.trim();
        if (k.length <= 10) { $('groq-key-input').focus(); return; }
        const firstTime = !RonState.apiKey;
        localStorage.setItem('ron_groq_key', k);
        RonState.apiKey = k;
        const { saveConfig } = await import('./core.js');
        saveConfig({
            cerebrasKey:   $('cerebras-key-input').value.trim(),
            openrouterKey: $('openrouter-key-input').value.trim(),
            bedtime:       $('bedtime-input').value || '22:00',
            wakeTime:      $('waketime-input').value || '07:30',
            initiative:    $('initiative-input').value || 'alta',
            sttEngine:     $('stt-input').value || 'whisper',
            geminiKey:     $('gemini-key-input').value.trim(),
            voiceEngine:   $('voice-engine-input').value || 'gemini',
            geminiVoice:   $('gemini-voice-input').value || 'Puck',
            robotEffect:   $('robot-effect-input').checked,
        });
        close();
        checkNightMode();
        // Aplicar el motor de escucha elegido
        import('./whisper.js').then(w => w.stopWhisper()).finally(() => startListening());
        if (firstTime) speak("¡Bip! Cerebro activado. Friendship.exe cargando al 5%.");
        else log('Ajustes guardados.');
    };
    $('close-settings-btn').onclick = close;
    // Probar la voz con lo que hay en el formulario (sin guardar)
    $('test-voice-btn').onclick = async () => {
        const { RonConfig } = await import('./core.js');
        const prev = { ...RonConfig };
        Object.assign(RonConfig, { geminiKey: $('gemini-key-input').value.trim(), voiceEngine: $('voice-engine-input').value,
            geminiVoice: $('gemini-voice-input').value, robotEffect: $('robot-effect-input').checked });
        const tts = await import('./tts.js'); tts.unlockAudio();
        await speak('¡Bip! Hola, soy Ron, tu mejor amigo fuera de la caja.', { remember: false });
        Object.assign(RonConfig, prev);
    };
    RonState.ui.apiKeyInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') RonState.ui.saveBtn.click();
    });

    // Pulsación larga (3 s) en 📡 → ajustes. Pulsación corta → conectar motores.
    let pressTimer = null, longPressed = false;
    const btn = RonState.ui.bleBtn;
    const startPress = () => { longPressed = false; pressTimer = setTimeout(() => { longPressed = true; open(); }, 3000); };
    const endPress = () => { clearTimeout(pressTimer); };
    btn.addEventListener('pointerdown', startPress);
    btn.addEventListener('pointerup', endPress);
    btn.addEventListener('pointerleave', endPress);
    btn.onclick = (e) => { if (longPressed) { e.preventDefault(); return; } connectBLE(); };

    if (!RonState.apiKey) open();
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

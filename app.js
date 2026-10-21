import { RonState, log, changeState, startProactiveLoop, isIdleLike } from './core.js';
import { initUI, setChestIcon, setExpression, startBlinkCycle, checkNightMode, startDanceMode, stopDanceMode, startIdleGlitchLoop } from './ui.js';
import { loadModels, startCamera, startVisionLoop, connectBLE } from './vision.js';
import { startListening, speak } from './speech.js';
import { startCuriosityLoop } from './curiosity.js';
import * as Sounds from './sounds.js';

async function preInit() {
    log("Iniciando Ron v29.0...");
    initUI();
    setChestIcon('wifi');

    window.speechSynthesis.onvoiceschanged = () => {
        const es = window.speechSynthesis.getVoices().filter(v => v.lang.startsWith('es'));
        if (es.length > 0) log(`Voces en español: ${es.length}`);
    };

    let initStarted = false;
    
    // Aseguramos que el botón responda de forma inmediata al toque
    const powerBtn = RonState.ui.powerBtn || document.getElementById('power-btn');
    if (powerBtn) {
        powerBtn.onclick = async () => {
            if (initStarted) return;
            initStarted = true;
            
            // 1. Desbloquear audio y ocultar pantalla de inicio al instante
            Sounds.resume();
            try {
                const tts = await import('./tts.js');
                tts.unlockAudio();
            } catch (e) {
                log("Aviso TTS unlock: " + e.message);
            }
            
            if (RonState.ui.bootScreen) {
                RonState.ui.bootScreen.classList.add('hidden');
            } else {
                document.getElementById('boot-screen')?.classList.add('hidden');
            }
            
            import('./core.js').then(c => document.body.classList.toggle('diag', !!c.RonConfig.diagnostics));
            
            // 2. Lanzar la inicialización principal
            await init();
        };
    }

    RonState.ui.micToggleBtn.onclick = () => {
        RonState.isMicEnabled = !RonState.isMicEnabled;
        RonState.ui.micToggleBtn.classList.toggle('off', !RonState.isMicEnabled);
        if (RonState.isMicEnabled && RonState.activityState === 'IDLE') startListening();
        else if (!RonState.isMicEnabled) {
            if (RonState.recognition) { try { RonState.recognition.abort(); } catch(e) {} }
            import('./whisper.js').then(w => w.stopWhisper()).catch(() => {});
        }
    };

    // ZONAS TÁCTILES AVANZADAS EN LA CARA DE RON
    const faceEl = document.querySelector('.ron-container');
    if (faceEl) {
        faceEl.addEventListener('click', (ev) => {
            if (ev.target.closest('button, input, select, label, .api-modal, .game-panel, #photo-panel')) return;
            if (RonState.activityState === 'SPEAKING') { import('./speech.js').then(s => s.interruptSpeaking()); return; }
            
            if (RonState.activityState === 'IDLE' && !RonState.isLearningFace) {
                const rect = faceEl.getBoundingClientRect();
                const clickY = (ev.clientY - rect.top) / rect.height;

                if (clickY < 0.35) {
                    setExpression('surprise');
                    Sounds.playBeep(1100, 'sine', 0.06, 0.08);
                    setTimeout(() => Sounds.playServoSound(), 80);
                    speak("¡Bip! ¡Cuidado con mis sensores ópticos!");
                } 
                else if (clickY >= 0.35 && clickY < 0.65) {
                    setExpression('happy');
                    Sounds.playBeep(900, 'sine', 0.08, 0.05);
                    setTimeout(() => Sounds.playBeep(1200, 'sine', 0.08, 0.05), 110);
                    const tickles = [
                        "¡Bip! ¡Mis sensores táctiles detectan cosquillas en la cara!",
                        "¡Bop! ¡Error de cosquillas! ¿Por qué hacéis eso los humanos?",
                        "¡Ñiiic! ¡Sistema de risa activado involuntariamente!"
                    ];
                    speak(tickles[Math.floor(Math.random() * tickles.length)]);
                } 
                else {
                    setExpression('thinking');
                    Sounds.playDataProcess();
                    speak("¡Bip bop! Estás tocando mi unidad de audio. ¿Quieres que te cuente algo?");
                }
            }
        });
    }

    setupInteractions();
}

async function init() {
    changeState('IDLE');
    setExpression('neutral');
    startBlinkCycle();
    startIdleGlitchLoop();
    startCuriosityLoop();
    startProactiveLoop();
    import('./bedtime.js').then(b => b.startBedtimeLoop());
    try { navigator.storage?.persist?.().then(ok => log(`Almacenamiento persistente: ${ok ? 'sí' : 'no concedido'}`)); } catch (e) {}
    checkNightMode();
    setInterval(checkNightMode, 300000);
    requestWakeLock();

    await waitForVoices();
    speak(
        "¡Bip! B-Bot Unidad Ron, identificador 5-IND iniciando. " +
        "Pero me puedes llamar Ron. " +
        "Conexión a la red Bubble: fallida. " +
        "Mejor amigo fuera de la caja: listo."
    );

    // Intentamos cargar la cámara de forma independiente para que no bloquee si falla
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
        $('listen-mode-input').value    = RonConfig.listenMode || 'cara';
        $('captions-input').checked     = RonConfig.captions !== false;
        $('diag-input').checked         = !!RonConfig.diagnostics;
        $('quality-gate-input').checked = RonConfig.faceQualityGate !== false;
        const { VOICES } = await import('./tts.js');
        $('gemini-voice-input').innerHTML = Object.entries(VOICES).map(([v, d]) => `<option value="${v}">${v} — ${d}</option>`).join('');
        $('gemini-voice-input').value   = RonConfig.geminiVoice || 'Puck';
        try {
            const u = (await import('./llm.js')).usageToday();
            const lines = Object.entries(u).map(([m, n]) => `${m}: ${n}`);
            $('usage-info').textContent = lines.length ? 'Peticiones de hoy:\n' + lines.join('\n') : 'Sin peticiones hoy.';
        } catch (e) {}
    };
    // ── Calibración en directo (solo mientras Ajustes está abierto) ──
    let calibTimer = null;
    const fmt = (v, d = 2) => v == null ? '–' : (typeof v === 'number' ? v.toFixed(d) : v);
    const renderCalib = async () => {
        try {
            const v = await import('./vision.js');
            const dbg = v.getVisionDebug();
            const q = dbg.quality;
            const lines = [`Cámara: ${dbg.camera} · Exposición: ${dbg.exposure}`];
            if (!dbg.fresh || !q) lines.push('No veo ninguna cara ahora mismo.');
            else {
                const m = q.m;
                lines.push(`Cara: ${m.sizePx} px · nitidez ${fmt(m.sharp, 0)} · giro ${fmt(m.yaw)} · ojos ${fmt(m.ear)} · luz ${fmt(m.lum)} · detección ${fmt(m.score)}`);
                lines.push(q.ok ? `✅ Imagen buena (promedio de ${dbg.avgFrames} fotogramas)` : `⚠️ Imagen descartada: ${q.reasons.join(', ')}`);
                if (dbg.distances?.length) {
                    lines.push('Distancias: ' + dbg.distances.slice(0, 4).map(x => `${x.label} ${x.distance.toFixed(2)} (${x.samples} muestras)`).join(' · '));
                    const best = dbg.distances[0];
                    lines.push(best.distance < dbg.thresholds.MATCH_MAX ? `→ Te reconoce como ${best.label}` : best.distance < dbg.thresholds.UNKNOWN_MIN ? '→ Duda (zona gris)' : '→ No te reconoce');
                } else if (q.ok) lines.push('Aún no hay caras guardadas.');
            }
            $('calib-live').textContent = lines.join('\n');
        } catch (e) { $('calib-live').textContent = 'Calibración no disponible: ' + e.message; }
    };
    const fillPeople = () => {
        const sel = $('calib-person'); const cur = sel.value;
        sel.innerHTML = (RonState.knownFaces || []).map(f => `<option value="${f.label}">${f.label}</option>`).join('') || '<option value="">(nadie guardado)</option>';
        if (cur) sel.value = cur;
    };
    $('calib-save-btn').onclick = async () => {
        const v = await import('./vision.js');
        const r = await v.saveCurrentSample($('calib-person').value);
        $('calib-status').textContent = (r.ok ? '✅ ' : '❌ ') + r.msg;
    };
    $('quality-gate-input').onchange = async () => {
        const { saveConfig } = await import('./core.js');
        saveConfig({ faceQualityGate: $('quality-gate-input').checked });
    };

    const open = () => {
        fill(); fillPeople(); RonState.ui.apiModal.classList.remove('hidden');
        if (calibTimer) clearInterval(calibTimer);
        renderCalib(); calibTimer = setInterval(renderCalib, 500);
    };
    const close = () => {
        RonState.ui.apiModal.classList.add('hidden');
        if (calibTimer) { clearInterval(calibTimer); calibTimer = null; }
    };

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
            listenMode:    $('listen-mode-input').value || 'cara',
            captions:      $('captions-input').checked,
            diagnostics:   $('diag-input').checked,
            faceQualityGate: $('quality-gate-input').checked,
        });
        document.body.classList.toggle('diag', $('diag-input').checked);
        close();
        checkNightMode();
        import('./whisper.js').then(w => w.stopWhisper()).finally(() => startListening());
        if (firstTime) speak("¡Bip! Cerebro activado. Friendship.exe cargando al 5%.");
        else log('Ajustes guardados.');
    };
    $('close-settings-btn').onclick = close;
    
    $('test-voice-btn').onclick = async () => {
        const { RonConfig } = await import('./core.js');
        const prev = { ...RonConfig };
        Object.assign(RonConfig, { geminiKey: $('gemini-key-input').value.trim(), voiceEngine:$('voice-engine-input').value,
            geminiVoice: $('gemini-voice-input').value, robotEffect:$('robot-effect-input').checked });
        const tts = await import('./tts.js'); tts.unlockAudio();
        const out = $('test-voice-result');
        out.textContent = 'Probando…';
        await speak('¡Bip! Hola, soy Ron, tu mejor amigo fuera de la caja.', { remember: false });
        const info = tts.lastTtsInfo();
        out.textContent = RonConfig.voiceEngine !== 'gemini' ? 'Ha sonado la voz del navegador (elegida en Ajustes).'
            : !RonConfig.geminiKey ? 'Falta la clave de Gemini: ha sonado la voz del navegador.'
            : info.ok ? `✅ Voz de Gemini (${info.model}, ${info.ms} ms).`
            : `❌ Gemini no respondió: ${info.error}. Ha sonado la voz del navegador.`;
        Object.assign(RonConfig, prev);
    };
    RonState.ui.apiKeyInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') RonState.ui.saveBtn.click();
    });

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
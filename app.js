import { RonState, log, changeState, startProactiveLoop, isIdleLike } from './core.js';
import { initUI, setChestIcon, setExpression, startBlinkCycle, checkNightMode, startDanceMode, stopDanceMode, startIdleGlitchLoop } from './ui.js';
import { loadModels, startCamera, startVisionLoop, connectBLE } from './vision.js';
import { startListening, speak } from './speech.js';
import { startCuriosityLoop } from './curiosity.js';
import * as Sounds from './sounds.js';

window.__ronLoaded = true;   // el aviso "Ron no ha podido cargar" de index.html comprueba esto

async function preInit() {
    log("Iniciando Ron v30.3...");
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

// Registro de sesión: datos del arranque (sin claves) y una foto del estado cada minuto
const RON_VERSION = 'v30.3';
async function startSessionLog() {
    try {
        const SL = await import('./sessionlog.js');
        const { RonConfig } = await import('./core.js');
        const ua = navigator.userAgent;
        SL.startSession({
            version: RON_VERSION,
            device: (ua.match(/\(([^)]+)\)/) || [])[1] || ua.slice(0, 80),
            chrome: (ua.match(/Chrome\/([\d.]+)/) || [])[1],
            screen: `${screen.width}x${screen.height}@${devicePixelRatio}`,
            stt: RonConfig.sttEngine, voz: RonConfig.voiceEngine, escucha: RonConfig.listenMode,
            bargeIn: RonConfig.bargeIn ? 'sí' : 'no', filtroCaras: RonConfig.faceQualityGate ? 'sí' : 'no', iniciativa: RonConfig.initiative,
            groq: RonState.apiKey ? 'sí' : 'NO', gemini: RonConfig.geminiKey ? 'sí' : 'no',
            caras: (RonState.knownFaces || []).map(f => `${f.label}(${(f.descriptors || []).length})`).join(' ') || 'ninguna',
        });
        let battery = null;
        try { battery = await navigator.getBattery?.(); } catch (e) {}
        setInterval(async () => {
            let w = {};
            try { w = (await import('./whisper.js')).whisperDiag(); } catch (e) {}
            SL.slog('env', {
                state: RonState.activityState, user: RonState.currentUser || '—',
                mic: RonState.isMicEnabled ? (w.running ? 'whisper' : (RonState.isRecognitionActive ? 'navegador' : 'parado')) : 'APAGADO',
                ruido: w.noise, eco: w.echoK, pausaWhisper: w.paused,
                caras: SL.takeFaceStats() || 'ninguna vista',
                bateria: battery ? Math.round(battery.level * 100) + '%' + (battery.charging ? '⚡' : '') : '',
                red: navigator.onLine ? '' : 'SIN RED',
                memMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : '',
            });
        }, 60000);
    } catch (e) { console.warn('registro de sesión:', e); }
}

async function init() {
    startSessionLog();
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
    const greeting = speak(
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

    // Primer arranque sin nadie guardado: pedir el nombre en cuanto termine el saludo
    greeting.then(() => setTimeout(() => {
        import('./identity.js').then(id => id.maybeFirstRunOnboarding()).catch(e => log('Alta: ' + e.message));
    }, 1200));
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

    // Autodiagnóstico
    $('selftest-btn').onclick = async () => {
        const outEl = $('selftest-out');
        outEl.textContent = '';
        $('selftest-btn').disabled = true;
        const wasMic = RonState.isMicEnabled;
        RonState.isMicEnabled = false;                       // que Ron no conteste mientras se prueba
        try { (await import('./whisper.js')).stopWhisper(); } catch (e) {}
        try {
            const st = await import('./selftest.js');
            await st.runSelfTest(l => { outEl.textContent += l + '\n'; outEl.scrollTop = outEl.scrollHeight; }, { micWasEnabled: wasMic });
        } catch (e) { outEl.textContent += '❌ El autodiagnóstico falló: ' + e.message + '\n'; }
        RonState.isMicEnabled = wasMic;
        if (wasMic) startListening();
        $('selftest-btn').disabled = false;
    };
    $('selftest-copy').onclick = async () => {
        const t = $('selftest-out').textContent;
        try { await navigator.clipboard.writeText(t); $('selftest-copy').textContent = '¡Copiado!'; }
        catch (e) { const r = document.createRange(); r.selectNodeContents($('selftest-out')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); $('selftest-copy').textContent = 'Selecciónalo y copia'; }
        setTimeout(() => { $('selftest-copy').textContent = 'Copiar resultado'; }, 2500);
    };
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
        $('bargein-input').checked      = RonConfig.bargeIn !== false;
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

    // Memoria: quién es la mejor amiga y qué sabe Ron de cada persona (se puede borrar un recuerdo)
    const opt = (v, t) => { const o = document.createElement('option'); o.value = v; o.textContent = t; return o; };
    const fillMemory = async () => {
        const mem = await import('./memory.js');
        const people = [...new Set([...(RonState.knownFaces || []).map(f => f.label), ...mem.listPeople()])];
        const mainSel = $('main-friend-sel'), perSel = $('mem-person-sel');
        const main = mem.getMainFriend();
        mainSel.replaceChildren(...(people.length ? people.map(p => opt(p, p)) : [opt('', '(nadie todavía)')]));
        if (main && people.includes(main)) mainSel.value = main;
        const cur = perSel.value;
        perSel.replaceChildren(...(people.length ? people.map(p => opt(p, p)) : [opt('', '(nadie todavía)')]));
        if (cur && people.includes(cur)) perSel.value = cur;
        renderFacts();
    };
    const renderFacts = async () => {
        const mem = await import('./memory.js');
        const name = $('mem-person-sel').value;
        const facts = name ? mem.getFacts(name) : [];
        $('mem-count').textContent = name ? `${facts.length} recuerdos` : '';
        const ul = $('mem-facts');
        ul.replaceChildren(...facts.slice().reverse().map(f => {
            const li = document.createElement('li');
            li.style.cssText = 'display:flex;gap:6px;align-items:flex-start;padding:3px 0;border-bottom:1px solid #eee';
            const sp = document.createElement('span'); sp.style.flex = '1'; sp.textContent = f;
            const b = document.createElement('button'); b.type = 'button'; b.textContent = '✕'; b.title = 'Borrar este recuerdo';
            b.style.cssText = 'font-size:11px;padding:2px 7px;background:#9ca3af';
            b.onclick = () => { if (confirm('¿Borrar este recuerdo?\n\n' + f)) { mem.deleteFact(name, f); renderFacts(); } };
            li.append(sp, b);
            return li;
        }));
    };
    $('mem-person-sel').onchange = renderFacts;
    $('main-friend-sel').onchange = async () => {
        const v = $('main-friend-sel').value;
        if (v) (await import('./memory.js')).setMainFriend(v);
    };

    // Registro de sesión
    const slogStatus = async () => {
        const SL = await import('./sessionlog.js');
        $('slog-on').checked = SL.isLogging();
        const ev = SL.rawEvents();
        const turns = SL.computeTurns(ev).length;
        $('slog-status').textContent = ev.length
            ? `${ev.length} eventos · ${turns} frases oídas · desde ${new Date(ev[0].t).toLocaleString('es-ES')}`
            : 'Vacío.';
    };
    $('slog-on').onchange = async () => { (await import('./sessionlog.js')).setLogging($('slog-on').checked); slogStatus(); };
    $('slog-clear').onclick = async () => {
        if (!confirm('¿Borrar el registro de sesión?')) return;
        (await import('./sessionlog.js')).clearLog(); slogStatus();
    };
    $('slog-copy').onclick = async () => {
        const txt = (await import('./sessionlog.js')).exportText({ version: RON_VERSION });
        try { await navigator.clipboard.writeText(txt); $('slog-status').textContent = '✅ Copiado: pégalo en el chat con Claude.'; }
        catch (e) { $('slog-status').textContent = 'No se pudo copiar: usa Compartir.'; }
    };
    $('slog-share').onclick = async () => {
        const txt = (await import('./sessionlog.js')).exportText({ version: RON_VERSION });
        const d = new Date();
        const name = `registro_ron_${d.toISOString().slice(0, 10)}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}.txt`;
        const file = new File([txt], name, { type: 'text/plain' });
        try {
            if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Registro de Ron' }); return; }
        } catch (e) { if (e.name === 'AbortError') return; }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(file); a.download = name; a.click();
        $('slog-status').textContent = `✅ Descargado: ${name}`;
    };

    const open = () => {
        fill(); fillPeople(); fillMemory(); slogStatus(); RonState.ui.apiModal.classList.remove('hidden');
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
            bargeIn:       $('bargein-input').checked,
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
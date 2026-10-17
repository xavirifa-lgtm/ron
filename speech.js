import { RonState, log, changeState, rememberTurn } from './core.js';
import { setExpression, triggerSafetyGlitch, updateMouth, shiftEyes } from './ui.js';
import { handleInput } from './ai.js';
import * as Sounds from './sounds.js';

// ── Configuración del bucle de conversación ──────────────────────────────────
const MIC_ALLOWED_STATES = ['IDLE', 'STORY', 'MATH_GAME', 'READING_GAME', 'NIGHT'];
const RESTART_DELAY = 700;    // ms de silencio tras hablar antes de re-escuchar (anti-eco)
const CONV_WINDOW   = 12000;  // ms de "charla libre" sin decir "Ron" tras cada respuesta
const ECHO_GUARD_MS = 400;    // ignorar lo "oído" justo tras terminar de hablar (era su propia voz)

let convTimeout        = null;
let activeMouthInterval = null;
let listenTimer        = null;  // single-flight: solo un re-arranque de micro pendiente a la vez
let recognitionStarting = false; // guarda síncrona contra dobles arranques del micro
let recognitionStartTs  = 0;     // cuándo empezó la sesión actual (para backoff)
let quickEndCount       = 0;     // sesiones que mueren al instante seguidas
let lastSpeakEndTs     = 0;
let speakSeq           = 0;   // turno: si llega otra frase mientras se genera el audio, gana la última
let ttsWatchdog        = null;
let ttsKeepAlive       = null;

// ── Re-arranque de micro centralizado y con guardas ─────────────────────────
// Un único punto que decide CUÁNDO se vuelve a escuchar, evitando dobles sesiones.
function scheduleListen(delay = RESTART_DELAY) {
    if (listenTimer) { clearTimeout(listenTimer); listenTimer = null; }
    listenTimer = setTimeout(() => {
        listenTimer = null;
        startListening();
    }, delay);
}


// ── Lo que se ha oído (venga del navegador o de Whisper) ─────────────────────
export function getLastSpeakEndTs() { return lastSpeakEndTs; }
export function processTranscript(rawText) {
    let text = (rawText || '').trim();
    if (!text || text.length < 2) return;
    const t = text.toLowerCase();
    log(`Oído: ${text}`);

    const inGame  = ['MATH_GAME', 'READING_GAME'].includes(RonState.activityState);
    const inStory = RonState.activityState === 'STORY' && RonState.storyPendingNextChapter;

    // Respuesta al nombre: tiene prioridad y no necesita palabra clave
    if (RonState.nameFlow) {
        if (convTimeout) clearTimeout(convTimeout);
        rememberTurn('user', text);
        import('./identity.js').then(async id => {
            const handled = await id.handleNameReply(text);
            if (!handled) handleInput(text);   // no era un nombre: conversación normal
        });
        return;
    }

    // Fuera de juego/cuento: exigir "Ron" solo cuando la ventana de charla está cerrada
    const saidRon = /\bron\b/.test(t);
    if (RonState.isWaitingForWakeWord && !inStory && !inGame) {
        if (!saidRon) return;                  // ambiente ignorado hasta que digan "Ron"
        RonState.isWaitingForWakeWord = false;
        const rest = t.replace(/\bron\b/g, '').replace(/[,.!¡?¿]/g, '').trim();
        if (!rest || rest.length < 2) {
            if (RonState.activityState === 'NIGHT') { handleInput(text); return; }
            speak(`¡Bip! ¿Qué pasa, ${RonState.currentUser || 'amiga'}?`);
            return;
        }
    } else if (!inStory && !inGame) {
        if (convTimeout) clearTimeout(convTimeout); // sigue la charla, no cerrar ventana aún
    }
    handleInput(text);
}

// ── Motor de escucha ─────────────────────────────────────────────────────────
// Whisper (Groq) entiende mucho mejor a una niña; el del navegador queda de respaldo.
async function useWhisper() {
    try { return (await import('./whisper.js')).whisperAvailable(); } catch (e) { return false; }
}

export function startListening() {
    // Guardas duras: no escuchar si Ron habla/piensa, ni si el TTS sigue sonando (anti-eco)
    if (!RonState.isMicEnabled) return;
    if (!MIC_ALLOWED_STATES.includes(RonState.activityState)) {
        // Estamos hablando/pensando: reintentar en breve sin bloquear
        scheduleListen(500);
        return;
    }
    if (window.speechSynthesis && window.speechSynthesis.speaking) {
        scheduleListen(300);
        return;
    }
    if (RonState.isRecognitionActive || recognitionStarting) return;
    useWhisper().then(async whisper => {
        if (whisper) {
            const w = await import('./whisper.js');
            if (await w.ensureWhisper()) return;          // Whisper escucha de forma continua
        } else {
            import('./whisper.js').then(w => w.stopWhisper()).catch(() => {});  // liberar el micro
        }
        startBrowserRecognition();
    });
}

function startBrowserRecognition() {
    if (RonState.isRecognitionActive || recognitionStarting) return;
    if (!RonState.isMicEnabled || !MIC_ALLOWED_STATES.includes(RonState.activityState)) return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { log("SpeechRecognition no disponible."); return; }

    recognitionStarting = true;
    RonState.recognition = new SpeechRecognition();
    RonState.recognition.lang           = 'es-ES';
    RonState.recognition.continuous     = false;  // más estable en Android Chrome
    RonState.recognition.interimResults = false;

    RonState.recognition.onstart = () => {
        recognitionStarting = false;
        RonState.isRecognitionActive = true;
        recognitionStartTs = Date.now();
        if (RonState.activityState === 'IDLE') changeState('LISTENING');
        log("🎙️ Escuchando...");
    };

    RonState.recognition.onresult = (e) => {
        // Anti-eco: si acabamos de hablar hace nada, probablemente Ron se oyó a sí mismo
        if (Date.now() - lastSpeakEndTs < ECHO_GUARD_MS) { log("Ignorado (eco propio)."); return; }

        let text = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
            if (e.results[i].isFinal) text += e.results[i][0].transcript;
        }
        if (text.trim().length >= 2) quickEndCount = 0;   // hubo voz real: resetear backoff
        processTranscript(text);
    };

    RonState.recognition.onerror = (e) => {
        recognitionStarting = false;
        RonState.isRecognitionActive = false;
        // 'no-speech'/'aborted' son normales; reintentar en silencio
        if (e.error === 'no-speech' || e.error === 'aborted' || e.error === 'network') {
            scheduleListen(RESTART_DELAY);
        } else {
            log(`Error mic: ${e.error}`);
            scheduleListen(1500);
        }
    };

    RonState.recognition.onend = () => {
        recognitionStarting = false;
        RonState.isRecognitionActive = false;
        if (RonState.activityState === 'LISTENING') changeState('IDLE');

        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        if (isIOS) {
            log("iOS: micrófono detenido. Pulsa el botón para hablar.");
            RonState.isMicEnabled = false;
            if (RonState.ui.micToggleBtn) RonState.ui.micToggleBtn.classList.add('off');
            return;
        }

        // Anti-bucle: si la sesión murió al instante (sin audio), espaciar cada vez más
        const lasted = Date.now() - recognitionStartTs;
        if (lasted < 1200) {
            quickEndCount = Math.min(quickEndCount + 1, 6);
        } else {
            quickEndCount = 0;
        }
        const delay = quickEndCount > 1
            ? Math.min(1000 + quickEndCount * 800, 5000) // backoff progresivo hasta 5s
            : RESTART_DELAY;
        scheduleListen(delay);
    };

    try {
        RonState.recognition.start();
    } catch (e) {
        log("Fallo al iniciar mic: " + e.message);
        recognitionStarting = false;
        RonState.isRecognitionActive = false;
        scheduleListen(1500);
    }
}

// ── HABLAR ────────────────────────────────────────────────────────────────────
export function speak(text, { remember = true } = {}) {
    if (remember && text && String(text).trim()) rememberTurn('assistant', text);
    return new Promise(async (resolve) => {
        // Sin texto o solo espacios: no dejar a Ron con cara de "pensando" y mudo
        if (!text || !String(text).trim()) {
            setExpression('neutral');
            changeState('IDLE');
            scheduleListen(RESTART_DELAY);
            return resolve();
        }

        // Voz de Gemini: preparar el audio ANTES de animar la boca (Ron sigue "pensando").
        // Si no hay clave, falla o tarda demasiado → voz del navegador.
        let tts = null, clip = null;
        const mySeq = ++speakSeq;
        try {
            tts = await import('./tts.js');
            tts.stopAudio();
            if (tts.ttsAvailable()) {
                RonState.ttsPending = true;
                clip = await tts.synthesize(text);
            }
        } catch (e) { log('Voz: ' + e.message); }
        finally { RonState.ttsPending = false; }
        if (mySeq !== speakSeq) return resolve();   // otra frase la ha sustituido

        if (!clip && !window.speechSynthesis) {
            setExpression('neutral'); changeState('IDLE'); scheduleListen(RESTART_DELAY);
            return resolve();
        }

        // Cortar cualquier escucha en curso mientras Ron habla (no se oiga a sí mismo)
        if (listenTimer) { clearTimeout(listenTimer); listenTimer = null; }
        if (RonState.recognition) { try { RonState.recognition.abort(); } catch (e) {} }

        // Limpiar animación de boca anterior si la hubiera
        if (activeMouthInterval) { clearInterval(activeMouthInterval); activeMouthInterval = null; }

        // Tras hablar vuelve a su estado de reposo: de noche, a dormir (sin pasar por IDLE)
        const restState = RonState.activityState === 'NIGHT' ? 'NIGHT' : 'IDLE';
        changeState('SPEAKING');
        setExpression(restState === 'NIGHT' ? 'flat' : 'neutral');
        if (RonState.ui.mouth) RonState.ui.mouth.classList.add('is-speaking');

        const mouthShapes = [
            'M 50 15 A 20 20 0 0 1 50 55 A 20 20 0 0 1 50 15 Z',
            'M 30 15 L 70 15 L 70 55 L 30 55 Z',
            'M 50 25 A 10 10 0 0 1 50 45 A 10 10 0 0 1 50 25 Z',
            'M 20 25 Q 50 65 80 25 Z',
            'M 50 15 L 70 50 L 30 50 Z',
            'M 20 30 L 80 30 L 80 40 L 20 40 Z'
        ];
        let shapeIdx = 0;
        activeMouthInterval = setInterval(() => {
            if (RonState.activityState === 'SPEAKING') {
                updateMouth(mouthShapes[shapeIdx % mouthShapes.length]);
                shiftEyes();
                shapeIdx++;
            } else {
                clearInterval(activeMouthInterval);
                activeMouthInterval = null;
                if (RonState.ui.mouth) RonState.ui.mouth.classList.remove('is-speaking');
                setExpression('neutral');
            }
        }, 200);

        // Un solo camino de finalización (protege contra doble-resolve)
        let finished = false;
        const finish = () => {
            if (finished) return;
            finished = true;
            if (ttsWatchdog)  { clearTimeout(ttsWatchdog);   ttsWatchdog  = null; }
            if (ttsKeepAlive) { clearInterval(ttsKeepAlive); ttsKeepAlive = null; }
            if (activeMouthInterval) { clearInterval(activeMouthInterval); activeMouthInterval = null; }
            if (RonState.ui.mouth) RonState.ui.mouth.classList.remove('is-speaking');
            if (RonState.ui.mouthContainer) RonState.ui.mouthContainer.classList.remove('mouth-vibrate');

            lastSpeakEndTs = Date.now();
            RonState.isWaitingForWakeWord = restState === 'NIGHT'; // de noche hay que decir "Ron"
            changeState(restState);
            if (restState === 'NIGHT') setExpression('flat');

            // Re-armar la exigencia de "Ron" cuando pase la ventana de charla
            if (convTimeout) clearTimeout(convTimeout);
            convTimeout = setTimeout(() => {
                RonState.isWaitingForWakeWord = true;
                log("Ventana de charla cerrada. Di 'Ron' para hablarme.");
            }, CONV_WINDOW);

            // Volver a escuchar (con retardo anti-eco). scheduleListen es single-flight.
            scheduleListen(RESTART_DELAY);
            resolve();
        };

        // ── Voz de Gemini con efecto robot ──
        if (clip) {
            try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) {}
            Sounds.playBeep(880, 'square', 0.08, 0.05);
            if (RonState.ui.mouthContainer) RonState.ui.mouthContainer.classList.add('mouth-vibrate');
            const playing = tts.play(clip);
            ttsWatchdog = setTimeout(() => { log('Watchdog voz: forzando fin.'); tts.stopAudio(); finish(); }, playing.durationMs + 3000);
            playing.done.then(finish);
            return;
        }

        // ── Voz del navegador (respaldo) ──
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        const voices = window.speechSynthesis.getVoices();
        const best = voices.find(v => v.lang.startsWith('es') && (v.name.includes('Google') || v.name.includes('Natural')))
                  || voices.find(v => v.lang.startsWith('es'));
        if (best) u.voice = best;

        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        u.lang = 'es-ES';
        if (isIOS) { u.pitch = 1.0; u.rate = 1.0; }
        else       { u.pitch = 1.4; u.rate = 1.1; }

        u.onstart = () => {
            Sounds.playBeep(880, 'square', 0.08, 0.05);
            if (RonState.ui.mouthContainer) RonState.ui.mouthContainer.classList.add('mouth-vibrate');
        };
        u.onend   = () => finish();
        u.onerror = (e) => { log(`Error síntesis: ${e?.error}`); finish(); };

        // WATCHDOG: si onend nunca llega (bug de Android Chrome), forzar fin.
        // Estimación generosa según longitud del texto.
        const estMs = Math.min(90000, Math.max(4000, text.length * 90 + 3500));
        ttsWatchdog = setTimeout(() => {
            log("Watchdog TTS: 'onend' no llegó, forzando fin.");
            try { window.speechSynthesis.cancel(); } catch (e) {}
            finish();
        }, estMs);

        // KEEP-ALIVE: Chrome corta locuciones largas a ~15s. resume() lo evita.
        ttsKeepAlive = setInterval(() => {
            if (window.speechSynthesis.speaking) {
                try { window.speechSynthesis.resume(); } catch (e) {}
            }
        }, 8000);

        window.speechSynthesis.speak(u);
    });
}

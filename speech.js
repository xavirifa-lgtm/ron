import { RonState, RonConfig, log, changeState, rememberTurn } from './core.js';
import { setExpression, updateMouth, shiftEyes, showCaption } from './ui.js';
import { handleInput } from './ai.js';
import * as Sounds from './sounds.js';

// ── Configuración del bucle de conversación (v28) ────────────────────────────
const MIC_ALLOWED_STATES = ['IDLE', 'SLEEPING', 'STORY', 'MATH_GAME', 'READING_GAME', 'NIGHT'];
const RESTART_DELAY = 700;    // ms de silencio tras hablar antes de re-escuchar (anti-eco)
const CONV_WINDOW   = 25000;  // ms de "charla libre" sin decir "Ron" tras cada respuesta
const FACE_RECENT   = 6000;   // si la ha visto hace menos de esto, está delante: no hace falta "Ron"
const ECHO_GUARD_MS = 400;    // ignorar lo "oído" justo tras terminar de hablar (era su propia voz)
// "Ron" y cómo lo escribe a veces el reconocimiento con voz de niña
const WAKE_RE = /\b(ron|rom|ronn|rhon|roon|ronnie|rony|ronny)\b/i;

let convTimeout        = null;
let activeMouthInterval = null;
let listenTimer        = null;  // single-flight: solo un re-arranque de micro pendiente a la vez
let recognitionStarting = false;
let recognitionStartTs  = 0;
let quickEndCount       = 0;
let speakSeq           = 0;     // turno: si llega otra frase, gana la última
let ttsWatchdog        = null;
let ttsKeepAlive       = null;
let currentFinish      = null;  // para poder cortar a Ron (tocar la pantalla)

function scheduleListen(delay = RESTART_DELAY) {
    if (listenTimer) { clearTimeout(listenTimer); listenTimer = null; }
    listenTimer = setTimeout(() => { listenTimer = null; startListening(); }, delay);
}

export function getLastSpeakEndTs() { return RonState.lastSpeakEndTs || 0; }

function faceIsHere() {
    return Date.now() - (RonState.faceSeenTs || 0) < FACE_RECENT;
}

// ¿Hace falta decir "Ron" ahora mismo?
export function needsWakeWord() {
    const st = RonState.activityState;
    if (['MATH_GAME', 'READING_GAME'].includes(st)) return false;
    if (st === 'STORY' && RonState.storyPendingNextChapter) return false;
    if (RonState.nameFlow) return false;
    if (st === 'NIGHT' || st === 'SLEEPING') return true;          // dormido: solo con su nombre
    if (!RonState.isWaitingForWakeWord) return false;               // ventana de charla abierta
    if ((RonConfig.listenMode || 'cara') === 'cara' && faceIsHere()) return false;  // la tiene delante
    return true;
}

function openConversationWindow() {
    RonState.isWaitingForWakeWord = false;
    if (convTimeout) clearTimeout(convTimeout);
    convTimeout = setTimeout(() => {
        RonState.isWaitingForWakeWord = true;
        log("Ventana de charla cerrada. Di 'Ron' (o ponte delante) para hablarme.");
    }, CONV_WINDOW);
}

// "¿Sí?" sin palabras: pitido ascendente + ojos abiertos. Instantáneo (no gasta voz).
function attentionChirp() {
    Sounds.playBeep(660, 'sine', 0.07, 0.06);
    setTimeout(() => Sounds.playBeep(990, 'sine', 0.09, 0.06), 90);
    setExpression('surprise');
    setTimeout(() => { if (['IDLE', 'LISTENING'].includes(RonState.activityState)) setExpression('happy'); }, 900);
    showCaption('Te escucho…', 'hint');
}

// ── Lo que se ha oído (venga del navegador o de Whisper) ─────────────────────
export function processTranscript(rawText) {
    let text = (rawText || '').trim();
    if (!text || text.length < 2) return;
    const t = text.toLowerCase();
    RonState.lastHeardTs = Date.now();
    log(`Oído: ${text}`);

    // Respuesta al nombre: tiene prioridad y no necesita palabra clave
    if (RonState.nameFlow) {
        showCaption(text, 'heard');
        if (convTimeout) clearTimeout(convTimeout);
        rememberTurn('user', text);
        import('./identity.js').then(async id => {
            const handled = await id.handleNameReply(text);
            if (!handled) handleInput(text);
        });
        return;
    }

    const saidRon = WAKE_RE.test(t);
    if (needsWakeWord()) {
        if (!saidRon) {
            showCaption(text, 'ignored');                    // lo ha oído, pero espera "Ron"
            return;
        }
        // Dormido por no ver a nadie: "Ron" lo despierta
        if (RonState.activityState === 'SLEEPING') {
            changeState('IDLE');
            setExpression('happy');
            RonState.framesWithoutFace = 0;
            log('Despertado por voz.');
        }
        const rest = t.replace(new RegExp(WAKE_RE.source, 'gi'), '').replace(/^(hola|oye|eh|ey)\b/, '').replace(/[,.!¡?¿]/g, '').trim();
        if (RonState.activityState === 'NIGHT') { showCaption(text, 'heard'); handleInput(text); return; }
        openConversationWindow();
        if (!rest || rest.length < 2) { attentionChirp(); return; }
    } else if (RonState.activityState === 'SLEEPING') {
        changeState('IDLE');
    }
    showCaption(text, 'heard');
    if (!['IDLE', 'LISTENING', 'STORY', 'MATH_GAME', 'READING_GAME', 'NIGHT'].includes(RonState.activityState)) {
        log(`(Ignorado: Ron estaba ${RonState.activityState})`);
        return;
    }
    if (convTimeout) clearTimeout(convTimeout);
    handleInput(text);
}

// ── Motor de escucha ─────────────────────────────────────────────────────────
async function useWhisper() {
    try { return (await import('./whisper.js')).whisperAvailable(); } catch (e) { return false; }
}

export function startListening() {
    if (!RonState.isMicEnabled) return;
    if (RonState.activityState === 'LISTENING') return;          // ya está oyendo
    if (!MIC_ALLOWED_STATES.includes(RonState.activityState)) { scheduleListen(500); return; }
    if (window.speechSynthesis && window.speechSynthesis.speaking) { scheduleListen(300); return; }
    if (RonState.isRecognitionActive || recognitionStarting) return;
    useWhisper().then(async whisper => {
        if (whisper) {
            const w = await import('./whisper.js');
            if (await w.ensureWhisper()) return;          // Whisper escucha de forma continua
        } else {
            import('./whisper.js').then(w => w.stopWhisper()).catch(() => {});
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
    RonState.recognition.maxAlternatives = 3;

    RonState.recognition.onstart = () => {
        recognitionStarting = false;
        RonState.isRecognitionActive = true;
        recognitionStartTs = Date.now();
        log("🎙️ Escuchando (navegador)...");
    };

    RonState.recognition.onresult = (e) => {
        if (Date.now() - getLastSpeakEndTs() < ECHO_GUARD_MS) { log("Ignorado (eco propio)."); return; }
        let text = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
            if (!e.results[i].isFinal) continue;
            // Si alguna alternativa contiene "Ron", usar esa (el navegador a veces oye "bon", "son"...)
            const alts = Array.from(e.results[i]).map(a => a.transcript);
            text += (needsWakeWord() && alts.find(a => WAKE_RE.test(a))) || alts[0];
        }
        if (text.trim().length >= 2) quickEndCount = 0;
        processTranscript(text);
    };

    RonState.recognition.onerror = (e) => {
        recognitionStarting = false;
        RonState.isRecognitionActive = false;
        if (e.error === 'no-speech' || e.error === 'aborted' || e.error === 'network') scheduleListen(RESTART_DELAY);
        else { log(`Error mic: ${e.error}`); scheduleListen(1500); }
    };

    RonState.recognition.onend = () => {
        recognitionStarting = false;
        RonState.isRecognitionActive = false;
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        if (isIOS) {
            log("iOS: micrófono detenido. Pulsa el botón para hablar.");
            RonState.isMicEnabled = false;
            if (RonState.ui.micToggleBtn) RonState.ui.micToggleBtn.classList.add('off');
            return;
        }
        const lasted = Date.now() - recognitionStartTs;
        quickEndCount = lasted < 1200 ? Math.min(quickEndCount + 1, 6) : 0;
        scheduleListen(quickEndCount > 1 ? Math.min(1000 + quickEndCount * 800, 5000) : RESTART_DELAY);
    };

    try { RonState.recognition.start(); }
    catch (e) {
        log("Fallo al iniciar mic: " + e.message);
        recognitionStarting = false;
        RonState.isRecognitionActive = false;
        scheduleListen(1500);
    }
}

// ── Cortar a Ron (tocar la pantalla mientras habla) ──────────────────────────
export function interruptSpeaking() {
    if (RonState.activityState !== 'SPEAKING' || !currentFinish) return false;
    speakSeq++;
    import('./tts.js').then(t => t.stopAudio()).catch(() => {});
    try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) {}
    log('Ron interrumpido: te escucho.');
    currentFinish();
    attentionChirp();
    return true;
}

// ── Voz del navegador como promesa (con vigilante y keep-alive de Android) ───
function browserSay(text) {
    return new Promise(resolve => {
        if (!window.speechSynthesis) return resolve();
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        const voices = window.speechSynthesis.getVoices();
        const best = voices.find(v => v.lang.startsWith('es') && (v.name.includes('Google') || v.name.includes('Natural')))
                  || voices.find(v => v.lang.startsWith('es'));
        if (best) u.voice = best;
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        u.lang = 'es-ES';
        if (isIOS) { u.pitch = 1.0; u.rate = 1.0; } else { u.pitch = 1.4; u.rate = 1.1; }
        let done = false;
        const end = () => {
            if (done) return; done = true;
            if (ttsWatchdog)  { clearTimeout(ttsWatchdog);   ttsWatchdog  = null; }
            if (ttsKeepAlive) { clearInterval(ttsKeepAlive); ttsKeepAlive = null; }
            resolve();
        };
        u.onend = end;
        u.onerror = (e) => { log(`Error síntesis: ${e?.error}`); end(); };
        const estMs = Math.min(90000, Math.max(4000, text.length * 90 + 3500));
        ttsWatchdog = setTimeout(() => { log("Watchdog TTS: forzando fin."); try { window.speechSynthesis.cancel(); } catch (e) {} end(); }, estMs);
        ttsKeepAlive = setInterval(() => { if (window.speechSynthesis.speaking) { try { window.speechSynthesis.resume(); } catch (e) {} } }, 8000);
        window.speechSynthesis.speak(u);
    });
}

function playClip(tts, clip) {
    return new Promise(resolve => {
        const playing = tts.play(clip);
        const wd = setTimeout(() => { log('Watchdog voz: forzando fin.'); tts.stopAudio(); resolve(); }, playing.durationMs + 3000);
        playing.done.then(() => { clearTimeout(wd); resolve(); });
    });
}

// ── HABLAR ────────────────────────────────────────────────────────────────────
export function speak(text, { remember = true } = {}) {
    if (remember && text && String(text).trim()) rememberTurn('assistant', text);
    return new Promise(async (resolve) => {
        if (!text || !String(text).trim()) {
            setExpression('neutral');
            changeState('IDLE');
            scheduleListen(RESTART_DELAY);
            return resolve();
        }
        text = String(text).trim();
        const mySeq = ++speakSeq;

        // Voz de Gemini: pedir la PRIMERA frase y el resto en paralelo; empezar a hablar
        // en cuanto llega la primera. Si falla o tarda → voz del navegador.
        let tts = null, first = null, restP = null, parts = [text];
        try {
            tts = await import('./tts.js');
            tts.stopAudio();
            if (tts.ttsAvailable()) {
                parts = tts.splitForSpeech(text);
                RonState.ttsPending = true;
                const p1 = tts.synthesize(parts[0], { budgetMs: 5000 });
                restP = parts[1] ? tts.synthesize(parts[1], { budgetMs: 15000 }) : null;
                first = await p1;
                if (!first) { parts = [text]; restP = null; }
            }
        } catch (e) { log('Voz: ' + e.message); }
        finally { RonState.ttsPending = false; }
        if (mySeq !== speakSeq) return resolve();

        if (!first && !window.speechSynthesis) {
            setExpression('neutral'); changeState('IDLE'); scheduleListen(RESTART_DELAY);
            return resolve();
        }

        if (listenTimer) { clearTimeout(listenTimer); listenTimer = null; }
        if (RonState.recognition) { try { RonState.recognition.abort(); } catch (e) {} }
        if (activeMouthInterval) { clearInterval(activeMouthInterval); activeMouthInterval = null; }

        const restState = RonState.activityState === 'NIGHT' ? 'NIGHT' : 'IDLE';
        changeState('SPEAKING');
        if (restState === 'NIGHT') setExpression('flat');
        else if (!['happy', 'star', 'sad', 'surprise', 'recognised'].includes(RonState.expressionState)) setExpression('neutral');
        showCaption(text, 'ron');

        // Compatibilidad con la boca SVG antigua (oculta) y mirada viva al hablar
        activeMouthInterval = setInterval(() => {
            if (RonState.activityState === 'SPEAKING') shiftEyes();
            else { clearInterval(activeMouthInterval); activeMouthInterval = null; }
        }, 600);

        let finished = false;
        const finish = () => {
            if (finished) return;
            finished = true;
            currentFinish = null;
            if (ttsWatchdog)  { clearTimeout(ttsWatchdog);   ttsWatchdog  = null; }
            if (ttsKeepAlive) { clearInterval(ttsKeepAlive); ttsKeepAlive = null; }
            if (activeMouthInterval) { clearInterval(activeMouthInterval); activeMouthInterval = null; }
            if (RonState.ui.mouthContainer) RonState.ui.mouthContainer.classList.remove('mouth-vibrate');
            RonState.lastSpeakEndTs = Date.now();
            changeState(restState);
            if (restState === 'NIGHT') { RonState.isWaitingForWakeWord = true; setExpression('flat'); }
            else openConversationWindow();       // tras hablar, se le puede contestar sin "Ron"
            scheduleListen(RESTART_DELAY);
            resolve();
        };
        currentFinish = finish;

        Sounds.playBeep(880, 'square', 0.08, 0.05);
        if (first) {
            try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) {}
            await playClip(tts, first);
            if (mySeq !== speakSeq || finished) return resolve();
            if (parts[1]) {
                const rest = await restP;
                if (mySeq !== speakSeq || finished) return resolve();
                if (rest) await playClip(tts, rest);
                else await browserSay(parts[1]);      // el resto no llegó: que no se quede a medias
            }
        } else {
            await browserSay(text);
        }
        if (mySeq === speakSeq) finish(); else resolve();
    });
}

import { RonState, log, changeState } from './core.js';
import { setExpression, triggerSafetyGlitch, updateMouth, shiftEyes } from './ui.js';
import { handleInput } from './ai.js';
import * as Sounds from './sounds.js';

// ── Configuración del bucle de conversación ──────────────────────────────────
const MIC_ALLOWED_STATES = ['IDLE', 'STORY', 'MATH_GAME', 'READING_GAME'];
const RESTART_DELAY = 700;    // ms de silencio tras hablar antes de re-escuchar (anti-eco)
const CONV_WINDOW   = 12000;  // ms de "charla libre" sin decir "Ron" tras cada respuesta
const ECHO_GUARD_MS = 400;    // ignorar lo "oído" justo tras terminar de hablar (era su propia voz)

let convTimeout        = null;
let activeMouthInterval = null;
let listenTimer        = null;  // single-flight: solo un re-arranque de micro pendiente a la vez
let recognitionStarting = false; // guarda síncrona contra dobles arranques del micro
let lastSpeakEndTs     = 0;
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
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { log("SpeechRecognition no disponible."); return; }
    if (RonState.isRecognitionActive || recognitionStarting) return;

    recognitionStarting = true;
    RonState.recognition = new SpeechRecognition();
    RonState.recognition.lang           = 'es-ES';
    RonState.recognition.continuous     = false;  // más estable en Android Chrome
    RonState.recognition.interimResults = false;

    RonState.recognition.onstart = () => {
        recognitionStarting = false;
        RonState.isRecognitionActive = true;
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
        text = text.trim();
        if (!text || text.length < 2) return;   // descartar ruido/fragmentos
        const t = text.toLowerCase();

        log(`Oído: ${text}`);

        const inGame  = ['MATH_GAME', 'READING_GAME'].includes(RonState.activityState);
        const inStory = RonState.activityState === 'STORY' && RonState.storyPendingNextChapter;

        // Fuera de juego/cuento: exigir "Ron" solo cuando la ventana de charla está cerrada
        if (RonState.isWaitingForWakeWord && !inStory && !inGame) {
            if (t.includes("ron")) {
                RonState.isWaitingForWakeWord = false;
                const rest = t.replace(/ron/g, '').trim();
                if (!rest || rest.length < 2) {
                    speak(`¡Bip! ¿Qué pasa, ${RonState.currentUser || 'humano'}?`);
                    return;
                }
                // Si dijo "Ron ..." con contenido, procesamos ese contenido
            } else {
                return; // ambiente ignorado hasta que digan "Ron"
            }
        } else if (!inStory && !inGame) {
            if (convTimeout) clearTimeout(convTimeout); // sigue la charla, no cerrar ventana aún
        }

        if (RonState.isLearningFace && RonState.tempDescriptor) saveNewUser(text);
        else handleInput(text);
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
        scheduleListen(RESTART_DELAY);
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

export function saveNewUser(text) {
    let name = text.toLowerCase()
        .replace(/me llamo |mi nombre es |soy |me llaman |me dicen /gi, "")
        .replace(/[.,!¡?¿]/g, "")
        .trim();

    name = name.charAt(0).toUpperCase() + name.slice(1);

    if (name.length < 2 || name === "Me llamo" || name === "Soy") {
        return speak("¡Bip! No he pillado bien tu nombre. ¿Me lo repites clarito?");
    }
    if (name.split(" ").length > 3) {
        return speak("¡Bip! Ese nombre es muy largo para mi disco duro. Dime solo tu nombre real.");
    }

    const descriptorsToSave = (RonState.learningDescriptors && RonState.learningDescriptors.length > 0)
        ? RonState.learningDescriptors
        : (RonState.tempDescriptor ? [RonState.tempDescriptor] : []);

    if (descriptorsToSave.length === 0) {
        return speak("¡Bip! No pude ver tu cara. ¡Mira a la cámara y dime tu nombre otra vez!");
    }

    try {
        const refDesc = new Float32Array(descriptorsToSave[0]);
        RonState.knownFaces = RonState.knownFaces.filter(f => {
            const ds = f.descriptors || [f.descriptor];
            return !ds.some(dd => faceapi.euclideanDistance(refDesc, new Float32Array(dd)) < 0.45);
        });
    } catch (e) { log("Dedup error: " + e.message); }

    RonState.knownFaces.push({ label: name, descriptors: descriptorsToSave });
    localStorage.setItem('ron_known_faces', JSON.stringify(RonState.knownFaces));
    log(`Cara guardada: ${name} (${descriptorsToSave.length} muestras)`);

    RonState.currentUser = name;
    if (!RonState.userStats[name]) {
        RonState.userStats[name] = { likes: [], dislikes: [], lastSeen: new Date().toISOString() };
    }
    localStorage.setItem('ron_user_stats', JSON.stringify(RonState.userStats));

    RonState.isLearningFace      = false;
    RonState.tempDescriptor      = null;
    RonState.learningDescriptors = [];
    RonState.conversation        = []; // nuevo amigo, hilo limpio
    RonState.conversationOwner   = name;
    import('./ui.js').then(ui => ui.stopScanningUI());

    speak(`¡Bip! ¡Entendido, ${name}! Ya estás grabado en mi memoria a fuego. ¡Somos mejores amigos!`);
}

// ── HABLAR ────────────────────────────────────────────────────────────────────
export function speak(text) {
    return new Promise((resolve) => {
        // Sin texto o solo espacios: no dejar a Ron con cara de "pensando" y mudo
        if (!window.speechSynthesis || !text || !String(text).trim()) {
            setExpression('neutral');
            changeState('IDLE');
            scheduleListen(RESTART_DELAY);
            return resolve();
        }

        // Cortar cualquier escucha en curso mientras Ron habla (no se oiga a sí mismo)
        if (listenTimer) { clearTimeout(listenTimer); listenTimer = null; }
        if (RonState.recognition) { try { RonState.recognition.abort(); } catch (e) {} }

        // Limpiar animación de boca anterior si la hubiera
        if (activeMouthInterval) { clearInterval(activeMouthInterval); activeMouthInterval = null; }

        changeState('SPEAKING');
        setExpression('neutral');
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
            RonState.isWaitingForWakeWord = false; // abrir ventana de charla libre
            changeState('IDLE');

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
        const estMs = Math.min(30000, Math.max(4000, text.length * 90 + 3500));
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

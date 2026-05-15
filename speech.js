import { RonState, log, changeState } from './core.js';
import { setExpression, triggerSafetyGlitch, updateMouth, shiftEyes } from './ui.js';
import { handleInput } from './ai.js';
import * as Sounds from './sounds.js';

let convTimeout      = null;
let activeMouthInterval = null;

// Estados donde el micrófono puede estar activo esperando entrada
const MIC_ALLOWED_STATES = ['IDLE', 'STORY', 'MATH_GAME', 'READING_GAME'];

export function startListening() {
    if (!MIC_ALLOWED_STATES.includes(RonState.activityState) || !RonState.isMicEnabled) return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { log("SpeechRecognition no disponible."); return; }
    if (RonState.isRecognitionActive) return; 
    
    RonState.recognition = new SpeechRecognition();
    RonState.recognition.lang = 'es-ES';
    RonState.recognition.continuous = false;      // false es más estable en Android Chrome
    RonState.recognition.interimResults = false;  // Solo resultados finales = menos ruido

    RonState.recognition.onstart = () => {
        RonState.isRecognitionActive = true;
        if (RonState.activityState === 'IDLE') changeState('LISTENING');
        // En STORY/MATH_GAME/READING_GAME mantenemos el estado para que handleInput lo detecte
        log("🎙️ Escuchando...");
    };

    RonState.recognition.onresult = (e) => {
        // Coger siempre el último resultado final disponible
        let text = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
            if (e.results[i].isFinal) text += e.results[i][0].transcript;
        }
        if (!text.trim()) return;
        const t = text.toLowerCase().trim();
        
        log(`Oído: ${text}`);

        // En juegos/cuento saltamos el filtro de wake word — el niño está respondiendo al juego
        const inGame = ['MATH_GAME', 'READING_GAME'].includes(RonState.activityState);
        const inStory = RonState.activityState === 'STORY' && RonState.storyPendingNextChapter;

        if (RonState.isWaitingForWakeWord && !inStory && !inGame) {
            if (t.includes("ron")) {
                RonState.isWaitingForWakeWord = false;
                const words = t.replace(/ron/g,'').trim();
                if (!words || words.length < 2) {
                    speak(`¡Bip! ¿Qué pasa, ${RonState.currentUser || 'humano'}?`);
                    return;
                }
            } else {
                return;
            }
        } else if (!inStory && !inGame) {
            if (convTimeout) clearTimeout(convTimeout);
        }

        if (RonState.isLearningFace && RonState.tempDescriptor) saveNewUser(text);
        else handleInput(text);
    };

    RonState.recognition.onerror = (e) => {
        log(`Error mic: ${e.error}`);
        RonState.isRecognitionActive = false;
        // 'no-speech' y 'aborted' son normales, reiniciar silenciosamente
        if (e.error === 'no-speech' || e.error === 'aborted') {
            if (MIC_ALLOWED_STATES.includes(RonState.activityState) && RonState.isMicEnabled) {
                setTimeout(() => startListening(), 800);
            }
        }
    };

    RonState.recognition.onend = () => {
        RonState.isRecognitionActive = false;
        if (RonState.activityState === 'LISTENING') changeState('IDLE');

        // Auto-reinicio en Android/PC (no iOS) — también en juegos/cuento para escuchar respuestas
        if (MIC_ALLOWED_STATES.includes(RonState.activityState) && RonState.isMicEnabled) {
            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                          (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
            if (!isIOS) {
                setTimeout(() => startListening(), 800);
            } else {
                log("iOS: Micrófono detenido. Pulsa el botón para hablar.");
                RonState.isMicEnabled = false;
                RonState.ui.micToggleBtn.classList.add('off');
            }
        }
    };

    try { 
        RonState.recognition.start();
    } catch(e) { 
        log("Fallo al iniciar mic: " + e.message);
        RonState.isRecognitionActive = false;
        setTimeout(() => {
            if (MIC_ALLOWED_STATES.includes(RonState.activityState) && RonState.isMicEnabled) startListening();
        }, 2000);
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

    // Usar todos los descriptores acumulados (hasta 10 muestras para robustez)
    const descriptorsToSave = (RonState.learningDescriptors && RonState.learningDescriptors.length > 0)
        ? RonState.learningDescriptors
        : (RonState.tempDescriptor ? [RonState.tempDescriptor] : []);

    if (descriptorsToSave.length === 0) {
        return speak("¡Bip! No pude ver tu cara. ¡Mira a la cámara y dime tu nombre otra vez!");
    }

    // Eliminar entradas anteriores de la misma cara (evita duplicados entre sesiones)
    try {
        const refDesc = new Float32Array(descriptorsToSave[0]);
        RonState.knownFaces = RonState.knownFaces.filter(f => {
            const ds = f.descriptors || [f.descriptor];
            return !ds.some(dd => faceapi.euclideanDistance(refDesc, new Float32Array(dd)) < 0.45);
        });
    } catch(e) { log("Dedup error: " + e.message); }

    RonState.knownFaces.push({ label: name, descriptors: descriptorsToSave });
    localStorage.setItem('ron_known_faces', JSON.stringify(RonState.knownFaces));
    log(`Cara guardada: ${name} (${descriptorsToSave.length} muestras)`);

    RonState.currentUser = name;
    if (!RonState.userStats[name]) {
        RonState.userStats[name] = { likes: [], dislikes: [], lastSeen: new Date().toISOString() };
    }
    localStorage.setItem('ron_user_stats', JSON.stringify(RonState.userStats));

    // Resetear todo el estado de aprendizaje
    RonState.isLearningFace = false;
    RonState.tempDescriptor = null;
    RonState.learningDescriptors = [];
    import('./ui.js').then(ui => ui.stopScanningUI());

    speak(`¡Bip! ¡Entendido, ${name}! Ya estás grabado en mi memoria a fuego. ¡Somos mejores amigos!`);
}

export function speak(text) {
    return new Promise((resolve) => {
        if (!window.speechSynthesis) {
            changeState('IDLE');
            return resolve();
        }
        if (RonState.recognition) try { RonState.recognition.abort(); } catch(e) {}
        // Cancelar intervalo anterior para evitar dos loops de boca en paralelo
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
        }, 200); // <-- Ralentizado de 110ms a 200ms para más fluidez

        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        const voices = window.speechSynthesis.getVoices();
        const best = voices.find(v => v.lang.startsWith('es') && (v.name.includes('Google') || v.name.includes('Natural'))) || voices.find(v => v.lang.startsWith('es'));
        if (best) u.voice = best;
        
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        
        u.lang = 'es-ES'; 
        // iOS Safari se vuelve loco y distorsiona el sonido si tocamos el pitch/rate
        if (isIOS) {
            u.pitch = 1.0; 
            u.rate = 1.0;
        } else {
            u.pitch = 1.4; 
            u.rate = 1.1;
        }
        
        u.onstart = () => {
            Sounds.playBeep(880, 'square', 0.08, 0.05); // Bip inicial
            RonState.ui.mouthContainer.classList.add('mouth-vibrate');
        };
        u.onend = () => {
            if (activeMouthInterval) { clearInterval(activeMouthInterval); activeMouthInterval = null; }
            if (RonState.ui.mouth) RonState.ui.mouth.classList.remove('is-speaking');
            if (RonState.ui.mouthContainer) RonState.ui.mouthContainer.classList.remove('mouth-vibrate');
            RonState.isWaitingForWakeWord = false; // Abrir ventana de conversación libre
            changeState('IDLE');
            
            // Reiniciar escucha explícitamente tras hablar — también en juegos y cuento
            setTimeout(() => {
                if (MIC_ALLOWED_STATES.includes(RonState.activityState) && RonState.isMicEnabled && !RonState.isRecognitionActive) {
                    startListening();
                }
            }, 500);
            
            if (convTimeout) clearTimeout(convTimeout);
            convTimeout = setTimeout(() => {
                RonState.isWaitingForWakeWord = true;
                log("Fin de ventana de charla (30s). Esperando 'Ron'.");
            }, 30000); // 30 segundos de ventana libre tras cada respuesta
            resolve();
        };
        u.onerror = (e) => {
            if (activeMouthInterval) { clearInterval(activeMouthInterval); activeMouthInterval = null; }
            if (RonState.ui.mouth) RonState.ui.mouth.classList.remove('is-speaking');
            log(`Error síntesis: ${e?.error}`); changeState('IDLE'); resolve();
        };
        window.speechSynthesis.speak(u);
    });
}

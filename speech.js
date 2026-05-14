import { RonState, log, changeState } from './core.js';
import { setExpression, triggerSafetyGlitch, updateMouth, shiftEyes } from './ui.js';
import { handleInput } from './ai.js';
import * as Sounds from './sounds.js';

let convTimeout   = null;
let mouthInterval = null;
let keepAliveInterval = null; // BUG FIX: referencia global para limpiarlo siempre

function stopMouthAnimation() {
    if (mouthInterval) { clearInterval(mouthInterval); mouthInterval = null; }
    if (RonState.ui.mouth)          RonState.ui.mouth.classList.remove('is-speaking');
    if (RonState.ui.mouthContainer) RonState.ui.mouthContainer.classList.remove('mouth-vibrate');
}

function stopKeepAlive() {
    if (keepAliveInterval) { clearInterval(keepAliveInterval); keepAliveInterval = null; }
}

export function startListening() {
    if (RonState.activityState !== 'IDLE' || !RonState.isMicEnabled) return;
    if (RonState.isRecognitionActive) return;

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { log("SpeechRecognition no disponible."); return; }

    RonState.recognition = new SR();
    RonState.recognition.lang = 'es-ES';
    RonState.recognition.continuous     = false;
    RonState.recognition.interimResults = false;

    RonState.recognition.onstart = () => {
        RonState.isRecognitionActive = true;
        if (RonState.activityState === 'IDLE') changeState('LISTENING');
    };

    RonState.recognition.onresult = (e) => {
        const text = e.results[0][0].transcript.trim();
        const t    = text.toLowerCase();
        log(`Oído: "${text}"`);

        if (RonState.isWaitingForWakeWord) {
            if (t.includes('ron') || t.includes('oye ron') || t.includes('hola ron')) {
                RonState.isWaitingForWakeWord = false;
                if (t.replace(/ron|oye|hola/g, '').trim().length < 2) {
                    speak(`¡Bip! ¿Qué pasa, ${RonState.currentUser || 'humano'}?`);
                    return;
                }
            } else {
                return;
            }
        } else {
            if (convTimeout) clearTimeout(convTimeout);
        }

        if (RonState.isLearningFace && RonState.tempDescriptor) saveNewUser(text);
        else handleInput(text);
    };

    RonState.recognition.onend = () => {
        RonState.isRecognitionActive = false;
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

        if (RonState.activityState === 'LISTENING') {
            changeState('IDLE');
            return;
        }
        if (RonState.activityState === 'IDLE' && RonState.isMicEnabled) {
            if (isIOS) {
                log("iOS: mic en espera. Pulsa 🎙️.");
                RonState.isMicEnabled = false;
                if (RonState.ui.micToggleBtn) RonState.ui.micToggleBtn.classList.add('off');
            } else {
                setTimeout(() => {
                    if (RonState.activityState === 'IDLE' && !RonState.isRecognitionActive) startListening();
                }, 800);
            }
        }
    };

    RonState.recognition.onerror = (e) => {
        log(`Mic error: ${e.error}`);
        RonState.isRecognitionActive = false;
        const delay = e.error === 'no-speech' ? 500 : 2000;
        setTimeout(() => {
            if (RonState.activityState === 'IDLE' && RonState.isMicEnabled && !RonState.isRecognitionActive) startListening();
        }, delay);
    };

    try {
        RonState.recognition.start();
    } catch (e) {
        log("Fallo mic.start: " + e.message);
        RonState.isRecognitionActive = false;
        setTimeout(() => {
            if (RonState.activityState === 'IDLE' && RonState.isMicEnabled) startListening();
        }, 2000);
    }
}

export function saveNewUser(text) {
    // BUG FIX: condición simplificada, eliminado unreachable code
    let name = text.toLowerCase()
        .replace(/me llamo|mi nombre es|soy|me llaman|me dicen/gi, '')
        .replace(/[.,!¡?¿]/g, '')
        .trim();

    if (!name || name.length < 2) {
        speak("¡Bip! No he pillado tu nombre. ¿Me lo repites clarito?");
        return;
    }
    if (name.split(' ').length > 3) {
        speak("¡Bip! Ese nombre es muy largo para mi disco duro. Dime solo tu nombre.");
        return;
    }

    name = name.charAt(0).toUpperCase() + name.slice(1);

    RonState.knownFaces.push({ label: name, descriptors: [RonState.tempDescriptor] });
    localStorage.setItem('ron_known_faces', JSON.stringify(RonState.knownFaces));
    RonState.currentUser = name;
    RonState.userStats[name] = { likes: [], dislikes: [], history: [], lastSeen: new Date().toISOString() };
    localStorage.setItem('ron_user_stats', JSON.stringify(RonState.userStats));
    RonState.isLearningFace = false;
    RonState.tempDescriptor = null;
    import('./ui.js').then(ui => ui.stopScanningUI());
    speak(`¡Bip bip! ¡${name}! ¡Grabado en mi memoria para siempre! ¡Somos mejores amigos del universo!`);
}

export function speak(text) {
    return new Promise((resolve) => {
        if (!window.speechSynthesis) { changeState('IDLE'); return resolve(); }

        if (RonState.recognition) try { RonState.recognition.abort(); } catch(e) {}

        window.speechSynthesis.cancel();
        stopMouthAnimation();
        stopKeepAlive(); // BUG FIX: limpiar keepAlive anterior antes de empezar uno nuevo
        changeState('SPEAKING');
        setExpression('neutral');
        if (RonState.ui.mouth) RonState.ui.mouth.classList.add('is-speaking');

        const mouthShapes = [
            'M 35 8 A 15 15 0 1 1 65 8 A 15 15 0 1 1 35 8 Z',
            'M 28 6 L 72 6 L 72 36 L 28 36 Z',
            'M 40 10 A 10 10 0 1 1 60 10 A 10 10 0 1 1 40 10 Z',
            'M 15 10 Q 50 40 85 10 Z',
            'M 50 5 L 68 35 L 32 35 Z',
            'M 20 16 L 80 16 L 80 26 L 20 26 Z'
        ];
        let idx = 0;
        mouthInterval = setInterval(() => {
            if (RonState.activityState === 'SPEAKING') {
                updateMouth(mouthShapes[idx % mouthShapes.length]);
                shiftEyes();
                idx++;
            } else {
                stopMouthAnimation();
                setExpression('neutral');
            }
        }, 190);

        // BUG FIX: keepAlive creado como variable global, no local al setTimeout
        // así puede limpiarse desde onerror aunque ocurra antes del timeout
        keepAliveInterval = setInterval(() => {
            if (RonState.activityState !== 'SPEAKING') {
                stopKeepAlive();
                return;
            }
            window.speechSynthesis.pause();
            window.speechSynthesis.resume();
        }, 10000);

        setTimeout(() => {
            const u = new SpeechSynthesisUtterance(text);
            const voices = window.speechSynthesis.getVoices();
            const best = voices.find(v => v.lang.startsWith('es') && (v.name.includes('Google') || v.name.includes('Natural')))
                      || voices.find(v => v.lang.startsWith('es'));
            if (best) u.voice = best;

            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
            u.lang  = 'es-ES';
            u.pitch = isIOS ? 1.0 : 1.35;
            u.rate  = isIOS ? 1.0 : 1.08;

            u.onstart = () => {
                Sounds.playBeep(880, 'square', 0.07, 0.05);
                if (RonState.ui.mouthContainer) RonState.ui.mouthContainer.classList.add('mouth-vibrate');
            };

            u.onend = () => {
                stopMouthAnimation();
                stopKeepAlive();
                setExpression('neutral');
                RonState.isWaitingForWakeWord = false;
                changeState('IDLE');
                if (convTimeout) clearTimeout(convTimeout);
                convTimeout = setTimeout(() => {
                    RonState.isWaitingForWakeWord = true;
                    log("Ventana de charla cerrada.");
                }, 15000);
                resolve();
            };

            u.onerror = (e) => {
                log(`TTS error: ${e.error}`);
                stopMouthAnimation();
                stopKeepAlive(); // BUG FIX: siempre limpia el keepAlive en error
                setExpression('neutral');
                changeState('IDLE');
                resolve();
            };

            window.speechSynthesis.speak(u);
        }, 60);
    });
}

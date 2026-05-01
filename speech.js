import { RonState, log, changeState } from './core.js';
import { setExpression, triggerSafetyGlitch, updateMouth, shiftEyes } from './ui.js';
import { handleInput } from './ai.js';
import * as Sounds from './sounds.js';

let convTimeout = null;

export function startListening() {
    if (RonState.activityState !== 'IDLE' || !RonState.isMicEnabled) return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (RonState.isRecognitionActive) return; 
    
    RonState.recognition = new SpeechRecognition();
    RonState.recognition.lang = 'es-ES';
    RonState.recognition.onstart = () => { 
        RonState.isRecognitionActive = true;
        changeState('LISTENING'); 
    };
    RonState.recognition.onresult = (e) => {
        let text = e.results[0][0].transcript;
        const t = text.toLowerCase();
        
        log(`Oído: ${text}`);

        if (RonState.isWaitingForWakeWord) {
            // Hacemos que sea menos insistente quitando que salte con cualquier texto y limitando las palabras clave
            if (t.includes("ron") || t.includes("hola ron") || t.includes("oye ron") || t.includes("amigo ron")) {
                RonState.isWaitingForWakeWord = false;
                if (t.split(" ").length < 2) {
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
        if (RonState.activityState === 'LISTENING') changeState('IDLE'); 
        else if (RonState.activityState === 'IDLE' && RonState.isMicEnabled) {
            // En iOS, reiniciar el micro en bucle bloquea la app (política estricta de Safari)
            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
            if (!isIOS) {
                // Auto-curación para Android/PC
                setTimeout(() => startListening(), 1000);
            } else {
                log("iOS detectado: Micrófono detenido por seguridad. Pulsa el botón para hablar.");
                import('./ui.js').then(ui => {
                    RonState.isMicEnabled = false;
                    RonState.ui.micToggleBtn.classList.add('off');
                });
            }
        }
    };
    try { 
        RonState.recognition.start(); 
    } catch(e) { 
        log("Fallo hardware mic: " + e.message);
        RonState.isRecognitionActive = false;
        setTimeout(() => { if (RonState.activityState === 'IDLE') changeState('IDLE'); }, 2000); // Disparador suave
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

    RonState.knownFaces.push({ label: name, descriptor: RonState.tempDescriptor });
    localStorage.setItem('ron_known_faces', JSON.stringify(RonState.knownFaces));
    RonState.currentUser = name;
    RonState.userStats[name] = { likes: [], dislikes: [], lastSeen: new Date().toISOString() };
    localStorage.setItem('ron_user_stats', JSON.stringify(RonState.userStats));
    
    RonState.isLearningFace = false;
    RonState.tempDescriptor = null;
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
        changeState('SPEAKING');
        setExpression('neutral'); // <-- BUG FIX: Elimina los ojos rectangulares de "Thinking"
        
        RonState.ui.mouth.classList.add('is-speaking'); 

        const mouthShapes = [
            'M 50 15 A 20 20 0 0 1 50 55 A 20 20 0 0 1 50 15 Z', // Círculo grande
            'M 30 15 L 70 15 L 70 55 L 30 55 Z',                 // Cuadrado
            'M 50 25 A 10 10 0 0 1 50 45 A 10 10 0 0 1 50 25 Z', // Círculo pequeño
            'M 20 25 Q 50 65 80 25 Z',                           // Media luna
            'M 50 15 L 70 50 L 30 50 Z',                         // Triángulo
            'M 20 30 L 80 30 L 80 40 L 20 40 Z'                  // Rectángulo ancho
        ];
        
        let shapeIdx = 0;
        const mouthInterval = setInterval(() => {
            if (RonState.activityState === 'SPEAKING') {
                updateMouth(mouthShapes[shapeIdx % mouthShapes.length]);
                shiftEyes(); 
                shapeIdx++;
            } else {
                clearInterval(mouthInterval);
                RonState.ui.mouth.classList.remove('is-speaking'); 
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
            RonState.ui.mouthContainer.classList.remove('mouth-vibrate'); 
            RonState.isWaitingForWakeWord = false; 
            changeState('IDLE');
            
            if (convTimeout) clearTimeout(convTimeout);
            convTimeout = setTimeout(() => {
                RonState.isWaitingForWakeWord = true;
                log("Fin de ventana de charla.");
            }, 7000);
            resolve();
        };
        u.onerror = () => resolve();
        window.speechSynthesis.speak(u);
    });
}

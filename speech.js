import { RonState, log, changeState } from './core.js';
import { setExpression, triggerSafetyGlitch, updateMouth, shiftEyes } from './ui.js';
import { handleInput } from './ai.js';

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
            if (t.includes("ron") || t.includes("hola") || t.includes("oye") || t.includes("amigo") || t.length > 5) {
                RonState.isWaitingForWakeWord = false;
                if (t.split(" ").length < 2) {
                    speak("¡Bip! ¿Qué pasa, amigo?");
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
    };
    try { RonState.recognition.start(); } catch(e) { changeState('IDLE'); }
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

    RonState.knownFaces.push({ label: name, descriptor: RonState.tempDescriptor });
    localStorage.setItem('ron_known_faces', JSON.stringify(RonState.knownFaces));
    RonState.currentUser = name;
    RonState.userStats[name] = { likes: [], dislikes: [], lastSeen: new Date().toISOString() };
    localStorage.setItem('ron_user_stats', JSON.stringify(RonState.userStats));
    
    RonState.isLearningFace = false;
    RonState.tempDescriptor = null;
    speak(`¡Bip! ¡Entendido, ${name}! Ya estás grabado en mi memoria a fuego. ¡Somos mejores amigos!`);
}

export function speak(text) {
    if (!window.speechSynthesis) return changeState('IDLE');
    if (RonState.recognition) try { RonState.recognition.abort(); } catch(e) {} 
    changeState('SPEAKING');
    
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
    }, 110); 

    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const best = voices.find(v => v.lang.startsWith('es') && (v.name.includes('Google') || v.name.includes('Natural'))) || voices.find(v => v.lang.startsWith('es'));
    if (best) u.voice = best;
    u.lang = 'es-ES'; u.pitch = 1.4; u.rate = 1.1;
    
    u.onstart = () => RonState.ui.mouthContainer.classList.add('mouth-vibrate');
    u.onend = () => { 
        RonState.ui.mouthContainer.classList.remove('mouth-vibrate'); 
        RonState.isWaitingForWakeWord = false; 
        changeState('IDLE');
        
        if (convTimeout) clearTimeout(convTimeout);
        convTimeout = setTimeout(() => {
            RonState.isWaitingForWakeWord = true;
            log("Fin de ventana de charla.");
        }, 7000);
    };
    window.speechSynthesis.speak(u);
}

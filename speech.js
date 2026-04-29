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
        'M 30 20 L 70 20 L 70 45 L 30 45 Z', 
        'M 35 25 L 65 25 L 65 40 L 35 40 Z', 
        'M 40 15 L 60 15 L 60 50 L 40 50 Z', 
        'M 20 30 L 80 30 L 80 40 L 20 40 Z'  
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

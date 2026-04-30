import { RonState, changeState, log } from './core.js';
import { setExpression } from './ui.js';
import { speak } from './speech.js';

let currentAnswer = null;
let targetPhrase = null;

export function startMathGame() {
    const n1 = Math.floor(Math.random() * 10) + 1;
    const n2 = Math.floor(Math.random() * 10) + 1;
    currentAnswer = n1 + n2;
    changeState('MATH_GAME');
    RonState.ui.gamePanel.classList.remove('hidden');
    RonState.ui.gameText.innerText = `${n1} + ${n2}`;
    speak(`¡Bip! ¡Hora de sumar! ¿Cuánto es ${n1} más ${n2}?`);
}

export function handleMathAnswer(text) {
    const num = parseInt(text.replace(/[^0-9]/g, ''));
    if (num === currentAnswer) {
        setExpression('star');
        speak("¡Increíble! ¡Eres un genio de los números! ¡Bip bip!");
        setTimeout(() => startMathGame(), 3000);
    } else if (!isNaN(num)) {
        setExpression('sad');
        speak(`¡Casi! Inténtalo otra vez, amiguito.`);
    }
}

export function startReadingGame() {
    const phrases = ["EL GATO ES AZUL", "MAMÁ ME AMA", "RON ES MI AMIGO", "EL SOL BRILLA", "VAMOS A JUGAR"];
    targetPhrase = phrases[Math.floor(Math.random() * phrases.length)];
    changeState('READING_GAME');
    RonState.ui.gamePanel.classList.remove('hidden');
    RonState.ui.gameText.innerText = targetPhrase;
    speak(`¡Bip! ¡Leemos juntos! Di lo que ves en la pantalla.`);
}

export function handleReadingAnswer(text) {
    const input = text.toUpperCase().trim().replace(/[.,!¡?¿]/g, "");
    if (input === targetPhrase) {
        setExpression('happy');
        speak("¡Perfecto! ¡Lees de maravilla! ¡Bip!");
        setTimeout(() => startReadingGame(), 3000);
    } else {
        log(`Leído: ${input} | Esperado: ${targetPhrase}`);
        speak("¡Casi! Repite conmigo con cuidado.");
    }
}

export function startHideAndSeek() {
    changeState('HIDE_SEEK');
    setExpression('thinking');
    speak("¡Bip! ¡Al escondite! Cierro los ojos. Uno, dos, tres, cuatro, cinco, seis, siete, ocho, nueve, y diez! ¡Allá voy!");
    
    setTimeout(() => {
        if (RonState.activityState === 'HIDE_SEEK') {
            changeState('HIDE_SEEK_SEARCH');
            setExpression('neutral');
            log("Buscando en el escondite...");
            // Pequeño retardo para dar tiempo a que la cámara procese el primer frame
            setTimeout(() => {
                if (RonState.activityState === 'HIDE_SEEK_SEARCH') speak("¡Voy a buscarte!");
            }, 1000);
        }
    }, 12000); 
}

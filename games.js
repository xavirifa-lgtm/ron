import { RonState, changeState, log } from './core.js';
import { setExpression } from './ui.js';
import { speak } from './speech.js';

let currentAnswer = null;
let targetPhrase = null;

export function startMathGame() {
    const isSum = Math.random() > 0.3; // 70% sumas, 30% restas
    let n1 = Math.floor(Math.random() * 10) + 1;
    let n2 = Math.floor(Math.random() * 10) + 1;
    
    if (!isSum) {
        if (n1 < n2) { let t = n1; n1 = n2; n2 = t; } // Evitar resultados negativos
        currentAnswer = n1 - n2;
    } else {
        currentAnswer = n1 + n2;
    }
    
    changeState('MATH_GAME');
    RonState.ui.gamePanel.classList.remove('hidden');
    
    // Ayuda visual para niños (emojis)
    const fruits = ['🍎','🍕','🤖','⭐','🎈'];
    const f = fruits[Math.floor(Math.random() * fruits.length)];
    
    RonState.ui.gameText.innerHTML = `${n1} ${isSum ? '+' : '-'} ${n2}<br><span style="font-size:30px">${f.repeat(n1)} ${isSum ? '+' : '-'} ${f.repeat(n2)}</span>`;
    
    speak(`¡Bip! ${isSum ? 'Suma' : 'Resta'} esto: ¿Cuánto es ${n1} ${isSum ? 'más' : 'menos'} ${n2}?`);
}

export function handleMathAnswer(text) {
    if (text.toLowerCase().includes("salir") || text.toLowerCase().includes("para")) {
        RonState.ui.gamePanel.classList.add('hidden');
        changeState('IDLE');
        return speak("¡Entendido! Modo escuela desactivado.");
    }

    const textLower = text.toLowerCase();
    const wordToNum = { 'cero':0, 'uno':1, 'dos':2, 'tres':3, 'cuatro':4, 'cinco':5, 'seis':6, 'siete':7, 'ocho':8, 'nueve':9, 'diez':10, 'once':11, 'doce':12, 'trece':13, 'catorce':14, 'quince':15, 'dieciséis':16, 'diecisiete':17, 'dieciocho':18, 'diecinueve':19, 'veinte':20 };
    
    let num = parseInt(text.replace(/[^0-9]/g, ''));
    if (isNaN(num)) {
        for (const [w, n] of Object.entries(wordToNum)) {
            if (textLower.includes(w)) { num = n; break; }
        }
    }

    if (num === currentAnswer) {
        setExpression('star');
        speak("¡Increíble! ¡Eres un genio de los números! ¡Bip bip!");
        setTimeout(() => startMathGame(), 4000);
    } else if (!isNaN(num) || text.length > 0) {
        setExpression('sad');
        speak(`¡Casi! Inténtalo otra vez, ${RonState.currentUser || 'bip'}.`);
    }
}

export function startReadingGame() {
    const phrases = ["RON ES MI AMIGO", "EL GATO COME PEZ", "EL ROBOT ES FELIZ", "ME GUSTA JUGAR", "VAMOS AL PARQUE"];
    targetPhrase = phrases[Math.floor(Math.random() * phrases.length)];
    changeState('READING_GAME');
    RonState.ui.gamePanel.classList.remove('hidden');
    RonState.ui.gameText.innerText = targetPhrase;
    speak(`¡Bip! ¡Leemos juntos! ¿Qué pone en mi barriga?`);
}

export function handleReadingAnswer(text) {
    if (text.toLowerCase().includes("salir") || text.toLowerCase().includes("para")) {
        RonState.ui.gamePanel.classList.add('hidden');
        changeState('IDLE');
        return speak("Vale, guardo los libros en mi disco duro.");
    }

    const input = text.toLowerCase().trim().replace(/[.,!¡?¿]/g, "");
    const target = targetPhrase.toLowerCase().trim();
    
    // Tolerancia para niños/micrófonos: Aprobar si acierta casi todas las palabras
    const inputWords = input.split(" ");
    const targetWords = target.split(" ");
    let matches = 0;
    targetWords.forEach(w => { if (inputWords.includes(w)) matches++; });
    
    if (matches >= targetWords.length - 1) { // Puede fallar hasta 1 palabra por culpa del micrófono
        setExpression('happy');
        speak("¡Perfecto! ¡Lees como un humano mayor! ¡Bip!");
        setTimeout(() => startReadingGame(), 4000);
    } else {
        log(`Leído: ${input} | Esperado: ${targetPhrase}`);
        speak("Mmm... Repite despacito, yo te espero.");
    }
}

export async function startHideAndSeek() {
    changeState('HIDE_SEEK');
    setExpression('thinking');
    
    // Puntos suspensivos para forzar pausas reales en la voz
    await speak("¡Bip! ¡Al escondite! Tienes tiempo para esconderte. Uno... dos... tres... cuatro... cinco... seis... siete... ocho... nueve... y diez! ¡Allá voy!");
    
    if (RonState.activityState === 'HIDE_SEEK') {
        changeState('HIDE_SEEK_SEARCH');
        setExpression('neutral');
        log("Buscando en el escondite...");
        
        setTimeout(() => {
            if (RonState.activityState === 'HIDE_SEEK_SEARCH') speak("¡Voy a buscarte! ¿Dónde te has metido?");
        }, 1000);
        
        // Timeout para rendirse si no le encuentra en 25 segundos
        setTimeout(() => {
            if (RonState.activityState === 'HIDE_SEEK_SEARCH') {
                speak("¡Me rindo! ¡Eres el campeón del escondite! Sal por favor, me siento solo.");
                changeState('IDLE');
            }
        }, 25000);
    }
}

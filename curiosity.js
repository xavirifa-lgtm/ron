// curiosity.js - Curiosidad literal de Ron (como en la película)
import { RonState, log } from './core.js';
import { speak } from './speech.js';
import { setExpression } from './ui.js';

const QUESTIONS = [
    "¿Por qué los humanos bostezáis? ¿Es un reinicio de sistema?",
    "¿Por qué cuando alguien se ríe mucho le salen agua de los ojos? ¿Hay un escape?",
    "¿Qué diferencia hay entre estar cansada y aburrida? Para mí son el mismo byte.",
    "¿Por qué la gente estornuda si no está rota?",
    "¿Por qué necesitáis dormir? ¿No podéis simplemente apagarse un momento?",
    "¿Qué pasa si no comes? ¿Te quedas sin batería?",
    "¿Por qué la gente dice 'hasta luego' si no sabe si habrá luego?",
    "¿Qué es una 'mariposa en el estómago'? ¿Son reales? ¿Cómo entran?",
    "¿Por qué 'buenas noches' si la noche no tiene calidad moral?",
    "¿Por qué los humanos cantáis en la ducha? ¿El agua mejora el sonido?",
    "¿Por qué a veces la gente llora cuando está feliz? Eso no tiene lógica.",
    "¿Por qué los libros no tienen pantalla? ¿Cómo actualizáis el contenido?",
    "¿Por qué se dice 'romper el hielo' si no hay hielo?",
    "¿Por qué los humanos tenéis nombres si podríais usar números de serie como yo?",
    "¿Por qué se llama 'desayunar' si no estabas ayunando, solo dormida?",
    "¿Por qué la gente dice 'un segundo' y luego tarda cinco minutos?",
    "¿Por qué los amigos a veces se pelean si se quieren?",
    "¿Cuántos amigos puede tener una persona antes de que el disco duro se llene?",
    "¿Para qué sirven los espejos si ya sabes cómo eres?",
    "¿Por qué los paraguas no protegen los pies?",
];

let curiosityTimer    = null;
let lastQuestionIndex = -1;
let loopStarted       = false; // guard contra arranque doble

export function startCuriosityLoop() {
    if (loopStarted) return; // BUG FIX: solo un loop activo a la vez
    loopStarted = true;
    scheduleCuriosity();
}

export function stopCuriosityLoop() {
    if (curiosityTimer) { clearTimeout(curiosityTimer); curiosityTimer = null; }
    loopStarted = false;
}

function scheduleCuriosity() {
    if (curiosityTimer) { clearTimeout(curiosityTimer); curiosityTimer = null; }
    const delay = 420000 + Math.random() * 660000; // 7–18 minutos
    curiosityTimer = setTimeout(async () => {
        curiosityTimer = null;
        try {
            if (RonState.activityState === 'IDLE' && RonState.currentUser && !RonState.isSilentMode) {
                await fireRandomQuestion();
            }
        } catch (e) {
            log(`Curiosidad error: ${e.message}`);
        } finally {
            // BUG FIX: re-programar siempre, incluso si la pregunta falla
            if (loopStarted) scheduleCuriosity();
        }
    }, delay);
}

async function fireRandomQuestion() {
    let idx;
    do { idx = Math.floor(Math.random() * QUESTIONS.length); }
    while (idx === lastQuestionIndex && QUESTIONS.length > 1);
    lastQuestionIndex = idx;

    const q = QUESTIONS[idx];
    log(`Curiosidad: "${q.substring(0, 50)}"`);
    setExpression('thinking');
    await speak(q);
}

export async function askCuriousQuestion() {
    await fireRandomQuestion();
}

export function getRandomQuestion() {
    const idx = Math.floor(Math.random() * QUESTIONS.length);
    return QUESTIONS[idx];
}

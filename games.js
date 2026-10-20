import { RonState, changeState, log } from './core.js';
import { setExpression, showStoryPanel, hideStoryPanel } from './ui.js';
import { speak } from './speech.js';
import { logGame, logStory } from './diary.js';
import { isChildSafe } from './safety.js';
import { chat, MODELS } from './llm.js';
import { getFacts } from './memory.js';

let currentAnswer  = null;
let targetPhrase   = null;
let storyChapter   = 0;
let storyChapters  = [];
let challengeTimer = null;

const userName = () => RonState.currentUser || 'amiga';

// ── CERRAR CUALQUIER JUEGO LIMPIAMENTE (Evita congelar Ron al pulsar la X) ───
export function stopAnyGame() {
    if (RonState.ui?.gamePanel) RonState.ui.gamePanel.classList.add('hidden');
    currentAnswer = null;
    targetPhrase = null;
    if (challengeTimer) { clearTimeout(challengeTimer); challengeTimer = null; }
    if (['MATH_GAME', 'READING_GAME', 'CHALLENGE'].includes(RonState.activityState)) {
        changeState('IDLE');
        setExpression('happy');
    }
}

// ── RETOS INFANTILES / POMODORO (Estilo KT1) ─────────────────────────────────
export async function startChallenge(minutes = 10, activity = "recoger") {
    if (challengeTimer) { clearTimeout(challengeTimer); challengeTimer = null; }
    
    changeState('CHALLENGE');
    setExpression('thinking');
    logGame(`reto de ${minutes} min para ${activity}`);

    await speak(`¡Bip! Reto B-Bot activado. Tienes ${minutes} minutos para ${activity}. ¡Mis sensores te vigilan! ¡A por ello!`);
    if (RonState.activityState === 'IDLE') changeState('CHALLENGE');

    challengeTimer = setTimeout(async () => {
        challengeTimer = null;
        changeState('IDLE');
        setExpression('star');
        await speak(`¡TIEMPO! ¡Bip bip bip! ¡Reto de ${activity} completado! ¡Eres una campeona, ${userName()}!`);
    }, minutes * 60000);
}

export async function stopChallenge() {
    if (challengeTimer) { clearTimeout(challengeTimer); challengeTimer = null; }
    changeState('IDLE');
    setExpression('happy');
    await speak("¡Reto cancelado! Descanso de circuitos activado. ¡Bip!");
}

// ── SUMAS Y RESTAS ────────────────────────────────────────────────────────────
export async function startMathGame() {
    const isSum = Math.random() > 0.3;
    let n1 = Math.floor(Math.random() * 10) + 1;
    let n2 = Math.floor(Math.random() * 10) + 1;
    if (!isSum) {
        if (n1 < n2) { const t = n1; n1 = n2; n2 = t; }
        currentAnswer = n1 - n2;
    } else {
        currentAnswer = n1 + n2;
    }
    changeState('MATH_GAME');
    RonState.ui.gamePanel.classList.remove('hidden');
    logGame('sumas y restas');

    const emojis = ['🍎','🦄','⭐','🎈','🤖','🍭','🌸','🐶','🦋'];
    const e = emojis[Math.floor(Math.random() * emojis.length)];
    RonState.ui.gameText.innerHTML =
        `${n1} ${isSum ? '+' : '−'} ${n2} = ?<br>` +
        `<span style="font-size:clamp(16px,4.5vw,26px);line-height:1.9">` +
        `${e.repeat(Math.min(n1, 12))} ${isSum ? '+' : '−'} ${e.repeat(Math.min(n2, 12))}</span>`;
    await speak(`¡Bip! Reto matemático: ¿Cuánto es ${n1} ${isSum ? 'más' : 'menos'} ${n2}?`);
    if (RonState.activityState === 'IDLE') changeState('MATH_GAME');
}

export async function handleMathAnswer(text) {
    if (/salir|para(r)?|stop|cierra|cancel/i.test(text)) {
        stopAnyGame();
        return speak("¡Entendido! Guardando la pizarra.");
    }
    const t = text.toLowerCase();
    const wordToNum = { cero:0,uno:1,dos:2,tres:3,cuatro:4,cinco:5,seis:6,siete:7,ocho:8,nueve:9,diez:10,once:11,doce:12,trece:13,catorce:14,quince:15,'dieciséis':16,diecisiete:17,dieciocho:18,diecinueve:19,veinte:20 };
    let num = parseInt(text.replace(/[^0-9]/g, ''), 10);
    if (isNaN(num)) {
        for (const [w, n] of Object.entries(wordToNum)) {
            if (t.includes(w)) { num = n; break; }
        }
    }
    if (num === currentAnswer) {
        setExpression('star');
        const cheers = [
            "¡CORRECTO! ¡Eres un genio de las matemáticas! ¡Bip bip!",
            `¡${currentAnswer}! ¡Exacto! ¡Tu cerebro funciona a máxima velocidad!`,
            "¡BIEN! ¡Mi detector de respuestas correctas al 100%!"
        ];
        await speak(cheers[Math.floor(Math.random() * cheers.length)]);
        await startMathGame();
    } else if (!isNaN(num)) {
        setExpression('sad');
        await speak(`Mmm... no creo que sea ${num}. ¡Inténtalo otra vez, ${userName()}!`);
        if (RonState.activityState === 'IDLE') changeState('MATH_GAME');
    }
}

// ── LECTURA ───────────────────────────────────────────────────────────────────
export async function startReadingGame() {
    const phrases = [
        "RON ES MI AMIGO","EL GATO COME PEZ","EL ROBOT ES FELIZ",
        "ME GUSTA JUGAR","VAMOS AL PARQUE","LA LUNA BRILLA",
        "MI PERRO ES BUENO","HOY ES UN DÍA FELIZ","EL CIELO ES AZUL","ME GUSTAN LOS ROBOTS"
    ];
    targetPhrase = phrases[Math.floor(Math.random() * phrases.length)];
    changeState('READING_GAME');
    RonState.ui.gamePanel.classList.remove('hidden');
    RonState.ui.gameText.innerText = targetPhrase;
    await speak(`¡Bip! ¡A leer! ¿Qué pone aquí, ${userName()}?`);
    if (RonState.activityState === 'IDLE') changeState('READING_GAME');
}

export async function handleReadingAnswer(text) {
    if (/salir|para(r)?|stop|cierra|cancel/i.test(text)) {
        stopAnyGame();
        return speak("Vale, guardo los libros en mi disco duro.");
    }
    if (/ahora t(ú|u)|lee(lo)? t(ú|u)|te toca|léelo|leelo|lee tú|tu turno/i.test(text)) {
        setExpression('star');
        await speak(`¡Bip! Me toca. Dice así: ${targetPhrase}.`);
        if (RonState.activityState === 'IDLE') changeState('READING_GAME');
        return;
    }
    const input       = text.toLowerCase().trim().replace(/[.,!¡?¿]/g, '');
    const target      = targetPhrase.toLowerCase().trim();
    const inputWords  = input.split(' ');
    const targetWords = target.split(' ');
    let matches = 0;
    targetWords.forEach(w => { if (inputWords.includes(w)) matches++; });
    if (matches >= targetWords.length - 1) {
        setExpression('happy');
        await speak(`¡PERFECTO! ¡Lees genial, ${userName()}! ¡Bip!`);
        await startReadingGame();
    } else {
        await speak("Mmm... casi. Lee despacito, letra a letra. ¡Tú puedes!");
        if (RonState.activityState === 'IDLE') changeState('READING_GAME');
    }
}

// ── ESCONDITE ─────────────────────────────────────────────────────────────────
export async function startHideAndSeek() {
    changeState('HIDE_SEEK');
    setExpression('thinking');
    await speak(
        `¡Bip! ¡Al escondite! Cierro mis cámaras y cuento. ` +
        `¡Uno... dos... tres... cuatro... cinco... seis... siete... ocho... nueve... y diez! ` +
        `¡Allá voy, ${userName()}!`
    );
    if (RonState.activityState !== 'HIDE_SEEK') return;
    changeState('HIDE_SEEK_SEARCH');
    setExpression('neutral');
    setTimeout(() => {
        if (RonState.activityState === 'HIDE_SEEK_SEARCH')
            speak("¡Escaneando habitación... mis sensores dicen que estás por aquí!");
    }, 2000);
    setTimeout(() => {
        if (RonState.activityState === 'HIDE_SEEK_SEARCH') {
            speak("¡Me rindo! ¡Eres la campeona del escondite! ¡Sal ya, por favor!");
            changeState('IDLE');
        }
    }, 25000);
}

// ── HISTORIA PERSONALIZADA ────────────────────────────────────────────────────
function resetStory() {
    storyChapter  = 0;
    storyChapters = [];
    RonState.storyPendingNextChapter = false;
}

export async function startPersonalizedStory() {
    if (RonState.activityState !== 'IDLE' && RonState.activityState !== 'LISTENING') return;
    resetStory();
    changeState('STORY');
    setExpression('star');

    const name  = userName();
    const facts = getFacts(RonState.currentUser).slice(-8);
    const factStr = facts.length ? `Cosas de ${name} que puedes usar: ${facts.join('. ')}.` : '';

    const sysPrompt =
        `Eres Ron, el B-Bot de "Ron da error". Cuenta un cuento CORTO (exactamente 4 párrafos breves, ` +
        `máximo 60 palabras cada uno) donde ${name} (7-8 años) es la protagonista de una aventura contigo. ${factStr} ` +
        `Divertido, tierno y apropiado para niños de 7 años: sin miedo de verdad, sin violencia. Sin emojis. ` +
        `Cada párrafo empieza por "Capítulo 1:", "Capítulo 2:", etc. Separa los párrafos con |||. Empieza DIRECTAMENTE con "Capítulo 1:".`;

    try {
        const { text: storyRaw } = await chat([{ role: 'user', content: sysPrompt }],
            { models: MODELS.chat, maxTokens: 1400, temperature: 0.9, timeoutMs: 15000 });
        storyChapters = storyRaw.split('|||').map(s => s.trim()).filter(Boolean);
        if (storyChapters.length === 0) throw new Error('Historia vacía');
        if (!(await isChildSafe(storyRaw))) {
            resetStory(); changeState('IDLE');
            return speak('¡Bip! A ese cuento se le han cruzado los cables. ¡Te cuento otro mejor en un ratito!');
        }

        storyChapter = 0;
        await speak(`¡Bip bip! ¡Hora de la historia! "La gran aventura de ${name} y Ron". ¡Empezamos!`);
        if (RonState.activityState === 'IDLE') changeState('STORY');
        await narrateNextChapter();

    } catch (e) {
        log('Error historia: ' + e.message);
        resetStory();
        changeState('IDLE');
        await speak("¡Bip! Mi módulo de historias tiene un error. ¡Inténtalo en un momento!");
    }
}

async function narrateNextChapter() {
    if (storyChapter >= storyChapters.length) {
        hideStoryPanel();
        resetStory();
        changeState('IDLE');
        setExpression('happy');
        logStory(userName());
        await speak(`¡Fin! ¿Qué te ha parecido, ${userName()}? ¡Bip!`);
        return;
    }
    const chapter = storyChapters[storyChapter];
    showStoryPanel(chapter);
    storyChapter++;
    await speak(chapter);
    if (RonState.activityState === 'IDLE') changeState('STORY');

    if (storyChapter < storyChapters.length) {
        await speak("¿Continuamos con el siguiente capítulo?");
        if (RonState.activityState === 'IDLE') changeState('STORY');
        RonState.storyPendingNextChapter = true;
    } else {
        hideStoryPanel();
        resetStory();
        changeState('IDLE');
        setExpression('happy');
        logStory(userName());
        await speak(`¡Fin de la historia! ¡Qué aventura, ${userName()}! ¡Bip bip!`);
    }
}

export async function continueStory() {
    if (!RonState.storyPendingNextChapter) return false;
    RonState.storyPendingNextChapter = false;
    await narrateNextChapter();
    return true;
}

export function doMorningCheck() {
    const name = userName();
    const questions = [
        `¡Buenos días, ${name}! ¿Cómo has dormido? ¿Has soñado con aventuras?`,
        `¡Bip! ¡${name}! ¿Qué es lo primero que quieres hacer hoy?`,
        `¡Buenos días, ${name}! Mis sensores dicen que hoy va a ser un día genial.`,
        `¡Bip bop! ¡${name}! ¿Tienes mucha energía hoy o poquita?`
    ];
    setExpression('star');
    speak(questions[Math.floor(Math.random() * questions.length)]);
}
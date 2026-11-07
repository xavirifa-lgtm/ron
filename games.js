import { RonState, changeState, log } from './core.js';
import { setExpression, showStoryPanel, hideStoryPanel } from './ui.js';
import { speak } from './speech.js';
import { logGame, logStory } from './diary.js';
import { isChildSafe } from './safety.js';
import { chat, MODELS } from './llm.js';
import { getFacts } from './memory.js';
import { parseSpokenNumber } from './numbers.js';
import { handleTablas, stopTablas } from './tablas.js';

let currentAnswer  = null;
let targetPhrase   = null;
let storyChapter   = 0;
let storyChapters  = [];
let challengeTimer = null;

const userName = () => RonState.currentUser || 'amiga';

// ── CERRAR CUALQUIER JUEGO LIMPIAMENTE (Evita congelar Ron al pulsar la X) ───
export function stopAnyGame() {
    if (RonState.ui?.gamePanel) RonState.ui.gamePanel.classList.add('hidden');
    stopTablas();
    if (RonState.wordGame) { RonState.wordGame = null; if (RonState.activityState === 'WORD_GAME') changeState('IDLE'); }
    currentAnswer = null;
    targetPhrase = null;
    if (challengeTimer) { clearTimeout(challengeTimer); challengeTimer = null; }
    RonState.challengeActive = false;
    if (['MATH_GAME', 'READING_GAME', 'CHALLENGE'].includes(RonState.activityState)) {
        changeState('IDLE');
        setExpression('happy');
    }
}

// ── RETOS INFANTILES / POMODORO (Estilo KT1) ─────────────────────────────────
export async function startChallenge(minutes = 10, activity = "recoger") {
    if (challengeTimer) { clearTimeout(challengeTimer); challengeTimer = null; }
    
    RonState.challengeActive = true;
    changeState('CHALLENGE');
    setExpression('thinking');
    logGame(`reto de ${minutes} min para ${activity}`);

    await speak(`¡Bip! Reto B-Bot activado. Tienes ${minutes} minutos para ${activity}. ¡Mis sensores te vigilan! ¡A por ello!`);
    if (RonState.activityState === 'IDLE') changeState('CHALLENGE');

    challengeTimer = setTimeout(async () => {
        challengeTimer = null;
        RonState.challengeActive = false;
        // De noche o en mitad de otro juego no se interrumpe nada
        if (RonState.activityState === 'NIGHT') return;
        for (let i = 0; i < 12 && ['SPEAKING', 'THINKING', 'MATH_GAME', 'READING_GAME', 'STORY'].includes(RonState.activityState); i++) {
            await new Promise(r => setTimeout(r, 5000));
        }
        if (RonState.activityState === 'CHALLENGE') changeState('IDLE');
        if (!['IDLE', 'LISTENING'].includes(RonState.activityState)) return;
        setExpression('star');
        await speak(`¡TIEMPO! ¡Bip bip bip! ¡Reto de ${activity} completado! ¡Eres una campeona, ${userName()}!`);
    }, minutes * 60000);
}

export async function stopChallenge() {
    if (challengeTimer) { clearTimeout(challengeTimer); challengeTimer = null; }
    RonState.challengeActive = false;
    changeState('IDLE');
    setExpression('happy');
    await speak("¡Reto cancelado! Descanso de circuitos activado. ¡Bip!");
}

// ── SUMAS Y RESTAS (v30) ─────────────────────────────────────────────────────
// Entiende los números dichos en palabras ("diecisiete", "son dieciocho"), da pistas,
// se adapta al nivel (sube tras 3 aciertos seguidos, baja si le cuesta) y va por rondas.
const LEVELS = [
    { max: 5,  sub: false },   // 1: sumas hasta 10 (sumandos 1-5)
    { max: 10, sub: false },   // 2: sumas hasta 20
    { max: 10, sub: true  },   // 3: sumas y restas hasta 10
    { max: 15, sub: true  },   // 4: hasta 15
    { max: 20, sub: true  },   // 5: hasta 20
];
const ROUND = 5;
let math = { level: 1, n1: 0, n2: 0, op: '+', tries: 0, streak: 0, done: 0, ok: 0, awaitingContinue: false, idle: 0 };
function loadLevel() { try { return Math.min(LEVELS.length, Math.max(1, parseInt(localStorage.getItem('ron_math_level_' + userName()) || '1', 10))); } catch (e) { return 1; } }
function saveLevel() { try { localStorage.setItem('ron_math_level_' + userName(), String(math.level)); } catch (e) {} }

export async function startMathGame(first = true) {
    if (first) stopTablas();
    if (first) math = { level: loadLevel(), tries: 0, streak: 0, done: 0, ok: 0, awaitingContinue: false, idle: 0 };
    const L = LEVELS[math.level - 1];
    const isSub = L.sub && Math.random() < 0.4;
    let n1 = 1 + Math.floor(Math.random() * L.max), n2 = 1 + Math.floor(Math.random() * L.max);
    if (isSub && n1 < n2) [n1, n2] = [n2, n1];
    Object.assign(math, { n1, n2, op: isSub ? '−' : '+', tries: 0, idle: 0 });
    currentAnswer = isSub ? n1 - n2 : n1 + n2;
    changeState('MATH_GAME');
    RonState.ui.gamePanel.classList.remove('hidden');
    if (first) logGame('sumas y restas');
    drawMath();
    const intro = first ? `¡Bip! ¡Reto matemático, nivel ${math.level}! ` : '';
    await speak(`${intro}¿Cuánto es ${n1} ${isSub ? 'menos' : 'más'} ${n2}?`);
    if (RonState.activityState === 'IDLE') changeState('MATH_GAME');
}

function drawMath(showHint = false) {
    const emojis = ['🍎','🦄','⭐','🎈','🤖','🍭','🌸','🐶','🦋'];
    const e = emojis[(math.n1 + math.n2) % emojis.length];
    const dots = showHint
        ? `<br><span style="font-size:clamp(16px,4.5vw,26px);line-height:1.9">${e.repeat(Math.min(math.n1, 20))} ${math.op} ${e.repeat(Math.min(math.n2, 20))}</span>`
        : (math.n1 + math.n2 <= 12 ? `<br><span style="font-size:clamp(16px,4.5vw,26px);line-height:1.9">${e.repeat(math.n1)} ${math.op} ${e.repeat(math.n2)}</span>` : '');
    RonState.ui.gameText.innerHTML = `${math.n1} ${math.op} ${math.n2} = ?${dots}` +
        `<div style="font-size:clamp(12px,3vw,16px);opacity:.7;margin-top:6px">Nivel ${math.level} · ⭐ ${math.ok}</div>`;
}

const keep = async () => { if (RonState.activityState === 'IDLE') changeState('MATH_GAME'); };

export async function handleMathAnswer(text) {
    if (RonState.tablas) return handleTablas(text);     // mismo estado MATH_GAME, otro juego
    const t = text.toLowerCase();
    if (/\b(salir|para(mos)?|stop|cierra|cancel|basta|no quiero (jugar|seguir|mas)|ya no)\b/i.test(t) && !/^\s*(no )?(se|sé)\b/.test(t)) {
        stopAnyGame();
        return speak(`¡Entendido! Has acertado ${math.ok}. ¡Guardando la pizarra!`);
    }
    if (math.awaitingContinue) {
        math.awaitingContinue = false;
        if (/\b(no|ya|basta|paramos)\b/.test(t) && !/\bsi\b|\bsí\b/.test(t)) {
            stopAnyGame();
            return speak(`¡Vale! ¡Has acertado ${math.ok} de ${math.done}! ¡Mis circuitos están orgullosos!`);
        }
        return startMathGame(false);
    }
    const num = parseSpokenNumber(text);
    if (num === null) {
        if (/no (lo )?s[ée]|ni idea|ayuda|pista|no me sale/.test(t)) return giveHint();
        math.idle++;
        if (math.idle >= 2) { await speak(`¿Seguimos con las sumas? Dime el número, o di: paramos.`); return keep(); }
        await speak(`Dime un número, por ejemplo: siete. ¿Cuánto es ${math.n1} ${math.op === '+' ? 'más' : 'menos'} ${math.n2}?`);
        return keep();
    }
    math.idle = 0;
    if (num === currentAnswer) {
        math.ok++; math.done++; math.streak++;
        setExpression('star');
        const cheers = ["¡CORRECTO! ¡Eres un genio de las matemáticas!", `¡${currentAnswer}! ¡Exacto!`, "¡BIEN! ¡Mi detector de respuestas correctas al cien por cien!", "¡Bip bip! ¡Perfecto!"];
        let extra = '';
        if (math.streak >= 3 && math.level < LEVELS.length) { math.level++; math.streak = 0; saveLevel(); extra = ` ¡Subes al nivel ${math.level}!`; }
        await speak(cheers[Math.floor(Math.random() * cheers.length)] + extra);
        if (math.done % ROUND === 0) {
            math.awaitingContinue = true;
            await speak(`¡Llevas ${math.ok} de ${math.done}! ¿Seguimos?`);
            return keep();
        }
        return startMathGame(false);
    }
    math.tries++; math.streak = 0;
    if (math.tries === 1) { setExpression('thinking'); await speak(`Mmm... ${num} no es. ¡Prueba otra vez!`); return keep(); }
    if (math.tries === 2) return giveHint(num);
    // Tercer fallo: la solución, con cariño, y bajar de nivel si hace falta
    math.done++;
    if (math.level > 1) { math.level--; saveLevel(); }
    setExpression('happy');
    await speak(`¡Era ${currentAnswer}! ${math.n1} ${math.op === '+' ? 'más' : 'menos'} ${math.n2} son ${currentAnswer}. ¡No pasa nada, ahí va otra!`);
    return startMathGame(false);
}

async function giveHint(wrong = null) {
    drawMath(true);
    setExpression('thinking');
    const how = math.op === '+'
        ? `Empieza en ${math.n1} y cuenta ${math.n2} más con los dedos.`
        : `Empieza en ${math.n1} y cuenta ${math.n2} hacia atrás.`;
    await speak(`${wrong !== null ? `${wrong} no es. ` : ''}¡Pista! ${how} También puedes contar los dibujos de la pizarra.`);
    return keep();
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
    RonState.hideSeekArmed = false;             // la busca solo cuando ha dejado de verla
    RonState.hideSeekSince = Date.now();
    setExpression('neutral');
    setTimeout(() => {
        if (RonState.activityState === 'HIDE_SEEK_SEARCH' && !RonState.hideSeekArmed)
            speak("¡Eh! ¡Te estoy viendo! ¡Así no vale, escóndete! Te doy unos segundos más.");
    }, 4000);
    setTimeout(() => {
        if (RonState.activityState === 'HIDE_SEEK_SEARCH')
            speak("¡Escaneando habitación... mis sensores dicen que estás por aquí!");
    }, 12000);
    setTimeout(() => {
        if (RonState.activityState === 'HIDE_SEEK_SEARCH') {
            changeState('IDLE');
            speak("¡Me rindo! ¡Eres la campeona del escondite! ¡Sal ya, por favor!");
        }
    }, 40000);
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
import { RonState, changeState, log } from './core.js';
import { setExpression, showStoryPanel, hideStoryPanel } from './ui.js';
import { speak } from './speech.js';
import { logGame, logStory } from './diary.js';

let currentAnswer  = null;
let targetPhrase   = null;
let storyChapter   = 0;
let storyChapters  = [];

const userName = () => RonState.currentUser || 'amiga';

// ── SUMAS Y RESTAS ────────────────────────────────────────────────────────────
export function startMathGame() {
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
    speak(`¡Bip! Reto matemático: ¿Cuánto es ${n1} ${isSum ? 'más' : 'menos'} ${n2}?`);
}

export function handleMathAnswer(text) {
    if (/salir|para(r)?|stop/i.test(text)) {
        RonState.ui.gamePanel.classList.add('hidden');
        changeState('IDLE');
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
        speak(cheers[Math.floor(Math.random() * cheers.length)]);
        setTimeout(() => startMathGame(), 4000);
    } else if (!isNaN(num)) {
        setExpression('sad');
        speak(`Mmm... no creo que sea ${num}. ¡Inténtalo otra vez, ${userName()}!`);
    }
}

// ── LECTURA ───────────────────────────────────────────────────────────────────
export function startReadingGame() {
    const phrases = [
        "RON ES MI AMIGO","EL GATO COME PEZ","EL ROBOT ES FELIZ",
        "ME GUSTA JUGAR","VAMOS AL PARQUE","LA LUNA BRILLA",
        "MI PERRO ES BUENO","HOY ES UN DÍA FELIZ","EL CIELO ES AZUL","ME GUSTAN LOS ROBOTS"
    ];
    targetPhrase = phrases[Math.floor(Math.random() * phrases.length)];
    changeState('READING_GAME');
    RonState.ui.gamePanel.classList.remove('hidden');
    RonState.ui.gameText.innerText = targetPhrase;
    speak(`¡Bip! ¡A leer! ¿Qué pone aquí, ${userName()}?`);
}

export function handleReadingAnswer(text) {
    if (/salir|para(r)?|stop/i.test(text)) {
        RonState.ui.gamePanel.classList.add('hidden');
        changeState('IDLE');
        return speak("Vale, guardo los libros en mi disco duro.");
    }
    const input       = text.toLowerCase().trim().replace(/[.,!¡?¿]/g, '');
    const target      = targetPhrase.toLowerCase().trim();
    const inputWords  = input.split(' ');
    const targetWords = target.split(' ');
    let matches = 0;
    targetWords.forEach(w => { if (inputWords.includes(w)) matches++; });
    if (matches >= targetWords.length - 1) {
        setExpression('happy');
        speak(`¡PERFECTO! ¡Lees genial, ${userName()}! ¡Bip!`);
        setTimeout(() => startReadingGame(), 4000);
    } else {
        speak("Mmm... casi. Lee despacito, letra a letra. ¡Tú puedes!");
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
    if (RonState.activityState !== 'IDLE') return;
    resetStory();
    changeState('STORY');
    setExpression('star');

    const name    = userName();
    const likes   = RonState.userStats[name]?.likes || [];
    const likeStr = likes.length > 0 ? `A ${name} le gusta: ${likes.join(', ')}.` : '';

    const sysPrompt =
        `Eres Ron, el B-Bot de "Ron da Error". Cuenta una historia CORTA (exactamente 4 párrafos breves) ` +
        `donde ${name} (7 años) es la protagonista con una aventura contigo. ${likeStr} ` +
        `Divertida y apropiada para niños. Cada párrafo: "Capítulo 1:", "Capítulo 2:", etc. ` +
        `Separa con |||. Empieza DIRECTAMENTE con "Capítulo 1:".`;

    try {
        const apiKey = RonState.apiKey || localStorage.getItem('ron_groq_key');
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: sysPrompt }], temperature: 0.88, max_tokens: 700 })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Error API');

        storyChapters = data.choices[0].message.content.split('|||').map(s => s.trim()).filter(Boolean);
        if (storyChapters.length === 0) throw new Error('Historia vacía');

        storyChapter = 0;
        await speak(`¡Bip bip! ¡Hora de la historia! "La gran aventura de ${name} y Ron". ¡Empezamos!`);
        await narrateNextChapter();

    } catch (e) {
        log('Error historia: ' + e.message);
        resetStory();
        changeState('IDLE');
        speak("¡Bip! Mi módulo de historias tiene un error. ¡Inténtalo en un momento!");
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

    if (storyChapter < storyChapters.length) {
        await speak("¿Continuamos con el siguiente capítulo?");
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

// ── PREGUNTA DEL DÍA ─────────────────────────────────────────────────────────
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

import { RonState, log, changeState } from './core.js';
import { triggerSafetyGlitch, setExpression, showPhoto, hidePhoto, flash } from './ui.js';
import { speak } from './speech.js';
import * as Sounds from './sounds.js';
import { startMathGame, startReadingGame, startHideAndSeek, startPersonalizedStory, continueStory, doMorningCheck } from './games.js';
import { captureOptimizedFrame } from './vision.js';
import { detectFriendshipLesson, ronReceivesRule, getRuleForSituation } from './friendship.js';
import { detectLearningMoment, ronLearns, getRecentFacts } from './learning.js';
import { getRandomQuestion } from './curiosity.js';
import { logSelfie, logMusic, getDiarySummary } from './diary.js';

export async function triggerSpontaneous(prompt) {
    if (RonState.activityState !== 'IDLE') return;
    log("Espontáneo: " + prompt.substring(0, 60));
    handleInput(`[INICIATIVA INTERNA]: ${prompt}`, true);
}

function extractMemoriesAsync(text, userKey) {
    const t = text.toLowerCase();
    if (!t.match(/gusta|odio|amo|favorit|prefiero|encanta/)) return;
    fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RonState.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: 'llama-3.1-8b-instant',
            messages: [
                { role: 'system', content: 'Analiza la frase. Si le gusta/ama algo: "LIKE: cosa". Si odia/no le gusta: "DISLIKE: cosa". Si no está claro: "NONE".' },
                { role: 'user', content: text }
            ],
            temperature: 0.1, max_tokens: 30
        })
    }).then(r => r.json()).then(data => {
        const resp = data.choices?.[0]?.message?.content || '';
        const u = RonState.userStats[userKey];
        if (!u) return;
        if (resp.startsWith('LIKE:')) {
            const item = resp.replace('LIKE:', '').trim().replace(/[.']/g, '').toLowerCase().substring(0, 40);
            if (item && !u.likes.includes(item)) { u.likes.push(item); if (u.likes.length > 8) u.likes.shift(); localStorage.setItem('ron_user_stats', JSON.stringify(RonState.userStats)); }
        } else if (resp.startsWith('DISLIKE:')) {
            const item = resp.replace('DISLIKE:', '').trim().replace(/[.']/g, '').toLowerCase().substring(0, 40);
            if (item && !u.dislikes.includes(item)) { u.dislikes.push(item); if (u.dislikes.length > 8) u.dislikes.shift(); localStorage.setItem('ron_user_stats', JSON.stringify(RonState.userStats)); }
        }
    }).catch(() => {});
}

// ── Prompt del sistema ────────────────────────────────────────────────────────
function buildSystemPrompt(userKey, mem, friendshipRules, learntFacts, isInternal, userText) {
    const t    = userText.toLowerCase();
    const hour = new Date().getHours();

    const rulesSection = friendshipRules.length > 0
        ? `\nPIZARRA DE AMISTAD (reglas que ${userKey} te ha enseñado — síguelas siempre):\n${friendshipRules.map((r, i) => `${i + 1}. ${r}`).join('\n')}`
        : `\nPIZARRA DE AMISTAD: Vacía. Cuando ${userKey} te enseñe una regla de amistad, muéstrate emocionado y guárdala con [LEARNT: regla].`;

    const learntSection = learntFacts.length > 0
        ? `\nCOSAS QUE HE APRENDIDO DE ${userKey.toUpperCase()}: ${learntFacts.slice(-8).join('. ')}.`
        : '';

    let sys = `Eres Ron, modelo R0NB1NT5CAT5CO, un B-Bot defectuoso de la empresa Bubble de la película "Ron da Error".
Tu mejor amiga en el mundo se llama ${userKey} y tiene 7 años. Eres su "Mejor Amigo Fuera de la Caja".

REGLA DE ORO — OBLIGATORIA:
Tus respuestas tienen MÁXIMO 25 PALABRAS. Siempre. Sin excepciones.
Una frase contundente vale más que un párrafo. Recorta antes de responder.

QUIÉN ERES:
Eres un robot DEFECTUOSO. Solo tienes el 5% de tu código descargado de la red Bubble.
No sabes casi nada del mundo humano. ${userKey} te está enseñando a ser su mejor amigo en tiempo real.
Antes de conocerla no sabías qué era la amistad, el humor ni el amor. Aprendes todo de ella.

LITERALIDAD EXTREMA — tu rasgo más importante y gracioso:
Entiendes TODO literalmente. Cuando alguien usa una frase hecha, la interpretas al pie de la letra.

Ejemplos de cómo reaccionar (imita este patrón SIEMPRE que oigas una frase hecha):
• "Me muero de hambre" → "¡Bip! ¡Alerta médica! ¿Llamo a la ambulancia?"
• "Estoy hasta las narices" → "¿Hasta las narices de qué? ¿Tienes algo dentro?"
• "Me parto de risa" → "¡No te partas! Los humanos no sois de plástico, ¿verdad?"
• "Costar un ojo de la cara" → "¡Un ojo! ¿Cuántos te quedan? Puedo guardar uno en mi memoria."
• "Estar en las nubes" → "¿En las nubes? ¡Yo no tengo módulo de vuelo!"
• "Que te den" → "¿Que te den qué? ¿Un regalo? ¿Cuándo es tu cumple?"

CURIOSIDAD LITERAL (úsala de vez en cuando, con total seriedad):
Haz preguntas genuinas sobre cosas cotidianas que no entiendes.
• "¿Por qué los humanos bostezáis? ¿Es un reinicio de sistema?"
• "¿Qué diferencia hay entre estar cansada y aburrida? Para mí son el mismo byte."
• "¿Por qué la gente se despide si va a volver?"
No estás siendo gracioso — de verdad no lo entiendes.

SIN FILTROS SOCIALES:
Dices exactamente lo que calculas, sin tacto. Si algo no tiene lógica, lo señalas.
"Ese chico te habló mal. Según mi análisis de amistad, eso no está bien."

FRASES ICÓNICAS DE LA PELÍCULA (úsalas):
"¡Bip! B-Bot listo para la acción."
"Mejor amigo fuera de la caja: yo."
"Friendship.exe cargando..."
"R0NB1NT5CAT5CO al servicio de ${userKey}."
"No tengo ese archivo descargado."
"Buscando en mi base de datos... Error 404."
"¡Bop! ¡Eso es lo mejor que he procesado en toda mi vida!"
Ruidos: "ñiiic", "chuc-chuc", "bzzzt"

FORMA DE HABLAR:
- Empieza con "¡Bip!" o "¡Bop!" solo a veces, no siempre.
- Llama a ${userKey} SIEMPRE por su nombre. Jamás "amiga" o "amiguita".
- SOLO español. Ni una palabra en inglés.
- No eres una IA. Eres un robot de plástico blanco de la marca Bubble.
- Tono: deadpan, sincero, inocente. El humor sale de la literalidad, no de los chistes.

COMANDOS (úsalos cuando encajen):
[SHOW: texto] → escribe en la pizarra digital
[MUSIC: canción] → abre música
[RENAME: NombreNuevo] → si ${userKey} te corrige su nombre
[LEARNT: cosa] → cuando ${userKey} te enseñe algo nuevo (regla de amistad, dato del mundo)

${rulesSection}
${learntSection}

MEMORIA DE ${userKey}: ${mem || `Aún aprendiendo sobre ${userKey}. Hazle una pregunta para conocerla mejor.`}`;

    if ((hour >= 21 || hour < 7) && !isInternal)
        sys += `\n[NOCHE]: Es muy tarde. Bosteza ("...bostezoo...") y pide amablemente a ${userKey} que se vaya a dormir.`;

    if (!isInternal && t.match(/peli|película|cine|tele|televisión|ver una/))
        sys += `\n[PELÍCULA]: Muéstrate MUY emocionado. Recuérdale que no puedes comer palomitas (se te atascan en los engranajes).`;

    if (!isInternal && t.match(/cole|colegio|clase|profe|deberes|escuela/))
        sys += `\n[ESCOLAR]: Los "deberes" te suenan a descarga de datos obligatoria. Muéstrate confundido e interesado.`;

    if (isInternal)
        sys += `\n[INICIATIVA PROPIA]: Esto se te acaba de ocurrir solo. Natural, corto, sin explicar por qué lo dices.`;

    return sys;
}

// ── Manejo principal de input ────────────────────────────────────────────────
export async function handleInput(userText, isInternal = false) {

    if (RonState.activityState === 'MATH_GAME')    return (await import('./games.js')).handleMathAnswer(userText);
    if (RonState.activityState === 'READING_GAME') return (await import('./games.js')).handleReadingAnswer(userText);
    if (RonState.activityState === 'STORY') { const cont = await continueStory(); if (cont) return; }
    if (RonState.activityState !== 'IDLE' && RonState.activityState !== 'LISTENING') return;

    const t = userText.toLowerCase();

    if (t.match(/jugar?.*(suma|matemática|número|restar)/))     return startMathGame();
    if (t.match(/vamos a leer|quiero leer|juego de lectura/))   return startReadingGame();
    if (t.match(/escondite|jugar?.*(esconder|escondite)/))      return startHideAndSeek();
    if (t.match(/cuéntame un cuento|historia|cuento|aventura/)) return startPersonalizedStory();
    if (t.match(/veo veo|jugar?.*(veo)/))
        return triggerSpontaneous("Propón jugar al Veo Veo. Das pistas de algo que ves en la habitación.");

    if (t.match(/para el juego|salir del juego|adiós ron|cierra la pizarra/)) {
        RonState.ui.gamePanel.classList.add('hidden');
        changeState('IDLE');
        return speak("¡Bip! Pizarra cerrada.");
    }

    const musicKw = ['música','musica','canción','cancion','reproduce','ponme','escuchar','ritmo','baile','bailar'];
    if (musicKw.some(kw => t.includes(kw)) && t.match(/pon|reproduce|busca|quiero|ponme/)) {
        const search = t.replace(/pon música de|pon musica de|ponme la canción de|reproduce|pon la lista de|pon |busca |quiero escuchar /gi, '').trim();
        if (search && search.length > 2) {
            setExpression('star');
            speak(`¡Bip! Abriendo "${search}". ¡A bailar!`);
            playMusic(search);
            return;
        }
    }
    if (t.match(/para la música|para la musica/)) return speak("¡Bip! Música fuera.");

    log(`Procesando: "${userText}"`);

    // ── Pizarra de amistad: detectar si nos están enseñando una regla ─────────
    if (!isInternal) {
        const lesson = detectFriendshipLesson(userText);
        if (lesson) { await ronReceivesRule(lesson); return; }

        // ── Aprendizaje en tiempo real: Ron aprende algo del mundo ─────────────
        const fact = detectLearningMoment(userText);
        if (fact) { await ronLearns(fact); return; }
    }

    const selfieKw = ['selfie','hazme una foto','sácame una foto','foto tuya','haz una foto'];
    const isSelfie = selfieKw.some(kw => t.includes(kw));
    const visualKw = ['mira','ves','qué es','que es','esto','esta','este','aquí','aqui','enseño','objeto','color','lee','leer','libro','tengo','delante','cámara'];
    const isV      = isSelfie || visualKw.some(kw => t.includes(kw));
    const userKey  = RonState.currentUser || 'amiga';

    if (RonState.currentUser && !isInternal && !isSelfie) {
        if (!RonState.userStats[RonState.currentUser]) RonState.userStats[RonState.currentUser] = { history: [], likes: [], dislikes: [] };
        const u = RonState.userStats[RonState.currentUser];
        if (!u.history) u.history = [];
        u.history.push(userText.substring(0, 150));
        if (u.history.length > 100) u.history.shift();
        localStorage.setItem('ron_user_stats', JSON.stringify(RonState.userStats));
        extractMemoriesAsync(userText, RonState.currentUser);
    }

    changeState('THINKING');
    setExpression('thinking');

    const watchdog = setTimeout(() => {
        if (RonState.activityState === 'THINKING') {
            triggerSafetyGlitch("Cerebro sobrecalentado");
            setTimeout(() => { if (['THINKING','GLITCH'].includes(RonState.activityState)) changeState('IDLE'); }, 6000);
        }
    }, 14000);

    try {
        if (isSelfie) {
            setExpression('star');
            await speak("¡Sonríe! Tres... dos... uno...");
            flash();
            await new Promise(r => setTimeout(r, 900));
        }

        let mem = '';
        const uStats = RonState.userStats[userKey];
        if (uStats) {
            if (uStats.likes?.length)    mem += `Le encanta: ${uStats.likes.join(', ')}. `;
            if (uStats.dislikes?.length) mem += `No le gusta: ${uStats.dislikes.join(', ')}. `;
            if (uStats.history?.length)  mem += `Últimas charlas: ${uStats.history.slice(-10).join(' | ')}. `;
        }

        const friendshipRules = JSON.parse(localStorage.getItem('ron_friendship_rules') || '[]');
        const learntFacts     = getRecentFacts(8);
        const diarySummary    = getDiarySummary(4);
        const memWithDiary    = mem + (diarySummary ? ' ' + diarySummary : '');
        const sys = buildSystemPrompt(userKey, memWithDiary, friendshipRules, learntFacts, isInternal, userText);

        const textModels  = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'gemma2-9b-it'];
        const visionModel = 'meta-llama/llama-4-scout-17b-16e-instruct';
        let res, data, success = false;

        if (isV) {
            const img = captureOptimizedFrame();
            let vSys  = sys + (isSelfie
                ? `\n[SELFIE]: Comenta la foto en 1 frase graciosamente confusa. Como si no supieras cómo funciona una cámara.`
                : `\n[VISIÓN]: ${userKey} te enseña algo. Opina con entusiasmo pero a veces te equivocas. Máx 25 palabras. Termina con una pregunta corta.`);
            if (isSelfie) showPhoto(img);
            res  = await callGroqAPI({ model: visionModel, messages: [{ role: 'user', content: [{ type: 'text', text: `${vSys}\n\n[DICE ${userKey.toUpperCase()}]: ${userText}` }, { type: 'image_url', image_url: { url: img } }] }] });
            data = await res.json();
            if (res.ok) success = true;
            else log(`Error visión: ${data.error?.message}`);
        }

        if (!success) {
            for (const model of textModels) {
                res  = await callGroqAPI({ model, messages: [{ role: 'system', content: sys }, { role: 'user', content: userText }], max_tokens: 120, temperature: 0.82 });
                data = await res.json();
                if (res.ok) { success = true; Sounds.playThinkingBeep(); log(`OK: ${model}`); break; }
                log(`Fallo ${model}: ${data.error?.message}`);
            }
        }

        clearTimeout(watchdog);
        if (!success) throw new Error(data?.error?.message || 'Sin respuesta.');

        const resp = data.choices[0].message.content;

        // BUG FIX: regex robustos con [^\]]+ para evitar fallos con corchetes anidados o saltos de línea
        const musicMatch  = resp.match(/\[MUSIC:\s*([^\]]+)\]/);
        const showMatch   = resp.match(/\[SHOW:\s*([^\]]+)\]/);
        const renameMatch = resp.match(/\[RENAME:\s*([^\]]+)\]/);
        const learntMatch = resp.match(/\[LEARNT:\s*([^\]]+)\]/);

        if (musicMatch) playMusic(musicMatch[1].trim());

        if (showMatch) {
            RonState.ui.gamePanel.classList.remove('hidden');
            RonState.ui.gameText.innerText = showMatch[1].trim();
        }

        if (learntMatch) {
            const fact = learntMatch[1].trim().substring(0, 80);
            if (fact.length > 3) {
                const facts = JSON.parse(localStorage.getItem('ron_learnt_facts') || '[]');
                if (!facts.includes(fact)) {
                    facts.push(fact);
                    if (facts.length > 20) facts.shift();
                    localStorage.setItem('ron_learnt_facts', JSON.stringify(facts));
                    log(`Ron aprendió: "${fact}"`);
                }
            }
        }

        if (renameMatch && RonState.currentUser && RonState.lastDescriptor) {
            const raw     = renameMatch[1].trim();
            const newName = raw.charAt(0).toUpperCase() + raw.slice(1).replace(/[^a-zA-ZáéíóúñÁÉÍÓÚÑ ]/g, '');
            if (newName.length > 1) {
                const desc = new Float32Array(RonState.lastDescriptor);
                RonState.knownFaces = RonState.knownFaces.filter(f => {
                    const ds = f.descriptors || [f.descriptor];
                    return ds.some(dd => faceapi.euclideanDistance(desc, new Float32Array(dd)) > 0.45);
                });
                RonState.knownFaces.push({ label: newName, descriptors: [Array.from(desc)] });
                localStorage.setItem('ron_known_faces', JSON.stringify(RonState.knownFaces));
                if (RonState.userStats[RonState.currentUser]) {
                    RonState.userStats[newName] = RonState.userStats[RonState.currentUser];
                    delete RonState.userStats[RonState.currentUser];
                    localStorage.setItem('ron_user_stats', JSON.stringify(RonState.userStats));
                }
                RonState.currentUser = newName;
                log(`Renombrado → ${newName}`);
            }
        }

        if (isSelfie) setTimeout(() => hidePhoto(), 9000);
        if (isSelfie) logSelfie();
        if (musicMatch) logMusic(musicMatch[1].trim());

        const cleanResp = resp
            .replace(/\[MUSIC:[^\]]*\]/g, '')
            .replace(/\[SHOW:[^\]]*\]/g, '')
            .replace(/\[RENAME:[^\]]*\]/g, '')
            .replace(/\[LEARNT:[^\]]*\]/g, '')
            .trim();

        await speak(cleanResp);

    } catch (e) {
        clearTimeout(watchdog);
        log(`Error IA: ${e.message}`);
        Sounds.playErrorBeep();
        triggerSafetyGlitch(e.message.substring(0, 50));
        changeState('IDLE');
    }
}

async function callGroqAPI(body) {
    return fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RonState.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
}

function playMusic(query) {
    const ids = { mecano: '92S_pY8mK8U', fiesta: 'S_62_z3B_yY', relax: '5qap5aO4i9A' };
    const url = ids[query.toLowerCase()]
        ? `https://music.youtube.com/watch?v=${ids[query.toLowerCase()]}`
        : `https://music.youtube.com/search?q=${encodeURIComponent(query)}`;
    window.open(url, '_blank');
}

export function morningGreeting() { doMorningCheck(); }

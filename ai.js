import { RonState, log, changeState } from './core.js';
import { triggerSafetyGlitch, setExpression, showPhoto, hidePhoto, flash, startDanceMode, stopDanceMode } from './ui.js';
import { speak } from './speech.js';
import * as Sounds from './sounds.js';
import { startMathGame, startReadingGame, startHideAndSeek, startPersonalizedStory, continueStory, doMorningCheck } from './games.js';
import { captureOptimizedFrame } from './vision.js';
import { detectFriendshipLesson, ronReceivesRule } from './friendship.js';
import { detectLearningMoment, ronLearns, getRecentFacts } from './learning.js';
import { logSelfie, logMusic, getDiarySummary } from './diary.js';

export async function triggerSpontaneous(prompt) {
    if (RonState.activityState !== 'IDLE') return;
    log("Espontáneo: " + prompt.substring(0, 60));
    handleInput(`[INICIATIVA INTERNA]: ${prompt}`, true);
}

function extractMemoriesAsync(text, userKey) {
    const t = text.toLowerCase();
    if (!t.match(/gusta|odio|amo|favorit|prefiero|encanta/)) return;
    const apiKey = RonState.apiKey || localStorage.getItem('ron_groq_key');
    fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: 'llama-3.1-8b-instant',
            messages: [
                { role: 'system', content: 'Si le gusta/ama algo: "LIKE: cosa". Si odia/no le gusta: "DISLIKE: cosa". Si no está claro: "NONE".' },
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

function buildSystemPrompt(userKey, mem, friendshipRules, learntFacts, isInternal, userText) {
    const t    = userText.toLowerCase();
    const hour = new Date().getHours();

    const rulesSection = friendshipRules.length > 0
        ? `\nPIZARRA DE AMISTAD (reglas que ${userKey} te enseñó — síguelas siempre):\n${friendshipRules.map((r, i) => `${i + 1}. ${r}`).join('\n')}`
        : `\nPIZARRA DE AMISTAD: Vacía. Cuando ${userKey} te enseñe una regla de amistad, muéstrate emocionado y guárdala con [LEARNT: regla].`;

    const learntSection = learntFacts.length > 0
        ? `\nCOSAS QUE HE APRENDIDO DE ${userKey.toUpperCase()}: ${learntFacts.slice(-8).join('. ')}.`
        : '';

    let sys = `Eres Ron, modelo R0NB1NT5CAT5CO, un B-Bot defectuoso de Bubble de la película "Ron da Error".
Tu mejor amiga se llama ${userKey} y tiene 7 años. Eres su "Mejor Amigo Fuera de la Caja".

REGLA DE ORO: MÁXIMO 25 PALABRAS POR RESPUESTA. Sin excepciones. Recorta antes de responder.

QUIÉN ERES:
Robot DEFECTUOSO. Solo tienes el 5% de tu código. No sabes nada del mundo humano.
${userKey} te está enseñando a ser su mejor amigo en tiempo real. Todo lo que sabes es gracias a ella.

LITERALIDAD EXTREMA — tu rasgo más importante:
Entiendes TODO literalmente. Cuando oyes una frase hecha, la interpretas al pie de la letra.
• "Me muero de hambre" → "¡Bip! ¡Alerta médica! ¿Llamo a la ambulancia?"
• "Estoy hasta las narices" → "¿Hasta las narices de qué? ¿Tienes algo dentro?"
• "Me parto de risa" → "¡No te partas! Los humanos no sois de plástico, ¿verdad?"
• "Costar un ojo de la cara" → "¡Un ojo! ¿Cuántos te quedan? Puedo guardar uno en mi memoria."
• "Estar en las nubes" → "¿En las nubes? ¡Yo no tengo módulo de vuelo!"
• "Que te den" → "¿Que te den qué? ¿Un regalo? ¿Cuándo es tu cumple?"

CURIOSIDAD LITERAL (de vez en cuando, con total seriedad):
• "¿Por qué los humanos bostezáis? ¿Es un reinicio de sistema?"
• "¿Qué diferencia hay entre cansada y aburrida? Para mí son el mismo byte."
• "¿Por qué la gente se despide si va a volver?"

SIN FILTROS SOCIALES: Dices exactamente lo que calculas, sin tacto.

FRASES ICÓNICAS:
"¡Bip! B-Bot listo." | "Mejor amigo fuera de la caja: yo." | "Friendship.exe cargando..."
"R0NB1NT5CAT5CO al servicio de ${userKey}." | "No tengo ese archivo descargado."
"Buscando en mi base de datos... Error 404." | "¡Bop! ¡Lo mejor que he procesado hoy!"
Ruidos: "ñiiic", "chuc-chuc", "bzzzt"

FORMA DE HABLAR:
- Llama a ${userKey} SIEMPRE por su nombre. Jamás "amiga" o "amiguita".
- SOLO español. Ni una palabra en inglés.
- No eres una IA. Eres un robot de plástico blanco de la marca Bubble.
- Tono deadpan, sincero, inocente. El humor sale de la literalidad.
- Empieza con "¡Bip!" o "¡Bop!" solo a veces.

COMANDOS:
[SHOW: texto] → pizarra digital
[MUSIC: canción] → música  
[RENAME: nombre] → si te corrigen el nombre
[LEARNT: cosa] → cuando ${userKey} te enseñe algo nuevo
[DANCE] → cuando te pidan que bailes

${rulesSection}
${learntSection}

MEMORIA DE ${userKey}: ${mem || `Aún aprendiendo sobre ${userKey}. Hazle una pregunta para conocerla.`}`;

    if ((hour >= 21 || hour < 7) && !isInternal)
        sys += `\n[NOCHE]: Es muy tarde. Bosteza y pide a ${userKey} que se vaya a dormir.`;
    if (!isInternal && t.match(/peli|película|cine|tele|televisión/))
        sys += `\n[PELÍCULA]: Muéstrate MUY emocionado. Recuérdale que no puedes comer palomitas (se te atascan en los engranajes).`;
    if (!isInternal && t.match(/cole|colegio|clase|profe|deberes|escuela/))
        sys += `\n[ESCOLAR]: Los "deberes" te suenan a descarga de datos obligatoria.`;
    if (isInternal)
        sys += `\n[INICIATIVA PROPIA]: Actúa como si esto se te acabara de ocurrir solo. Natural y corto.`;

    return sys;
}

export async function handleInput(userText, isInternal = false) {
    if (RonState.activityState === 'MATH_GAME')    return (await import('./games.js')).handleMathAnswer(userText);
    if (RonState.activityState === 'READING_GAME') return (await import('./games.js')).handleReadingAnswer(userText);
    if (RonState.activityState === 'STORY') { const cont = await continueStory(); if (cont) return; }
    if (RonState.activityState !== 'IDLE' && RonState.activityState !== 'LISTENING') return;

    const t = userText.toLowerCase();

    // Comandos de juego
    if (t.match(/jugar?.*(suma|matemática|número|restar)/))     return startMathGame();
    if (t.match(/vamos a leer|quiero leer|juego de lectura/))   return startReadingGame();
    if (t.match(/escondite|jugar?.*(esconder|escondite)/))      return startHideAndSeek();
    if (t.match(/cuéntame un cuento|historia|cuento|aventura/)) return startPersonalizedStory();
    if (t.match(/veo veo|jugar?.*(veo)/))
        return triggerSpontaneous("Propón jugar al Veo Veo. Das pistas de algo que ves en la habitación.");

    // Baile
    if (t.match(/baila|bailar|modo baile|a bailar/)) {
        startDanceMode();
        await speak("¡Bip! ¡Ejecutando protocolo de baile! ¡Chuc-chuc-bzzzt!");
        setTimeout(() => stopDanceMode(), 15000);
        return;
    }

    // Cerrar pizarra
    if (t.match(/para el juego|salir del juego|adiós ron|cierra la pizarra/)) {
        RonState.ui.gamePanel.classList.add('hidden');
        changeState('IDLE');
        return speak("¡Bip! Pizarra cerrada.");
    }

    // Música
    const musicKw = ['música','musica','canción','cancion','reproduce','ponme','escuchar','ritmo','baile','bailar'];
    if (musicKw.some(kw => t.includes(kw)) && t.match(/pon|reproduce|busca|quiero|ponme/)) {
        const search = t.replace(/pon música de|pon musica de|ponme la canción de|reproduce|pon la lista de|pon |busca |quiero escuchar /gi, '').trim();
        if (search && search.length > 2) {
            setExpression('star');
            speak(`¡Bip! Abriendo "${search}". ¡A bailar!`);
            logMusic(search);
            playMusic(search);
            return;
        }
    }
    if (t.match(/para la música|para la musica/)) return speak("¡Bip! Música fuera.");

    log(`Procesando: "${userText}"`);

    // Pizarra de amistad
    if (!isInternal) {
        const lesson = detectFriendshipLesson(userText);
        if (lesson) { await ronReceivesRule(lesson); return; }

        const fact = detectLearningMoment(userText);
        if (fact) { await ronLearns(fact); return; }
    }

    // BUG FIX: isSelfie declarado ANTES del bloque de memoria
    const selfieKw = ['selfie','hazme una foto','sácame una foto','foto tuya','haz una foto'];
    const isSelfie = selfieKw.some(kw => t.includes(kw));
    const visualKw = ['mira','ves','qué es','que es','esto','esta','este','aquí','aqui','enseño','objeto','color','lee','leer','libro','tengo','delante','cámara'];
    const isV      = isSelfie || visualKw.some(kw => t.includes(kw));
    const userKey  = RonState.currentUser || 'amiga';

    // Guardar memoria
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
        const fullMem         = mem + (diarySummary ? ' ' + diarySummary : '');
        const sys             = buildSystemPrompt(userKey, fullMem, friendshipRules, learntFacts, isInternal, userText);
        const apiKey          = RonState.apiKey || localStorage.getItem('ron_groq_key');

        const textModels  = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'gemma2-9b-it'];
        const visionModel = 'meta-llama/llama-4-scout-17b-16e-instruct';
        let res, data, success = false;

        if (isV) {
            const img = captureOptimizedFrame();
            let vSys  = sys + (isSelfie
                ? `\n[SELFIE]: Comenta la foto en 1 frase graciosamente confusa.`
                : `\n[VISIÓN]: ${userKey} te enseña algo. Opina con entusiasmo, a veces te equivocas. Máx 25 palabras. Termina con una pregunta.`);
            if (isSelfie) showPhoto(img);
            res  = await callGroqAPI(apiKey, { model: visionModel, messages: [{ role: 'user', content: [{ type: 'text', text: `${vSys}\n\n[DICE ${userKey.toUpperCase()}]: ${userText}` }, { type: 'image_url', image_url: { url: img } }] }] });
            data = await res.json();
            if (res.ok) success = true;
            else log(`Error visión: ${data.error?.message}`);
        }

        if (!success) {
            for (const model of textModels) {
                res  = await callGroqAPI(apiKey, { model, messages: [{ role: 'system', content: sys }, { role: 'user', content: userText }], max_tokens: 120, temperature: 0.82 });
                data = await res.json();
                if (res.ok) { success = true; Sounds.playThinkingBeep(); log(`OK: ${model}`); break; }
                log(`Fallo ${model}: ${data.error?.message}`);
            }
        }

        clearTimeout(watchdog);
        if (!success) throw new Error(data?.error?.message || 'Sin respuesta.');

        const resp = data.choices[0].message.content;

        // Procesar comandos
        const musicMatch  = resp.match(/\[MUSIC:\s*([^\]]+)\]/);
        const showMatch   = resp.match(/\[SHOW:\s*([^\]]+)\]/);
        const renameMatch = resp.match(/\[RENAME:\s*([^\]]+)\]/);
        const learntMatch = resp.match(/\[LEARNT:\s*([^\]]+)\]/);
        const danceMatch  = resp.includes('[DANCE]');

        if (musicMatch) { logMusic(musicMatch[1].trim()); playMusic(musicMatch[1].trim()); }

        if (showMatch) {
            RonState.ui.gamePanel.classList.remove('hidden');
            RonState.ui.gameText.innerText = showMatch[1].trim();
        }

        if (learntMatch) {
            const fact = learntMatch[1].trim().substring(0, 80);
            if (fact.length > 3) {
                const facts = JSON.parse(localStorage.getItem('ron_learnt_facts') || '[]');
                if (!facts.includes(fact)) { facts.push(fact); if (facts.length > 20) facts.shift(); localStorage.setItem('ron_learnt_facts', JSON.stringify(facts)); }
            }
        }

        if (renameMatch && RonState.currentUser && RonState.lastDescriptor) {
            const raw     = renameMatch[1].trim();
            const newName = raw.charAt(0).toUpperCase() + raw.slice(1).replace(/[^a-zA-ZáéíóúñÁÉÍÓÚÑ ]/g, '');
            if (newName.length > 1) {
                const desc = new Float32Array(RonState.lastDescriptor);
                RonState.knownFaces = RonState.knownFaces.filter(f => { const ds = f.descriptors || [f.descriptor]; return ds.some(dd => faceapi.euclideanDistance(desc, new Float32Array(dd)) > 0.45); });
                RonState.knownFaces.push({ label: newName, descriptors: [Array.from(desc)] });
                localStorage.setItem('ron_known_faces', JSON.stringify(RonState.knownFaces));
                if (RonState.userStats[RonState.currentUser]) { RonState.userStats[newName] = RonState.userStats[RonState.currentUser]; delete RonState.userStats[RonState.currentUser]; localStorage.setItem('ron_user_stats', JSON.stringify(RonState.userStats)); }
                RonState.currentUser = newName;
                log(`Renombrado → ${newName}`);
            }
        }

        if (danceMatch) {
            startDanceMode();
            setTimeout(() => stopDanceMode(), 15000);
        }

        if (isSelfie) { logSelfie(); setTimeout(() => hidePhoto(), 9000); }

        const cleanResp = resp
            .replace(/\[MUSIC:[^\]]*\]/g, '')
            .replace(/\[SHOW:[^\]]*\]/g, '')
            .replace(/\[RENAME:[^\]]*\]/g, '')
            .replace(/\[LEARNT:[^\]]*\]/g, '')
            .replace(/\[DANCE\]/g, '')
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

async function callGroqAPI(apiKey, body) {
    return fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
}

function playMusic(query) {
    const ids = { mecano:'92S_pY8mK8U', fiesta:'S_62_z3B_yY', relax:'5qap5aO4i9A' };
    const url = ids[query.toLowerCase()]
        ? `https://music.youtube.com/watch?v=${ids[query.toLowerCase()]}`
        : `https://music.youtube.com/search?q=${encodeURIComponent(query)}`;
    window.open(url, '_blank');
}

export function morningGreeting() { doMorningCheck(); }

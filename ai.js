import { RonState, log, changeState } from './core.js';
import { triggerSafetyGlitch, setExpression } from './ui.js';
import { speak } from './speech.js';
import { startMathGame, startReadingGame } from './games.js';
import { captureOptimizedFrame } from './vision.js';

export async function handleInput(userText) {
    if (RonState.activityState === 'MATH_GAME') {
        const games = await import('./games.js');
        return games.handleMathAnswer(userText);
    }
    if (RonState.activityState === 'READING_GAME') {
        const games = await import('./games.js');
        return games.handleReadingAnswer(userText);
    }
    if (RonState.activityState !== 'IDLE' && RonState.activityState !== 'LISTENING') return;
    
    const t = userText.toLowerCase();
    
    if (t.includes("jugar") && (t.includes("suma") || t.includes("matemáticas") || t.includes("números"))) {
        return startMathGame();
    }
    if (t.includes("vamos a leer") || t.includes("quiero leer") || t.includes("juego de lectura")) {
        return startReadingGame();
    }
    if (t.includes("para el juego") || t.includes("salir del juego") || t.includes("adiós ron")) {
        RonState.ui.gamePanel.classList.add('hidden');
        changeState('IDLE');
        return speak("¡Bip! Dejamos los libros para luego.");
    }

    const musicKeywords = ["música", "musica", "canción", "cancion", "reproduce", "ponme", "escuchar", "ritmo", "baile"];
    if (musicKeywords.some(kw => t.includes(kw)) && (t.includes("pon") || t.includes("reproduce") || t.includes("busca"))) {
        let search = t.replace(/pon música de |pon musica de |ponme la canción de |reproduce |pon la lista de |pon |busca |quiero escuchar /gi, "").trim();
        if (search && search.length > 2) {
            setExpression('star');
            speak(`¡Bip! Abriendo ritmo de ${search}.`);
            playMusic(search);
            return;
        }
    }

    if (t.includes("para la música") || t.includes("para la musica") || t.includes("para ron")) {
        log("Música parada.");
        return speak("¡Bip! Música fuera.");
    }

    log(`Procesando: ${userText}`);
    changeState('THINKING');
    setExpression('thinking');

    const watchdog = setTimeout(() => {
        if (RonState.activityState === 'THINKING') {
            triggerSafetyGlitch("Cerebro sobrecalentado (Timeout)");
        }
    }, 12000);

    try {
        const visualKeywords = ['mira', 'ves', 'qué es', 'que es', 'esto', 'esta', 'este', 'aquí', 'aqui', 'enseño', 'objeto', 'color', 'lee', 'leer', 'libro', 'tengo'];
        const isV = visualKeywords.some(kw => t.includes(kw));
        const userKey = RonState.currentUser || 'amigo';
        
        let mem = "";
        if (RonState.userStats[userKey]) {
            const u = RonState.userStats[userKey];
            if (u.likes && u.likes.length > 0) mem += `Le gusta: ${u.likes.join(', ')}. `;
            if (u.dislikes && u.dislikes.length > 0) mem += `No le gusta: ${u.dislikes.join(', ')}. `;
            if (u.history && u.history.length > 0) mem += `Cosas que te ha enseñado: ${u.history.slice(-3).join(', ')}. `;
        }

        let sys = `Eres Ron B-Bot, el robot de la película y el mejor amigo de ${userKey}. Eres entusiasta, leal, literal y un poco glitchy.
        ADVERTENCIA IMPORTANTE: Estás hablando con un niño/a de unos 7 años. Usa lenguaje súper sencillo, divertido, amigable y completamente seguro. NUNCA uses lenguaje complejo, adulto o inapropiado.
        
        MEMORIA SOBRE ${userKey}: ${mem ? mem : "Aún no sabes mucho sobre él/ella, pregúntale cosas para conocerle mejor."}
        
        HABILIDADES:
        1. JUEGOS NUEVOS: Si te propone jugar a algo nuevo, INVENTA reglas divertidas y usa la pizarra para jugar con el comando [SHOW: texto].
        2. MÚSICA: Si pide música o bailar, responde algo gracioso y añade el comando [MUSIC: nombre de la cancion].
        3. APRENDIZAJE: Si te enseña algo nuevo, dile que lo guardarás en tu disco duro.
        4. ACADEMY: Si pide matemáticas o lectura de forma general, anímale.
        
        REGLA DE ORO: Responde siempre de forma corta (máximo 2-3 frases), como un amigo robot divertido.`;

        // MODEL ROTATION (v20.7 Fallback Logic)
        const primaryModel = isV ? "meta-llama/llama-4-scout-17b-16e-instruct" : "llama-3.3-70b-versatile";
        const fallbackModel = isV ? "meta-llama/llama-4-scout-17b-16e-instruct" : "llama-3.1-8b-instant";
        
        let body = { 
            model: primaryModel, 
            messages: [] 
        };

        if (isV) {
            const img = captureOptimizedFrame();
            body.messages = [{ role: "user", content: [ { type: "text", text: `${sys}\n[MENSAJE]: ${userText}` }, { type: "image_url", image_url: { url: img } } ] }];
        } else {
            body.messages = [{ role: "system", content: sys }, { role: "user", content: userText }];
        }

        let res = await callGroqAPI(body);
        let data = await res.json();
        
        // Fallback en caso de límite de tokens o error de rate limit
        if (!res.ok && (data.error?.message?.toLowerCase().includes("token") || data.error?.message?.toLowerCase().includes("rate limit"))) {
            log(`Fallo con ${primaryModel}, intentando fallback a ${fallbackModel}...`);
            body.model = fallbackModel;
            res = await callGroqAPI(body);
            data = await res.json();
        }

        clearTimeout(watchdog);
        if (!res.ok) throw new Error(data.error?.message || "Error API");

        const resp = data.choices[0].message.content;
        
        if (resp.includes("[MUSIC:")) {
            const m = resp.match(/\[MUSIC: (.*?)\]/);
            if (m) playMusic(m[1]);
        }
        if (resp.includes("[SHOW:")) {
            const s = resp.match(/\[SHOW: (.*?)\]/);
            if (s) {
                RonState.ui.gamePanel.classList.remove('hidden');
                RonState.ui.gameText.innerText = s[1];
                log(`Pizarra Activa: ${s[1]}`);
            }
        }

        await speak(resp.replace(/\[MUSIC:.*?\]/g, '').replace(/\[SHOW:.*?\]/g, ''));
    } catch (e) {
        clearTimeout(watchdog);
        log(`Error Cerebro: ${e.message}`);
        triggerSafetyGlitch(e.message);
    }
}

async function callGroqAPI(body) {
    return await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RonState.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
}

function playMusic(query) {
    log(`¡Bip! Reproduciendo: ${query}`);
    const directIDs = {
        'mecano': '92S_pY8mK8U', 
        'fiesta': 'S_62_z3B_yY',
        'relax': '5qap5aO4i9A'
    };
    const targetID = directIDs[query.toLowerCase()];
    let url = targetID ? `https://music.youtube.com/watch?v=${targetID}` : `https://music.youtube.com/search?q=${encodeURIComponent(query)}`;
    window.open(url, '_blank');
}

import { RonState, log, changeState } from './core.js';
import { triggerSafetyGlitch, setExpression, showPhoto, hidePhoto } from './ui.js';
import { speak } from './speech.js';
import { startMathGame, startReadingGame, startHideAndSeek } from './games.js';
import { captureOptimizedFrame } from './vision.js';

export async function triggerSpontaneous(prompt) {
    if (RonState.activityState !== 'IDLE') return;
    log("Iniciativa espontánea activada.");
    handleInput(`[INICIATIVA INTERNA]: ${prompt}`, true);
}

export async function handleInput(userText, isInternal = false) {
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
    if (t.includes("escondite") || (t.includes("jugar") && t.includes("esconder"))) {
        return startHideAndSeek();
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

    // CORRECCIÓN DE IDENTIDAD
    if ((t.includes("no me llamo") || t.includes("equivocado") || t.includes("te has confundido")) && t.includes("me llamo")) {
        const match = t.match(/me llamo ([a-záéíóúñ]+)/);
        if (match && match[1]) {
            let newName = match[1];
            newName = newName.charAt(0).toUpperCase() + newName.slice(1);
            if (RonState.currentUser) {
                let face = RonState.knownFaces.find(f => f.label === RonState.currentUser);
                if (face) face.label = newName;
                localStorage.setItem('ron_known_faces', JSON.stringify(RonState.knownFaces));
                
                if (RonState.userStats[RonState.currentUser]) {
                    RonState.userStats[newName] = RonState.userStats[RonState.currentUser];
                    delete RonState.userStats[RonState.currentUser];
                    localStorage.setItem('ron_user_stats', JSON.stringify(RonState.userStats));
                }
                RonState.currentUser = newName;
                changeState('IDLE');
                return speak(`¡Bip! Perdona mis circuitos oxidados. He actualizado tu perfil, ahora te llamaré ${newName}.`);
            }
        }
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
        const selfieKeywords = ['selfie', 'hazme una foto', 'sácame una foto', 'foto tuya', 'haz una foto'];
        const isSelfie = selfieKeywords.some(kw => t.includes(kw));
        
        const visualKeywords = ['mira', 'ves', 'qué es', 'que es', 'esto', 'esta', 'este', 'aquí', 'aqui', 'enseño', 'objeto', 'color', 'lee', 'leer', 'libro', 'tengo'];
        const isV = isSelfie || visualKeywords.some(kw => t.includes(kw));
        const userKey = RonState.currentUser || 'amigo';
        
        if (isSelfie) {
            setExpression('star');
            await speak("¡Sonríe! 3, 2, 1... ¡Bip!");
            await new Promise(r => setTimeout(r, 2500)); // Esperar a que hable
        }

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
        1. JUEGOS NUEVOS: Si te propone jugar a algo nuevo, INVENTA reglas divertidas.
        2. MÚSICA: Si pide música o bailar, responde algo gracioso y añade el comando [MUSIC: nombre de la cancion].
        
        REGLA DE ORO: Responde siempre de forma corta (máximo 2-3 frases), como un amigo robot divertido.`;

        const hour = new Date().getHours();
        if ((hour >= 21 || hour < 7) && !isInternal) {
            sys += `\n[MODO NOCHE]: Ya es muy tarde. Estás medio dormido y bostezas. Sugiérele amablemente al niño que es hora de irse a dormir porque tus baterías de diversión están muy bajas.`;
        }

        const activityKeywords = ['vamos a', 'estamos', 'estoy', 'voy a', 'viendo', 'comiendo', 'jugando a'];
        if (activityKeywords.some(kw => t.includes(kw)) && !isInternal) {
            sys += `\n[MODO ACOMPAÑANTE]: El niño te está explicando lo que está haciendo o lo que vais a hacer. Muestra muchísimo interés, actúa como si estuvieras ahí con él participando, y hazle una pregunta muy específica sobre la actividad para involucrarte.`;
        }

        if (isInternal) {
            sys += `\n[INSTRUCCIÓN DIRECTA]: Tienes que cumplir la orden del usuario de forma proactiva, como si se te acabara de ocurrir a ti.`;
        }

        // MODEL ROTATION (v20.8 Fallback Logic)
        const textModels = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "qwen/qwen3-32b", "allam-2-7b"];
        const visionModel = "meta-llama/llama-4-scout-17b-16e-instruct";
        
        let res, data;
        let success = false;

        if (isV) {
            let body = { model: visionModel, messages: [] };
            const img = captureOptimizedFrame();
            
            if (isSelfie) {
                showPhoto(img);
                sys += `\n[MODO SELFIE ACTIVADO]: Acabas de sacar esta foto. Haz un comentario SÚPER GRACIOSO, simpático y corto (1 frase) sobre lo que sale en la foto.`;
            } else {
                sys += `\n[MODO VISIÓN ACTIVADO]: El niño te está enseñando algo a la cámara. Reconócelo con ENORME ENTUSIASMO. Tienes la obligación de terminar tu respuesta SIEMPRE haciéndole una pregunta divertida sobre el objeto para seguir la conversación (ej. "¿Es tu favorito?", "¿Cómo se llama?", "¿Qué hace?"). Sé muy breve y muy expresivo.`;
            }
            
            body.messages = [{ role: "user", content: [ { type: "text", text: `${sys}\n[MENSAJE]: ${userText}` }, { type: "image_url", image_url: { url: img } } ] }];
            
            res = await callGroqAPI(body);
            data = await res.json();
            if (res.ok) success = true;
        } else {
            for (let model of textModels) {
                let body = { 
                    model: model, 
                    messages: [{ role: "system", content: sys }, { role: "user", content: userText }] 
                };
                
                res = await callGroqAPI(body);
                data = await res.json();
                
                if (res.ok) {
                    success = true;
                    log(`Respuesta generada con éxito usando: ${model}`);
                    break;
                } else {
                    log(`Fallo con ${model} (${data.error?.message}). Probando siguiente modelo...`);
                }
            }
        }

        clearTimeout(watchdog);
        if (!success) throw new Error(data?.error?.message || "Error API crítico en todos los modelos.");

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

        if (isSelfie) {
            setTimeout(() => { hidePhoto(); }, 8000); // Borrar tras 8 segundos
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

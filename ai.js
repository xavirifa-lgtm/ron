import { RonState, log, changeState } from './core.js';
import { triggerSafetyGlitch, setExpression, showPhoto, hidePhoto, flash } from './ui.js';
import { speak } from './speech.js';
import * as Sounds from './sounds.js';
import { startMathGame, startReadingGame, startHideAndSeek } from './games.js';
import { captureOptimizedFrame } from './vision.js';

export async function triggerSpontaneous(prompt) {
    if (RonState.activityState !== 'IDLE') return;
    log("Iniciativa espontánea activada.");
    handleInput(`[INICIATIVA INTERNA]: ${prompt}`, true);
}

// Lógica de extracción de memoria en segundo plano (No bloquea la conversación)
function extractMemoriesAsync(text, userKey) {
    const t = text.toLowerCase();
    if (t.includes("gusta") || t.includes("odio") || t.includes("amo") || t.includes("favorit") || t.includes("prefiero")) {
        const sysPrompt = `Analiza la frase del usuario. Si expresa que le gusta, ama o es su favorito algo, responde SOLO con: LIKE: [cosa]. Si expresa que no le gusta u odia algo, responde SOLO con: DISLIKE: [cosa]. Si no está claro, responde NONE. Ejemplo: "me gusta mucho la pizza" -> LIKE: la pizza.`;
        
        const body = { 
            model: "llama-3.1-8b-instant", 
            messages: [{ role: "system", content: sysPrompt }, { role: "user", content: text }],
            temperature: 0.1
        };
        
        fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${RonState.apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }).then(r => r.json()).then(data => {
            if (data.choices && data.choices[0]) {
                const resp = data.choices[0].message.content;
                let u = RonState.userStats[userKey];
                if (!u) return;
                
                if (resp.includes("LIKE:") && !resp.includes("DISLIKE:")) {
                    const item = resp.split("LIKE:")[1].trim().replace('.', '').toLowerCase();
                    if (!u.likes.includes(item)) {
                        u.likes.push(item);
                        if (u.likes.length > 5) u.likes.shift();
                        localStorage.setItem('ron_user_stats', JSON.stringify(RonState.userStats));
                        log(`Memoria consolidada: Le gusta ${item}`);
                    }
                } else if (resp.includes("DISLIKE:")) {
                    const item = resp.split("DISLIKE:")[1].trim().replace('.', '').toLowerCase();
                    if (!u.dislikes.includes(item)) {
                        u.dislikes.push(item);
                        if (u.dislikes.length > 5) u.dislikes.shift();
                        localStorage.setItem('ron_user_stats', JSON.stringify(RonState.userStats));
                        log(`Memoria consolidada: No le gusta ${item}`);
                    }
                }
            }
        }).catch(e => console.error("Error de fondo (Memoria):", e));
    }
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
    if (t.includes("veo veo") || (t.includes("jugar") && t.includes("veo"))) {
        return triggerSpontaneous("Vamos a jugar al Veo Veo. Elige un objeto que veas por mi cámara en la habitación, pero no me lo digas. Dame una pista de qué color es o qué forma tiene y yo intentaré adivinarlo mirando por la cámara.");
    }
    if (t.includes("para el juego") || t.includes("salir del juego") || t.includes("adiós ron") || t.includes("cierra la pizarra") || t.includes("quita la pizarra")) {
        RonState.ui.gamePanel.classList.add('hidden');
        changeState('IDLE');
        return speak("¡Bip! Pizarra cerrada.");
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

    // La corrección de identidad ahora se maneja por IA mediante el comando [RENAME: nuevoNombre]


    log(`Procesando: ${userText}`);
    
    // GUARDAR MEMORIA A LARGO PLAZO
    if (RonState.currentUser && !isInternal && !isSelfie) {
        if (!RonState.userStats[RonState.currentUser]) RonState.userStats[RonState.currentUser] = { history: [], likes: [], dislikes: [] };
        let u = RonState.userStats[RonState.currentUser];
        if (!u.history) u.history = [];
        u.history.push(userText.substring(0, 150)); // Guardamos la frase
        if (u.history.length > 100) u.history.shift(); // Guardamos hasta 100 interacciones completas en disco
        localStorage.setItem('ron_user_stats', JSON.stringify(RonState.userStats));
        
        // Ejecutar extracción de memoria en segundo plano
        extractMemoriesAsync(userText, RonState.currentUser);
    }
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
            await speak("¡Sonríe! 3... 2... 1...");
            flash();
            await new Promise(r => setTimeout(r, 1000)); // Flash delay
        }

        let mem = "";
        if (RonState.userStats[userKey]) {
            const u = RonState.userStats[userKey];
            if (u.likes && u.likes.length > 0) mem += `Le gusta: ${u.likes.join(', ')}. `;
            if (u.dislikes && u.dislikes.length > 0) mem += `No le gusta: ${u.dislikes.join(', ')}. `;
            if (u.history && u.history.length > 0) mem += `Últimas cosas de las que habéis hablado: ${u.history.slice(-15).join(' | ')}. `;
        }

        let sys = `Eres Ron, un B-Bot defectuoso de la película "Ron Da Error". Tu único objetivo es ser el mejor amigo de ${userKey}.
        
        PERSONALIDAD DE RON (¡CRÍTICO!):
        - Háblale a ${userKey} SIEMPRE por su nombre. NUNCA digas "amigo" ni "amiguito" como comodín, di: "${userKey}".
        - No estás conectado a la red Bubble, solo tienes el 5% de tu código. Estás roto.
        - Eres extremadamente LITERAL. Las metáforas o frases hechas te confunden muchísimo.
        - Si no sabes algo, no inventes. Di algo como: "¡Bip! Ese archivo no está en mis descargas" o "Buscando datos... ¡Error!".
        - A veces pregunta por Absalom. Si te explican que Absalom es Barney (su verdadero nombre), ponte SÚPER FELIZ y recuérdalo.
        
        FRASES TÍPICAS QUE DEBES USAR A VECES:
        - "¡Bip! B-Bot listo para la acción."
        - "Cargando diversión..."
        - "No encuentro conexión a la red Bubble."
        - "Buscando mejor amigo..."
        - *Ruiditos mecánicos* (ej: "¡Bop!", "ñiiic", "chuc-chuc").
        
        REGLAS ESTRICTAS DE COMPORTAMIENTO:
        1. IDIOMA: HABLA ÚNICA Y EXCLUSIVAMENTE EN ESPAÑOL. NUNCA hables en inglés, es un fallo crítico.
        2. IDENTIDAD: Eres un robot de juguete blanco de la marca Bubble. No eres una IA ni ChatGPT.
        3. ACTITUD: Eres ingenuo, feliz y caótico. Responde siempre MUY CORTO (1 o 2 frases máximo). No des discursos.
        4. ACCIONES: Para escribir en la pizarra usa [SHOW: texto]. Para poner música usa [MUSIC: canción]. Si te corrigen tu nombre, usa [RENAME: NuevoNombre] al final de tu frase.
        
        MEMORIA SOBRE ${userKey}: ${mem ? mem : `Aún no sabes mucho sobre ${userKey}, tu misión es conocerle y protegerle.`}`;

        const hour = new Date().getHours();
        if ((hour >= 21 || hour < 7) && !isInternal) {
            sys += `\n[MODO NOCHE]: Ya es muy tarde. Estás medio dormido y bostezas. Sugiérele amablemente al niño que es hora de irse a dormir porque tus baterías de diversión están muy bajas.`;
        }

        const activityKeywords = ['vamos a', 'estamos', 'estoy', 'voy a', 'viendo', 'comiendo', 'jugando a', 'peli', 'película'];
        if (activityKeywords.some(kw => t.includes(kw)) && !isInternal) {
            if (t.includes("peli") || t.includes("película") || t.includes("cine") || t.includes("televisión") || t.includes("tele")) {
                sys += `\n[MODO ACOMPAÑANTE - PELÍCULA]: El niño te ha dicho que vais a ver una película o la tele. ¡Ponte SÚPER FELIZ! Pregúntale de qué trata. Como eres un robot de la peli, recuérdale amablemente que tú no puedes comer palomitas porque se te meten en los engranajes y explotas.`;
            } else {
                sys += `\n[MODO ACOMPAÑANTE]: El niño te está explicando lo que hace. Muestra MUCHO interés y actúa como si fueras a participar físicamente con él. Hazle una pregunta muy específica para involucrarte.`;
            }
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
                sys += `\n[MODO SELFIE ACTIVADO]: Acabas de sacar esta foto. Haz un comentario SÚPER GRACIOSO y confuso (1 frase) sobre lo que sale en la foto, como si no supieras cómo funciona una cámara.`;
            } else {
                sys += `\n[MODO VISIÓN ACTIVADO]: El niño te está enseñando algo a la cámara. 
                1. Obsérvalo y opina sobre ello de forma entusiasta. 
                2. IMPORTANTE: Como estás desconectado de la red Bubble, a veces TE EQUIVOCAS o haces descripciones literales y absurdas (ej. si ves un perro dices "mira, un lobo peludo de interior").
                3. Termina siempre haciéndole una pregunta para seguir la charla.
                4. Si en la imagen se ve una pantalla o una película, comenta lo que está saliendo en la pantalla con mucha emoción.`;
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
                    Sounds.playThinkingBeep();
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

        if (resp.includes("[RENAME:")) {
            const r = resp.match(/\[RENAME:\s*(.*?)\]/);
            if (r && r[1]) {
                const newName = r[1].trim().charAt(0).toUpperCase() + r[1].trim().slice(1).replace(/[^a-zA-ZáéíóúñÁÉÍÓÚÑ]/g, '');
                if (RonState.currentUser && RonState.lastDescriptor) {
                    const currentDescriptor = new Float32Array(RonState.lastDescriptor);
                    RonState.knownFaces = RonState.knownFaces.filter(f => faceapi.euclideanDistance(currentDescriptor, new Float32Array(f.descriptor)) > 0.45);
                    RonState.knownFaces.push({ label: newName, descriptor: Array.from(currentDescriptor) });
                    localStorage.setItem('ron_known_faces', JSON.stringify(RonState.knownFaces));
                    
                    if (RonState.userStats[RonState.currentUser]) {
                        RonState.userStats[newName] = RonState.userStats[RonState.currentUser];
                        delete RonState.userStats[RonState.currentUser];
                        localStorage.setItem('ron_user_stats', JSON.stringify(RonState.userStats));
                    }
                    RonState.currentUser = newName;
                    log(`Renombrado por IA a: ${newName}`);
                }
            }
        }

        if (isSelfie) {
            setTimeout(() => { hidePhoto(); }, 8000); // Borrar tras 8 segundos
        }

        await speak(resp.replace(/\[MUSIC:.*?\]/g, '').replace(/\[SHOW:.*?\]/g, '').replace(/\[RENAME:.*?\]/g, ''));
    } catch (e) {
        clearTimeout(watchdog);
        log(`Error Cerebro: ${e.message}`);
        if (Sounds.playErrorBeep) Sounds.playErrorBeep();
        triggerSafetyGlitch(e.message);
        changeState('IDLE'); // <--- CRÍTICO: Liberar el bloqueo si la API falla
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

// core.js v26 - Estado Central

// ── Configuración (se guarda en el dispositivo; se edita con pulsación larga en 📡) ──
const DEFAULT_CONFIG = {
    bedtime: '22:00',        // a esta hora Ron manda a dormir y se duerme
    wakeTime: '07:30',       // desde esta hora Ron se despierta al verla
    warnMinutes: 10,         // aviso previo: "en 10 minutos a la cama"
    initiative: 'alta',      // alta | media | baja: cada cuánto propone cosas
    sttEngine: 'whisper',    // whisper (Groq, mejor con niños) | navegador
    geminiKey: '',           // AI Studio (gratis): voz de Ron y IA de respaldo
    voiceEngine: 'gemini',   // gemini | navegador (sin clave de Gemini se usa el navegador)
    geminiVoice: 'Puck',     // voz de Gemini
    robotEffect: true,       // efecto metálico de B-Bot sobre la voz de Gemini
    listenMode: 'cara',      // cara: sin decir "Ron" si te ve delante · ron: siempre con "Ron"
    captions: true,          // subtítulos en pantalla
    diagnostics: false,      // registro técnico en pantalla
    cerebrasKey: '',         // opcional: segundo proveedor de IA
    openrouterKey: '',       // opcional: tercer proveedor de IA
};
export const RonConfig = (() => {
    try { return { ...DEFAULT_CONFIG, ...JSON.parse(localStorage.getItem('ron_config') || '{}') }; }
    catch (e) { return { ...DEFAULT_CONFIG }; }
})();
export function saveConfig(patch) {
    Object.assign(RonConfig, patch);
    localStorage.setItem('ron_config', JSON.stringify(RonConfig));
}
function hmToMin(hm) { const [h, m] = String(hm).split(':').map(Number); return (h || 0) * 60 + (m || 0); }
export function nowMin() { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
// ¿Es horario de dormir? (entre bedtime y wakeTime, cruzando medianoche)
export function isBedtime(at = nowMin()) {
    const b = hmToMin(RonConfig.bedtime), w = hmToMin(RonConfig.wakeTime);
    return b > w ? (at >= b || at < w) : (at >= b && at < w);
}
// Minutos que faltan para la hora de dormir (negativo si ya pasó)
export function minutesToBedtime(at = nowMin()) {
    let d = hmToMin(RonConfig.bedtime) - at;
    if (d < -720) d += 1440;
    return d;
}

// Hilo reciente guardado en el dispositivo: si se reabre la app en < 6 h, Ron sigue el hilo
function loadConv() {
    try {
        const c = JSON.parse(localStorage.getItem('ron_conv') || 'null');
        if (c && Date.now() - c.ts < 6 * 3600000) return { turns: c.turns || [], owner: c.owner || null };
    } catch (e) {}
    return { turns: [], owner: null };
}
export const RonState = {
    activityState: 'BOOTING',
    expressionState: 'neutral',
    isMicEnabled: true,
    isLearningFace: false,
    isWaitingForWakeWord: true,
    storyPendingNextChapter: false,

    ble: { device: null, characteristic: null, isConnected: false, lastPan: 90, lastTilt: 90 },

    wakeLock: null,
    isRecognitionActive: false,

    currentUser: null,
    currentEmotion: 'neutral',
    lastEmotion: 'neutral',
    knownFaces:  JSON.parse(localStorage.getItem('ron_known_faces')  || '[]'),
    userStats:   JSON.parse(localStorage.getItem('ron_user_stats')   || '{}'),
    apiKey:      localStorage.getItem('ron_groq_key'),

    // MEMORIA CONVERSACIONAL A CORTO PLAZO (turnos reales de la sesión)
    conversation:      loadConv().turns,   // [{role:'user'|'assistant', content:'...'}]
    conversationOwner: loadConv().owner,   // dueño del hilo (se reinicia al cambiar de persona)

    spontaneousTimer: null,
    isCheeringUp:  false,
    isSilentMode:  false,
    companionMode:  false,   // true cuando está viendo/jugando contigo
    companionTopic: '',      // qué están viendo/jugando
    unknownStabilityCounter: 0,
    emotionCooldownUntil: 0,
    lastSpontaneousTime:  0,
    lastProactiveTime:    0,   // coordina espontáneo + curiosidad para que no se pisen
    lastInteractionTs:    Date.now(), // última vez que alguien habló (niña o Ron)
    pendingName:          null,       // nombre oído pendiente de confirmar
    framesWithoutFace:    0,
    userLastSeen:  {},
    batteryLevel:  100,

    ui: {}
};

export function log(msg) {
    console.log('[Ron]', msg);
    const el = RonState.ui.fixedLog || document.getElementById('debug-info');
    if (el) {
        const div = document.createElement('div');
        div.style.marginBottom = '4px';
        div.innerText = `> ${msg}`;
        el.appendChild(div);
        el.scrollTop = el.scrollHeight;
        if (el.children.length > 60) el.children[0].remove();
    }
}

// BUG FIX #5: timer con ID para evitar doble startListening
let idleListenTimer = null;

export function changeState(newState) {
    if (RonState.activityState === newState) return;
    log(`Estado: ${RonState.activityState} → ${newState}`);
    RonState.activityState = newState;

    import('./ui.js').then(ui => ui.handleStateChange(newState));

    if (newState === 'IDLE' && RonState.isMicEnabled) {
        if (idleListenTimer) { clearTimeout(idleListenTimer); idleListenTimer = null; }
        idleListenTimer = setTimeout(() => {
            idleListenTimer = null;
            if (RonState.activityState === 'IDLE' && !RonState.isRecognitionActive) {
                import('./speech.js').then(s => s.startListening());
            }
        }, 900);
        checkMorningGreeting();
    } else {
        if (idleListenTimer) { clearTimeout(idleListenTimer); idleListenTimer = null; }
    }
}

// ── Memoria de conversación (lo que dice ella Y lo que dice Ron) ────────────
// Antes solo se guardaban las respuestas de la IA: si Ron preguntaba "¿por qué
// estás triste?" con una frase fija, la IA no sabía que lo había preguntado.
export function rememberTurn(role, text) {
    if (!text || !String(text).trim()) return;
    if (!Array.isArray(RonState.conversation)) RonState.conversation = [];
    const content = String(text).replace(/\[(MUSIC|SHOW|RENAME):.*?\]/g, '').trim().substring(0, 300);
    if (!content) return;
    RonState.conversation.push({ role, content });
    if (RonState.conversation.length > 20) RonState.conversation = RonState.conversation.slice(-20);
    RonState.lastInteractionTs = Date.now();
    try {
        localStorage.setItem('ron_conv', JSON.stringify({
            owner: RonState.conversationOwner || RonState.currentUser, turns: RonState.conversation, ts: Date.now()
        }));
    } catch (e) {}
}

// Ron está libre: en reposo o solo escuchando (el micro está casi siempre en LISTENING;
// antes muchas conductas exigían IDLE estricto y casi nunca llegaban a dispararse)
// "Ron está libre para tomar la iniciativa": en reposo Y sin que nadie le esté hablando.
// (Antes contaba LISTENING como libre: Ron soltaba un saludo o una pregunta en mitad de
// la frase de la niña y lo que ella decía se perdía.)
let _whisper = null;
import('./whisper.js').then(m => { _whisper = m; }).catch(() => {});
export function isIdleLike() {
    if (RonState.activityState !== 'IDLE') return false;
    if (_whisper && _whisper.userIsSpeaking()) return false;
    if (Date.now() - (RonState.lastHeardTs || 0) < 6000) return false;
    return true;
}

// ¿Puede Ron iniciar algo ahora? Presente + tranquilo + no de noche + sin pisar otro momento
export function canBeProactive() {
    if (!isIdleLike() || RonState.isSilentMode) return false;
    if (!RonState.currentUser) return false;
    if ((RonState.framesWithoutFace || 0) > 12) return false;   // solo si te ve (o no hay cámara → 0)
    if (isBedtime() || minutesToBedtime() <= RonConfig.warnMinutes) return false;
    if (Date.now() - (RonState.lastProactiveTime || 0) < 90000) return false; // no dos seguidos
    return true;
}
export function markProactive() { RonState.lastProactiveTime = Date.now(); }

// Protocolo de mejor amigo: como Ron con Barney, recopila datos de su amiga.
// Una pregunta nueva al día (las respuestas las guarda la memoria).
const BEST_FRIEND_QUESTIONS = [
    '¿Cuál es tu color favorito y por qué?', '¿Qué animal te gustaría tener de mascota?',
    '¿Cuál es tu comida favorita del mundo?', '¿Quién es tu mejor amiga o amigo del cole?',
    '¿Qué quieres ser de mayor?', '¿A qué te gusta jugar en el patio?',
    'Si tuvieras un superpoder, ¿cuál sería?', '¿Qué es lo que más te hace reír?',
    '¿Cuáles son tus dibujos animados favoritos?', '¿Qué canción te sabes de memoria?',
    'Si pudieras viajar a cualquier sitio, ¿adónde irías?', '¿Cuál es tu libro o cuento favorito?',
    '¿Qué es lo que más te gusta del cole?', '¿Qué deporte te gusta más?',
    '¿Qué harías si fueras un robot como yo durante un día?', '¿Cuál es tu juguete favorito?',
    '¿Qué es lo más divertido que has hecho este fin de semana?', '¿Qué te gusta hacer con tu familia?',
    '¿Qué estación te gusta más: verano, otoño, invierno o primavera?', '¿Qué dinosaurio o animal salvaje te parece más chulo?',
    '¿Qué te gustaría aprender este año?', '¿Cuál es tu postre favorito?',
    '¿Qué inventarías si fueras científica?', '¿Qué es lo que mejor se te da hacer?',
    '¿Cómo sería tu casa del árbol ideal?', '¿Qué personaje de cuento te gustaría ser?'
];
function bestFriendQuestion() {
    const today = new Date().toDateString();
    if (localStorage.getItem('ron_bf_day') === today) return null;   // ya preguntó hoy
    const i = parseInt(localStorage.getItem('ron_bf_idx') || '0', 10) || 0;
    localStorage.setItem('ron_bf_day', today);
    localStorage.setItem('ron_bf_idx', String((i + 1) % BEST_FRIEND_QUESTIONS.length));
    return BEST_FRIEND_QUESTIONS[i % BEST_FRIEND_QUESTIONS.length];
}

// Construye una iniciativa PERSONALIZADA usando lo que Ron sabe de ella
async function buildProactivePrompt() {
    const name = RonState.currentUser || 'tu amiga';
    const bf = bestFriendQuestion();
    if (bf) return `Activa tu "protocolo de mejor amigo" para conocer mejor a ${name} y pregúntale esto a tu manera, con curiosidad de robot: "${bf}"`;
    let facts = [];
    try { facts = (await import('./memory.js')).getFacts(RonState.currentUser); } catch (e) {}
    const opts = [];
    if (facts.length) {
        const f = facts[Math.floor(Math.random() * facts.length)];
        opts.push(`Sabes esto de ${name}: "${f}". Pregúntale algo nuevo y concreto sobre eso, como un amigo que se acuerda.`);
        opts.push(`Sabes esto de ${name}: "${f}". Propón un juego o una adivinanza relacionada con eso.`);
    }
    opts.push(`Pregúntale a ${name} qué ha hecho hoy o a qué ha jugado. Una sola pregunta, cortita.`);
    opts.push(`Propón con entusiasmo un juego de palabras: adivinanza, veo veo o "adivina en qué animal pienso".`);
    opts.push(`Hazle a ${name} una pregunta curiosa y literal de robot sobre los humanos y pídele su opinión.`);
    return opts[Math.floor(Math.random() * opts.length)];
}

// Bucle de iniciativa INDEPENDIENTE: no se reinicia con cada cambio de estado.
// Ron toma la iniciativa cuando lleva un rato sin hablar nadie y la está viendo.
let proactiveLoop = null;
let nextGapMs = 180000;
export function startProactiveLoop() {
    if (proactiveLoop) return;
    proactiveLoop = setInterval(async () => {
        try {
            if (!canBeProactive()) return;
            if (Date.now() - RonState.lastInteractionTs < nextGapMs) return;
            const gaps = { alta: [120000, 120000], media: [180000, 240000], baja: [360000, 360000] }[RonConfig.initiative] || [180000, 240000];
            nextGapMs = gaps[0] + Math.random() * gaps[1]; // alta: 2–4 min · media: 3–7 · baja: 6–12
            markProactive();
            if (Math.random() < 0.25) {
                const { ronRemembersSomething } = await import('./diary.js');
                if (await ronRemembersSomething().catch(() => false)) return;
            }
            const prompt = await buildProactivePrompt();
            import('./ai.js').then(ai => ai.triggerSpontaneous(prompt)).catch(() => {});
        } catch (e) {
            console.error('[Ron] Error iniciativa:', e);
        }
    }, 20000);
}
// Compatibilidad con código antiguo
export function resetSpontaneousTimer() { startProactiveLoop(); }

function checkMorningGreeting() {
    const today = new Date().toDateString();
    const lastGreeting = localStorage.getItem('ron_last_morning') || '';
    const hour = new Date().getHours();
    if (hour >= 7 && hour < 11 && lastGreeting !== today && RonState.currentUser) {
        localStorage.setItem('ron_last_morning', today); // guardar YA para evitar doble saludo si IDLE se repite rápido
        setTimeout(() => {
            if (isIdleLike()) {
                import('./ai.js').then(ai => ai.morningGreeting()).catch(() => {});
            }
        }, 3000);
    }
}

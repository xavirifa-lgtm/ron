// core.js v24 - Estado Central
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
    conversation:      [],     // [{role:'user'|'assistant', content:'...'}]
    conversationOwner: null,   // usuario dueño del hilo actual (para resetear al cambiar de persona)

    spontaneousTimer: null,
    isCheeringUp:  false,
    isSilentMode:  false,
    companionMode:  false,   // true cuando está viendo/jugando contigo
    companionTopic: '',      // qué están viendo/jugando
    unknownStabilityCounter: 0,
    emotionCooldownUntil: 0,
    lastSpontaneousTime:  0,
    lastProactiveTime:    0,   // coordina espontáneo + curiosidad para que no se pisen
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
        resetSpontaneousTimer();
        checkMorningGreeting();
    } else {
        if (idleListenTimer) { clearTimeout(idleListenTimer); idleListenTimer = null; }
        if (RonState.spontaneousTimer) clearTimeout(RonState.spontaneousTimer);
    }
}

// ¿Puede Ron iniciar algo ahora? Presente + tranquilo + no de noche + sin pisar otro momento
export function canBeProactive() {
    if (RonState.activityState !== 'IDLE' || RonState.isSilentMode) return false;
    if (!RonState.currentUser) return false;
    if ((RonState.framesWithoutFace || 0) > 12) return false;   // solo si te ve (o no hay cámara → 0)
    const hour = new Date().getHours();
    if (hour >= 21 || hour < 7) return false;
    if (Date.now() - (RonState.lastProactiveTime || 0) < 90000) return false; // no dos seguidos
    return true;
}
export function markProactive() { RonState.lastProactiveTime = Date.now(); }

// Construye una iniciativa PERSONALIZADA (sobre ella), no genérica
function buildProactivePrompt() {
    const name  = RonState.currentUser || 'tu amiga';
    const u     = RonState.userStats[RonState.currentUser] || {};
    const likes = u.likes || [];
    const opts  = [];
    if (likes.length) {
        const like = likes[Math.floor(Math.random() * likes.length)];
        opts.push(`Pregúntale con MUCHA ilusión a ${name} por ${like} (algo que le encanta). Una pregunta concreta y curiosa, de amigo interesado.`);
    }
    opts.push(`Pregúntale a ${name} qué tal su día, a qué ha jugado o cómo se siente. Interés de verdad, cortito.`);
    opts.push(`Propón con entusiasmo hacer algo juntos: un juego, un cuento o adivinar algo. Una frase.`);
    opts.push(`Comparte una duda graciosa de robot sobre los humanos y pregúntale su opinión a ${name}.`);
    if ((u.history || []).length) {
        const last = u.history[u.history.length - 1];
        opts.push(`Antes ${name} te contó esto: "${last}". Retómalo con una pregunta de seguimiento, como haría un amigo que se acuerda.`);
    }
    return opts[Math.floor(Math.random() * opts.length)];
}

export function resetSpontaneousTimer() {
    if (RonState.spontaneousTimer) clearTimeout(RonState.spontaneousTimer);
    const delay = 240000 + Math.random() * 300000; // 4–9 min (interacción viva pero no agobiante)
    RonState.spontaneousTimer = setTimeout(async () => {
        try {
            if (!canBeProactive()) return;
            // A veces recuerda una aventura del diario en vez de preguntar
            if (Math.random() < 0.3) {
                const { ronRemembersSomething } = await import('./diary.js');
                const remembered = await ronRemembersSomething().catch(() => false);
                if (remembered) { markProactive(); return; }
            }
            markProactive();
            const prompt = buildProactivePrompt();
            import('./ai.js').then(ai => ai.triggerSpontaneous(prompt)).catch(() => {});
        } catch (e) {
            console.error('[Ron] Error espontáneo:', e);
        }
    }, delay);
}

function checkMorningGreeting() {
    const today = new Date().toDateString();
    const lastGreeting = localStorage.getItem('ron_last_morning') || '';
    const hour = new Date().getHours();
    if (hour >= 7 && hour < 11 && lastGreeting !== today && RonState.currentUser) {
        localStorage.setItem('ron_last_morning', today); // guardar YA para evitar doble saludo si IDLE se repite rápido
        setTimeout(() => {
            if (RonState.activityState === 'IDLE') {
                import('./ai.js').then(ai => ai.morningGreeting()).catch(() => {});
            }
        }, 3000);
    }
}

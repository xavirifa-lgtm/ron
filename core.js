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

    spontaneousTimer: null,
    isCheeringUp:  false,
    isSilentMode:  false,
    companionMode:  false,   // true cuando está viendo/jugando contigo
    companionTopic: '',      // qué están viendo/jugando
    unknownStabilityCounter: 0,
    emotionCooldownUntil: 0,
    lastSpontaneousTime:  0,
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

export function resetSpontaneousTimer() {
    if (RonState.spontaneousTimer) clearTimeout(RonState.spontaneousTimer);
    const delay = 480000 + Math.random() * 600000;
    RonState.spontaneousTimer = setTimeout(async () => {
        try {
            if (RonState.activityState !== 'IDLE') return;
            if (Math.random() < 0.3) {
                const { ronRemembersSomething } = await import('./diary.js');
                const remembered = await ronRemembersSomething().catch(() => false);
                if (remembered) return;
            }
            import('./ai.js').then(ai => ai.triggerSpontaneous(
                "Llevamos un rato callados. Inicia una conversación corta y divertida o propón un juego."
            )).catch(() => {});
        } catch(e) {
            console.error('[Ron] Error espontáneo:', e);
        }
    }, delay);
}

function checkMorningGreeting() {
    const today = new Date().toDateString();
    const lastGreeting = localStorage.getItem('ron_last_morning') || '';
    const hour = new Date().getHours();
    if (hour >= 7 && hour < 11 && lastGreeting !== today && RonState.currentUser) {
        setTimeout(() => {
            if (RonState.activityState === 'IDLE') {
                // Guardamos la fecha solo cuando realmente vamos a saludar
                localStorage.setItem('ron_last_morning', today);
                import('./ai.js').then(ai => ai.morningGreeting()).catch(() => {});
            }
        }, 3000);
    }
}

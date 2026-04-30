// core.js - Estado Central y Funciones Base
export const RonState = {
    activityState: 'BOOTING', 
    expressionState: 'neutral', 
    isMicEnabled: true,
    isLearningFace: false,
    isWaitingForWakeWord: true,
    
    // ESTADO BLE
    ble: {
        device: null,
        characteristic: null,
        isConnected: false,
        lastPan: 90,
        lastTilt: 90
    },
    
    wakeLock: null,
    isRecognitionActive: false,
    
    // MEMORIA A LARGO PLAZO
    currentUser: null,
    currentEmotion: 'neutral',
    lastEmotion: 'neutral',
    knownFaces: JSON.parse(localStorage.getItem('ron_known_faces') || '[]'),
    userStats: JSON.parse(localStorage.getItem('ron_user_stats') || '{}'),
    apiKey: localStorage.getItem('ron_groq_key'),

    // INICIATIVA
    spontaneousTimer: null,
    isCheeringUp: false,
    isSilentMode: false,        // Modo silencio: Ron escucha pero no habla
    unknownStabilityCounter: 0, // Contador de frames sin reconocer cara conocida
    emotionCooldownUntil: 0,    // Timestamp: no habla de emociones hasta este momento
    lastSpontaneousTime: 0,     // Timestamp: cuándo fue la última charla espontánea

    // DOM Refs (Cargadas en app.js)
    ui: {}
};

export function log(msg) {
    console.log(msg);
    if (!RonState.ui.fixedLog) RonState.ui.fixedLog = document.getElementById('debug-info');
    if (RonState.ui.fixedLog) {
        const div = document.createElement('div');
        div.style.marginBottom = "5px";
        div.innerText = `> ${msg}`;
        RonState.ui.fixedLog.appendChild(div);
        RonState.ui.fixedLog.scrollTop = RonState.ui.fixedLog.scrollHeight;
        if (RonState.ui.fixedLog.children.length > 50) RonState.ui.fixedLog.children[0].remove();
    }
}

export function changeState(newState) {
    if (RonState.activityState === newState) return;
    RonState.activityState = newState;
    
    // Notificamos a UI para cambiar colores si hace falta
    import('./ui.js').then(ui => ui.handleStateChange(newState));
    
    // Reiniciar escucha si volvemos a IDLE
    if (newState === 'IDLE' && RonState.isMicEnabled) {
        import('./speech.js').then(speech => {
            setTimeout(() => speech.startListening(), 1000);
        });
        resetSpontaneousTimer();
    } else {
        if (RonState.spontaneousTimer) clearTimeout(RonState.spontaneousTimer);
    }
}

export function resetSpontaneousTimer() {
    if (RonState.spontaneousTimer) clearTimeout(RonState.spontaneousTimer);
    RonState.spontaneousTimer = setTimeout(() => {
        if (RonState.activityState === 'IDLE') {
            import('./ai.js').then(ai => ai.triggerSpontaneous("Llevamos mucho rato callados. Inicia una conversación corta saludando o preguntando si quiere jugar a algo."));
        }
    }, 600000 + Math.random() * 600000); // Entre 10 y 20 minutos (menos insistente)
}

import { RonState, log, changeState, markProactive, isIdleLike } from './core.js';
import { setExpression, showMoodBubble, celebrateFaceRecognition } from './ui.js';
import { speak } from './speech.js';
import { updateSadnessTracking } from './defender.js';

export async function loadModels() {
    const URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
    await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(URL),
        faceapi.nets.faceExpressionNet.loadFromUri(URL)
    ]);
    log("Modelos de visión cargados.");
}

export async function startCamera() {
    let stream;
    try {
        // Forzar cámara FRONTAL (exact) — para selfies y para reconocerte a ti, no lo de detrás
        stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { exact: "user" }, width: { ideal: 1280 }, height: { ideal: 720 } }
        });
    } catch (e) {
        log("Frontal exacta no disponible, usando cámara genérica: " + e.message);
        stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }
        });
    }
    const v = RonState.ui.video;
    v.srcObject = stream;
    // BUG FIX v26: antes se esperaba 'loadedmetadata' DESPUÉS de play(), cuando ese
    // evento ya había ocurrido → la promesa no se resolvía nunca y el bucle de
    // reconocimiento facial no llegaba a arrancar. Ahora se espera antes, y solo si hace falta.
    if (v.readyState < 1) {
        await new Promise(res => v.addEventListener('loadedmetadata', res, { once: true }));
    }
    await v.play();
}

// ── Parámetros de reconocimiento ─────────────────────────────────────────────
// Distancia euclídea de face-api: menor = más parecido.
const MATCH_MAX     = 0.58;   // por debajo: es esa persona
const UNKNOWN_MIN   = 0.64;   // por encima: es alguien desconocido
const SAMPLE_MAX    = 0.42;   // solo coincidencias MUY seguras añaden muestras
const VOTE_WINDOW   = 6;      // frames (~5 s) para decidir identidad
const GREET_AFTER_MS = 120000;// saludar si no la veía desde hace 2 min

let lastCalloutTime = 0;
let calloutCount    = 0;
const votes = [];             // últimas decisiones: nombre | '?' (desconocido) | '~' (dudoso)
let lastPersistSeen = 0;
let lastReactedEmotion = 'neutral';
const emotionCooldown = {};   // emoción → timestamp hasta el que no se repite

function largestFace(detections) {
    return detections.reduce((a, b) =>
        (b.detection.box.width * b.detection.box.height) > (a.detection.box.width * a.detection.box.height) ? b : a);
}

function vote(v) {
    votes.push(v);
    if (votes.length > VOTE_WINDOW) votes.shift();
    const counts = {};
    votes.forEach(x => counts[x] = (counts[x] || 0) + 1);
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (!top) return null;
    if (top[0] === '?' && top[1] >= 5) return '?';
    if (!['?', '~', '-'].includes(top[0]) && top[1] >= 3) return top[0];
    return null;   // aún no hay decisión estable
}

function lastSeenOf(name) {
    const mem = RonState.userLastSeen?.[name];
    if (mem) return mem;
    const saved = RonState.userStats?.[name]?.lastSeenTs;
    return saved || 0;
}

function markSeen(name, now) {
    RonState.userLastSeen = RonState.userLastSeen || {};
    RonState.userLastSeen[name] = now;
    if (now - lastPersistSeen > 30000 && RonState.userStats[name]) {
        RonState.userStats[name].lastSeenTs = now;
        localStorage.setItem('ron_user_stats', JSON.stringify(RonState.userStats));
        lastPersistSeen = now;
    }
}

export function startVisionLoop() {
    let processing = false;
    setInterval(async () => {
        if (processing) return;
        processing = true;
        try {
            const detections = await faceapi
                .detectAllFaces(RonState.ui.video, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.40 }))
                .withFaceLandmarks()
                .withFaceExpressions()
                .withFaceDescriptors();

            if (RonState.activityState === 'NIGHT') return;   // dormido: no saluda ni pregunta
            const now  = Date.now();
            const d    = detections.length ? largestFace(detections) : null;   // la persona más cercana
            const vw   = RonState.ui.video.videoWidth || 640;
            const id   = await import('./identity.js');

            if (d) updateEmotion(d);
            updateSadnessTracking(RonState.currentEmotion, !!d);

            // Aprendizaje de nombre en curso: recoger muestras de ESA cara y vigilar caducidad
            if (RonState.nameFlow) {
                if (id.nameFlowExpired()) { log("Aprendizaje de nombre caducado."); id.cancelNameFlow(true); }
                else if (RonState.isLearningFace && d) {
                    const first = RonState.learningDescriptors?.[0];
                    const same  = !first || faceapi.euclideanDistance(d.descriptor, new Float32Array(first)) < 0.6;
                    if (same && RonState.learningDescriptors.length < 12) RonState.learningDescriptors.push(Array.from(d.descriptor));
                }
                return;
            }

            // Escondite
            if (RonState.activityState === 'HIDE_SEEK_SEARCH') {
                if (d) { changeState('IDLE'); setExpression('star'); speak("¡TE PILLÉ! ¡Bip bip! ¡Eres increíble escondiéndote!"); }
                return;
            }

            if (!d) { handleNoFace(); return; }

            // Despertar: NO saludar genérico; el saludo por nombre llega al reconocerla
            if (RonState.activityState === 'SLEEPING') {
                changeState('IDLE');
                setExpression('happy');
                RonState.lastEmotion = 'neutral';
                if (!RonState.knownFaces.length) speak("¡Bip! ¡Uy, me había quedado frito!");
            }

            RonState.framesWithoutFace = 0;
            calloutCount = 0;
            RonState.lastDescriptor = Array.from(d.descriptor);
            trackFace(d);
            import('./follow.js').then(f => f.updateFollow(d.detection.box, vw, RonState.ui.video.videoHeight)).catch(() => {});

            // ── Reconocimiento con votación (evita confundir por un frame malo) ──
            const best = id.matchFace(d.descriptor);
            let v = '?';
            if (best && best.distance < MATCH_MAX) v = best.label;
            else if (best && best.distance < UNKNOWN_MIN) v = '~';
            const stable = vote(v);
            if (best) log(`Cara: ${best.label} d=${best.distance.toFixed(3)} → ${stable || '…'}`);

            // Muestras extra solo con coincidencia MUY segura (no contamina con otras personas)
            if (best && best.distance < SAMPLE_MAX && Math.random() < 0.15) id.addSamples(best.label, [Array.from(d.descriptor)]);

            const busy = ['THINKING','SPEAKING','HIDE_SEEK','MATH_GAME','READING_GAME','STORY'].includes(RonState.activityState);

            if (stable && stable !== '?') {
                const name = stable;
                const absentLong = now - lastSeenOf(name) > GREET_AFTER_MS;
                const changed = RonState.currentUser !== name;
                if (changed) { RonState.currentUser = name; }
                if ((changed || absentLong) && !busy && !RonState.isSilentMode) {
                    markSeen(name, now);
                    markProactive();
                    celebrateFaceRecognition();
                    import('./ai.js').then(ai => ai.greetKnown(name, absentLong)).catch(() => {});
                } else {
                    markSeen(name, now);
                }
                if (!busy) maybeReactToEmotion(name, now);
            } else if (stable === '?') {
                // Persona desconocida y cerca → preguntar su nombre (con enfriamiento)
                const bigEnough = d.detection.box.width / vw > 0.12;
                if (!busy && bigEnough && !RonState.isSilentMode && now > (RonState.learnCooldownUntil || 0)) {
                    RonState.currentUser = null;
                    votes.length = 0;
                    id.startLearning(Array.from(d.descriptor));
                }
            }
        } catch (e) { console.error("Error visión:", e); }
        finally { processing = false; }
    }, 800);
}

function handleNoFace() {
    import('./follow.js').then(f => f.faceLost()).catch(() => {});
    votes.push('-'); if (votes.length > VOTE_WINDOW) votes.shift();
    if (!isIdleLike()) return;
    RonState.framesWithoutFace = (RonState.framesWithoutFace || 0) + 1;
    const f       = RonState.framesWithoutFace;
    const hour    = new Date().getHours();
    const isNight = hour >= 21 || hour < 7;
    const canCall = RonState.currentUser && !RonState.isSilentMode && !isNight;
    if (canCall && (Date.now() - lastCalloutTime > 25000)) {
        if (calloutCount === 0 && f >= 45)      { calloutCount = 1; lastCalloutTime = Date.now(); callOutToUser(RonState.currentUser); }
        else if (calloutCount === 1 && f >= 110) { calloutCount = 2; lastCalloutTime = Date.now(); callOutToUser(RonState.currentUser); }
    }
    if (f > 188) { changeState('SLEEPING'); setExpression('flat'); log("Ron dormido."); }
}

// Emoción estable + nadie hablando hace un rato → Ron pregunta (vía IA, con contexto)
const EMO_COOLDOWN = { feliz: 360000, triste: 180000, enfadado: 180000, miedo: 180000, sorprendido: 120000 };
function maybeReactToEmotion(name, now) {
    const emo = RonState.currentEmotion;
    if (emo === 'neutral') { lastReactedEmotion = 'neutral'; return; }
    if (emo === lastReactedEmotion) return;
    if (RonState.isSilentMode || !isIdleLike()) return;
    if (now - (RonState.lastInteractionTs || 0) < 6000) return;  // está hablando: las caras al hablar engañan
    if (now < (emotionCooldown[emo] || 0)) return;
    lastReactedEmotion = emo;
    emotionCooldown[emo] = now + (EMO_COOLDOWN[emo] || 180000);
    markProactive();
    showMoodBubble(emo);
    import('./ai.js').then(ai => ai.emotionCheckIn(name, emo)).catch(() => {});
}

// ── Emoción de la cara (suavizada) ───────────────────────────────────────────
const emotionBuffer = [];
const EMOTION_MIN_CONFIDENCE = 0.38;
function updateEmotion(detection) {
    const exp = detection.expressions;
    let maxE = 'neutral', maxS = 0;
    for (const [e, sc] of Object.entries(exp)) { if (sc > maxS) { maxS = sc; maxE = e; } }
    const dict = { happy:'feliz', sad:'triste', angry:'enfadado', surprised:'sorprendido', fearful:'miedo', neutral:'neutral', disgusted:'neutral' };
    let emotion = dict[maxE] || 'neutral';
    // Las negativas exigen más confianza: una cara concentrada se lee como triste/enfadada
    const minConf = { triste: 0.55, enfadado: 0.55, miedo: 0.55, feliz: 0.40, sorprendido: 0.45 };
    if (emotion !== 'neutral' && maxS < (minConf[emotion] ?? EMOTION_MIN_CONFIDENCE)) emotion = 'neutral';
    // Suavizado: últimos 5 frames (~4 s); una emoción solo cuenta si aparece en 3+
    emotionBuffer.push(emotion);
    if (emotionBuffer.length > 5) emotionBuffer.shift();
    const counts = {};
    emotionBuffer.forEach(e => counts[e] = (counts[e] || 0) + 1);
    const [dominant, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    RonState.currentEmotion = (n >= 3) ? dominant : 'neutral';
}

// Ron la echa de menos y la llama por su nombre (comportamiento de la peli)
async function callOutToUser(name) {
    if (!isIdleLike() || RonState.isSilentMode) return;
    markProactive();
    setExpression('thinking');
    const calls = [
        `¡Bip! ¿${name}? ¿Dónde te has metido? Mis sensores no te encuentran.`,
        `¿${name}? ¡Vuelve! Mis circuitos te echan de menos.`,
        `¡Bip bop! ${name}, ¿sigues ahí? ¡Tengo cosas curiosas que contarte!`,
        `¿${name}? ¡Ping! ¡No me dejes solo con mis pensamientos raros de robot!`
    ];
    await speak(calls[Math.floor(Math.random() * calls.length)]);
}

export function captureOptimizedFrame() {
    // Guard: si la cámara no está disponible, devolver null
    if (!RonState.ui.video || !RonState.ui.video.videoWidth) return null;
    const MAX = 1280;
    const canvas = document.createElement('canvas');
    let w = RonState.ui.video.videoWidth  || 640;
    let h = RonState.ui.video.videoHeight || 480;
    if (w > h) { if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; } }
    else        { if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; } }
    canvas.width  = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(RonState.ui.video, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', 0.92);
}

export async function connectBLE() {
    try {
        log("Buscando B*Bot ESP32...");
        RonState.ble.device = await navigator.bluetooth.requestDevice({
            filters: [{ namePrefix: 'Ron' }, { namePrefix: 'B-Bot' }],
            optionalServices: ['0000ffe0-0000-1000-8000-00805f9b34fb']
        });
        const server    = await RonState.ble.device.gatt.connect();
        const service   = await server.getPrimaryService('0000ffe0-0000-1000-8000-00805f9b34fb');
        RonState.ble.characteristic = await service.getCharacteristic('0000ffe1-0000-1000-8000-00805f9b34fb');
        RonState.ble.isConnected    = true;
        RonState.ui.bleBtn.classList.add('active');
        speak("¡Bip! ¡Conexión de motores establecida!");
        log("BLE conectado.");
    } catch (e) { log(`Error BLE: ${e.message}`); }
}

export async function sendMove(cmd) {
    if (!RonState.ble.isConnected || !RonState.ble.characteristic) return;
    try {
        await RonState.ble.characteristic.writeValue(new TextEncoder().encode(cmd));
    } catch (e) {
        log("BLE desconectado: " + e.message);
        RonState.ble.isConnected = false;
        import('./ui.js').then(ui => ui.setChestIcon('warning'));
    }
}

// Envía velocidades de motor al ESP-32 para el modo seguir: M<izq>,<der>
export function sendDrive(left, right) {
    const l = Math.max(-255, Math.min(255, Math.round(left  || 0)));
    const r = Math.max(-255, Math.min(255, Math.round(right || 0)));
    sendMove(`M${l},${r}\n`);
}

function trackFace(detection) {
    const box  = detection.detection.box;
    const errX = ((box.x + box.width  / 2) / RonState.ui.video.videoWidth)  - 0.5;
    const errY = ((box.y + box.height / 2) / RonState.ui.video.videoHeight) - 0.5;
    import('./ui.js').then(ui => ui.shiftEyes(errX, errY));
    if (!RonState.ble.isConnected) return;
    if (Math.abs(errX) > 0.1) {
        RonState.ble.lastPan = Math.max(0, Math.min(180, RonState.ble.lastPan - errX * 20));
        sendMove(`P${Math.round(RonState.ble.lastPan)}\n`);
    }
    if (Math.abs(errY) > 0.1) {
        RonState.ble.lastTilt = Math.max(0, Math.min(180, RonState.ble.lastTilt + errY * 20));
        sendMove(`T${Math.round(RonState.ble.lastTilt)}\n`);
    }
}

// Movimiento autónomo BLE
setInterval(() => {
    if (isIdleLike() && RonState.ble.isConnected) {
        const pan  = Math.floor(Math.random() * 60) + 60;
        const tilt = Math.floor(Math.random() * 40) + 70;
        sendMove(`P${pan}\n`);
        setTimeout(() => sendMove(`T${tilt}\n`), 400);
    }
}, 30000);

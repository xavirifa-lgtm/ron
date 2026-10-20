// vision.js v28.4 — Reconocimiento Multi-Persona, Buffer Continuo de Caras,
// Espejo de Expresiones en Vivo, Reacción "Peekaboo" y Cola BLE Protegida.

import { RonState, log, changeState, markProactive, isIdleLike } from './core.js';
import { setExpression, showMoodBubble, celebrateFaceRecognition } from './ui.js';
import { speak } from './speech.js';
import { updateSadnessTracking } from './defender.js';
import * as Sounds from './sounds.js';

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
    if (v.readyState < 1) {
        await new Promise(res => v.addEventListener('loadedmetadata', res, { once: true }));
    }
    await v.play();
}

const MATCH_MAX      = 0.58;
const UNKNOWN_MIN    = 0.64;
const SAMPLE_MAX     = 0.40;
const VOTE_WINDOW    = 5;
const GREET_AFTER_MS = 120000;

let lastCalloutTime = 0;
let calloutCount    = 0;
const votes = [];
let lastPersistSeen = 0;
let lastReactedEmotion = 'neutral';
const emotionCooldown = {};
let continuousFaceMs = 0;
let lastNagTime = 0;
let lastGroupGreetMs = 0;
let lastPeekabooMs = 0;
let lastMirrorMs = 0;
let prevFaceRatio = 0;

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
    if (top[0] === '?' && top[1] >= 4) return '?';
    if (!['?', '~', '-'].includes(top[0]) && top[1] >= 3) return top[0];
    return null;
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
        try { localStorage.setItem('ron_user_stats', JSON.stringify(RonState.userStats)); } catch (e) {}
        import('./identity.js').then(id => id.vaultSet && id.vaultSet('ron_user_stats', RonState.userStats)).catch(() => {});
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

            if (RonState.activityState === 'NIGHT') return;
            const now  = Date.now();
            const d    = detections.length ? largestFace(detections) : null;
            const vw   = RonState.ui.video.videoWidth || 640;
            const id   = await import('./identity.js');

            if (d) {
                updateEmotion(d);
                continuousFaceMs += 800;
                if (continuousFaceMs > 35 * 60000 && (now - lastNagTime > 20 * 60000) && isIdleLike()) {
                    lastNagTime = now;
                    nagToMove();
                }
            } else {
                continuousFaceMs = 0;
                prevFaceRatio = 0;
            }

            updateSadnessTracking(RonState.currentEmotion, !!d);

            if (RonState.nameFlow) {
                if (id.nameFlowExpired()) { log("Aprendizaje de nombre caducado."); id.cancelNameFlow(true); }
                else if (RonState.isLearningFace && d) {
                    const first = RonState.learningDescriptors?.[0];
                    const same  = !first || faceapi.euclideanDistance(d.descriptor, new Float32Array(first)) < 0.6;
                    if (same && RonState.learningDescriptors.length < 12) RonState.learningDescriptors.push(Array.from(d.descriptor));
                }
                return;
            }

            if (RonState.activityState === 'HIDE_SEEK_SEARCH') {
                if (d) { changeState('IDLE'); setExpression('star'); speak("¡TE PILLÉ! ¡Bip bip! ¡Eres increíble escondiéndote!"); }
                return;
            }

            if (!d) { handleNoFace(); return; }

            if (RonState.activityState === 'SLEEPING') {
                changeState('IDLE');
                setExpression('happy');
                RonState.lastEmotion = 'neutral';
                if (!RonState.knownFaces.length) speak("¡Bip! ¡Uy, me había quedado frito!");
            }

            RonState.framesWithoutFace = 0;
            RonState.faceSeenTs = now;
            calloutCount = 0;
            const curDesc = Array.from(d.descriptor);
            RonState.lastDescriptor = curDesc;

            trackFace(d);
            import('./follow.js').then(f => f.updateFollow(d.detection.box, vw, RonState.ui.video.videoHeight)).catch(() => {});

            const busy = ['THINKING','SPEAKING','LISTENING','HIDE_SEEK','MATH_GAME','READING_GAME','STORY','CHALLENGE'].includes(RonState.activityState)
                || now - (RonState.lastHeardTs || 0) < 5000;

            const curRatio = d.detection.box.width / vw;
            if (!busy && isIdleLike() && !RonState.isSilentMode && prevFaceRatio > 0.12 && curRatio > 0.44 && (curRatio - prevFaceRatio > 0.14) && (now - lastPeekabooMs > 90000)) {
                lastPeekabooMs = now;
                markProactive();
                setExpression('surprise');
                Sounds.playBeep(1200, 'sine', 0.08, 0.08);
                sendMove('T70\n');
                const who = RonState.currentUser || 'humana';
                speak(`¡Uy, qué susto, ${who}! ¡Estás tan cerca que te veo hasta las pestañas! ¡Bip!`);
                prevFaceRatio = curRatio;
                return;
            }
            prevFaceRatio = curRatio;

            if (detections.length >= 2 && !busy && isIdleLike() && !RonState.isSilentMode && (now - lastGroupGreetMs > 240000)) {
                const knownPresent = [];
                let unknownCount = 0;
                for (const det of detections) {
                    const m = id.matchFace(det.descriptor);
                    if (m && m.distance < MATCH_MAX) {
                        if (!knownPresent.includes(m.label)) knownPresent.push(m.label);
                    } else if (!m || m.distance >= UNKNOWN_MIN) {
                        unknownCount++;
                    }
                }
                if (knownPresent.length >= 2) {
                    lastGroupGreetMs = now;
                    markProactive();
                    setExpression('star');
                    Sounds.playFaceRecognitionSound();
                    speak(`¡Bip bip! ¡Mis sensores ven a ${knownPresent.slice(0, 2).join(' y a ')} juntos! ¡El equipo al completo!`);
                    return;
                } else if (knownPresent.length === 1 && unknownCount >= 1 && (now > (RonState.learnCooldownUntil || 0))) {
                    lastGroupGreetMs = now;
                    markProactive();
                    setExpression('happy');
                    speak(`¡Bip! ¡Hola ${knownPresent[0]}! Veo que tienes compañía. ¿Cómo se llama la persona que está contigo?`);
                    return;
                }
            }

            const best = id.matchFace(d.descriptor);
            let v = '?';
            if (best && best.distance < MATCH_MAX) v = best.label;
            else if (best && best.distance < UNKNOWN_MIN) v = '~';
            const stable = vote(v);
            if (best) log(`Cara: ${best.label} d=${best.distance.toFixed(3)} → ${stable || '…'}`);

            if (v === '?') {
                if (!Array.isArray(RonState.recentUnknownDescriptors)) RonState.recentUnknownDescriptors = [];
                RonState.recentUnknownDescriptors.push(curDesc);
                if (RonState.recentUnknownDescriptors.length > 10) RonState.recentUnknownDescriptors.shift();
            }

            if (best && best.distance < SAMPLE_MAX && Math.random() < 0.15) id.addSamples(best.label, [curDesc]);

            if (stable && stable !== '?') {
                const name = stable;
                const absentLong = now - lastSeenOf(name) > GREET_AFTER_MS;
                const changed = RonState.currentUser !== name;
                if (changed) { RonState.currentUser = name; }
                if ((changed || absentLong) && !busy && !RonState.isSilentMode) {
                    markSeen(name, now);
                    markProactive();
                    celebrateFaceRecognition();
                    Sounds.playFaceRecognitionSound();
                    import('./ai.js').then(ai => ai.greetKnown(name, absentLong)).catch(() => {});
                } else {
                    markSeen(name, now);
                }
                if (!busy) {
                    if (d.expressions?.surprised > 0.78 && (now - lastMirrorMs > 60000) && isIdleLike()) {
                        lastMirrorMs = now;
                        setExpression('surprise');
                        Sounds.playBeep(980, 'sine', 0.07, 0.06);
                    }
                    maybeReactToEmotion(name, now);
                }
            } else if (stable === '?') {
                const bigEnough = curRatio > 0.12;
                if (!busy && bigEnough && !RonState.isSilentMode && now > (RonState.learnCooldownUntil || 0)) {
                    RonState.currentUser = null;
                    votes.length = 0;
                    id.startLearning(curDesc);
                }
            }
        } catch (e) { console.error("Error visión:", e); }
        finally { processing = false; }
    }, 800);
}

function nagToMove() {
    const name = RonState.currentUser || 'amiga';
    setExpression('thinking');
    const nags = [
        `¡Bip! ${name}, ¡llevas mucho rato quieta! Mis sensores exigen que te levantes a dar tres saltos.`,
        `¡Alerta de sofá! ${name}, ¡o te mueves un poco o mis circuitos se oxidan de verte quieta!`,
        `¡Bop! Mis cálculos dicen que toca estirar las piernas. ¿Hacemos una carrera rápida hasta la puerta?`
    ];
    speak(nags[Math.floor(Math.random() * nags.length)]);
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
    if (f === 140) {
        setExpression('flat');
        sendMove('T115\n');
    }
    if (f > 188) { changeState('SLEEPING'); setExpression('flat'); log("Ron dormido."); }
}

const EMO_COOLDOWN = { feliz: 360000, triste: 180000, enfadado: 180000, miedo: 180000, sorprendido: 120000 };
function maybeReactToEmotion(name, now) {
    const emo = RonState.currentEmotion;
    if (emo === 'neutral') { lastReactedEmotion = 'neutral'; return; }
    if (emo === lastReactedEmotion) return;
    if (RonState.isSilentMode || !isIdleLike()) return;
    if (now - (RonState.lastInteractionTs || 0) < 6000) return;
    if (now < (emotionCooldown[emo] || 0)) return;
    lastReactedEmotion = emo;
    emotionCooldown[emo] = now + (EMO_COOLDOWN[emo] || 180000);
    markProactive();
    showMoodBubble(emo);
    import('./ai.js').then(ai => ai.emotionCheckIn(name, emo)).catch(() => {});
}

const emotionBuffer = [];
const EMOTION_MIN_CONFIDENCE = 0.38;
function updateEmotion(detection) {
    const exp = detection.expressions;
    let maxE = 'neutral', maxS = 0;
    for (const [e, sc] of Object.entries(exp)) { if (sc > maxS) { maxS = sc; maxE = e; } }
    const dict = { happy:'feliz', sad:'triste', angry:'enfadado', surprised:'sorprendido', fearful:'miedo', neutral:'neutral', disgusted:'neutral' };
    let emotion = dict[maxE] || 'neutral';
    const minConf = { triste: 0.55, enfadado: 0.55, miedo: 0.55, feliz: 0.40, sorprendido: 0.45 };
    if (emotion !== 'neutral' && maxS < (minConf[emotion] ?? EMOTION_MIN_CONFIDENCE)) emotion = 'neutral';
    emotionBuffer.push(emotion);
    if (emotionBuffer.length > 5) emotionBuffer.shift();
    const counts = {};
    emotionBuffer.forEach(e => counts[e] = (counts[e] || 0) + 1);
    const [dominant, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    RonState.currentEmotion = (n >= 3) ? dominant : 'neutral';
}

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

export function captureOptimizedFrame(MAX = 1280, quality = 0.92) {
    const vid = RonState.ui.video;
    if (!vid || !vid.videoWidth || vid.readyState < 2) return null;
    const tr = vid.srcObject && vid.srcObject.getVideoTracks && vid.srcObject.getVideoTracks()[0];
    if (tr && tr.readyState === 'ended') return null;
    const canvas = document.createElement('canvas');
    let w = RonState.ui.video.videoWidth  || 640;
    let h = RonState.ui.video.videoHeight || 480;
    if (w > h) { if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; } }
    else        { if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; } }
    canvas.width  = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(RonState.ui.video, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', quality);
}

export async function restartCamera() {
    const vid = RonState.ui.video;
    try { vid && vid.srcObject && vid.srcObject.getTracks().forEach(t => t.stop()); } catch (e) {}
    log('Cámara: reabriendo…');
    await startCamera();
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

let bleBusy = false;
let bleQueue = [];

export async function sendMove(cmd) {
    if (!RonState.ble.isConnected || !RonState.ble.characteristic) return;
    bleQueue.push(cmd);
    if (bleQueue.length > 5) bleQueue.shift();
    if (bleBusy) return;
    bleBusy = true;
    while (bleQueue.length > 0 && RonState.ble.isConnected) {
        const nextCmd = bleQueue.shift();
        try {
            const data = new TextEncoder().encode(nextCmd);
            if (RonState.ble.characteristic.writeValueWithoutResponse) {
                await RonState.ble.characteristic.writeValueWithoutResponse(data);
            } else {
                await RonState.ble.characteristic.writeValue(data);
            }
        } catch (e) {
            if (!/in progress/i.test(e.message)) {
                log("BLE desconectado: " + e.message);
                RonState.ble.isConnected = false;
                import('./ui.js').then(ui => ui.setChestIcon('warning'));
            }
        }
    }
    bleBusy = false;
}

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
    
    import('./follow.js').then(f => {
        if (!f.isFollowing() && Math.abs(errX) > 0.1) {
            RonState.ble.lastPan = Math.max(0, Math.min(180, RonState.ble.lastPan - errX * 20));
            sendMove(`P${Math.round(RonState.ble.lastPan)}\n`);
        }
    }).catch(() => {});

    if (Math.abs(errY) > 0.1) {
        RonState.ble.lastTilt = Math.max(0, Math.min(180, RonState.ble.lastTilt + errY * 20));
        sendMove(`T${Math.round(RonState.ble.lastTilt)}\n`);
    }
}

setInterval(() => {
    if (isIdleLike() && RonState.ble.isConnected) {
        const pan  = Math.floor(Math.random() * 60) + 60;
        const tilt = Math.floor(Math.random() * 40) + 70;
        sendMove(`P${pan}\n`);
        setTimeout(() => sendMove(`T${tilt}\n`), 400);
    }
}, 30000);
// vision.js v29 — Calidad de imagen para reconocer mejor:
//  · cámara a 1280×720 (más píxeles en la cara cuando está lejos)
//  · exposición medida en la cara si la cámara lo admite (contraluz)
//  · luz corregida según la cara (no un filtro fijo a toda la imagen)
//  · solo fotogramas buenos (tamaño, nitidez, de frente, ojos abiertos, luz) votan,
//    aprenden y se promedian (3-4 fotogramas → menos ruido)
// + Multi-persona, peekaboo y cola BLE (Xavi, v28.5).

import { RonState, RonConfig, log, changeState, markProactive, isIdleLike } from './core.js';
import { setExpression, showMoodBubble, celebrateFaceRecognition } from './ui.js';
import { speak } from './speech.js';
import { updateSadnessTracking } from './defender.js';
import * as Sounds from './sounds.js';
import { assess, DescriptorAverager } from './facequality.js';

// Estado visible en el modo calibración de Ajustes
RonState.visionDebug = { camera: '-', exposure: 'sin comprobar', quality: null, distances: [], avgFrames: 0, updated: 0 };
const averager = new DescriptorAverager(4, 2500, 0.5);
let lastGoodAvg = null;          // último descriptor promediado de buena calidad (para "guardar muestra")
let lastFaceLum = null;          // luz de la cara en el último fotograma (para la corrección)

// Canvas intermedio para normalizar luz y contraste antes de pasar a face-api
let procCanvas = null;
let procCtx = null;

export async function loadModels() {
    const URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
    await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(URL),
        faceapi.nets.faceExpressionNet.loadFromUri(URL)
    ]);
    procCanvas = document.createElement('canvas');
    procCanvas.width = 1280;
    procCanvas.height = 720;
    procCtx = procCanvas.getContext('2d', { willReadFrequently: true });
    log("Modelos de visión y normalizador óptico cargados.");
}

export async function startCamera() {
    let stream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: { exact: "user" },
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 30 }
            }
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
    RonState.visionDebug.camera = `${v.videoWidth}×${v.videoHeight}`;
    setupExposure(stream.getVideoTracks()[0]);
}

// ── Exposición medida en la cara ──────────────────────────────────────────────
// Chrome en Android permite pedir a la cámara un "punto de interés" para medir la luz
// y una compensación de exposición. Depende de cada cámara: se comprueba y, si no lo
// admite, se usa solo la corrección por software.
let expo = { track: null, poi: false, comp: null, lastApply: 0, lastPoint: null, failures: 0, value: 0 };
function setupExposure(track) {
    expo = { track, poi: false, comp: null, lastApply: 0, lastPoint: null, failures: 0, value: 0 };
    let caps = {};
    try { caps = track?.getCapabilities?.() || {}; } catch (e) {}
    const supported = navigator.mediaDevices.getSupportedConstraints?.() || {};
    expo.poi = !!supported.pointsOfInterest && Array.isArray(caps.exposureMode) && caps.exposureMode.includes('continuous');
    if (caps.exposureCompensation && caps.exposureCompensation.max > caps.exposureCompensation.min) {
        expo.comp = caps.exposureCompensation;
        try { expo.value = track.getSettings().exposureCompensation ?? 0; } catch (e) {}
    }
    const parts = [];
    if (expo.poi) parts.push('medida en la cara');
    if (expo.comp) parts.push(`compensación ${expo.comp.min}…${expo.comp.max}`);
    RonState.visionDebug.exposure = parts.length ? parts.join(' + ') : 'la cámara no lo admite (solo corrección por software)';
    log(`Exposición: ${RonState.visionDebug.exposure}.`);
}

async function exposeForFace(box, vw, vh, lum) {
    const t = expo.track;
    if (!t || t.readyState !== 'live' || expo.failures >= 3) return;
    const now = Date.now();
    if (now - expo.lastApply < 1500) return;
    const adv = {};
    if (expo.poi) {
        const p = { x: Math.min(1, Math.max(0, (box.x + box.width / 2) / vw)), y: Math.min(1, Math.max(0, (box.y + box.height * 0.45) / vh)) };
        if (!expo.lastPoint || Math.hypot(p.x - expo.lastPoint.x, p.y - expo.lastPoint.y) > 0.06) {
            adv.exposureMode = 'continuous';
            adv.pointsOfInterest = [p];
            expo.lastPoint = p;
        }
    }
    if (expo.comp && lum != null) {
        const step = expo.comp.step || 0.33;
        let v = expo.value;
        if (lum < 0.32) v += step; else if (lum > 0.72) v -= step;
        v = Math.min(expo.comp.max, Math.max(expo.comp.min, v));
        if (v !== expo.value) { adv.exposureCompensation = v; expo.value = v; }
    }
    if (!Object.keys(adv).length) return;
    expo.lastApply = now;
    try { await t.applyConstraints({ advanced: [adv] }); expo.failures = 0; }
    catch (e) {
        expo.failures++;
        if (expo.failures >= 3) { RonState.visionDebug.exposure = `no se pudo ajustar (${e.name})`; log('Exposición: la cámara rechaza el ajuste; se desactiva.'); }
    }
}

// Umbrales calibrados para cámaras frontales móviles con luz de interior
const MATCH_MAX      = 0.62;  // más tolerante a cambios de luz y ángulo
const UNKNOWN_MIN    = 0.67;  // solo pregunta "¿cómo te llamas?" si de verdad no se parece a nadie
const SAMPLE_MAX     = 0.44;  // umbral para auto-aprender nuevas posturas de una cara conocida
const MIN_FACE_SCORE = 0.62;  // calidad mínima de detección para guardar muestras en memoria
const VOTE_WINDOW    = 4;     // ventana más ágil (~2.4 s) para reconocer rápido
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
    if (top[0] === '?' && top[1] >= 3) return '?';
    if (!['?', '~', '-'].includes(top[0]) && top[1] >= 2) return top[0]; // con 2 frames claros ya te reconoce
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

// Prepara el frame normalizando brillo y contraste para mejorar el descriptor facial
function getNormalizedInput() {
    const vid = RonState.ui.video;
    if (!vid || !vid.videoWidth || vid.readyState < 2) return null;
    if (!procCanvas) return vid;
    const vw = vid.videoWidth || 640;
    const vh = vid.videoHeight || 480;
    if (procCanvas.width !== vw || procCanvas.height !== vh) {
        procCanvas.width = vw;
        procCanvas.height = vh;
    }
    // Corrección según la luz de la CARA del fotograma anterior (no un filtro fijo):
    // cara oscura → más brillo; normal → imagen intacta. Si la cámara ya corrige
    // la exposición sobre la cara, el software apenas actúa.
    let f = 'none';
    if (lastFaceLum != null && lastFaceLum < 0.38) {
        const b = Math.min(1.7, 0.45 / Math.max(lastFaceLum, 0.12));
        f = `brightness(${b.toFixed(2)}) contrast(1.08)`;
    } else if (lastFaceLum != null && lastFaceLum > 0.8) {
        f = 'brightness(0.9)';
    }
    procCtx.filter = f;
    procCtx.drawImage(vid, 0, 0, vw, vh);
    procCtx.filter = 'none';
    return procCanvas;
}

export function startVisionLoop() {
    let processing = false;
    setInterval(async () => {
        if (processing) return;
        processing = true;
        try {
            const inputEl = getNormalizedInput();
            if (!inputEl) return;

            const detections = await faceapi
                .detectAllFaces(inputEl, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.35 }))
                .withFaceLandmarks()
                .withFaceExpressions()
                .withFaceDescriptors();

            if (RonState.activityState === 'NIGHT') return;
            const now  = Date.now();
            const d    = detections.length ? largestFace(detections) : null;
            const vw   = inputEl.width || RonState.ui.video.videoWidth || 640;
            const vh   = inputEl.height || RonState.ui.video.videoHeight || 480;
            const id   = await import('./identity.js');

            if (d) {
                updateEmotion(d);
                continuousFaceMs += 650;
                if (continuousFaceMs > 35 * 60000 && (now - lastNagTime > 20 * 60000) && isIdleLike()) {
                    lastNagTime = now;
                    nagToMove();
                }
            } else {
                continuousFaceMs = 0;
                prevFaceRatio = 0;
                RonState.recentUnknownDescriptors = [];
                averager.reset();
                lastGoodAvg = null;
                RonState.visionDebug.quality = null;
                RonState.visionDebug.distances = [];
            }

            // Calidad del fotograma (se mide sobre la imagen ORIGINAL, sin la corrección)
            const gate = RonConfig.faceQualityGate !== false;
            const qa = d ? assess(RonState.ui.video, d) : null;
            if (qa) {
                if (qa.m.lum != null) lastFaceLum = qa.m.lum;
                exposeForFace(d.detection.box, RonState.ui.video.videoWidth || vw, RonState.ui.video.videoHeight || vh, qa.m.lum);
            }
            const goodFrame = !!qa && (!gate || qa.ok);
            const avgDesc = (d && goodFrame) ? averager.push(d.descriptor, now) : null;
            if (d) {
                RonState.visionDebug.quality = qa;
                RonState.visionDebug.avgFrames = averager.count;
                RonState.visionDebug.updated = now;
                if (avgDesc) lastGoodAvg = avgDesc;
            }

            updateSadnessTracking(RonState.currentEmotion, !!d);

            // Aprendizaje activo: solo guarda descriptores nítidos y bien centrados
            if (RonState.nameFlow) {
                if (id.nameFlowExpired()) { log("Aprendizaje de nombre caducado."); id.cancelNameFlow(true); }
                else if (RonState.isLearningFace && d && goodFrame) {
                    // Solo fotogramas buenos; se guarda el promedio (más estable que uno suelto)
                    const sample = avgDesc || Array.from(d.descriptor);
                    const first = RonState.learningDescriptors?.[0];
                    const same  = !first || faceapi.euclideanDistance(new Float32Array(sample), new Float32Array(first)) < 0.62;
                    if (same && RonState.learningDescriptors.length < 14) {
                        RonState.learningDescriptors.push(sample);
                    }
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
            // Para reconocer y aprender se usa el PROMEDIO de los últimos fotogramas buenos
            const faceQualityOk = goodFrame && d.detection.score >= MIN_FACE_SCORE;
            const curDesc = avgDesc || Array.from(d.descriptor);
            if (faceQualityOk) RonState.lastDescriptor = curDesc;

            trackFace(d, vw, vh);
            import('./follow.js').then(f => f.updateFollow(d.detection.box, vw, vh)).catch(() => {});

            // Ocupado real (quitamos LISTENING de aquí para que sí pueda reconocerte aunque el micro esté abierto)
            const busy = ['THINKING','SPEAKING','HIDE_SEEK','MATH_GAME','READING_GAME','STORY','CHALLENGE'].includes(RonState.activityState)
                || now - (RonState.lastHeardTs || 0) < 3500;

            // ── INTERACTIVIDAD FÍSICA 1: Efecto "Peekaboo" ──
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

            // ── INTERACTIVIDAD FÍSICA 2: Reconocimiento Multi-Persona ──
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

            // ── Reconocimiento principal con votación ──
            // Un fotograma malo (movido, de lado, ojos cerrados...) no vota: antes votaba
            // "desconocida" y hacía que Ron dudara de alguien a quien conoce.
            if (!goodFrame) {
                if (qa) log(`Cara: fotograma descartado (${qa.reasons.join(', ')})`);
                return;
            }
            const best = id.matchFace(new Float32Array(curDesc));
            RonState.visionDebug.distances = id.distancesTo ? id.distancesTo(new Float32Array(curDesc)) : [];
            let v = '?';
            if (best && best.distance < MATCH_MAX) v = best.label;
            else if (best && best.distance < UNKNOWN_MIN) v = '~';
            const stable = vote(v);
            if (best) log(`Cara: ${best.label} (dist=${best.distance.toFixed(2)}, cal=${d.detection.score.toFixed(2)}, ${averager.count} fot.) →${stable || '…'}`);

            // Solo guardamos en el buffer desconocidos con buena calidad de imagen
            if (v === '?' && faceQualityOk) {
                if (!Array.isArray(RonState.recentUnknownDescriptors)) RonState.recentUnknownDescriptors = [];
                RonState.recentUnknownDescriptors.push(curDesc);
                if (RonState.recentUnknownDescriptors.length > 10) RonState.recentUnknownDescriptors.shift();
            }

            // Muestras adaptativas seguras (solo si el frame es nítido)
            if (best && best.distance < SAMPLE_MAX && faceQualityOk && Math.random() < 0.20) {
                id.addSamples(best.label, [curDesc]);
            }

            if (stable && stable !== '?') {
                const name = stable;
                const absentLong = now - lastSeenOf(name) > GREET_AFTER_MS;
                const changed = RonState.currentUser !== name;
                if (changed) {
                    RonState.currentUser = name;
                    log(`Usuario activo reconocido: ${name}`);
                    // Celebrar solo si Ron está libre (si dos personas se alternan, no pitar cada vez)
                    if (!busy) { celebrateFaceRecognition(); Sounds.playFaceRecognitionSound(); }
                }
                if ((changed || absentLong) && !busy && !RonState.isSilentMode) {
                    markSeen(name, now);
                    markProactive();
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
                const bigEnough = curRatio > 0.11;
                if (!busy && bigEnough && faceQualityOk && !RonState.isSilentMode && now > (RonState.learnCooldownUntil || 0)) {
                    RonState.currentUser = null;
                    votes.length = 0;
                    id.startLearning(curDesc);
                }
            }
        } catch (e) {
            console.error("Error visión:", e);
        } finally {
            processing = false;
        }
    }, 650);
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

function trackFace(detection, vw, vh) {
    const box  = detection.detection.box;
    const errX = ((box.x + box.width  / 2) / (vw || 640)) - 0.5;
    const errY = ((box.y + box.height / 2) / (vh || 480)) - 0.5;
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
        sendMove(`P${pan}\n`); setTimeout(() => sendMove(`T${tilt}\n`), 400);
    }
}, 30000);

// ── Calibración (Ajustes) ─────────────────────────────────────────────────────
export function getVisionDebug() {
    const d = RonState.visionDebug;
    return { ...d, fresh: Date.now() - (d.updated || 0) < 2500, thresholds: { MATCH_MAX, UNKNOWN_MIN, SAMPLE_MAX } };
}
// Guarda como muestra de `name` el promedio actual, solo si la imagen es buena
export async function saveCurrentSample(name) {
    const d = RonState.visionDebug;
    if (!name) return { ok: false, msg: 'Elige una persona.' };
    if (Date.now() - (d.updated || 0) > 2500 || !d.quality) return { ok: false, msg: 'No veo ninguna cara ahora mismo.' };
    if (!d.quality.ok) return { ok: false, msg: 'La imagen no es buena: ' + d.quality.reasons.join(', ') + '.' };
    if (!lastGoodAvg || averager.count < 2) return { ok: false, msg: 'Quédate quieta un segundo y vuelve a pulsar.' };
    const id = await import('./identity.js');
    id.addSamples(name, [lastGoodAvg.slice()]);
    return { ok: true, msg: `Muestra guardada para ${name}.` };
}

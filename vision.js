import { RonState, log, changeState } from './core.js';
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
    const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    RonState.ui.video.srcObject = stream;
    await RonState.ui.video.play();
    return new Promise(res => { RonState.ui.video.onloadedmetadata = res; });
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

            const busy = ['THINKING','SPEAKING','HIDE_SEEK','MATH_GAME','READING_GAME','STORY'].includes(RonState.activityState);

            // Emoción: una sola vez aquí
            if (detections.length > 0) updateEmotion(detections[0]);

            // Actualizar defensor
            updateSadnessTracking(RonState.currentEmotion, detections.length > 0);

            // Acumular descriptores SIEMPRE en modo aprendizaje (incluso si Ron está hablando)
            if (RonState.isLearningFace && detections.length > 0) {
                RonState.lastDescriptor = Array.from(detections[0].descriptor);
                if (!RonState.learningDescriptors) RonState.learningDescriptors = [];
                if (RonState.learningDescriptors.length < 10) {
                    RonState.learningDescriptors.push(Array.from(detections[0].descriptor));
                }
            }

            if (busy || RonState.isLearningFace) return;

            // Escondite
            if (RonState.activityState === 'HIDE_SEEK_SEARCH') {
                if (detections.length > 0) {
                    changeState('IDLE');
                    setExpression('star');
                    speak("¡TE PILLÉ! ¡Bip bip! ¡Eres increíble escondiéndote!");
                }
                return;
            }

            if (detections.length > 0) {
                // Despertar
                if (RonState.activityState === 'SLEEPING') {
                    changeState('IDLE');
                    setExpression('happy');
                    RonState.framesWithoutFace = 0;
                    RonState.lastEmotion = 'neutral'; // reset para evitar reacciones falsas al despertar
                    const wakeUps = [
                        "¡Bip! ¡Uy! ¡Me había quedado frito! ¿Cuánto rato llevas ahí?",
                        "¡Zzzz... bip! ¡Ah! ¡Estaba soñando con palomitas de datos!",
                        "¡Bip bop! Sistema reiniciado. ¡Hola otra vez!"
                    ];
                    speak(wakeUps[Math.floor(Math.random() * wakeUps.length)]);
                    return;
                }

                RonState.framesWithoutFace = 0;
                const d = detections[0];
                RonState.lastDescriptor = Array.from(d.descriptor);
                trackFace(d);

                // Reconocimiento
                let found = null;
                if (RonState.knownFaces.length > 0) {
                    const labeled = RonState.knownFaces.map(f => {
                        const descriptors = f.descriptors || [f.descriptor];
                        return new faceapi.LabeledFaceDescriptors(
                            f.label,
                            descriptors.map(dd => new Float32Array(dd))
                        );
                    });
                    // Umbral 0.60 = equilibrio: reconoce bien sin confundir a familiares.
                    // Más bajo (0.5) = más estricto (riesgo: no la reconoce). Más alto (0.68) = confunde personas.
                    const matcher = new faceapi.FaceMatcher(labeled, 0.60);
                    const best    = matcher.findBestMatch(d.descriptor);
                    log(`Reconocimiento: ${best.label} dist=${best.distance?.toFixed(3)}`);

                    if (best.label !== 'unknown') {
                        found = best.label;
                        RonState.unknownStabilityCounter = 0;
                        // Acumular descriptor SOLO si la coincidencia es MUY segura (< 0.45).
                        // Si acumulábamos con cualquier match (< 0.68), un falso positivo metía
                        // la cara de otra persona bajo esta etiqueta y el reconocimiento se
                        // corrompía poco a poco. Esta guarda evita esa contaminación.
                        const faceEntry = RonState.knownFaces.find(f => f.label === found);
                        if (faceEntry && best.distance < 0.45) {
                            const ds = faceEntry.descriptors || [faceEntry.descriptor];
                            if (ds.length < 12) { // máximo 12 muestras — más variedad = mejor reconocimiento
                                ds.push(Array.from(d.descriptor));
                                faceEntry.descriptors = ds;
                                localStorage.setItem('ron_known_faces', JSON.stringify(RonState.knownFaces));
                            }
                        }
                        // Deduplicación
                        if (RonState.knownFaces.length > 1) {
                            const others = RonState.knownFaces.filter(f => f.label !== found);
                            const dupe = others.find(f => {
                                const ds = f.descriptors || [f.descriptor];
                                return ds.some(dd => faceapi.euclideanDistance(d.descriptor, new Float32Array(dd)) < 0.40);
                            });
                            if (dupe) {
                                log(`Deduplicando: ${dupe.label} → ${found}`);
                                RonState.knownFaces = RonState.knownFaces.filter(f => f.label !== dupe.label);
                                localStorage.setItem('ron_known_faces', JSON.stringify(RonState.knownFaces));
                            }
                        }
                    } else {
                        // Mantener usuario actual por más tiempo antes de declararlo desconocido
                        if (RonState.currentUser && RonState.unknownStabilityCounter < 40) {
                            found = RonState.currentUser;
                            RonState.unknownStabilityCounter++;
                        }
                    }
                }

                if (found) {
                    RonState.userLastSeen = RonState.userLastSeen || {};
                    const now      = Date.now();
                    const lastSeen = RonState.userLastSeen[found] || 0;

                    if (RonState.currentUser !== found) {
                        RonState.currentUser = found;
                        if ((now - lastSeen) > 120000 && !RonState.isSilentMode && RonState.activityState === 'IDLE') {
                            celebrateFaceRecognition();
                            const greetings = [
                                `¡Bip! ¡${found}! ¡Ya estás aquí! ¡Mi sistema de amistad al 100%!`,
                                `¡Bop bip! ¡${found}! Te echaba de menos. Bueno, yo no siento "menos", pero mis sensores lo notaban.`,
                                `¡${found}! ¡Detección de mejor amiga confirmada! ¡Bip bip!`
                            ];
                            speak(greetings[Math.floor(Math.random() * greetings.length)]);
                        }
                    }
                    RonState.userLastSeen[found] = now;

                    // Reacción emocional
                    if (RonState.activityState === 'IDLE') {
                        const cooldownOk     = now > RonState.emotionCooldownUntil;
                        const emotionChanged = RonState.currentEmotion !== RonState.lastEmotion;

                        if (emotionChanged && cooldownOk && !RonState.isSilentMode) {
                            showMoodBubble(RonState.currentEmotion);

                            if (RonState.currentEmotion === 'triste') {
                                setExpression('sad');
                                RonState.isCheeringUp        = true;
                                RonState.emotionCooldownUntil = now + 180000;
                                speak(`¡Bip! ${found}, te veo un poco triste. ¿Qué ha pasado?`);
                                setTimeout(() => {
                                    if (RonState.currentEmotion === 'triste' && !RonState.isSilentMode) {
                                        import('./ai.js').then(ai =>
                                            ai.triggerSpontaneous(`${found} sigue triste. Cuéntale un chiste muy corto y gracioso para animarla.`)
                                        ).catch(() => {});
                                    }
                                }, 7000);

                            } else if (RonState.currentEmotion === 'feliz' && RonState.isCheeringUp) {
                                RonState.isCheeringUp        = false;
                                RonState.emotionCooldownUntil = now + 180000;
                                setExpression('star');
                                speak(`¡Bip bip! ¡Ahí está esa sonrisa! ¡Mi misión de alegría: completada!`);

                            } else if (RonState.currentEmotion === 'sorprendido') {
                                RonState.emotionCooldownUntil = now + 60000;
                                setExpression('surprise');
                                speak(`¡Bip! ¡Pareces muy sorprendida! ¿Te has asustado?`);

                            } else if (RonState.currentEmotion === 'enfadado') {
                                RonState.emotionCooldownUntil = now + 120000;
                                setExpression('fear');
                                speak(`¡Bip! ${found}, pareces enfadada. ¿Quieres que te cuente algo gracioso?`);
                            }
                        }
                    }

                } else if (!RonState.isLearningFace) {
                    if (RonState.unknownStabilityCounter > 50) {
                        RonState.tempDescriptor        = Array.from(d.descriptor);
                        RonState.isLearningFace        = true;
                        RonState.learningDescriptors   = [];
                        RonState.unknownStabilityCounter = 0;
                        import('./ui.js').then(ui => ui.startScanningUI());
                        speak("¡Bip bip! ¡Nuevo humano detectado! ¿Cómo te llamas? ¡Yo soy Ron!");
                    } else {
                        RonState.unknownStabilityCounter++;
                    }
                }

                RonState.lastEmotion = RonState.currentEmotion;

            } else {
                // Sin cara
                if (RonState.activityState === 'IDLE' && !RonState.isLearningFace) {
                    RonState.framesWithoutFace = (RonState.framesWithoutFace || 0) + 1;
                    if (RonState.framesWithoutFace > 188) {
                        changeState('SLEEPING');
                        setExpression('flat');
                        log("Ron dormido.");
                    }
                }
            }
        } catch (e) { console.error("Error visión:", e); }
        finally { processing = false; }
    }, 800);
}

const emotionBuffer = [];
const EMOTION_MIN_CONFIDENCE = 0.38; // umbral mínimo para reportar emoción no-neutral

function updateEmotion(detection) {
    const exp = detection.expressions;
    let maxE = 'neutral', maxS = 0;
    for (const [e, s] of Object.entries(exp)) {
        if (s > maxS) { maxS = s; maxE = e; }
    }
    // Si la emoción dominante no supera el umbral, neutral
    if (maxE !== 'neutral' && maxS < EMOTION_MIN_CONFIDENCE) maxE = 'neutral';

    const dict = { happy:'feliz', sad:'triste', angry:'enfadado', surprised:'sorprendido', fearful:'miedo', neutral:'neutral', disgusted:'neutral' };
    const emotion = dict[maxE] || 'neutral';

    // Suavizado: acumula últimos 3 frames, reporta la emoción mayoritaria
    emotionBuffer.push(emotion);
    if (emotionBuffer.length > 3) emotionBuffer.shift();

    const counts = {};
    emotionBuffer.forEach(e => counts[e] = (counts[e] || 0) + 1);
    const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    RonState.currentEmotion = dominant;
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
    if (RonState.activityState === 'IDLE' && RonState.ble.isConnected) {
        const pan  = Math.floor(Math.random() * 60) + 60;
        const tilt = Math.floor(Math.random() * 40) + 70;
        sendMove(`P${pan}\n`);
        setTimeout(() => sendMove(`T${tilt}\n`), 400);
    }
}, 30000);

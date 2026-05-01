import { RonState, log } from './core.js';
import { setExpression } from './ui.js';
import { speak } from './speech.js';

export async function loadModels() {
    const URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
    await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(URL),
        faceapi.nets.faceExpressionNet.loadFromUri(URL)
    ]);
}

export async function startCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
    RonState.ui.video.srcObject = stream;
    await RonState.ui.video.play();
    return new Promise(res => RonState.ui.video.onloadedmetadata = res);
}

export function startVisionLoop() {
    setInterval(async () => {
        try {
            const detections = await faceapi
                .detectAllFaces(RonState.ui.video, new faceapi.TinyFaceDetectorOptions({ inputSize: 160 }))
                .withFaceLandmarks().withFaceExpressions().withFaceDescriptors();

            // Si está ocupado o en modo especial, solo actualizamos la emoción
            const busy = ['THINKING','SPEAKING','HIDE_SEEK','MATH_GAME','READING_GAME'].includes(RonState.activityState);
            if (busy || RonState.isLearningFace) {
                if (detections.length > 0) updateEmotion(detections[0]);
                return;
            }

            // Modo escondite: buscar cara
            if (RonState.activityState === 'HIDE_SEEK_SEARCH') {
                if (detections.length > 0) {
                    import('./core.js').then(c => c.changeState('IDLE'));
                    setExpression('happy');
                    speak("¡Te pillé! ¡Bip! ¡Qué escondite más bueno!");
                }
                return;
            }

            if (detections.length > 0) {
                if (RonState.activityState === 'SLEEPING') {
                    import('./core.js').then(c => c.changeState('IDLE'));
                    setExpression('happy');
                    speak("¡Bip! ¡Hola! Me había quedado dormido.");
                }
                RonState.framesWithoutFace = 0;
                
                const d = detections[0];
                RonState.lastDescriptor = Array.from(d.descriptor);
                trackFace(d);
                updateEmotion(d);

                // ── RECONOCIMIENTO ──────────────────────────────────────────────────────
                // Umbral alto (0.5) = más estricto. Menos falsos positivos entre padre e hija.
                let found = null;
                if (RonState.knownFaces.length > 0) {
                    const labeled = RonState.knownFaces.map(f =>
                        new faceapi.LabeledFaceDescriptors(f.label, f.descriptors.map(dd => new Float32Array(dd)))
                    );
                    const matcher = new faceapi.FaceMatcher(labeled, 0.40); // Ajustado para no confundir caras similares
                    const best = matcher.findBestMatch(d.descriptor);

                    if (best.label !== 'unknown') {
                        found = best.label;
                        RonState.unknownStabilityCounter = 0;

                        // Desduplicación: si otra cara tiene distancia < 0.38 = misma persona
                        if (RonState.knownFaces.length > 1) {
                            const others = RonState.knownFaces.filter(f => f.label !== found);
                            const dupe = others.find(f =>
                                f.descriptors.some(dd => faceapi.euclideanDistance(d.descriptor, new Float32Array(dd)) < 0.38)
                            );
                            if (dupe) {
                                log(`Desduplicando ${dupe.label} → ${found}`);
                                RonState.knownFaces = RonState.knownFaces.filter(f => f.label !== dupe.label);
                                localStorage.setItem('ron_known_faces', JSON.stringify(RonState.knownFaces));
                            }
                        }
                    } else {
                        // Histeresis: mantener identidad durante 10 frames (~8s) antes de dudar
                        if (RonState.currentUser && RonState.unknownStabilityCounter < 10) {
                            found = RonState.currentUser;
                            RonState.unknownStabilityCounter++;
                        }
                    }
                }

                // ── REACCIONES ──────────────────────────────────────────────────────────
                if (found) {
                    RonState.userLastSeen = RonState.userLastSeen || {};
                    const now = Date.now();
                    const lastTimeThisUser = RonState.userLastSeen[found] || 0;

                    if (RonState.currentUser !== found) {
                        RonState.currentUser = found;
                        
                        // Saludar de inmediato si hace más de 2 minutos que no vemos a ESTA persona concreta
                        if ((now - lastTimeThisUser) > 120000) {
                            if (!RonState.isSilentMode) {
                                setExpression('happy');
                                speak(`¡Bip! ¡Hola ${found}!`);
                            }
                        }
                    }
                    
                    // Actualizar siempre el timestamp mientras le estemos viendo
                    RonState.userLastSeen[found] = now;
                    
                    // Reacción emocional con cooldown de 3 minutos
                    if (RonState.currentUser === found) {
                        const now = Date.now();
                        const cooldownOk = now > RonState.emotionCooldownUntil;
                        if (RonState.currentEmotion !== RonState.lastEmotion && RonState.activityState === 'IDLE' && cooldownOk && !RonState.isSilentMode) {
                            if (RonState.currentEmotion === 'triste') {
                                setExpression('sad');
                                RonState.isCheeringUp = true;
                                RonState.emotionCooldownUntil = now + 180000; // 3 minutos
                                speak(`¡Bip! Te veo un poco triste. ¿Qué pasa, ${found}?`);
                                setTimeout(() => {
                                    if (RonState.currentEmotion === 'triste' && !RonState.isSilentMode) {
                                        import('./ai.js').then(ai => ai.triggerSpontaneous("El niño está triste. Cuenta un chiste MUY corto para animarle."));
                                    }
                                }, 6000);
                            } else if (RonState.currentEmotion === 'feliz' && RonState.isCheeringUp) {
                                RonState.isCheeringUp = false;
                                RonState.emotionCooldownUntil = now + 180000;
                                setExpression('happy');
                                speak(`¡Bip! ¡Ya estás sonriendo!`);
                            }
                        }
                    }
                } else if (!RonState.isLearningFace) {
                    // Cara desconocida: esperar 12 frames seguidos antes de preguntar
                    if (RonState.unknownStabilityCounter > 12) {
                        // Guardar múltiples descriptores por persona para mayor robustez
                        RonState.tempDescriptor = Array.from(d.descriptor);
                        RonState.isLearningFace = true;
                        RonState.unknownStabilityCounter = 0;
                        import('./ui.js').then(ui => ui.startScanningUI());
                        speak("¡Bip! ¡Un amigo nuevo! ¿Cómo te llamas?");
                    } else {
                        RonState.unknownStabilityCounter++;
                    }
                }
                RonState.lastEmotion = RonState.currentEmotion;
            } else {
                // No hay caras en pantalla
                if (RonState.activityState === 'IDLE' && !RonState.isLearningFace) {
                    RonState.framesWithoutFace = (RonState.framesWithoutFace || 0) + 1;
                    if (RonState.framesWithoutFace > 150) { // ~2 minutos sin ver a nadie (150 frames * 800ms)
                        import('./core.js').then(c => c.changeState('SLEEPING'));
                        setExpression('flat'); // Se duerme
                    }
                }
            }
        } catch(e) { console.error("Error visión:", e); }
    }, 800);
}

function updateEmotion(detection) {
    const exp = detection.expressions;
    let maxE = 'neutral'; let maxS = 0;
    for (const [e, s] of Object.entries(exp)) { if (s > maxS) { maxS = s; maxE = e; } }
    const emDict = { happy: 'feliz', sad: 'triste', angry: 'enfadado', surprised: 'sorprendido', neutral: 'neutral' };
    RonState.currentEmotion = emDict[maxE] || 'neutral';
}

export function captureOptimizedFrame() {
    const MAX = 1024;
    const canvas = document.createElement('canvas');
    let w = RonState.ui.video.videoWidth || 640;
    let h = RonState.ui.video.videoHeight || 480;
    if (w > h) { if (w > MAX) { h *= MAX / w; w = MAX; } }
    else { if (h > MAX) { w *= MAX / h; h = MAX; } }
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(RonState.ui.video, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', 0.9);
}

export async function connectBLE() {
    try {
        log("Buscando B*Bot ESP32...");
        RonState.ble.device = await navigator.bluetooth.requestDevice({
            filters: [{ namePrefix: 'Ron' }, { namePrefix: 'B-Bot' }],
            optionalServices: ['0000ffe0-0000-1000-8000-00805f9b34fb']
        });
        const server = await RonState.ble.device.gatt.connect();
        const service = await server.getPrimaryService('0000ffe0-0000-1000-8000-00805f9b34fb');
        RonState.ble.characteristic = await service.getCharacteristic('0000ffe1-0000-1000-8000-00805f9b34fb');
        RonState.ble.isConnected = true;
        RonState.ui.bleBtn.classList.add('active');
        speak("¡Bip! Conexión de motores establecida.");
        log("BLE Conectado.");
    } catch (e) { log(`Error BLE: ${e.message}`); }
}

export async function sendMove(cmd) {
    if (!RonState.ble.isConnected || !RonState.ble.characteristic) return;
    try {
        await RonState.ble.characteristic.writeValue(new TextEncoder().encode(cmd));
    } catch(e) {
        log("BLE desconectado o error de hardware: " + e.message);
        RonState.ble.isConnected = false;
        import('./ui.js').then(ui => ui.setChestIcon('warning'));
    }
}

function trackFace(detection) {
    const box = detection.detection.box;
    const errX = ((box.x + box.width / 2) / RonState.ui.video.videoWidth) - 0.5;
    const errY = ((box.y + box.height / 2) / RonState.ui.video.videoHeight) - 0.5;
    
    // Mover los ojos digitales de la pantalla para seguirte visualmente
    import('./ui.js').then(ui => ui.shiftEyes(errX, errY));

    if (!RonState.ble.isConnected) return;
    
    if (Math.abs(errX) > 0.1) { RonState.ble.lastPan = Math.max(0, Math.min(180, RonState.ble.lastPan - errX * 20)); sendMove(`P${Math.round(RonState.ble.lastPan)}\n`); }
    if (Math.abs(errY) > 0.1) { RonState.ble.lastTilt = Math.max(0, Math.min(180, RonState.ble.lastTilt + errY * 20)); sendMove(`T${Math.round(RonState.ble.lastTilt)}\n`); }
}

// Movimiento Autónomo (v21.1) - Mover cabeza cuando está aburrido (solo si BLE conectado)
setInterval(() => {
    if (RonState.activityState === 'IDLE' && RonState.ble.isConnected) {
        const pan = Math.floor(Math.random() * 60) + 60;  // Mirar a los lados (60-120)
        const tilt = Math.floor(Math.random() * 40) + 70; // Mirar arriba/abajo (70-110)
        sendMove(`P${pan}\n`);
        setTimeout(() => sendMove(`T${tilt}\n`), 300);
    }
}, 30000);

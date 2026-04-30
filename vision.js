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
        // Permitimos detección siempre para que Ron "vea" incluso mientras habla, 
        // pero bloqueamos la lógica de reacción si está ocupado.
        try {
            const detections = await faceapi.detectAllFaces(RonState.ui.video, new faceapi.TinyFaceDetectorOptions({ inputSize: 160 }))
                .withFaceLandmarks().withFaceExpressions().withFaceDescriptors();
            
            if (RonState.activityState === 'THINKING' || RonState.activityState === 'SPEAKING' || RonState.activityState === 'HIDE_SEEK' || RonState.isLearningFace) {
                // Actualizamos solo la emoción si está hablando para no perder el hilo
                if (detections.length > 0) {
                    const exp = detections[0].expressions;
                    let maxE = 'neutral'; let maxS = 0;
                    for (const [e, s] of Object.entries(exp)) { if (s > maxS) { maxS = s; maxE = e; } }
                    const emDict = { happy: 'feliz', sad: 'triste', angry: 'enfadado', surprised: 'sorprendido', neutral: 'neutral' };
                    RonState.currentEmotion = emDict[maxE] || 'neutral';
                }
                return;
            }
            
            if (RonState.activityState === 'HIDE_SEEK_SEARCH') {
                if (detections.length > 0) {
                    import('./core.js').then(c => c.changeState('IDLE'));
                    setExpression('happy');
                    speak("¡Te pillé! ¡Bip! ¡Qué escondite más bueno!");
                }
                return;
            }

            if (detections.length > 0) {
                const d = detections[0];
                RonState.lastDescriptor = Array.from(d.descriptor);
                trackFace(d); 

                const exp = d.expressions;
                let maxE = 'neutral'; let maxS = 0;
                for (const [e, s] of Object.entries(exp)) { if (s > maxS) { maxS = s; maxE = e; } }
                const emDict = { happy: 'feliz', sad: 'triste', angry: 'enfadado', surprised: 'sorprendido', neutral: 'neutral' };
                const emotionNow = emDict[maxE] || 'neutral';
                RonState.currentEmotion = emotionNow;

                let found = null;
                if (RonState.knownFaces.length > 0) {
                    const matcher = new faceapi.FaceMatcher(RonState.knownFaces.map(f => new faceapi.LabeledFaceDescriptors(f.label, [new Float32Array(f.descriptor)])), 0.65);
                    const bestMatch = matcher.findBestMatch(d.descriptor);
                    
                    if (bestMatch.label !== 'unknown') {
                        found = bestMatch.label;
                        RonState.unknownStabilityCounter = 0; // Reseteamos si vemos a alguien conocido
                        
                        // Inteligencia de Limpieza Automática: 
                        // Si hay otro nombre que también coincide mucho con esta cara, lo borramos para evitar duplicados futuros
                        if (RonState.knownFaces.length > 1) {
                            const currentDesc = d.descriptor;
                            const others = RonState.knownFaces.filter(f => f.label !== found);
                            const dupe = others.find(f => faceapi.euclideanDistance(currentDesc, new Float32Array(f.descriptor)) < 0.4);
                            if (dupe) {
                                log(`Desduplicando: ${dupe.label} parece ser la misma persona que ${found}. Borrando duplicado.`);
                                RonState.knownFaces = RonState.knownFaces.filter(f => f.label !== dupe.label);
                                localStorage.setItem('ron_known_faces', JSON.stringify(RonState.knownFaces));
                            }
                        }
                    } else {
                        // Si no lo reconoce, pero el currentUser estaba activo hace poco, mantenemos la identidad 
                        // para que no se pierda al sonreír o poner caras. Histeresis de 8 frames (~6 segundos)
                        if (RonState.currentUser && RonState.unknownStabilityCounter < 8) {
                            found = RonState.currentUser;
                            RonState.unknownStabilityCounter++;
                        }
                    }
                }

                if (found) {
                    if (RonState.currentUser !== found) {
                        RonState.currentUser = found;
                        setExpression(RonState.currentEmotion === 'feliz' ? 'happy' : 'neutral');
                        speak(`¡Bip! ¡Hola, ${found}! Te he reconocido. Te veo ${RonState.currentEmotion}.`);
                    } else if (RonState.currentEmotion !== RonState.lastEmotion && RonState.activityState === 'IDLE') {
                        if (RonState.currentEmotion === 'triste') {
                            setExpression('sad');
                            RonState.isCheeringUp = true;
                            speak(`¡Bip! Amigo ${RonState.currentUser || "amigo"}, te veo triste. Voy a intentar animarte.`);
                            // Esperamos a que termine de hablar antes de lanzar el chiste
                            setTimeout(() => {
                                if (RonState.currentEmotion === 'triste') {
                                    import('./ai.js').then(ai => ai.triggerSpontaneous("El niño está triste. Cuenta un chiste MUY corto o di algo súper gracioso sobre ti para intentar animarle."));
                                }
                            }, 5000);
                        } else if (RonState.currentEmotion === 'feliz') {
                            if (RonState.isCheeringUp) {
                                RonState.isCheeringUp = false;
                                setExpression('happy');
                                speak(`¡Bip! ¡Bien! ¡Ya estás sonriendo de nuevo!`);
                            } else {
                                setExpression('happy');
                                speak(`¡Bip! ¡Me encanta verte feliz, ${RonState.currentUser}!`);
                            }
                        }
                    }
                } else if (!RonState.isLearningFace) {
                    // Solo preguntamos el nombre si llevamos un rato sin reconocer a nadie (para evitar falsos positivos)
                    if (RonState.unknownStabilityCounter > 10) {
                        RonState.tempDescriptor = Array.from(d.descriptor);
                        RonState.isLearningFace = true;
                        speak("¡Bip! Eres un amigo nuevo. ¿Cómo te llamas?");
                        RonState.unknownStabilityCounter = 0;
                    } else {
                        RonState.unknownStabilityCounter++;
                    }
                }
                RonState.lastEmotion = RonState.currentEmotion;
            }
        } catch(e) { console.error("Error visión:", e); }
    }, 800); 
}

export function captureOptimizedFrame() {
    const MAX = 1024; 
    const canvas = document.createElement('canvas');
    let w = RonState.ui.video.videoWidth || 640; let h = RonState.ui.video.videoHeight || 480;
    if (w > h) { if (w > MAX) { h *= MAX / w; w = MAX; } } 
    else { if (h > MAX) { w *= MAX / h; h = MAX; } }
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(RonState.ui.video, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', 0.9);
}

// BLE Track Face
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
    } catch (e) {
        log(`Error BLE: ${e.message}`);
    }
}

export function sendMove(cmd) {
    if (!RonState.ble.isConnected || !RonState.ble.characteristic) return;
    const enc = new TextEncoder();
    RonState.ble.characteristic.writeValue(enc.encode(cmd));
}

function trackFace(detection) {
    if (!RonState.ble.isConnected) return;
    const box = detection.detection.box;
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    
    const errX = (centerX / RonState.ui.video.videoWidth) - 0.5;
    const errY = (centerY / RonState.ui.video.videoHeight) - 0.5;

    if (Math.abs(errX) > 0.1) {
        RonState.ble.lastPan -= errX * 20;
        RonState.ble.lastPan = Math.max(0, Math.min(180, RonState.ble.lastPan));
        sendMove(`P${Math.round(RonState.ble.lastPan)}\n`);
    }
    if (Math.abs(errY) > 0.1) {
        RonState.ble.lastTilt += errY * 20;
        RonState.ble.lastTilt = Math.max(0, Math.min(180, RonState.ble.lastTilt));
        sendMove(`T${Math.round(RonState.ble.lastTilt)}\n`);
    }
}

// Movimiento Autónomo (v21.0)
setInterval(() => {
    if (RonState.activityState === 'IDLE' && RonState.ble.isConnected) {
        const p = Math.floor(Math.random() * 40) + 70; // Movimiento ligero cerca del centro (70-110)
        sendMove(`P${p}\n`);
        log("Escaneo autónomo...");
    }
}, 45000); 


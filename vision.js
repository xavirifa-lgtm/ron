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
        if (RonState.activityState === 'THINKING' || RonState.activityState === 'SPEAKING' || RonState.activityState === 'HIDE_SEEK' || RonState.isLearningFace) return;
        try {
            const detections = await faceapi.detectAllFaces(RonState.ui.video, new faceapi.TinyFaceDetectorOptions({ inputSize: 160 }))
                .withFaceLandmarks().withFaceExpressions().withFaceDescriptors();
            
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
                trackFace(d); 

                const exp = d.expressions;
                let maxE = 'neutral'; let maxS = 0;
                for (const [e, s] of Object.entries(exp)) { if (s > maxS) { maxS = s; maxE = e; } }
                const emDict = { happy: 'feliz', sad: 'triste', angry: 'enfadado', surprised: 'sorprendido', neutral: 'neutral' };
                const emotionNow = emDict[maxE] || 'neutral';
                RonState.currentEmotion = emotionNow;

                let found = null;
                if (RonState.knownFaces.length > 0) {
                    const matcher = new faceapi.FaceMatcher(RonState.knownFaces.map(f => new faceapi.LabeledFaceDescriptors(f.label, [new Float32Array(f.descriptor)])), 0.6);
                    const res = matcher.findBestMatch(d.descriptor);
                    if (res.label !== 'unknown') found = res.label;
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
                            speak(`¡Bip! Amigo ${RonState.currentUser}, te veo triste. Voy a intentar animarte.`);
                            import('./ai.js').then(ai => ai.triggerSpontaneous("El niño está triste. Cuenta un chiste MUY corto o di algo súper gracioso sobre ti para intentar animarle."));
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
                    RonState.tempDescriptor = Array.from(d.descriptor);
                    RonState.isLearningFace = true;
                    speak("¡Bip! Eres un amigo nuevo. ¿Cómo te llamas?");
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

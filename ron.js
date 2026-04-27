/**
 * Ron B*Bot AI - Versión Robusta v2.2
 */

const ronFace = {
    // Referencias DOM
    eyes: { left: document.getElementById('eye-left'), right: document.getElementById('eye-right') },
    mouth: document.getElementById('mouth-path'),
    mouthContainer: document.querySelector('.mouth-svg'),
    glitchOverlay: document.getElementById('glitch-overlay'),
    video: document.getElementById('webcam'),
    apiModal: document.getElementById('api-modal'),
    apiKeyInput: document.getElementById('groq-key-input'),
    saveBtn: document.getElementById('save-api-key'),
    debug: document.getElementById('debug-info'),

    // Estado
    state: 'neutral',
    isThinking: false,
    isSpeaking: false,
    isInitialized: false,
    currentUser: null,
    knownFaces: JSON.parse(localStorage.getItem('ron_known_faces') || '[]'),
    apiKey: localStorage.getItem('ron_groq_key'),

    log(msg) {
        console.log(msg);
        if (this.debug) {
            this.debug.classList.remove('hidden');
            this.debug.innerHTML = `[RON_LOG]: ${msg}`;
        }
    },

    async preInit() {
        this.log("Esperando interacción para despertar...");
        document.body.onclick = () => {
            if (!this.isInitialized) {
                this.isInitialized = true;
                this.init();
                this.goFullscreen();
            }
        };
        // Mostrar mensaje inicial en el debug
        this.log("¡Toca la pantalla para encender a Ron!");
    },

    async init() {
        this.log("Iniciando sistemas...");
        this.setExpression('thinking');
        
        try {
            // 1. Cargar Modelos de IA
            this.log("Cargando cerebro visual (IA)...");
            await this.loadModels();
            
            // 2. Iniciar Cámara
            this.log("Abriendo ojos (Cámara)...");
            await this.startCamera();
            
            // 3. Setup UI
            this.setupInteractions();
            this.checkApiKey();
            
            this.setExpression('neutral');
            this.startBlinkCycle();
            
            // 4. Iniciar Motores
            this.startVisionLoop();
            this.startListening();
            
            this.speak("¡Hola! Soy Ron, tu mejor amigo fuera de la caja. ¡Bip! Ya puedo verte y oírte.");
            this.log("Ron está totalmente despierto.");
        } catch (err) {
            this.log(`ERROR CRÍTICO: ${err.message}`);
            this.setExpression('glitch');
        }
    },

    async loadModels() {
        const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
        try {
            await Promise.all([
                faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
                faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
                faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
            ]);
        } catch (e) {
            throw new Error("No se pudieron cargar los modelos de IA. Revisa tu conexión.");
        }
    },

    async startCamera() {
        try {
            const constraints = { 
                video: { 
                    facingMode: "user",
                    width: { ideal: 640 },
                    height: { ideal: 480 }
                } 
            };
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            this.video.srcObject = stream;
            return new Promise((resolve) => {
                this.video.onloadedmetadata = () => resolve();
            });
        } catch (err) {
            throw new Error("Permiso de cámara denegado o no encontrada.");
        }
    },

    checkApiKey() {
        if (!this.apiKey) {
            this.apiModal.classList.remove('hidden');
        }
    },

    setupInteractions() {
        this.saveBtn.onclick = (e) => {
            e.stopPropagation();
            const key = this.apiKeyInput.value.trim();
            if (key) {
                localStorage.setItem('ron_groq_key', key);
                this.apiKey = key;
                this.apiModal.classList.add('hidden');
                this.speak("¡Cerebro activado! Ahora puedo pensar.");
            }
        };
    },

    // --- MOTOR DE ESCUCHA ---
    startListening() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            this.log("Reconocimiento de voz no soportado en este navegador.");
            return;
        }

        this.recognition = new SpeechRecognition();
        this.recognition.lang = 'es-ES';
        this.recognition.continuous = false;
        this.recognition.interimResults = false;

        this.recognition.onresult = (event) => {
            const text = event.results[0][0].transcript.trim();
            this.log(`He oído: "${text}"`);
            this.chat(text);
        };

        this.recognition.onend = () => {
            if (!this.isSpeaking && this.isInitialized) {
                setTimeout(() => {
                    try { this.recognition.start(); } catch(e) {}
                }, 500);
            }
        };

        this.recognition.onerror = (event) => {
            if (event.error !== 'no-speech') {
                console.log("Error micro:", event.error);
            }
        };

        try { this.recognition.start(); } catch (e) {}
    },

    // --- MOTOR DE VISIÓN ---
    async startVisionLoop() {
        setInterval(async () => {
            if (this.isThinking || this.isSpeaking || !this.isInitialized) return;

            try {
                const detections = await faceapi.detectAllFaces(this.video, new faceapi.TinyFaceDetectorOptions())
                    .withFaceLandmarks()
                    .withFaceDescriptors();

                if (detections.length > 0) {
                    this.processDetections(detections[0]);
                }
            } catch (e) { console.log("Error visión:", e); }
        }, 3000);
    },

    async processDetections(detection) {
        const descriptor = detection.descriptor;
        let match = null;

        if (this.knownFaces.length > 0) {
            const faceMatcher = new faceapi.FaceMatcher(this.knownFaces.map(f => 
                new faceapi.LabeledFaceDescriptors(f.label, [new Float32Array(f.descriptor)])
            ));
            const bestMatch = faceMatcher.findBestMatch(descriptor);
            if (bestMatch.label !== 'unknown') match = bestMatch.label;
        }

        if (match) {
            if (this.currentUser !== match) {
                this.currentUser = match;
                this.setExpression('happy');
                this.chat(`¡Bip! Hola de nuevo, ${match}. ¿Cómo va todo?`);
            }
        } else {
            this.currentUser = 'desconocido';
            this.setExpression('surprise');
            this.speak("¡Bip! Veo una cara nueva. ¿Cuál es tu nombre?");
            const name = prompt("Ron no te conoce. ¿Cómo te llamas?");
            if (name) {
                this.saveNewFace(name, descriptor);
            }
        }
    },

    saveNewFace(name, descriptor) {
        this.knownFaces.push({ label: name, descriptor: Array.from(descriptor) });
        localStorage.setItem('ron_known_faces', JSON.stringify(this.knownFaces));
        this.currentUser = name;
        this.speak(`¡Guardado! Hola ${name}, ahora somos mejores amigos.`);
    },

    // --- MOTOR DE DIÁLOGO ---
    async chat(userText) {
        if (!this.apiKey || this.isThinking) return;
        this.isThinking = true;
        this.setExpression('thinking');

        try {
            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: "llama-3.1-8b-instant",
                    messages: [
                        { role: "system", content: "Eres Ron de 'Ron's Gone Wrong'. Hablas español. Eres gracioso, optimista y usas '¡Bip!'. Respuestas cortas." },
                        { role: "user", content: userText }
                    ]
                })
            });

            const data = await response.json();
            const reply = data.choices[0].message.content;
            this.isThinking = false;
            this.setExpression('neutral');
            this.speak(reply);
        } catch (err) {
            this.isThinking = false;
            this.setExpression('glitch');
            this.log("Error al conectar con el cerebro Groq.");
        }
    },

    // --- MOTOR DE VOZ ---
    speak(text) {
        if (!window.speechSynthesis || !this.isInitialized) return;
        
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'es-ES';
        utterance.pitch = 1.8;
        utterance.rate = 1.1;

        utterance.onstart = () => { this.isSpeaking = true; this.setTalking(true); };
        utterance.onend = () => {
            this.isSpeaking = false;
            this.setTalking(false);
            if (this.state === 'surprise') this.setExpression('neutral');
            setTimeout(() => { try { this.recognition.start(); } catch(e) {} }, 300);
        };

        window.speechSynthesis.speak(utterance);
    },

    // --- ANIMACIONES Y UI ---
    setExpression(expression) {
        this.state = expression;
        [this.eyes.left, this.eyes.right].forEach(el => el.className = 'eye');
        this.stopGlitchEffect();

        switch(expression) {
            case 'happy': this.eyes.left.classList.add('happy'); this.eyes.right.classList.add('happy'); this.updateMouth('M 5 15 Q 50 45 95 15'); break;
            case 'surprise': this.eyes.left.classList.add('surprise'); this.eyes.right.classList.add('surprise'); this.updateMouth('M 30 25 Q 50 35 70 25'); break;
            case 'glitch': this.eyes.left.classList.add('glitch-left'); this.eyes.right.classList.add('glitch-right'); this.updateMouth('M 20 20 L 40 25 L 60 15 L 80 20'); this.startGlitchEffect(); break;
            case 'thinking': this.eyes.left.classList.add('flat'); this.eyes.right.classList.add('flat'); this.updateMouth('M 20 20 Q 50 20 80 20'); this.startGlitchEffect(); break;
            default: this.updateMouth('M 10 20 Q 50 40 90 20');
        }
    },

    startBlinkCycle() {
        const blink = () => {
            if (this.state === 'neutral' && !this.isSpeaking) {
                [this.eyes.left, this.eyes.right].forEach(el => el.classList.add('blink'));
                setTimeout(() => [this.eyes.left, this.eyes.right].forEach(el => el.classList.remove('blink')), 150);
            }
            setTimeout(blink, Math.random() * 4000 + 2000);
        };
        blink();
    },

    startGlitchEffect() {
        this.stopGlitchEffect();
        this.glitchInterval = setInterval(() => {
            const block = document.createElement('div');
            block.className = 'glitch-block';
            block.style.width = `${Math.random() * 100 + 20}px`;
            block.style.height = `${Math.random() * 50 + 10}px`;
            block.style.left = `${Math.random() * 100}vw`;
            block.style.top = `${Math.random() * 100}vh`;
            this.glitchOverlay.appendChild(block);
            setTimeout(() => block.remove(), 200);
        }, 150);
    },

    stopGlitchEffect() { clearInterval(this.glitchInterval); this.glitchOverlay.innerHTML = ''; },
    updateMouth(d) { this.mouth.setAttribute('d', d); },
    setTalking(isTalking) { isTalking ? this.mouthContainer.classList.add('mouth-vibrate') : this.mouthContainer.classList.remove('mouth-vibrate'); },
    
    goFullscreen() {
        const docEl = document.documentElement;
        if (!document.fullscreenElement) {
            (docEl.requestFullscreen || docEl.webkitRequestFullScreen).call(docEl).catch(() => {});
        }
    }
};

// Registro de Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(err => console.log('Error PWA:', err));
    });
}

// Pre-inicialización
window.onload = () => ronFace.preInit();

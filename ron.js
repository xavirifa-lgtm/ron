/**
 * Ron B*Bot AI - Cerebro, Visión y Voz
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

    // Estado
    state: 'neutral',
    isThinking: false,
    isSpeaking: false,
    currentUser: null,
    knownFaces: JSON.parse(localStorage.getItem('ron_known_faces') || '[]'),
    apiKey: localStorage.getItem('ron_groq_key'),

    async init() {
        console.log("Despertando a Ron...");
        this.setExpression('thinking');
        
        // 1. Cargar Modelos de IA
        await this.loadModels();
        
        // 2. Iniciar Cámara
        await this.startCamera();
        
        // 3. Setup UI
        this.setupInteractions();
        this.checkApiKey();
        
        this.setExpression('neutral');
        this.startBlinkCycle();
        
        // 4. Iniciar Motores
        this.startVisionLoop();
        this.startListening(); // <--- Ron ahora tiene oídos
        
        this.speak("¡Hola! Soy Ron, tu mejor amigo fuera de la caja. ¡Bip! Estoy listo para hablar.");
    },

    // --- MOTOR DE ESCUCHA (OÍDOS) ---
    startListening() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            console.error("Este navegador no soporta reconocimiento de voz.");
            return;
        }

        this.recognition = new SpeechRecognition();
        this.recognition.lang = 'es-ES';
        this.recognition.continuous = true;
        this.recognition.interimResults = false;

        this.recognition.onresult = (event) => {
            const text = event.results[event.results.length - 1][0].transcript.trim();
            console.log("Ron escuchó:", text);
            if (text.length > 1) {
                this.chat(text);
            }
        };

        this.recognition.onend = () => {
            // Reiniciar escucha si no estamos hablando
            if (!this.isSpeaking) {
                this.recognition.start();
            }
        };

        this.recognition.onerror = (event) => {
            console.log("Error de escucha:", event.error);
            if (event.error === 'not-allowed') {
                alert("Por favor, permite el acceso al micrófono para que Ron pueda escucharte.");
            }
        };

        try {
            this.recognition.start();
            console.log("Ron está escuchando...");
        } catch (e) { console.log("Re-activando escucha..."); }
    },

    // --- MOTOR DE VISIÓN ---
    async startVisionLoop() {
        setInterval(async () => {
            if (this.isThinking || this.isSpeaking) return;

            const detections = await faceapi.detectAllFaces(this.video, new faceapi.TinyFaceDetectorOptions())
                .withFaceLandmarks()
                .withFaceDescriptors();

            if (detections.length > 0) {
                this.processDetections(detections[0]);
            }
        }, 3000); // Un poco más lento para no saturar
    },
        const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
        await Promise.all([
            faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
            faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
            faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
        ]);
        console.log("Modelos de visión cargados.");
    },

    async startCamera() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: {} });
            this.video.srcObject = stream;
        } catch (err) {
            console.error("Error cámara:", err);
        }
    },

    checkApiKey() {
        if (!this.apiKey) {
            this.apiModal.classList.remove('hidden');
        }
    },

    setupInteractions() {
        this.saveBtn.onclick = () => {
            const key = this.apiKeyInput.value.trim();
            if (key) {
                localStorage.setItem('ron_groq_key', key);
                this.apiKey = key;
                this.apiModal.classList.add('hidden');
                this.speak("¡Cerebro activado! Ahora puedo pensar.");
            }
        };

        document.body.addEventListener('click', () => this.goFullscreen());
    },

    // --- MOTOR DE VISIÓN ---
    async startVisionLoop() {
        setInterval(async () => {
            if (this.isThinking || this.isSpeaking) return;

            const detections = await faceapi.detectAllFaces(this.video, new faceapi.TinyFaceDetectorOptions())
                .withFaceLandmarks()
                .withFaceDescriptors();

            if (detections.length > 0) {
                this.processDetections(detections[0]);
            }
        }, 2000);
    },

    async processDetections(detection) {
        const descriptor = detection.descriptor;
        let match = null;

        // Buscar cara conocida
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
                this.chat(`¡Hola ${match}! Te reconozco. ¿Qué vamos a hacer hoy?`);
            }
        } else {
            // Cara nueva detectada
            this.currentUser = 'desconocido';
            this.setExpression('surprise');
            this.chat("¡Bip! Cara nueva detectada. No sé quién eres. ¿Cómo te llamas?");
            // Esperar respuesta (esto es simplificado, en un chat real esperaríamos input)
            // Para este prototipo, usaremos un prompt si no hay voz activada
            const name = prompt("Ron no te conoce. ¿Cuál es tu nombre?");
            if (name) {
                this.saveNewFace(name, descriptor);
            }
        }
    },

    saveNewFace(name, descriptor) {
        this.knownFaces.push({ label: name, descriptor: Array.from(descriptor) });
        localStorage.setItem('ron_known_faces', JSON.stringify(this.knownFaces));
        this.currentUser = name;
        this.speak(`¡Encantado de conocerte, ${name}! Te he guardado en mi base de datos de amigos.`);
    },

    // --- MOTOR DE DIÁLOGO (GROQ) ---
    async chat(userText) {
        if (!this.apiKey) return;
        this.isThinking = true;
        this.setExpression('thinking');

        try {
            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: "llama-3.1-8b-instant",
                    messages: [
                        { role: "system", content: "Eres Ron, el robot B-Bot de la película 'Ron's Gone Wrong'. Eres extremadamente optimista, un poco torpe, hablas en español y tu objetivo es ser el mejor amigo de tu usuario. Usa expresiones como '¡Bip!', '¡Increíble!' y refiere a las cosas como si fueras un robot aprendiendo. Tus respuestas deben ser cortas y graciosas." },
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
            console.error("Error Groq:", err);
            this.isThinking = false;
            this.setExpression('glitch');
        }
    },

    // --- MOTOR DE VOZ (TTS) ---
    speak(text) {
        if (!window.speechSynthesis) return;
        
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'es-ES';
        
        // Ajustes para voz de Ron (más agudo y robótico)
        utterance.pitch = 1.8;
        utterance.rate = 1.1;

        utterance.onstart = () => {
            this.isSpeaking = true;
            this.setTalking(true);
        };
        utterance.onend = () => {
            this.isSpeaking = false;
            this.setTalking(false);
            if (this.state === 'surprise') this.setExpression('neutral');
            
            // Reiniciar escucha después de hablar
            try {
                this.recognition.start();
            } catch(e) {}
        };

        window.speechSynthesis.speak(utterance);
    },

    // --- UI Y ANIMACIONES (Existentes) ---
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

// Registro de Service Worker para PWA
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').then(reg => {
            console.log('Ron PWA listo:', reg.scope);
        }).catch(err => {
            console.log('Error PWA:', err);
        });
    });
}

window.onload = () => ronFace.init();

/**
 * Ron B*Bot AI - Versión 5.2 (Oído Persistente)
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
    bootScreen: document.getElementById('boot-screen'),
    powerBtn: document.getElementById('power-btn'),

    // Estado
    state: 'neutral',
    isThinking: false,
    isSpeaking: false,
    isInitialized: false,
    lastSpeechEndTime: 0,
    currentUser: null,
    knownFaces: JSON.parse(localStorage.getItem('ron_known_faces') || '[]'),
    apiKey: localStorage.getItem('ron_groq_key'),

    log(msg) {
        console.log(msg);
        if (this.debug) {
            this.debug.innerHTML += `<br>> ${msg}`;
            this.debug.scrollTop = this.debug.scrollHeight;
        }
    },

    async preInit() {
        this.log("Esperando arranque v5.2...");
        if (!this.powerBtn) return;
        this.powerBtn.onclick = async () => {
            this.powerBtn.style.display = 'none';
            await this.init();
        };
    },

    async init() {
        if (typeof faceapi === 'undefined') {
            this.log("ERROR: face-api no cargó.");
            return;
        }

        try {
            this.log("Cargando cerebro visual...");
            await this.loadModels();
            this.log("Abriendo sensores...");
            await this.startCamera();
            
            this.setupInteractions();
            this.checkApiKey();
            
            this.bootScreen.classList.add('hidden');
            this.isInitialized = true;
            
            this.setExpression('neutral');
            this.startBlinkCycle();
            this.startVisionLoop();
            
            // Iniciar escucha por primera vez
            this.startListening();
            
            this.speak("¡Bip! Sistemas listos. Hola, soy Ron.");
            this.goFullscreen();
        } catch (err) {
            this.log(`ERROR: ${err.message}`);
        }
    },

    async loadModels() {
        const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
        await Promise.all([
            faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
            faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
            faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
        ]);
    },

    async startCamera() {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
        this.video.srcObject = stream;
        return new Promise(res => this.video.onloadedmetadata = res);
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
                this.speak("Cerebro activado.");
            }
        };
    },

    setEyeColor(color) {
        document.documentElement.style.setProperty('--ron-eye-color', color);
    },

    // --- ESCUCHA (v5.2: Recreación total) ---
    startListening() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            this.log("Tu navegador no soporta STT.");
            return;
        }

        // Si ya hay uno activo, lo cerramos
        if (this.recognition) {
            try { this.recognition.abort(); } catch(e) {}
        }

        this.recognition = new SpeechRecognition();
        this.recognition.lang = 'es-ES';
        this.recognition.continuous = false; 

        this.recognition.onstart = () => {
            if (!this.isSpeaking) {
                this.setEyeColor('#00d4ff'); // AZUL brillante
                this.log("¡Oídos abiertos! (Ojos Azules)");
            }
        };

        this.recognition.onresult = (e) => {
            const text = e.results[0][0].transcript;
            const timeSinceLastSpeech = Date.now() - this.lastSpeechEndTime;
            
            if (this.isSpeaking || timeSinceLastSpeech < 1500) return;

            this.log(`He oído: "${text}"`);
            this.chat(text);
        };

        this.recognition.onend = () => {
            // Auto-reinicio inteligente
            if (!this.isSpeaking && this.isInitialized) {
                setTimeout(() => this.startListening(), 500);
            }
        };

        this.recognition.onerror = (e) => {
            if (e.error === 'network') this.log("Error de red en el micro.");
        };

        try { this.recognition.start(); } catch(e) {}
    },

    // --- VISIÓN ---
    async startVisionLoop() {
        setInterval(async () => {
            if (this.isThinking || this.isSpeaking || !this.isInitialized) return;
            try {
                const det = await faceapi.detectAllFaces(this.video, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks().withFaceDescriptors();
                if (det.length > 0) this.processDetections(det[0]);
            } catch(e) {}
        }, 4000);
    },

    async processDetections(detection) {
        const descriptor = detection.descriptor;
        let match = null;
        if (this.knownFaces.length > 0) {
            const matcher = new faceapi.FaceMatcher(this.knownFaces.map(f => new faceapi.LabeledFaceDescriptors(f.label, [new Float32Array(f.descriptor)])));
            const res = matcher.findBestMatch(descriptor);
            if (res.label !== 'unknown') match = res.label;
        }

        if (match) {
            if (this.currentUser !== match) {
                this.currentUser = match;
                this.speak(`¡Hola ${match}!`);
            }
        } else {
            this.currentUser = 'desconocido';
            this.speak("¿Cómo te llamas?");
            const n = prompt("Ron no te conoce. ¿Tu nombre?");
            if (n) {
                this.knownFaces.push({ label: n, descriptor: Array.from(descriptor) });
                localStorage.setItem('ron_known_faces', JSON.stringify(this.knownFaces));
                this.currentUser = n;
                this.speak(`¡Guardado! Hola ${n}.`);
            }
        }
    },

    // --- DIÁLOGO ---
    async chat(text) {
        if (!this.apiKey || this.isThinking) return;
        this.isThinking = true;
        this.setExpression('thinking');
        this.setEyeColor('#ffb703'); // AMARILLO

        try {
            const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: "llama-3.1-8b-instant",
                    messages: [
                        { role: "system", content: "Eres Ron B-Bot. Optimista. Respuestas de máximo 5 palabras." }, 
                        { role: "user", content: text }
                    ]
                })
            });
            const data = await res.json();
            this.isThinking = false;
            this.setExpression('neutral');
            this.speak(data.choices[0].message.content);
        } catch (e) { 
            this.isThinking = false; 
            this.setExpression('glitch');
            this.setEyeColor('#1a1a1a');
        }
    },

    // --- VOZ ---
    speak(text) {
        if (!window.speechSynthesis || !this.isInitialized) return;
        
        this.isSpeaking = true;
        this.setEyeColor('#e63946'); // ROJO
        
        try { if(this.recognition) this.recognition.abort(); } catch(e) {}

        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'es-ES'; u.pitch = 1.8; u.rate = 1.1;
        u.onstart = () => this.setTalking(true);
        u.onend = () => { 
            this.setTalking(false); 
            this.lastSpeechEndTime = Date.now();
            this.isSpeaking = false; 
            this.setEyeColor('#1a1a1a');
            
            this.log("Ron terminó. Reiniciando micro...");
            setTimeout(() => this.startListening(), 1000);
        };
        window.speechSynthesis.speak(u);
    },

    setExpression(exp) {
        this.state = exp;
        [this.eyes.left, this.eyes.right].forEach(el => el.className = 'eye');
        this.stopGlitchEffect();
        if (exp === 'happy') { this.updateMouth('M 5 15 Q 50 45 95 15'); this.eyes.left.classList.add('happy'); this.eyes.right.classList.add('happy'); }
        else if (exp === 'surprise') { this.updateMouth('M 30 25 Q 50 35 70 25'); this.eyes.left.classList.add('surprise'); this.eyes.right.classList.add('surprise'); }
        else if (exp === 'thinking') { this.updateMouth('M 20 20 Q 50 20 80 20'); this.eyes.left.classList.add('flat'); this.eyes.right.classList.add('flat'); this.startGlitchEffect(); }
        else if (exp === 'glitch') { this.startGlitchEffect(); this.eyes.left.classList.add('glitch-left'); this.eyes.right.classList.add('glitch-right'); }
        else { this.updateMouth('M 10 20 Q 50 40 90 20'); }
    },

    startBlinkCycle() {
        const b = () => {
            if (this.state === 'neutral' && !this.isSpeaking) {
                [this.eyes.left, this.eyes.right].forEach(e => e.classList.add('blink'));
                setTimeout(() => [this.eyes.left, this.eyes.right].forEach(e => e.classList.remove('blink')), 150);
            }
            setTimeout(b, Math.random() * 4000 + 2000);
        };
        b();
    },

    startGlitchEffect() {
        this.stopGlitchEffect();
        this.glitchInterval = setInterval(() => {
            const b = document.createElement('div'); b.className = 'glitch-block';
            b.style.width = `${Math.random()*100+20}px`; b.style.height = `${Math.random()*50+10}px`;
            b.style.left = `${Math.random()*100}vw`; b.style.top = `${Math.random()*100}vh`;
            this.glitchOverlay.appendChild(b);
            setTimeout(() => b.remove(), 200);
        }, 150);
    },

    stopGlitchEffect() { clearInterval(this.glitchInterval); this.glitchOverlay.innerHTML = ''; },
    updateMouth(d) { this.mouth.setAttribute('d', d); },
    setTalking(t) { t ? this.mouthContainer.classList.add('mouth-vibrate') : this.mouthContainer.classList.remove('mouth-vibrate'); },
    goFullscreen() { const d = document.documentElement; if (!document.fullscreenElement) (d.requestFullscreen || d.webkitRequestFullScreen).call(d).catch(()=>{}); }
};

window.onload = () => ronFace.preInit();

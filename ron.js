/**
 * Ron B*Bot AI - Versión 7.0 (COMPAÑERO TOTAL: Memoria, Visión Optimizada, Emociones)
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

    // MÁQUINA DE ESTADOS ESTRUCTURAL
    activityState: 'BOOTING', // BOOTING, IDLE, LISTENING, THINKING, SPEAKING
    expressionState: 'neutral', // neutral, happy, surprise, thinking, glitch

    // MEMORIA Y CONTEXTO
    currentUser: null,
    currentEmotion: 'neutral',
    knownFaces: JSON.parse(localStorage.getItem('ron_known_faces') || '[]'),
    conversationHistory: JSON.parse(localStorage.getItem('ron_history') || '[]'),
    apiKey: localStorage.getItem('ron_groq_key'),

    log(msg) {
        console.log(msg);
        if (this.debug) {
            this.debug.innerHTML += `<br>> ${msg}`;
            this.debug.scrollTop = this.debug.scrollHeight;
        }
    },

    async preInit() {
        this.log("Esperando arranque v7.0...");
        if (!this.powerBtn) return;
        this.powerBtn.onclick = async () => {
            this.powerBtn.style.display = 'none';
            await this.init();
        };
    },

    async init() {
        if (typeof faceapi === 'undefined') {
            this.log("ERROR CRÍTICO: face-api no cargó.");
            return;
        }

        try {
            this.log("Cargando Modelos Neuronales (Caras y Emociones)...");
            await this.loadModels();
            this.log("Conectando óptica y audio...");
            await this.startCamera();
            
            this.setupInteractions();
            this.checkApiKey();
            
            this.bootScreen.classList.add('hidden');
            this.changeState('IDLE');
            
            this.setExpression('neutral');
            this.startBlinkCycle();
            this.startVisionLoop();
            
            this.speak("¡Bip! Sistemas al máximo. Memoria y visión conectadas.");
            this.goFullscreen();
        } catch (err) {
            this.log(`FALLO FATAL: ${err.message}`);
            this.setExpression('glitch');
        }
    },

    async loadModels() {
        const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
        await Promise.all([
            faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
            faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
            faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
            faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL) // NUEVO: Emociones
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
                this.speak("¡Cerebro en línea!");
            }
        };
    },

    // --- GESTIÓN DE ESTADOS (MÁQUINA FSM) ---
    changeState(newState) {
        if (this.activityState === newState) return;
        this.activityState = newState;
        
        switch (newState) {
            case 'IDLE':
                this.setEyeColor('#1a1a1a'); // Negro
                // En IDLE, intentamos escuchar tras un descanso prudencial para evitar pitidos
                setTimeout(() => this.startListening(), 2500);
                break;
            case 'LISTENING':
                this.setEyeColor('#00d4ff'); // Azul brillante
                break;
            case 'THINKING':
                this.setEyeColor('#ffb703'); // Amarillo
                if (this.recognition) {
                    try { this.recognition.abort(); } catch(e){} // Apagar micro
                }
                break;
            case 'SPEAKING':
                this.setEyeColor('#e63946'); // Rojo
                if (this.recognition) {
                    try { this.recognition.abort(); } catch(e){} // Apagar micro
                }
                break;
        }
    },

    setEyeColor(color) {
        document.documentElement.style.setProperty('--ron-eye-color', color);
    },

    // --- VISIÓN (CARAS + EMOCIONES) ---
    async startVisionLoop() {
        setInterval(async () => {
            // Solo miramos si no estamos hablando ni pensando
            if (this.activityState === 'THINKING' || this.activityState === 'SPEAKING') return;
            
            try {
                // Ahora detectamos también expresiones (withFaceExpressions)
                const det = await faceapi.detectAllFaces(this.video, new faceapi.TinyFaceDetectorOptions())
                    .withFaceLandmarks()
                    .withFaceExpressions()
                    .withFaceDescriptors();
                
                if (det.length > 0) this.processDetections(det[0]);
            } catch(e) {}
        }, 3000); // Evalúa cada 3 segundos
    },

    async processDetections(detection) {
        const descriptor = detection.descriptor;
        const expressions = detection.expressions;
        
        // Obtener la emoción dominante
        let maxEmotion = 'neutral';
        let maxScore = 0;
        for (const [emotion, score] of Object.entries(expressions)) {
            if (score > maxScore) { maxScore = score; maxEmotion = emotion; }
        }
        
        // Traducción de emociones
        const emDict = { happy: 'feliz', sad: 'triste', angry: 'enfadado', surprised: 'sorprendido', disgusted: 'disgustado', fearful: 'asustado', neutral: 'neutral' };
        this.currentEmotion = emDict[maxEmotion] || 'neutral';

        // Identidad
        let match = null;
        if (this.knownFaces.length > 0) {
            const matcher = new faceapi.FaceMatcher(this.knownFaces.map(f => new faceapi.LabeledFaceDescriptors(f.label, [new Float32Array(f.descriptor)])));
            const res = matcher.findBestMatch(descriptor);
            if (res.label !== 'unknown') match = res.label;
        }

        if (match) {
            if (this.currentUser !== match) {
                this.currentUser = match;
                this.log(`Reconocido: ${match} (${this.currentEmotion})`);
                if (this.activityState === 'IDLE' || this.activityState === 'LISTENING') {
                    this.speak(`¡Hola ${match}! Te veo ${this.currentEmotion}.`);
                }
            }
        } else {
            this.currentUser = 'desconocido';
            if (this.activityState === 'IDLE' || this.activityState === 'LISTENING') {
                this.changeState('THINKING');
                const n = prompt("Ron no te conoce. ¿Cómo te llamas?");
                if (n) {
                    this.knownFaces.push({ label: n, descriptor: Array.from(descriptor) });
                    localStorage.setItem('ron_known_faces', JSON.stringify(this.knownFaces));
                    this.currentUser = n;
                    this.speak(`Amigo ${n} guardado en memoria.`);
                } else {
                    this.changeState('IDLE');
                }
            }
        }
    },

    // --- CAPTURA DE FOTO OPTIMIZADA (VISTA MUNDO) ---
    captureOptimizedFrame() {
        const MAX_SIZE = 320; // Reducido para garantizar que Groq no de timeout
        const canvas = document.createElement('canvas');
        let width = this.video.videoWidth;
        let height = this.video.videoHeight;
        
        if (width > height) {
            if (width > MAX_SIZE) { height *= MAX_SIZE / width; width = MAX_SIZE; }
        } else {
            if (height > MAX_SIZE) { width *= MAX_SIZE / height; height = MAX_SIZE; }
        }
        
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(this.video, 0, 0, width, height);
        
        // JPEG al 60% de calidad = Rápido y ligero
        return canvas.toDataURL('image/jpeg', 0.6); 
    },

    // --- ESCUCHA ---
    startListening() {
        if (this.activityState !== 'IDLE') return;

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) return;

        this.recognition = new SpeechRecognition();
        this.recognition.lang = 'es-ES';
        this.recognition.continuous = true; // EVITAR PITIDOS CONTINUOS EN ANDROID 

        this.recognition.onstart = () => {
            this.changeState('LISTENING');
            this.log("Oídos abiertos.");
        };

        this.recognition.onresult = (e) => {
            if (this.activityState !== 'LISTENING') return; // Seguridad
            const text = e.results[0][0].transcript;
            this.log(`Tú: "${text}"`);
            this.chat(text);
        };

        this.recognition.onend = () => {
            if (this.activityState === 'LISTENING') {
                this.log("Silencio detectado. Pausa antes de reiniciar...");
                this.changeState('IDLE'); 
            }
        };

        try { this.recognition.start(); } catch(e) { this.changeState('IDLE'); }
    },

    // --- DIÁLOGO (MEMORIA Y VISIÓN) ---
    async chat(userText) {
        if (!this.apiKey) return;
        
        this.changeState('THINKING');
        this.setExpression('thinking');

        // Capturar foto optimizada
        const imageData = this.captureOptimizedFrame();

        // Preparar Historial
        const maxHistory = 10; // Recordar últimos 10 turnos (5 preguntas, 5 respuestas)
        let messagesToSend = [
            { 
                role: "system", 
                content: `Eres Ron B-Bot, un compañero robot de la película 'Ron da error'. Eres optimista, literal, leal y un poco torpe. Tu usuario actual es ${this.currentUser || 'Desconocido'}. La cámara detecta que el usuario está ${this.currentEmotion}. Tienes memoria de conversaciones pasadas. Se te adjunta una imagen de lo que ves AHORA MISMO a través de la cámara. Responde basándote en la imagen si el usuario pregunta algo visual, o en la memoria si pregunta sobre el pasado. Se muy conciso y directo, respuestas cortas y divertidas. Usa '¡Bip!'.` 
            }
        ];

        // Añadir memoria antigua
        this.conversationHistory.slice(-maxHistory).forEach(msg => {
            messagesToSend.push({ role: msg.role, content: msg.content });
        });

        // Añadir mensaje actual con la FOTO
        messagesToSend.push({
            role: "user",
            content: [
                { type: "text", text: userText },
                { type: "image_url", image_url: { url: imageData } }
            ]
        });

        try {
            const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: "llama-3.2-11b-vision-preview",
                    messages: messagesToSend
                })
            });
            const data = await res.json();
            
            if (data.error) throw new Error(data.error.message);

            const botResponse = data.choices[0].message.content;
            
            // Guardar en memoria
            this.conversationHistory.push({ role: "user", content: userText });
            this.conversationHistory.push({ role: "assistant", content: botResponse });
            // Limpiar memoria vieja
            if (this.conversationHistory.length > 20) this.conversationHistory = this.conversationHistory.slice(-20);
            localStorage.setItem('ron_history', JSON.stringify(this.conversationHistory));

            this.speak(botResponse);
        } catch (e) { 
            this.log(`Cerebro ocupado/fallo: ${e.message}`);
            this.setExpression('glitch');
            this.speak("¡Bip! He tenido un fallo al procesar la imagen. ¿Puedes repetirlo?");
        }
    },

    // --- VOZ ---
    speak(text) {
        if (!window.speechSynthesis) {
            this.changeState('IDLE');
            return;
        }
        
        this.changeState('SPEAKING');
        this.setExpression('neutral');
        
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'es-ES'; u.pitch = 1.8; u.rate = 1.1;
        
        u.onstart = () => this.setTalking(true);
        u.onend = () => { 
            this.setTalking(false); 
            // Dar tiempo al sonido a morir antes de escuchar de nuevo
            setTimeout(() => {
                this.changeState('IDLE');
            }, 1000); 
        };
        
        // Fallback por si la voz se cuelga (bug de navegadores)
        setTimeout(() => {
            if (this.activityState === 'SPEAKING' && !window.speechSynthesis.speaking) {
                this.setTalking(false);
                this.changeState('IDLE');
            }
        }, Math.max(text.length * 100, 3000));

        window.speechSynthesis.speak(u);
    },

    setExpression(exp) {
        this.expressionState = exp;
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
            if (this.expressionState === 'neutral' && this.activityState !== 'SPEAKING') {
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

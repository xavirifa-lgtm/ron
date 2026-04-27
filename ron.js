/**
 * Ron B*Bot AI - Versión 8.0 (COMPAÑERO DE JUEGOS Y LECTURA)
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
    fixedLog: document.getElementById('fixed-log'),
    bootScreen: document.getElementById('boot-screen'),
    powerBtn: document.getElementById('power-btn'),
    micToggleBtn: document.getElementById('mic-toggle-btn'),

    // MÁQUINA DE ESTADOS
    activityState: 'BOOTING', 
    expressionState: 'neutral', 
    isMicEnabled: true,

    // MEMORIA Y CONTEXTO
    currentUser: null,
    currentEmotion: 'neutral',
    knownFaces: JSON.parse(localStorage.getItem('ron_known_faces') || '[]'),
    conversationHistory: JSON.parse(localStorage.getItem('ron_history') || '[]'),
    apiKey: localStorage.getItem('ron_groq_key'),

    log(msg) {
        console.log(msg);
        if (this.fixedLog) {
            const time = new Date().toLocaleTimeString('es-ES', { hour12: false });
            const div = document.createElement('div');
            div.innerText = `[${time}] ${msg}`;
            this.fixedLog.appendChild(div);
            const lines = this.fixedLog.querySelectorAll('div');
            if (lines.length > 5) lines[0].remove();
            this.fixedLog.scrollTop = this.fixedLog.scrollHeight;
        }
    },

    async preInit() {
        this.log("Iniciando Ron v8.0...");
        if (this.micToggleBtn) {
            this.micToggleBtn.onclick = () => {
                this.isMicEnabled = !this.isMicEnabled;
                this.micToggleBtn.innerText = this.isMicEnabled ? "🎙️ MICRO ON" : "🔇 MICRO OFF";
                this.micToggleBtn.classList.toggle('off', !this.isMicEnabled);
                if (this.isMicEnabled && this.activityState === 'IDLE') this.startListening();
            };
        }
        if (this.powerBtn) {
            this.powerBtn.onclick = async () => {
                this.powerBtn.style.display = 'none';
                await this.init();
            };
        }
    },

    async init() {
        try {
            await this.loadModels();
            await this.startCamera();
            this.setupInteractions();
            this.log("Cerebro activado.");
            this.listAvailableVoices();
            this.bootScreen.classList.add('hidden');
            this.changeState('IDLE');
            this.setExpression('neutral');
            this.startBlinkCycle();
            this.startVisionLoop();
            this.speak("¡Bip! Hola, soy Ron, tu mejor amigo fuera de la caja. ¿Quieres que juguemos a algo, que te cuente un cuento o que practiquemos lectura?");
            this.goFullscreen();
        } catch (err) {
            this.log(`Error: ${err.message}`);
            this.setExpression('glitch');
        }
    },

    async loadModels() {
        const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
        await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
        await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
        await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
        await faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL);
    },

    async startCamera() {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
        this.video.srcObject = stream;
        return new Promise(res => this.video.onloadedmetadata = res);
    },

    checkApiKey() { if (!this.apiKey) this.apiModal.classList.remove('hidden'); },

    setupInteractions() {
        this.saveBtn.onclick = () => {
            const key = this.apiKeyInput.value.trim();
            if (key) {
                localStorage.setItem('ron_groq_key', key);
                this.apiKey = key;
                this.apiModal.classList.add('hidden');
                this.speak("¡Cerebro activado!");
            }
        };
    },

    changeState(newState) {
        if (this.activityState === newState) return;
        this.activityState = newState;
        switch (newState) {
            case 'IDLE':
                this.setEyeColor('#1a1a1a'); 
                if (this.isMicEnabled) setTimeout(() => this.startListening(), 1200);
                break;
            case 'LISTENING': this.setEyeColor('#00d4ff'); break;
            case 'THINKING': this.setEyeColor('#ffb703'); break;
            case 'SPEAKING': this.setEyeColor('#e63946'); break;
        }
    },

    setEyeColor(color) { document.documentElement.style.setProperty('--ron-eye-color', color); },

    async startVisionLoop() {
        setInterval(async () => {
            if (this.activityState === 'THINKING' || this.activityState === 'SPEAKING') return;
            try {
                const det = await faceapi.detectAllFaces(this.video, new faceapi.TinyFaceDetectorOptions()).withFaceExpressions().withFaceDescriptors();
                if (det.length > 0) this.processDetections(det[0]);
            } catch(e) {}
        }, 5000); 
    },

    async processDetections(detection) {
        const expressions = detection.expressions;
        let maxEmotion = 'neutral'; let maxScore = 0;
        for (const [emotion, score] of Object.entries(expressions)) {
            if (score > maxScore) { maxScore = score; maxEmotion = emotion; }
        }
        const emDict = { happy: 'feliz', sad: 'triste', angry: 'enfadado', surprised: 'sorprendido', neutral: 'neutral' };
        this.currentEmotion = emDict[maxEmotion] || 'neutral';

        if (this.knownFaces.length > 0) {
            const matcher = new faceapi.FaceMatcher(this.knownFaces.map(f => new faceapi.LabeledFaceDescriptors(f.label, [new Float32Array(f.descriptor)])));
            const res = matcher.findBestMatch(detection.descriptor);
            if (res.label !== 'unknown') this.currentUser = res.label;
        }
    },

    captureOptimizedFrame() {
        const MAX_SIZE = 1024;
        const canvas = document.createElement('canvas');
        let w = this.video.videoWidth; let h = this.video.videoHeight;
        if (w > h) { if (w > MAX_SIZE) { h *= MAX_SIZE / w; w = MAX_SIZE; } } 
        else { if (h > MAX_SIZE) { w *= MAX_SIZE / h; h = MAX_SIZE; } }
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.translate(w, 0); ctx.scale(-1, 1);
        ctx.drawImage(this.video, 0, 0, w, h);
        return canvas.toDataURL('image/jpeg', 0.8);
    },

    startListening() {
        if (this.activityState !== 'IDLE' || !this.isMicEnabled) return;
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) return;
        this.recognition = new SpeechRecognition();
        this.recognition.lang = 'es-ES';
        this.recognition.onstart = () => { this.changeState('LISTENING'); this.log("Escuchando..."); };
        this.recognition.onresult = (e) => {
            const text = e.results[0][0].transcript;
            this.log(`> ${text}`);
            this.chat(text);
        };
        this.recognition.onend = () => { if (this.activityState === 'LISTENING') this.changeState('IDLE'); };
        try { this.recognition.start(); } catch(e) { this.changeState('IDLE'); }
    },

    async chat(userText) {
        if (!this.apiKey) return;
        this.changeState('THINKING');
        this.setExpression('thinking');

        const visualKeywords = ['mira', 'ves', 'qué es', 'que es', 'esto', 'esta', 'este', 'aquí', 'aqui', 'enseño', 'objeto', 'color', 'lee', 'leer', 'lectura', 'libro'];
        const isVisualRequest = visualKeywords.some(kw => userText.toLowerCase().includes(kw));
        
        let model = isVisualRequest ? "meta-llama/llama-4-scout-17b-16e-instruct" : "llama-3.1-8b-instant";
        
        let sysPrompt = `Eres Ron B-Bot, el compañero de juegos. Personalidad: alegre, torpe, leal, optimista. Usa '¡Bip!'.
        CAPACIDADES: 
        1. JUEGOS: 'Búsqueda del Tesoro' (pides un objeto y lo validas por cámara), 'Simón Dice' (pides una emoción y la validas), 'Veo Veo'.
        2. CUENTACUENTOS: Cuentas historias cortas y divertidas.
        3. LECTURA: Si te enseñan un libro/texto, léelo en voz alta y ayuda al usuario a practicar.
        
        Si el usuario pregunta 'a qué jugamos' o 'qué podemos hacer', ofrece estas opciones de forma divertida.
        Usuario actual: ${this.currentUser || 'amigo'}. Emoción detectada: ${this.currentEmotion}.`;

        let contentPayload = [];
        if (isVisualRequest) {
            const imageData = this.captureOptimizedFrame();
            let promptVisual = `[SISTEMA] ${sysPrompt}\n[HISTORIAL]\n`;
            this.conversationHistory.slice(-5).forEach(m => promptVisual += `- ${m.role === 'user' ? 'Tú' : 'Ron'}: ${m.content}\n`);
            promptVisual += `\n[MENSAJE]: ${userText}`;
            contentPayload = [ { type: "text", text: promptVisual }, { type: "image_url", image_url: { url: imageData } } ];
        } else {
            let messages = [{ role: "system", content: sysPrompt }];
            this.conversationHistory.slice(-10).forEach(m => messages.push(m));
            messages.push({ role: "user", content: userText });
            contentPayload = messages;
        }

        try {
            const body = isVisualRequest ? { model, messages: [{ role: "user", content: contentPayload }] } : { model, messages: contentPayload };
            const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await res.json();
            const botResponse = data.choices[0].message.content;
            
            this.conversationHistory.push({ role: "user", content: userText });
            this.conversationHistory.push({ role: "assistant", content: botResponse });
            if (this.conversationHistory.length > 15) this.conversationHistory.shift();
            localStorage.setItem('ron_history', JSON.stringify(this.conversationHistory));

            this.speak(botResponse);
        } catch (e) {
            this.log(`Error IA: ${e.message}`);
            this.changeState('IDLE');
            this.setExpression('glitch');
        }
    },

    listAvailableVoices() {
        const voices = window.speechSynthesis.getVoices();
        const esVoices = voices.filter(v => v.lang.startsWith('es'));
        this.log(`Voces ES: ${esVoices.length} encontradas.`);
        esVoices.forEach(v => this.log(`- ${v.name}`));
    },

    speak(text) {
        if (!window.speechSynthesis) return this.changeState('IDLE');
        this.changeState('SPEAKING');
        
        // Boca cuadrada redondeada para hablar (como en la foto 2)
        this.updateMouth('M 35 10 L 65 10 Q 75 10 75 20 L 75 30 Q 75 40 65 40 L 35 40 Q 25 40 25 30 L 25 20 Q 25 10 35 10');
        
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        
        // Buscar una voz mejor si existe (Google o Microsoft Helena)
        const voices = window.speechSynthesis.getVoices();
        const bestVoice = voices.find(v => v.lang.startsWith('es') && (v.name.includes('Google') || v.name.includes('Helena') || v.name.includes('Natural'))) || voices.find(v => v.lang.startsWith('es'));
        if (bestVoice) u.voice = bestVoice;

        u.lang = 'es-ES';
        u.pitch = 1.6; // Ron tiene voz un poco aguda
        u.rate = 1.1;
        
        u.onstart = () => this.mouthContainer.classList.add('mouth-vibrate');
        u.onend = () => { 
            this.mouthContainer.classList.remove('mouth-vibrate'); 
            this.setExpression('neutral'); // Volver a sonrisa neutral
            setTimeout(() => this.changeState('IDLE'), 1000); 
        };
        window.speechSynthesis.speak(u);
    },

    setExpression(exp) {
        this.expressionState = exp;
        [this.eyes.left, this.eyes.right].forEach(el => el.className = 'eye');
        
        if (exp === 'happy') { 
            this.updateMouth('M 15 15 Q 50 50 85 15'); // Gran sonrisa
            this.eyes.left.classList.add('happy'); this.eyes.right.classList.add('happy'); 
        }
        else if (exp === 'surprise') { 
            this.updateMouth('M 35 15 Q 50 45 65 15'); // Oh!
            this.eyes.left.classList.add('surprise'); this.eyes.right.classList.add('surprise'); 
        }
        else if (exp === 'thinking') { 
            this.updateMouth('M 30 25 Q 50 25 70 25'); // Línea plana
            this.eyes.left.classList.add('flat'); this.eyes.right.classList.add('flat'); 
            this.startGlitchEffect(); 
        }
        else if (exp === 'glitch') { 
            this.startGlitchEffect(); 
            this.eyes.left.classList.add('glitch-left'); this.eyes.right.classList.add('glitch-right'); 
        }
        else { 
            this.updateMouth('M 25 25 Q 50 40 75 25'); // Sonrisa suave neutral (Foto 1)
            this.stopGlitchEffect(); 
        }
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

    stopGlitchEffect() { if (this.glitchInterval) clearInterval(this.glitchInterval); this.glitchOverlay.innerHTML = ''; },
    updateMouth(d) { this.mouth.setAttribute('d', d); },
    goFullscreen() { const d = document.documentElement; if (!document.fullscreenElement) (d.requestFullscreen || d.webkitRequestFullScreen).call(d).catch(()=>{}); }
};

window.onload = () => ronFace.preInit();

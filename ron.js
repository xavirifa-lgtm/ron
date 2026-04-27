/**
 * Ron B*Bot AI - Versión 8.7 (CEREBRO LOCAL + NUBE OPTIMIZADA)
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

    // ESTADO
    activityState: 'BOOTING', 
    expressionState: 'neutral', 
    isMicEnabled: true,
    isLearningFace: false,
    tempDescriptor: null,

    // MEMORIA LOCAL (Pura)
    currentUser: null, // Nombre de la persona identificada por face-api
    currentEmotion: 'neutral',
    knownFaces: JSON.parse(localStorage.getItem('ron_known_faces') || '[]'),
    userHistories: JSON.parse(localStorage.getItem('ron_user_histories') || '{}'),
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
        this.log("Sincronizando Ron v8.7...");
        window.speechSynthesis.onvoiceschanged = () => this.listAvailableVoices();
        
        this.powerBtn.onclick = async () => {
            this.powerBtn.style.display = 'none';
            await this.init();
        };
        
        this.micToggleBtn.onclick = () => {
            this.isMicEnabled = !this.isMicEnabled;
            this.micToggleBtn.innerText = this.isMicEnabled ? "🎙️ MICRO ON" : "🔇 MICRO OFF";
            this.micToggleBtn.classList.toggle('off', !this.isMicEnabled);
            if (this.isMicEnabled && this.activityState === 'IDLE') this.startListening();
        };
    },

    async init() {
        try {
            await this.loadModels();
            await this.startCamera();
            this.setupInteractions();
            this.bootScreen.classList.add('hidden');
            this.changeState('IDLE');
            this.setExpression('neutral');
            this.startBlinkCycle();
            this.startVisionLoop();
            this.speak("¡Bip! Hola. Estoy listo para reconocerte.");
            this.goFullscreen();
        } catch (err) {
            this.log(`Error: ${err.message}`);
            this.setExpression('glitch');
        }
    },

    async loadModels() {
        const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
        await Promise.all([
            faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
            faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
            faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
            faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL)
        ]);
    },

    async startCamera() {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
        this.video.srcObject = stream;
        return new Promise(res => this.video.onloadedmetadata = res);
    },

    setupInteractions() {
        this.saveBtn.onclick = () => {
            const key = this.apiKeyInput.value.trim();
            if (key) {
                localStorage.setItem('ron_groq_key', key);
                this.apiKey = key;
                this.apiModal.classList.add('hidden');
                this.speak("¡Cerebro listo!");
            }
        };
    },

    listAvailableVoices() {
        const voices = window.speechSynthesis.getVoices();
        const esVoices = voices.filter(v => v.lang.startsWith('es'));
        if (esVoices.length > 0) this.log(`Voces ES: ${esVoices.length}`);
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

    // --- IDENTIFICACIÓN 100% LOCAL ---
    async startVisionLoop() {
        setInterval(async () => {
            if (this.activityState === 'THINKING' || this.activityState === 'SPEAKING' || this.isLearningFace) return;
            try {
                const det = await faceapi.detectAllFaces(this.video, new faceapi.TinyFaceDetectorOptions()).withFaceExpressions().withFaceDescriptors();
                
                if (det.length > 0) {
                    const d = det[0];
                    // Emoción
                    const expressions = d.expressions;
                    let maxEmotion = 'neutral'; let maxScore = 0;
                    for (const [emotion, score] of Object.entries(expressions)) {
                        if (score > maxScore) { maxScore = score; maxEmotion = emotion; }
                    }
                    const emDict = { happy: 'feliz', sad: 'triste', angry: 'enfadado', surprised: 'sorprendido', neutral: 'neutral' };
                    this.currentEmotion = emDict[maxEmotion] || 'neutral';

                    // Identidad
                    let name = null;
                    if (this.knownFaces.length > 0) {
                        const matcher = new faceapi.FaceMatcher(this.knownFaces.map(f => new faceapi.LabeledFaceDescriptors(f.label, [new Float32Array(f.descriptor)])));
                        const res = matcher.findBestMatch(d.descriptor);
                        if (res.label !== 'unknown') name = res.label;
                    }

                    if (name) {
                        if (this.currentUser !== name) {
                            this.currentUser = name;
                            this.log(`Hola, ${name}`);
                            this.speak(`¡Bip! Hola ${name}, qué alegría verte de nuevo.`);
                        }
                    } else if (!this.isLearningFace) {
                        // Desconocido
                        this.currentUser = null;
                        this.tempDescriptor = Array.from(d.descriptor);
                        this.isLearningFace = true;
                        this.speak("¡Bip! Hola. No te conozco. ¿Cómo te llamas?");
                    }
                } else {
                    this.currentUser = null;
                }
            } catch(e) {}
        }, 3000); 
    },

    startListening() {
        if (this.activityState !== 'IDLE' || !this.isMicEnabled) return;
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) return;
        this.recognition = new SpeechRecognition();
        this.recognition.lang = 'es-ES';
        this.recognition.onstart = () => { this.changeState('LISTENING'); };
        this.recognition.onresult = (e) => {
            const text = e.results[0][0].transcript;
            this.log(`U: ${text}`);
            if (this.isLearningFace && this.tempDescriptor) {
                this.saveNewUser(text);
            } else {
                this.handleInput(text);
            }
        };
        this.recognition.onend = () => { if (this.activityState === 'LISTENING') this.changeState('IDLE'); };
        try { this.recognition.start(); } catch(e) { this.changeState('IDLE'); }
    },

    saveNewUser(text) {
        const name = text.replace(/me llamo |mi nombre es /gi, "").trim();
        this.knownFaces.push({ label: name, descriptor: this.tempDescriptor });
        localStorage.setItem('ron_known_faces', JSON.stringify(this.knownFaces));
        this.currentUser = name;
        this.isLearningFace = false;
        this.tempDescriptor = null;
        this.speak(`¡Encantado de conocerte, ${name}! Te he guardado en mi base de datos. ¿Qué quieres hacer?`);
    },

    // --- MANEJO DE ENTRADA (LOCAL VS NUBE) ---
    async handleInput(userText) {
        const textLower = userText.toLowerCase();

        // 1. Preguntas de Identidad (RESPUESTA LOCAL INSTANTÁNEA)
        if (textLower.includes("quién soy") || textLower.includes("sabes quién soy") || textLower.includes("sabes mi nombre")) {
            if (this.currentUser) {
                this.speak(`¡Bip! Claro que lo sé. Eres ${this.currentUser} y hoy te veo un poco ${this.currentEmotion}.`);
            } else {
                this.speak("¡Bip! Aún no estoy seguro de quién eres. ¿Me lo recuerdas?");
            }
            return;
        }

        // 2. Preguntas sobre qué puede hacer
        if (textLower.includes("qué puedes hacer") || textLower.includes("que puedes hacer")) {
            this.speak("¡Bip! Puedo jugar a la búsqueda del tesoro, contarte cuentos o ayudarte a leer tus libros. ¡Tú decides!");
            return;
        }

        // 3. Todo lo demás va a Groq (Híbrido)
        this.chat(userText);
    },

    async chat(userText) {
        if (!this.apiKey) return;
        this.changeState('THINKING');
        this.setExpression('thinking');

        const visualKeywords = ['mira', 'ves', 'qué es', 'que es', 'esto', 'esta', 'este', 'aquí', 'aqui', 'enseño', 'objeto', 'color', 'lee', 'leer', 'libro'];
        const isVisualRequest = visualKeywords.some(kw => userText.toLowerCase().includes(kw));
        
        let model = isVisualRequest ? "meta-llama/llama-4-scout-17b-16e-instruct" : "llama-3.1-8b-instant";
        const userKey = this.currentUser || 'amigo_desconocido';
        if (!this.userHistories[userKey]) this.userHistories[userKey] = [];
        let history = this.userHistories[userKey];

        let sysPrompt = `Eres Ron B-Bot. Alegre, torpe, leal. 
        IMPORTANTE: Estás hablando con ${userKey}. Si te enseña algo, es un OBJETO, no lo confundas con el usuario.
        Usuario: ${userKey}. Emoción: ${this.currentEmotion}.
        Si el niño pide algo imposible, di que no puedes de forma graciosa.`;

        let body = { model, messages: [] };
        if (isVisualRequest) {
            const imageData = this.captureOptimizedFrame();
            let p = `[SISTEMA] ${sysPrompt}\n[HISTORIAL CON ${userKey}]\n`;
            history.slice(-5).forEach(m => p += `- ${m.role==='user'?'Tú':'Ron'}: ${m.content}\n`);
            p += `\n[MENSAJE]: ${userText}`;
            body.messages = [{ role: "user", content: [ { type: "text", text: p }, { type: "image_url", image_url: { url: imageData } } ] }];
        } else {
            body.messages = [{ role: "system", content: sysPrompt }];
            history.slice(-10).forEach(m => body.messages.push(m));
            body.messages.push({ role: "user", content: userText });
        }

        try {
            const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await res.json();
            if (!data.choices?.[0]) throw new Error();
            const botResponse = data.choices[0].message.content;
            
            history.push({ role: "user", content: userText });
            history.push({ role: "assistant", content: botResponse });
            if (history.length > 20) history = history.slice(-20);
            this.userHistories[userKey] = history;
            localStorage.setItem('ron_user_histories', JSON.stringify(this.userHistories));

            this.speak(botResponse);
        } catch (e) {
            this.log("Fallo IA.");
            this.speak("¡Bip! He tenido un cortocircuito mental. ¿Puedes repetir?");
            this.changeState('IDLE');
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

    speak(text) {
        if (!window.speechSynthesis) return this.changeState('IDLE');
        this.changeState('SPEAKING');
        this.updateMouth('M 35 10 L 65 10 Q 75 10 75 20 L 75 30 Q 75 40 65 40 L 35 40 Q 25 40 25 30 L 25 20 Q 25 10 35 10');
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        const voices = window.speechSynthesis.getVoices();
        const bestVoice = voices.find(v => v.lang.startsWith('es') && (v.name.includes('Google') || v.name.includes('Natural'))) || voices.find(v => v.lang.startsWith('es'));
        if (bestVoice) u.voice = bestVoice;
        u.lang = 'es-ES'; u.pitch = 1.6; u.rate = 1.1;
        u.onstart = () => this.mouthContainer.classList.add('mouth-vibrate');
        u.onend = () => { this.mouthContainer.classList.remove('mouth-vibrate'); this.setExpression('neutral'); setTimeout(() => this.changeState('IDLE'), 1000); };
        window.speechSynthesis.speak(u);
    },

    setExpression(exp) {
        this.expressionState = exp;
        [this.eyes.left, this.eyes.right].forEach(el => el.className = 'eye');
        if (exp === 'thinking') { this.updateMouth('M 30 25 Q 50 25 70 25'); this.eyes.left.classList.add('flat'); this.eyes.right.classList.add('flat'); this.startGlitchEffect(); }
        else if (exp === 'glitch') { this.startGlitchEffect(); this.eyes.left.classList.add('glitch-left'); this.eyes.right.classList.add('glitch-right'); }
        else { this.updateMouth('M 25 25 Q 50 40 75 25'); this.stopGlitchEffect(); }
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

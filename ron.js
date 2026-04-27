/**
 * Ron B*Bot AI - Versión 9.6 (SÚPER ESTABLE)
 */

const ronFace = {
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

    activityState: 'BOOTING', 
    expressionState: 'neutral', 
    isMicEnabled: true,
    isLearningFace: false,
    tempDescriptor: null,

    currentUser: null,
    currentEmotion: 'neutral',
    lastEmotion: 'neutral',
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
        this.log("Encendiendo v9.6 estable...");
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
            this.speak("¡Bip! Estoy de vuelta. Mis sistemas están ahora al cien por cien de estabilidad.");
            this.goFullscreen();
        } catch (err) {
            this.log(`Error: ${err.message}`);
            this.setExpression('glitch');
        }
    },

    async loadModels() {
        const URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
        await Promise.all([
            faceapi.nets.tinyFaceDetector.loadFromUri(URL),
            faceapi.nets.faceLandmark68Net.loadFromUri(URL),
            faceapi.nets.faceRecognitionNet.loadFromUri(URL),
            faceapi.nets.faceExpressionNet.loadFromUri(URL)
        ]);
    },

    async startCamera() {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
        this.video.srcObject = stream;
        await this.video.play();
        return new Promise(res => this.video.onloadedmetadata = res);
    },

    setupInteractions() {
        this.saveBtn.onclick = () => {
            const k = this.apiKeyInput.value.trim();
            if (k) {
                localStorage.setItem('ron_groq_key', k);
                this.apiKey = k;
                this.apiModal.classList.add('hidden');
                this.speak("¡Cerebro conectado!");
            }
        };
        if (!this.apiKey) this.apiModal.classList.remove('hidden');
    },

    listAvailableVoices() {
        const voices = window.speechSynthesis.getVoices();
        const es = voices.filter(v => v.lang.startsWith('es'));
        if (es.length > 0) console.log(`Voces ES: ${es.length}`);
    },

    changeState(newState) {
        if (this.activityState === newState) return;
        this.activityState = newState;
        switch (newState) {
            case 'IDLE':
                this.setEyeColor('#1a1a1a'); 
                if (this.isMicEnabled) setTimeout(() => this.startListening(), 1000);
                break;
            case 'LISTENING': this.setEyeColor('#00d4ff'); break;
            case 'THINKING': this.setEyeColor('#ffb703'); break;
            case 'SPEAKING': this.setEyeColor('#e63946'); break;
        }
    },

    setEyeColor(color) { document.documentElement.style.setProperty('--ron-eye-color', color); },

    async startVisionLoop() {
        setInterval(async () => {
            if (this.activityState === 'THINKING' || this.activityState === 'SPEAKING' || this.isLearningFace) return;
            try {
                const detections = await faceapi.detectAllFaces(this.video, new faceapi.TinyFaceDetectorOptions())
                    .withFaceLandmarks().withFaceExpressions().withFaceDescriptors();
                
                if (detections.length > 0) {
                    const d = detections[0];
                    const exp = d.expressions;
                    let maxE = 'neutral'; let maxS = 0;
                    for (const [e, s] of Object.entries(exp)) { if (s > maxS) { maxS = s; maxE = e; } }
                    const emDict = { happy: 'feliz', sad: 'triste', angry: 'enfadado', surprised: 'sorprendido', neutral: 'neutral' };
                    const emotionNow = emDict[maxE] || 'neutral';
                    this.currentEmotion = emotionNow;

                    let found = null;
                    if (this.knownFaces.length > 0) {
                        const matcher = new faceapi.FaceMatcher(this.knownFaces.map(f => new faceapi.LabeledFaceDescriptors(f.label, [new Float32Array(f.descriptor)])), 0.6);
                        const res = matcher.findBestMatch(d.descriptor);
                        if (res.label !== 'unknown') found = res.label;
                    }

                    if (found) {
                        if (this.currentUser !== found) {
                            this.currentUser = found;
                            this.setExpression(this.currentEmotion === 'feliz' ? 'happy' : 'neutral');
                            this.speak(`¡Bip! Hola ${found}, qué alegría verte. Te veo ${this.currentEmotion}.`);
                        } else if (this.currentEmotion !== this.lastEmotion) {
                            if (this.currentEmotion === 'triste' || this.currentEmotion === 'enfadado') {
                                this.setExpression('fear');
                                this.speak(`¡Oh, bip! ${this.currentUser}, ahora te veo un poco ${this.currentEmotion}. ¿Te ha pasado algo?`);
                            } else if (this.currentEmotion === 'feliz') {
                                this.setExpression('happy');
                                this.speak(`¡Bip! ¡Qué bien! Ahora te veo muy feliz, ${this.currentUser}.`);
                            } else if (this.currentEmotion === 'sorprendido') {
                                this.setExpression('star');
                                this.speak(`¡Bip! ¡Wala! ¿Qué ha pasado?`);
                            }
                        }
                    } else if (!this.isLearningFace) {
                        this.tempDescriptor = Array.from(d.descriptor);
                        this.isLearningFace = true;
                        this.speak("¡Bip! Hola. No te conozco. ¿Cómo te llamas?");
                    }
                    this.lastEmotion = this.currentEmotion;
                }
            } catch(e) {}
        }, 4000); 
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
            this.log(`> ${text}`);
            if (this.isLearningFace && this.tempDescriptor) this.saveNewUser(text);
            else this.handleInput(text);
        };
        this.recognition.onend = () => { if (this.activityState === 'LISTENING') this.changeState('IDLE'); };
        try { this.recognition.start(); } catch(e) { this.changeState('IDLE'); }
    },

    saveNewUser(text) {
        const name = text.replace(/me llamo |soy |mi nombre es /gi, "").trim();
        this.knownFaces.push({ label: name, descriptor: this.tempDescriptor });
        localStorage.setItem('ron_known_faces', JSON.stringify(this.knownFaces));
        this.currentUser = name;
        this.isLearningFace = false;
        this.tempDescriptor = null;
        this.speak(`¡Bip! Encantado, ${name}. Ya te tengo en mi memoria.`);
    },

    handleInput(text) {
        const t = text.toLowerCase();
        if (t.includes("quién soy") || t.includes("sabes mi nombre")) {
            return this.speak(this.currentUser ? `Eres ${this.currentUser}.` : "Aún no te conozco.");
        }
        if (t.includes("qué puedes hacer") || t.includes("que puedes hacer")) {
            return this.speak("Puedo jugar, contarte cuentos o ayudarte a leer libros. ¡Tú decides!");
        }
        this.chat(text);
    },

    async chat(userText) {
        if (!this.apiKey) return;
        this.changeState('THINKING');
        this.setExpression('thinking');

        const visualKeywords = ['mira', 'ves', 'qué es', 'que es', 'esto', 'esta', 'este', 'aquí', 'aqui', 'enseño', 'objeto', 'color', 'lee', 'leer', 'libro', 'tengo'];
        const isV = visualKeywords.some(kw => userText.toLowerCase().includes(kw));
        
        let model = isV ? "meta-llama/llama-4-scout-17b-16e-instruct" : "llama-3.1-8b-instant";
        const userKey = this.currentUser || 'amigo';
        if (!this.userHistories[userKey]) this.userHistories[userKey] = [];
        let history = this.userHistories[userKey];

        let sys = `Eres Ron B-Bot. Alegre, torpe y empático. Hablas con ${userKey}. Usa '¡Bip!'. Ahora estás viendo que está ${this.currentEmotion}.`;

        let body = { model, messages: [] };
        if (isV) {
            const img = this.captureOptimizedFrame();
            let p = `[SISTEMA] ${sys}\n[MENSAJE ACTUAL]: ${userText}`;
            body.messages = [{ role: "user", content: [ { type: "text", text: p }, { type: "image_url", image_url: { url: img } } ] }];
        } else {
            body.messages = [{ role: "system", content: sys }];
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
            const resp = data.choices[0].message.content;
            
            history.push({ role: "user", content: userText });
            history.push({ role: "assistant", content: resp });
            if (history.length > 15) history.shift();
            this.userHistories[userKey] = history;
            localStorage.setItem('ron_user_histories', JSON.stringify(this.userHistories));
            this.speak(resp);
        } catch (e) {
            this.log("Error IA");
            this.speak("¡Bip! He tenido un fallo mental. ¿Puedes repetir?");
            this.changeState('IDLE');
        }
    },

    captureOptimizedFrame() {
        document.body.style.backgroundColor = "white";
        setTimeout(() => document.body.style.backgroundColor = "", 100);
        const MAX = 1024;
        const canvas = document.createElement('canvas');
        let w = this.video.videoWidth || 640; let h = this.video.videoHeight || 480;
        if (w > h) { if (w > MAX) { h *= MAX / w; w = MAX; } } 
        else { if (h > MAX) { w *= MAX / h; h = MAX; } }
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(this.video, 0, 0, w, h);
        return canvas.toDataURL('image/jpeg', 0.8);
    },

    speak(text) {
        if (!window.speechSynthesis) return this.changeState('IDLE');
        this.changeState('SPEAKING');
        this.updateMouth('M 30 10 L 70 10 Q 75 10 72 30 L 55 45 Q 50 48 45 45 L 28 30 Q 25 10 30 10 Z');
        
        const eyeMoveInterval = setInterval(() => {
            if (this.activityState === 'SPEAKING') this.shiftEyes();
            else clearInterval(eyeMoveInterval);
        }, 400);

        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        const voices = window.speechSynthesis.getVoices();
        const best = voices.find(v => v.lang.startsWith('es') && (v.name.includes('Google') || v.name.includes('Natural'))) || voices.find(v => v.lang.startsWith('es'));
        if (best) u.voice = best;
        u.lang = 'es-ES'; u.pitch = 2.0; u.rate = 1.1;
        u.onstart = () => this.mouthContainer.classList.add('mouth-vibrate');
        u.onend = () => { this.mouthContainer.classList.remove('mouth-vibrate'); this.setExpression('neutral'); setTimeout(() => this.changeState('IDLE'), 1000); };
        window.speechSynthesis.speak(u);
    },

    setExpression(exp) {
        this.expressionState = exp;
        [this.eyes.left, this.eyes.right].forEach(el => {
            el.className = 'eye';
            el.style.transform = ''; 
        });

        if (exp === 'happy') { 
            this.updateMouth('M 15 25 Q 50 55 85 25 Q 50 45 15 25 Z');
            this.eyes.left.classList.add('happy'); this.eyes.right.classList.add('happy'); 
        }
        else if (exp === 'surprise' || exp === 'star') { 
            this.updateMouth('M 35 20 Q 50 50 65 20 Q 50 40 35 20 Z');
            this.eyes.left.classList.add(exp === 'star' ? 'star' : 'surprise'); 
            this.eyes.right.classList.add(exp === 'star' ? 'star' : 'surprise'); 
        }
        else if (exp === 'fear') {
            this.updateMouth('M 30 35 Q 50 25 70 35 Q 50 45 30 35 Z');
            this.eyes.left.classList.add('fear'); this.eyes.right.classList.add('fear');
        }
        else if (exp === 'thinking') { 
            this.updateMouth('M 30 25 L 70 25 L 70 28 L 30 28 Z');
            this.eyes.left.classList.add('flat'); this.eyes.right.classList.add('flat'); 
            this.startGlitchEffect(); 
        }
        else if (exp === 'glitch') { 
            this.startGlitchEffect(); 
            this.eyes.left.classList.add('fear'); this.eyes.right.classList.add('star'); 
        }
        else { 
            this.updateMouth('M 30 25 Q 50 40 70 25 Q 50 35 30 25 Z'); 
            this.stopGlitchEffect(); 
        }
    },

    shiftEyes() {
        const offset = (Math.random() - 0.5) * 20;
        [this.eyes.left, this.eyes.right].forEach(el => { el.style.transform = `translateX(${offset}px)`; });
    },

    startBlinkCycle() {
        const b = () => {
            if (this.activityState !== 'SPEAKING' && this.expressionState !== 'surprise') {
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

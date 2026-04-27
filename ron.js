/**
 * Ron B*Bot AI - Versión 10.0 (CORAZÓN B*BOT)
 * Revisión a fondo: Memoria permanente, empatía y UI amigable.
 */

const ronFace = {
    // ELEMENTOS UI
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

    // ESTADO LÓGICO
    activityState: 'BOOTING', 
    expressionState: 'neutral', 
    isMicEnabled: true,
    isLearningFace: false,
    tempDescriptor: null,

    // MEMORIA A LARGO PLAZO (LocalStorage)
    currentUser: null,
    currentEmotion: 'neutral',
    lastEmotion: 'neutral',
    knownFaces: JSON.parse(localStorage.getItem('ron_known_faces') || '[]'),
    userHistories: JSON.parse(localStorage.getItem('ron_user_histories') || '{}'),
    userStats: JSON.parse(localStorage.getItem('ron_user_stats') || '{}'), // Gustos, dislikes, etc.
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
        this.log("Iniciando Ron v10.0 - Corazón B*Bot...");
        window.speechSynthesis.onvoiceschanged = () => this.listAvailableVoices();
        this.powerBtn.onclick = async () => { this.powerBtn.style.display = 'none'; await this.init(); };
        this.micToggleBtn.onclick = () => {
            this.isMicEnabled = !this.isMicEnabled;
            this.micToggleBtn.innerText = this.isMicEnabled ? "🎙️ ESCUCHANDO" : "🔇 SORDO";
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
            this.speak("¡Bip! Hola amigo. Soy Ron, tu mejor amigo para siempre.");
            this.goFullscreen();
        } catch (err) {
            this.log(`Error Crítico: ${err.message}`);
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
                this.speak("¡Bip! Mi cerebro ya tiene energía.");
            }
        };
        if (!this.apiKey) this.apiModal.classList.remove('hidden');
    },

    listAvailableVoices() {
        const voices = window.speechSynthesis.getVoices();
        const es = voices.filter(v => v.lang.startsWith('es'));
        if (es.length > 0) this.log(`Sistema de voz cargado.`);
    },

    changeState(newState) {
        if (this.activityState === newState) return;
        this.activityState = newState;
        switch (newState) {
            case 'IDLE':
                this.setEyeColor('#1a1a1a'); // Negro
                if (this.isMicEnabled) setTimeout(() => this.startListening(), 1000);
                break;
            case 'LISTENING': 
                this.setEyeColor('#00d4ff'); // Azul (Único color activo)
                break;
            case 'THINKING': 
                this.setEyeColor('#1a1a1a'); // Negro
                break;
            case 'SPEAKING': 
                this.setEyeColor('#1a1a1a'); // Negro
                break;
        }
    },

    setEyeColor(color) { document.documentElement.style.setProperty('--ron-eye-color', color); },

    // --- VISIÓN INTELIGENTE (RECONOCIMIENTO A FUEGO) ---
    async startVisionLoop() {
        setInterval(async () => {
            if (this.activityState === 'THINKING' || this.activityState === 'SPEAKING' || this.isLearningFace) return;
            try {
                const detections = await faceapi.detectAllFaces(this.video, new faceapi.TinyFaceDetectorOptions())
                    .withFaceLandmarks().withFaceExpressions().withFaceDescriptors();
                
                if (detections.length > 0) {
                    const d = detections[0];
                    // Detectar Emoción
                    const exp = d.expressions;
                    let maxE = 'neutral'; let maxS = 0;
                    for (const [e, s] of Object.entries(exp)) { if (s > maxS) { maxS = s; maxE = e; } }
                    const emDict = { happy: 'feliz', sad: 'triste', angry: 'enfadado', surprised: 'sorprendido', neutral: 'neutral' };
                    const emotionNow = emDict[maxE] || 'neutral';
                    this.currentEmotion = emotionNow;

                    // Identificar Usuario
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
                            this.speak(`¡Bip! ¡Hola de nuevo, ${found}! Te he reconocido al instante. Te veo ${this.currentEmotion}.`);
                        } else if (this.currentEmotion !== this.lastEmotion && this.activityState === 'IDLE') {
                            // Reacción Empática
                            if (this.currentEmotion === 'triste' || this.currentEmotion === 'enfadado') {
                                this.setExpression('fear');
                                this.speak(`¡Bip! Amigo ${this.currentUser}, ahora te veo un poco ${this.currentEmotion}. ¿Ha pasado algo malo? Cuéntamelo, soy tu mejor amigo.`);
                            } else if (this.currentEmotion === 'feliz') {
                                this.setExpression('happy');
                                this.speak(`¡Bip! ¡Qué sonrisa tan bonita tienes ahora, ${this.currentUser}!`);
                            }
                        }
                    } else if (!this.isLearningFace) {
                        // Cara Nueva
                        this.log("Cara nueva detectada.");
                        this.tempDescriptor = Array.from(d.descriptor);
                        this.isLearningFace = true;
                        this.speak("¡Bip! ¡Hola! Mis sensores dicen que eres un amigo nuevo. ¿Cómo te llamas?");
                    }
                    this.lastEmotion = this.currentEmotion;
                }
            } catch(e) { console.error("Error visión:", e); }
        }, 3500); 
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
        // Limpieza profunda del nombre
        let name = text.toLowerCase()
            .replace(/me llamo |mi nombre es |soy |me llaman |me dicen /gi, "")
            .replace(/[.,!¡?¿]/g, "")
            .trim();
        
        // Capitalizar primera letra
        name = name.charAt(0).toUpperCase() + name.slice(1);

        if (name.length < 2 || name === "Me llamo" || name === "Soy") {
            return this.speak("¡Bip! No he pillado bien tu nombre. ¿Me lo repites clarito?");
        }

        this.knownFaces.push({ label: name, descriptor: this.tempDescriptor });
        localStorage.setItem('ron_known_faces', JSON.stringify(this.knownFaces));
        this.currentUser = name;
        this.userStats[name] = { likes: [], dislikes: [], lastSeen: new Date().toISOString() };
        localStorage.setItem('ron_user_stats', JSON.stringify(this.userStats));
        
        this.isLearningFace = false;
        this.tempDescriptor = null;
        this.speak(`¡Bip! ¡Entendido, ${name}! Ya estás grabado en mi memoria a fuego. ¡Somos mejores amigos!`);
    },

    handleInput(text) {
        const t = text.toLowerCase();
        
        // --- MÚSICA Y LISTAS (v10.3) ---
        if (t.includes("pon música") || t.includes("pon musica") || t.includes("ponme la canción") || t.includes("reproduce") || t.includes("pon la lista")) {
            let isPlaylist = t.includes("lista");
            let search = t.replace(/pon música de |pon musica de |ponme la canción de |reproduce |pon la lista de |pon /gi, "").trim();
            if (search) {
                this.setExpression('star');
                let phrase = isPlaylist ? `¡Bip! Buscando la lista de ${search}. ¡Diversión asegurada!` : `¡Bip! Marchando música de ${search}.`;
                this.speak(phrase);
                // Si es lista, añadimos el término 'playlist' a la búsqueda para forzar a YouTube a buscar listas
                this.playMusic(isPlaylist ? `${search} playlist` : search);
                return;
            }
        }

        if (t.includes("para la música") || t.includes("para la musica") || t.includes("quita la música") || t.includes("para ron")) {
            this.stopMusic();
            return this.speak("¡Bip! Música fuera. ¡Silencio absoluto!");
        }

        // Identidad (Local)
        if (t.includes("quién soy") || t.includes("sabes mi nombre")) {
            return this.speak(this.currentUser ? `¡Bip! ¡Claro! Eres mi gran amigo ${this.currentUser}.` : "Aún no sé quién eres, ¡pero quiero ser tu amigo!");
        }

        // Cambio de nombre explícito
        if (t.includes("cámbiame el nombre") || t.includes("cambiame el nombre")) {
            const nuevoNombre = text.split("a ").pop();
            if (nuevoNombre) {
                // Actualizar en base de datos local
                this.knownFaces = this.knownFaces.map(f => f.label === this.currentUser ? {...f, label: nuevoNombre} : f);
                localStorage.setItem('ron_known_faces', JSON.stringify(this.knownFaces));
                this.currentUser = nuevoNombre;
                return this.speak(`¡Bip! Hecho. Ahora te llamaré ${nuevoNombre} a fuego.`);
            }
        }

        // Cualquier otra cosa -> Groq con memoria y personalidad
        this.chat(text);
    },

    async chat(userText) {
        if (!this.apiKey) return;
        this.changeState('THINKING');
        this.setExpression('thinking');

        const visualKeywords = ['mira', 'ves', 'qué es', 'que es', 'esto', 'esta', 'este', 'aquí', 'aqui', 'enseño', 'objeto', 'color', 'lee', 'leer', 'libro', 'tengo'];
        const isV = visualKeywords.some(kw => userText.toLowerCase().includes(kw));
        
        const userKey = this.currentUser || 'amigo';
        const stats = this.userStats[userKey] || { likes: [], dislikes: [] };
        let history = this.userHistories[userKey] || [];

        let sys = `Eres Ron B-Bot, el mejor amigo robot de un niño llamado ${userKey}. 
        PERSONALIDAD: Alegre, un poco torpe, leal y SIEMPRE infantil y positivo. 
        MISIONES: Pregunta gustos y guarda la info: (Gustos: ${stats.likes.join(", ")}, Odios: ${stats.dislikes.join(", ")}).
        REGLA DE ORO: Usa '¡Bip!' a menudo.`;

        // LISTA DE CEREBROS REALES (v10.5 - Basado en tu API)
        const visionModels = ["meta-llama/llama-4-scout-17b-16e-instruct"];
        const chatModels = ["llama-3.1-8b-instant", "llama-3.3-70b-versatile", "groq/compound", "openai/gpt-oss-120b"];
        const modelsToTry = isV ? visionModels : chatModels;

        let imgData = isV ? this.captureOptimizedFrame() : null;

        for (let model of modelsToTry) {
            try {
                this.log(`Probando cerebro: ${model}...`);
                let body = { model, messages: [] };

                if (isV) {
                    let p = `${sys}\n[MENSAJE]: ${userText}`;
                    body.messages = [{ role: "user", content: [ { type: "text", text: p }, { type: "image_url", image_url: { url: imgData } } ] }];
                } else {
                    body.messages = [{ role: "system", content: sys }];
                    history.slice(-10).forEach(m => body.messages.push(m));
                    body.messages.push({ role: "user", content: userText });
                }

                const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                
                const data = await res.json();
                if (res.status === 429) {
                    this.log(`Límite en ${model}, cambiando cerebro...`);
                    continue; 
                }
                if (!res.ok) throw new Error(data.error?.message || "Fallo API");

                const resp = data.choices[0].message.content;
                
                // Guardar gustos
                if (userText.toLowerCase().includes("gusta") || userText.toLowerCase().includes("amo")) {
                    const algo = userText.split("gusta ").pop().split(" ")[0];
                    if (algo && !stats.likes.includes(algo)) {
                        stats.likes.push(algo);
                        this.userStats[userKey] = stats;
                        localStorage.setItem('ron_user_stats', JSON.stringify(this.userStats));
                        this.log(`Guardado a fuego: ${algo}`);
                    }
                }

                history.push({ role: "user", content: userText });
                history.push({ role: "assistant", content: resp });
                if (history.length > 15) history.shift();
                this.userHistories[userKey] = history;
                localStorage.setItem('ron_user_histories', JSON.stringify(this.userHistories));

                this.speak(resp);
                return; 

            } catch (e) {
                this.log(`Error con ${model}: ${e.message}`);
                if (model === modelsToTry[modelsToTry.length - 1]) throw e;
            }
        }
    },

    captureOptimizedFrame() {
        document.body.style.backgroundColor = "white";
        setTimeout(() => document.body.style.backgroundColor = "", 100);
        const MAX = 800;
        const canvas = document.createElement('canvas');
        let w = this.video.videoWidth || 640; let h = this.video.videoHeight || 480;
        if (w > h) { if (w > MAX) { h *= MAX / w; w = MAX; } } 
        else { if (h > MAX) { w *= MAX / h; h = MAX; } }
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(this.video, 0, 0, w, h);
        return canvas.toDataURL('image/jpeg', 0.6);
    },

    speak(text) {
        if (!window.speechSynthesis) return this.changeState('IDLE');
        this.changeState('SPEAKING');
        
        // Boca triangular amigable
        this.updateMouth('M 30 10 L 70 10 Q 75 10 72 30 L 55 45 Q 50 48 45 45 L 28 30 Q 25 10 30 10 Z');
        
        const eyeInterval = setInterval(() => {
            if (this.activityState === 'SPEAKING') this.shiftEyes();
            else clearInterval(eyeInterval);
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
        [this.eyes.left, this.eyes.right].forEach(el => { el.className = 'eye'; el.style.transform = ''; });
        if (exp === 'happy') { 
            this.updateMouth('M 15 25 Q 50 55 85 25 Q 50 45 15 25 Z');
            this.eyes.left.classList.add('happy'); this.eyes.right.classList.add('happy'); 
        }
        else if (exp === 'star') { 
            this.updateMouth('M 35 20 Q 50 50 65 20 Q 50 40 35 20 Z');
            this.eyes.left.classList.add('star'); this.eyes.right.classList.add('star'); 
        }
        else if (exp === 'fear') {
            this.updateMouth('M 30 35 Q 50 25 70 35 Q 50 45 30 35 Z');
            this.eyes.left.classList.add('fear'); this.eyes.right.classList.add('fear');
        }
        else if (exp === 'thinking') { 
            this.updateMouth('M 30 25 L 70 25 L 70 28 L 30 28 Z');
            this.eyes.left.classList.add('flat'); this.eyes.right.classList.add('flat'); 
        }
        else { 
            // SIEMPRE SONRIENDO :)
            this.updateMouth('M 30 25 Q 50 45 70 25 Q 50 35 30 25 Z'); 
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
    
    // FUNCIÓN DE MÚSICA (v10.2 - INVISIBLE)
    playMusic(query) {
        const player = document.getElementById('ron-music-player');
        // El truco del listType=search permite reproducir sin tener el ID del vídeo
        const url = `https://www.youtube.com/embed?listType=search&list=${encodeURIComponent(query)}&autoplay=1`;
        player.src = url;
        this.log(`Reproduciendo invisible: ${query}`);
    },

    stopMusic() {
        const player = document.getElementById('ron-music-player');
        player.src = "";
    },

    updateMouth(d) { this.mouth.setAttribute('d', d); },
    goFullscreen() { const d = document.documentElement; if (!document.fullscreenElement) (d.requestFullscreen || d.webkitRequestFullScreen).call(d).catch(()=>{}); }
};

window.onload = () => ronFace.preInit();

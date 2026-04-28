/**
 * Ron B*Bot AI - Versión 10.0 (CORAZÓN B*BOT)
 * Revisión a fondo: Memoria permanente, empatía y UI amigable.
 */

const ronFace = {
    // ELEMENTOS UI
    eyes: { left: document.getElementById('eye-left'), right: document.getElementById('eye-right') },
    mouth: document.getElementById('mouth-path'),
    mouthContainer: document.querySelector('.mouth-svg'),
    chestIcon: document.getElementById('chest-icon-container'),
    bleBtn: document.getElementById('ble-connect-btn'), // Nuevo v14.0
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
    isWaitingForWakeWord: true,
    // ESTADO BLE (Bluetooth) v14.0
    ble: {
        device: null,
        characteristic: null,
        isConnected: false,
        lastPan: 90,
        lastTilt: 90
    },

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
        this.log("Iniciando Ron v16.3 - Edición Estable...");
        this.setChestIcon('wifi'); // Icono inicial de prueba v15.0
        window.onYouTubeIframeAPIReady = () => {
            this.ytPlayer = new YT.Player('ron-yt-player', {
                height: '1', width: '1', videoId: 'dQw4w9WgXcQ',
                events: { 'onReady': () => this.log("Reproductor YouTube listo.") }
            });
        };
        window.speechSynthesis.onvoiceschanged = () => this.listAvailableVoices();
        this.powerBtn.onclick = async () => { this.powerBtn.style.display = 'none'; await this.init(); };
        this.micToggleBtn.onclick = () => {
            this.isMicEnabled = !this.isMicEnabled;
            this.micToggleBtn.classList.toggle('off', !this.isMicEnabled);
            if (this.isMicEnabled && this.activityState === 'IDLE') this.startListening();
        };
        this.bleBtn.onclick = () => this.connectBLE(); // Link v14.0
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
                this.setEyeColor('#00d4ff'); // Azul siempre al escuchar v16.4
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

    // --- GESTIÓN BLUETOOTH (v14.0) ---
    async connectBLE() {
        try {
            this.log("Buscando B*Bot ESP32...");
            this.ble.device = await navigator.bluetooth.requestDevice({
                filters: [{ namePrefix: 'Ron' }, { namePrefix: 'B-Bot' }],
                optionalServices: ['0000ffe0-0000-1000-8000-00805f9b34fb'] // UUID común para serial BLE
            });
            const server = await this.ble.device.gatt.connect();
            const service = await server.getPrimaryService('0000ffe0-0000-1000-8000-00805f9b34fb');
            this.ble.characteristic = await service.getCharacteristic('0000ffe1-0000-1000-8000-00805f9b34fb');
            
            this.ble.isConnected = true;
            this.bleBtn.classList.add('active');
            this.speak("¡Bip! Conexión de motores establecida.");
            this.log("BLE Conectado.");
        } catch (e) {
            this.log(`Error BLE: ${e.message}`);
        }
    },

    sendMove(cmd) {
        if (!this.ble.isConnected || !this.ble.characteristic) return;
        const enc = new TextEncoder();
        this.ble.characteristic.writeValue(enc.encode(cmd));
    },

    trackFace(detection) {
        if (!this.ble.isConnected) return;
        const box = detection.detection.box;
        const centerX = box.x + box.width / 2;
        const centerY = box.y + box.height / 2;
        
        // Calcular error respecto al centro de la imagen (0.5, 0.5)
        const errX = (centerX / this.video.videoWidth) - 0.5;
        const errY = (centerY / this.video.videoHeight) - 0.5;

        // Ajustar Pan/Tilt (Sensibilidad suave)
        if (Math.abs(errX) > 0.1) {
            this.ble.lastPan -= errX * 20;
            this.ble.lastPan = Math.max(0, Math.min(180, this.ble.lastPan));
            this.sendMove(`P${Math.round(this.ble.lastPan)}\n`);
        }
        if (Math.abs(errY) > 0.1) {
            this.ble.lastTilt += errY * 20;
            this.ble.lastTilt = Math.max(0, Math.min(180, this.ble.lastTilt));
            this.sendMove(`T${Math.round(this.ble.lastTilt)}\n`);
        }
    },
    // --- VISIÓN INTELIGENTE (v14.0 B*BOT LINK) ---
    async startVisionLoop() {
        setInterval(async () => {
            if (this.activityState === 'THINKING' || this.activityState === 'SPEAKING' || this.isLearningFace) return;
            try {
                const detections = await faceapi.detectAllFaces(this.video, new faceapi.TinyFaceDetectorOptions())
                    .withFaceLandmarks().withFaceExpressions().withFaceDescriptors();
                
                if (detections.length > 0) {
                    const d = detections[0];
                    this.trackFace(d); // RASTREO v14.0

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
                            this.speak(`¡Bip! ¡Hola, ${found}! Te he reconocido. Te veo ${this.currentEmotion}.`);
                        } else if (this.currentEmotion !== this.lastEmotion && this.activityState === 'IDLE') {
                            if (this.currentEmotion === 'triste') {
                                this.setExpression('fear');
                                this.speak(`¡Bip! Amigo ${this.currentUser}, te veo triste. ¿Qué pasa?`);
                            } else if (this.currentEmotion === 'feliz') {
                                this.setExpression('happy');
                                this.speak(`¡Bip! ¡Me encanta verte feliz, ${this.currentUser}!`);
                            }
                        }
                    } else if (!this.isLearningFace) {
                        this.tempDescriptor = Array.from(d.descriptor);
                        this.isLearningFace = true;
                        this.speak("¡Bip! Eres un amigo nuevo. ¿Cómo te llamas?");
                    }
                    this.lastEmotion = this.currentEmotion;
                }
            } catch(e) { console.error("Error visión:", e); }
        }, 150); 
    },

    startListening() {
        if (this.activityState !== 'IDLE' || !this.isMicEnabled) return;
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) return;
        this.recognition = new SpeechRecognition();
        this.recognition.lang = 'es-ES';
        this.recognition.onstart = () => { 
            this.changeState('LISTENING'); 
            this.setEyeColor('#00d4ff'); // Ojos azules al arrancar escucha
        };
        this.recognition.onresult = (e) => {
            let text = e.results[0][0].transcript;
            const t = text.toLowerCase();
            
            this.log(`Oído: ${text}`);

            if (this.isWaitingForWakeWord) {
                if (t.includes("ron") || t.includes("hola ron") || t.includes("oye ron") || t.includes("hola")) {
                    this.isWaitingForWakeWord = false;
                    this.setEyeColor('#00d4ff'); 
                    // No limpiamos el texto tan agresivamente para no romper comandos
                    if (t.split(" ").length < 2) {
                        this.speak("¡Bip! ¿Dime?");
                        return;
                    }
                } else {
                    return; 
                }
            }

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
        
        // --- MÚSICA Y LISTAS (v10.6) ---
        const musicKeywords = ["música", "musica", "canción", "cancion", "reproduce", "ponme", "escuchar", "ritmo", "baile"];
        if (musicKeywords.some(kw => t.includes(kw)) && (t.includes("pon") || t.includes("reproduce") || t.includes("busca"))) {
            let isPlaylist = t.includes("lista");
            let search = t.replace(/pon música de |pon musica de |ponme la canción de |reproduce |pon la lista de |pon |busca |quiero escuchar /gi, "").trim();
            if (search && search.length > 2) {
                this.setExpression('star');
                let phrase = isPlaylist ? `¡Bip! Buscando la lista de ${search}.` : `¡Bip! Marchando música de ${search}.`;
                this.speak(phrase);
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
        PERSONALIDAD: Alegre, infantil y positivo. 
        ESTADO: Estás en medio de una charla. ¡NO te presentes! No digas hola. Responde directo.
        HABILIDADES: Puedes poner música (di "¡Marchando música!").
        GUSTOS CONOCIDOS: ${stats.likes.join(", ")}.`;

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
        
        // Animación de boca dinámica (v16.3) - Solo al hablar
        const mouthShapes = [
            'M 25 35 Q 50 55 75 35 Q 50 45 25 35 Z', // Óvalo fino
            'M 30 30 Q 50 60 70 30 Q 50 40 30 30 Z', // Óvalo profundo
            'M 35 25 L 65 25 L 60 45 L 40 45 Z'       // Trapezoide
        ];
        let shapeIdx = 0;
        const mouthInterval = setInterval(() => {
            if (this.activityState === 'SPEAKING') {
                this.updateMouth(mouthShapes[shapeIdx % mouthShapes.length]);
                shapeIdx++;
            } else {
                clearInterval(mouthInterval);
                this.setExpression('neutral'); // Volver a curva feliz al callar
            }
        }, 150);

        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        const voices = window.speechSynthesis.getVoices();
        const best = voices.find(v => v.lang.startsWith('es') && (v.name.includes('Google') || v.name.includes('Natural'))) || voices.find(v => v.lang.startsWith('es'));
        if (best) u.voice = best;
        u.lang = 'es-ES'; u.pitch = 1.4; u.rate = 1.1;
        u.onstart = () => this.mouthContainer.classList.add('mouth-vibrate');
        u.onend = () => { 
            this.mouthContainer.classList.remove('mouth-vibrate'); 
            this.setExpression('neutral'); 
            setTimeout(() => {
                this.changeState('IDLE');
                // Si acabamos de reconocer a alguien, le damos 5 seg de margen sin wake word
                this.isWaitingForWakeWord = true; 
            }, 1000); 
        };
        window.speechSynthesis.speak(u);
    },

    setExpression(exp) {
        this.expressionState = exp;
        [this.eyes.left, this.eyes.right].forEach(el => { el.className = 'eye'; el.style.transform = ''; });
        this.chestIcon.innerHTML = '';
        this.chestIcon.className = 'chest-icon-container';

        if (exp === 'happy') { 
            this.updateMouth('M 25 35 Q 50 55 75 35'); // Curva fina feliz
            this.eyes.left.classList.add('happy'); this.eyes.right.classList.add('happy');
            this.setChestIcon('heart');
        }
        else if (exp === 'star') { 
            this.updateMouth('M 30 35 Q 50 45 70 35');
            this.eyes.left.classList.add('star'); this.eyes.right.classList.add('star');
            this.setChestIcon('wifi');
        }
        else if (exp === 'fear') {
            this.updateMouth('M 35 45 Q 50 35 65 45'); 
            this.eyes.left.classList.add('fear'); this.eyes.right.classList.add('fear');
            this.setChestIcon('warning');
        }
        else if (exp === 'thinking') { 
            this.updateMouth('M 35 40 L 65 40'); 
            this.eyes.left.classList.add('square'); this.eyes.right.classList.add('square'); 
        }
        else { 
            this.updateMouth('M 25 35 Q 50 48 75 35'); // Curva fina neutral
            this.stopGlitchEffect(); 
        }
    },

    setChestIcon(type) {
        if (type === 'heart') {
            this.chestIcon.innerHTML = '<svg viewBox="0 0 100 100"><path fill="white" d="M 50 90 L 15 55 A 25 25 0 0 1 50 25 A 25 25 0 0 1 85 55 Z" /></svg>';
            this.chestIcon.classList.add('heart-beat');
        } else if (type === 'warning') {
            this.chestIcon.innerHTML = '<svg viewBox="0 0 100 100"><path fill="#ff3b3b" d="M 50 15 L 90 85 L 10 85 Z" /><text x="50" y="75" fill="white" text-anchor="middle" font-weight="bold" font-size="40">!</text></svg>';
        } else if (type === 'wifi') {
            this.chestIcon.innerHTML = '<svg viewBox="0 0 100 100" fill="white"><path d="M 50 80 A 10 10 0 1 1 50 81 Z M 20 50 A 40 40 0 0 1 80 50 L 75 55 A 35 35 0 0 0 25 55 Z M 5 35 A 55 55 0 0 1 95 35 L 90 40 A 50 50 0 0 0 10 40 Z" /></svg>';
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
    
    // FUNCIÓN DE MÚSICA (v11.1 - CHRONOTECH)
    playMusic(query) {
        if (!this.ytPlayer) {
            this.ytPlayer = new YT.Player('ron-yt-player', {
                height: '1', width: '1',
                playerVars: { 'autoplay': 1, 'controls': 0, 'disablekb': 1, 'modestbranding': 1, 'rel': 0 },
                events: {
                    'onReady': (e) => {
                        e.target.loadPlaylist({ listType: 'search', list: query });
                    }
                }
            });
        } else {
            this.ytPlayer.loadPlaylist({ listType: 'search', list: query });
        }
        this.log(`Reproduciendo ChronoTech: ${query}`);
    },

    stopMusic() {
        if (this.ytPlayer && this.ytPlayer.stopVideo) {
            this.ytPlayer.stopVideo();
        }
    },

    updateMouth(d) { this.mouth.setAttribute('d', d); },
    goFullscreen() { const d = document.documentElement; if (!document.fullscreenElement) (d.requestFullscreen || d.webkitRequestFullScreen).call(d).catch(()=>{}); }
};

window.onload = () => ronFace.preInit();

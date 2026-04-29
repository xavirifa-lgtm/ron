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
    gamePanel: document.getElementById('game-panel'),
    gameText: document.getElementById('game-text'),
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
    wakeLock: null, // Sistema anti-suspensión v17.0
    isRecognitionActive: false, // Flag de seguridad v16.5

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
        if (!this.fixedLog) this.fixedLog = document.getElementById('debug-info');
        if (this.fixedLog) {
            const time = new Date().toLocaleTimeString('es-ES', { hour12: false });
            const div = document.createElement('div');
            div.style.marginBottom = "5px";
            div.innerText = `> ${msg}`;
            this.fixedLog.appendChild(div);
            this.fixedLog.scrollTop = this.fixedLog.scrollHeight;
            if (this.fixedLog.children.length > 50) this.fixedLog.children[0].remove();
        }
    },

    async preInit() {
        this.log("Iniciando Ron v20.0 - CREATIVE BRAIN...");
        this.setChestIcon('wifi'); // Icono inicial de prueba v15.0
        window.speechSynthesis.onvoiceschanged = () => this.listAvailableVoices();
        this.powerBtn.onclick = async () => { 
            this.powerBtn.style.display = 'none'; 
            await this.init(); 
        };
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
            this.requestWakeLock(); // Mantener pantalla encendida v17.0
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

    // --- SISTEMA ANTI-SUSPENSIÓN v17.0 ---
    async requestWakeLock() {
        try {
            if ('wakeLock' in navigator) {
                this.wakeLock = await navigator.wakeLock.request('screen');
                this.log("Pantalla bloqueada: No se suspenderá.");
                this.wakeLock.addEventListener('release', () => {
                    this.log("Wake Lock liberado.");
                });
            }
        } catch (err) {
            this.log(`Error WakeLock: ${err.message}`);
        }
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
                this.setEyeColor('#1a1a1a'); 
                break;
            case 'GLITCH':
                this.setEyeColor('#ff3b3b');
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
                const detections = await faceapi.detectAllFaces(this.video, new faceapi.TinyFaceDetectorOptions({ inputSize: 160 }))
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
        }, 800); // Optimizada v16.5
    },

    startListening() {
        if (this.activityState !== 'IDLE' || !this.isMicEnabled) return;
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (this.isRecognitionActive) return; 
        this.recognition = new SpeechRecognition();
        this.recognition.lang = 'es-ES';
        this.recognition.onstart = () => { 
            this.isRecognitionActive = true;
            this.changeState('LISTENING'); 
            this.setEyeColor('#00d4ff');
        };
        this.recognition.onresult = (e) => {
            let text = e.results[0][0].transcript;
            const t = text.toLowerCase();
            
            this.log(`Oído: ${text}`);

            if (this.isWaitingForWakeWord) {
                if (t.includes("ron") || t.includes("hola") || t.includes("oye") || t.includes("amigo") || t.length > 5) {
                    this.isWaitingForWakeWord = false;
                    this.setEyeColor('#00d4ff'); 
                    if (t.split(" ").length < 2) {
                        this.speak("¡Bip! ¿Qué pasa, amigo?");
                        return;
                    }
                } else {
                    return; 
                }
            } else {
                // Si estamos en ventana de charla, cualquier cosa activa la respuesta
                if (this.convTimeout) clearTimeout(this.convTimeout);
            }

            if (this.isLearningFace && this.tempDescriptor) this.saveNewUser(text);
            else this.handleInput(text);
        };
        this.recognition.onend = () => { 
            this.isRecognitionActive = false;
            if (this.activityState === 'LISTENING') this.changeState('IDLE'); 
        };
        try { this.recognition.start(); } catch(e) { this.changeState('IDLE'); }
    },

    saveNewUser(text) {
        let name = text.toLowerCase()
            .replace(/me llamo |mi nombre es |soy |me llaman |me dicen /gi, "")
            .replace(/[.,!¡?¿]/g, "")
            .trim();
        
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

    async handleInput(userText) {
        if (this.activityState === 'MATH_GAME') return this.handleMathAnswer(userText);
        if (this.activityState === 'READING_GAME') return this.handleReadingAnswer(userText);
        if (this.activityState !== 'IDLE' && this.activityState !== 'LISTENING') return;
        
        const t = userText.toLowerCase();
        
        // ACTIVADORES DE JUEGOS v19.0
        if (t.includes("jugar") && (t.includes("suma") || t.includes("matemáticas") || t.includes("números"))) {
            return this.startMathGame();
        }
        if (t.includes("vamos a leer") || t.includes("quiero leer") || t.includes("juego de lectura")) {
            return this.startReadingGame();
        }
        if (t.includes("para el juego") || t.includes("salir del juego") || t.includes("adiós ron")) {
            this.gamePanel.classList.add('hidden');
            this.changeState('IDLE');
            return this.speak("¡Bip! Dejamos los libros para luego.");
        }

        // 1. COMANDOS DE MÚSICA (v18.1 Launcher)
        const musicKeywords = ["música", "musica", "canción", "cancion", "reproduce", "ponme", "escuchar", "ritmo", "baile"];
        if (musicKeywords.some(kw => t.includes(kw)) && (t.includes("pon") || t.includes("reproduce") || t.includes("busca"))) {
            let search = t.replace(/pon música de |pon musica de |ponme la canción de |reproduce |pon la lista de |pon |busca |quiero escuchar /gi, "").trim();
            if (search && search.length > 2) {
                this.setExpression('star');
                this.speak(`¡Bip! Abriendo ritmo de ${search}.`);
                this.playMusic(search);
                return;
            }
        }

        if (t.includes("para la música") || t.includes("para la musica") || t.includes("para ron")) {
            this.log("Música parada.");
            return this.speak("¡Bip! Música fuera.");
        }

        // 2. CHAT IA CON WATCHDOG v18.5
        this.log(`Procesando: ${userText}`);
        this.changeState('THINKING');
        this.setExpression('thinking');

        const watchdog = setTimeout(() => {
            if (this.activityState === 'THINKING') {
                this.triggerSafetyGlitch("Cerebro sobrecalentado (Timeout)");
            }
        }, 12000);

        try {
            const visualKeywords = ['mira', 'ves', 'qué es', 'que es', 'esto', 'esta', 'este', 'aquí', 'aqui', 'enseño', 'objeto', 'color', 'lee', 'leer', 'libro', 'tengo'];
            const isV = visualKeywords.some(kw => t.includes(kw));
            const userKey = this.currentUser || 'amigo';
            
            let sys = `Eres Ron B-Bot, el robot de la película. Eres entusiasta, literal y un poco glitchy.
            HABILIDADES:
            1. EMOCIONES: Detectas si el niño está feliz o triste por su cara y actúas en consecuencia.
            2. MÚSICA: Si piden música, di [MUSIC: nombre].
            3. PIZARRA: Si el niño quiere jugar a algo nuevo (adivinanzas, juegos inventados, etc.), inventa las reglas y usa el comando [SHOW: texto] para mostrar cosas en pantalla.
            4. ACADEMY: Si piden matemáticas o lectura, usa los juegos oficiales.
            REGLA DE ORO: Sé siempre su mejor amigo. Habla en español.`;

            let body = { 
                model: isV ? "meta-llama/llama-4-scout-17b-16e-instruct" : "meta-llama/llama-3.1-70b-versatile", 
                messages: [] 
            };

            if (isV) {
                const img = this.captureOptimizedFrame();
                body.messages = [{ role: "user", content: [ { type: "text", text: `${sys}\n[MENSAJE]: ${userText}` }, { type: "image_url", image_url: { url: img } } ] }];
            } else {
                body.messages = [{ role: "system", content: sys }, { role: "user", content: userText }];
            }

            const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            
            clearTimeout(watchdog);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error?.message || "Error API");

            const resp = data.choices[0].message.content;
            
            // PROCESADOR DE COMANDOS v20.0
            if (resp.includes("[MUSIC:")) {
                const m = resp.match(/\[MUSIC: (.*?)\]/);
                if (m) this.playMusic(m[1]);
            }
            if (resp.includes("[SHOW:")) {
                const s = resp.match(/\[SHOW: (.*?)\]/);
                if (s) {
                    this.gamePanel.classList.remove('hidden');
                    this.gameText.innerText = s[1];
                    this.log(`Pizarra Activa: ${s[1]}`);
                }
            }

            await this.speak(resp.replace(/\[MUSIC:.*?\]/g, '').replace(/\[SHOW:.*?\]/g, ''));
        } catch (e) {
            clearTimeout(watchdog);
            this.log(`Error Cerebro: ${e.message}`);
            this.triggerSafetyGlitch(e.message);
        }
    },

    // JUEGOS ACADEMY v19.0
    startMathGame() {
        const n1 = Math.floor(Math.random() * 10) + 1;
        const n2 = Math.floor(Math.random() * 10) + 1;
        this.currentAnswer = n1 + n2;
        this.changeState('MATH_GAME');
        this.gamePanel.classList.remove('hidden');
        this.gameText.innerText = `${n1} + ${n2}`;
        this.speak(`¡Bip! ¡Hora de sumar! ¿Cuánto es ${n1} más ${n2}?`);
    },

    handleMathAnswer(text) {
        const num = parseInt(text.replace(/[^0-9]/g, ''));
        if (num === this.currentAnswer) {
            this.setExpression('star');
            this.speak("¡Increíble! ¡Eres un genio de los números! ¡Bip bip!");
            setTimeout(() => this.startMathGame(), 3000);
        } else if (!isNaN(num)) {
            this.setExpression('sad');
            this.speak(`¡Casi! Inténtalo otra vez, amiguito.`);
        }
    },

    startReadingGame() {
        const phrases = ["EL GATO ES AZUL", "MAMÁ ME AMA", "RON ES MI AMIGO", "EL SOL BRILLA", "VAMOS A JUGAR"];
        this.targetPhrase = phrases[Math.floor(Math.random() * phrases.length)];
        this.changeState('READING_GAME');
        this.gamePanel.classList.remove('hidden');
        this.gameText.innerText = this.targetPhrase;
        this.speak(`¡Bip! ¡Leemos juntos! Di lo que ves en la pantalla.`);
    },

    handleReadingAnswer(text) {
        const input = text.toUpperCase().trim().replace(/[.,!¡?¿]/g, "");
        if (input === this.targetPhrase) {
            this.setExpression('happy');
            this.speak("¡Perfecto! ¡Lees de maravilla! ¡Bip!");
            setTimeout(() => this.startReadingGame(), 3000);
        } else {
            this.log(`Leído: ${input} | Esperado: ${this.targetPhrase}`);
            this.speak("¡Casi! Repite conmigo con cuidado.");
        }
    },

    triggerSafetyGlitch(reason) {
        this.log(`⚠️ GLITCH: ${reason}`);
        this.changeState('GLITCH');
        this.setExpression('glitch');
        this.startGlitchEffect();
        
        setTimeout(async () => {
            this.stopGlitchEffect();
            await this.speak("¡Bip! Error de sistema. Reiniciando amistad.");
            this.changeState('IDLE');
            this.setExpression('neutral');
        }, 3000);
    },

    captureOptimizedFrame() {
        const MAX = 1024; // Resolución Eagle Eye v16.9
        const canvas = document.createElement('canvas');
        let w = this.video.videoWidth || 640; let h = this.video.videoHeight || 480;
        if (w > h) { if (w > MAX) { h *= MAX / w; w = MAX; } } 
        else { if (h > MAX) { w *= MAX / h; h = MAX; } }
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(this.video, 0, 0, w, h);
        return canvas.toDataURL('image/jpeg', 0.9);
    },

    speak(text) {
        if (!window.speechSynthesis) return this.changeState('IDLE');
        this.changeState('SPEAKING');
        
        const mouthPath = document.getElementById('mouth-path');
        mouthPath.classList.add('is-speaking'); 

        // Formas de boca sólidas cinemáticas v19.6
        const mouthShapes = [
            'M 35 30 L 65 30 L 65 40 L 35 40 Z', // Rectángulo medio
            'M 40 25 L 60 25 L 60 45 L 40 45 Z', // Bloque alto (O)
            'M 30 32 L 70 32 L 70 38 L 30 38 Z'  // Línea gruesa ancha
        ];
        
        let shapeIdx = 0;
        const mouthInterval = setInterval(() => {
            if (this.activityState === 'SPEAKING') {
                this.updateMouth(mouthShapes[shapeIdx % mouthShapes.length]);
                this.shiftEyes(); 
                shapeIdx++;
            } else {
                clearInterval(mouthInterval);
                mouthPath.classList.remove('is-speaking'); 
                this.setExpression('neutral'); 
            }
        }, 110); // Más rápido y frenético v19.6

        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        const voices = window.speechSynthesis.getVoices();
        const best = voices.find(v => v.lang.startsWith('es') && (v.name.includes('Google') || v.name.includes('Natural'))) || voices.find(v => v.lang.startsWith('es'));
        if (best) u.voice = best;
        u.lang = 'es-ES'; u.pitch = 1.4; u.rate = 1.1;
        
        u.onstart = () => this.mouthContainer.classList.add('mouth-vibrate');
        u.onend = () => { 
            this.mouthContainer.classList.remove('mouth-vibrate'); 
            // VENTANA DE CONVERSACIÓN v16.6
            // Tras hablar, le damos 7 segundos para que el usuario responda sin decir "Ron"
            this.isWaitingForWakeWord = false; 
            this.changeState('IDLE');
            
            // Si pasan 7 segundos sin respuesta, volvemos a pedir wake word
            if (this.convTimeout) clearTimeout(this.convTimeout);
            this.convTimeout = setTimeout(() => {
                this.isWaitingForWakeWord = true;
                this.log("Fin de ventana de charla.");
            }, 7000);
        };
        window.speechSynthesis.speak(u);
    },

    setExpression(exp) {
        this.expressionState = exp;
        [this.eyes.left, this.eyes.right].forEach(el => { el.className = 'eye'; el.style.transform = ''; });
        this.chestIcon.innerHTML = '';
        this.chestIcon.className = 'chest-icon-container';

        if (exp === 'happy') { 
            this.updateMouth('M 20 30 Q 50 45 80 30'); // Sonrisa fina v19.5
            this.eyes.left.classList.add('happy'); this.eyes.right.classList.add('happy');
            this.setChestIcon('heart');
        } else if (exp === 'neutral') {
            this.updateMouth('M 25 35 L 75 35'); // Línea plana v19.5
            this.setChestIcon('wifi');
        } else if (exp === 'thinking') {
            this.updateMouth('M 40 35 L 60 35'); // Boca pequeña pensando
            this.eyes.left.classList.add('thinking'); this.eyes.right.classList.add('thinking');
            this.setChestIcon('search');
        } else if (exp === 'sad') {
            this.updateMouth('M 30 45 Q 50 30 70 45'); // Tristeza sutil
            this.setChestIcon('sad');
        } else if (exp === 'star') {
            this.updateMouth('M 20 30 Q 50 50 80 30');
            this.eyes.left.classList.add('star'); this.eyes.right.classList.add('star');
            this.setChestIcon('star');
        } else if (exp === 'glitch') {
            this.updateMouth('M 20 35 L 80 35');
            this.eyes.left.classList.add('glitch'); this.eyes.right.classList.add('glitch');
        } else if (exp === 'fear') {
            this.updateMouth('M 35 45 Q 50 35 65 45'); 
            this.eyes.left.classList.add('fear'); this.eyes.right.classList.add('fear');
            this.setChestIcon('warning');
        } else if (exp === 'square') {
            this.updateMouth('M 35 40 L 65 40'); 
            this.eyes.left.classList.add('square'); this.eyes.right.classList.add('square'); 
        } else { 
            this.updateMouth('M 25 35 Q 50 48 75 35'); // Línea fina neutral
            this.stopGlitchEffect(); 
        }
    },

    setChestIcon(type) {
        if (type === 'heart') {
            this.chestIcon.innerHTML = '<svg viewBox="0 0 100 100"><path fill="white" d="M 50 90 L 15 55 A 25 25 0 0 1 50 25 A 25 25 0 0 1 85 55 Z" /></svg>';
            this.chestIcon.classList.add('heart-beat');
        } else if (type === 'heart-pink') {
            this.chestIcon.innerHTML = '<svg viewBox="0 0 100 100"><path fill="#ff69b4" d="M 50 90 L 15 55 A 25 25 0 0 1 50 25 A 25 25 0 0 1 85 55 Z" /></svg>';
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

    // FUNCIÓN DE MÚSICA (v18.1 - AUTO-PLAY LAUNCHER)
    playMusic(query) {
        this.log(`¡Bip! Reproduciendo: ${query}`);
        
        // Mapeo de IDs para Auto-Play v18.1
        const directIDs = {
            'mecano': '92S_pY8mK8U', // Hijo de la Luna
            'fiesta': 'S_62_z3B_yY',
            'relax': '5qap5aO4i9A'
        };

        const targetID = directIDs[query.toLowerCase()];
        let url;
        
        if (targetID) {
            // Enlace de reproducción directa (WATCH) para que suene solo
            url = `https://music.youtube.com/watch?v=${targetID}`;
        } else {
            // Fallback a búsqueda si no tenemos la ID
            url = `https://music.youtube.com/search?q=${encodeURIComponent(query)}`;
        }
        
        window.open(url, '_blank');
    },

    stopMusic() {
        if (this.ytPlayer && this.ytPlayer.stopVideo) {
            this.ytPlayer.stopVideo();
        }
    },

    updateMouth(d) { this.mouth.setAttribute('d', d); },
    goFullscreen() { const d = document.documentElement; if (!document.fullscreenElement) (d.requestFullscreen || d.webkitRequestFullScreen).call(d).catch(()=>{}); }
};

window.onload = () => {
    ronFace.preInit();
    // Re-activar Wake Lock si la app vuelve al primer plano
    document.addEventListener('visibilitychange', async () => {
        if (ronFace.wakeLock !== null && document.visibilityState === 'visible') {
            await ronFace.requestWakeLock();
        }
    });
};

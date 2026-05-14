import { RonState, log, changeState } from './core.js';
import * as Sounds from './sounds.js';

let glitchInterval  = null;
let moodBubbleTimer = null;
let danceInterval   = null;

export function initUI() {
    RonState.ui = {
        eyes: { left: document.getElementById('eye-left'), right: document.getElementById('eye-right') },
        mouth:          document.getElementById('mouth-path'),
        mouthContainer: document.querySelector('.mouth-svg'),
        mouthLayer:     document.querySelector('.mouth-layer'),
        chestIcon:      document.getElementById('chest-icon-container'),
        bleBtn:         document.getElementById('ble-connect-btn'),
        glitchOverlay:  document.getElementById('glitch-overlay'),
        video:          document.getElementById('webcam'),
        gamePanel:      document.getElementById('game-panel'),
        gameText:       document.getElementById('game-text'),
        apiModal:       document.getElementById('api-modal'),
        apiKeyInput:    document.getElementById('groq-key-input'),
        saveBtn:        document.getElementById('save-api-key'),
        fixedLog:       document.getElementById('debug-info'),
        bootScreen:     document.getElementById('boot-screen'),
        powerBtn:       document.getElementById('power-btn'),
        micToggleBtn:   document.getElementById('mic-toggle-btn'),
        photoPanel:     document.getElementById('photo-panel'),
        photoImg:       document.getElementById('photo-img'),
        flash:          document.getElementById('camera-flash'),
        mainApp:        document.getElementById('ron-app'),
        storyPanel:     document.getElementById('story-panel'),
        storyText:      document.getElementById('story-text'),
        moodBubble:     document.getElementById('mood-bubble'),
        faceWrapper:    document.querySelector('.face-wrapper'),
        closeGameBtn:   document.getElementById('close-game-btn'),
        statusDot:      document.getElementById('status-dot'),
        batteryFill:    document.getElementById('battery-fill'),
    };

    if (RonState.ui.closeGameBtn) {
        RonState.ui.closeGameBtn.onclick = () => RonState.ui.gamePanel.classList.add('hidden');
    }

    initBattery();
}

async function initBattery() {
    if (!('getBattery' in navigator)) return;
    try {
        const b = await navigator.getBattery();
        const update = () => {
            const level = Math.round(b.level * 100);
            RonState.batteryLevel = level;
            updateBatteryBar(level, b.charging);
            if (level <= 15 && !b.charging && RonState.activityState === 'IDLE') {
                import('./speech.js').then(s =>
                    s.speak("¡Bip! Batería crítica. Por favor enchúfame antes de que me duerma para siempre.")
                );
                setChestIcon('battery', level);
            }
        };
        b.addEventListener('levelchange', update);
        b.addEventListener('chargingchange', update);
        update();
    } catch(e) { log("Battery API no disponible."); }
}

function updateBatteryBar(level, charging) {
    const fill = RonState.ui.batteryFill;
    if (!fill) return;
    fill.style.width = `${Math.max(4, level)}%`;
    fill.className = 'battery-fill ' + (level > 40 ? 'high' : level > 15 ? 'medium' : 'low');
    if (charging) fill.style.background = '#00d4ff';
}

// ── Estado visual (punto de color) ───────────────────────────────────────────
export function handleStateChange(newState) {
    const isNight = document.body.classList.contains('night-mode');
    const dot     = RonState.ui.statusDot;

    // Color de ojos según estado
    switch (newState) {
        case 'LISTENING': setEyeColor(isNight ? '#ffffff' : '#0099cc'); break;
        case 'SLEEPING':  setEyeColor(isNight ? '#003344' : '#888888'); break;
        default:          setEyeColor(isNight ? '#00d4ff' : '#111111'); break;
    }

    // Punto de estado
    if (dot) {
        dot.className = 'status-dot';
        const map = { IDLE:'active', LISTENING:'active', SPEAKING:'speaking', THINKING:'thinking', SLEEPING:'sleeping', GLITCH:'error', MATH_GAME:'active', READING_GAME:'active', STORY:'active', HIDE_SEEK:'active', HIDE_SEEK_SEARCH:'active' };
        dot.classList.add(map[newState] || 'active');
    }

    // Pausa respiración en estados activos
    if (RonState.ui.faceWrapper) {
        const pause = ['SPEAKING','THINKING','GLITCH','HIDE_SEEK_SEARCH'].includes(newState);
        RonState.ui.faceWrapper.classList.toggle('active-state', pause);
    }

    // Mic activo cuando escucha
    if (RonState.ui.micToggleBtn) {
        RonState.ui.micToggleBtn.classList.toggle('active', newState === 'LISTENING');
    }
}

export function setEyeColor(color) {
    document.documentElement.style.setProperty('--ron-eye-color', color);
}

export function updateMouth(d) {
    if (RonState.ui.mouth) RonState.ui.mouth.setAttribute('d', d);
}

export function shiftEyes(errX = null, errY = null) {
    const max = 12;
    if (errX !== null && errY !== null) {
        const mx = Math.max(-max, Math.min(max, errX * -90));
        const my = Math.max(-max, Math.min(max, errY * -50));
        [RonState.ui.eyes.left, RonState.ui.eyes.right].forEach(el => {
            if (el) el.style.transform = `translate(${mx}px,${my}px)`;
        });
    } else {
        const offset = (Math.random() - 0.5) * 16;
        [RonState.ui.eyes.left, RonState.ui.eyes.right].forEach(el => {
            if (el) el.style.transform = `translateX(${offset}px)`;
        });
        if (Math.random() > 0.82) {
            import('./sounds.js').then(s => s.playBeep(2800, 'square', 0.006, 0.01));
        }
    }
}

// ── Iconos del pecho rediseñados ─────────────────────────────────────────────
export function setChestIcon(type, value = null) {
    const icon = RonState.ui.chestIcon;
    if (!icon) return;
    icon.innerHTML = '';
    icon.className = 'chest-icon-container';

    switch (type) {

        case 'heart':
            // Corazón con doble pulso realista
            icon.innerHTML = `<svg viewBox="0 0 100 95" aria-hidden="true">
                <path fill="#ff3366" d="M50 88 C50 88 8 56 8 28 C8 10 24 4 38 14 C43 17 47 21 50 26 C53 21 57 17 62 14 C76 4 92 10 92 28 C92 56 50 88 50 88Z"/>
                <path fill="rgba(255,255,255,0.25)" d="M28 22 Q38 14 50 18 Q40 10 26 16Z"/>
            </svg>`;
            icon.classList.add('heart-beat');
            break;

        case 'wifi':
            // Wifi con ondas animadas secuencialmente
            icon.innerHTML = `<svg viewBox="0 0 100 80" aria-hidden="true">
                <circle cx="50" cy="70" r="7" fill="#111"/>
                <path class="wifi-ring" d="M27 50 A32 32 0 0 1 73 50" stroke="#111" stroke-width="7" stroke-linecap="round" fill="none"/>
                <path class="wifi-ring" d="M13 35 A51 51 0 0 1 87 35" stroke="#111" stroke-width="7" stroke-linecap="round" fill="none"/>
                <path class="wifi-ring" d="M1  20 A69 69 0 0 1 99 20" stroke="#111" stroke-width="7" stroke-linecap="round" fill="none"/>
            </svg>`;
            icon.classList.add('wifi-animate');
            break;

        case 'search':
            // Lupa que gira
            icon.innerHTML = `<svg viewBox="0 0 100 100" fill="none" aria-hidden="true">
                <g class="search-spin">
                    <circle cx="40" cy="40" r="24" stroke="#111" stroke-width="7"/>
                    <line x1="58" y1="58" x2="86" y2="86" stroke="#111" stroke-width="7" stroke-linecap="round"/>
                    <line x1="32" y1="40" x2="48" y2="40" stroke="#111" stroke-width="4" stroke-linecap="round" opacity="0.4"/>
                    <line x1="40" y1="32" x2="40" y2="48" stroke="#111" stroke-width="4" stroke-linecap="round" opacity="0.4"/>
                </g>
            </svg>`;
            break;

        case 'warning':
            icon.innerHTML = `<svg viewBox="0 0 100 100" aria-hidden="true">
                <path fill="#ff3b3b" d="M50 10 L94 88 L6 88 Z"/>
                <rect x="46" y="35" width="8" height="28" rx="4" fill="white"/>
                <circle cx="50" cy="74" r="5" fill="white"/>
            </svg>`;
            break;

        case 'battery':
            // Batería con nivel real
            const pct  = value !== null ? Math.max(0, Math.min(100, value)) : (RonState.batteryLevel || 100);
            const col  = pct > 40 ? '#22c55e' : pct > 15 ? '#f59e0b' : '#ef4444';
            const warn = pct <= 15 ? ' battery-warn' : '';
            icon.innerHTML = `<svg viewBox="0 0 100 60" aria-hidden="true">
                <rect x="2" y="8" width="84" height="44" rx="8" fill="none" stroke="#111" stroke-width="5"/>
                <rect x="86" y="22" width="12" height="16" rx="4" fill="#111"/>
                <rect x="8" y="14" width="${Math.round(72 * pct / 100)}" height="32" rx="4" fill="${col}" class="${warn.trim()}"/>
                <text x="50" y="38" text-anchor="middle" font-size="16" font-weight="700" fill="${pct > 40 ? '#fff' : '#111'}" font-family="sans-serif">${pct}%</text>
            </svg>`;
            break;

        case 'zz':
            // Zzzs que flotan hacia arriba
            icon.innerHTML = `<svg viewBox="0 0 100 80" aria-hidden="true">
                <text class="zz-float" x="10" y="62" fill="#888" font-size="38" font-weight="900" font-family="sans-serif">z</text>
                <text class="zz-float" x="40" y="46" fill="#aaa" font-size="28" font-weight="900" font-family="sans-serif">z</text>
                <text class="zz-float" x="64" y="32" fill="#ccc" font-size="20" font-weight="900" font-family="sans-serif">z</text>
            </svg>`;
            break;

        case 'face':
            // Reconocimiento facial — destello especial
            icon.innerHTML = `<svg viewBox="0 0 100 100" fill="none" aria-hidden="true">
                <rect x="12" y="12" width="76" height="76" rx="18" stroke="#00cc66" stroke-width="6"/>
                <circle cx="35" cy="42" r="7" fill="#00cc66"/>
                <circle cx="65" cy="42" r="7" fill="#00cc66"/>
                <path d="M28 65 Q50 80 72 65" stroke="#00cc66" stroke-width="6" stroke-linecap="round"/>
            </svg>`;
            icon.querySelector('svg').classList.add('face-recognised');
            break;

        case 'music':
            icon.innerHTML = `<svg viewBox="0 0 100 100" fill="none" aria-hidden="true">
                <path d="M40 20 L80 12 L80 42 L40 50 Z" fill="#111"/>
                <circle cx="28" cy="68" r="14" fill="#111"/>
                <circle cx="68" cy="60" r="14" fill="#111"/>
                <line x1="40" y1="50" x2="40" y2="68" stroke="#111" stroke-width="5"/>
                <line x1="80" y1="42" x2="80" y2="60" stroke="#111" stroke-width="5"/>
            </svg>`;
            break;

        case 'star':
            icon.innerHTML = `<svg viewBox="0 0 100 100" aria-hidden="true">
                <path fill="#ffcc00" d="M50 8 L61 37 L92 37 L67 56 L77 85 L50 67 L23 85 L33 56 L8 37 L39 37 Z"/>
            </svg>`;
            icon.style.animation = 'eye-pulse 0.5s ease-in-out infinite alternate';
            break;
    }
}

// ── Expresiones ───────────────────────────────────────────────────────────────
export function setExpression(exp) {
    RonState.expressionState = exp;
    const { left, right } = RonState.ui.eyes;
    if (!left || !right) return;

    [left, right].forEach(el => { el.className = 'eye'; el.style.transform = ''; });

    switch (exp) {
        case 'happy':
            updateMouth('M 15 32 Q 50 52 85 32');
            [left, right].forEach(el => el.classList.add('happy'));
            setChestIcon('heart');
            break;
        case 'neutral':
        default:
            updateMouth('M 22 30 Q 50 44 78 30');
            setChestIcon('wifi');
            break;
        case 'thinking':
            updateMouth('M 32 34 Q 50 36 68 34');
            [left, right].forEach(el => el.classList.add('thinking'));
            setChestIcon('search');
            break;
        case 'sad':
            updateMouth('M 25 38 Q 50 24 75 38');
            setChestIcon('wifi');
            break;
        case 'star':
            updateMouth('M 15 28 Q 50 56 85 28');
            [left, right].forEach(el => el.classList.add('star'));
            setChestIcon('star');
            break;
        case 'surprise':
            updateMouth('M 38 18 Q 50 10 62 18 Q 72 28 62 42 Q 50 52 38 42 Q 28 28 38 18 Z');
            [left, right].forEach(el => el.classList.add('surprise'));
            setChestIcon('wifi');
            break;
        case 'glitch':
            updateMouth('M 15 33 L 85 33');
            [left, right].forEach(el => el.classList.add('glitch'));
            break;
        case 'fear':
            updateMouth('M 30 40 Q 50 28 70 40');
            [left, right].forEach(el => el.classList.add('fear'));
            setChestIcon('warning');
            break;
        case 'flat':
            updateMouth('M 35 33 L 65 33');
            [left, right].forEach(el => el.classList.add('flat'));
            setChestIcon('zz');
            break;
        case 'recognised':
            updateMouth('M 15 32 Q 50 52 85 32');
            [left, right].forEach(el => el.classList.add('happy'));
            setChestIcon('face');
            break;
    }
}

// ── Modo baile ─────────────────────────────────────────────────────────────
export function startDanceMode() {
    if (danceInterval) return; // ya bailando
    document.body.classList.add('dance-mode');
    setChestIcon('music');
    setExpression('star');

    const mouths = [
        'M 15 28 Q 50 56 85 28',
        'M 20 35 Q 50 20 80 35',
        'M 10 30 Q 50 60 90 30',
    ];
    let mi = 0;
    danceInterval = setInterval(() => {
        [RonState.ui.eyes.left, RonState.ui.eyes.right].forEach(el => {
            if (el) { el.className = 'eye dance'; }
        });
        updateMouth(mouths[mi % mouths.length]);
        mi++;
        if (RonState.ui.mouthContainer) RonState.ui.mouthContainer.classList.add('mouth-dance');
    }, 400);
}

export function stopDanceMode() {
    if (danceInterval) { clearInterval(danceInterval); danceInterval = null; }
    document.body.classList.remove('dance-mode');
    if (RonState.ui.mouthContainer) RonState.ui.mouthContainer.classList.remove('mouth-dance');
    setExpression('happy');
}

// ── Reconocimiento facial celebración ────────────────────────────────────────
export function celebrateFaceRecognition() {
    setExpression('recognised');
    setTimeout(() => setExpression('happy'), 1800);
}

// ── Parpadeo ─────────────────────────────────────────────────────────────────
export function startBlinkCycle() {
    const blink = () => {
        const skip = RonState.activityState === 'SPEAKING' ||
                     ['surprise','flat','dance'].includes(RonState.expressionState);
        if (!skip) {
            [RonState.ui.eyes.left, RonState.ui.eyes.right].forEach(e => {
                if (e) e.classList.add('blink');
            });
            setTimeout(() => {
                [RonState.ui.eyes.left, RonState.ui.eyes.right].forEach(e => {
                    if (e) e.classList.remove('blink');
                });
            }, 130);
            if (Math.random() > 0.72) import('./sounds.js').then(s => s.playBeep(3200, 'sine', 0.005, 0.012));
            if (Math.random() > 0.88) {
                const eye = Math.random() > 0.5 ? RonState.ui.eyes.left : RonState.ui.eyes.right;
                if (eye) {
                    eye.classList.add('glitch');
                    setTimeout(() => eye.classList.remove('glitch'), 80 + Math.random() * 120);
                }
            }
        }
        setTimeout(blink, Math.random() * 4500 + 2000);
    };
    blink();
}

// ── Glitch ────────────────────────────────────────────────────────────────────
export function startGlitchEffect() {
    stopGlitchEffect();
    glitchInterval = setInterval(() => {
        const b = document.createElement('div');
        b.className = 'glitch-block';
        b.style.cssText = `width:${Math.random()*120+20}px;height:${Math.random()*40+8}px;left:${Math.random()*100}vw;top:${Math.random()*100}vh`;
        if (RonState.ui.glitchOverlay) { RonState.ui.glitchOverlay.appendChild(b); setTimeout(() => b.remove(), 180); }
    }, 140);
}

export function stopGlitchEffect() {
    if (glitchInterval) { clearInterval(glitchInterval); glitchInterval = null; }
    if (RonState.ui.glitchOverlay) RonState.ui.glitchOverlay.innerHTML = '';
}

export function triggerSafetyGlitch(reason) {
    log(`⚠️ GLITCH: ${reason}`);
    changeState('GLITCH');
    setExpression('glitch');
    if (RonState.ui.mainApp) RonState.ui.mainApp.classList.add('glitch-vibration');
    Sounds.playGlitchSound();
    startGlitchEffect();
    if (RonState.ui.gamePanel && RonState.ui.gameText) {
        RonState.ui.gamePanel.classList.remove('hidden');
        RonState.ui.gameText.style.color = 'red';
        RonState.ui.gameText.style.fontSize = '18px';
        RonState.ui.gameText.innerText = '⚠️ ERROR: ' + reason.substring(0, 60);
    }
    setTimeout(() => {
        stopGlitchEffect();
        if (RonState.ui.mainApp) RonState.ui.mainApp.classList.remove('glitch-vibration');
        changeState('IDLE');
        setExpression('neutral');
        if (RonState.ui.gamePanel) RonState.ui.gamePanel.classList.add('hidden');
        if (RonState.ui.gameText) { RonState.ui.gameText.style.color = ''; RonState.ui.gameText.style.fontSize = ''; }
    }, 5000);
}

export function flash() {
    Sounds.playPhotoSound();
    if (RonState.ui.flash) {
        RonState.ui.flash.classList.add('flash-active');
        setTimeout(() => RonState.ui.flash.classList.remove('flash-active'), 500);
    }
}

export function showPhoto(imgData) {
    if (RonState.ui.photoImg)   RonState.ui.photoImg.src = imgData;
    if (RonState.ui.photoPanel) RonState.ui.photoPanel.classList.remove('hidden');
}

export function hidePhoto() {
    if (RonState.ui.photoPanel) RonState.ui.photoPanel.classList.add('hidden');
    setTimeout(() => { if (RonState.ui.photoImg) RonState.ui.photoImg.src = ''; }, 600);
}

export function startScanningUI() {
    if (RonState.ui.mainApp) RonState.ui.mainApp.classList.add('scanning-mode');
    setChestIcon('search');
}

export function stopScanningUI() {
    if (RonState.ui.mainApp) RonState.ui.mainApp.classList.remove('scanning-mode');
}

export function checkNightMode() {
    const hour = new Date().getHours();
    if (hour >= 21 || hour < 7) {
        document.body.classList.add('night-mode');
        setEyeColor('#00d4ff');
    } else {
        document.body.classList.remove('night-mode');
        setEyeColor('#111111');
    }
}

export function showMoodBubble(emotion) {
    if (!RonState.ui.moodBubble) return;
    const map = { feliz:'😊 Feliz', triste:'😢 Triste', sorprendido:'😮 Sorprendida', enfadado:'😤 Enfadada', miedo:'😨 Asustada', neutral: null };
    const label = map[emotion];
    if (!label) { RonState.ui.moodBubble.classList.add('hidden'); return; }
    RonState.ui.moodBubble.textContent = label;
    RonState.ui.moodBubble.classList.remove('hidden');
    if (moodBubbleTimer) clearTimeout(moodBubbleTimer);
    moodBubbleTimer = setTimeout(() => {
        if (RonState.ui.moodBubble) RonState.ui.moodBubble.classList.add('hidden');
    }, 5000);
}

export function showStoryPanel(text) {
    if (!RonState.ui.storyPanel || !RonState.ui.storyText) return;
    RonState.ui.storyText.innerHTML = text;
    RonState.ui.storyPanel.classList.remove('hidden');
}

export function hideStoryPanel() {
    if (RonState.ui.storyPanel) RonState.ui.storyPanel.classList.add('hidden');
}

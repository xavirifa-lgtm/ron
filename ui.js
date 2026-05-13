import { RonState, log, changeState } from './core.js';
import * as Sounds from './sounds.js';

let glitchInterval  = null;
let moodBubbleTimer = null;

export function initUI() {
    RonState.ui = {
        eyes: {
            left:  document.getElementById('eye-left'),
            right: document.getElementById('eye-right')
        },
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
    };

    if (RonState.ui.closeGameBtn) {
        RonState.ui.closeGameBtn.onclick = () => {
            RonState.ui.gamePanel.classList.add('hidden');
        };
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
            log(`Batería: ${level}%`);
            if (level <= 15 && !b.charging && RonState.activityState === 'IDLE') {
                import('./speech.js').then(s =>
                    s.speak("¡Bip! Batería crítica. Por favor enchúfame antes de que me duerma para siempre... bueno, hasta que me cargues.")
                );
                setChestIcon('warning');
            }
        };
        b.addEventListener('levelchange', update);
        b.addEventListener('chargingchange', update);
        update();
    } catch(e) { log("Battery API no disponible."); }
}

export function handleStateChange(newState) {
    const isNight = document.body.classList.contains('night-mode');
    switch (newState) {
        case 'LISTENING': setEyeColor(isNight ? '#ffffff' : '#0099cc'); break;
        case 'SLEEPING':  setEyeColor(isNight ? '#003344' : '#888888'); break;
        default:          setEyeColor(isNight ? '#00d4ff' : '#111111'); break;
    }
}

export function setEyeColor(color) {
    document.documentElement.style.setProperty('--ron-eye-color', color);
}

export function updateMouth(d) {
    if (RonState.ui.mouth) RonState.ui.mouth.setAttribute('d', d);
}

export function shiftEyes(errX = null, errY = null) {
    const maxShift = 12;
    if (errX !== null && errY !== null) {
        const mx = Math.max(-maxShift, Math.min(maxShift, errX * -90));
        const my = Math.max(-maxShift, Math.min(maxShift, errY * -50));
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

export function setChestIcon(type) {
    const icon = RonState.ui.chestIcon;
    if (!icon) return;
    icon.innerHTML = '';
    icon.className = 'chest-icon-container';

    if (type === 'heart') {
        icon.innerHTML = `<svg viewBox="0 0 100 90">
            <path fill="#ff4466" d="M50 85 C50 85 10 55 10 28 C10 10 28 5 40 15 C44 18 48 22 50 26 C52 22 56 18 60 15 C72 5 90 10 90 28 C90 55 50 85 50 85Z"/>
        </svg>`;
        icon.classList.add('heart-beat');
    } else if (type === 'warning') {
        icon.innerHTML = `<svg viewBox="0 0 100 100">
            <path fill="#ff3b3b" d="M50 12 L92 88 L8 88 Z"/>
            <text x="50" y="78" fill="white" text-anchor="middle" font-weight="900" font-size="42">!</text>
        </svg>`;
    } else if (type === 'wifi') {
        icon.innerHTML = `<svg viewBox="0 0 100 80" fill="none">
            <circle cx="50" cy="68" r="7" fill="#111"/>
            <path d="M28 48 A31 31 0 0 1 72 48" stroke="#111" stroke-width="7" stroke-linecap="round"/>
            <path d="M14 33 A50 50 0 0 1 86 33" stroke="#111" stroke-width="7" stroke-linecap="round"/>
            <path d="M2 18 A68 68 0 0 1 98 18"  stroke="#111" stroke-width="7" stroke-linecap="round"/>
        </svg>`;
    } else if (type === 'search') {
        icon.innerHTML = `<svg viewBox="0 0 100 100" fill="none">
            <circle cx="40" cy="40" r="26" stroke="#111" stroke-width="7"/>
            <line x1="60" y1="60" x2="88" y2="88" stroke="#111" stroke-width="7" stroke-linecap="round"/>
        </svg>`;
    } else if (type === 'zz') {
        icon.innerHTML = `<svg viewBox="0 0 100 80">
            <text x="8"  y="58" fill="#888" font-size="38" font-weight="900" font-family="sans-serif">z</text>
            <text x="40" y="42" fill="#aaa" font-size="28" font-weight="900" font-family="sans-serif">z</text>
            <text x="65" y="30" fill="#ccc" font-size="20" font-weight="900" font-family="sans-serif">z</text>
        </svg>`;
    }
}

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
            setChestIcon('heart');
            break;

        case 'surprise':
            // BUG FIX: elipse simple como boca "O" abierta — válido en todos los navegadores
            // Usamos path de elipse manual en vez de encadenar arcos A que fallan
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
    }
}

export function startBlinkCycle() {
    const blink = () => {
        const skip = ['SPEAKING','surprise','flat'].includes(RonState.activityState) ||
                     ['surprise','flat'].includes(RonState.expressionState);
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
            // Tic de glitch aleatorio en un solo ojo
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

export function startGlitchEffect() {
    stopGlitchEffect();
    glitchInterval = setInterval(() => {
        const b = document.createElement('div');
        b.className = 'glitch-block';
        b.style.cssText = `width:${Math.random()*120+20}px;height:${Math.random()*40+8}px;left:${Math.random()*100}vw;top:${Math.random()*100}vh`;
        if (RonState.ui.glitchOverlay) {
            RonState.ui.glitchOverlay.appendChild(b);
            setTimeout(() => b.remove(), 180);
        }
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
        RonState.ui.gameText.style.color    = 'red';
        RonState.ui.gameText.style.fontSize = '18px';
        RonState.ui.gameText.innerText      = '⚠️ ERROR: ' + reason.substring(0, 60);
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
    const moodMap = {
        feliz: '😊 Feliz', triste: '😢 Triste', sorprendido: '😮 Sorprendida',
        enfadado: '😤 Enfadada', miedo: '😨 Asustada', neutral: null
    };
    const label = moodMap[emotion];
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

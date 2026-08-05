import { RonState, log, changeState } from './core.js';
import * as Sounds from './sounds.js';
import {
    initCanvas, canvasSetExpression, canvasSetEyeColor,
    canvasShiftEyes, canvasTriggerBlink, canvasAddGlitch
} from './face-canvas.js';

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
        faceWrapper:    document.getElementById('face-wrapper'),
        closeGameBtn:   document.getElementById('close-game-btn'),
        // status-dot y battery-fill eliminados — sin barra de estado visible
    };

    if (RonState.ui.closeGameBtn) {
        RonState.ui.closeGameBtn.onclick = () => RonState.ui.gamePanel.classList.add('hidden');
    }

    initCanvas();
    initBattery();
}

async function initBattery() {
    if (!('getBattery' in navigator)) return;
    try {
        const b = await navigator.getBattery();
        const update = () => {
            const level = Math.round(b.level * 100);
            RonState.batteryLevel = level;
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

export function handleStateChange(newState) {
    const isNight = document.body.classList.contains('night-mode');

    switch (newState) {
        case 'LISTENING': setEyeColor(isNight ? '#ffffff' : '#006699'); break;
        case 'SLEEPING':  setEyeColor(isNight ? '#223344' : '#558899'); break;
        default:          setEyeColor(isNight ? '#00d4ff' : '#0d0d0d'); break;
    }

    if (RonState.ui.micToggleBtn) {
        RonState.ui.micToggleBtn.classList.toggle('active', newState === 'LISTENING');
    }
}

export function setEyeColor(color) {
    document.documentElement.style.setProperty('--ron-eye-color', color);
    canvasSetEyeColor(color);
}

export function updateMouth(d) {
    if (RonState.ui.mouth) RonState.ui.mouth.setAttribute('d', d);
}

export function shiftEyes(errX = null, errY = null) {
    canvasShiftEyes(errX, errY);
    const max = 10;
    if (errX !== null && errY !== null) {
        const mx = Math.max(-max, Math.min(max, errX * -70));
        const my = Math.max(-max, Math.min(max, errY * -40));
        [RonState.ui.eyes.left, RonState.ui.eyes.right].forEach(el => {
            if (el) el.style.transform = `translate(${mx}px,${my}px)`;
        });
    }
    // (Se quitó el beep aleatorio al mover los ojos — añadía ruido innecesario)
}

export function setChestIcon(type, value = null) {
    const icon = RonState.ui.chestIcon;
    if (!icon) return;
    icon.innerHTML = '';
    icon.className = 'chest-icon-container';

    switch (type) {
        case 'heart':
            icon.innerHTML = `<svg viewBox="0 0 100 92" aria-hidden="true">
                <path fill="#ff3366" d="M50 86 C50 86 9 55 9 27 C9 10 25 4 39 14 C43 17 47 21 50 26 C53 21 57 17 61 14 C75 4 91 10 91 27 C91 55 50 86 50 86Z"/>
            </svg>`;
            icon.classList.add('heart-beat');
            break;

        case 'wifi':
            icon.innerHTML = `<svg viewBox="0 0 100 78" aria-hidden="true">
                <circle cx="50" cy="69" r="6" fill="#0d0d0d"/>
                <path class="wifi-ring" d="M29 50 A30 30 0 0 1 71 50" stroke="#0d0d0d" stroke-width="6" stroke-linecap="round" fill="none"/>
                <path class="wifi-ring" d="M15 35 A49 49 0 0 1 85 35" stroke="#0d0d0d" stroke-width="6" stroke-linecap="round" fill="none"/>
                <path class="wifi-ring" d="M3  20 A67 67 0 0 1 97 20" stroke="#0d0d0d" stroke-width="6" stroke-linecap="round" fill="none"/>
            </svg>`;
            icon.classList.add('wifi-animate');
            break;

        case 'search':
            icon.innerHTML = `<svg viewBox="0 0 100 100" fill="none" aria-hidden="true">
                <g class="search-spin">
                    <circle cx="40" cy="40" r="24" stroke="#0d0d0d" stroke-width="6"/>
                    <line x1="58" y1="58" x2="84" y2="84" stroke="#0d0d0d" stroke-width="6" stroke-linecap="round"/>
                </g>
            </svg>`;
            break;

        case 'warning':
            icon.innerHTML = `<svg viewBox="0 0 100 100" aria-hidden="true">
                <path fill="#ff3b3b" d="M50 10 L94 88 L6 88 Z"/>
                <rect x="46" y="36" width="8" height="26" rx="4" fill="white"/>
                <circle cx="50" cy="74" r="5" fill="white"/>
            </svg>`;
            break;

        case 'battery': {
            const pct = value !== null ? Math.max(0, Math.min(100, value)) : (RonState.batteryLevel || 100);
            const col = pct > 40 ? '#22c55e' : pct > 15 ? '#f59e0b' : '#ef4444';
            icon.innerHTML = `<svg viewBox="0 0 100 58" aria-hidden="true">
                <rect x="2" y="7" width="84" height="44" rx="8" fill="none" stroke="#0d0d0d" stroke-width="5"/>
                <rect x="86" y="21" width="12" height="16" rx="4" fill="#0d0d0d"/>
                <rect x="8" y="13" width="${Math.round(72 * pct / 100)}" height="32" rx="4" fill="${col}"/>
            </svg>`;
            break;
        }

        case 'zz':
            icon.innerHTML = `<svg viewBox="0 0 100 78" aria-hidden="true">
                <text class="zz-float" x="8"  y="56" fill="#4488aa" font-size="32" font-weight="900" font-family="sans-serif">z</text>
                <text class="zz-float" x="36" y="42" fill="#5599bb" font-size="24" font-weight="900" font-family="sans-serif">z</text>
                <text class="zz-float" x="60" y="30" fill="#66aacc" font-size="17" font-weight="900" font-family="sans-serif">z</text>
            </svg>`;
            break;

        case 'face':
            icon.innerHTML = `<svg viewBox="0 0 100 100" fill="none" aria-hidden="true">
                <rect x="12" y="12" width="76" height="76" rx="16" stroke="#00cc66" stroke-width="5.5"/>
                <rect x="28" y="36" width="16" height="16" rx="4" fill="#00cc66"/>
                <rect x="56" y="36" width="16" height="16" rx="4" fill="#00cc66"/>
                <path d="M30 64 Q50 78 70 64" stroke="#00cc66" stroke-width="5" stroke-linecap="round"/>
            </svg>`;
            icon.querySelector('svg').classList.add('face-recognised');
            break;

        case 'music':
            icon.innerHTML = `<svg viewBox="0 0 100 100" fill="none" aria-hidden="true">
                <path d="M38 22 L78 14 L78 42 L38 50 Z" fill="#0d0d0d"/>
                <circle cx="26" cy="66" r="13" fill="#0d0d0d"/>
                <circle cx="66" cy="58" r="13" fill="#0d0d0d"/>
                <line x1="38" y1="50" x2="38" y2="66" stroke="#0d0d0d" stroke-width="5"/>
                <line x1="78" y1="42" x2="78" y2="58" stroke="#0d0d0d" stroke-width="5"/>
            </svg>`;
            break;

        case 'star':
            icon.innerHTML = `<svg viewBox="0 0 100 100" aria-hidden="true">
                <path fill="#ffcc00" d="M50 8 L61 37 L92 37 L67 56 L77 85 L50 67 L23 85 L33 56 L8 37 L39 37 Z"/>
            </svg>`;
            break;
    }
}

// ── Expresiones ───────────────────────────────────────────────────────────────
export function setExpression(exp) {
    RonState.expressionState = exp;
    canvasSetExpression(exp);
    const { left, right } = RonState.ui.eyes;
    if (!left || !right) return;
    [left, right].forEach(el => { el.className = 'eye'; el.style.transform = ''; });

    switch (exp) {
        case 'happy':
            updateMouth('M 20 18 Q 50 34 80 18');
            [left, right].forEach(el => el.classList.add('happy'));
            setChestIcon('heart');
            break;
        case 'neutral':
        default:
            updateMouth('M 24 18 Q 50 28 76 18');
            setChestIcon('wifi');
            break;
        case 'thinking':
            updateMouth('M 34 20 Q 50 22 66 20');
            [left, right].forEach(el => el.classList.add('thinking'));
            setChestIcon('search');
            break;
        case 'sad':
            updateMouth('M 26 26 Q 50 15 74 26');
            setChestIcon('wifi');
            break;
        case 'star':
            updateMouth('M 16 16 Q 50 38 84 16');
            [left, right].forEach(el => el.classList.add('star'));
            setChestIcon('star');
            break;
        case 'surprise':
            updateMouth('M 38 12 Q 50 6 62 12 Q 68 20 62 30 Q 50 36 38 30 Q 32 20 38 12 Z');
            [left, right].forEach(el => el.classList.add('surprise'));
            setChestIcon('wifi');
            break;
        case 'glitch':
            updateMouth('M 18 20 L 82 20');
            [left, right].forEach(el => el.classList.add('glitch'));
            break;
        case 'fear':
            updateMouth('M 30 26 Q 50 16 70 26');
            [left, right].forEach(el => el.classList.add('fear'));
            setChestIcon('warning');
            break;
        case 'flat':
            updateMouth('M 36 20 L 64 20');
            [left, right].forEach(el => el.classList.add('flat'));
            setChestIcon('zz');
            break;
        case 'recognised':
            updateMouth('M 20 18 Q 50 34 80 18');
            [left, right].forEach(el => el.classList.add('happy'));
            setChestIcon('face');
            break;
    }
}

export function startDanceMode() {
    if (danceInterval) return false; // ya bailando
    document.body.classList.add('dance-mode');
    setChestIcon('music');
    setExpression('star');
    const mouths = ['M 16 16 Q 50 38 84 16', 'M 20 26 Q 50 12 80 26', 'M 14 18 Q 50 42 86 18'];
    let mi = 0;
    danceInterval = setInterval(() => {
        [RonState.ui.eyes.left, RonState.ui.eyes.right].forEach(el => {
            if (el) el.className = 'eye dance';
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

export function celebrateFaceRecognition() {
    setExpression('recognised');
    setTimeout(() => setExpression('happy'), 1800);
}

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
            }, 105);
            canvasTriggerBlink();
        }
        setTimeout(blink, Math.random() * 5000 + 2500);
    };
    blink();
}

// Glitches durante IDLE — sutiles, espaciados y CASI SIEMPRE SILENCIOSOS.
// Antes sonaba cada 8–30s (estática/zumbidos/beeps) y hacía que Ron pareciera roto.
// Ahora: cada 25–70s, visual la mayoría de veces, sonido muy de vez en cuando y suave.
export function startIdleGlitchLoop() {
    const tick = () => {
        const delay = 25000 + Math.random() * 45000; // cada 25–70 s
        setTimeout(() => {
            // Solo si Ron está tranquilo y sin hablar/escuchar activamente
            if (RonState.activityState !== 'IDLE' || RonState.isRecognitionActive) { tick(); return; }
            const r = Math.random();
            const withSound = Math.random() < 0.15; // sonido solo 15% de las veces

            if (r < 0.5) {
                // Parpadeo glitch doble (visual)
                canvasTriggerBlink();
                setTimeout(() => canvasTriggerBlink(), 90);
            } else if (r < 0.8) {
                // Micro-estática visual breve
                canvasAddGlitch(4, 0.10);
                if (withSound) import('./sounds.js').then(s => s.playStatic(0.05, 0.03));
            } else {
                // Temblor de ojos leve
                canvasShiftEyes((Math.random() - 0.5) * 0.3, 0);
                setTimeout(() => canvasShiftEyes(0, 0), 100);
            }
            tick();
        }, delay);
    };
    tick();
}

export function startGlitchEffect() {
    stopGlitchEffect();
    glitchInterval = setInterval(() => {
        const b = document.createElement('div');
        b.className = 'glitch-block';
        b.style.cssText = `width:${Math.random()*100+14}px;height:${Math.random()*32+5}px;left:${Math.random()*100}vw;top:${Math.random()*100}vh`;
        if (RonState.ui.glitchOverlay) { RonState.ui.glitchOverlay.appendChild(b); setTimeout(() => b.remove(), 155); }
    }, 125);
}

export function stopGlitchEffect() {
    if (glitchInterval) { clearInterval(glitchInterval); glitchInterval = null; }
    if (RonState.ui.glitchOverlay) RonState.ui.glitchOverlay.innerHTML = '';
}

export function triggerSafetyGlitch(reason) {
    log(`⚠️ GLITCH: ${reason}`);
    changeState('GLITCH');
    setExpression('glitch');
    canvasAddGlitch(10, 0.5);
    if (RonState.ui.mainApp) RonState.ui.mainApp.classList.add('glitch-vibration');
    Sounds.playGlitchSound();
    startGlitchEffect();
    if (RonState.ui.gamePanel && RonState.ui.gameText) {
        RonState.ui.gamePanel.classList.remove('hidden');
        RonState.ui.gameText.style.color    = 'red';
        RonState.ui.gameText.style.fontSize = '16px';
        RonState.ui.gameText.innerText      = '⚠️ ERROR: ' + reason.substring(0, 55);
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
        setTimeout(() => RonState.ui.flash.classList.remove('flash-active'), 420);
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
        setEyeColor('#0d0d0d');
    }
}

export function showMoodBubble(emotion) {
    if (!RonState.ui.moodBubble) return;
    const map = { feliz:'😊 Feliz', triste:'😢 Triste', sorprendido:'😮 Sorprendida', enfadado:'😤 Enfadada', miedo:'😨 Asustada', neutral:null };
    const label = map[emotion];
    if (!label) { RonState.ui.moodBubble.classList.add('hidden'); return; }
    RonState.ui.moodBubble.textContent = label;
    RonState.ui.moodBubble.classList.remove('hidden');
    if (moodBubbleTimer) clearTimeout(moodBubbleTimer);
    moodBubbleTimer = setTimeout(() => { if (RonState.ui.moodBubble) RonState.ui.moodBubble.classList.add('hidden'); }, 5000);
}

export function showStoryPanel(text) {
    if (!RonState.ui.storyPanel || !RonState.ui.storyText) return;
    RonState.ui.storyText.innerHTML = text;
    RonState.ui.storyPanel.classList.remove('hidden');
}

export function hideStoryPanel() {
    if (RonState.ui.storyPanel) RonState.ui.storyPanel.classList.add('hidden');
}

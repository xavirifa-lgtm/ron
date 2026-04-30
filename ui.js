import { RonState, log, changeState } from './core.js';
import * as Sounds from './sounds.js';

let glitchInterval = null;

export function initUI() {
    RonState.ui = {
        eyes: { left: document.getElementById('eye-left'), right: document.getElementById('eye-right') },
        mouth: document.getElementById('mouth-path'),
        mouthContainer: document.querySelector('.mouth-svg'),
        chestIcon: document.getElementById('chest-icon-container'),
        bleBtn: document.getElementById('ble-connect-btn'),
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
        photoPanel: document.getElementById('photo-panel'),
        photoImg: document.getElementById('photo-img'),
        flash: document.getElementById('camera-flash'),
        mainApp: document.getElementById('ron-app')
    };
    initBattery();
}

async function initBattery() {
    if ('getBattery' in navigator) {
        const b = await navigator.getBattery();
        const update = () => {
            const level = Math.round(b.level * 100);
            log(`🔋 Energía: ${level}%`);
            // El icono de wifi ahora mostrará el nivel de batería en el futuro
        };
        b.addEventListener('levelchange', update);
        update();
    }
}

export function handleStateChange(newState) {
    switch (newState) {
        case 'IDLE':
        case 'THINKING':
        case 'SPEAKING':
        case 'GLITCH':
            setEyeColor('#1a1a1a'); 
            break;
        case 'LISTENING': 
            setEyeColor('#00d4ff'); 
            break;
    }
}

export function setEyeColor(color) { 
    document.documentElement.style.setProperty('--ron-eye-color', color); 
}

export function updateMouth(d) { 
    RonState.ui.mouth.setAttribute('d', d); 
}

export function shiftEyes() {
    const offset = (Math.random() - 0.5) * 20;
    [RonState.ui.eyes.left, RonState.ui.eyes.right].forEach(el => { el.style.transform = `translateX(${offset}px)`; });
}

export function setChestIcon(type) {
    const icon = RonState.ui.chestIcon;
    icon.innerHTML = '';
    icon.className = 'chest-icon-container';

    if (type === 'heart') {
        icon.innerHTML = '<svg viewBox="0 0 100 100"><path fill="white" d="M 50 90 L 15 55 A 25 25 0 0 1 50 25 A 25 25 0 0 1 85 55 Z" /></svg>';
        icon.classList.add('heart-beat');
    } else if (type === 'warning') {
        icon.innerHTML = '<svg viewBox="0 0 100 100"><path fill="#ff3b3b" d="M 50 15 L 90 85 L 10 85 Z" /><text x="50" y="75" fill="white" text-anchor="middle" font-weight="bold" font-size="40">!</text></svg>';
    } else if (type === 'wifi') {
        icon.innerHTML = '<svg viewBox="0 0 100 100" fill="white"><path d="M 50 80 A 10 10 0 1 1 50 81 Z M 20 50 A 40 40 0 0 1 80 50 L 75 55 A 35 35 0 0 0 25 55 Z M 5 35 A 55 55 0 0 1 95 35 L 90 40 A 50 50 0 0 0 10 40 Z" /></svg>';
    } else if (type === 'search') {
        icon.innerHTML = '<svg viewBox="0 0 100 100" fill="none" stroke="white" stroke-width="8"><circle cx="40" cy="40" r="25"/><line x1="60" y1="60" x2="85" y2="85"/></svg>';
    }
}

export function setExpression(exp) {
    RonState.expressionState = exp;
    [RonState.ui.eyes.left, RonState.ui.eyes.right].forEach(el => { el.className = 'eye'; el.style.transform = ''; });
    
    if (exp === 'happy') { 
        updateMouth('M 20 30 Q 50 45 80 30'); 
        RonState.ui.eyes.left.classList.add('happy'); RonState.ui.eyes.right.classList.add('happy');
        setChestIcon('heart');
    } else if (exp === 'neutral') {
        updateMouth('M 25 35 Q 50 48 75 35'); 
        setChestIcon('wifi');
    } else if (exp === 'thinking') {
        updateMouth('M 40 35 L 60 35'); 
        RonState.ui.eyes.left.classList.add('thinking'); RonState.ui.eyes.right.classList.add('thinking');
        setChestIcon('search');
    } else if (exp === 'sad') {
        updateMouth('M 30 45 Q 50 30 70 45'); 
    } else if (exp === 'star') {
        updateMouth('M 20 30 Q 50 50 80 30');
        RonState.ui.eyes.left.classList.add('star'); RonState.ui.eyes.right.classList.add('star');
    } else if (exp === 'glitch') {
        updateMouth('M 20 35 L 80 35');
        RonState.ui.eyes.left.classList.add('glitch'); RonState.ui.eyes.right.classList.add('glitch');
    } else if (exp === 'fear') {
        updateMouth('M 35 45 Q 50 35 65 45'); 
        RonState.ui.eyes.left.classList.add('fear'); RonState.ui.eyes.right.classList.add('fear');
        setChestIcon('warning');
    } else { 
        updateMouth('M 25 35 Q 50 48 75 35'); 
        stopGlitchEffect(); 
    }
}

export function startBlinkCycle() {
    const b = () => {
        if (RonState.activityState !== 'SPEAKING' && RonState.expressionState !== 'surprise') {
            [RonState.ui.eyes.left, RonState.ui.eyes.right].forEach(e => e.classList.add('blink'));
            setTimeout(() => [RonState.ui.eyes.left, RonState.ui.eyes.right].forEach(e => e.classList.remove('blink')), 150);
        }
        setTimeout(b, Math.random() * 4000 + 2000);
    };
    b();
}

export function startGlitchEffect() {
    stopGlitchEffect();
    glitchInterval = setInterval(() => {
        const b = document.createElement('div'); b.className = 'glitch-block';
        b.style.width = `${Math.random()*100+20}px`; b.style.height = `${Math.random()*50+10}px`;
        b.style.left = `${Math.random()*100}vw`; b.style.top = `${Math.random()*100}vh`;
        RonState.ui.glitchOverlay.appendChild(b);
        setTimeout(() => b.remove(), 200);
    }, 150);
}

export function stopGlitchEffect() { 
    if (glitchInterval) clearInterval(glitchInterval); 
    if (RonState.ui.glitchOverlay) RonState.ui.glitchOverlay.innerHTML = ''; 
}

export function triggerSafetyGlitch(reason) {
    log(`⚠️ GLITCH: ${reason}`);
    changeState('GLITCH');
    setExpression('glitch');
    RonState.ui.mainApp.classList.add('glitch-vibration');
    Sounds.playGlitchSound();
    startGlitchEffect();
    
    RonState.ui.gamePanel.classList.remove('hidden');
    RonState.ui.gameText.style.color = "red";
    RonState.ui.gameText.innerText = "ERROR: " + reason;

    setTimeout(() => {
        stopGlitchEffect();
        RonState.ui.mainApp.classList.remove('glitch-vibration');
        changeState('IDLE');
        setExpression('neutral');
        RonState.ui.gamePanel.classList.add('hidden');
        RonState.ui.gameText.style.color = ""; 
    }, 5000);
}

export function flash() {
    Sounds.playPhotoSound();
    RonState.ui.flash.classList.add('flash-active');
    setTimeout(() => RonState.ui.flash.classList.remove('flash-active'), 500);
}

export function showPhoto(imgData) {
    RonState.ui.photoImg.src = imgData;
    RonState.ui.photoPanel.classList.remove('hidden');
}

export function hidePhoto() {
    RonState.ui.photoPanel.classList.add('hidden');
    setTimeout(() => { RonState.ui.photoImg.src = ""; }, 500); // Limpiar memoria
}

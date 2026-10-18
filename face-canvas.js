// face-canvas.js — Cara de Ron dibujada con Canvas (estilo B-Bot de la película)
import { RonState } from './core.js';
import { voiceLevel } from './tts.js';

let canvas, ctx, W, H;

let blinkP = 0, blinkDir = 0, blinkWait = 2500 + Math.random() * 3000;
let eyeX = 0, eyeY = 0, eyeTargX = 0, eyeTargY = 0;
let sacT = 2 + Math.random() * 3;
let expr = 'neutral';
let ec = { r: 18, g: 20, b: 24 };
let t = 0, speakT = 0, danceT = 0, mouthOpen = 0;
let glitches = [];
let lastTs = 0;

const TARGETS = {
    neutral:    { eyeS: 1.00, eyeSY: 1.00, browY: 0.00, browTilt: 0.00, smile: 0.55, mouthW: 1.00, blush: 0.15 },
    happy:      { eyeS: 1.00, eyeSY: 1.00, browY: 0.18, browTilt: -0.05, smile: 1.00, mouthW: 1.15, blush: 0.55 },
    recognised: { eyeS: 1.05, eyeSY: 1.00, browY: 0.30, browTilt: -0.05, smile: 1.00, mouthW: 1.20, blush: 0.65 },
    star:       { eyeS: 1.10, eyeSY: 1.00, browY: 0.35, browTilt: -0.10, smile: 1.10, mouthW: 1.25, blush: 0.70 },
    surprise:   { eyeS: 1.22, eyeSY: 1.08, browY: 0.60, browTilt: 0.05, smile: 0.00, mouthW: 0.70, blush: 0.10 },
    fear:       { eyeS: 0.82, eyeSY: 1.05, browY: 0.35, browTilt: 0.45, smile: -0.45, mouthW: 0.85, blush: 0.00 },
    sad:        { eyeS: 0.95, eyeSY: 0.92, browY: 0.05, browTilt: 0.55, smile: -0.70, mouthW: 0.85, blush: 0.00 },
    thinking:   { eyeS: 0.95, eyeSY: 0.80, browY: 0.10, browTilt: 0.00, smile: 0.10, mouthW: 0.70, blush: 0.05 },
    flat:       { eyeS: 1.00, eyeSY: 0.08, browY: -0.15, browTilt: 0.00, smile: 0.25, mouthW: 0.70, blush: 0.10 },
    glitch:     { eyeS: 1.00, eyeSY: 1.00, browY: 0.10, browTilt: 0.20, smile: -0.15, mouthW: 1.00, blush: 0.00 },
};
const cur = { ...TARGETS.neutral };

export function initCanvas() {
    canvas = document.getElementById('ron-face');
    if (!canvas) return;
    ctx = canvas.getContext('2d', { alpha: true });
    resize();
    window.addEventListener('resize', resize);
    requestAnimationFrame(loop);
}

function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function loop(ts) {
    const dt = Math.min((ts - lastTs) / 1000, 0.05) || 0.016;
    lastTs = ts;
    tick(dt);
    render();
    requestAnimationFrame(loop);
}

const isDance = () => document.body.classList.contains('dance-mode');
const isNight = () => document.body.classList.contains('night-mode');

function tick(dt) {
    t += dt;
    const e = isDance() ? 'star' : expr;
    const tg = TARGETS[e] || TARGETS.neutral;
    const k = Math.min(1, dt * 9);
    for (const p in tg) cur[p] += (tg[p] - cur[p]) * k;

    sacT -= dt;
    if (sacT <= 0 && RonState.activityState !== 'SPEAKING') {
        sacT = 1.5 + Math.random() * 3.5;
        if (Math.abs(eyeTargX) < 3) { eyeTargX += (Math.random() - 0.5) * 6; eyeTargY += (Math.random() - 0.5) * 3; }
    }
    eyeX += (eyeTargX - eyeX) * Math.min(1, dt * 12);
    eyeY += (eyeTargY - eyeY) * Math.min(1, dt * 12);

    if (blinkDir === 0) {
        blinkWait -= dt * 1000;
        if (blinkWait <= 0) { blinkDir = 1; blinkWait = Math.random() < 0.2 ? 180 : 2200 + Math.random() * 4500; }
    } else if (blinkDir === 1) {
        blinkP = Math.min(1, blinkP + dt / 0.06);
        if (blinkP >= 1) blinkDir = -1;
    } else {
        blinkP = Math.max(0, blinkP - dt / 0.09);
        if (blinkP <= 0) blinkDir = 0;
    }

    let target = 0;
    if (RonState.activityState === 'SPEAKING') {
        const lvl = voiceLevel();
        if (lvl >= 0) target = Math.min(1, lvl);
        else { speakT += dt * 9; target = Math.max(0, Math.sin(speakT) * 0.6 + Math.sin(speakT * 2.3) * 0.4); }
    }
    mouthOpen += (target - mouthOpen) * Math.min(1, dt * (target > mouthOpen ? 28 : 14));

    if (isDance()) danceT += dt * 4.5;
    glitches = glitches.filter(g => (g.life -= dt) > 0);
}

function layout() {
    const R = Math.min(W * 0.14, H * 0.16, 115);
    const gap = Math.min(W * 0.58, R * 3.8);
    const bob = Math.sin(t * 1.4) * R * 0.04 + (isDance() ? Math.sin(danceT) * R * 0.18 : 0);
    const cy = H * 0.44 + bob;
    return { R, lx: W / 2 - gap / 2, rx: W / 2 + gap / 2, cy, my: cy + R * 1.8, mw: R * 1.25 };
}

function color(a = 1) {
    if (isNight()) return `rgba(0,212,255,${a})`;
    return `rgba(${ec.r},${ec.g},${ec.b},${a})`;
}

function render() {
    ctx.clearRect(0, 0, W, H);
    const L = layout();
    const night = isNight();
    const e = isDance() ? 'star' : expr;

    if (night) { ctx.shadowColor = 'rgba(0,212,255,0.55)'; ctx.shadowBlur = 14; }

    drawBlush(L);
    for (const side of [-1, 1]) {
        const cx = (side < 0 ? L.lx : L.rx) + eyeX;
        const cy = L.cy + eyeY;
        drawEye(cx, cy, L.R, e, side);
        drawBrow(cx, cy, L.R, e, side);
    }
    drawMouth(W / 2 + eyeX * 0.4, L.my + eyeY * 0.5, L.mw, e);

    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
    for (const g of glitches) {
        ctx.fillStyle = `rgba(${g.r},${g.g},${g.b},${Math.min(1, g.life * 6) * 0.38})`;
        ctx.fillRect(g.x, g.y, g.w, g.h);
    }
}

function drawBlush(L) {
    if (cur.blush < 0.03 || isNight()) return;
    for (const side of [-1, 1]) {
        const x = (side < 0 ? L.lx : L.rx) + side * L.R * 0.55 + eyeX;
        const y = L.cy + L.R * 1.35 + eyeY;
        const g = ctx.createRadialGradient(x, y, 0, x, y, L.R * 0.75);
        g.addColorStop(0, `rgba(255,140,160,${0.42 * cur.blush})`);
        g.addColorStop(1, 'rgba(255,140,160,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.ellipse(x, y, L.R * 0.75, L.R * 0.45, 0, 0, Math.PI * 2); ctx.fill();
    }
}

function drawEye(cx, cy, R, e, side) {
    ctx.save();
    ctx.translate(cx, cy);
    const r = R * cur.eyeS;

    if (e === 'happy' || e === 'recognised') {
        const lift = 1 - blinkP * 0.6;
        ctx.lineWidth = r * 0.42; ctx.lineCap = 'round'; ctx.strokeStyle = '#0d0d0d';
        ctx.beginPath(); ctx.arc(0, r * 0.35, r * 0.68, Math.PI * 1.12, Math.PI * 1.88, false);
        ctx.save(); ctx.scale(1, lift); ctx.stroke(); ctx.restore();
    } else if (e === 'star') {
        const s = r * 1.15 * (1 + Math.sin(t * 7) * 0.06);
        ctx.rotate(Math.sin(t * 2) * 0.12);
        ctx.fillStyle = color();
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
            const a = i * Math.PI / 2 - Math.PI / 2;
            ctx.lineTo(Math.cos(a) * s, Math.sin(a) * s);
            ctx.quadraticCurveTo(0, 0, Math.cos(a + Math.PI / 2) * s, Math.sin(a + Math.PI / 2) * s);
        }
        ctx.closePath(); ctx.fill();
    } else if (e === 'glitch') {
        ctx.fillStyle = color();
        ctx.fillRect(-r, -r, r * 2, r * 2);
        ctx.save(); ctx.globalCompositeOperation = 'destination-out';
        for (let y = -r + 3; y < r; y += 6) if (Math.random() > 0.45) ctx.fillRect(-r, y, r * 2 * (0.3 + Math.random() * 0.7), 2.5);
        ctx.restore();
    } else {
        const sy = Math.max(cur.eyeSY * (1 - blinkP * 0.94), 0.05);
        ctx.save(); ctx.scale(1, sy);
        
        ctx.fillStyle = '#0d0d0d';
        ctx.beginPath();
        const eyeW = r * 0.72;
        const eyeH = r * 1.28;
        const cornerRadius = eyeW * 0.5;
        if (ctx.roundRect) {
            ctx.roundRect(-eyeW / 2, -eyeH / 2, eyeW, eyeH, cornerRadius);
        } else {
            ctx.rect(-eyeW / 2, -eyeH / 2, eyeW, eyeH);
        }
        ctx.fill();

        if (sy > 0.35 && !isNight()) {
            ctx.fillStyle = 'rgba(255,255,255,0.25)';
            ctx.beginPath();
            ctx.ellipse(0, -eyeH * 0.38, eyeW * 0.45, eyeH * 0.12, 0, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }
    ctx.restore();
}

function drawBrow(cx, cy, R, e, side) {
    if (e === 'flat') return;
    let y = cy - R * (1.45 + cur.browY * 0.6);
    let tilt = cur.browTilt;
    if (e === 'thinking') { tilt = side < 0 ? -0.25 : 0.3; y -= side > 0 ? R * 0.15 : 0; }
    if (e === 'glitch') y += (Math.random() - 0.5) * R * 0.15;
    const len = R * 1.05, th = R * 0.2;
    const ang = side < 0 ? -tilt * 0.6 : tilt * 0.6;
    ctx.save();
    ctx.translate(cx, y);
    ctx.rotate(ang);
    ctx.strokeStyle = color(); ctx.lineWidth = th; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-len / 2, th * 0.15);
    ctx.quadraticCurveTo(0, -th * 0.55, len / 2, th * 0.15);
    ctx.stroke();
    ctx.restore();
}

function drawMouth(cx, cy, w, e) {
    const hw = (w / 2) * cur.mouthW;
    const smile = cur.smile * hw * 0.55;
    const open = mouthOpen;
    ctx.save();
    ctx.strokeStyle = color(); ctx.fillStyle = color();
    ctx.lineWidth = Math.max(4, hw * 0.16); ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    if (e === 'glitch') {
        ctx.beginPath(); ctx.moveTo(cx - hw, cy);
        for (let i = 1; i <= 8; i++) ctx.lineTo(cx - hw + (i / 8) * hw * 2, cy + (i % 2 ? -1 : 1) * hw * 0.12);
        ctx.stroke();
    } else if (e === 'surprise' && open < 0.15) {
        ctx.beginPath(); ctx.ellipse(cx, cy + hw * 0.1, hw * 0.42, hw * 0.52, 0, 0, Math.PI * 2); ctx.fill();
    } else if (open < 0.08 && !(e === 'star' || e === 'recognised')) {
        ctx.beginPath();
        ctx.moveTo(cx - hw * 0.9, cy - smile * 0.15);
        ctx.quadraticCurveTo(cx, cy + smile * 0.9, cx + hw * 0.9, cy - smile * 0.15);
        ctx.stroke();
    } else {
        const o = (e === 'star' || e === 'recognised') ? Math.max(open, 0.45) : open;
        const depth = hw * (0.25 + o * 0.85);
        const top = cy - smile * 0.25;
        ctx.beginPath();
        if (cur.smile >= 0) {
            ctx.moveTo(cx - hw, top);
            ctx.quadraticCurveTo(cx, top + smile * 0.35, cx + hw, top);
            ctx.quadraticCurveTo(cx + hw * 0.9, top + depth * 1.25, cx, top + depth * 1.15);
            ctx.quadraticCurveTo(cx - hw * 0.9, top + depth * 1.25, cx - hw, top);
        } else {
            ctx.moveTo(cx - hw * 0.8, cy + depth * 0.4);
            ctx.quadraticCurveTo(cx, cy - depth * 0.6 + smile * 0.3, cx + hw * 0.8, cy + depth * 0.4);
            ctx.quadraticCurveTo(cx, cy + depth * 0.7, cx - hw * 0.8, cy + depth * 0.4);
        }
        ctx.closePath(); ctx.fill(); ctx.stroke();
        if (o > 0.35 && cur.smile >= 0 && !isNight()) {
            ctx.save(); ctx.clip();
            ctx.fillStyle = 'rgba(255,120,140,0.9)'; ctx.shadowBlur = 0;
            ctx.beginPath(); ctx.ellipse(cx, top + depth * 1.15, hw * 0.45, depth * 0.38, 0, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
        }
    }
    ctx.restore();
}

export function canvasSetExpression(exp) { expr = TARGETS[exp] ? exp : 'neutral'; }

export function canvasSetEyeColor(hex) {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
    ec = { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
}

export function canvasShiftEyes(ex, ey) {
    if (!W) return;
    const mx = Math.min(W * 0.045, 22), my = Math.min(H * 0.03, 14);
    if (ex !== null && ey !== null) {
        eyeTargX = Math.max(-mx, Math.min(mx, ex * -65));
        eyeTargY = Math.max(-my, Math.min(my, ey * -38));
    } else {
        eyeTargX = (Math.random() - 0.5) * mx * 0.8; eyeTargY = 0;
    }
}

export function canvasTriggerBlink() { if (blinkDir === 0) { blinkDir = 1; blinkP = 0; } }

export function canvasAddGlitch(count = 4, dur = 0.15) {
    for (let i = 0; i < count; i++) {
        glitches.push({
            x: Math.random() * W, y: Math.random() * H,
            w: 20 + Math.random() * 140, h: 2 + Math.random() * 12,
            r: Math.random() > 0.4 ? 200 : 20, g: Math.random() > 0.6 ? 200 : 20, b: Math.random() > 0.3 ? 230 : 20,
            life: dur + Math.random() * 0.08
        });
    }
}

export function _debugSet({ open, blink, time } = {}) {
    if (open !== undefined) mouthOpen = open;
    if (blink !== undefined) { blinkP = blink; blinkDir = 0; blinkWait = 1e9; }
    if (time !== undefined) t = time;
    const e = isDance() ? 'star' : expr;
    Object.assign(cur, TARGETS[e] || TARGETS.neutral);
}
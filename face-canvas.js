// face-canvas.js — Renderizado procedural de la cara de Ron con Canvas API
import { RonState } from './core.js';

let canvas, ctx, W, H;

// ── Estado interno ────────────────────────────────────────────────────────
let blinkP    = 0;                          // 0=abierto, 1=cerrado
let blinkDir  = 0;                          // 0=esperando, 1=cerrando, -1=abriendo
let blinkWait = 3000 + Math.random()*4000;  // ms hasta próximo parpadeo

let eyeX = 0, eyeY = 0;                    // posición actual (lerp)
let eyeTargX = 0, eyeTargY = 0;            // objetivo

let expr  = 'neutral';
let ec    = { r: 13, g: 13, b: 13 };       // color de ojo

let speakT = 0;   // oscilador de habla
let danceT = 0;   // fase de baile

let glitches = []; // scanlines de glitch: {x,y,w,h,r,g,b,life}

let lastTs = 0;

// ── Init ──────────────────────────────────────────────────────────────────
export function initCanvas() {
    canvas = document.getElementById('ron-face');
    if (!canvas) return;
    ctx = canvas.getContext('2d', { alpha: true });
    resize();
    window.addEventListener('resize', resize);
    requestAnimationFrame(loop);
}

function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
}

// ── Loop principal ────────────────────────────────────────────────────────
function loop(ts) {
    const dt = Math.min((ts - lastTs) / 1000, 0.05);
    lastTs = ts;
    tick(dt);
    render();
    requestAnimationFrame(loop);
}

function tick(dt) {
    // Lerp de tracking ocular
    eyeX += (eyeTargX - eyeX) * Math.min(1, dt * 10);
    eyeY += (eyeTargY - eyeY) * Math.min(1, dt * 10);

    // Parpadeo
    if (blinkDir === 0) {
        blinkWait -= dt * 1000;
        if (blinkWait <= 0) { blinkDir = 1; blinkWait = 2500 + Math.random() * 5000; }
    } else if (blinkDir === 1) {
        blinkP = Math.min(1, blinkP + dt / 0.065);
        if (blinkP >= 1) blinkDir = -1;
    } else {
        blinkP = Math.max(0, blinkP - dt / 0.10);
        if (blinkP <= 0) { blinkP = 0; blinkDir = 0; }
    }

    // Oscilador de habla
    if (RonState.activityState === 'SPEAKING') speakT += dt * 7.5;

    // Fase de baile
    if (document.body.classList.contains('dance-mode')) danceT += dt * 4.5;

    // Decay de glitches
    glitches = glitches.filter(g => (g.life -= dt) > 0);
}

// ── Layout ────────────────────────────────────────────────────────────────
function getLayout() {
    const eyeW  = Math.min(W * 0.135, 82);
    const eyeH  = eyeW * 1.52;
    const gap   = Math.min(W * 0.26, 160);
    const faceCY = H * 0.44;                  // centro de cara (~-6vh como el CSS)
    const eyeCY  = faceCY - eyeH * 0.28;
    const mouthY = eyeCY  + eyeH * 0.62 + H * 0.085;
    const mouthW = eyeW   * 3.4;
    return {
        lx: W/2 - gap/2,
        rx: W/2 + gap/2,
        ey: eyeCY,
        ew: eyeW, eh: eyeH,
        mx: W/2, my: mouthY, mw: mouthW
    };
}

// ── Render ────────────────────────────────────────────────────────────────
function render() {
    ctx.clearRect(0, 0, W, H);
    const L     = getLayout();
    const night = document.body.classList.contains('night-mode');
    const dance = document.body.classList.contains('dance-mode');

    const ex = L.lx + eyeX;
    const rx = L.rx + eyeX;
    const ey = L.ey + eyeY + (dance ? Math.sin(danceT) * 9 : 0);

    drawEye(ex, ey, L.ew, L.eh, night, dance);
    drawEye(rx, ey, L.ew, L.eh, night, dance);
    drawMouth(L.mx, L.my, L.mw, night, dance);

    for (const g of glitches) {
        const alpha = Math.min(1, g.life * 6) * 0.38;
        ctx.fillStyle = `rgba(${g.r},${g.g},${g.b},${alpha})`;
        ctx.fillRect(g.x, g.y, g.w, g.h);
    }
}

// ── Ojo ───────────────────────────────────────────────────────────────────
function drawEye(cx, cy, ew, eh, night, dance) {
    const rx = ew / 2;

    ctx.save();
    ctx.translate(cx, cy);

    // La expresión 'dance' usa 'star' + rebote en Y (manejado en render)
    const e = dance ? 'star' : expr;

    switch (e) {
        case 'happy':
        case 'recognised':
            drawHappyEye(rx, eh / 2, night);
            break;
        case 'star':
            drawStarEye(rx, night, dance);
            break;
        case 'flat':
            drawFlatEye(rx, night);
            break;
        case 'glitch':
            drawGlitchEye(rx, eh * 0.5, night);
            break;
        case 'surprise':
            drawOvalEye(rx * 1.28, rx * 1.32, night, false);
            break;
        case 'fear':
            drawOvalEye(rx * 0.80, rx * 0.82, night, false);
            break;
        case 'thinking':
            drawSquintEye(rx, eh / 2, night);
            break;
        case 'sad':
            drawSadEye(rx, eh / 2, night);
            break;
        default:
            drawOvalEye(rx, eh / 2, night, true);
    }

    ctx.restore();
}

// ── Gradiente de profundidad plástica ─────────────────────────────────────
function eyeGradient(rx, ry, night) {
    const g = ctx.createRadialGradient(-rx*0.18, -ry*0.28, rx*0.03, 0, 0, rx*1.12);
    if (night) {
        g.addColorStop(0,   'rgb(60,190,230)');
        g.addColorStop(0.5, 'rgb(20,150,195)');
        g.addColorStop(1,   'rgb(0,100,145)');
    } else {
        g.addColorStop(0,   `rgb(${ec.r+28},${ec.g+28},${ec.b+28})`);
        g.addColorStop(0.5, `rgb(${ec.r+8},${ec.g+8},${ec.b+8})`);
        g.addColorStop(1,   `rgb(${Math.max(0,ec.r-5)},${Math.max(0,ec.g-5)},${Math.max(0,ec.b-5)})`);
    }
    return g;
}

// Brillo especular (punto de luz plástico)
function highlight(rx, ry) {
    if (blinkP > 0.78) return;
    const hx = rx*0.30, hy = -ry*0.38, hr = rx*0.16;
    const hg = ctx.createRadialGradient(hx, hy, 0, hx, hy, hr);
    hg.addColorStop(0,    'rgba(255,255,255,0.92)');
    hg.addColorStop(0.45, 'rgba(255,255,255,0.28)');
    hg.addColorStop(1,    'rgba(255,255,255,0)');
    ctx.beginPath();
    ctx.arc(hx, hy, hr, 0, Math.PI*2);
    ctx.fillStyle = hg;
    ctx.fill();
}

function setGlow(night) {
    ctx.shadowColor = night ? 'rgba(0,212,255,0.60)' : 'rgba(0,0,0,0.28)';
    ctx.shadowBlur  = night ? 20 : 10;
}
function clearGlow() { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; }

// Ojo normal oval ─────────────────────────────────────────────────────────
function drawOvalEye(rx, ry, night, allowBlink) {
    const ery = allowBlink ? ry * (1 - blinkP * 0.97) : ry;
    setGlow(night);
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, Math.max(ery, 0.5), 0, 0, Math.PI*2);
    ctx.fillStyle = eyeGradient(rx, ery, night);
    ctx.fill();
    clearGlow();
    ctx.strokeStyle = night ? 'rgba(0,212,255,0.25)' : 'rgba(0,0,0,0.55)';
    ctx.lineWidth   = Math.max(1.5, rx*0.065);
    ctx.stroke();
    highlight(rx, ery);
}

// Ojo feliz: media luna (cúpula en parte superior, plano abajo)
function drawHappyEye(rx, ry, night) {
    const ery = Math.max(ry * 0.78 * (1 - blinkP * 0.97), 0.5);
    setGlow(night);
    ctx.beginPath();
    ctx.moveTo(-rx, 0);
    ctx.ellipse(0, 0, rx, ery, 0, Math.PI, 0, false); // arco superior
    ctx.closePath(); // línea recta abajo
    ctx.fillStyle = eyeGradient(rx, ery, night);
    ctx.fill();
    clearGlow();
    ctx.strokeStyle = night ? 'rgba(0,212,255,0.25)' : 'rgba(0,0,0,0.55)';
    ctx.lineWidth   = Math.max(1.5, rx*0.065);
    ctx.stroke();
    highlight(rx, ery);
}

// Ojo estrella
function drawStarEye(rx, night, dance) {
    const r1 = rx * 1.08 * (dance ? 1 + Math.sin(danceT)*0.12 : 1);
    const r2 = rx * 0.42;
    const pts = 5;
    setGlow(night);
    ctx.beginPath();
    for (let i = 0; i < pts*2; i++) {
        const r = i%2===0 ? r1 : r2;
        const a = (i*Math.PI/pts) - Math.PI/2;
        if (i===0) ctx.moveTo(Math.cos(a)*r, Math.sin(a)*r);
        else       ctx.lineTo(Math.cos(a)*r, Math.sin(a)*r);
    }
    ctx.closePath();
    ctx.fillStyle = night ? 'rgb(0,212,255)' : `rgb(${ec.r+18},${ec.g+18},${ec.b+18})`;
    ctx.fill();
    clearGlow();
}

// Ojo plano (durmiendo)
function drawFlatEye(rx, night) {
    const ry = rx * 0.20;
    setGlow(night);
    ctx.globalAlpha = 0.48;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx*1.05, ry, 0, 0, Math.PI*2);
    ctx.fillStyle = night ? 'rgb(0,180,215)' : `rgb(${ec.r},${ec.g},${ec.b})`;
    ctx.fill();
    ctx.globalAlpha = 1;
    clearGlow();
}

// Ojo glitch: rectángulo cian con ruido
function drawGlitchEye(rx, rh, night) {
    const ry = rh / 2;
    ctx.shadowColor = 'rgba(0,212,255,0.8)'; ctx.shadowBlur = 14;
    ctx.fillStyle = '#00d4ff';
    ctx.fillRect(-rx, -ry, rx*2, ry*2);
    clearGlow();
    ctx.strokeStyle = 'rgba(255,255,255,0.42)';
    ctx.lineWidth = 1.5;
    for (let y = -ry+4; y < ry; y += 5) {
        if (Math.random() > 0.35) {
            ctx.beginPath();
            ctx.moveTo(-rx, y);
            ctx.lineTo(-rx + rx*2*(0.3 + Math.random()*0.7), y);
            ctx.stroke();
        }
    }
}

// Ojo pensando: entrecerrado arriba
function drawSquintEye(rx, ry, night) {
    const ery = ry * 0.70 * (1 - blinkP * 0.97);
    const cy  = ry * 0.14; // desplazar hacia abajo para efecto de párpado
    setGlow(night);
    ctx.beginPath();
    ctx.ellipse(0, cy, rx, Math.max(ery, 0.5), 0, 0, Math.PI*2);
    ctx.fillStyle = eyeGradient(rx, ery, night);
    ctx.fill();
    clearGlow();
    ctx.strokeStyle = night ? 'rgba(0,212,255,0.25)' : 'rgba(0,0,0,0.55)';
    ctx.lineWidth   = Math.max(1.5, rx*0.065);
    ctx.stroke();
    highlight(rx, ery);
}

// Ojo triste: normal con sombra en esquina interior
function drawSadEye(rx, ry, night) {
    const ery = ry * (1 - blinkP * 0.97);
    setGlow(night);
    ctx.beginPath();
    ctx.ellipse(0, -ry*0.06, rx, Math.max(ery, 0.5), 0, 0, Math.PI*2);
    ctx.fillStyle = eyeGradient(rx, ery, night);
    ctx.fill();
    clearGlow();
    ctx.strokeStyle = night ? 'rgba(0,212,255,0.25)' : 'rgba(0,0,0,0.55)';
    ctx.lineWidth   = Math.max(1.5, rx*0.065);
    ctx.stroke();
    highlight(rx, ery);
    // Sombra interior triangular (ceño triste)
    ctx.beginPath();
    ctx.moveTo(-rx, -ery*0.1);
    ctx.lineTo(-rx*0.25, -ery*0.82);
    ctx.lineTo(-rx*0.7,  -ery*0.25);
    ctx.closePath();
    ctx.fillStyle = night ? 'rgba(0,212,255,0.12)' : 'rgba(0,0,0,0.12)';
    ctx.fill();
}

// ── Boca ──────────────────────────────────────────────────────────────────
function drawMouth(cx, cy, w, night, dance) {
    const hw      = w / 2;
    const speaking = RonState.activityState === 'SPEAKING';
    const spk     = speaking ? Math.sin(speakT) * hw * 0.10 : 0;
    const spkA    = speaking ? Math.abs(Math.sin(speakT)) : 0;
    const sw      = Math.max(3, hw * 0.082);
    const col     = night ? '#00d4ff' : '#1a1a1a';

    ctx.save();
    ctx.strokeStyle = col;
    ctx.lineWidth   = sw;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    if (night) { ctx.shadowColor = 'rgba(0,212,255,0.5)'; ctx.shadowBlur = 8; }

    if (dance) {
        ctx.beginPath();
        ctx.moveTo(cx - hw*1.0, cy - hw*0.08);
        ctx.quadraticCurveTo(cx, cy + hw*0.38 + Math.abs(Math.sin(danceT))*hw*0.18, cx + hw*1.0, cy - hw*0.08);
        ctx.stroke();
        ctx.restore(); return;
    }

    const e = expr;
    ctx.beginPath();

    switch (e) {
        case 'happy':
        case 'recognised':
            ctx.moveTo(cx - hw, cy - hw*0.05);
            ctx.quadraticCurveTo(cx, cy + hw*0.30 + spk, cx + hw, cy - hw*0.05);
            ctx.stroke();
            if (speaking && spkA > 0.28) {
                ctx.beginPath();
                ctx.moveTo(cx - hw*0.58, cy - hw*0.01);
                ctx.quadraticCurveTo(cx, cy + hw*0.18 + spk, cx + hw*0.58, cy - hw*0.01);
                ctx.closePath();
                ctx.fillStyle = night ? 'rgba(0,212,255,0.28)' : 'rgba(0,0,0,0.10)';
                ctx.fill();
            }
            break;

        case 'star':
            ctx.moveTo(cx - hw*1.05, cy - hw*0.10);
            ctx.quadraticCurveTo(cx, cy + hw*0.42 + spk, cx + hw*1.05, cy - hw*0.10);
            ctx.stroke();
            break;

        case 'sad':
            ctx.moveTo(cx - hw*0.82, cy + hw*0.18);
            ctx.quadraticCurveTo(cx, cy - hw*0.12 + spk, cx + hw*0.82, cy + hw*0.18);
            ctx.stroke();
            break;

        case 'fear':
            ctx.moveTo(cx - hw*0.72, cy + hw*0.14);
            ctx.quadraticCurveTo(cx, cy - hw*0.08 + spk, cx + hw*0.72, cy + hw*0.14);
            ctx.stroke();
            break;

        case 'surprise':
            ctx.ellipse(cx, cy, hw*0.22, hw*0.26 + spkA*hw*0.12, 0, 0, Math.PI*2);
            ctx.stroke();
            if (spkA > 0.2) {
                ctx.fillStyle = night ? 'rgba(0,212,255,0.18)' : 'rgba(0,0,0,0.08)';
                ctx.fill();
            }
            break;

        case 'thinking':
            ctx.moveTo(cx - hw*0.44, cy);
            ctx.quadraticCurveTo(cx, cy + hw*0.05, cx + hw*0.44, cy);
            ctx.stroke();
            break;

        case 'flat':
            ctx.moveTo(cx - hw*0.38, cy);
            ctx.lineTo(cx + hw*0.38, cy);
            ctx.stroke();
            break;

        case 'glitch': {
            ctx.moveTo(cx - hw, cy);
            for (let i = 1; i <= 7; i++) {
                const px = cx - hw + (i/7)*w;
                const py = cy + (i%2===0 ? -hw*0.10 : hw*0.10);
                ctx.lineTo(px, py);
            }
            ctx.stroke();
            break;
        }

        default: // neutral
            ctx.moveTo(cx - hw*0.70, cy - hw*0.03);
            ctx.quadraticCurveTo(cx, cy + hw*0.12 + spk, cx + hw*0.70, cy - hw*0.03);
            ctx.stroke();
            if (speaking && spkA > 0.32) {
                ctx.beginPath();
                ctx.moveTo(cx - hw*0.48, cy - hw*0.01);
                ctx.quadraticCurveTo(cx, cy + hw*0.07 + spk*1.4, cx + hw*0.48, cy - hw*0.01);
                ctx.closePath();
                ctx.fillStyle = night ? 'rgba(0,212,255,0.20)' : 'rgba(0,0,0,0.07)';
                ctx.fill();
            }
            break;
    }

    ctx.restore();
}

// ── API pública ───────────────────────────────────────────────────────────

export function canvasSetExpression(exp) {
    expr = exp;
}

export function canvasSetEyeColor(hex) {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
    ec = {
        r: parseInt(hex.slice(1,3), 16),
        g: parseInt(hex.slice(3,5), 16),
        b: parseInt(hex.slice(5,7), 16)
    };
}

export function canvasShiftEyes(ex, ey) {
    if (!W) return;
    const mx = Math.min(W * 0.04, 18);
    const my = Math.min(H * 0.025, 12);
    if (ex !== null && ey !== null) {
        eyeTargX = Math.max(-mx, Math.min(mx, ex * -65));
        eyeTargY = Math.max(-my, Math.min(my, ey * -38));
    } else {
        eyeTargX = (Math.random() - 0.5) * mx * 0.8;
        eyeTargY = 0;
    }
}

export function canvasTriggerBlink() {
    if (blinkDir === 0) { blinkDir = 1; blinkP = 0; }
}

export function canvasAddGlitch(count = 4, dur = 0.15) {
    for (let i = 0; i < count; i++) {
        glitches.push({
            x: Math.random() * W,
            y: Math.random() * H,
            w: 20 + Math.random() * 140,
            h: 2  + Math.random() * 12,
            r: Math.random() > 0.4 ? 200 : 20,
            g: Math.random() > 0.6 ? 200 : 20,
            b: Math.random() > 0.3 ? 230 : 20,
            life: dur + Math.random() * 0.08
        });
    }
}

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

    // Oscilador de habla — lento para que las formas de boca sean visibles
    if (RonState.activityState === 'SPEAKING') speakT += dt * (3.2 + Math.sin(speakT * 0.35) * 0.8);

    // Fase de baile
    if (document.body.classList.contains('dance-mode')) danceT += dt * 4.5;

    // Decay de glitches
    glitches = glitches.filter(g => (g.life -= dt) > 0);
}

// ── Layout ────────────────────────────────────────────────────────────────
function getLayout() {
    const eyeW  = Math.min(W * 0.108, 66);   // ojos pill verticales como Ron
    const eyeH  = eyeW * 1.62;               // más altos que anchos (pill)
    const gap   = Math.min(W * 0.265, 164);
    const eyeCY = H * 0.40;
    const mouthY = eyeCY + eyeH * 0.5 + 10;  // pegada justo bajo los ojos
    const mouthW = Math.min(W * 0.22, 105);   // boca pequeña como en la película
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

    const ry = eh / 2;
    switch (e) {
        case 'happy':
        case 'recognised':  drawHappyEye(rx, ry, night);                   break;
        case 'star':        drawStarEye(rx, night, dance);                  break;
        case 'flat':        drawFlatEye(rx, night);                         break;
        case 'glitch':      drawGlitchEye(rx, eh, night);                   break;
        case 'surprise':    drawNormalEye(rx * 1.22, ry * 1.25, night);     break;
        case 'fear':        drawNormalEye(rx * 0.76, ry * 0.78, night);     break;
        case 'thinking':    drawSquintEye(rx, ry, night);                   break;
        case 'sad':         drawSadEye(rx, ry, night);                      break;
        default:            drawNormalEye(rx, ry, night);
    }

    ctx.restore();
}

// ── Helpers ───────────────────────────────────────────────────────────────

function eyeGradient(rx, ry, night) {
    return night ? 'rgb(0,160,210)' : `rgb(${ec.r},${ec.g},${ec.b})`;
}

// Rounded-rect centrado en 0,0 — para la forma pill de los ojos de Ron
function rrect(rx, ry, cr) {
    cr = Math.min(cr, rx, ry);
    ctx.beginPath();
    ctx.moveTo(-rx + cr, -ry);
    ctx.lineTo( rx - cr, -ry);
    ctx.arcTo( rx, -ry,  rx, -ry + cr, cr);
    ctx.lineTo( rx,  ry - cr);
    ctx.arcTo( rx,  ry,  rx - cr,  ry, cr);
    ctx.lineTo(-rx + cr,  ry);
    ctx.arcTo(-rx,  ry, -rx,  ry - cr, cr);
    ctx.lineTo(-rx, -ry + cr);
    ctx.arcTo(-rx, -ry, -rx + cr, -ry, cr);
    ctx.closePath();
}

// ── Tipos de ojos ─────────────────────────────────────────────────────────

function drawNormalEye(rx, ry, night) {
    const ery = Math.max(ry * (1 - blinkP * 0.97), 0.5);
    // Pill/rounded-rect — lados casi planos, esquinas muy redondeadas
    rrect(rx, ery, rx * 0.82);
    ctx.fillStyle = eyeGradient(rx, ery, night);
    ctx.fill();
    if (night) { ctx.shadowColor = 'rgba(0,212,255,0.5)'; ctx.shadowBlur = 10; }
    ctx.strokeStyle = night ? 'rgba(0,212,255,0.3)' : 'rgba(0,0,0,0.5)';
    ctx.lineWidth = Math.max(1.5, rx * 0.06);
    ctx.stroke();
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
}

function drawHappyEye(rx, ry, night) {
    // Media luna — plana abajo, curva arriba
    const ery = Math.max(ry * 0.75 * (1 - blinkP * 0.97), 0.5);
    ctx.beginPath();
    ctx.moveTo(-rx, 0);
    ctx.ellipse(0, 0, rx, ery, 0, Math.PI, 0, false);
    ctx.closePath();
    ctx.fillStyle = eyeGradient(rx, ery, night);
    ctx.fill();
    ctx.strokeStyle = night ? 'rgba(0,212,255,0.3)' : 'rgba(0,0,0,0.5)';
    ctx.lineWidth = Math.max(1.5, rx * 0.06);
    ctx.stroke();
}

function drawStarEye(rx, night, dance) {
    const r1 = rx * 1.1 * (dance ? 1 + Math.sin(danceT) * 0.1 : 1);
    const r2 = rx * 0.44;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? r1 : r2;
        const a = (i * Math.PI / 5) - Math.PI / 2;
        if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else         ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fillStyle = night ? 'rgb(0,212,255)' : `rgb(${ec.r+22},${ec.g+22},${ec.b+22})`;
    ctx.fill();
}

function drawFlatEye(rx, night) {
    const ery = Math.max(rx * 0.15, 2);
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ery, 0, 0, Math.PI * 2);
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = night ? 'rgb(0,175,210)' : `rgb(${ec.r},${ec.g},${ec.b})`;
    ctx.fill();
    ctx.globalAlpha = 1;
}

function drawGlitchEye(rx, rh, night) {
    const ry = rh * 0.45;
    ctx.shadowColor = 'rgba(0,212,255,0.8)'; ctx.shadowBlur = 12;
    ctx.fillStyle = '#00d4ff';
    ctx.fillRect(-rx, -ry, rx * 2, ry * 2);
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1.5;
    for (let y = -ry + 3; y < ry; y += 5) {
        if (Math.random() > 0.4) {
            ctx.beginPath();
            ctx.moveTo(-rx, y);
            ctx.lineTo(-rx + rx * 2 * (0.3 + Math.random() * 0.7), y);
            ctx.stroke();
        }
    }
}

function drawSquintEye(rx, ry, night) {
    const ery = Math.max(ry * 0.58 * (1 - blinkP * 0.97), 0.5);
    ctx.beginPath();
    ctx.ellipse(0, ry * 0.12, rx, ery, 0, 0, Math.PI * 2);
    ctx.fillStyle = eyeGradient(rx, ery, night);
    ctx.fill();
    ctx.strokeStyle = night ? 'rgba(0,212,255,0.3)' : 'rgba(0,0,0,0.5)';
    ctx.lineWidth = Math.max(1.5, rx * 0.06);
    ctx.stroke();
}

function drawSadEye(rx, ry, night) {
    const ery = Math.max(ry * (1 - blinkP * 0.97), 0.5);
    ctx.beginPath();
    ctx.ellipse(0, -ry * 0.05, rx, ery, 0, 0, Math.PI * 2);
    ctx.fillStyle = eyeGradient(rx, ery, night);
    ctx.fill();
    ctx.strokeStyle = night ? 'rgba(0,212,255,0.3)' : 'rgba(0,0,0,0.5)';
    ctx.lineWidth = Math.max(1.5, rx * 0.06);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-rx, -ery * 0.1);
    ctx.lineTo(-rx * 0.2, -ery * 0.78);
    ctx.lineTo(-rx * 0.65, -ery * 0.22);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0,0,0,0.10)';
    ctx.fill();
}

// ── Boca ──────────────────────────────────────────────────────────────────
function drawMouth(cx, cy, w, night, dance) {
    const hw = w / 2;
    const speaking = RonState.activityState === 'SPEAKING';
    // Apertura: 0=cerrado, 1=abierto. Solo parte positiva del seno.
    const openness = speaking ? Math.abs(Math.sin(speakT)) : 0;
    const col = night ? '#00d4ff' : '#1a1a1a';
    const sw  = Math.max(4.5, hw * 0.062);

    ctx.save();
    ctx.strokeStyle = col;
    ctx.lineWidth   = sw;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    if (night) { ctx.shadowColor = 'rgba(0,212,255,0.55)'; ctx.shadowBlur = 9; }

    const e = dance ? 'star' : expr;

    switch (e) {
        case 'happy':
        case 'recognised':
            openMouth(cx, cy, hw, hw*0.40, hw*0.36, openness, night);
            break;

        case 'star':
            openMouth(cx, cy, hw*1.08, hw*0.54, hw*0.50,
                dance ? 0.75 + Math.abs(Math.sin(danceT))*0.25 : openness, night);
            break;

        case 'neutral':
        default:
            // Sonrisa más curvada y boca pequeña como Ron película
            openMouth(cx, cy, hw*0.72, hw*0.32, hw*0.26, openness, night);
            break;

        case 'sad':
            frownMouth(cx, cy, hw*0.80, hw*0.17, hw*0.13, openness, night);
            break;

        case 'fear':
            frownMouth(cx, cy, hw*0.70, hw*0.13, hw*0.10, openness, night);
            break;

        case 'surprise': {
            // Boca-O que se agranda al hablar
            const rW = hw*0.22 + openness*hw*0.14;
            const rH = hw*0.28 + openness*hw*0.20;
            ctx.beginPath();
            ctx.ellipse(cx, cy, rW, rH, 0, 0, Math.PI*2);
            ctx.fillStyle = night ? '#003855' : '#1a1a1a';
            ctx.fill();
            ctx.stroke();
            break;
        }

        case 'thinking':
            ctx.beginPath();
            ctx.moveTo(cx - hw*0.42, cy);
            ctx.quadraticCurveTo(cx, cy + hw*0.045, cx + hw*0.42, cy);
            ctx.stroke();
            break;

        case 'flat':
            ctx.beginPath();
            ctx.moveTo(cx - hw*0.36, cy);
            ctx.lineTo(cx + hw*0.36, cy);
            ctx.stroke();
            break;

        case 'glitch':
            ctx.beginPath();
            ctx.moveTo(cx - hw, cy);
            for (let i = 1; i <= 7; i++) {
                ctx.lineTo(cx - hw + (i/7)*w, cy + (i%2===0 ? -hw*0.09 : hw*0.09));
            }
            ctx.stroke();
            break;
    }

    ctx.restore();
}

// Boca expresiva con 5 estados según openness (0=cerrada → 1=triángulo exclamación)
function openMouth(cx, cy, hw, curveDown, maxDrop, openness, night) {
    const interior = night ? '#002244' : '#0d0d0d';

    if (openness < 0.08) {
        // ① CERRADA — sonrisita fina
        ctx.beginPath();
        ctx.moveTo(cx - hw, cy);
        ctx.quadraticCurveTo(cx, cy + curveDown, cx + hw, cy);
        ctx.stroke();

    } else if (openness < 0.38) {
        // ② CUARTO LUNA — apertura pequeña
        const drop = openness * maxDrop * 2.4;
        // relleno interior
        ctx.beginPath();
        ctx.moveTo(cx - hw, cy);
        ctx.quadraticCurveTo(cx, cy + curveDown, cx + hw, cy);
        ctx.quadraticCurveTo(cx, cy + curveDown * 0.3 + drop, cx - hw, cy);
        ctx.fillStyle = interior;
        ctx.fill();
        // labio superior
        ctx.beginPath();
        ctx.moveTo(cx - hw, cy);
        ctx.quadraticCurveTo(cx, cy + curveDown, cx + hw, cy);
        ctx.stroke();
        // labio inferior
        ctx.beginPath();
        ctx.moveTo(cx - hw, cy);
        ctx.quadraticCurveTo(cx, cy + curveDown * 0.3 + drop, cx + hw, cy);
        ctx.stroke();

    } else if (openness < 0.62) {
        // ③ D / MEDIA LUNA — medio abierta
        const drop = openness * maxDrop * 2.0;
        ctx.beginPath();
        ctx.moveTo(cx - hw, cy);
        ctx.quadraticCurveTo(cx, cy + curveDown * 0.7, cx + hw, cy);
        ctx.bezierCurveTo(cx + hw * 0.85, cy + drop * 0.55,
                          cx + hw * 0.45, cy + drop,
                          cx,             cy + drop * 1.05);
        ctx.bezierCurveTo(cx - hw * 0.45, cy + drop,
                          cx - hw * 0.85, cy + drop * 0.55,
                          cx - hw,        cy);
        ctx.fillStyle = interior;
        ctx.fill();
        ctx.stroke();

    } else if (openness < 0.83) {
        // ④ CÍRCULO / ÓVALO — boca redonda abierta
        const rW = hw * 0.72;
        const rH = maxDrop * 1.2 + openness * maxDrop * 0.9;
        ctx.beginPath();
        ctx.ellipse(cx, cy + curveDown * 0.4 + rH * 0.15, rW, rH, 0, 0, Math.PI * 2);
        ctx.fillStyle = interior;
        ctx.fill();
        ctx.stroke();

    } else {
        // ⑤ TRIÁNGULO INVERTIDO — exclamación / mucho énfasis
        const h = maxDrop * 2.8;
        ctx.beginPath();
        ctx.moveTo(cx - hw, cy);
        ctx.quadraticCurveTo(cx, cy + curveDown * 0.2, cx + hw, cy);
        ctx.lineTo(cx, cy + h);
        ctx.closePath();
        ctx.fillStyle = interior;
        ctx.fill();
        ctx.stroke();
    }
}

// Mueca/ceño triste — labio superior arqueado arriba, labio inferior cae un poco
function frownMouth(cx, cy, hw, frown, maxDrop, openness, night) {
    const drop = openness * maxDrop;
    const endY = cy + frown;       // extremos bajos (esquinas de la mueca)
    const ctrlY = cy - frown * 0.55; // punto de control alto

    // Interior cuando abre
    if (drop > maxDrop * 0.12) {
        ctx.beginPath();
        ctx.moveTo(cx - hw, endY);
        ctx.quadraticCurveTo(cx, ctrlY, cx + hw, endY);
        ctx.lineTo(cx + hw, endY + drop * 0.6);
        ctx.quadraticCurveTo(cx, endY + drop + frown * 0.10, cx - hw, endY + drop * 0.6);
        ctx.closePath();
        ctx.fillStyle = night ? '#003355' : '#1a1a1a';
        ctx.fill();
    }

    // Labio superior (mueca triste)
    ctx.beginPath();
    ctx.moveTo(cx - hw, endY);
    ctx.quadraticCurveTo(cx, ctrlY, cx + hw, endY);
    ctx.stroke();

    // Labio inferior
    if (drop > maxDrop * 0.12) {
        ctx.beginPath();
        ctx.moveTo(cx - hw * 0.88, endY + drop * 0.2);
        ctx.quadraticCurveTo(cx, endY + drop + frown * 0.08,
                              cx + hw * 0.88, endY + drop * 0.2);
        ctx.stroke();
    }
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

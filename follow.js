// follow.js — MODO SEGUIR
// Convierte la posición de la cara (que ya detecta vision.js) en órdenes de
// conducción (M<izq>,<der>) para el ESP-32 por Bluetooth.
//
// SEGURIDAD (recuerda): la seguridad de verdad (precipicio/obstáculo) vive en
// el ESP-32, que ANULA lo que mande el móvil. Aquí solo pedimos movimiento
// suave y lento, y paramos si perdemos la cara.

import { RonState, log } from './core.js';
import { sendDrive } from './vision.js';

/* ------------------------------ AJUSTES ---------------------------------- */
const TURN_GAIN   = 420;   // cuánto gira según el error horizontal
const FWD_GAIN    = 700;   // cuánto avanza según lo lejos que esté
const FWD_MAX     = 130;   // velocidad de avance máx (lento, es una niña)
const TURN_MAX    = 120;   // giro máx
const TARGET_RATIO= 0.24;  // tamaño de cara deseado (más grande = más cerca)
const DEAD_X      = 0.09;  // zona muerta horizontal (no girar si casi centrada)
const DEAD_R      = 0.05;  // zona muerta de distancia
const FACE_TIMEOUT= 1500;  // ms sin cara → parar
const RESEND_MS   = 200;   // reenviar orden a menudo (el ESP para a los 400ms)

/* ------------------------------ ESTADO ----------------------------------- */
let enabled     = false;
let curL = 0, curR = 0;
let lastFaceMs  = 0;
let resendTimer = null;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function isFollowing() { return enabled; }

export function startFollow() {
    if (!RonState.ble || !RonState.ble.isConnected) {
        log("Modo seguir: no hay motores conectados (BLE).");
        return false;   // el llamador avisa a la niña
    }
    enabled = true;
    lastFaceMs = Date.now();
    curL = curR = 0;
    ensureTimer();
    log("Modo seguir ACTIVADO.");
    return true;
}

export function stopFollow() {
    enabled = false;
    curL = curR = 0;
    try { sendDrive(0, 0); } catch (e) {}
    if (resendTimer) { clearInterval(resendTimer); resendTimer = null; }
    log("Modo seguir desactivado.");
}

function ensureTimer() {
    if (resendTimer) return;
    // Reenvía la orden actual con frecuencia para no dejar morir el watchdog del ESP
    resendTimer = setInterval(() => {
        if (!enabled) return;
        if (Date.now() - lastFaceMs > FACE_TIMEOUT) { curL = curR = 0; } // sin cara → parar
        sendDrive(curL, curR);
    }, RESEND_MS);
}

// Llamado desde vision.js en cada frame CON cara detectada
export function updateFollow(box, frameW, frameH) {
    if (!enabled || !box || !frameW) return;
    lastFaceMs = Date.now();

    const cx    = box.x + box.width / 2;
    const errX  = (cx / frameW) - 0.5;          // -0.5 (izq) .. 0.5 (der)
    const ratio = box.width / frameW;           // grande = cerca

    // Giro (proporcional al error horizontal, con zona muerta)
    let turn = 0;
    if (Math.abs(errX) > DEAD_X) turn = clamp(errX * TURN_GAIN, -TURN_MAX, TURN_MAX);

    // Avance (según distancia; NUNCA retrocede: no hay sensor de precipicio trasero)
    let fwd = 0;
    const rErr = TARGET_RATIO - ratio;          // >0 = cara pequeña = lejos = avanzar
    if (Math.abs(rErr) > DEAD_R) fwd = clamp(rErr * FWD_GAIN, -FWD_MAX, FWD_MAX);
    if (fwd < 0) fwd = 0;                        // demasiado cerca → parar, no retroceder

    // Mezcla diferencial (skid-steer)
    curL = clamp(Math.round(fwd + turn), -255, 255);
    curR = clamp(Math.round(fwd - turn), -255, 255);
}

// Llamado desde vision.js cuando NO hay cara
export function faceLost() {
    if (!enabled) return;
    curL = curR = 0;   // el reenvío mandará 0,0; si sigue sin cara, se queda parado
}

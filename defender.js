// defender.js - Ron como defensor activo
import { RonState, log } from './core.js';
import { speak } from './speech.js';
import { setExpression } from './ui.js';

let sadnessStartTime  = null;
let defenderActivated = false;
let lastDefenderAction = 0;

const SAD_THRESHOLD_MS = 180000; // 3 minutos
const COOLDOWN_MS      = 600000; // 10 minutos

// ── Llamado desde vision.js cada frame ──────────────────────────────────────

export function updateSadnessTracking(emotion, faceVisible) {
    const now = Date.now();

    // BUG FIX: si no hay cara visible, resetear el tracking de tristeza
    if (!faceVisible) {
        sadnessStartTime  = null;
        defenderActivated = false;
        return;
    }

    if (emotion === 'triste') {
        if (!sadnessStartTime) {
            sadnessStartTime  = now;
            defenderActivated = false;
            log("Tristeza detectada, tracking iniciado.");
        }
        const duration = now - sadnessStartTime;
        if (!defenderActivated && duration >= SAD_THRESHOLD_MS && (now - lastDefenderAction) > COOLDOWN_MS) {
            defenderActivated  = true;
            lastDefenderAction = now;
            // BUG FIX: try/catch para unhandled rejection
            triggerDefenderMode().catch(e => log(`Defensor error: ${e.message}`));
        }
    } else {
        sadnessStartTime  = null;
        defenderActivated = false;
    }
}

// ── Modo defensor ────────────────────────────────────────────────────────────

async function triggerDefenderMode() {
    if (RonState.activityState !== 'IDLE' || RonState.isSilentMode) return;

    const name = RonState.currentUser || 'amiga';
    log(`Defensor activado para ${name}`);
    setExpression('sad');

    const todayKey   = `ron_defender_${new Date().toDateString()}`;
    const todayCount = (parseInt(localStorage.getItem(todayKey) || '0', 10) || 0) + 1;
    localStorage.setItem(todayKey, String(todayCount));

    if (todayCount === 1) {
        await speak(`${name}, llevas un rato con cara de tristeza. ¿Qué ha pasado?`);
    } else if (todayCount === 2) {
        await speak(`${name}, mis sensores detectan tristeza otra vez. ¿Jugamos a algo?`);
        setTimeout(() => {
            if (RonState.activityState === 'IDLE' && !RonState.isSilentMode) {
                import('./ai.js').then(ai => ai.triggerSpontaneous(
                    `${name} lleva un rato triste. Propón con mucho entusiasmo una actividad: juego, historia o canción.`
                )).catch(() => {});
            }
        }, 8000);
    } else {
        await speak(`${name}, protocolo de amistad activo. ¿Quieres un cuento o un chiste?`);
    }
}

export async function triggerBullyingDefense(name) {
    if (RonState.isSilentMode) return;
    const reactions = [
        `${name}, según mi análisis, eso no está bien. Tú eres increíble.`,
        `¡Bip! Protocolo de defensa activado. Esa persona tiene un Error 404.`,
        `${name}, yo estoy aquí. Lo que te dijeron es incorrecto. Datos confirmados.`,
    ];
    setExpression('fear');
    await speak(reactions[Math.floor(Math.random() * reactions.length)]);
}

export function getSadnessDurationMinutes() {
    if (!sadnessStartTime) return 0;
    return Math.round((Date.now() - sadnessStartTime) / 60000);
}

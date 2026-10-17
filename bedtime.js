// bedtime.js — Rutina de noche de Ron (horas en Ajustes; por defecto 22:00 → 07:30)
//  - Unos minutos antes: avisa de que pronto hay que ir a la cama.
//  - A la hora: cierra juegos, para la música y el modo seguir, se despide y se duerme.
//  - Dormido (estado NIGHT): no propone nada, no saluda, no reacciona a emociones.
//    Si le hablan diciendo "Ron", contesta medio dormido y manda a la cama (sin IA).
//    Si la niña dice que tiene miedo o algo preocupante, responde con cariño.
//  - A la hora de despertar pasa a "dormido normal" y se despierta al verla.

import { RonState, RonConfig, log, changeState, isBedtime, minutesToBedtime, isIdleLike, markProactive } from './core.js';
import { speak } from './speech.js';
import { setExpression } from './ui.js';

let loop = null;
let lastNightReply = 0;

function nightKey() {
    // La "noche" se identifica por la fecha de la tarde en que empieza
    const d = new Date();
    if (d.getHours() < 12) d.setDate(d.getDate() - 1);
    return d.toDateString();
}

export function startBedtimeLoop() {
    if (loop) return;
    tick();
    loop = setInterval(tick, 30000);
}

async function tick() {
    try {
        const name = RonState.currentUser;
        const present = (RonState.framesWithoutFace || 0) < 40;   // la ha visto hace menos de ~30 s
        const mins = minutesToBedtime();

        // 1) Aviso previo
        if (!isBedtime() && mins > 0 && mins <= RonConfig.warnMinutes &&
            localStorage.getItem('ron_bed_warned') !== nightKey() && present && isIdleLike()) {
            localStorage.setItem('ron_bed_warned', nightKey());
            markProactive();
            setExpression('thinking');
            await speak(`${name ? name + ', ' : ''}mis relojes dicen que en ${mins} minutos es hora de ir a la cama. ¿Terminamos lo que estamos haciendo? ¡Bip!`);
            return;
        }

        // 2) Hora de dormir
        if (isBedtime() && RonState.activityState !== 'NIGHT' && localStorage.getItem('ron_bed_done') !== nightKey()) {
            const busyStates = ['SPEAKING', 'THINKING'];
            if (busyStates.includes(RonState.activityState)) return;   // que termine la frase
            localStorage.setItem('ron_bed_done', nightKey());
            await goToSleep(present ? name : null);
            return;
        }

        // 3) Hora de despertar: dormido normal → la vista lo despierta al verla
        if (!isBedtime() && RonState.activityState === 'NIGHT') {
            log('Fin de la noche: Ron pasa a reposo y despertará al verla.');
            changeState('SLEEPING');
        }
    } catch (e) { log('Rutina de noche: ' + e.message); }
}

async function goToSleep(name) {
    log('Hora de dormir.');
    try { (await import('./follow.js')).stopFollow(); } catch (e) {}
    try { (await import('./music.js')).stopYTMusic(); } catch (e) {}
    try {
        const ui = await import('./ui.js');
        RonState.ui.gamePanel?.classList.add('hidden');
        ui.hideStoryPanel?.();
        ui.checkNightMode?.();
    } catch (e) {}
    RonState.storyPendingNextChapter = false;
    if (RonState.activityState !== 'IDLE' && RonState.activityState !== 'LISTENING') changeState('IDLE');

    if (name) {
        const lines = [
            `¡Bip! ${name}, son las ${RonConfig.bedtime}. Hora de ir a la cama. Mis baterías también están bajas. ¡Buenas noches, mejor amiga!`,
            `¡Uaaah! ${name}, mis relojes marcan las ${RonConfig.bedtime}: a dormir. Mañana me cuentas tus sueños. ¡Buenas noches!`,
            `${name}, protocolo de buenas noches activado. A la cama, que mañana jugamos más. ¡Que descanses!`
        ];
        setExpression('happy');
        await speak(lines[Math.floor(Math.random() * lines.length)]);
    }
    changeState('NIGHT');
    setExpression('flat');
}

// Respuesta cuando le hablan de noche (llamado desde ai.js). Sin IA.
export async function nightReply(text) {
    const name = RonState.currentUser || 'amiga';
    const t = (text || '').toLowerCase();
    const { isConcern, concernResponse } = await import('./safety.js');
    if (isConcern(text)) { await speak(concernResponse(RonState.currentUser)); return restoreNight(); }
    if (/miedo|pesadilla|no puedo dormir|no me puedo dormir|asustad/.test(t)) {
        await speak(`Zzz... ${name}, tranquila, estoy aquí vigilando. Si tienes miedo, llama a papá o a mamá. Buenas noches.`);
        return restoreNight();
    }
    if (Date.now() - lastNightReply < 60000) return;   // no entrar en bucle de charla nocturna
    lastNightReply = Date.now();
    const lines = [
        `Zzz... ¡bip! ${name}, es hora de dormir. Mañana jugamos. Buenas noches.`,
        `Uaaah... mis baterías están en modo sueño, ${name}. A la cama, que mañana te cuento cosas.`,
    ];
    await speak(lines[Math.floor(Math.random() * lines.length)]);
    restoreNight();
}

function restoreNight() {
    if (isBedtime()) { changeState('NIGHT'); setExpression('flat'); }
}

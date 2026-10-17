// tts.js — Voz de Ron con Gemini TTS (gratis con clave de AI Studio, sin facturación).
// Verificado (docs Gemini, oct 2026): modelos gemini-3.8-flash-lite-tts y
// gemini-3.8-flash-tts, español admitido, 30 voces, API "Interactions", respuesta
// WAV 24 kHz mono en base64. NO verificado: límites del plan gratuito para TTS
// (míralos en AI Studio → Rate limit) ni que Google permita la llamada desde el
// navegador (CORS). Si algo falla, Ron usa la voz del navegador sin que se note.
//
// El audio pasa por un "efecto robot" suave (WebAudio): tono algo más agudo,
// brillo metálico y una ligera modulación, para que suene a B-Bot.

import { RonState, RonConfig, log } from './core.js';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const MODELS = ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts'];
const STYLE = 'robot de juguete simpático: alegre, curioso, entusiasta y un poco torpe; ritmo ágil y claro';
const TIMEOUT_MS = 7000;

export const VOICES = {
    Puck: 'Animada (recomendada)', Fenrir: 'Excitable', Leda: 'Juvenil', Zephyr: 'Brillante',
    Sadachbia: 'Vivaz', Laomedeia: 'Alegre', Achird: 'Amistosa', Kore: 'Firme'
};

let ctx = null;
let current = null;            // { src, osc } en reproducción
let analyser = null, levelBuf = null;   // volumen en vivo → movimiento de la boca
const cache = new Map();       // texto → AudioBuffer (ahorra cuota en frases repetidas)
const cooldown = {};
let failures = 0, disabledUntil = 0;
let info = { ok: false, error: 'aún no se ha probado' };
export function lastTtsInfo() { return info; }

function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
}
// Llamar en un toque del usuario (botón de encendido): Android exige un gesto para el audio
export function unlockAudio() { try { getCtx(); } catch (e) {} }

export function ttsAvailable() {
    return RonConfig.voiceEngine === 'gemini' && !!RonConfig.geminiKey && Date.now() > disabledUntil;
}

function countUse(model) {
    try {
        const k = 'ron_usage_' + new Date().toISOString().slice(0, 10);
        const u = JSON.parse(localStorage.getItem(k) || '{}');
        u['gemini:' + model] = (u['gemini:' + model] || 0) + 1;
        localStorage.setItem(k, JSON.stringify(u));
    } catch (e) {}
}

// Devuelve un AudioBuffer listo para sonar, o null (→ voz del navegador).
// budgetMs: tiempo máximo total. Si Google va lento (timeout) no se prueba el otro
// modelo: sería esperar el doble para nada. Solo se cambia de modelo por cuota/error.
export async function synthesize(text, { budgetMs = 6000 } = {}) {
    const clean = String(text || '').replace(/[*_#]/g, '').trim();
    if (!clean) return null;
    const key = `${RonConfig.geminiVoice}|${clean}`;
    if (cache.has(key)) { info = { ok: true, model: 'caché', ms: 0 }; return cache.get(key); }
    const deadline = Date.now() + budgetMs;

    for (const model of MODELS) {
        if ((cooldown[model] || 0) > Date.now()) continue;
        const left = deadline - Date.now();
        if (left < 800) break;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), Math.min(TIMEOUT_MS, left));
        const t0 = Date.now();
        try {
            const res = await fetch(ENDPOINT, {
                method: 'POST',
                headers: { 'x-goog-api-key': RonConfig.geminiKey, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model,
                    input: [{ type: 'user_input', content: [{
                        type: 'text', text: clean,
                        annotations: [{ type: 'speech_metadata', style: STYLE }]
                    }]}],
                    response_format: { type: 'audio' },
                    generation_config: { speech_config: [{ voice: RonConfig.geminiVoice || 'Puck' }] }
                }),
                signal: ctrl.signal
            });
            if (res.status === 429) {
                cooldown[model] = Date.now() + (Number(res.headers.get('retry-after')) || 60) * 1000;
                log(`Voz Gemini ${model}: cuota agotada.`);
                info = { ok: false, error: 'cuota agotada (429)' };
                continue;
            }
            if (res.status === 401 || res.status === 403) { disabledUntil = Date.now() + 6 * 3600000; log('Voz Gemini: clave no válida.'); info = { ok: false, error: `clave no válida (HTTP ${res.status})` }; return null; }
            if (!res.ok) { log(`Voz Gemini ${model}: HTTP ${res.status}`); info = { ok: false, error: `HTTP ${res.status}` }; continue; }
            const data = await res.json();
            const b64 = (data.steps || []).flatMap(s => s.content || []).filter(c => c.type === 'audio').map(c => c.data).pop();
            if (!b64) { log('Voz Gemini: respuesta sin audio.'); continue; }
            const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
            const buf = await getCtx().decodeAudioData(bytes.buffer);
            countUse(model);
            failures = 0;
            log(`Voz Gemini ${model}: ${Date.now() - t0} ms para ${clean.length} letras.`);
            info = { ok: true, model, ms: Date.now() - t0 };
            if (clean.length <= 160) {            // solo frases cortas: las largas rara vez se repiten
                cache.set(key, buf);
                if (cache.size > 60) cache.delete(cache.keys().next().value);
            }
            return buf;
        } catch (e) {
            const slow = e.name === 'AbortError';
            log(`Voz Gemini ${model}: ${slow ? 'demasiado lenta' : e.message}`);
            info = { ok: false, error: slow ? 'tardó demasiado' : (/fetch/i.test(e.message) ? 'el navegador bloqueó la llamada (posible CORS) o no hay red' : e.message) };
            if (slow) break;                      // lento ≠ agotado: no esperar otro tanto
        } finally {
            clearTimeout(timer);
        }
    }
    // Varios fallos seguidos (p. ej. el navegador bloquea la llamada): pausa 10 min
    if (++failures >= 3) { disabledUntil = Date.now() + 10 * 60000; failures = 0; log('Voz Gemini en pausa 10 min → voz del navegador.'); }
    return null;
}

// Parte la respuesta en [primera frase, resto] para empezar a hablar antes.
// Solo 2 peticiones por respuesta como mucho (la cuota gratuita de voz es limitada).
export function splitForSpeech(text) {
    const t = String(text || '').trim();
    const m = t.match(/^(.{12,}?[.!?…])\s+(\S[\s\S]*)$/);
    if (!m || m[2].length < 8) return [t];
    return [m[1], m[2]];
}

// Volumen actual de la voz (0..1) para animar la boca; -1 si no suena audio de Gemini
export function voiceLevel() {
    if (!current || !analyser) return -1;
    analyser.getFloatTimeDomainData(levelBuf);
    let sum = 0;
    for (let i = 0; i < levelBuf.length; i++) sum += levelBuf[i] * levelBuf[i];
    const rms = Math.sqrt(sum / levelBuf.length);
    return Math.min(1, Math.max(0, (rms - 0.015) * 7));
}

export function stopAudio() {
    if (!current) return;
    const c = current;
    current = null;
    try { c.src.onended = null; c.src.stop(); } catch (e) {}
    try { c.osc && c.osc.stop(); } catch (e) {}
    try { c.resolve && c.resolve(); } catch (e) {}      // quien esperaba el final no se queda colgado
}

// Reproduce con efecto robot. Resuelve al terminar. Devuelve también la duración (ms).
export function play(buffer) {
    stopAudio();
    const c = getCtx();
    const robot = RonConfig.robotEffect !== false;
    const src = c.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = robot ? 1.06 : 1.0;     // un pelín más agudo y ágil
    let node = src, osc = null;
    if (robot) {
        const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 140;
        const peak = c.createBiquadFilter(); peak.type = 'peaking'; peak.frequency.value = 2800; peak.gain.value = 4; peak.Q.value = 1.2;
        const ring = c.createGain(); ring.gain.value = 0.85;              // modulación ligera → timbre metálico
        osc = c.createOscillator(); osc.frequency.value = 55;
        const depth = c.createGain(); depth.gain.value = 0.15;
        osc.connect(depth); depth.connect(ring.gain); osc.start();
        node.connect(hp); hp.connect(peak); peak.connect(ring); node = ring;
    }
    node.connect(c.destination);
    if (!analyser) { analyser = c.createAnalyser(); analyser.fftSize = 512; levelBuf = new Float32Array(analyser.fftSize); }
    node.connect(analyser);
    const durationMs = buffer.duration * 1000 / src.playbackRate.value;
    let resolveDone;
    const done = new Promise(resolve => {
        resolveDone = resolve;
        src.onended = () => { try { osc && osc.stop(); } catch (e) {} if (current && current.src === src) current = null; resolve(); };
    });
    current = { src, osc, resolve: resolveDone };
    src.start();
    return { done, durationMs };
}

// whisper.js — Oído de Ron con Whisper (Groq), mucho mejor con voces infantiles.
//
// Cómo funciona:
//  1. Escucha el micro de forma continua y detecta la voz EN EL MÓVIL (sin red).
//  2. Solo cuando alguien habla, recorta ese trozo (con 0,4 s previos para no
//     cortar la primera sílaba) y lo convierte a WAV 16 kHz mono.
//  3. Lo envía a Groq (whisper-large-v3-turbo; si se agota, whisper-large-v3).
//  4. El texto pasa por la misma lógica que antes (palabra "Ron", juegos, nombre).
//
// Datos verificados (docs de Groq, oct 2026): cada petición cuenta como MÍNIMO 10 s
// de audio; plan gratuito de whisper-large-v3: 20/min, 2.000/día, 28.800 s/día.
// Por eso: no se envía ruido, no se escucha mientras Ron habla, y en modo "esperando
// la palabra Ron" hay un tope por hora (la tele no debe gastar la cuota).
// Whisper en español a veces "inventa" frases con silencio o música
// ("Subtítulos de Amara.org", "Gracias por ver"): se descartan.
// Si falla, se agota o no hay clave → vuelve solo al reconocimiento del navegador.

import { RonState, RonConfig, log, changeState } from './core.js';

const ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MODELS = ['whisper-large-v3-turbo', 'whisper-large-v3'];
const ALLOWED = ['IDLE', 'LISTENING', 'STORY', 'MATH_GAME', 'READING_GAME', 'NIGHT'];

const PREROLL_MS    = 400;    // audio previo que se conserva al detectar voz
const END_SILENCE_MS = 750;   // silencio que cierra la frase
const MIN_VOICED_MS = 350;    // menos que esto: ruido, no se envía
const MAX_SEGMENT_MS = 12000; // corte de seguridad
const ECHO_GUARD_MS = 600;    // tras hablar Ron, no escuchar (su propia voz)
const WAKE_HOURLY_CAP = 120;  // envíos/hora máximo mientras espera "Ron" (ahorro)

let ctx = null, stream = null, src = null, proc = null;
let running = false, starting = false, busy = false;
let ring = [], seg = null, inSpeech = false, speechFrames = 0;
let voicedMs = 0, silenceMs = 0, segMs = 0, noiseFloor = 0.006;
let fallbackUntil = 0;
const cooldown = {};
let hourKey = '', hourCount = 0;

// Frases que Whisper inventa con silencio/ruido en español
const HALLUCINATIONS = [
    /amara\.org/i, /subt[íi]tulos/i, /gracias por ver/i, /suscr[íi]bete/i, /^\W*m[úu]sica\W*$/i,
    /^\W*\[.*\]\W*$/, /^\W*\(.*\)\W*$/, /^[\s.,!?¡¿-]*$/, /^\W*gracias\W*$/i,
];
export function cleanTranscript(text) {
    const t = (text || '').replace(/\s+/g, ' ').trim();
    if (t.length < 2) return '';
    if (HALLUCINATIONS.some(re => re.test(t))) return '';
    return t;
}

export function whisperAvailable() {
    return RonConfig.sttEngine !== 'navegador' &&
        !!RonState.apiKey &&
        Date.now() > fallbackUntil &&
        !!(navigator.mediaDevices && (window.AudioContext || window.webkitAudioContext));
}

export function isWhisperRunning() { return running; }

export async function ensureWhisper() {
    if (running) return true;
    if (starting) return true;
    starting = true;
    try {
        stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
        });
        const AC = window.AudioContext || window.webkitAudioContext;
        ctx = new AC();
        if (ctx.state === 'suspended') { try { await ctx.resume(); } catch (e) {} }
        src = ctx.createMediaStreamSource(stream);
        proc = ctx.createScriptProcessor(4096, 1, 1);
        proc.onaudioprocess = onAudio;
        src.connect(proc);
        proc.connect(ctx.destination);   // necesario para que Chrome procese; la salida va en silencio
        running = true;
        log('🎙️ Oído Whisper activo.');
        return true;
    } catch (e) {
        log(`Whisper: no se pudo abrir el micro (${e.message}). Uso el del navegador.`);
        fallback(10 * 60000);
        return false;
    } finally {
        starting = false;
    }
}

export function stopWhisper() {
    if (!running && !stream) return;
    running = false;
    try { proc && proc.disconnect(); } catch (e) {}
    try { src && src.disconnect(); } catch (e) {}
    try { stream && stream.getTracks().forEach(t => t.stop()); } catch (e) {}
    try { ctx && ctx.close(); } catch (e) {}
    ctx = stream = src = proc = null;
    resetSegment();
    ring = [];
}

function fallback(ms) {
    fallbackUntil = Date.now() + ms;
    stopWhisper();
    // Salir de "escuchando": el reconocimiento del navegador solo arranca desde reposo
    if (RonState.activityState === 'LISTENING') changeState('IDLE');
    log(`Whisper en pausa ${Math.round(ms / 60000)} min → reconocimiento del navegador.`);
    import('./speech.js').then(s => s.startListening()).catch(() => {});
}

function resetSegment() { seg = null; inSpeech = false; speechFrames = 0; voicedMs = 0; silenceMs = 0; segMs = 0; }

async function canCapture() {
    if (!RonState.isMicEnabled || busy || RonState.ttsPending) return false;
    if (!ALLOWED.includes(RonState.activityState)) return false;
    if (window.speechSynthesis && window.speechSynthesis.speaking) return false;
    const { getLastSpeakEndTs } = await import('./speech.js');
    return Date.now() - getLastSpeakEndTs() > ECHO_GUARD_MS;
}

let captureOk = true;   // se refresca de forma asíncrona (onaudioprocess es síncrono)
setInterval(async () => { captureOk = running ? await canCapture() : false; }, 100);

function onAudio(e) {
    if (!running) return;
    const data = new Float32Array(e.inputBuffer.getChannelData(0));
    const frameMs = data.length / ctx.sampleRate * 1000;
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length);

    if (!captureOk) {                       // Ron habla/piensa: descartar y no aprender ruido
        if (inSpeech && RonState.activityState === 'LISTENING') changeState('IDLE');
        resetSegment(); ring = [];
        return;
    }

    const threshold = Math.max(noiseFloor * 3, 0.012);
    ring.push(data);
    const keep = Math.ceil(PREROLL_MS / frameMs) + 1;
    if (ring.length > keep) ring.shift();

    if (!inSpeech) {
        if (rms > threshold) {
            if (++speechFrames >= 2) {
                inSpeech = true;
                seg = ring.slice();
                segMs = seg.length * frameMs;
                voicedMs = speechFrames * frameMs;
                silenceMs = 0;
                if (RonState.activityState === 'IDLE') changeState('LISTENING');
            }
        } else {
            speechFrames = 0;
            noiseFloor = noiseFloor * 0.95 + rms * 0.05;   // se adapta al ruido de la habitación
        }
        return;
    }

    seg.push(data);
    segMs += frameMs;
    if (rms > threshold * 0.7) { voicedMs += frameMs; silenceMs = 0; }
    else silenceMs += frameMs;

    if (silenceMs >= END_SILENCE_MS || segMs >= MAX_SEGMENT_MS) {
        const chunks = seg, sr = ctx.sampleRate, voiced = voicedMs;
        resetSegment();
        ring = [];
        if (voiced < MIN_VOICED_MS) {
            if (RonState.activityState === 'LISTENING') changeState('IDLE');
            return;
        }
        transcribe(encodeWav(chunks, sr)).catch(err => log('Whisper: ' + err.message));
    }
}

// Concatena, re-muestrea a 16 kHz y codifica WAV PCM16 mono
export function encodeWav(chunks, srcRate, outRate = 16000) {
    let len = 0;
    for (const c of chunks) len += c.length;
    const all = new Float32Array(len);
    let o = 0;
    for (const c of chunks) { all.set(c, o); o += c.length; }
    const ratio = srcRate / outRate;
    const outLen = Math.floor(all.length / ratio);
    const pcm = new Int16Array(outLen);
    for (let i = 0; i < outLen; i++) {
        const pos = i * ratio, i0 = Math.floor(pos), f = pos - i0;
        const s = (all[i0] || 0) * (1 - f) + (all[i0 + 1] || 0) * f;
        pcm[i] = Math.max(-1, Math.min(1, s)) * 0x7fff;
    }
    const buf = new ArrayBuffer(44 + pcm.length * 2);
    const v = new DataView(buf);
    const w = (p, str) => { for (let i = 0; i < str.length; i++) v.setUint8(p + i, str.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE');
    w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, outRate, true); v.setUint32(28, outRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, pcm.length * 2, true);
    new Int16Array(buf, 44).set(pcm);
    return new Blob([buf], { type: 'audio/wav' });
}

function waitingForWakeWord() {
    const inGame = ['MATH_GAME', 'READING_GAME'].includes(RonState.activityState);
    const inStory = RonState.activityState === 'STORY' && RonState.storyPendingNextChapter;
    return RonState.isWaitingForWakeWord && !inGame && !inStory && !RonState.nameFlow;
}

async function transcribe(wavBlob) {
    // Tope por hora mientras solo espera la palabra "Ron" (ruido de fondo, tele...)
    if (waitingForWakeWord()) {
        const hk = new Date().toISOString().slice(0, 13);
        if (hk !== hourKey) { hourKey = hk; hourCount = 0; }
        if (++hourCount > WAKE_HOURLY_CAP) {
            if (RonState.activityState === 'LISTENING') changeState('IDLE');
            return;
        }
    }
    busy = true;
    try {
        const names = [...new Set(['Ron', ...RonState.knownFaces.map(f => f.label)])].slice(0, 8).join(', ');
        const prompt = `Conversación en español de España entre una niña y su robot de juguete Ron. Nombres: ${names}.`;
        for (const model of MODELS) {
            if ((cooldown[model] || 0) > Date.now()) continue;
            const fd = new FormData();
            fd.append('file', wavBlob, 'voz.wav');
            fd.append('model', model);
            fd.append('language', 'es');
            fd.append('temperature', '0');
            fd.append('response_format', 'verbose_json');
            fd.append('prompt', prompt);
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 8000);
            let res, data = null;
            try {
                res = await fetch(ENDPOINT, { method: 'POST', headers: { 'Authorization': `Bearer ${RonState.apiKey}` }, body: fd, signal: ctrl.signal });
                try { data = await res.json(); } catch (e) {}
            } catch (e) {
                log(`Whisper ${model}: ${e.name === 'AbortError' ? 'timeout' : e.message}`);
                continue;
            } finally { clearTimeout(timer); }

            if (res.status === 429) {
                const secs = Math.min(Math.max(Number(res.headers.get('retry-after')) || 60, 10), 3600);
                cooldown[model] = Date.now() + secs * 1000;
                log(`Whisper ${model}: cuota agotada (${secs}s).`);
                continue;
            }
            if (res.status === 401 || res.status === 403) { fallback(6 * 3600000); return; }
            if (!res.ok) { log(`Whisper ${model}: HTTP ${res.status}`); continue; }

            countUse(model);
            // Quedarse solo con segmentos que sí parecen voz
            let text = data?.text || '';
            if (Array.isArray(data?.segments) && data.segments.length) {
                text = data.segments
                    .filter(s => (s.no_speech_prob ?? 0) < 0.6 && (s.avg_logprob ?? 0) > -1.2)
                    .map(s => s.text).join(' ');
            }
            text = cleanTranscript(text);
            if (!text) { if (RonState.activityState === 'LISTENING') changeState('IDLE'); return; }
            const { processTranscript } = await import('./speech.js');
            if (RonState.activityState === 'LISTENING') changeState('IDLE');
            processTranscript(text);
            return;
        }
        // Todos los modelos agotados o fallando → navegador un rato
        const soonest = Math.min(...MODELS.map(m => cooldown[m] || 0));
        fallback(Math.max(soonest - Date.now(), 5 * 60000));
    } finally {
        busy = false;
        if (RonState.activityState === 'LISTENING' && !inSpeech) changeState('IDLE');
    }
}

function countUse(model) {
    try {
        const k = 'ron_usage_' + new Date().toISOString().slice(0, 10);
        const u = JSON.parse(localStorage.getItem(k) || '{}');
        u['groq:' + model] = (u['groq:' + model] || 0) + 1;
        localStorage.setItem(k, JSON.stringify(u));
    } catch (e) {}
}

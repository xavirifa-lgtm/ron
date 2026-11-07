// whisper.js — Oído de Ron con Whisper (Groq), mucho mejor con voces infantiles. (v28)
//
// Cómo funciona:
//  1. Captura el micro con un AudioWorklet: corre en el hilo de audio, así que aunque
//     el reconocimiento de caras ocupe el procesador NO se pierden trozos de voz
//     (antes, con ScriptProcessor en el hilo principal, la voz llegaba entrecortada).
//  2. Detecta la voz en el móvil (sin red), con margen para pausas de niña (1 s) y
//     palabras muy cortas ("sí", "no").
//  3. Recorta la frase (con 0,5 s previos) → WAV 16 kHz → Groq whisper-large-v3-turbo
//     (si se agota, whisper-large-v3).
//  4. Si ella sigue hablando mientras se transcribe, une los trozos en una sola frase.
//
// Datos verificados (docs de Groq, oct 2026): cada petición cuenta como MÍNIMO 10 s
// de audio; plan gratuito de whisper-large-v3: 20/min, 2.000/día, 28.800 s/día.
// Si falla, se agota o no hay clave → vuelve solo al reconocimiento del navegador.

import { slog } from './sessionlog.js';
import { RonState, RonConfig, log, changeState } from './core.js';
import { outputRms } from './tts.js';

const ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MODELS = ['whisper-large-v3-turbo', 'whisper-large-v3'];
const ALLOWED = ['IDLE', 'LISTENING', 'SLEEPING', 'STORY', 'MATH_GAME', 'READING_GAME', 'WORD_GAME', 'CHALLENGE', 'NIGHT'];

const PREROLL_MS     = 500;   // audio previo que se conserva al detectar voz
const ONSET_MS       = 110;   // voz continua necesaria para empezar a grabar
const END_SILENCE_MS = 1000;  // silencio que cierra la frase (los niños hacen pausas)
const MIN_VOICED_MS  = 200;   // menos que esto: ruido ("sí" rápido ≈ 250 ms)
const MAX_SEGMENT_MS = 15000; // corte de seguridad
const ECHO_GUARD_MS  = 600;   // tras hablar Ron, no escuchar (su propia voz)
const WAKE_HOURLY_CAP = 120;  // envíos/hora máximo mientras espera "Ron" (ahorro)
const FRAME = 2048;           // muestras por bloque que manda el worklet (~43 ms a 48 kHz)
// Interrumpir a Ron hablándole (solo con Whisper): voz claramente por encima de su eco
const BARGE_MS       = 350;   // voz continua necesaria para cortarle
const BARGE_RATIO    = 2.2;   // cuántas veces por encima del eco de Ron
const BARGE_MIN_RMS  = 0.02;  // volumen mínimo absoluto (voz de niña a 1 m ≈ 0,02-0,1)
const BARGE_IGNORE_MS = 450;  // ignorar el arranque de cada frase de Ron (golpe de audio)
const RPM_SAFE       = 18;    // peticiones/minuto por modelo (límite gratuito: 20)

let ctx = null, stream = null, src = null, node = null, sink = null;
let running = false, starting = false;
let ring = [], seg = null, inSpeech = false, onsetMs = 0;
let voicedMs = 0, silenceMs = 0, segMs = 0, noiseFloor = 0.004;
let fallbackUntil = 0, lastFrameTs = 0, level = 0;
const cooldown = {};
let hourKey = '', hourCount = 0;
let queue = Promise.resolve(), pendingJobs = 0, pendingText = '';
let failStreak = 0, returnTimer = null;                     // fallos seguidos de red/servidor (no de cuota)
const sent = {};                        // modelo → marcas de tiempo de peticiones (último minuto)
let echoAvg = 0, bargeMs = 0, bargeActive = false, bargeEnv = 0, outEnv = 0, echoK = 0;

// Frases que Whisper inventa con silencio/ruido en español
const HALLUCINATIONS = [
    /amara\.org/i, /subt[íi]tulos/i, /gracias por ver/i, /suscr[íi]bete/i, /^\W*m[úu]sica\W*$/i,
    /^\W*\[.*\]\W*$/, /^\W*\(.*\)\W*$/, /^[\s.,!?¡¿-]*$/, /pr[óo]ximo v[íi]deo/i,
];
// "Gracias" suelto es la alucinación más típica, pero también algo que una niña dice:
// solo se descarta cuando Ron NO está en conversación.
export function cleanTranscript(text, { strict = true } = {}) {
    const t = (text || '').replace(/\s+/g, ' ').trim();
    if (t.length < 2 && !/^\d$/.test(t)) return '';
    if (HALLUCINATIONS.some(re => re.test(t))) return '';
    if (strict && /^\W*(muchas )?gracias\W*$/i.test(t)) return '';
    return t;
}

// Regla del propio Whisper: descartar un trozo solo si es probable que no haya voz
// Y además la transcripción es dudosa (antes bastaba UNA condición → se perdía voz de niña).
export function keepSegment(s) {
    const nsp = s.no_speech_prob ?? 0, lp = s.avg_logprob ?? 0, cr = s.compression_ratio ?? 1;
    if (nsp > 0.6 && lp < -1.0) return false;
    if (lp < -1.8) return false;              // ininteligible
    if (cr > 2.6) return false;               // repetición en bucle (alucinación)
    return true;
}

export function whisperAvailable() {
    return RonConfig.sttEngine !== 'navegador' &&
        !!RonState.apiKey &&
        Date.now() > fallbackUntil &&
        !!(navigator.mediaDevices && (window.AudioContext || window.webkitAudioContext));
}

export function isWhisperRunning() { return running; }
export function micLevel() { return running ? level : 0; }          // 0..1 para la interfaz
export function userIsSpeaking() { return running && (inSpeech || pendingJobs > 0); }

const WORKLET = `
class RonCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(${FRAME}); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i];
      if (this.n === this.buf.length) { this.port.postMessage(this.buf, [this.buf.buffer]); this.buf = new Float32Array(${FRAME}); this.n = 0; }
    }
    return true;
  }
}
registerProcessor('ron-capture', RonCapture);`;

export async function ensureWhisper() {
    if (running || starting) return true;
    starting = true;
    try {
        // El reconocimiento del navegador puede tener el micro cogido: soltarlo primero
        if (RonState.recognition) { try { RonState.recognition.abort(); } catch (e) {} }
        if (stream) { try { stream.getTracks().forEach(t => t.stop()); } catch (e) {} stream = null; }
        let lastErr = null;
        for (let attempt = 0; attempt < 3 && !stream; attempt++) {
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
                });
            } catch (e) {
                lastErr = e;
                if (e.name === 'NotAllowedError' || e.name === 'SecurityError') break;   // permiso denegado: no insistir
                log(`Whisper: micro ocupado (${e.name}), reintento ${attempt + 1}/3…`);
                await new Promise(r => setTimeout(r, 1200));
            }
        }
        if (!stream) throw lastErr || new Error('micro no disponible');
        const AC = window.AudioContext || window.webkitAudioContext;
        ctx = new AC();
        if (ctx.state === 'suspended') { try { await ctx.resume(); } catch (e) {} }
        src = ctx.createMediaStreamSource(stream);
        sink = ctx.createGain(); sink.gain.value = 0;              // salida muda: solo para que el grafo procese
        let mode = 'AudioWorklet';
        try {
            const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
            await ctx.audioWorklet.addModule(url);
            URL.revokeObjectURL(url);
            node = new AudioWorkletNode(ctx, 'ron-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
            node.port.onmessage = ev => onFrame(ev.data);
        } catch (e) {
            mode = 'ScriptProcessor';                                // navegadores antiguos
            node = ctx.createScriptProcessor(FRAME, 1, 1);
            node.onaudioprocess = ev => onFrame(new Float32Array(ev.inputBuffer.getChannelData(0)));
        }
        src.connect(node); node.connect(sink); sink.connect(ctx.destination);
        running = true;
        lastFrameTs = Date.now();
        log(`🎙️ Oído Whisper activo (${mode}, ${ctx.sampleRate} Hz).`);
        return true;
    } catch (e) {
        log(`Whisper: no se pudo abrir el micro (${e.name}: ${e.message}). Uso el del navegador.`);
        fallback(e.name === 'NotAllowedError' ? 10 * 60000 : 2 * 60000, e.name === 'NotAllowedError' ? 'sin permiso de micrófono' : 'micrófono ocupado');
        return false;
    } finally {
        starting = false;
    }
}

export function stopWhisper() {
    if (!running && !stream) return;
    running = false;
    try { node && node.disconnect(); } catch (e) {}
    try { src && src.disconnect(); } catch (e) {}
    try { stream && stream.getTracks().forEach(t => t.stop()); } catch (e) {}
    try { ctx && ctx.close(); } catch (e) {}
    ctx = stream = src = node = sink = null;
    resetSegment();
    ring = [];
}

function fallback(ms, why = '') {
    fallbackUntil = Date.now() + ms;
    stopWhisper();
    if (RonState.activityState === 'LISTENING') changeState('IDLE');
    RonState.sttFallbackReason = why;
    slog('fallback', { why, min: Math.round(ms / 60000) });
    log(`Whisper en pausa ${Math.max(1, Math.round(ms / 60000))} min (${why}) → reconocimiento del navegador.`);
    import('./ui.js').then(ui => ui.showCaption && ui.showCaption(`Oído del navegador un rato (${why})`, 'hint')).catch(() => {});
    clearTimeout(returnTimer);
    returnTimer = setTimeout(() => {
        if (running || RonConfig.sttEngine === 'navegador') return;
        log('Fin de la pausa: vuelvo a Whisper.');
        try { RonState.recognition && RonState.recognition.abort(); } catch (e) {}
        setTimeout(() => import('./speech.js').then(s => s.startListening()).catch(() => {}), 400);
    }, ms + 500);
    import('./speech.js').then(s => s.startListening()).catch(() => {});
}

// Vigilante: si deja de llegar audio (app en segundo plano, micro robado por otra app,
// AudioContext suspendido) → reanudar; si no se recupera → reabrir el micro.
let stalls = 0;
setInterval(async () => {
    if (!running) return;
    if (Date.now() - lastFrameTs < 3000) { stalls = 0; return; }
    if (document.visibilityState === 'hidden') return;
    stalls++;
    log(`Oído: no llega audio (${ctx?.state}). Reintentando…`);
    try { await ctx?.resume(); } catch (e) {}
    if (stalls >= 2) {
        stalls = 0;
        stopWhisper();
        if (!(await ensureWhisper())) return;
    }
}, 2500);

// Para el registro de sesión: cómo está el oído ahora mismo
export function whisperDiag() {
    return { running, noise: +noiseFloor.toFixed(4), echoK: +echoK.toFixed(2), paused: fallbackUntil > Date.now() ? Math.round((fallbackUntil - Date.now()) / 1000) + 's' : '' };
}

function resetSegment() { seg = null; inSpeech = false; onsetMs = 0; voicedMs = 0; silenceMs = 0; segMs = 0; }

function canCapture() {
    if (!RonState.isMicEnabled) return false;
    if (bargeActive) return true;                       // le ha interrumpido: oír la frase entera
    if (RonState.ttsPending) return false;
    if (!ALLOWED.includes(RonState.activityState)) return false;
    if (window.speechSynthesis && window.speechSynthesis.speaking) return false;
    return Date.now() - (RonState.lastSpeakEndTs || 0) > ECHO_GUARD_MS;
}

function onFrame(data) {
    if (!running || !ctx) return;
    lastFrameTs = Date.now();
    const frameMs = data.length / ctx.sampleRate * 1000;
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length);
    level = Math.min(1, rms * 12);

    // Ron está hablando: vigilar si le interrumpen (voz por encima de su propio eco)
    if (RonState.activityState === 'SPEAKING' && RonState.isMicEnabled && RonConfig.bargeIn !== false) {
        ring.push(data);
        const keep = Math.ceil(PREROLL_MS / frameMs) + 1;
        if (ring.length > keep) ring.shift();
        const sinceStart = Date.now() - (RonState.speakStartTs || 0);
        // Envolvente: sube al instante y baja despacio (~250 ms), para que los huecos
        // entre sílabas no reinicien la cuenta
        bargeEnv = rms > bargeEnv ? rms : bargeEnv * 0.85;
        const floorThr = Math.max(noiseFloor * 3, 0.010) * 1.8;
        const out = outputRms();
        let thr;
        if (out >= 0) {
            // Voz de Gemini: sabemos cuánto suena Ron AHORA. Eco esperado = k × su volumen
            // (k se aprende solo mientras habla). Interrumpe quien suena 1,7 veces más que eso.
            outEnv = out > outEnv ? out : outEnv * 0.85;
            const predicted = echoK * outEnv;
            thr = Math.max(predicted * 1.7, floorThr, BARGE_MIN_RMS);
            if (!(sinceStart > BARGE_IGNORE_MS && bargeEnv > thr) && outEnv > 0.01) {
                const k = Math.min(3, bargeEnv / outEnv);
                echoK = echoK ? echoK * 0.92 + k * 0.08 : k;
            }
        } else {
            // Voz del navegador: no sabemos su volumen; comparar con el eco medio, más prudente
            thr = Math.max(echoAvg * 2.5, floorThr, BARGE_MIN_RMS);
        }
        RonState.bargeDebug = { env: +bargeEnv.toFixed(3), thr: +thr.toFixed(3), k: +echoK.toFixed(3), out: +outEnv.toFixed(3), ms: Math.round(bargeMs) };
        if (sinceStart > BARGE_IGNORE_MS && bargeEnv > thr) {
            bargeMs += frameMs;
        } else {
            bargeMs = Math.max(0, bargeMs - frameMs);
            echoAvg = echoAvg ? echoAvg * 0.94 + bargeEnv * 0.06 : bargeEnv;   // eco medio de la voz de Ron
        }
        if (bargeMs >= BARGE_MS) {
            log(`Interrupción por voz (volumen ${bargeEnv.toFixed(3)} > umbral ${thr.toFixed(3)}; eco k=${echoK.toFixed(2)}).`);
            bargeActive = true;
            bargeMs = 0;
            import('./speech.js').then(s => s.interruptSpeaking({ quiet: true })).catch(() => {});
            inSpeech = true;
            seg = ring.slice();                                         // con el principio de la frase
            segMs = seg.length * frameMs;
            voicedMs = BARGE_MS;
            silenceMs = 0;
            RonState.lastHeardTs = Date.now();
            setTimeout(() => { if (RonState.activityState === 'IDLE' && inSpeech) changeState('LISTENING'); }, 50);
        }
        return;
    }
    if (RonState.activityState !== 'SPEAKING') { bargeMs = 0; echoAvg = 0; bargeEnv = 0; outEnv = 0; }

    if (!canCapture()) {                    // Ron habla/piensa: descartar y no aprender ruido
        if (inSpeech && RonState.activityState === 'LISTENING') changeState('IDLE');
        resetSegment(); ring = [];
        return;
    }

    const threshold = Math.max(noiseFloor * 3, 0.010);
    ring.push(data);
    const keep = Math.ceil(PREROLL_MS / frameMs) + 1;
    if (ring.length > keep) ring.shift();

    if (!inSpeech) {
        if (rms > threshold) {
            onsetMs += frameMs;
            if (onsetMs >= ONSET_MS) {
                inSpeech = true;
                seg = ring.slice();
                segMs = seg.length * frameMs;
                voicedMs = onsetMs;
                silenceMs = 0;
                RonState.lastHeardTs = Date.now();
                if (RonState.activityState === 'IDLE') changeState('LISTENING');
            }
        } else {
            onsetMs = 0;
            noiseFloor = noiseFloor * 0.97 + rms * 0.03;   // se adapta al ruido de la habitación
        }
        return;
    }

    seg.push(data);
    segMs += frameMs;
    if (rms > threshold * 0.6) { voicedMs += frameMs; silenceMs = 0; RonState.lastHeardTs = Date.now(); }
    else silenceMs += frameMs;

    if (silenceMs >= END_SILENCE_MS || segMs >= MAX_SEGMENT_MS) {
        const chunks = seg, sr = ctx.sampleRate, voiced = voicedMs, segMsAll = segMs, silAll = silenceMs;
        resetSegment();
        ring = [];
        bargeActive = false;
        if (voiced < MIN_VOICED_MS) {
            slog('drop', { why: 'muy corto (ruido)', voicedMs: Math.round(voiced) });
            if (!pendingJobs) { flushPending(); if (RonState.activityState === 'LISTENING') changeState('IDLE'); }
            return;
        }
        const wav = encodeWav(chunks, sr);
        slog('seg', { voicedMs: Math.round(voiced), lenMs: Math.round(segMsAll), silMs: Math.round(silAll), state: RonState.activityState });
        pendingJobs++;
        // En cola: los trozos se transcriben en orden y, si ella seguía hablando, se unen
        queue = queue.then(() => transcribe(wav)).catch(err => log('Whisper: ' + err.message))
                     .finally(() => { pendingJobs--; maybeDeliver(); });
    }
}

// Entrega lo oído cuando ella ha terminado de hablar (sin trozos en curso ni en cola)
function maybeDeliver() {
    if (pendingJobs > 0 || inSpeech) return;
    flushPending();
}
function flushPending() {
    const text = pendingText.trim();
    pendingText = '';
    if (RonState.activityState === 'LISTENING') changeState('IDLE');
    if (!text) return;
    import('./speech.js').then(s => s.processTranscript(text, 'whisper'));
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

async function inConversation() {
    try { return !(await import('./speech.js')).needsWakeWord(); } catch (e) { return false; }
}

async function transcribe(wavBlob) {
    const conversing = await inConversation();
    // Tope por hora mientras solo espera la palabra "Ron" (ruido de fondo, tele...)
    if (!conversing) {
        const hk = new Date().toISOString().slice(0, 13);
        if (hk !== hourKey) { hourKey = hk; hourCount = 0; }
        if (++hourCount > WAKE_HOURLY_CAP) { slog('drop', { why: 'tope por hora esperando "Ron"' }); return; }
    }
    const names = [...new Set(['Ron', ...RonState.knownFaces.map(f => f.label)])].slice(0, 8).join(', ');
    const prompt = `Una niña habla en español con su robot de juguete, que se llama Ron. Nombres: ${names}.`;
    let anyNetworkError = false;
    for (const model of MODELS) {
        if ((cooldown[model] || 0) > Date.now()) continue;
        // Limitador propio: no pasar del máximo gratuito por minuto (evita el 429)
        const now = Date.now();
        sent[model] = (sent[model] || []).filter(t => now - t < 60000);
        if (sent[model].length >= RPM_SAFE) continue;
        sent[model].push(now);
        const fd = new FormData();
        fd.append('file', wavBlob, 'voz.wav');
        fd.append('model', model);
        fd.append('language', 'es');
        fd.append('temperature', '0');
        fd.append('response_format', 'verbose_json');
        fd.append('prompt', prompt);
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 9000);
        let res, data = null;
        const t0 = Date.now();
        try {
            res = await fetch(ENDPOINT, { method: 'POST', headers: { 'Authorization': `Bearer ${RonState.apiKey}` }, body: fd, signal: ctrl.signal });
            try { data = await res.json(); } catch (e) {}
        } catch (e) {
            log(`Whisper ${model}: ${e.name === 'AbortError' ? 'tarda demasiado' : e.message}`);
            slog('stterr', { model, err: e.name === 'AbortError' ? 'timeout 9 s' : e.message, ms: Date.now() - t0 });
            anyNetworkError = true;
            continue;
        } finally { clearTimeout(timer); }

        if (res.status === 429) {
            const secs = Math.min(Math.max(Number(res.headers.get('retry-after')) || 60, 10), 3600);
            cooldown[model] = Date.now() + secs * 1000;
            log(`Whisper ${model}: cuota agotada (${secs}s).`);
            slog('stterr', { model, err: `429 cuota (${secs}s)` });
            continue;
        }
        if (res.status === 401 || res.status === 403) { fallback(6 * 3600000, 'clave de Groq no válida'); return; }
        if (!res.ok) { log(`Whisper ${model}: HTTP ${res.status}`); slog('stterr', { model, err: 'HTTP ' + res.status }); anyNetworkError = true; continue; }

        countUse(model);
        failStreak = 0;
        let text = data?.text || '';
        if (Array.isArray(data?.segments) && data.segments.length) {
            const kept = data.segments.filter(keepSegment);
            if (kept.length < data.segments.length) log(`Whisper: descartados ${data.segments.length - kept.length} trozos dudosos.`);
            text = kept.map(s => s.text).join(' ');
        }
        const clean = cleanTranscript(text, { strict: !conversing });
        log(`Whisper (${Date.now() - t0} ms): "${clean || '—'}"${clean ? '' : ` (bruto: "${(data?.text || '').trim()}")`}`);
        slog('stt', { ms: Date.now() - t0, model, text: clean, raw: clean ? '' : (data?.text || '').trim(), wake: conversing ? '' : 'esperando Ron' });
        if (clean) pendingText += ' ' + clean;
        return;
    }
    // No se pudo transcribir esta frase
    const allCooled = MODELS.every(m => (cooldown[m] || 0) > Date.now());
    if (allCooled) {                                   // cuota agotada en los dos modelos
        const soonest = Math.min(...MODELS.map(m => cooldown[m]));
        fallback(Math.max(soonest - Date.now(), 60000), 'cuota de Whisper agotada');
        return;
    }
    if (anyNetworkError) {
        failStreak++;
        log(`Whisper: frase perdida por la red (${failStreak} seguidas).`);
        if (conversing) import('./ui.js').then(ui => ui.showCaption('No te he oído bien, ¿me lo repites?', 'hint')).catch(() => {});
        if (failStreak >= 3) { failStreak = 0; fallback(2 * 60000, 'la conexión falla'); }
    } else {
        log('Whisper: límite por minuto alcanzado; frase descartada.');
        slog('drop', { why: 'límite por minuto de Whisper' });
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

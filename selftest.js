// selftest.js — Autodiagnóstico de Ron (v29.1)
// Comprueba en el propio móvil, pieza a pieza, todo lo que necesita para oír, pensar,
// hablar y ver. El resultado se puede copiar y enviar para saber qué falla.

import { RonState, RonConfig, isBedtime, minutesToBedtime } from './core.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const withTimeout = (p, ms, label) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${label}: sin respuesta en ${ms / 1000} s`)), ms))]);

export async function runSelfTest(out, { micWasEnabled = RonState.isMicEnabled } = {}) {
    const line = (ok, text) => out(`${ok === true ? '✅' : ok === false ? '❌' : 'ℹ️'} ${text}`);

    // 1. Estado general
    const ver = document.getElementById('power-btn')?.textContent.match(/v[\d.]+/)?.[0] || '?';
    line(null, `Versión ${ver} · ${navigator.userAgent.match(/Android [\d.]+|iPhone OS [\d_]+|Windows NT [\d.]+/)?.[0] || ''} · ${navigator.onLine ? 'con internet' : 'SIN INTERNET'}`);
    line(null, `Estado: ${RonState.activityState} · micro ${micWasEnabled ? 'activado' : 'APAGADO (botón 🎙️)'} · escucha: ${RonConfig.listenMode === 'ron' ? 'solo con «Ron»' : 'si te ve o con «Ron»'}`);
    if (isBedtime()) line(false, 'Es la hora de dormir: Ron está en modo noche y solo contesta frases de dormido. Cambia la hora en Ajustes para probar.');
    else if (minutesToBedtime() <= (RonConfig.warnMinutes || 10)) line(null, `Faltan ${minutesToBedtime()} min para la hora de dormir.`);
    try {
        const reg = await navigator.serviceWorker?.getRegistration();
        const keys = await caches.keys();
        line(null, `Caché: ${keys.join(', ') || 'ninguna'} · service worker ${reg ? 'activo' : 'no registrado'}`);
    } catch (e) {}

    // 2. Groq (cerebro)
    if (!RonState.apiKey) line(false, 'Falta la clave de Groq: sin ella Ron no puede pensar ni usar Whisper.');
    else {
        try {
            const llm = await import('./llm.js');
            const t0 = Date.now();
            const r = await withTimeout(llm.chat([{ role: 'user', content: 'Responde solo con la palabra: hola' }], { models: llm.MODELS.fast, maxTokens: 30, timeoutMs: 9000 }), 20000, 'Groq');
            line(true, `Groq responde (${r.model}, ${Date.now() - t0} ms): "${r.text.slice(0, 40)}"`);
        } catch (e) { line(false, `Groq no responde: ${e.message}`); }
    }

    // 3. Micrófono + Whisper: graba 3 s con una frase
    out('🎙️ Di en voz alta: «Hola Ron, esto es una prueba» (grabando 3 segundos)…');
    let wav = null, peak = 0;
    try {
        const stream = await withTimeout(navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }), 8000, 'Permiso de micrófono');
        const AC = window.AudioContext || window.webkitAudioContext;
        const ctx = new AC();
        try { await ctx.resume(); } catch (e) {}
        const src = ctx.createMediaStreamSource(stream);
        const proc = ctx.createScriptProcessor(4096, 1, 1);
        const chunks = [];
        proc.onaudioprocess = ev => {
            const d = new Float32Array(ev.inputBuffer.getChannelData(0));
            chunks.push(d);
            let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i];
            peak = Math.max(peak, Math.sqrt(s / d.length));
        };
        const mute = ctx.createGain(); mute.gain.value = 0;
        src.connect(proc); proc.connect(mute); mute.connect(ctx.destination);
        await sleep(3000);
        proc.disconnect(); src.disconnect();
        stream.getTracks().forEach(t => t.stop());
        const rate = ctx.sampleRate;
        try { ctx.close(); } catch (e) {}
        line(chunks.length ? null : false, `Micrófono: ${chunks.length ? `${(chunks.length * 4096 / rate).toFixed(1)} s grabados` : 'NO llega audio (contexto de audio parado)'} · volumen máximo ${peak.toFixed(3)}`);
        if (chunks.length) {
            line(peak > 0.02 ? true : false, peak > 0.02 ? 'Llega tu voz al micrófono.' : 'El micrófono apenas capta sonido (¿tapado, otra app lo usa, o permiso denegado?).');
            const w = await import('./whisper.js');
            wav = w.encodeWav(chunks, rate);
        }
    } catch (e) { line(false, `Micrófono: ${e.message}`); }

    if (wav && RonState.apiKey) {
        try {
            const fd = new FormData();
            fd.append('file', wav, 'prueba.wav');
            fd.append('model', 'whisper-large-v3-turbo');
            fd.append('language', 'es');
            const t0 = Date.now();
            const res = await withTimeout(fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${RonState.apiKey}` }, body: fd }), 15000, 'Whisper');
            const data = await res.json().catch(() => ({}));
            if (res.ok) line(true, `Whisper (${Date.now() - t0} ms) ha entendido: "${(data.text || '').trim() || '(nada)'}"`);
            else line(false, `Whisper: HTTP ${res.status} ${data?.error?.message || ''}`);
        } catch (e) { line(false, `Whisper: ${e.message}`); }
    }
    try {
        const w = await import('./whisper.js');
        const usingBrowser = !w.isWhisperRunning() && RonState.isRecognitionActive;
        line(usingBrowser ? false : null, `Oído en uso: ${w.isWhisperRunning() ? 'Whisper (sin pitidos)' : usingBrowser ? 'reconocimiento del navegador (pita en Android)' : 'ninguno escuchando ahora mismo'} (ajuste: ${RonConfig.sttEngine})${usingBrowser && RonState.sttFallbackReason ? ' · motivo: ' + RonState.sttFallbackReason : ''}`);
        line(null, `Interrumpir hablándole: ${RonConfig.bargeIn !== false ? 'activado (solo con Whisper)' : 'desactivado'}`);
    } catch (e) {}

    // 4. Voz del navegador
    try {
        const voices = speechSynthesis.getVoices();
        const es = voices.filter(v => v.lang && v.lang.startsWith('es'));
        line(es.length ? true : false, `Voces en español en el móvil: ${es.length}${es.length ? ' (' + es.slice(0, 2).map(v => v.name).join(', ') + ')' : ' — instala/activa una voz en Ajustes de Android → Texto a voz'}`);
        const r = await new Promise(resolve => {
            const u = new SpeechSynthesisUtterance('Prueba de voz del navegador.');
            u.lang = 'es-ES'; if (es[0]) u.voice = es[0];
            let started = false;
            u.onstart = () => { started = true; };
            u.onend = () => resolve(started ? 'ok' : 'terminó sin empezar');
            u.onerror = e => resolve('error: ' + (e.error || '?'));
            setTimeout(() => resolve(started ? 'empezó pero no terminó (8 s)' : 'no empezó a hablar en 8 s'), 8000);
            speechSynthesis.cancel(); speechSynthesis.speak(u);
        });
        line(r === 'ok', `Voz del navegador: ${r === 'ok' ? 'funciona (¿la has oído?)' : r}`);
    } catch (e) { line(false, `Voz del navegador: ${e.message}`); }

    // 5. Voz de Gemini
    if (RonConfig.voiceEngine === 'gemini') {
        if (!RonConfig.geminiKey) line(null, 'Voz Gemini elegida pero sin clave → usa la del navegador.');
        else {
            try {
                const tts = await import('./tts.js');
                tts.unlockAudio();
                const buf = await withTimeout(tts.synthesize('Prueba de voz de Gemini.', { budgetMs: 9000 }), 12000, 'Gemini');
                const info = tts.lastTtsInfo();
                if (buf) { await tts.play(buf).done; line(true, `Voz Gemini funciona (${info.model}, ${info.ms} ms) — ¿la has oído?`); }
                else line(false, `Voz Gemini no funciona: ${info.error} → Ron usa la del navegador.`);
            } catch (e) { line(false, `Voz Gemini: ${e.message}`); }
        }
    } else line(null, 'Voz elegida: navegador.');

    // 6. Cámara y caras
    try {
        const v = await import('./vision.js');
        const dbg = v.getVisionDebug();
        line(typeof faceapi !== 'undefined', `Librería de caras: ${typeof faceapi !== 'undefined' ? 'cargada' : 'NO cargada (¿sin internet al arrancar?)'} · motor ${dbg.backend || '?'}`);
        line(dbg.camera !== '-', `Cámara: ${dbg.camera !== '-' ? dbg.camera : 'no iniciada'} · exposición: ${dbg.exposure}`);
        line(dbg.fresh ? true : null, dbg.fresh ? `Ve una cara ahora mismo (${dbg.quality?.ok ? 'imagen buena' : 'imagen descartada: ' + (dbg.quality?.reasons || []).join(', ')})` : 'No ve ninguna cara ahora mismo (ponte delante para comprobarlo).');
        line(null, `Personas guardadas: ${(RonState.knownFaces || []).map(f => `${f.label} (${(f.descriptors || []).length})`).join(', ') || 'ninguna'}`);
    } catch (e) { line(false, `Visión: ${e.message}`); }

    out('— Fin del diagnóstico —');
}

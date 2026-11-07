// sessionlog.js — Registro de sesión para revisar cómo va Ron en el móvil real (v30.3)
//
// Guarda en el móvil (localStorage) una línea por cada cosa importante: lo que oyó y con qué
// motor, lo que descartó y por qué, cuánto tardó la IA y la voz, lo que contestó, si le
// interrumpieron, errores, y cada minuto el estado del micro y la cámara. NO guarda claves
// ni audio. Contiene lo que se dice a Ron: solo sale del móvil si lo exportas tú.
// Sin imports: lo usa core.js y no debe crear dependencias circulares.

const KEY = 'ron_session_log';
const ON_KEY = 'ron_slog_on';
const MAX = 3000;
let events = null;
let saveTimer = null;
let sessionId = null;

export function isLogging() { try { return localStorage.getItem(ON_KEY) !== '0'; } catch (e) { return true; } }
export function setLogging(on) { try { localStorage.setItem(ON_KEY, on ? '1' : '0'); } catch (e) {} }

function load() {
    if (events) return events;
    try { events = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { events = []; }
    if (!Array.isArray(events)) events = [];
    return events;
}
function persist() {
    saveTimer = null;
    try { localStorage.setItem(KEY, JSON.stringify(events)); }
    catch (e) {                                   // sin espacio: se queda con la mitad más reciente
        events = events.slice(-Math.floor(events.length / 2));
        try { localStorage.setItem(KEY, JSON.stringify(events)); } catch (e2) {}
    }
}
// Guardar como mucho cada 5 s (escribir ~400 KB en el móvil no es gratis)
function schedule() { if (!saveTimer) saveTimer = setTimeout(persist, 5000); }
export function flush() { if (saveTimer) { clearTimeout(saveTimer); } if (events) persist(); }

const clip = (v, n = 300) => typeof v === 'string' && v.length > n ? v.slice(0, n) + '…' : v;

// slog('heard', { text: 'hola', src: 'whisper' })
export function slog(type, data = {}) {
    if (!isLogging()) return;
    load();
    const e = { t: Date.now(), k: type };
    for (const [key, v] of Object.entries(data)) if (v !== undefined && v !== null && v !== '') e[key] = clip(v);
    if (sessionId) e.s = sessionId;
    events.push(e);
    if (events.length > MAX + 200) events = events.slice(-MAX);
    schedule();
}

export function startSession(info = {}) {
    sessionId = Date.now().toString(36);
    slog('boot', info);
}

// Caras: llegan ~1,5 por segundo; en vez de guardarlas todas se resumen cada minuto
let faces = { ok: 0, bad: 0, reasons: {}, best: {} };
export function tallyFace(line) {
    let m = line.match(/^Cara: fotograma descartado \((.*)\)/);
    if (m) { faces.bad++; for (const r of m[1].split(', ')) { const k = r.replace(/\s*\(.*\)|\s*[\d.,]+.*$/g, '').trim(); faces.reasons[k] = (faces.reasons[k] || 0) + 1; } return true; }
    m = line.match(/^Cara: (\S+) \(dist=([\d.]+)/);
    if (m) { faces.ok++; const d = parseFloat(m[2]); const b = faces.best[m[1]]; faces.best[m[1]] = b ? { n: b.n + 1, min: Math.min(b.min, d), sum: b.sum + d } : { n: 1, min: d, sum: d }; return true; }
    return false;
}
export function takeFaceStats() {
    const f = faces; faces = { ok: 0, bad: 0, reasons: {}, best: {} };
    if (!f.ok && !f.bad) return '';
    const best = Object.entries(f.best).map(([k, v]) => `${k} ${(v.sum / v.n).toFixed(2)}(mín ${v.min.toFixed(2)})`).join(', ');
    const rs = Object.entries(f.reasons).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k}×${v}`).join(', ');
    return `buenas ${f.ok}${best ? ' [' + best + ']' : ''} · descartadas ${f.bad}${rs ? ' (' + rs + ')' : ''}`;
}

export function clearLog() { events = []; persist(); }
export function count() { return load().length; }
export function rawEvents() { return load().slice(); }

// Errores de JavaScript sin capturar: también al registro
if (typeof window !== 'undefined') {
    window.addEventListener('error', e => slog('jserr', { msg: e.message, at: (e.filename || '').split('/').pop() + ':' + (e.lineno || '') }));
    window.addEventListener('unhandledrejection', e => slog('jserr', { msg: String(e.reason && e.reason.message || e.reason) }));
    document.addEventListener('visibilitychange', () => {
        slog('vis', { v: document.visibilityState });
        if (document.visibilityState === 'hidden') flush();
    });
    window.addEventListener('pagehide', flush);
}

// ── Exportar como texto legible (resumen + línea de tiempo) ────────────────
const pad = (n, l = 2) => String(n).padStart(l, '0');
const hms = t => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${Math.floor(d.getMilliseconds() / 100)}`; };
const sec = ms => (ms / 1000).toFixed(1) + ' s';
function stats(arr) {
    if (!arr.length) return '—';
    const s = arr.slice().sort((a, b) => a - b);
    const q = p => s[Math.min(s.length - 1, Math.floor(p * s.length))];
    return `mediana ${sec(q(0.5))} · 90% ${sec(q(0.9))} · máx ${sec(s[s.length - 1])} (n=${s.length})`;
}

// Turnos: de que ella deja de hablar a que Ron empieza a hablar
export function computeTurns(ev) {
    const turns = [];
    let lastSegEnd = null, cur = null;
    for (const e of ev) {
        if (e.k === 'boot') { lastSegEnd = null; cur = null; }
        if (e.k === 'seg') lastSegEnd = e.t - (e.silMs || 0);      // cuando dejó de hablar de verdad (antes del silencio de cierre)
        if (e.k === 'heard') {
            const from = lastSegEnd && e.t - lastSegEnd < 15000 ? lastSegEnd : e.t;
            cur = { heardT: e.t, from, stt: from !== e.t ? e.t - from : null, text: e.text, llm: 0, ignored: false };
            lastSegEnd = null;
            turns.push(cur);
        }
        if (!cur) continue;
        if (e.k === 'ignored' && e.t - cur.heardT < 2000) cur.ignored = e.why;
        // IA: desde que se oyó hasta que llegó la última respuesta de chat antes de hablar
        if (e.k === 'llm' && e.ok && e.kind === 'chat' && !cur.sayT) cur.llm = e.t - cur.heardT;
        if (e.k === 'say' && !cur.sayT && e.t - cur.heardT < 30000) { cur.sayT = e.t; cur.total = e.t - cur.from; cur.tts = e.ttsMs; cur.reply = e.text; }
    }
    return turns;
}

export function exportText({ version = '' } = {}) {
    flush();
    const ev = load();
    if (!ev.length) return 'Registro vacío.';
    const turns = computeTurns(ev);
    const answered = turns.filter(t => t.sayT);
    const ign = turns.filter(t => t.ignored);
    const noReply = turns.filter(t => !t.sayT && !t.ignored);
    const c = k => ev.filter(e => e.k === k).length;
    const sttSrc = {};
    ev.filter(e => e.k === 'heard').forEach(e => { sttSrc[e.src || '?'] = (sttSrc[e.src || '?'] || 0) + 1; });
    const ignWhy = {};
    ign.forEach(t => { ignWhy[t.ignored] = (ignWhy[t.ignored] || 0) + 1; });
    const drops = {};
    ev.filter(e => e.k === 'drop').forEach(e => { drops[e.why] = (drops[e.why] || 0) + 1; });
    const llmErr = ev.filter(e => e.k === 'llm' && !e.ok);
    const models = {};
    ev.filter(e => e.k === 'llm' && e.ok).forEach(e => { models[e.model] = (models[e.model] || 0) + 1; });
    const sayEng = {};
    ev.filter(e => e.k === 'say').forEach(e => { sayEng[e.engine || '?'] = (sayEng[e.engine || '?'] || 0) + 1; });
    const fmt = o => Object.entries(o).map(([k, v]) => `${k} ${v}`).join(' · ') || '—';
    const boots = ev.filter(e => e.k === 'boot');
    const lines = [];
    lines.push(`REGISTRO DE SESIÓN DE RON ${version}`);
    lines.push(`Desde ${new Date(ev[0].t).toLocaleString('es-ES')} hasta ${new Date(ev[ev.length - 1].t).toLocaleString('es-ES')} · ${boots.length} arranques · ${ev.length} eventos`);
    if (boots.length) {
        const b = boots[boots.length - 1];
        lines.push(`Último arranque: ${Object.entries(b).filter(([k]) => !['t', 'k', 's'].includes(k)).map(([k, v]) => `${k}=${v}`).join(' · ')}`);
    }
    lines.push('');
    lines.push('RESUMEN');
    lines.push(`- Frases oídas: ${turns.length} (${fmt(sttSrc)})`);
    lines.push(`- Contestadas: ${answered.length} · ignoradas: ${ign.length} (${fmt(ignWhy)}) · sin respuesta: ${noReply.length}`);
    lines.push(`- Tiempo de respuesta (deja de hablar → Ron habla): ${stats(answered.map(t => t.total))}`);
    lines.push(`  · silencio de cierre + transcribir (Whisper): ${stats(answered.filter(t => t.stt != null).map(t => t.stt))}`);
    lines.push(`  · IA: ${stats(answered.filter(t => t.llm > 0).map(t => t.llm))}`);
    lines.push(`  · voz hasta el primer sonido: ${stats(answered.filter(t => t.tts != null).map(t => t.tts))}`);
    lines.push(`- Audio descartado antes de transcribir: ${fmt(drops)}`);
    lines.push(`- Whisper sin texto: ${ev.filter(e => e.k === 'stt' && !e.text).length} · errores de red/cuota de Whisper: ${ev.filter(e => e.k === 'stterr').length} · cambios al oído del navegador: ${c('fallback')}`);
    lines.push(`- IA: ${fmt(models)} · errores: ${llmErr.length}${llmErr.length ? ' (' + [...new Set(llmErr.map(e => e.err))].slice(0, 4).join(' | ') + ')' : ''}`);
    lines.push(`- Voz: ${fmt(sayEng)} · interrupciones (le cortaron): ${c('barge')} · errores JS: ${c('jserr')}`);
    lines.push('');
    lines.push('LÍNEA DE TIEMPO');
    const ICON = { boot: '🔌', seg: '〰️', drop: '🗑️', stt: '📝', stterr: '⚠️', heard: '🎤', ignored: '🙉', llm: '🧠', say: '🤖', sayend: '⏹️', barge: '✋', fallback: '🔁', face: '👤', env: '📊', jserr: '💥', log: '·', vis: '👁️', game: '🎲', state: '↪' };
    let prevBoot = null;
    for (const e of ev) {
        if (e.k === 'boot') { lines.push(''); lines.push(`──────── ARRANQUE ${new Date(e.t).toLocaleString('es-ES')} ────────`); prevBoot = e; }
        const rest = Object.entries(e).filter(([k]) => !['t', 'k', 's'].includes(k))
            .map(([k, v]) => (k === 'text' || k === 'msg') ? `"${v}"` : `${k}=${v}`).join(' ');
        lines.push(`${hms(e.t)} ${ICON[e.k] || e.k} ${e.k === 'log' ? '' : e.k + ' '}${rest}`);
    }
    return lines.join('\n');
}

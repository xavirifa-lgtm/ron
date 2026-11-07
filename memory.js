// memory.js — Memoria a largo plazo POR PERSONA blindada con IndexedDB + localStorage.

import { RonState, log } from './core.js';
import { chat, MODELS } from './llm.js';
import { vaultSet, vaultGet } from './identity.js';

const KEY = 'ron_memory_v1';
const MAX_FACTS = 300;          // por persona (~36 KB como mucho); al prompt solo van los relevantes
const PROMPT_FACTS = 18;        // cuántos hechos se le pasan a la IA en cada respuesta
const CONSOLIDATE_EVERY = 3;

const nf = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9ñ ]/g, '').replace(/\s+/g, ' ').trim();

let pendingTurns = 0;
let consolidating = false;
let quietTimer = null;

function loadAll() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}

function saveAll(all) {
    try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) {}
    vaultSet(KEY, all);
}

(async function restoreMemoryFromVault() {
    try {
        const vaultMem = await vaultGet(KEY);
        const localMem = loadAll();
        if (vaultMem && Object.keys(vaultMem).length > Object.keys(localMem).length) {
            localStorage.setItem(KEY, JSON.stringify(vaultMem));
            log(`Bóveda: restaurados los recuerdos de ${Object.keys(vaultMem).length} personas.`);
        } else if (Object.keys(localMem).length > 0) {
            await vaultSet(KEY, localMem);
        }
    } catch (e) {}
})();

export function getFacts(name) {
    if (!name) return [];
    const all = loadAll();
    const facts = (all[name] && all[name].facts) || [];
    const u = RonState.userStats?.[name];
    const legacy = [];
    if (u?.likes?.length)    legacy.push(...u.likes.map(l => `Le gusta ${l}`));
    if (u?.dislikes?.length) legacy.push(...u.dislikes.map(l => `No le gusta ${l}`));
    return [...new Set([...facts, ...legacy])].slice(-MAX_FACTS);
}

// ── Recuperar solo lo que viene a cuento (el plan gratuito de Groq tiene ~8K tokens/minuto:
// no se pueden mandar 300 hechos en cada frase). Se mezclan: los que comparten palabras con
// lo que se está hablando + los más recientes. Se devuelven en su orden original.
const STOP = new Set(('para pero como porque cuando donde quien tiene tengo tiene esta este esto eso esos esas estas estos ' +
    'mucho mucha muchos muchas poco hace hacer hizo muy mas menos sobre entre desde hasta todo toda todos todas otro otra ' +
    'ella ellos ellas suyo suya nuestro nuestra tambien siempre nunca algo nada alguien ahora antes despues luego bien ' +
    'gusta gustan encanta encantan contó conto dijo dice sabes sabe quiere quieres tiene tienen llama llamas ' +
    'pidio recordar fecha hola vale bueno pues entonces').split(' ').map(w => nf(w)));
const stem = w => w.length > 5 ? w.slice(0, 5) : w;
function keywords(text) {
    return new Set(nf(text).split(' ').filter(w => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)).map(stem));
}
export function getRelevantFacts(name, focusText = '', n = PROMPT_FACTS) {
    const facts = getFacts(name);
    if (facts.length <= n) return facts;
    const kw = keywords(focusText);
    const recentN = Math.min(6, n);
    const picked = new Set(facts.map((_, i) => i).slice(-recentN));
    if (kw.size) {
        const scored = facts.map((f, i) => {
            let sc = 0;
            for (const w of keywords(f)) if (kw.has(w)) sc++;
            return { i, sc };
        }).filter(x => x.sc > 0 && !picked.has(x.i)).sort((a, b) => b.sc - a.sc || b.i - a.i);
        for (const x of scored) { if (picked.size >= n) break; picked.add(x.i); }
    }
    // Hueco libre: hechos "de fondo" (gustos, familia, mascotas) antes que cualquier otro
    if (picked.size < n) {
        const core = facts.map((f, i) => ({ f, i })).filter(x => !picked.has(x.i) &&
            /\b(le gusta|le encanta|su (mama|madre|papa|padre|herman|perr|gat|mascota|mejor amig|color|comida|animal)|se llama|tiene un|tiene una)/.test(nf(x.f)));
        for (const x of core.reverse()) { if (picked.size >= n) break; picked.add(x.i); }
    }
    return [...picked].sort((a, b) => a - b).map(i => facts[i]);
}

// Para el visor de Ajustes
export function listPeople() { const all = loadAll(); return Object.keys(all).filter(k => (all[k].facts || []).length); }
export function deleteFact(name, text) {
    const all = loadAll();
    if (!all[name] || !all[name].facts) return false;
    const before = all[name].facts.length;
    all[name].facts = all[name].facts.filter(f => f !== text);
    if (all[name].facts.length === before) return false;
    saveAll(all);
    return true;
}

// ── Quién es quién: la "amiga principal" (la niña) frente al resto de personas que Ron conoce
const MAIN_KEY = 'ron_main_friend';
export function getMainFriend() {
    try { const m = localStorage.getItem(MAIN_KEY); if (m) return m; } catch (e) {}
    return (RonState.knownFaces && RonState.knownFaces[0] && RonState.knownFaces[0].label) || null;
}
export function setMainFriend(name) {
    try { localStorage.setItem(MAIN_KEY, name); } catch (e) {}
    vaultSet(MAIN_KEY, name);
}
// La primera persona que se registra es la amiga principal (se puede cambiar en Ajustes)
export function ensureMainFriend(name) {
    try { if (!localStorage.getItem(MAIN_KEY) && name) setMainFriend(getMainFriend() || name); } catch (e) {}
}
(async function restoreMainFromVault() {
    try { if (!localStorage.getItem(MAIN_KEY)) { const v = await vaultGet(MAIN_KEY); if (v) localStorage.setItem(MAIN_KEY, v); } } catch (e) {}
})();
export function isMainFriend(name) { const m = getMainFriend(); return !m || m === name; }

export function renamePerson(oldName, newName) {
    const all = loadAll();
    if (all[oldName] && !all[newName]) {
        all[newName] = all[oldName];
        delete all[oldName];
        saveAll(all);
    }
    try { if (localStorage.getItem(MAIN_KEY) === oldName) setMainFriend(newName); } catch (e) {}
}

// ── Hechos: se AÑADEN y CORRIGEN (antes la IA reescribía la lista entera y podía perder cosas)
function mergeFacts(name, add = [], fix = []) {
    const all = loadAll();
    const cur = (all[name] && all[name].facts) || [];
    let facts = [...cur];
    for (const f of fix) {
        if (!f || !f.antes || !f.ahora) continue;
        const i = facts.findIndex(x => nf(x) === nf(f.antes) || nf(x).includes(nf(f.antes)));
        if (i >= 0) facts[i] = String(f.ahora).trim().substring(0, 120);
    }
    for (const f of add) {
        const c = String(f || '').trim().substring(0, 120);
        if (c.length < 4) continue;
        if (facts.some(x => nf(x) === nf(c))) continue;
        facts.push(c);
    }
    if (facts.length > MAX_FACTS) facts = facts.slice(-MAX_FACTS);     // se olvidan los más antiguos
    all[name] = { ...(all[name] || {}), facts, updated: new Date().toISOString() };
    saveAll(all);
    return facts.length - cur.length;
}

// Un hecho suelto que apunta el propio programa (p. ej. "Se sabe la tabla del 3")
export function addFact(name, text) { if (name && text) mergeFacts(name, [text]); }

// ── Cosas pendientes de preguntar ("mañana tengo examen" → al día siguiente: ¿qué tal?)
export function getPending(name) {
    const all = loadAll();
    return ((all[name] && all[name].pending) || []);
}
function addPending(name, items) {
    const all = loadAll();
    const p = (all[name] && all[name].pending) || [];
    for (const it of items) {
        if (!it || !it.texto || !/^\d{4}-\d{2}-\d{2}$/.test(it.cuando || '')) continue;
        if (p.some(x => nf(x.texto) === nf(it.texto))) continue;
        p.push({ texto: String(it.texto).substring(0, 120), cuando: it.cuando, asked: false });
    }
    all[name] = { ...(all[name] || { facts: [] }), pending: p.slice(-20) };
    saveAll(all);
}
// Lo que toca preguntar hoy (el día del plan o después, durante una semana)
export function duePending(name) {
    const today = isoDate(new Date());
    const weekAgo = isoDate(new Date(Date.now() - 7 * 86400000));
    return getPending(name).filter(x => !x.asked && x.cuando <= today && x.cuando >= weekAgo);
}
export function markAsked(name, texto) {
    const all = loadAll();
    const p = (all[name] && all[name].pending) || [];
    const it = p.find(x => x.texto === texto);
    if (it) { it.asked = true; saveAll(all); }
}
const isoDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// "Recuerda que…": se guarda al momento, sin esperar al resumen
export function rememberNow(name, text) {
    if (!name || !text) return;
    const today = isoDate(new Date());
    const when = resolveWhen(text);
    // Con la fecha en que lo contó: "mañana" deja de ser verdad al día siguiente
    mergeFacts(name, [when ? `Contó el ${today}: "${text}" (para el ${when})` : `Le pidió a Ron recordar: "${text}"`]);
    if (when) addPending(name, [{ texto: `${text} (lo dijo el ${today})`, cuando: when }]);
}
// Fechas sencillas dichas por una niña: hoy, mañana, pasado mañana, el lunes...
export function resolveWhen(text, base = new Date()) {
    const t = nf(text);
    const add = n => isoDate(new Date(base.getFullYear(), base.getMonth(), base.getDate() + n));
    if (/pasado manana/.test(t)) return add(2);
    if (/\bmanana\b/.test(t) && !/por la manana|esta manana/.test(t)) return add(1);
    const days = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
    for (let i = 0; i < 7; i++) {
        if (new RegExp(`\\b(el |este )?${days[i]}\\b`).test(t)) { let d = (i - base.getDay() + 7) % 7; if (d === 0) d = 7; return add(d); }
    }
    if (/\b(esta tarde|hoy|luego)\b/.test(t)) return add(0);
    return null;
}

export function noteUserTurn() {
    pendingTurns++;
    if (pendingTurns >= CONSOLIDATE_EVERY) { consolidate().catch(() => {}); return; }
    if (quietTimer) clearTimeout(quietTimer);
    quietTimer = setTimeout(() => { if (pendingTurns >= 1) consolidate().catch(() => {}); }, 60000);
}

export async function consolidate() {
    const name = RonState.currentUser;
    if (!name || consolidating || !RonState.apiKey) return;
    const turns = (RonState.conversation || []).slice(-14);
    if (turns.length < 2) return;
    consolidating = true;
    pendingTurns = 0;
    if (quietTimer) { clearTimeout(quietTimer); quietTimer = null; }
    try {
        const transcriptText = turns.filter(t => t.role === 'user').map(t => t.content).join(' ');
        // Solo los hechos recientes y los relacionados: con 300 hechos el JSON entero no cabe
        const known = getRelevantFacts(name, transcriptText, 40);
        const main = getMainFriend();
        const quien = isMainFriend(name)
            ? `${name}, una niña de 7 años`
            : `${name}, una persona que Ron conoce${main ? ` (no es ${main}; puede ser de su familia o un amigo)` : ''}`;
        const now = new Date();
        const days = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
        const transcript = turns.map(t => `${t.role === 'user' ? name : 'Ron'}: ${t.content}`).join('\n');
        const sys =
`Eres el módulo de memoria de un robot amigo de ${quien}. Hoy es ${days[now.getDay()]} ${isoDate(now)}.
Lee la conversación y devuelve SOLO JSON:
{"nuevos": ["hechos NUEVOS sobre ${name}"], "corregir": [{"antes": "hecho conocido exacto", "ahora": "hecho corregido"}], "pendientes": [{"texto": "qué va a pasar", "cuando": "AAAA-MM-DD"}]}
Reglas:
- Solo lo que ${name} ha CONTADO de sí mismo/a (no lo que dice Ron). Hechos cortos en tercera persona (máx 12 palabras): gustos, amigos, familia, mascotas, cole, juegos favoritos, cosas que le han pasado, lo que le han enseñado${isMainFriend(name) ? '' : `, y qué relación tiene con ${main || 'la niña'} si lo dice`}.
- "nuevos": solo lo que NO está ya en los hechos conocidos (abajo hay una parte de ellos: los recientes y los relacionados). "corregir": solo si contradice uno conocido.
- "pendientes": planes o cosas futuras con fecha (un examen, un cumpleaños, una excursión, ir al médico), para preguntarle después cómo fue. Calcula la fecha real a partir de hoy.
- NO guardes nada sobre que alguien le hace daño, ni dirección, teléfono o colegio exacto.
- Si no hay nada, devuelve listas vacías.
Hechos conocidos (parte): ${JSON.stringify(known)}`;
        const { text } = await chat(
            [{ role: 'system', content: sys }, { role: 'user', content: transcript }],
            { models: MODELS.fast, maxTokens: 700, temperature: 0.1, timeoutMs: 10000, json: true }
        );
        const parsed = JSON.parse(text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1));
        const added = mergeFacts(name, Array.isArray(parsed.nuevos) ? parsed.nuevos : (Array.isArray(parsed.facts) ? parsed.facts : []),
                                 Array.isArray(parsed.corregir) ? parsed.corregir : []);
        if (Array.isArray(parsed.pendientes) && parsed.pendientes.length) addPending(name, parsed.pendientes);
        log(`Memoria de ${name}: +${added} hechos${parsed.pendientes?.length ? `, ${parsed.pendientes.length} pendientes` : ''} (total ${getFacts(name).length}).`);
    } catch (e) {
        log(`Memoria: no se pudo resumir (${e.message}).`);
    } finally {
        consolidating = false;
    }
}

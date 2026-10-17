// memory.js — Memoria a largo plazo POR PERSONA, guardada solo en el dispositivo.
// Cada pocas frases, un modelo rápido resume lo importante de la conversación en
// hechos cortos ("Su perro se llama Toby", "Su mejor amiga es Carla"). Ron los
// usa luego para preguntar y recordar, como un amigo.
// Sustituye al extractor anterior, que solo reaccionaba a la palabra "gusta".

import { RonState, log } from './core.js';
import { chat, MODELS } from './llm.js';

const KEY = 'ron_memory_v1';
const MAX_FACTS = 30;
const CONSOLIDATE_EVERY = 4;   // turnos de la niña entre resúmenes

let pendingTurns = 0;
let consolidating = false;
let quietTimer = null;

function loadAll() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}
function saveAll(all) { localStorage.setItem(KEY, JSON.stringify(all)); }

export function getFacts(name) {
    if (!name) return [];
    const all = loadAll();
    const facts = (all[name] && all[name].facts) || [];
    // Migrar gustos guardados por versiones anteriores
    const u = RonState.userStats?.[name];
    const legacy = [];
    if (u?.likes?.length)    legacy.push(...u.likes.map(l => `Le gusta ${l}`));
    if (u?.dislikes?.length) legacy.push(...u.dislikes.map(l => `No le gusta ${l}`));
    return [...new Set([...facts, ...legacy])].slice(-MAX_FACTS);
}

export function renamePerson(oldName, newName) {
    const all = loadAll();
    if (all[oldName] && !all[newName]) { all[newName] = all[oldName]; delete all[oldName]; saveAll(all); }
}

// Llamar tras cada frase de la niña. Cada N turnos resume en segundo plano.
export function noteUserTurn() {
    pendingTurns++;
    if (pendingTurns >= CONSOLIDATE_EVERY) { consolidate().catch(() => {}); return; }
    // Charla corta: resumir igualmente cuando lleve 90 s en silencio
    if (quietTimer) clearTimeout(quietTimer);
    quietTimer = setTimeout(() => { if (pendingTurns >= 2) consolidate().catch(() => {}); }, 90000);
}

export async function consolidate() {
    const name = RonState.currentUser;
    if (!name || consolidating || !RonState.apiKey) return;
    const turns = (RonState.conversation || []).slice(-14);
    if (turns.length < 3) return;
    consolidating = true;
    pendingTurns = 0;
    if (quietTimer) { clearTimeout(quietTimer); quietTimer = null; }
    try {
        const known = getFacts(name);
        const transcript = turns.map(t => `${t.role === 'user' ? name : 'Ron'}: ${t.content}`).join('\n');
        const sys =
`Eres el módulo de memoria de un robot amigo de una niña llamada ${name}.
Lee la conversación y devuelve SOLO JSON: {"facts": ["...", "..."]} con la lista COMPLETA y actualizada de hechos útiles sobre ${name}.
Reglas:
- Hechos cortos en español, en tercera persona (máx 12 palabras): gustos, amigos, familia, mascotas, colegio, juegos favoritos, planes, cosas que le han pasado.
- Conserva los hechos conocidos que sigan siendo ciertos; corrige los que la conversación contradiga; no dupliques.
- NO guardes nada sobre que alguien le hace daño, ni datos como dirección o teléfono.
- Máximo ${MAX_FACTS} hechos. Si no hay nada nuevo, devuelve los conocidos.
Hechos conocidos: ${JSON.stringify(known)}`;
        const { text } = await chat(
            [{ role: 'system', content: sys }, { role: 'user', content: transcript }],
            { models: MODELS.fast, maxTokens: 900, temperature: 0.1, timeoutMs: 10000, json: true }
        );
        const parsed = JSON.parse(text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1));
        if (Array.isArray(parsed.facts)) {
            const facts = parsed.facts
                .filter(f => typeof f === 'string' && f.trim().length > 3)
                .map(f => f.trim().substring(0, 120))
                .slice(-MAX_FACTS);
            const all = loadAll();
            all[name] = { facts, updated: new Date().toISOString() };
            saveAll(all);
            log(`Memoria de ${name}: ${facts.length} hechos.`);
        }
    } catch (e) {
        log(`Memoria: no se pudo resumir (${e.message}).`);
    } finally {
        consolidating = false;
    }
}

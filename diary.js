// diary.js - El diario de aventuras de Ron
// Ron recuerda y narra lo que hizo con el niño. "¿Te acuerdas cuando...?"
// En la película Ron acumula experiencias y las trata como tesoros.

import { RonState, log } from './core.js';
import { speak } from './speech.js';
import { setExpression } from './ui.js';

const STORAGE_KEY  = 'ron_diary';
const MAX_ENTRIES  = 50;

// ── Tipos de entrada ──────────────────────────────────────────────────────────
// 'game'    → jugaron a algo
// 'story'   → contó una historia
// 'selfie'  → hicieron una foto
// 'chat'    → conversación memorable
// 'music'   → pusieron música
// 'learnt'  → Ron aprendió algo

// ── API ───────────────────────────────────────────────────────────────────────

export function getEntries() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch { return []; }
}

export function addEntry(type, summary) {
    if (!summary || summary.length < 3) return;
    const entries = getEntries();
    entries.push({
        type,
        summary: summary.trim().substring(0, 120),
        ts: Date.now(),
        date: new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })
    });
    if (entries.length > MAX_ENTRIES) entries.shift();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    log(`Diario: [${type}] "${summary.substring(0, 40)}"`);
}

export function getRecentEntries(n = 5) {
    const entries = getEntries();
    return entries.slice(-n);
}

export function getEntriesByType(type, n = 3) {
    return getEntries().filter(e => e.type === type).slice(-n);
}

// ── Ron recuerda algo del diario espontáneamente ─────────────────────────────

export async function ronRemembersSomething() {
    const entries = getEntries();
    if (entries.length < 2) return false; // necesita historial mínimo

    const entry = entries[Math.floor(Math.random() * entries.length)];
    if (!entry) return false;

    const name = RonState.currentUser || 'amiga';
    const daysSince = Math.max(0, Math.round((Date.now() - entry.ts) / 86400000));
    const when = daysSince === 0 ? 'antes' : daysSince === 1 ? 'ayer' : `hace ${daysSince} días`;

    const recalls = [
        `¡Bip! ${name}, ¿te acuerdas de ${when} cuando ${entry.summary}? Eso está en mi memoria favorita.`,
        `Datos de memoria: ${when} ${entry.summary}. ¡Fue genial!`,
        `${name}, acabo de revisar mi historial y encontré: "${entry.summary.substring(0, 40)}". ¡${when.charAt(0).toUpperCase() + when.slice(1)}!`,
    ];

    setExpression('happy');
    await speak(recalls[Math.floor(Math.random() * recalls.length)]);
    return true;
}

// ── Registrar eventos automáticamente (llamado desde otros módulos) ───────────

export function logGame(gameName) {
    addEntry('game', `jugasteis a ${gameName}`);
}

export function logStory(protagonist) {
    addEntry('story', `Ron contó una historia de aventuras con ${protagonist}`);
}

export function logSelfie() {
    addEntry('selfie', `hicisteis una selfie juntos`);
}

export function logMusic(song) {
    addEntry('music', `pusisteis música de ${song}`);
}

export function logLearnt(fact) {
    addEntry('learnt', `${RonState.currentUser || 'tú'} le enseñó a Ron: ${fact}`);
}

// ── Formato de resumen para inyectar en el prompt ────────────────────────────

export function getDiarySummary(n = 4) {
    const recent = getRecentEntries(n);
    if (recent.length === 0) return '';
    return `Aventuras recientes: ${recent.map(e => `${e.date}: ${e.summary}`).join('. ')}.`;
}

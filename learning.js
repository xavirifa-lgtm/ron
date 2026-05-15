// learning.js - Aprendizaje en tiempo real de Ron
import { RonState, log } from './core.js';
import { speak } from './speech.js';
import { setExpression } from './ui.js';
import { logLearnt } from './diary.js';

const STORAGE_KEY = 'ron_learnt_facts';
const MAX_FACTS   = 30;

export function getFacts() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch { return []; }
}

export function addFact(fact) {
    if (!fact || fact.length < 3) return false;
    const clean  = fact.trim().replace(/[<>]/g, '').substring(0, 100);
    const normal = clean.toLowerCase().replace(/\s+/g, ' ');
    const facts  = getFacts();

    // BUG FIX: comparar cadena completa normalizada, no solo los primeros 20 chars
    if (facts.some(f => f.toLowerCase().replace(/\s+/g, ' ') === normal)) return false;

    facts.push(clean);
    if (facts.length > MAX_FACTS) facts.shift();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(facts));
    log(`Aprendido: "${clean}"`);
    return true;
}

export function clearFacts() {
    localStorage.removeItem(STORAGE_KEY);
}

export function detectLearningMoment(text) {
    const teachPatterns = [
        /^(?:ron[,\s]+)?(?:un|una|el|la|los|las)\s+\w+\s+(?:es|son|sirve|sirven)\s+(.{5,80})/i,
        /^(?:ron[,\s]+)?(?:tienes? que saber|aprende que|recuerda que|fíjate que)\s*:?\s*(.{5,80})/i,
        /^(?:es que|pues|o sea|lo que pasa es que)\s+(.{8,80})/i,
        /^(?:ron[,\s]+)?(?:te explico|te cuento|mira ron|escucha)[,:\s]+(.{5,80})/i,
        /^(?:¿sabes(?: que)?|¿sabías(?: que)?)\s+(.{8,80})\??$/i,
    ];
    for (const pat of teachPatterns) {
        const m = text.match(pat);
        if (m?.[1]?.trim().length >= 5) {
            return m[1].trim().replace(/[¿?¡!]+$/, '');
        }
    }
    return null;
}

export async function ronLearns(fact) {
    const saved = addFact(fact);
    if (saved) logLearnt(fact);
    const count = getFacts().length;

    if (!saved) {
        await speak(`¡Bip! Eso ya lo tenía grabado. Sé ${count} cosas gracias a ti.`);
        return;
    }

    setExpression('star');
    // BUG FIX: Math.max(0, ...) para evitar porcentaje negativo
    const ignorance = Math.max(0, 100 - count * 2);
    const reactions = [
        `¡Dato nuevo grabado! Ya sé ${count} cosas gracias a ti.`,
        `¡Bip! Descargando... hecho. "${fact.substring(0, 25)}${fact.length > 25 ? '...' : ''}". ¡Archivado!`,
        `¡No lo sabía! Ahora sí. Mi disco duro crece gracias a ti.`,
        `¡Bop! ${count} datos aprendidos. Sigo siendo ${ignorance}% ignorante, pero mejoro.`,
        `"${fact.substring(0, 22)}${fact.length > 22 ? '...' : ''}". Memoria permanente. ¡Gracias!`,
    ];
    await speak(reactions[Math.floor(Math.random() * reactions.length)]);
}

export function getRecentFacts(n = 8) {
    return getFacts().slice(-n);
}

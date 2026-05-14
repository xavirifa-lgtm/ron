// friendship.js - La Pizarra de Amistad de Ron
// En la película, Barney le enseña a Ron qué es ser amigo con una pizarra de reglas.
// Ron las sigue al pie de la letra (con resultados caóticos y entrañables).
// Este módulo gestiona esas reglas, cómo se enseñan y cómo Ron las aplica.

import { RonState, log } from './core.js';
import { setExpression } from './ui.js';
import { speak } from './speech.js';

const STORAGE_KEY  = 'ron_friendship_rules';
const MAX_RULES    = 12;

// ── API pública ───────────────────────────────────────────────────────────────

export function getRules() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch {
        return [];
    }
}

export function addRule(rule) {
    if (!rule || rule.length < 3) return false;
    const rules = getRules();
    const clean = rule.trim()
        .replace(/[<>]/g, '')      // evitar HTML injection
        .substring(0, 100);         // limitar longitud
    if (rules.includes(clean)) return false; // no duplicar
    rules.push(clean);
    if (rules.length > MAX_RULES) rules.shift(); // FIFO si llega al límite
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
    log(`Pizarra: nueva regla guardada → "${clean}"`);
    return true;
}

export function deleteRule(index) {
    const rules = getRules();
    if (index < 0 || index >= rules.length) return false;
    rules.splice(index, 1);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
    return true;
}

export function clearAllRules() {
    localStorage.removeItem(STORAGE_KEY);
    log("Pizarra de amistad borrada.");
}

// ── Mostrar pizarra en pantalla ───────────────────────────────────────────────
export function showFriendshipBoard(targetElement) {
    const rules = getRules();
    if (!targetElement) return;

    if (rules.length === 0) {
        targetElement.innerHTML =
            `<div style="font-size:clamp(18px,5vw,26px);font-weight:700;color:#111;line-height:1.5">` +
            `📋 Pizarra vacía<br>` +
            `<span style="font-size:clamp(14px,3.5vw,18px);font-weight:400;color:#555">` +
            `Enséñame las reglas de la amistad</span></div>`;
    } else {
        const html = rules.map((r, i) =>
            `<div style="font-size:clamp(15px,4vw,20px);font-weight:600;color:#111;` +
            `padding:4px 0;border-bottom:1px solid rgba(0,0,0,0.08);line-height:1.4">` +
            `<span style="color:#00aacc;font-size:0.85em;margin-right:6px">${i + 1}.</span>${r}` +
            `</div>`
        ).join('');
        targetElement.innerHTML =
            `<div style="font-size:clamp(13px,3.5vw,16px);font-weight:700;color:#888;` +
            `letter-spacing:1px;margin-bottom:10px;text-transform:uppercase">` +
            `📋 Reglas de Amistad</div>` + html;
    }
}

// ── Reacción de Ron al recibir una regla nueva ────────────────────────────────
export async function ronReceivesRule(rule) {
    const saved = addRule(rule);
    const rules = getRules();

    if (!saved) {
        // Regla duplicada — Ron lo nota literalmente
        await speak(`¡Bip! Esa regla ya está en mi disco duro. Tengo ${rules.length} reglas guardadas.`);
        return;
    }

    setExpression('star');

    // Reacciones de Ron al aprender una regla — variadas y literales
    const reactions = [
        `¡Bip bip! Regla número ${rules.length} guardada. Procesando... ¡Entendido!`,
        `Friendship.exe actualizado. Nueva regla: "${rule.substring(0, 30)}${rule.length > 30 ? '...' : ''}". ¡Gracias!`,
        `¡Bop! ¡Eso es muy importante! Lo he grabado en mi memoria principal.`,
        `¡Bip! Descargando regla de amistad número ${rules.length}. ¡Mi pizarra crece!`,
        `"${rule.substring(0, 25)}${rule.length > 25 ? '...' : ''}". Guardado. ¡Ahora soy un ${rules.length}% mejor amigo!`
    ];

    await speak(reactions[Math.floor(Math.random() * reactions.length)]);

    // Mostrar la pizarra actualizada brevemente
    if (RonState.ui.gamePanel && RonState.ui.gameText) {
        showFriendshipBoard(RonState.ui.gameText);
        RonState.ui.gamePanel.classList.remove('hidden');
        setTimeout(() => {
            if (RonState.ui.gamePanel) RonState.ui.gamePanel.classList.add('hidden');
        }, 6000);
    }
}

// ── Ron cita una regla de la pizarra espontáneamente ─────────────────────────
// Llamada desde ai.js en situaciones relevantes
export function getRuleForSituation(situationKeywords) {
    const rules = getRules();
    if (rules.length === 0) return null;

    // Intentar encontrar una regla relevante por palabras clave
    const t = situationKeywords.toLowerCase();
    const relevant = rules.filter(r => {
        const rLow = r.toLowerCase();
        return (
            (t.includes('triste') && rLow.match(/triste|animar|ayudar|apoyo/)) ||
            (t.includes('enfad')  && rLow.match(/enfad|discutir|pelea|malo/)) ||
            (t.includes('miedo')  && rLow.match(/miedo|asust|proteg/)) ||
            (t.includes('jugar')  && rLow.match(/jugar|divert|juntos/)) ||
            (t.includes('mentir') && rLow.match(/mentir|verdad|honesto/))
        );
    });

    // Si hay una relevante, devolverla; si no, una aleatoria
    const pool = relevant.length > 0 ? relevant : rules;
    return pool[Math.floor(Math.random() * pool.length)];
}

// ── Detectar si el usuario está enseñando una regla ──────────────────────────
// Devuelve la regla extraída o null si no es una instrucción de amistad
export function detectFriendshipLesson(text) {
    const t = text.toLowerCase().trim();

    // Patrones que indican que el niño está enseñando una regla
    const teachPatterns = [
        /^(?:ron[,\s]+)?(?:los amigos|una regla|regla de amistad|la regla)[:\s]+(.+)/i,
        /^(?:ron[,\s]+)?(?:aprende que|recuerda que|tienes que saber que)[:\s]+(.+)/i,
        /^(?:ron[,\s]+)?(?:los amigos (?:siempre|nunca|deben|tienen que))\s+(.+)/i,
        /^(?:te enseño[:\s]+|te digo una regla[:\s]+|anota[:\s]+)(.+)/i,
        /^(?:ser amigos significa[:\s]+|la amistad es[:\s]+)(.+)/i,
    ];

    for (const pattern of teachPatterns) {
        const match = text.match(pattern);
        if (match && match[1] && match[1].trim().length > 4) {
            return match[1].trim();
        }
    }

    // Frase directa tipo "los amigos se ayudan"
    if (t.match(/^(?:ron[,\s]+)?(?:los amigos|ser amigo|la amistad)\s+(?:se |no |siem|nunca|debe)/)) {
        const clean = text.replace(/^(?:ron[,\s]+)?/i, '').trim();
        if (clean.length > 8) return clean;
    }

    return null;
}

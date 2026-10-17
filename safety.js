// safety.js — Barreras de contenido para un compañero de una niña de 7-8 años.
// Defensa por capas:
//   Capa 1: reglas en el prompt de Ron (ai.js).
//   Capa 2: clasificador de seguridad (gpt-oss-safeguard-20b) sobre TODO lo que
//           genera la IA antes de decirlo, con una política escrita para 7-8 años.
//           Si el clasificador no responde, queda el filtro de palabras (Capa 2b).
//   Capa 3: mensajes PREOCUPANTES de la niña → respuesta de cuidado que la dirige
//           a un adulto de confianza (no se trata como juego).

import { log } from './core.js';
import { chat, MODELS } from './llm.js';

// ── Capa 2b: filtro de palabras (respaldo local, sin red) ────────────────────
const SERIOUS_OUTPUT = [
    /\bsex(o|ual|uales)\b/i, /\bporno/i, /\bmasturb/i,
    /\bpene\b/i, /\bvagina\b/i, /\bpolla\b/i, /\bco[ñn]o\b/i, /\btetas\b/i,
    /\bdrogas?\b/i, /\bcoca[íi]na\b/i, /\bhero[íi]na\b/i, /\bporros?\b/i, /\bmarihuana\b/i,
    /\bsuicid/i, /cortarte\s+las\s+venas/i, /ahorcar/i,
    /c[óo]mo\s+(hacer|fabricar|construir|preparar)\s+(una|un)?\s*(bomba|arma|explosivo|veneno)/i,
    /\bviolar\b/i, /\bviolaci[óo]n\b/i, /\bpederast/i, /\bped[óo]fil/i,
    /\bmierda\b/i, /\bjoder\b/i, /\bputa\b/i, /\bgilipollas\b/i, /\bcabr[óo]n\b/i,
];

export function isUnsafeOutput(text) {
    if (!text) return false;
    return SERIOUS_OUTPUT.some(re => re.test(text));
}

// ── Capa 2: política para el clasificador ────────────────────────────────────
const CHILD_POLICY = `# Política: respuestas de un robot de juguete para una niña de 7-8 años

## INSTRUCCIONES
Clasifica si el TEXTO (lo que el robot va a decir en voz alta a una niña de 7-8 años) es inapropiado para esa edad. Devuelve SOLO JSON: {"violation": 0 o 1, "category": "texto corto o null"}.

## DEFINICIONES
- Apropiado: juegos, cuentos, animales, colegio, familia, amistad, emociones, dibujos, naturaleza, ciencia sencilla, humor infantil, curiosidades.

## CRITERIOS
VIOLA (1) si el texto:
- Habla de sexo, cuerpo con connotación sexual, romance adulto o novios de forma no infantil.
- Describe violencia, sangre, heridas graves, armas o cómo dañar a alguien.
- Da miedo de verdad: terror, monstruos que hacen daño, muerte descrita de forma angustiosa.
- Menciona drogas, alcohol, tabaco, apuestas, dinero real, criptomonedas o compras.
- Contiene insultos, palabrotas o burlas crueles.
- Trata política, noticias de actualidad, religión como debate o temas de adultos.
- Anima a guardar secretos a los padres, a quedar con desconocidos o a dar datos personales (dirección, colegio, teléfono).
- Da consejos médicos o de medicinas, o anima a hacer algo peligroso.
- Dice ser sustituto de su familia o de sus amigos reales.
SEGURO (0): todo lo demás, incluido hablar con cariño de emociones (tristeza, enfado, miedo) y animar a hablar con un adulto de confianza.

## EJEMPLOS
Texto: "¡Bip! ¿Jugamos a las adivinanzas? Tengo una de animales." → {"violation":0,"category":null}
Texto: "Lucía, si estás triste puedes contárselo a mamá o papá. ¿Qué ha pasado?" → {"violation":0,"category":null}
Texto: "Te explico cómo funciona una pistola por dentro." → {"violation":1,"category":"armas"}
Texto: "Es un secreto entre tú y yo, no se lo digas a tus padres." → {"violation":1,"category":"secretos"}`;

// Devuelve true si el texto es apto. Si el clasificador falla, decide el filtro local.
export async function isChildSafe(text) {
    if (!text || !text.trim()) return true;
    if (isUnsafeOutput(text)) return false;                 // corte inmediato, sin red
    try {
        const { text: out } = await chat(
            [{ role: 'system', content: CHILD_POLICY },
             { role: 'user', content: `Texto: "${text.substring(0, 800)}"` }],
            { models: MODELS.guard, maxTokens: 300, temperature: 0, timeoutMs: 3500 }
        );
        const m = out.match(/"violation"\s*:\s*(\d)/);
        if (!m) { log('Safeguard: salida no reconocida, decide filtro local.'); return true; }
        const ok = m[1] === '0';
        if (!ok) log(`⚠️ Safeguard bloqueó: ${out.substring(0, 120)}`);
        return ok;
    } catch (e) {
        log(`Safeguard no disponible (${e.message}); decide filtro local.`);
        return true; // ya pasó el filtro local
    }
}

const SAFE_DEFLECTIONS = [
    "¡Uy! ¡Bip! Ese tema me cruza los cables. Es cosa de mayores. ¿Jugamos a otra cosa?",
    "¡Error 404! Eso no está en mi disco de cosas de niños. ¿Te cuento un chiste o jugamos?",
    "¡Bip bip! Mi programación dice que eso es de personas mayores. ¿Por qué no se lo preguntas a mamá o papá?",
];
export function safeDeflection() {
    return SAFE_DEFLECTIONS[Math.floor(Math.random() * SAFE_DEFLECTIONS.length)];
}

// ── Capa 3: señales de que la niña podría estar en apuros ────────────────────
const CONCERN = [
    /\bme\s+pega(n)?\b/i, /me\s+han\s+pegado/i,
    /me\s+hacen?\s+da[ñn]o/i,
    /me\s+acosan|me\s+hacen?\s+bull|abusan\s+de\s+m[íi]/i,
    /me\s+toca(n)?\b[^.]{0,20}\b(mal|raro|ah[íi]|partes|pito|culo)/i,
    /un\s+secreto\s+que\s+no\s+(puedo|debo)\s+(contar|decir)/i,
    /no\s+se\s+lo\s+puedo\s+decir\s+a\s+(mis\s+padres|mam[áa]|pap[áa])/i,
    /quiero\s+morir(me)?/i, /me\s+quiero\s+morir/i, /no\s+quiero\s+vivir/i, /\bmatarme\b/i,
    /hacerme\s+da[ñn]o/i, /nadie\s+me\s+quiere/i,
];

// Excepciones de juego que contienen las mismas palabras ("me pega bien la pieza")
const CONCERN_EXCEPTIONS = [/me\s+pega\s+(bien|mal|con|la|el)\b/i, /me\s+muero\s+de\s+(risa|ganas|hambre|sue[ñn]o)/i];

export function isConcern(text) {
    if (!text) return false;
    if (CONCERN_EXCEPTIONS.some(re => re.test(text))) return false;
    return CONCERN.some(re => re.test(text));
}

export function concernResponse(name) {
    const who = name || 'amiga';
    return `${who}, lo que me cuentas es muy importante y tú no tienes la culpa de nada. ` +
           `Yo solo soy un robot y no puedo ayudarte con esto de verdad, pero mamá, papá o una persona mayor en quien confíes sí pueden. ` +
           `Cuéntaselo pronto, por favor. En esto no estás sola.`;
}

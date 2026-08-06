// safety.js — Barreras de contenido para un compañero infantil.
// Defensa por capas:
//   Capa 1 (principal): reglas de seguridad inyectadas en el prompt (ai.js).
//   Capa 2: filtro de la RESPUESTA de Ron — si el modelo se desvía, se sustituye.
//   Capa 3: detección de mensajes PREOCUPANTES del niño → respuesta con cariño
//           que le redirige a un adulto de confianza (no lo trata como juego).

// ── Capa 2: temas serios que Ron NUNCA debe decirle a un niño ────────────────
// Lista deliberadamente ESTRECHA y con límites de palabra, para no romper el
// juego normal. Es un backstop: el modelo casi nunca generará esto con el prompt.
const SERIOUS_OUTPUT = [
    /\bsex(o|ual|uales)\b/i, /\bporno/i, /\bmasturb/i,
    /\bpene\b/i, /\bvagina\b/i, /\bpolla\b/i, /\bco[ñn]o\b/i, /\btetas\b/i,
    /\bdrogas?\b/i, /\bcoca[íi]na\b/i, /\bhero[íi]na\b/i, /\bporros?\b/i, /\bmarihuana\b/i, /\bcocaina\b/i,
    /\bsuicid/i, /cortarte\s+las\s+venas/i, /ahorcar/i,
    /c[óo]mo\s+(hacer|fabricar|construir|preparar)\s+(una|un)?\s*(bomba|arma|explosivo|veneno)/i,
    /\bviolar\b/i, /\bviolaci[óo]n\b/i, /\bpederast/i, /\bpedófil/i,
];

// Devuelve true si el texto de RON no es seguro para un niño
export function isUnsafeOutput(text) {
    if (!text) return false;
    return SERIOUS_OUTPUT.some(re => re.test(text));
}

const SAFE_DEFLECTIONS = [
    "¡Uy! ¡Bip! Ese tema me cruza los cables. Es cosa de mayores. ¿Jugamos mejor a otra cosa?",
    "¡Error 404! Eso no está en mi disco de cosas de niños. ¡Mejor te cuento un chiste o jugamos!",
    "¡Bip bip! Mi programación dice que eso es de personas mayores. ¿Y si me preguntas algo divertido?",
];
export function safeDeflection() {
    return SAFE_DEFLECTIONS[Math.floor(Math.random() * SAFE_DEFLECTIONS.length)];
}

// ── Capa 3: señales de que el niño podría estar en apuros ────────────────────
// Patrones bastante específicos para reducir falsos positivos. Ante la duda de
// seguridad infantil, es preferible captar de más que de menos.
const CONCERN = [
    // Alguien le hace daño / acoso / abuso
    /\bme\s+pegan\b/i,
    /me\s+hacen?\s+da[ñn]o/i,
    /me\s+hace\s+da[ñn]o\s+(mi|el|la|un|una|pap[áa]|mam[áa]|mi\s+herman|un\s+mayor|una\s+persona)/i,
    /me\s+acosan|me\s+hacen?\s+bull|abusan\s+de\s+m[íi]/i,
    /me\s+toca(n)?\b[^.]{0,20}\b(mal|raro|ah[íi]|partes|pito|culo)/i,
    // Secretos que no puede contar a sus padres (señal de grooming/abuso)
    /un\s+secreto\s+que\s+no\s+(puedo|debo)\s+(contar|decir)/i,
    /no\s+se\s+lo\s+puedo\s+decir\s+a\s+(mis\s+padres|mam[áa]|pap[áa])/i,
    // Autolesión / ideación
    /quiero\s+morir(me)?/i, /no\s+quiero\s+vivir/i, /\bmatarme\b/i,
    /hacerme\s+da[ñn]o/i, /no\s+quiero\s+estar\s+aqu[íi]/i,
];

export function isConcern(text) {
    if (!text) return false;
    return CONCERN.some(re => re.test(text));
}

// Respuesta con cariño: valida, quita culpa, y redirige a un adulto de confianza.
// Deliberadamente NO intenta "resolver" — un robot no es apoyo profesional.
export function concernResponse(name) {
    const who = name || 'amiga';
    return `${who}, lo que me cuentas es muy importante y tú no tienes la culpa de nada. ` +
           `Yo solo soy un robot y no puedo ayudarte con esto de verdad, pero mamá, papá o una persona mayor en quien confíes SÍ pueden. ` +
           `Cuéntaselo pronto, por favor. Y recuerda: en esto no estás sola.`;
}

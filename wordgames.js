// wordgames.js — Juegos de palabras de verdad (v30)
// Antes solo se le pedía a la IA que "dirigiera" estos juegos: el secreto no se guardaba
// en ningún sitio y la IA no recordaba qué animal había pensado. Ahora cada juego tiene su
// estado (secreto, turnos, pistas) en el código, y la IA solo pone la gracia de las frases.
//
// Juegos: adivina el animal (piensa Ron) · yo adivino tu animal (piensa ella) ·
//         adivina el número · adivinanzas · trabalenguas · veo veo (con la cámara)

import { RonState, RonConfig, log, changeState, rememberTurn } from './core.js';
import { setExpression } from './ui.js';
import { speak } from './speech.js';
import { chat, chatVision, MODELS } from './llm.js';
import { parseSpokenNumber } from './numbers.js';
import { isUnsafeOutput } from './safety.js';
import { logGame } from './diary.js';
import { addBond } from './bond.js';

const name = () => RonState.currentUser || 'amiga';
const pick = a => a[Math.floor(Math.random() * a.length)];
export const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zñ0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const has = (text, word) => new RegExp(`(^|\\s)${norm(word)}(s|es)?(\\s|$)`).test(norm(text));
const GAME_TIMEOUT_MS = 4 * 60000;      // sin hablar 4 min → se da por terminado

// ── Contenido ────────────────────────────────────────────────────────────────
const ANIMALS = ['perro', 'gato', 'elefante', 'jirafa', 'león', 'tigre', 'mono', 'delfín', 'ballena', 'tortuga', 'conejo',
    'caballo', 'vaca', 'cerdo', 'oveja', 'gallina', 'pato', 'pingüino', 'oso', 'panda', 'cebra', 'canguro', 'koala', 'rana',
    'mariposa', 'abeja', 'hormiga', 'búho', 'loro', 'pez', 'pulpo', 'caracol', 'ardilla', 'ratón', 'cocodrilo', 'hipopótamo',
    'camello', 'flamenco', 'lobo', 'zorro', 'erizo', 'foca', 'cangrejo', 'mariquita'];

// Adivinanzas tradicionales para niños (respuestas aceptadas + pista)
const RIDDLES = [
    { q: 'Blanca por dentro, verde por fuera. Si quieres que te lo diga, espera.', a: ['pera'], hint: 'Es una fruta.' },
    { q: 'Tiene dientes y no come, tiene barba y no es hombre.', a: ['ajo'], hint: 'Se usa en la cocina y huele muy fuerte.' },
    { q: 'Vuela sin alas, silba sin boca, y no lo puedes ver.', a: ['viento', 'aire'], hint: 'Mueve las hojas de los árboles.' },
    { q: 'Tengo agujas y no sé coser, tengo números y no sé leer.', a: ['reloj'], hint: 'Te dice la hora.' },
    { q: 'Cuanto más me mojo, más te seco.', a: ['toalla'], hint: 'La usas al salir de la ducha.' },
    { q: 'Tiene ojos y no ve, tiene agua y no la bebe, es duro por fuera y blanco por dentro.', a: ['coco'], hint: 'Es una fruta de las palmeras.' },
    { q: 'Siempre te sigo, pero si apagas la luz, desaparezco.', a: ['sombra'], hint: 'Es oscura y tiene tu misma forma.' },
    { q: 'Tengo hojas y no soy árbol, tengo lomo y no soy caballo.', a: ['libro', 'cuento'], hint: 'Lo abres para leer.' },
    { q: 'Salgo de noche, brillo en el cielo y no soy la luna.', a: ['estrella'], hint: 'Hay muchísimas y parpadean.' },
    { q: 'Es el rey de la selva, tiene melena y ruge muy fuerte.', a: ['leon'], hint: 'Es un felino muy grande.' },
    { q: 'Tiene el cuello larguísimo, manchas por todo el cuerpo y come hojas de los árboles altos.', a: ['jirafa'], hint: 'Vive en África.' },
    { q: 'Salta y salta, y la colita le falta.', a: ['rana'], hint: 'Es verde y hace croac.' },
    { q: 'Lleva su casa a cuestas y va muy despacito.', a: ['caracol', 'tortuga'], hint: 'Deja un rastro brillante.' },
    { q: 'Me pongo delante de tus ojos y te ayudo a ver mejor.', a: ['gafas', 'lentes'], hint: 'Se apoyan en la nariz.' },
    { q: 'Cae del cielo, moja la tierra y hace charcos.', a: ['lluvia', 'agua'], hint: 'Necesitas un paraguas.' },
    { q: 'Es blanca y fría, cae en invierno y con ella haces muñecos.', a: ['nieve'], hint: 'Cae en las montañas.' },
    { q: 'Tiene teclas blancas y negras y hace música.', a: ['piano'], hint: 'Es un instrumento.' },
    { q: 'Da leche, hace muuu y vive en el campo.', a: ['vaca'], hint: 'Tiene manchas blancas y negras.' },
    { q: 'Está en el cielo, es amarillo y nos da luz y calor de día.', a: ['sol'], hint: 'Por la noche se esconde.' },
    { q: 'Tengo cuatro patas y no ando, tengo respaldo y te sientas en mí.', a: ['silla'], hint: 'Está junto a la mesa.' },
    { q: 'Tengo cola y no soy perro, el viento me sube muy alto.', a: ['cometa'], hint: 'La sujetas con un hilo.' },
    { q: 'Agua pasa por mi casa, cate de mi corazón.', a: ['aguacate'], hint: 'Es verde y con él se hace guacamole.' },
    { q: 'Tiene trompa larga, orejas enormes y es muy, muy grande.', a: ['elefante'], hint: 'Es gris.' },
    { q: 'Tiene alas y plumas, pone huevos y hace pío pío.', a: ['pajaro', 'pollito', 'pollo', 'gallina', 'ave'], hint: 'Hace su nido en los árboles.' },
    { q: 'Me abres para entrar y me cierras para salir.', a: ['puerta'], hint: 'Tiene un pomo o una manilla.' },
];

const TONGUE_TWISTERS = [
    'Tres tristes tigres tragaban trigo en un trigal.',
    'Pablito clavó un clavito. ¿Qué clavito clavó Pablito?',
    'Como poco coco como, poco coco compro.',
    'Pepe Pecas pica papas con un pico.',
    'Mi mamá me mima mucho.',
    'Cuando cuentes cuentos, cuenta cuántos cuentos cuentas.',
    'Erre con erre guitarra, erre con erre barril, rápido ruedan las ruedas del ferrocarril.',
    'El cielo está enladrillado, ¿quién lo desenladrillará?',
];

const FEM = new Set(['jirafa', 'tortuga', 'vaca', 'oveja', 'gallina', 'cebra', 'rana', 'mariposa', 'abeja', 'hormiga', 'ballena', 'ardilla', 'foca', 'mariquita', 'serpiente']);
const art = a => (FEM.has(norm(a)) || /a$/.test(norm(a)) && !/(panda|koala|tigre|delfin|pulpo|camello|flamenco)$/.test(norm(a))) ? 'una' : 'un';

export const GAME_NAMES = {
    animal: 'adivina el animal', tuAnimal: 'yo adivino tu animal', numero: 'adivina el número',
    adivinanzas: 'adivinanzas', trabalenguas: 'trabalenguas', veoveo: 'veo veo',
    tablas: 'las tablas',          // lo arranca ai.js (tablas.js), no este módulo
};

// ── Detección por voz ────────────────────────────────────────────────────────
export function detectGameRequest(text) {
    const t = norm(text);
    if (/adivina (en )?(que|el|cual|mi) animal (que )?(estoy pensando|pienso|he pensado)|yo pienso (en )?un animal|adivina mi animal|tu adivinas (el|mi) animal|piensa(lo)? yo/.test(t)) return 'tuAnimal';
    if (/adivina (el|un|que) animal|adivinar animales|piensa (en )?un animal|juego de (los )?animales|adivinar un animal/.test(t)) return 'animal';
    if (/adivina (el|un|que) numero|piensa (en )?un numero|adivinar (el|un) numero/.test(t)) return 'numero';
    if (/adivinanza|acertijo/.test(t)) return 'adivinanzas';
    if (/trabalengua/.test(t)) return 'trabalenguas';
    if (/veo veo/.test(t)) return 'veoveo';
    return null;
}
export function isGameMenuRequest(text) {
    const t = norm(text);
    return /a que (jugamos|podemos jugar|quieres jugar)|que juegos (sabes|tienes|hay)|juega conmigo|quiero jugar|vamos a jugar$|jugamos$|jugamos a algo|me aburro/.test(t);
}
const EXIT_RE = /\b(no quiero (jugar|seguir)|ya no (quiero|juego)|para(mos)?( de jugar| el juego)?$|basta|dejamos de jugar|deja de jugar|fin del juego|se acabo|otro juego|cambiamos de juego|no juego mas|termina(mos)? el juego)\b/;

export function isActive() {
    const g = RonState.wordGame;
    if (!g) return false;
    if (Date.now() - g.lastTs > GAME_TIMEOUT_MS) { endGame(false); return false; }
    return true;
}

// ── Arranque y fin ───────────────────────────────────────────────────────────
export async function startGame(type) {
    RonState.wordGame = { type, turns: 0, hints: 0, misses: 0, lastTs: Date.now(), startedAt: Date.now() };
    RonState.offeredGame = null;
    changeState('WORD_GAME');
    setExpression('star');
    addBond('game');
    logGame(GAME_NAMES[type] || type);
    log(`Juego: ${GAME_NAMES[type]}`);
    const g = RonState.wordGame;
    switch (type) {
        case 'animal':
            g.secret = pick(ANIMALS);
            return say(`¡Bip! Ya he pensado un animal. Hazme preguntas de sí o no, como: ¿tiene patas? Cuando lo sepas, di: ¿es un…? y el animal.`);
        case 'tuAnimal':
            g.qa = [];
            return say(`¡Bip bip! Piensa un animal y no me lo digas. Yo te hago preguntas y tú contestas sí o no. ¿Preparada? Di: ¡ya!`);
        case 'numero':
            g.secret = 1 + Math.floor(Math.random() * 20);
            return say(`¡Bip! He pensado un número del uno al veinte. Di un número y te diré si es más alto o más bajo.`);
        case 'adivinanzas':
            g.order = [...RIDDLES.keys()].sort(() => Math.random() - 0.5);
            g.idx = 0; g.solved = 0;
            return askRiddle(true);
        case 'trabalenguas':
            g.order = [...TONGUE_TWISTERS.keys()].sort(() => Math.random() - 0.5);
            g.idx = 0;
            return sayTwister(true);
        case 'veoveo':
            return startVeoVeo();
    }
}

export function endGame(silent = true) {
    const g = RonState.wordGame;
    RonState.wordGame = null;
    if (RonState.activityState === 'WORD_GAME') changeState('IDLE');
    if (!silent && g) log(`Juego terminado por inactividad: ${g.type}`);
}

async function say(text) {
    rememberTurn('assistant', text);
    await speak(text, { remember: false });
    if (RonState.wordGame && RonState.activityState === 'IDLE') changeState('WORD_GAME');
}

// Menú: Ron propone 3 juegos; si ella responde solo con el nombre, se arranca
export async function offerMenu() {
    const all = ['animal', 'adivinanzas', 'numero', 'tuAnimal', 'trabalenguas', 'veoveo'];
    const three = all.sort(() => Math.random() - 0.5).slice(0, 3);
    RonState.offeredGame = { options: three, until: Date.now() + 40000 };
    setExpression('star');
    await speak(`¡Bip! Puedo jugar a ${GAME_NAMES[three[0]]}, a ${GAME_NAMES[three[1]]} o a ${GAME_NAMES[three[2]]}. También a sumas, a las tablas de multiplicar o a leer. ¿Cuál quieres?`);
}

// Tras una oferta (menú o propuesta de la IA): "sí", "el primero" o el nombre del juego
export function resolveOffer(text) {
    const o = RonState.offeredGame;
    if (!o || Date.now() > o.until) { RonState.offeredGame = null; return null; }
    const direct = detectGameRequest(text);
    if (direct) return direct;
    const t = norm(text);
    for (const k of o.options) {
        const key = norm(GAME_NAMES[k]).split(' ').pop();          // "animal", "numero", "adivinanzas"...
        if (t.includes(key)) return k;
    }
    if (/\b(primero|primera)\b/.test(t)) return o.options[0];
    if (/\b(segundo|segunda)\b/.test(t)) return o.options[1];
    if (/\b(tercero|tercera|ultimo|ultima)\b/.test(t)) return o.options[2];
    if (o.options.length === 1 && /^(si|vale|venga|claro|ok|vamos|si quiero|bueno)\b/.test(t)) return o.options[0];
    if (/\b(tablas|multiplic\w*)\b/.test(t)) return 'tablas';
    if (/\b(sumas|matematicas|restas)\b/.test(t)) return 'sumas';
    if (/\b(leer|lectura)\b/.test(t)) return 'leer';
    return null;
}

// La IA ha propuesto un juego en su frase → recordarlo para que un "¡sí!" lo arranque
export function noteOfferedInText(ronText) {
    const t = norm(ronText);
    if (!/\?/.test(ronText) && !/jugamos|quieres|te apetece/.test(t)) return;
    const found = [];
    if (/adivina (el|un|que) animal|piensa (en )?un animal/.test(t)) found.push('animal');
    if (/adivinanza/.test(t)) found.push('adivinanzas');
    if (/adivina (el|un) numero/.test(t)) found.push('numero');
    if (/trabalengua/.test(t)) found.push('trabalenguas');
    if (/veo veo/.test(t)) found.push('veoveo');
    if (/tablas?( de multiplicar)?\b|multiplicaciones/.test(t)) found.push('tablas');
    if (found.length) RonState.offeredGame = { options: found, until: Date.now() + 40000 };
}

// ── Turno de juego ───────────────────────────────────────────────────────────
export async function handle(text) {
    const g = RonState.wordGame;
    if (!g) return false;
    g.lastTs = Date.now();
    rememberTurn('user', text);
    const t = norm(text);
    if (EXIT_RE.test(t)) {
        const wantsOther = /otro juego|cambiamos/.test(t);
        endGame();
        setExpression('happy');
        if (wantsOther) return offerMenu();
        await speak(`¡Vale! Ha sido muy divertido, ${name()}. ¡Bip!`);
        return true;
    }
    switch (g.type) {
        case 'animal': return turnAnimal(text, t, g);
        case 'tuAnimal': return turnTuAnimal(text, t, g);
        case 'numero': return turnNumero(text, t, g);
        case 'adivinanzas': return turnRiddle(text, t, g);
        case 'trabalenguas': return turnTwister(text, t, g);
        case 'veoveo': return turnVeoVeo(text, t, g);
    }
    return false;
}

const GIVE_UP = /\b(me rindo|no lo se|no se cual|dimelo|di(me)? (cual|la respuesta)|que era|cual era|la solucion)\b/;
const HINT = /\b(pista|ayuda|ayudame|no se)\b/;

async function win(text) {
    setExpression('star');
    try { (await import('./sounds.js')).playMemorySaveSound?.(); } catch (e) {}
    await say(text);
}

// ── Adivina el animal (piensa Ron) ───────────────────────────────────────────
async function turnAnimal(text, t, g) {
    g.turns++;
    if (GIVE_UP.test(t) && !/\?/.test(text)) {
        endGame(); setExpression('happy');
        return speak(`¡Era ${art(g.secret)} ${g.secret}! ¡Bip! Casi lo tenías. ¿Jugamos otra vez? Di: adivina el animal.`);
    }
    if (has(text, g.secret)) {
        endGame();
        return win(`¡SÍ! ¡Era ${art(g.secret)} ${g.secret}! ¡Lo has adivinado en ${g.turns} preguntas, ${name()}! ¡Eres una detective de animales!`);
    }
    const guessed = ANIMALS.find(a => has(text, a));
    if (guessed) {
        setExpression('surprise');
        return say(pick([`¡No! No es ${art(guessed)} ${guessed}. ¡Sigue preguntando!`, `¡Bip! ${cap(guessed)} no es. ¡Pero vas bien!`, `Mmm, no, no es ${art(guessed)} ${guessed}. ¡Otra pregunta!`]));
    }
    const wantsHint = /\bpista\b/.test(t) || (g.turns % 8 === 0);
    try {
        const sys = `Juegas a "adivina el animal" con una niña de 7 años. El animal secreto es: ${g.secret}. ` +
            `Ella te hace una pregunta. Responde con verdad sobre ese animal real. NUNCA digas el nombre del animal ni palabras que lo delaten del todo. ` +
            `Devuelve SOLO JSON: {"respuesta":"sí"|"no"|"a veces"|"no sé","frase":"respuesta cortita y divertida de robot, máx 15 palabras, que empiece por la respuesta"}` +
            (wantsHint ? ` Añade en "frase" una pista útil pero sin decir el nombre.` : '');
        const { text: raw } = await chat([{ role: 'system', content: sys }, { role: 'user', content: text }],
            { models: MODELS.fast, maxTokens: 200, temperature: 0.4, timeoutMs: 7000, json: true });
        const j = JSON.parse(raw.substring(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
        let frase = String(j.frase || j.respuesta || '').trim();
        if (!frase || has(frase, g.secret) || isUnsafeOutput(frase)) frase = ({ 'sí': '¡Sí!', 'si': '¡Sí!', 'no': '¡No!', 'a veces': 'A veces.', 'no sé': 'Uy, eso no lo sé.' })[norm(j.respuesta)] || '¡Bip! Pregúntamelo de otra forma.';
        return say(frase);
    } catch (e) {
        log('Juego animal: ' + e.message);
        return say('¡Bip! Se me ha cruzado un cable. ¿Me repites la pregunta?');
    }
}
const cap = w => w.charAt(0).toUpperCase() + w.slice(1);

// ── Yo adivino tu animal (piensa ella) ───────────────────────────────────────
export function yesNo(t) {
    if (/\bno (lo )?se\b|ni idea/.test(t)) return 'no sé';
    if (/\b(a veces|mas o menos|un poco|depende)\b/.test(t)) return 'a veces';
    if (/^(si|sii+|claro|exacto|correcto|eso es|afirmativo)\b/.test(t) || (/\bsi\b/.test(t) && !/\bno\b/.test(t))) return 'sí';
    if (/^(no|nop|que no|para nada|nada)\b/.test(t) || /\bno\b/.test(t)) return 'no';
    return null;
}
async function turnTuAnimal(text, t, g) {
    if (g.waitingAnswerReveal) {                         // Ron se rindió: ella dice cuál era
        const a = ANIMALS.find(x => has(text, x)) || norm(text).split(' ').slice(-1)[0];
        endGame(); setExpression('happy');
        return speak(`¡${cap(a)}! ¡Qué bueno! Lo apunto en mi disco duro para la próxima. ¡Bip!`);
    }
    if (g.lastGuess) {
        const yn = yesNo(t);
        if (yn === 'sí') { endGame(); return win(`¡Bip bip bip! ¡LO ADIVINÉ! ¡Era ${art(g.lastGuess)} ${g.lastGuess}! Mis circuitos de detective funcionan.`); }
        g.qa.push({ q: `¿Es ${art(g.lastGuess)} ${g.lastGuess}?`, a: 'no' });
        g.lastGuess = null;
    } else if (g.qa.length === 0 && g.turns === 0) {
        // respuesta al "¿preparada?": cualquier cosa vale para empezar
    } else {
        const yn = yesNo(t);
        if (!yn) return say('¡Bip! Contéstame solo sí o no, porfa. ¿' + (g.lastQuestion || 'Seguimos') + '?');
        g.qa.push({ q: g.lastQuestion, a: yn });
    }
    g.turns++;
    if (g.qa.length >= 16) {
        g.waitingAnswerReveal = true;
        setExpression('sad');
        return say('¡Me rindo! Mis circuitos echan humo. ¿Qué animal era?');
    }
    try {
        const sys = `Juegas a adivinar en qué animal piensa una niña de 7 años, con preguntas de sí o no. Preguntas y respuestas hasta ahora:\n` +
            (g.qa.map(x => `- ${x.q} → ${x.a}`).join('\n') || '(ninguna)') +
            `\nDecide: si estás bastante seguro (o llevas más de 10 preguntas), adivina un animal concreto que encaje con TODO; si no, haz UNA pregunta nueva de sí o no muy sencilla para una niña, que no repita las anteriores. ` +
            `Devuelve SOLO JSON: {"tipo":"pregunta"|"adivino","texto":"la pregunta (máx 12 palabras) o el nombre del animal"}`;
        const { text: raw } = await chat([{ role: 'system', content: sys }, { role: 'user', content: 'Siguiente turno.' }],
            { models: MODELS.chat, maxTokens: 200, temperature: 0.5, timeoutMs: 8000, json: true });
        const j = JSON.parse(raw.substring(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
        if (j.tipo === 'adivino' && j.texto) {
            g.lastGuess = String(j.texto).trim().replace(/^(un|una|el|la)\s+/i, '').replace(/[¿?.!¡]/g, '').toLowerCase();
            return say(`¡Bip! Creo que ya lo sé… ¿Es ${art(g.lastGuess)} ${g.lastGuess}?`);
        }
        g.lastQuestion = String(j.texto || '¿Tiene cuatro patas?').replace(/^¿?/, '').replace(/\?$/, '');
        if (isUnsafeOutput(g.lastQuestion)) g.lastQuestion = 'Tiene cuatro patas';
        return say(`¿${g.lastQuestion}?`);
    } catch (e) {
        log('Juego tu animal: ' + e.message);
        g.lastQuestion = pick(['Tiene cuatro patas', 'Vive en el agua', 'Es más grande que un perro', 'Tiene plumas', 'Vive en la granja']);
        return say(`¿${g.lastQuestion}?`);
    }
}

// ── Adivina el número ────────────────────────────────────────────────────────
async function turnNumero(text, t, g) {
    if (GIVE_UP.test(t) && parseSpokenNumber(text) === null) { endGame(); setExpression('happy'); return speak(`¡Era el ${g.secret}! ¡Bip! ¿Jugamos otra vez?`); }
    const n = parseSpokenNumber(text);
    if (n === null) {
        g.misses++;
        return say(g.misses >= 2 ? '¡Bip! Dime un número del uno al veinte, por ejemplo: doce. O di: paramos.' : '¡Dime un número!');
    }
    g.turns++; g.misses = 0;
    if (n === g.secret) {
        endGame();
        return win(`¡SÍ! ¡Era el ${n}! ¡Lo has adivinado en ${g.turns} ${g.turns === 1 ? 'intento' : 'intentos'}, ${name()}! ¡Bip bip!`);
    }
    if (n < 1 || n > 20) return say('¡Ese se sale! Es del uno al veinte.');
    const dir = n < g.secret ? 'más alto' : 'más bajo';
    return say(pick([`¡No! Es ${dir} que ${n}.`, `Mmm, ${n} no. ¡Más ${dir.split(' ')[1]}!`, `¡Bip! ${dir === 'más alto' ? 'Sube' : 'Baja'}, es ${dir} que ${n}.`]));
}

// ── Adivinanzas ──────────────────────────────────────────────────────────────
async function askRiddle(first = false) {
    const g = RonState.wordGame;
    if (g.idx >= g.order.length) g.idx = 0;
    g.cur = RIDDLES[g.order[g.idx++]];
    g.tries = 0;
    return say(`${first ? '¡Bip! Te digo una adivinanza. ' : ''}${g.cur.q} ¿Qué es?`);
}
async function turnRiddle(text, t, g) {
    if (/\b(otra|siguiente|la siguiente|cambia)\b/.test(t) && !g.cur.a.some(a => has(text, a))) return askRiddle();
    if (g.cur.a.some(a => has(text, a))) {
        g.solved++;
        setExpression('star');
        const praise = pick(['¡CORRECTO!', '¡Sí, señora!', '¡Bip bip! ¡Acertaste!', '¡Exacto!']);
        if (g.solved % 3 === 0) {
            await say(`${praise} ¡Llevas ${g.solved} adivinanzas acertadas! ¿Otra? Di: otra, o: paramos.`);
            return;
        }
        await say(`${praise} ¡Era ${g.cur.a[0]}! Ahí va otra.`);
        return askRiddle();
    }
    if (GIVE_UP.test(t) && !/\bpista\b/.test(t)) {
        await say(`¡Era ${g.cur.a[0]}! ¡Bip! Ahí va otra.`);
        return askRiddle();
    }
    g.tries++;
    if (/\bpista\b/.test(t) || g.tries === 2) return say(`¡Pista! ${g.cur.hint}`);
    if (g.tries >= 4) { await say(`¡Era ${g.cur.a[0]}! Era difícil, ¿eh? Ahí va otra.`); return askRiddle(); }
    return say(pick(['¡Nooo! Piénsalo otra vez.', 'Mmm, no es eso. ¡Prueba otra vez!', '¡Casi! Bueno, no tan casi. ¡Otra vez!']));
}

// ── Trabalenguas ─────────────────────────────────────────────────────────────
async function sayTwister(first = false) {
    const g = RonState.wordGame;
    if (g.idx >= g.order.length) g.idx = 0;
    g.cur = TONGUE_TWISTERS[g.order[g.idx++]];
    return say(`${first ? '¡Bip! A ver si lo dices tan rápido como yo. ' : 'Ahí va otro. '}${g.cur} ¡Te toca!`);
}
async function turnTwister(text, t, g) {
    if (/\b(otro|siguiente)\b/.test(t)) return sayTwister();
    const target = norm(g.cur).split(' ');
    const said = new Set(t.split(' '));
    const hit = target.filter(w => said.has(w)).length / target.length;
    if (hit >= 0.7) { setExpression('star'); await say(pick(['¡PERFECTO! ¡Tu lengua va más rápido que mis engranajes!', '¡Bip! ¡Ni un fallo! ¡Eres la reina de los trabalenguas!'])); return sayTwister(); }
    if (hit >= 0.35) return say('¡Casi! Se te ha trabado un poquito. ¡Otra vez!');
    return say(`¡Jaja! Mi micrófono no lo ha pillado. Escucha: ${g.cur}`);
}

// ── Veo veo (con la cámara) ──────────────────────────────────────────────────
async function startVeoVeo() {
    const g = RonState.wordGame;
    let img = null;
    try { img = (await import('./vision.js')).captureOptimizedFrame(640, 0.8); } catch (e) {}
    if (img) {
        try {
            const sys = 'Mira la imagen y elige UN objeto bien visible y fácil para una niña de 7 años (un juguete, un mueble, una prenda...). No elijas personas ni caras. ' +
                'Devuelve SOLO JSON: {"objeto":"nombre corto en singular, en español","color":"su color principal","pista":"dónde está, en pocas palabras"}';
            const { text } = await chatVision(sys, [], 'Elige el objeto para jugar al veo veo.', img, { maxTokens: 150, json: true });
            const j = JSON.parse(text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1));
            if (j.objeto && !isUnsafeOutput(j.objeto)) {
                g.secret = norm(j.objeto).replace(/^(un|una|el|la)\s+/, '');
                g.secretSay = String(j.objeto).trim().replace(/^(un|una|el|la)\s+/i, '');
                g.color = j.color || ''; g.where = j.pista || '';
                const letter = g.secret.charAt(0).toUpperCase();
                return say(`¡Veo veo! ¿Qué ves? Una cosita… que empieza por la letra ${letter}${g.color ? ` y es de color ${g.color}` : ''}. ¿Qué es?`);
            }
        } catch (e) { log('Veo veo: ' + e.message); }
    }
    // Sin cámara o sin visión: cambiar a adivinanzas
    RonState.wordGame.type = 'adivinanzas';
    g.order = [...RIDDLES.keys()].sort(() => Math.random() - 0.5); g.idx = 0; g.solved = 0;
    await say('¡Bip! Mis ojos no ven bien ahora para el veo veo. ¡Mejor te digo una adivinanza!');
    return askRiddle();
}
async function turnVeoVeo(text, t, g) {
    const main = g.secret.split(' ')[0];
    if (has(text, g.secret) || has(text, main)) { endGame(); return win(`¡SÍ! ¡Lo has encontrado: ${g.secretSay || g.secret}! ¡Tienes ojos de águila, ${name()}!`); }
    if (GIVE_UP.test(t) && !/\bpista\b/.test(t)) { endGame(); setExpression('happy'); return speak(`¡Era esto: ${g.secretSay || g.secret}! ¡Bip! ¿Jugamos otra vez?`); }
    g.turns++;
    if (/\bpista\b/.test(t) || g.turns === 3) return say(g.where ? `¡Pista! Está ${g.where.replace(/^est[aá]\s+/i, '')}.` : `¡Pista! Tiene ${g.secret.length} letras.`);
    if (g.turns >= 7) { endGame(); setExpression('happy'); return speak(`¡Era esto: ${g.secretSay || g.secret}! Estaba difícil. ¿Jugamos otra vez?`); }
    return say(pick(['¡No es eso! Mira bien.', '¡Frío, frío! Busca otra cosa.', 'Mmm, no. ¡Sigue mirando!']));
}

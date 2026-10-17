// identity.js — Caras conocidas y nombres, guardados SOLO en este dispositivo.
// Flujo: cara desconocida estable → Ron pregunta el nombre → lo CONFIRMA ("¿Te
// llamas Lucía?") → guarda varias muestras de la cara bajo ese nombre.
// Cambios respecto a versiones anteriores:
//  - Ya no borra caras de otras personas por parecerse (hermanos, padres).
//  - Ya no renombra a nadie porque diga "soy un dinosaurio" jugando.
//  - Si nadie contesta, el modo aprendizaje caduca y Ron sigue funcionando.

import { RonState, log } from './core.js';
import { speak } from './speech.js';

const FACES_KEY = 'ron_known_faces';
const MAX_SAMPLES = 15;
const LEARN_TIMEOUT_MS = 30000;
const MAX_ATTEMPTS = 3;

const NOT_NAMES = new Set(['si','sí','no','vale','hola','adios','adiós','nada','ron','bip','que','qué',
    'yo','tu','tú','eh','ah','pues','bueno','ok','okay','nombre','llamo','soy','me','mi','una','un','el','la',
    'robot','niña','niño','amiga','amigo','papa','papá','mama','mamá','gracias','perdon','perdón']);
const STOP_AFTER = new Set(['y','de','del','que','tengo','años','vivo','soy','estoy','porque','pero','con','en']);

function save() { localStorage.setItem(FACES_KEY, JSON.stringify(RonState.knownFaces)); }

function cap(w) { return w.charAt(0).toUpperCase() + w.slice(1); }

// Extrae un nombre de lo que dijo la niña. Devuelve null si no hay uno claro.
export function extractName(text) {
    if (!text) return null;
    const t = text.toLowerCase().replace(/[.,!¡?¿;:"]/g, ' ').replace(/\s+/g, ' ').trim()
        .replace(/^(?:hola|ron|bip|pues|bueno|vale|eh)\s+/g, '').replace(/^(?:ron|pues)\s+/g, '');
    const m = t.match(/(?:me llamo|mi nombre es|ll[aá]mame|me dicen|me llaman|soy)\s+([a-záéíóúüñ]+)(?:\s+([a-záéíóúüñ]+))?/);
    let words;
    if (m) {
        words = [m[1]];
        if (m[2] && !STOP_AFTER.has(m[2]) && !NOT_NAMES.has(m[2]) && t.split(' ').length <= 6) words.push(m[2]);
    } else {
        const ws = t.split(' ').filter(w => w && !NOT_NAMES.has(w));
        if (ws.length === 0 || ws.length > 2) return null;   // frase larga sin "me llamo": no es un nombre
        words = ws;
    }
    words = words.filter(w => /^[a-záéíóúüñ]{2,15}$/.test(w) && !NOT_NAMES.has(w));
    if (!words.length) return null;
    return words.map(cap).join(' ');
}

// Ojo: \b no funciona tras letras acentuadas ("sí"), por eso el fin de palabra es explícito
const END = String.raw`(?=$|[\s,.!¡?¿])`;
const YES_RE = new RegExp(String.raw`^\s*(s[ií]|claro|vale|eso|exacto|correcto|afirmativo)` + END, 'i');
const NO_RE  = new RegExp(String.raw`^\s*(no|nop|que no)` + END, 'i');
export function isYes(text) { return YES_RE.test(text); }
export function isNo(text)  { return NO_RE.test(text); }

// Busca la mejor coincidencia sin modificar nada. { label, distance } o null.
export function matchFace(descriptor) {
    if (!RonState.knownFaces.length || typeof faceapi === 'undefined') return null;
    let best = null;
    for (const f of RonState.knownFaces) {
        for (const dd of (f.descriptors || [f.descriptor])) {
            const d = faceapi.euclideanDistance(descriptor, new Float32Array(dd));
            if (!best || d < best.distance) best = { label: f.label, distance: d };
        }
    }
    return best;
}

// Añade muestras a una persona (por nombre). Nunca borra a otras personas.
export function addSamples(name, descriptors) {
    let entry = RonState.knownFaces.find(f => f.label.toLowerCase() === name.toLowerCase());
    if (!entry) { entry = { label: name, descriptors: [] }; RonState.knownFaces.push(entry); }
    entry.descriptors = [...(entry.descriptors || (entry.descriptor ? [entry.descriptor] : [])), ...descriptors].slice(-MAX_SAMPLES);
    delete entry.descriptor;
    save();
    log(`Cara de ${name}: ${entry.descriptors.length} muestras.`);
}

function ensureStats(name) {
    if (!RonState.userStats[name]) RonState.userStats[name] = { likes: [], dislikes: [], history: [] };
    localStorage.setItem('ron_user_stats', JSON.stringify(RonState.userStats));
}

// ── Flujo de aprendizaje ─────────────────────────────────────────────────────
export function startLearning(firstDescriptor) {
    RonState.isLearningFace = true;
    RonState.learningDescriptors = firstDescriptor ? [firstDescriptor] : [];
    RonState.nameFlow = { mode: 'learn', pending: null, attempts: 0, startedAt: Date.now() };
    import('./ui.js').then(ui => ui.startScanningUI());
    speak("¡Bip bip! ¡Un humano nuevo! Yo soy Ron. ¿Cómo te llamas?");
}

// Corrección: "no me llamo Ana, me llamo Lucía" con alguien ya reconocido
export function startRename(newName) {
    RonState.nameFlow = { mode: 'rename', pending: newName, attempts: 0, startedAt: Date.now() };
    return speak(`¡Bip! ¿Entonces te llamas ${newName}? Dime sí o no.`);
}

// Ella dice su nombre sin que Ron pregunte ("me llamo Lucía") y Ron aún no la conoce
export function volunteerName(name, descriptor) {
    RonState.isLearningFace = true;
    RonState.learningDescriptors = descriptor ? [descriptor] : [];
    RonState.nameFlow = { mode: 'learn', pending: name, attempts: 0, startedAt: Date.now() };
    import('./ui.js').then(ui => ui.startScanningUI());
    return speak(`¡Bip! ¿Te llamas ${name}? Dime sí o no, y mírame para que guarde tu cara.`);
}

export function cancelNameFlow(sayIt = false) {
    const wasLearning = RonState.isLearningFace;
    RonState.isLearningFace = false;
    RonState.learningDescriptors = [];
    RonState.nameFlow = null;
    RonState.learnCooldownUntil = Date.now() + 120000;   // no volver a preguntar en 2 min
    import('./ui.js').then(ui => ui.stopScanningUI());
    if (sayIt && wasLearning) speak("¡Vale! Ya me dirás tu nombre luego. ¡Bip!");
}

export function nameFlowExpired() {
    return RonState.nameFlow && (Date.now() - RonState.nameFlow.startedAt > LEARN_TIMEOUT_MS);
}

// Respuesta de la niña mientras Ron está aprendiendo o confirmando un nombre
export async function handleNameReply(text) {
    const flow = RonState.nameFlow;
    if (!flow) return false;
    flow.startedAt = Date.now(); // está contestando: no caducar

    if (flow.pending && isYes(text)) { await commitName(flow.pending); return true; }

    const heard = extractName(text);
    // Frase larga que no es un nombre (quiere jugar, cuenta algo...): no forzar,
    // dejar el nombre para luego y que Ron conteste con normalidad.
    const words = text.trim().split(/\s+/).length;
    if (!heard && !isNo(text) && words > 4) {
        log('Nombre: frase larga sin nombre → se deja para luego.');
        cancelNameFlow(false);
        return false;
    }
    if (flow.pending && isNo(text) && !heard) {
        flow.pending = null;
        flow.attempts++;
        if (flow.attempts >= MAX_ATTEMPTS) { cancelNameFlow(); await speak("¡Bip! Mis oídos fallan hoy. ¡Me lo dices luego!"); return true; }
        await speak("¡Uy, error de audio! ¿Cómo te llamas? Dímelo despacito.");
        return true;
    }
    if (heard) {
        flow.pending = heard;
        await speak(`¿Te llamas ${heard}? Dime sí o no.`);
        return true;
    }
    flow.attempts++;
    if (flow.attempts >= MAX_ATTEMPTS) { cancelNameFlow(); await speak("¡Bip! No lo he pillado. ¡Ya me lo dirás luego!"); return true; }
    await speak(flow.pending ? `¿Sí o no? ¿Te llamas ${flow.pending}?` : "¡Bip! No lo he entendido. Di: me llamo, y tu nombre.");
    return true;
}

async function commitName(name) {
    const flow = RonState.nameFlow;
    if (flow.mode === 'learn') {
        const samples = (RonState.learningDescriptors || []).slice(-10);
        if (!samples.length && RonState.lastDescriptor) samples.push(RonState.lastDescriptor);
        if (!samples.length) { cancelNameFlow(); return speak("¡Bip! No pude ver bien tu cara. ¡Mírame y lo intentamos otra vez!"); }
        addSamples(name, samples);
    } else {
        // Renombrar a la persona actual: mover sus muestras y su memoria
        const old = RonState.currentUser;
        const entry = RonState.knownFaces.find(f => f.label === old);
        if (entry && !RonState.knownFaces.find(f => f.label === name)) entry.label = name;
        else if (entry) { addSamples(name, entry.descriptors || []); RonState.knownFaces = RonState.knownFaces.filter(f => f !== entry); }
        save();
        if (old && RonState.userStats[old] && !RonState.userStats[name]) {
            RonState.userStats[name] = RonState.userStats[old];
            delete RonState.userStats[old];
        }
        try { (await import('./memory.js')).renamePerson(old, name); } catch (e) {}
    }
    ensureStats(name);
    RonState.currentUser = name;
    RonState.conversationOwner = name;
    RonState.userLastSeen = RonState.userLastSeen || {};
    RonState.userLastSeen[name] = Date.now();
    RonState.isLearningFace = false;
    RonState.learningDescriptors = [];
    RonState.nameFlow = null;
    import('./ui.js').then(ui => ui.stopScanningUI());
    import('./sounds.js').then(s => s.playMemorySaveSound && s.playMemorySaveSound()).catch(() => {});
    return speak(flow.mode === 'learn'
        ? `¡Bip! ¡Encantado, ${name}! Tu cara está guardada en mi memoria. La próxima vez te reconoceré.`
        : `¡Hecho! A partir de ahora eres ${name}. ¡Bip!`);
}

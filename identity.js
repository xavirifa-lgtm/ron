// identity.js — Caras conocidas y nombres blindados con Doble Bóveda (localStorage + IndexedDB)
// y sistema de Anclas Permanentes (8 muestras fijas + 10 adaptativas por persona).

import { RonState, log } from './core.js';
import { speak } from './speech.js';

const FACES_KEY = 'ron_known_faces';
const ANCHOR_SAMPLES = 8;
const ADAPTIVE_SAMPLES = 10;
const LEARN_TIMEOUT_MS = 45000;
const MAX_ATTEMPTS = 3;
const FACE_SAMPLES_WANTED = 3;     // muestras buenas de la cara antes de guardar
const FACE_WAIT_MS = 12000;        // tras decir el nombre, tiempo para verle bien la cara

const NOT_NAMES = new Set(['si','sí','no','vale','hola','adios','adiós','nada','ron','bip','que','qué',
    'yo','tu','tú','eh','ah','pues','bueno','ok','okay','nombre','llamo','soy','me','mi','una','un','el','la',
    'robot','niña','niño','amiga','amigo','papa','papá','mama','mamá','gracias','perdon','perdón']);
const STOP_AFTER = new Set(['y','de','del','que','tengo','años','vivo','soy','estoy','porque','pero','con','en']);

// ── BÓVEDA PERMANENTE INDEXEDDB ───────────────────────────────────────────────
const DB_NAME = 'RonPermanentVault';
const STORE_NAME = 'kv';

function openVault() {
    return new Promise((resolve, reject) => {
        if (!('indexedDB' in window)) return reject(new Error('Sin IndexedDB'));
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export async function vaultSet(key, val) {
    try {
        const db = await openVault();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(val, key);
    } catch (e) {}
}

export async function vaultGet(key) {
    try {
        const db = await openVault();
        return await new Promise((resolve) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).get(key);
            req.onsuccess = () => resolve(req.result ?? null);
            req.onerror = () => resolve(null);
        });
    } catch (e) { return null; }
}

(async function restoreFacesFromVault() {
    try {
        const savedFaces = await vaultGet(FACES_KEY);
        if (Array.isArray(savedFaces) && savedFaces.length > (RonState.knownFaces?.length || 0)) {
            RonState.knownFaces = savedFaces;
            localStorage.setItem(FACES_KEY, JSON.stringify(savedFaces));
            log(`Bóveda: restauradas ${savedFaces.length} caras conocidas.`);
        } else if (RonState.knownFaces?.length > 0) {
            await vaultSet(FACES_KEY, RonState.knownFaces);
        }
        const savedStats = await vaultGet('ron_user_stats');
        if (savedStats && Object.keys(savedStats).length > Object.keys(RonState.userStats || {}).length) {
            RonState.userStats = savedStats;
            localStorage.setItem('ron_user_stats', JSON.stringify(savedStats));
        }
    } catch (e) {}
})();

function save() {
    try { localStorage.setItem(FACES_KEY, JSON.stringify(RonState.knownFaces)); } catch (e) {}
    vaultSet(FACES_KEY, RonState.knownFaces);
}

// Muestras recientes de "desconocido" que se parecen a la cara de referencia
// (evita guardar en tu ficha la cara de otra persona que pasó antes por delante)
function similarRecent(ref, maxDist = 0.55) {
    const recent = RonState.recentUnknownDescriptors || [];
    if (!ref || typeof faceapi === 'undefined') return [];
    const r = new Float32Array(ref);
    return recent.filter(d => faceapi.euclideanDistance(r, new Float32Array(d)) < maxDist);
}

function cap(w) { return w.charAt(0).toUpperCase() + w.slice(1); }

// Palabras habituales que NO son nombres (respuestas sueltas durante el alta)
const COMMON_WORDS = new Set(['hazme','haz','dime','cuentame','cuéntame','cuenta','juega','jugar','jugamos','juego','juegos',
    'vamos','quiero','quieres','puedes','puedo','foto','fotos','selfie','chiste','chistes','cuento','cuentos','musica','música',
    'baila','bailar','canta','cantar','mira','mírame','mirame','ayuda','ayudame','ayúdame','como','cómo','donde','dónde',
    'cuando','cuándo','porque','por','favor','tengo','hambre','sueño','oyes','oye','estas','estás','esta','está','bien','mal',
    'muy','genial','guay','perdona','espera','venga','otra','vez','chao','buenas','noches','dias','días','tardes','calla',
    'silencio','apaga','para','sigue','repite','escucha','hablame','háblame','habla','cual','cuál','quien','quién','todo',
    'mucho','poco','ahora','luego','despues','después','tambien','también','vale','gracias','jo','jope','uf','vaya','guau',
    'sumas','restas','matematicas','matemáticas','leer','lectura','escondite','dibujo','dibujar','casa','cole','colegio',
    'mamá','papá','perro','gato','hola','adios','adiós','ron','bip','vale']);
const FILLER = new Set(['hola','ron','pues','bueno','vale','eh','ah','mmm','oye','bip','yo']);

// Extrae un nombre de lo que se ha oído o escrito. Con "me llamo / soy / mi nombre es"
// se fía; con una respuesta suelta solo acepta 1 palabra que no sea común, o 2 palabras
// con la segunda en mayúscula ("Ana María"). Así "hazme un selfie" o "¿me oyes?" no
// acaban guardados como nombre.
export function extractName(text) {
    if (!text) return null;
    const t = text.toLowerCase().replace(/[.,!¡?¿;:"]/g, ' ').replace(/\s+/g, ' ').trim()
        .replace(/^(?:hola|ron|bip|pues|bueno|vale|eh)\s+/g, '').replace(/^(?:ron|pues)\s+/g, '');
    const m = t.match(/(?:me llamo|mi nombre es|ll[aá]mame|me dicen|me llaman|soy)\s+([a-záéíóúüñ]+)(?:\s+([a-záéíóúüñ]+))?/);
    let words;
    if (m) {
        if (NOT_NAMES.has(m[1]) || COMMON_WORDS.has(m[1])) return null;      // "soy un dinosaurio", "me llamo jugar"
        // Con "soy" el nombre debe ir en mayúscula ("Soy Laia"); "soy feliz" no es un nombre
        if (/(?:^|\s)soy\s/.test(t) && !/(?:me llamo|mi nombre es|ll[aá]mame|me dicen|me llaman)/.test(t)
            && !/[Ss]oy\s+[A-ZÁÉÍÓÚÑ]/.test(text)) return null;
        words = [m[1]];
        if (m[2] && !STOP_AFTER.has(m[2]) && !NOT_NAMES.has(m[2]) && !COMMON_WORDS.has(m[2]) && t.split(' ').length <= 6) words.push(m[2]);
    } else {
        const raw = text.replace(/[.,!¡?¿;:"]/g, ' ').trim().split(/\s+/).filter(w => w && !FILLER.has(w.toLowerCase()));
        if (raw.length === 0 || raw.length > 2) return null;
        if (raw.some(w => NOT_NAMES.has(w.toLowerCase()) || COMMON_WORDS.has(w.toLowerCase()))) return null;
        if (raw.length === 2 && !/^[A-ZÁÉÍÓÚÑ]/.test(raw[1])) return null;   // "Ana María" sí; "quiero jugar" no
        words = raw.map(w => w.toLowerCase());
    }
    words = words.filter(w => /^[a-záéíóúüñ]{2,15}$/.test(w) && !NOT_NAMES.has(w));
    if (!words.length) return null;
    return words.map(cap).join(' ');
}

const END = String.raw`(?=$|[\s,.!¡?¿])`;
const YES_RE = new RegExp(String.raw`^\s*(s[ií]|claro|vale|eso|exacto|correcto|afirmativo)` + END, 'i');
const NO_RE  = new RegExp(String.raw`^\s*(no|nop|que no)` + END, 'i');
export function isYes(text) { return YES_RE.test(text); }
export function isNo(text)  { return NO_RE.test(text); }

export function matchFace(descriptor) {
    if (!RonState.knownFaces.length || typeof faceapi === 'undefined') return null;
    let best = null;
    for (const f of RonState.knownFaces) {
        const allDescriptors = f.descriptors || (f.descriptor ? [f.descriptor] : []);
        for (const dd of allDescriptors) {
            const d = faceapi.euclideanDistance(descriptor, new Float32Array(dd));
            if (!best || d < best.distance) best = { label: f.label, distance: d };
        }
    }
    return best;
}

// Distancia mínima a cada persona guardada (modo calibración)
export function distancesTo(descriptor) {
    if (!RonState.knownFaces.length || typeof faceapi === 'undefined') return [];
    return RonState.knownFaces.map(f => {
        let min = Infinity;
        for (const dd of (f.descriptors || (f.descriptor ? [f.descriptor] : []))) {
            min = Math.min(min, faceapi.euclideanDistance(descriptor, new Float32Array(dd)));
        }
        return { label: f.label, distance: +min.toFixed(3), samples: (f.descriptors || []).length };
    }).sort((a, b) => a.distance - b.distance);
}

export function addSamples(name, descriptors) {
    let entry = RonState.knownFaces.find(f => f.label.toLowerCase() === name.toLowerCase());
    if (!entry) {
        entry = { label: name, anchors: [], adaptive: [], descriptors: [] };
        RonState.knownFaces.push(entry);
    }
    if (!Array.isArray(entry.anchors)) {
        const existing = entry.descriptors || (entry.descriptor ? [entry.descriptor] : []);
        entry.anchors = existing.slice(0, ANCHOR_SAMPLES);
        entry.adaptive = existing.slice(ANCHOR_SAMPLES, ANCHOR_SAMPLES + ADAPTIVE_SAMPLES);
    }

    for (const desc of descriptors) {
        if (entry.anchors.length < ANCHOR_SAMPLES) {
            entry.anchors.push(desc);
        } else {
            entry.adaptive.push(desc);
            if (entry.adaptive.length > ADAPTIVE_SAMPLES) entry.adaptive.shift();
        }
    }

    entry.descriptors = [...entry.anchors, ...entry.adaptive];
    delete entry.descriptor;
    save();
    log(`Cara de ${entry.label}: ${entry.anchors.length} fijas + ${entry.adaptive.length} adaptativas.`);
}

function ensureStats(name) {
    if (!RonState.userStats[name]) RonState.userStats[name] = { likes: [], dislikes: [], history: [] };
    try { localStorage.setItem('ron_user_stats', JSON.stringify(RonState.userStats)); } catch (e) {}
    vaultSet('ron_user_stats', RonState.userStats);
}

// ── ALTA DE USUARIO ─────────────────────────────────────────────────────────
// Cara desconocida (o primer arranque sin nadie guardado): Ron pide el nombre.
// Se puede decir en voz alta o escribir en el cuadro de la pantalla. Al recibirlo
// contesta "¡Hola, X!" y guarda nombre + cara (sin preguntar "¿sí o no?").
export function startLearning(firstDescriptor) {
    RonState.isLearningFace = true;
    const pool = similarRecent(firstDescriptor).slice(-6);
    if (firstDescriptor) pool.push(firstDescriptor);
    RonState.learningDescriptors = pool;
    RonState.nameFlow = { mode: 'learn', pending: null, attempts: 0, startedAt: Date.now() };
    import('./ui.js').then(ui => ui.startScanningUI());
    showNamePanel();
    speak("¡Hola! Soy Ron. Introduce tu nombre de usuario: dime cómo te llamas, o escríbelo aquí abajo.");
}

// Primer arranque: si no hay nadie guardado, Ron lo pide aunque aún no vea bien la cara
export function maybeFirstRunOnboarding() {
    if (RonState.knownFaces?.length || RonState.nameFlow) return false;
    if (!['IDLE', 'LISTENING'].includes(RonState.activityState)) return false;
    log('Primer arranque sin usuarios: alta de nombre.');
    startLearning(RonState.lastDescriptor || null);
    return true;
}

// Acepta un nombre (dicho o escrito) dentro del alta
async function acceptName(name) {
    const flow = RonState.nameFlow;
    if (!flow) return;
    flow.pending = name;
    flow.startedAt = Date.now();
    hideNamePanel();
    const samples = RonState.learningDescriptors || [];
    if (samples.length >= FACE_SAMPLES_WANTED || !visionRunning()) return commitName(name);
    // Aún no tiene bien vista la cara: la guarda en cuanto la vea (máx. FACE_WAIT_MS)
    flow.waitFace = Date.now();
    await speak(`¡Hola, ${name}! Mírame de frente un momentito para que guarde tu cara.`);
}

function visionRunning() {      // ¿la cámara está funcionando (aunque ahora no vea a nadie)?
    return Date.now() - (RonState.visionDebug?.loopTs || 0) < 5000;
}

// La llama la visión en cada fotograma mientras hay un alta en curso
export function learningTick() {
    const flow = RonState.nameFlow;
    if (!flow || flow.mode !== 'learn' || !flow.pending || !flow.waitFace) return;
    const n = (RonState.learningDescriptors || []).length;
    if (n >= FACE_SAMPLES_WANTED) { flow.waitFace = 0; commitName(flow.pending); return; }
    if (Date.now() - flow.waitFace > FACE_WAIT_MS) {
        flow.waitFace = 0;
        if (n >= 1) commitName(flow.pending);
        else commitNameOnly(flow.pending);
    }
}

// Sin cara (cámara apagada o no se ve bien): guarda el nombre para hablar con ella
async function commitNameOnly(name) {
    ensureStats(name);
    RonState.currentUser = name;
    RonState.conversationOwner = name;
    RonState.isLearningFace = false;
    RonState.learningDescriptors = [];
    RonState.nameFlow = null;
    RonState.learnCooldownUntil = Date.now() + 120000;
    hideNamePanel();
    import('./ui.js').then(ui => ui.stopScanningUI());
    await speak(`¡Hola, ${name}! No he podido ver bien tu cara. Cuando me mires de frente con luz, dime: aprende mi cara.`);
}

// Nombre escrito en el cuadro de la pantalla
export function submitTypedName(raw) {
    const words = String(raw || '').replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ\s-]/g, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 2);
    const name = words.map(w => cap(w.toLowerCase())).join(' ');
    if (!name || name.length < 2) return false;
    if (!RonState.nameFlow) startLearning(RonState.lastDescriptor || null);
    log(`Nombre escrito: ${name}`);
    acceptName(name);
    return true;
}

function showNamePanel() {
    const p = document.getElementById('name-panel');
    if (!p) return;
    p.classList.remove('hidden');
    const inp = document.getElementById('name-input');
    if (inp) inp.value = '';
}
function hideNamePanel() {
    const p = document.getElementById('name-panel');
    if (p) p.classList.add('hidden');
}

export function startRename(newName) {
    RonState.nameFlow = { mode: 'rename', pending: newName, attempts: 0, startedAt: Date.now() };
    return speak(`¡Bip! ¿Entonces te llamas ${newName}? Dime sí o no.`);
}

export function volunteerName(name, descriptor) {
    RonState.isLearningFace = true;
    const pool = similarRecent(descriptor).slice(-6);
    if (descriptor) pool.push(descriptor);
    RonState.learningDescriptors = pool;
    RonState.nameFlow = { mode: 'learn', pending: null, attempts: 0, startedAt: Date.now() };
    import('./ui.js').then(ui => ui.startScanningUI());
    return acceptName(name);
}

export function cancelNameFlow(sayIt = false) {
    const wasLearning = RonState.isLearningFace;
    RonState.isLearningFace = false;
    RonState.learningDescriptors = [];
    RonState.nameFlow = null;
    RonState.learnCooldownUntil = Date.now() + 90000;
    hideNamePanel();
    import('./ui.js').then(ui => ui.stopScanningUI());
    if (sayIt && wasLearning) speak("¡Vale! Cuando quieras me dices cómo te llamas. ¡Bip!");
}

export function nameFlowExpired() {
    const f = RonState.nameFlow;
    return f && !f.waitFace && (Date.now() - f.startedAt > LEARN_TIMEOUT_MS);
}

export async function handleNameReply(text) {
    const flow = RonState.nameFlow;
    if (!flow) return false;
    if (flow.waitFace) return false;          // ya tiene el nombre; esperando la cara → conversación normal
    // Alta: si es un nombre se guarda; si no (p. ej. "hazme un selfie"), se atiende con
    // normalidad y el alta sigue abierta hasta que caduque (sin reiniciar el plazo).
    if (flow.mode === 'learn') {
        const name = extractName(text);
        if (name) { await acceptName(name); return true; }
        return false;
    }
    flow.startedAt = Date.now();

    if (flow.pending && isYes(text)) { await commitName(flow.pending); return true; }

    const heard = extractName(text);
    const words = text.trim().split(/\s+/).length;
    if (!heard && !isNo(text) && words > 4) {
        log('Nombre: frase larga sin nombre → se deja para luego.');
        cancelNameFlow(false);
        return false;
    }
    if (flow.pending && isNo(text) && !heard) {
        flow.pending = null;
        flow.attempts++;
        if (flow.attempts >= MAX_ATTEMPTS) { cancelNameFlow(); await speak("¡Bip! Mis micrófonos fallan hoy. ¡Me lo dices en un ratito!"); return true; }
        await speak("¡Uy, error de audio! ¿Cómo te llamas? Dímelo despacito.");
        return true;
    }
    if (heard) {
        if (flow.mode === 'learn') { await acceptName(heard); return true; }
        flow.pending = heard;
        await speak(`¿Te llamas ${heard}? Dime sí o no.`);
        return true;
    }
    flow.attempts++;
    if (flow.attempts >= MAX_ATTEMPTS) { cancelNameFlow(); await speak("¡Bip! No lo he pillado bien. ¡Luego me lo cuentas!"); return true; }
    await speak(flow.pending ? `¿Sí o no? ¿Te llamas ${flow.pending}?` : "¡Bip! No lo he entendido. Di: me llamo, y tu nombre.");
    return true;
}

async function commitName(name) {
    const flow = RonState.nameFlow;
    if (flow.mode === 'learn') {
        const learned = RonState.learningDescriptors || [];
        const samples = [...new Set([...similarRecent(learned[0]), ...learned].map(d => JSON.stringify(d)))]
            .map(d => JSON.parse(d)).slice(-12);
        if (!samples.length && RonState.lastDescriptor) samples.push(RonState.lastDescriptor);
        if (!samples.length) return commitNameOnly(name);
        addSamples(name, samples);
        RonState.recentUnknownDescriptors = [];
    } else {
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
    hideNamePanel();
    import('./ui.js').then(ui => ui.stopScanningUI());
    import('./sounds.js').then(s => s.playMemorySaveSound && s.playMemorySaveSound()).catch(() => {});
    return speak(flow.mode === 'learn'
        ? `¡Hola, ${name}! Ya tengo tu nombre y tu cara guardados. ¡Te reconoceré siempre!`
        : `¡Hecho! A partir de ahora eres ${name}. ¡Bip!`);
}
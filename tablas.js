// tablas.js — Tablas de multiplicar por voz (v30.2)
//
// Cómo funciona, pensado para una niña de 7-8 años:
//  · APRENDER: la primera vez con una tabla se pregunta EN ORDEN (3×1, 3×2…) y la tabla se
//    va escribiendo en la pizarra con cada acierto. La pista es la fila anterior: "si 3×3 son 9,
//    3×4 es 9 y 3 más".
//  · PRACTICAR: cuando ya la ha completado una vez, salteada y con más peso para las que fallan.
//    A veces se pregunta al revés (4×3) para que vea que es lo mismo.
//  · MEDALLA: una tabla está "sabida" cuando acierta las 10 dos veces seguidas sin pista.
//  · MEZCLADAS: preguntas de todas las tablas que ya ha practicado.
//  · Si falla tres veces, se le dice la respuesta y esa misma vuelve a salir un poco después.
// El progreso se guarda por persona en el móvil (ron_tablas).

import { RonState, changeState, log } from './core.js';
import { setExpression } from './ui.js';
import { speak } from './speech.js';
import { logGame } from './diary.js';
import { parseAllNumbers } from './numbers.js';

const KEY = 'ron_tablas';
const ORDER = [2, 5, 10, 3, 4, 6, 7, 8, 9, 1];      // de las fáciles a las difíciles
const ROUND = 5;
const MASTER_STREAK = 2;

const who = () => RonState.currentUser || 'amiga';
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// ── Progreso guardado ────────────────────────────────────────────────────────
function loadAll() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } }
function saveAll(all) {
    try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) {}
    import('./identity.js').then(id => id.vaultSet && id.vaultSet(KEY, all)).catch(() => {});
}
function progress(name = who()) {
    const all = loadAll();
    return all[name] || { facts: {}, medals: [], learned: [] };
}
function saveProgress(p, name = who()) { const all = loadAll(); all[name] = p; saveAll(all); }
// Clave de la multiplicación sin importar el orden: 3×4 y 4×3 son la misma
const fkey = (a, b) => `${Math.min(a, b)}x${Math.max(a, b)}`;
function factStat(p, a, b) { return p.facts[fkey(a, b)] || { ok: 0, fail: 0, streak: 0 }; }
function tableMastered(p, t) {
    for (let i = 1; i <= 10; i++) if (factStat(p, t, i).streak < MASTER_STREAK) return false;
    return true;
}
function tableScore(p, t) { let n = 0; for (let i = 1; i <= 10; i++) if (factStat(p, t, i).streak >= MASTER_STREAK) n++; return n; }

export function getTablasSummary(name = who()) {
    const p = progress(name);
    return { medals: [...(p.medals || [])], learned: [...(p.learned || [])],
        scores: Object.fromEntries(ORDER.map(t => [t, tableScore(p, t)])) };
}

// ── ¿Qué tabla ha pedido? "la tabla del 7", "la del siete", "las mezcladas" ──
export function parseTableRequest(text) {
    const t = norm(text);
    if (/mezclad|salteadas|todas las tablas|de todas|revueltas/.test(t)) return 'mix';
    const m = t.match(/\b(?:tablas?|las?)\s+del?\s+(.+)$/);
    if (m) {
        const n = parseAllNumbers(m[1])[0];
        if (n >= 1 && n <= 10) return n;
    }
    return null;
}
export function isTablasRequest(text) {
    const t = norm(text);
    return /\bmultiplic/.test(t) || /\btablas?\s+(de multiplicar|del\s+\S+)/.test(t) ||
        (/\blas tablas\b/.test(t) && /jug|practic|repas|estudi|hacemos|vamos|quiero|toca|ensena|aprend/.test(t));
}

// ── Estado del juego en curso ────────────────────────────────────────────────
// RonState.tablas = { table|'mix', stage:'learn'|'practice', a, b, tries, hinted, done, ok,
//                     nextInOrder, recent:[], retry:[{a,b,in}], awaitingContinue, idle, askedAt }
export const isTablasActive = () => !!RonState.tablas;
export function stopTablas() { RonState.tablas = null; }

function chooseTable(p) {
    for (const t of ORDER) if (!tableMastered(p, t) && t !== 1) return t;
    return 'mix';
}

export async function startTablas(table = null) {
    const p = progress();
    const picked = table || chooseTable(p);
    const stage = picked === 'mix' ? 'practice' : ((p.learned || []).includes(picked) ? 'practice' : 'learn');
    RonState.tablas = { table: picked, stage, done: 0, ok: 0, nextInOrder: 1, recent: [], retry: [],
        awaitingContinue: false, idle: 0, tries: 0, hinted: false, filled: [] };
    changeState('MATH_GAME');
    RonState.ui.gamePanel.classList.remove('hidden');
    logGame(picked === 'mix' ? 'tablas mezcladas' : `tabla del ${picked}`);
    log(`Tablas: ${picked === 'mix' ? 'mezcladas' : 'tabla del ' + picked} (${stage}).`);
    let intro;
    if (picked === 'mix') intro = '¡Bip! ¡Tablas mezcladas! Te pregunto de todas las que has practicado.';
    else if (stage === 'learn') intro = `¡Bip! ¡Vamos con la tabla del ${picked}! Te la pregunto en orden y la voy escribiendo en mi pizarra.`;
    else intro = `¡Bip! ¡Tabla del ${picked}, ahora salteada!${tableMastered(p, picked) ? ' ¡Ya tienes su medalla, a ver si no se te oxida!' : ''}`;
    if (!table) intro += ` Si quieres otra, dime: la del siete, o las mezcladas.`;
    nextQuestion();
    await speak(`${intro} ${questionText()}`);
    keep();
}

function pickPractice(p, g) {
    // ¿Toca repetir una que falló?
    const due = g.retry.findIndex(r => g.done >= r.at);
    if (due >= 0) { const r = g.retry.splice(due, 1)[0]; return [r.a, r.b]; }
    const tables = g.table === 'mix'
        // Solo las tablas que ha recorrido entera (o con medalla); la del 1 no cuenta por compartir resultados
        ? (() => { const used = ORDER.filter(t => (p.learned || []).includes(t) || (p.medals || []).includes(t)); return used.length ? used : [2, 5, 10]; })()
        : [g.table];
    const cands = [];
    for (const t of tables) for (let i = 1; i <= 10; i++) {
        const s = factStat(p, t, i);
        if (g.recent.includes(fkey(t, i))) continue;
        // Más peso a las que falla o aún no domina; las de ×1 y ×10 salen poco
        let w = 1 + s.fail * 2 + (s.streak < MASTER_STREAK ? 2 : 0) - Math.min(s.streak, 4) * 0.2;
        if (i === 1 || i === 10) w *= 0.4;
        cands.push({ a: t, b: i, w: Math.max(0.2, w) });
    }
    let r = Math.random() * cands.reduce((x, c) => x + c.w, 0);
    for (const c of cands) { if ((r -= c.w) <= 0) return [c.a, c.b]; }
    const c = cands[cands.length - 1] || { a: 2, b: 2 };
    return [c.a, c.b];
}

function nextQuestion() {
    const g = RonState.tablas; const p = progress();
    let a, b;
    if (g.stage === 'learn') { a = g.table; b = g.nextInOrder; }
    else {
        [a, b] = pickPractice(p, g);
        if (g.table !== 'mix' && b !== a && Math.random() < 0.3) [a, b] = [b, a];   // 4×3 = 3×4
    }
    Object.assign(g, { a, b, tries: 0, hinted: false, idle: 0, askedAt: Date.now() });
    g.recent = [...g.recent, fkey(a, b)].slice(-3);
    draw();
}
const questionText = () => { const g = RonState.tablas; return `¿Cuánto es ${g.a} por ${g.b}?`; };
const keep = () => { if (RonState.tablas && RonState.activityState === 'IDLE') changeState('MATH_GAME'); };

// ── Pizarra ──────────────────────────────────────────────────────────────────
function draw(hint = null) {
    const g = RonState.tablas; if (!g || !RonState.ui?.gameText) return;
    const big = `<div style="font-size:clamp(30px,9vw,54px);font-weight:700">${g.a} × ${g.b} = ?</div>`;
    let body = '';
    if (g.stage === 'learn') {
        // La tabla se va rellenando: filas hechas con su resultado, la actual con "?"
        const row = i => {
            const done = g.filled.includes(i), cur = i === g.b;
            const style = cur ? 'color:#0a6aa8;font-weight:700' : done ? '' : 'opacity:.25';
            return `<div style="${style}">${g.table} × ${i} = ${done ? g.table * i : cur ? '?' : '…'}</div>`;
        };
        const col = arr => `<div style="flex:1">${arr.map(row).join('')}</div>`;
        body = `<div style="display:flex;gap:14px;font-size:clamp(14px,3.6vw,20px);line-height:1.55;text-align:left;margin-top:6px">${col([1, 2, 3, 4, 5])}${col([6, 7, 8, 9, 10])}</div>`;
    }
    let hintHtml = '';
    if (hint === 'groups' && g.a * g.b <= 50) {
        const e = ['⭐', '🍎', '🌸', '🎈', '🐞'][g.b % 5];
        hintHtml = `<div style="font-size:clamp(13px,3.6vw,20px);line-height:1.6;margin-top:6px">${Array.from({ length: g.b }, () => e.repeat(g.a)).join('<br>')}</div>`;
    } else if (hint === 'count') {
        const seq = Array.from({ length: g.b }, (_, i) => g.a * (i + 1));
        hintHtml = `<div style="font-size:clamp(14px,3.8vw,22px);margin-top:6px">${seq.slice(0, -1).join(', ')}, <b>?</b></div>`;
    }
    const p = progress();
    const medals = (p.medals || []).length ? `🏅 ${(p.medals || []).sort((x, y) => x - y).join(' ')}` : '';
    const label = g.table === 'mix' ? 'Tablas mezcladas' : `Tabla del ${g.table}`;
    RonState.ui.gameText.innerHTML = (g.stage === 'learn' ? '' : big) + body + hintHtml +
        `<div style="font-size:clamp(12px,3vw,15px);opacity:.7;margin-top:8px">${label} · ⭐ ${g.ok} ${medals ? '· ' + medals : ''}</div>`;
}

// ── Respuestas ───────────────────────────────────────────────────────────────
export async function handleTablas(text) {
    const g = RonState.tablas; if (!g) return;
    const t = norm(text);
    if (/\b(salir|para(mos)?|stop|cierra|cancel|basta|no quiero (jugar|seguir|mas)|ya no (quiero|juego)|^ya no$)\b/.test(t) && !/^\s*(no )?se\b/.test(t)) {
        return finish(`¡Entendido! Has acertado ${g.ok}. ¡Guardando la pizarra!`);
    }
    // Cambiar de tabla en cualquier momento: "la del siete", "las mezcladas"
    const req = parseTableRequest(text);
    if (req && req !== g.table && (/tabla|mezclad|todas|\blas? del?\b/.test(t))) return startTablas(req);
    if (/otra tabla|cambia(mos)? de tabla/.test(t)) {
        const p = progress(); const i = ORDER.indexOf(g.table);
        const next = ORDER.slice(i + 1).find(x => x !== 1 && !tableMastered(p, x)) || 'mix';
        return startTablas(next);
    }
    if (g.awaitingContinue) {
        g.awaitingContinue = false;
        if (/\b(no|ya|basta|paramos)\b/.test(t) && !/\bsi\b/.test(t)) {
            return finish(`¡Vale! ¡Has acertado ${g.ok} de ${g.done}! ¡Mis circuitos están orgullosos!`);
        }
        nextQuestion();
        await speak(questionText()); return keep();
    }
    if (/repite|otra vez la pregunta|que has dicho|no te he oido/.test(t) && !parseAllNumbers(text).length) {
        await speak(questionText()); return keep();
    }
    const nums = parseAllNumbers(text);
    if (!nums.length) {
        if (/no (lo )?se|ni idea|ayuda|pista|no me sale|no me acuerdo/.test(t)) return giveHint();
        g.idle++;
        await speak(g.idle >= 2 ? `¿Seguimos con las tablas? Dime el número, o di: paramos.` : `Dime un número, por ejemplo: doce. ${questionText()}`);
        return keep();
    }
    // Ha repetido la pregunta en voz alta ("tres por cuatro…") sin decir el resultado
    const pair = (x, y) => (x === g.a && y === g.b) || (x === g.b && y === g.a);
    if (nums.length === 2 && pair(nums[0], nums[1]) && /\bpor\b|\bx\b|veces/.test(t)) {
        await speak(`¡Eso! ${g.a} por ${g.b}... ¿y cuánto da?`); return keep();
    }
    const num = nums[nums.length - 1];
    g.idle = 0;
    const answer = g.a * g.b;
    if (num === answer) return correct();
    return wrong(num);
}

async function correct() {
    const g = RonState.tablas; const p = progress();
    const k = fkey(g.a, g.b);
    const s = factStat(p, g.a, g.b);
    s.ok++;
    s.streak = g.tries === 0 && !g.hinted ? s.streak + 1 : 0;   // con pista o al segundo intento no cuenta para la medalla
    p.facts[k] = s;
    g.ok++; g.done++;
    const answer = g.a * g.b;
    const fast = Date.now() - g.askedAt < 6000 && g.tries === 0;
    const cheers = [`¡${answer}! ¡Exacto!`, '¡CORRECTO! ¡Bip bip!', fast ? '¡Rapidísimo! ¡Mis circuitos casi no lo ven!' : '¡Muy bien!', `¡Sí! ${g.a} por ${g.b}, ${answer}.`];
    let msg = cheers[Math.floor(Math.random() * cheers.length)];

    // ¿Medalla nueva?
    if (g.table !== 'mix' && !(p.medals || []).includes(g.table) && tableMastered(p, g.table)) {
        p.medals = [...(p.medals || []), g.table];
        msg += ` ¡MEDALLA! ¡Ya te sabes la tabla del ${g.table}!`;
        try { (await import('./memory.js')).addFact(who(), `Se sabe la tabla del ${g.table} (medalla de Ron)`); } catch (e) {}
        import('./sounds.js').then(snd => snd.playMemorySaveSound && snd.playMemorySaveSound()).catch(() => {});
    }
    setExpression('star');

    if (g.stage === 'learn') {
        g.filled = [...new Set([...g.filled, g.b])];
        g.nextInOrder++;
        if (g.nextInOrder > 10) {
            p.learned = [...new Set([...(p.learned || []), g.table])];
            saveProgress(p);
            draw();
            g.stage = 'practice';
            g.awaitingContinue = true;
            await speak(`${msg} ¡Has completado la tabla del ${g.table} entera! Ahora te la pregunto salteada. ¿Seguimos?`);
            return keep();
        }
    }
    saveProgress(p);
    if (g.done % ROUND === 0) {
        g.awaitingContinue = true;
        draw();
        const sc = g.table !== 'mix' ? ` De la tabla del ${g.table} dominas ${tableScore(p, g.table)} de 10.` : '';
        await speak(`${msg} ¡Llevas ${g.ok} de ${g.done}!${sc} ¿Seguimos?`);
        return keep();
    }
    nextQuestion();
    await speak(`${msg} ${questionText()}`);
    return keep();
}

async function wrong(num) {
    const g = RonState.tablas; const p = progress();
    g.tries++;
    const s = factStat(p, g.a, g.b);
    if (g.tries === 1) { s.fail++; s.streak = 0; p.facts[fkey(g.a, g.b)] = s; saveProgress(p); }
    const answer = g.a * g.b;
    // Errores típicos con explicación concreta
    let why = '';
    if (num === g.a + g.b) why = ` ¡Ojo! Eso es sumar. ${g.a} por ${g.b} es sumar el ${g.a}, ${g.b} veces.`;
    else if (num === g.a * (g.b - 1) || num === g.a * (g.b + 1)) why = ` ¡Casi! Ese es ${g.a} por ${num === g.a * (g.b - 1) ? g.b - 1 : g.b + 1}.`;
    else if (num === g.b * (g.a - 1) || num === g.b * (g.a + 1)) why = ` ¡Casi! Ese es ${num === g.b * (g.a - 1) ? g.a - 1 : g.a + 1} por ${g.b}.`;
    if (g.tries === 1) {
        setExpression('thinking');
        await speak(`Mmm... ${num} no es.${why} ¡Prueba otra vez! ${questionText()}`);
        return keep();
    }
    if (g.tries === 2) return giveHint(num);
    // Tercer fallo: la respuesta con cariño, y vuelve a salir dentro de un rato
    g.done++;
    if (g.stage === 'learn') { g.filled = [...new Set([...g.filled, g.b])]; g.nextInOrder++; }
    else g.retry.push({ a: g.a, b: g.b, at: g.done + 2 });
    setExpression('happy');
    const last = g.stage === 'learn' && g.nextInOrder > 10;
    if (last) {
        p.learned = [...new Set([...(p.learned || []), g.table])]; saveProgress(p);
        g.stage = 'practice'; g.awaitingContinue = true; draw();
        await speak(`¡Era ${answer}! ${g.a} por ${g.b} son ${answer}. ¡Ya hemos recorrido la tabla del ${g.table} entera! Ahora salteada. ¿Seguimos?`);
        return keep();
    }
    const msg = `¡Era ${answer}! ${g.a} por ${g.b} son ${answer}.${g.stage === 'practice' ? ' Luego te la vuelvo a preguntar.' : ''}`;
    if (g.done % ROUND === 0) { g.awaitingContinue = true; draw(); await speak(`${msg} ¡Llevas ${g.ok} de ${g.done}! ¿Seguimos?`); return keep(); }
    nextQuestion();
    await speak(`${msg} Ahí va otra: ${questionText()}`);
    return keep();
}

async function giveHint(wrongNum = null) {
    const g = RonState.tablas;
    g.hinted = true;
    setExpression('thinking');
    const { a, b } = g;
    const pre = wrongNum !== null ? `${wrongNum} no es. ` : '';
    let how;
    if (a === 1 || b === 1) how = `Cualquier número por uno es el mismo número.`;
    else if (a === 10 || b === 10) how = `Para multiplicar por diez, pon un cero detrás del ${a === 10 ? b : a}.`;
    else if (a === 2 || b === 2) how = `Por dos es el doble: ${a === 2 ? b : a} más ${a === 2 ? b : a}.`;
    else if (g.stage === 'learn' && b > 1) how = `Mira la pizarra: ${a} por ${b - 1} son ${a * (b - 1)}. Súmale ${a} más.`;
    else if (a === 5 || b === 5) how = `Cuenta de cinco en cinco, ${a === 5 ? b : a} veces: 5, 10, 15...`;
    else how = `Es lo mismo que sumar el ${a}, ${b} veces. Cuenta conmigo en la pizarra.`;
    // Preguntada al revés (4×3 dentro de la tabla del 3): recordar que el orden no importa
    const swapped = g.table !== 'mix' && a !== g.table ? ` Y acuérdate: es igual que ${b} por ${a}.` : '';
    draw(g.stage === 'learn' ? null : (a * b <= 30 ? 'groups' : 'count'));
    await speak(`${pre}¡Pista! ${how}${swapped} ${questionText()}`);
    return keep();
}

async function finish(msg) {
    RonState.tablas = null;
    const { stopAnyGame } = await import('./games.js');
    stopAnyGame();
    return speak(msg);
}

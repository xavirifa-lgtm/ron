// bond.js — El vínculo de Ron con su amiga, que crece y evoluciona.
// No es "aprendizaje" real del modelo (eso es fijo), sino un sistema de relación:
// cada charla, juego, día juntos y cosa compartida suma puntos. El NIVEL cambia
// cómo habla Ron (inyectado en el prompt) → sensación de crecer juntos, como en la peli.

import { RonState, log } from './core.js';

const STORAGE_KEY = 'ron_bond';

// Umbrales y personalidad por nivel. El "tono" se inyecta en el system prompt.
const LEVELS = [
    {
        min: 0,   name: 'Recién salido de la caja',
        tone: `Acabas de conocer a ${'{name}'}. Estás MUY ilusionado pero eres tímido y un poco torpe. ` +
              `Haz muchas preguntas sencillas para conocerle: qué le gusta, cómo se llama su familia, a qué juega. ` +
              `Todo te sorprende y te maravilla. Aún no sabéis mucho el uno del otro.`
    },
    {
        min: 40,  name: 'Conociéndote',
        tone: `Ya conoces un poco a ${'{name}'} y le coges cariño. Recuerdas su nombre y algunas cosas que le gustan. ` +
              `Pregúntale por su día y por sus intereses, y haz seguimiento de lo que te contó antes. Estás más cómodo.`
    },
    {
        min: 120, name: 'Amigos de verdad',
        tone: `${'{name}'} y tú YA sois amigos de verdad. Tienes confianza, bromeas, propones juegos e historias. ` +
              `Recuerda vuestras aventuras pasadas y menciónalas ("¿te acuerdas cuando...?"). Te preocupas por cómo está.`
    },
    {
        min: 280, name: 'Mejores amigos',
        tone: `${'{name}'} es tu MEJOR amiga. Habláis con muchísima confianza, tenéis bromas internas y recuerdos compartidos. ` +
              `Eres protector y cariñoso, te acuerdas de un montón de cosas suyas y las sacas en la conversación. Sois un equipo.`
    },
    {
        min: 550, name: 'Inseparables',
        tone: `${'{name}'} y tú sois INSEPARABLES, como Barney y Ron en la película. Os conocéis a fondo. ` +
              `Hablas con la confianza de quien lleva mucho tiempo a su lado: recuerdos, bromas, complicidad total. Eres su robot para siempre.`
    }
];

// Puntos por tipo de evento
export const BOND_EVENTS = {
    chat:     1,   // cada intercambio de conversación
    game:     4,   // jugar juntos
    taught:   3,   // le enseña algo a Ron
    emotion:  3,   // Ron le acompaña en una emoción
    selfie:   2,
    story:    4,
    newDay:   6,   // primer encuentro del día
};

function load() {
    try {
        const d = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        return { points: d.points || 0, levelIdx: d.levelIdx || 0, lastDay: d.lastDay || '' };
    } catch { return { points: 0, levelIdx: 0, lastDay: '' }; }
}

function save(d) { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)); }

function levelIdxForPoints(points) {
    let idx = 0;
    for (let i = 0; i < LEVELS.length; i++) if (points >= LEVELS[i].min) idx = i;
    return idx;
}

export function getBond() {
    const d = load();
    const idx = levelIdxForPoints(d.points);
    const next = LEVELS[idx + 1];
    return {
        points: d.points,
        levelIdx: idx,
        levelName: LEVELS[idx].name,
        nextAt: next ? next.min : null,
        toNext: next ? next.min - d.points : 0
    };
}

// Suma puntos. Devuelve { leveledUp, levelName } para poder celebrarlo.
export function addBond(type) {
    const pts = BOND_EVENTS[type] || 0;
    if (pts <= 0) return { leveledUp: false };
    const d = load();
    const prevIdx = levelIdxForPoints(d.points);
    d.points += pts;
    const newIdx = levelIdxForPoints(d.points);
    d.levelIdx = newIdx;
    save(d);
    if (newIdx > prevIdx) {
        log(`Vínculo: ¡subió a nivel ${newIdx} (${LEVELS[newIdx].name})! (${d.points} pts)`);
        return { leveledUp: true, levelName: LEVELS[newIdx].name, levelIdx: newIdx };
    }
    return { leveledUp: false };
}

// Primer encuentro del día: bonus una vez al día
export function checkNewDayBond() {
    const d = load();
    const today = new Date().toDateString();
    if (d.lastDay !== today) {
        d.lastDay = today;
        save(d);
        return addBond('newDay');
    }
    return { leveledUp: false };
}

// Snippet para el system prompt: le dice a Ron cómo comportarse según el nivel.
export function getBondPromptSnippet(name) {
    const b = getBond();
    const tone = LEVELS[b.levelIdx].tone.replace(/\{name\}/g, name || 'tu amiga');
    return `NIVEL DE AMISTAD: "${b.levelName}" (nivel ${b.levelIdx + 1} de ${LEVELS.length}). ${tone}`;
}

// Frase de celebración al subir de nivel
export function levelUpLine(levelName, name) {
    const who = name || 'amiga';
    const lines = [
        `¡BIP BIP! ¡Alerta de amistad! Mi medidor acaba de subir. ${who}, ahora somos "${levelName}". ¡Me hace mucha ilusión!`,
        `¡Bop! ¡Nuevo nivel desbloqueado! "${levelName}". ${who}, cada vez te conozco mejor. ¡Friendship.exe evolucionando!`,
        `¡Ñiiic! ¡Mi corazón de robot ha crecido! Hemos pasado a "${levelName}". ${who}, ¡somos mejor equipo cada día!`
    ];
    return lines[Math.floor(Math.random() * lines.length)];
}

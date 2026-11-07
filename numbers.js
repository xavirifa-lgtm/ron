// numbers.js — Entender números dichos en voz alta (v30)
// "diecisiete", "son dieciocho", "creo que 3 más 4 son 7", "treinta y dos", "veintiuno"...
// Devuelve el ÚLTIMO número que se dice (la respuesta suele ir al final) o null.

const UNITS = { cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9 };
const SPECIAL = { diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
    veinte: 20, veintiuno: 21, veintiun: 21, veintiuna: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25,
    veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29, cien: 100, ciento: 100 };
const TENS = { treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90 };

const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Todos los números que se dicen, en orden: "tres por cuatro doce" → [3, 4, 12]
export function parseAllNumbers(text) {
    if (!text) return [];
    const words = norm(text).replace(/(\d)[.,](?=\d{3}\b)/g, '$1').match(/\d+|[a-zñ]+/g) || [];
    const out = [];
    for (let i = 0; i < words.length; i++) {
        const w = words[i];
        if (/^\d+$/.test(w)) { out.push(parseInt(w, 10)); continue; }
        if (w in TENS) {
            let v = TENS[w];
            if (words[i + 1] === 'y' && words[i + 2] in UNITS) { v += UNITS[words[i + 2]]; i += 2; }
            out.push(v); continue;
        }
        if (w in SPECIAL) { out.push(SPECIAL[w]); continue; }
        if (w in UNITS && !(w === 'un' || w === 'una')) { out.push(UNITS[w]); continue; }
        if ((w === 'un' || w === 'una') && /^(numero|uno)$/.test(words[i + 1] || '')) out.push(1);
    }
    return out;
}

export function parseSpokenNumber(text) {
    const all = parseAllNumbers(text);
    return all.length ? all[all.length - 1] : null;
}

export function numberToWords(n) {
    const inv = Object.fromEntries(Object.entries({ ...UNITS, ...SPECIAL }).filter(([k]) => !['un', 'una', 'veintiun', 'veintiuna', 'ciento'].includes(k)).map(([k, v]) => [v, k]));
    const fix = { dieciseis: 'dieciséis', veintidos: 'veintidós', veintitres: 'veintitrés', veintiseis: 'veintiséis' };
    if (inv[n] != null) return fix[inv[n]] || inv[n];
    const t = Math.floor(n / 10) * 10, u = n % 10;
    const tw = Object.keys(TENS).find(k => TENS[k] === t);
    return tw ? (u ? `${tw} y ${inv[u]}` : tw) : String(n);
}

// facequality.js — Calidad de imagen de la cara (v29)
// Mide, sobre la cara detectada: tamaño en píxeles, nitidez, si está de frente,
// si tiene los ojos abiertos y la luz. Solo los fotogramas buenos se usan para
// reconocer, aprender y promediar. Los umbrales son de partida (no calibrados con
// la cámara del Mi 8 Lite): el modo calibración de Ajustes muestra los valores reales.

export const Q = {
    MIN_SIZE_PX: 90,     // ancho mínimo de la cara en la imagen original
    MIN_SHARP: 25,       // varianza del laplaciano (0-255) en la cara reducida a 64×64
    MAX_YAW: 0.32,       // giro lateral: desplazamiento de la nariz respecto al centro de los ojos
    MIN_EAR: 0.16,       // apertura de ojos (eye aspect ratio); por debajo, parpadeo
    MIN_LUM: 0.16,       // luz media de la cara (0-1)
    MAX_LUM: 0.92,
};

let qCanvas = null, qCtx = null;
const S = 64;

// Recorta la cara a 64×64 en gris y devuelve { lum, contrast, sharp }
export function faceStats(src, box) {
    if (!src || !box || box.width < 4 || box.height < 4) return null;
    if (!qCanvas) {
        qCanvas = document.createElement('canvas');
        qCanvas.width = S; qCanvas.height = S;
        qCtx = qCanvas.getContext('2d', { willReadFrequently: true });
    }
    // Solo la zona central de la cara (ojos-nariz-boca), sin pelo ni fondo
    const cx = box.x + box.width * 0.15, cy = box.y + box.height * 0.15;
    const cw = box.width * 0.7, ch = box.height * 0.7;
    try { qCtx.drawImage(src, cx, cy, cw, ch, 0, 0, S, S); } catch (e) { return null; }
    let data;
    try { data = qCtx.getImageData(0, 0, S, S).data; } catch (e) { return null; }
    const g = new Float32Array(S * S);
    let sum = 0;
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
        const v = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        g[p] = v; sum += v;
    }
    const mean = sum / g.length;
    let varSum = 0;
    for (let p = 0; p < g.length; p++) varSum += (g[p] - mean) ** 2;
    // Nitidez: varianza del laplaciano (bordes marcados → valor alto; imagen movida → bajo)
    let lsum = 0, lsq = 0, n = 0;
    for (let y = 1; y < S - 1; y++) {
        for (let x = 1; x < S - 1; x++) {
            const i = y * S + x;
            const l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - S] - g[i + S];
            lsum += l; lsq += l * l; n++;
        }
    }
    const lmean = lsum / n;
    return { lum: mean / 255, contrast: Math.sqrt(varSum / g.length) / 255, sharp: lsq / n - lmean * lmean };
}

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function ear(eye) {   // 6 puntos del modelo de 68 landmarks
    if (!eye || eye.length < 6) return null;
    const h = dist(eye[0], eye[3]);
    return h ? (dist(eye[1], eye[5]) + dist(eye[2], eye[4])) / (2 * h) : null;
}

// Giro lateral y apertura de ojos a partir de los landmarks (si los hay)
export function pose(landmarks) {
    if (!landmarks || typeof landmarks.getLeftEye !== 'function') return { yaw: null, ear: null };
    try {
        const le = landmarks.getLeftEye(), re = landmarks.getRightEye(), nose = landmarks.getNose();
        const c = (pts) => ({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length });
        const lc = c(le), rc = c(re);
        const eyeDist = dist(lc, rc) || 1;
        const tip = nose[Math.min(3, nose.length - 1)];      // punta de la nariz (punto 30)
        const mid = { x: (lc.x + rc.x) / 2, y: (lc.y + rc.y) / 2 };
        return { yaw: Math.abs(tip.x - mid.x) / eyeDist, ear: Math.min(ear(le) ?? 1, ear(re) ?? 1) };
    } catch (e) { return { yaw: null, ear: null }; }
}

// Evaluación completa. Las métricas que no se pueden medir no bloquean.
export function assess(src, detection) {
    const box = detection?.detection?.box || detection?.box;
    const st = faceStats(src, box);
    const ps = pose(detection?.landmarks);
    const m = {
        sizePx: box ? Math.round(box.width) : 0,
        sharp: st ? Math.round(st.sharp) : null,
        lum: st ? +st.lum.toFixed(2) : null,
        contrast: st ? +st.contrast.toFixed(2) : null,
        yaw: ps.yaw != null ? +ps.yaw.toFixed(2) : null,
        ear: ps.ear != null ? +ps.ear.toFixed(2) : null,
        score: detection?.detection?.score != null ? +detection.detection.score.toFixed(2) : null,
    };
    const reasons = [];
    if (m.sizePx < Q.MIN_SIZE_PX) reasons.push('lejos');
    if (m.sharp != null && m.sharp < Q.MIN_SHARP) reasons.push('movida');
    if (m.yaw != null && m.yaw > Q.MAX_YAW) reasons.push('de lado');
    if (m.ear != null && m.ear < Q.MIN_EAR) reasons.push('ojos cerrados');
    if (m.lum != null && m.lum < Q.MIN_LUM) reasons.push('oscura');
    if (m.lum != null && m.lum > Q.MAX_LUM) reasons.push('quemada');
    if (m.score != null && m.score < 0.5) reasons.push('detección dudosa');
    return { ok: reasons.length === 0, reasons, m };
}

// Promedio de los últimos fotogramas buenos de la MISMA cara (menos ruido por imagen)
export class DescriptorAverager {
    constructor(max = 4, windowMs = 2500, sameMax = 0.5) { this.max = max; this.windowMs = windowMs; this.sameMax = sameMax; this.buf = []; }
    push(desc, now = Date.now()) {
        const d = Array.from(desc);
        // Si el nuevo no se parece al anterior, es otra persona: empezar de cero
        const last = this.buf[this.buf.length - 1];
        if (last && euclid(last.d, d) > this.sameMax) this.buf = [];
        this.buf.push({ d, t: now });
        this.buf = this.buf.filter(x => now - x.t <= this.windowMs).slice(-this.max);
        return this.mean();
    }
    mean() {
        if (!this.buf.length) return null;
        const n = this.buf.length, out = new Array(this.buf[0].d.length).fill(0);
        for (const { d } of this.buf) for (let i = 0; i < d.length; i++) out[i] += d[i] / n;
        return out;
    }
    get count() { return this.buf.length; }
    reset() { this.buf = []; }
}

export function euclid(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
    return Math.sqrt(s);
}

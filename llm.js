// llm.js — Enrutador de IA para Ron (v26.1)
// Reparte las peticiones entre modelos y proveedores para no agotar la cuota gratuita:
//  - Groq (obligatorio). Límites verificados (oct 2026, plan gratuito) por modelo:
//    gpt-oss-120b / gpt-oss-20b / qwen3.8-27b: 30 RPM, 1.000 RPD, 8K TPM, 200K TPD.
//    gpt-oss-safeguard-20b: 3 RPM. Al superarlos Groq responde 429 + retry-after.
//  - Cerebras y OpenRouter (opcionales, solo si pones su clave en Ajustes).
//    ⚠ Sin probar con este código: IDs de modelo y límites sacados de terceros.
// Si un modelo devuelve 429, se "enfría" el tiempo indicado y se salta al siguiente.

import { RonState, RonConfig, log } from './core.js';

const PROVIDERS = {
    groq:       { url: 'https://api.groq.com/openai/v1/chat/completions', key: () => RonState.apiKey },
    cerebras:   { url: 'https://api.cerebras.ai/v1/chat/completions',     key: () => RonConfig.cerebrasKey },
    openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions',   key: () => RonConfig.openrouterKey },
    // Gemini (AI Studio, gratis). Endpoint compatible con OpenAI verificado en su doc;
    // NO verificado que Google acepte la llamada desde el navegador (CORS): si no, se salta.
    gemini:     { url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', key: () => RonConfig.geminiKey },
};

// Orden de preferencia. "proveedor:modelo". Los proveedores sin clave se saltan.
export const MODELS = {
    chat: ['groq:openai/gpt-oss-120b', 'groq:llama-3.3-70b-versatile', 'gemini:gemini-3.8-flash',
           'cerebras:gpt-oss-120b', 'openrouter:openai/gpt-oss-120b:free', 'groq:openai/gpt-oss-20b'],
    fast: ['groq:openai/gpt-oss-20b', 'groq:llama-3.1-8b-instant', 'gemini:gemini-3.5-flash-lite', 'cerebras:gpt-oss-120b'],
    vision: ['groq:qwen/qwen3.8-27b', 'gemini:gemini-3.8-flash', 'cerebras:qwen-3.8-27b'],
    // Clasificador de seguridad: el específico tiene solo 3 RPM; si se agota, la misma
    // política la evalúa un modelo general (30 RPM) antes de recurrir al filtro local.
    guard: ['groq:openai/gpt-oss-safeguard-20b', 'groq:openai/gpt-oss-20b', 'gemini:gemini-3.5-flash-lite', 'cerebras:gpt-oss-120b'],
};

const cooldownUntil = {};      // "prov:modelo" → timestamp
const disabledProvider = {};   // proveedor con clave inválida → true (hasta recargar)

function split(entry) { const i = entry.indexOf(':'); return [entry.slice(0, i), entry.slice(i + 1)]; }

function paramsFor(provider, model) {
    if (provider === 'groq' && model.startsWith('openai/gpt-oss')) return { reasoning_effort: 'low', include_reasoning: false };
    if (provider === 'groq' && model.startsWith('qwen/'))          return { reasoning_effort: 'none' };
    if (provider === 'cerebras' && model.startsWith('gpt-oss'))     return { reasoning_effort: 'low' };
    if (provider === 'gemini')                                       return { reasoning_effort: 'low' };
    return {};
}

// Contador de uso del día (para ver cuánto se consume: aparece en el log)
function countUse(entry) {
    try {
        const k = 'ron_usage_' + new Date().toISOString().slice(0, 10);
        const u = JSON.parse(localStorage.getItem(k) || '{}');
        u[entry] = (u[entry] || 0) + 1;
        localStorage.setItem(k, JSON.stringify(u));
    } catch (e) {}
}
export function usageToday() {
    try { return JSON.parse(localStorage.getItem('ron_usage_' + new Date().toISOString().slice(0, 10)) || '{}'); }
    catch (e) { return {}; }
}

// Quita razonamiento que se cuele (harmony de gpt-oss, <think> de qwen)
export function cleanOutput(raw) {
    let resp = raw || '';
    const hasHarmony = /<\|channel\|>|<\|message\|>/i.test(resp);
    const finalCh = resp.match(/final<\|message\|>([\s\S]*?)(?:<\|end\|>|<\|return\|>|$)/i);
    if (finalCh) resp = finalCh[1];
    else if (hasHarmony) resp = '';
    resp = resp.replace(/<think>[\s\S]*?<\/think>/gi, '')
               .replace(/^[\s\S]*?<\/think>/i, '')
               .replace(/<\|[^>]*\|>/g, '')
               .trim();
    return resp;
}

async function post(url, key, body, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: ctrl.signal
        });
        let data = null;
        try { data = await res.json(); } catch (e) {}
        return { ok: res.ok, status: res.status, data, retryAfter: Number(res.headers.get('retry-after')) || 0 };
    } finally {
        clearTimeout(timer);
    }
}

// Llamada con cadena de modelos. Devuelve { text, model } o lanza Error.
export async function chat(messages, { models = MODELS.chat, maxTokens = 500, temperature = 0.8, timeoutMs = 9000, json = false } = {}) {
    if (!RonState.apiKey) throw new Error('Falta la API key de Groq');
    let lastErr = 'sin modelos disponibles';
    const now = Date.now();
    for (const entry of models) {
        const [provider, model] = split(entry);
        const prov = PROVIDERS[provider];
        const key = prov && prov.key();
        if (!prov || !key || disabledProvider[provider]) continue;
        if ((cooldownUntil[entry] || 0) > now) continue;

        const extra = paramsFor(provider, model);
        const base = { model, messages, max_tokens: maxTokens, temperature };
        if (json) base.response_format = { type: 'json_object' };
        try {
            let r = await post(prov.url, key, { ...base, ...extra }, timeoutMs);
            if (!r.ok && r.status === 400 && (Object.keys(extra).length || json)) {
                const minimal = { ...base }; delete minimal.response_format;
                r = await post(prov.url, key, minimal, timeoutMs);
            }
            countUse(entry);
            if (r.ok) {
                const text = cleanOutput(r.data?.choices?.[0]?.message?.content);
                if (text) return { text, model: entry };
                lastErr = `${entry}: respuesta vacía`;
            } else if (r.status === 429) {
                const secs = Math.min(Math.max(r.retryAfter || 30, 5), 3600);
                cooldownUntil[entry] = Date.now() + secs * 1000;
                lastErr = `${entry}: cuota agotada (enfría ${secs}s)`;
            } else if (r.status === 401 || r.status === 403) {
                disabledProvider[provider] = true;
                lastErr = `${provider}: clave no válida`;
            } else if (r.status === 404) {
                cooldownUntil[entry] = Date.now() + 6 * 3600000;   // modelo retirado: no insistir hoy
                lastErr = `${entry}: modelo no encontrado`;
            } else {
                lastErr = `${entry}: ${r.data?.error?.message || 'HTTP ' + r.status}`;
            }
        } catch (e) {
            lastErr = `${entry}: ${e.name === 'AbortError' ? 'timeout' : e.message}`;
        }
        log(`IA → ${lastErr}`);
    }
    throw new Error(lastErr);
}

// Visión: system + historial + imagen en el último turno
export async function chatVision(system, history, userText, imageDataUrl, opts = {}) {
    const messages = [
        { role: 'system', content: system },
        ...history,
        { role: 'user', content: [
            { type: 'text', text: userText },
            { type: 'image_url', image_url: { url: imageDataUrl } }
        ]}
    ];
    return chat(messages, { models: MODELS.vision, maxTokens: 400, timeoutMs: 12000, ...opts });
}

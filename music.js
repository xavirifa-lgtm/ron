// music.js — Reproductor invisible YT (estilo Chronobeats)
import { log } from './core.js';

let player        = null;
let isReady       = false;
let pendingQuery  = null;
let currentQuery  = null;  // query en reproducción actual (para fallback en onError)

// IDs directos para búsquedas comunes → carga instantánea sin depender de la búsqueda
const KNOWN_IDS = {
    'mecano':        '92S_pY8mK8U',
    'relajante':     '5qap5aO4i9A',
    'relax':         '5qap5aO4i9A',
    'frozen':        'OaG9pWN2OeU',
    'baby shark':    'XqZsoesa55w',
    'peppa pig':     '5z4gVtlnKdc',
    'la patrulla':   'y6MRbpQcHDE',
    'patrulla canina':'y6MRbpQcHDE',
    'paw patrol':    'y6MRbpQcHDE',
    'minions':       '_GKQkPMIuqI',
    'dinosaurios':   'iMaVHOlkGoc',
    'pokemon':       'rg6CiPI6h2g',
    'minecraft':     'Dg0IjOa51jI',
    'cumpleaños':    'xGU6oO0Us-E',
    'feliz cumpleaños': 'xGU6oO0Us-E',
    'infantil':      'GbFXMo_9p-Y',
    'canciones':     'GbFXMo_9p-Y',
};

function initPlayer() {
    if (player) return;
    player = new YT.Player('ron-yt-player', {
        height: '200',
        width:  '200',
        playerVars: {
            autoplay:        0,
            controls:        0,
            disablekb:       1,
            fs:              0,
            modestbranding:  1,
            playsinline:     1,
            rel:             0,
            iv_load_policy:  3
        },
        events: {
            onReady: () => {
                isReady = true;
                log('YT Player listo.');
                // Priming silencioso: desbloquea autoplay en móvil
                try {
                    player.mute();
                    player.playVideo();
                    setTimeout(() => {
                        try { player.pauseVideo(); player.unMute(); } catch(e) {}
                        if (pendingQuery) {
                            _playQuery(pendingQuery);
                            pendingQuery = null;
                        }
                    }, 400);
                } catch(e) {
                    log('YT priming omitido: ' + e.message);
                    if (pendingQuery) { _playQuery(pendingQuery); pendingQuery = null; }
                }
            },
            onError: (e) => {
                // Sin abrir YouTube en otra pestaña: la niña no debe acabar navegando sola
                log(`YT error código: ${e.data}`);
                currentQuery = null;
                pendingQuery = null;
            }
        }
    });
}

// El API llama a esta función global cuando está listo
window.onYouTubeIframeAPIReady = () => initPlayer();
// Si YT ya estaba cargado antes que este módulo (PWA con caché)
if (window.YT && window.YT.Player) initPlayer();

// SOLO lista segura: sin búsquedas libres en YouTube (podrían salir vídeos no aptos)
function findSong(query) {
    const q = (query || '').toLowerCase().trim();
    if (KNOWN_IDS[q]) return KNOWN_IDS[q];
    const key = Object.keys(KNOWN_IDS).find(k => q.includes(k) || k.includes(q));
    return key ? KNOWN_IDS[key] : null;
}

export function allowedSongs() { return [...new Set(Object.keys(KNOWN_IDS))]; }

function _playQuery(query) {
    const id = findSong(query);
    if (!id) return;
    currentQuery = query;
    log(`YT: video permitido → ${id}`);
    player.loadVideoById({ videoId: id, startSeconds: 0 });
}

// Devuelve true si la canción está en la lista segura (y se reproduce o queda en cola)
export function playYTMusic(query) {
    if (!findSong(query)) { log(`Música no permitida: "${query}"`); return false; }
    if (isReady && player) _playQuery(query);
    else { pendingQuery = query; log(`YT no listo, música en cola: "${query}"`); }
    return true;
}

export function stopYTMusic() {
    if (isReady && player) {
        player.stopVideo();
        log('YT: música parada.');
    }
}

export function isPlaying() {
    // Estado 1 = PLAYING en la API de YT
    return isReady && player && player.getPlayerState() === 1;
}

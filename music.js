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
    'fnaf':          'TsthCHM8o04',
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
                log(`YT error código: ${e.data}`);
                // Fallback: abrir YouTube en nueva pestaña si el player falla
                const q = currentQuery || pendingQuery;
                if (q) {
                    const url = `https://music.youtube.com/search?q=${encodeURIComponent(q)}`;
                    window.open(url, '_blank');
                    currentQuery = null;
                    pendingQuery = null;
                }
            }
        }
    });
}

// El API llama a esta función global cuando está listo
window.onYouTubeIframeAPIReady = () => initPlayer();
// Si YT ya estaba cargado antes que este módulo (PWA con caché)
if (window.YT && window.YT.Player) initPlayer();

function _playQuery(query) {
    currentQuery = query;
    const key = query.toLowerCase().trim();
    const id  = KNOWN_IDS[key];
    if (id) {
        log(`YT: video directo → ${id}`);
        player.loadVideoById({ videoId: id, startSeconds: 0 });
    } else {
        log(`YT: búsqueda → "${query}"`);
        player.loadPlaylist({ listType: 'search', list: query, index: 0, startSeconds: 0 });
    }
}

export function playYTMusic(query) {
    if (isReady && player) {
        _playQuery(query);
    } else {
        // Guardar para cuando el player esté listo
        pendingQuery = query;
        log(`YT no listo, música en cola: "${query}"`);
    }
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

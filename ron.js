/**
 * Ron B*Bot AI - Motor de Animación de Cara
 */

const ronFace = {
    eyes: {
        left: document.getElementById('eye-left'),
        right: document.getElementById('eye-right')
    },
    mouth: document.getElementById('mouth-path'),
    mouthContainer: document.querySelector('.mouth-svg'),
    glitchOverlay: document.getElementById('glitch-overlay'),

    // Estado actual
    state: 'neutral',

    init() {
        console.log("Ron activado. ¡Bip-bup!");
        this.setExpression('neutral');
        this.startBlinkCycle();
        this.setupInteractions();
    },

    // Ciclo de parpadeo aleatorio
    startBlinkCycle() {
        const blink = () => {
            if (this.state === 'neutral') {
                this.eyes.left.classList.add('blink');
                this.eyes.right.classList.add('blink');
                
                setTimeout(() => {
                    this.eyes.left.classList.remove('blink');
                    this.eyes.right.classList.remove('blink');
                }, 150);
            }
            setTimeout(blink, Math.random() * 4000 + 2000);
        };
        blink();
    },

    // Cambiar expresión emocional
    setExpression(expression) {
        this.state = expression;
        console.log(`Expresión cambiada a: ${expression}`);
        
        // Limpiar clases previas
        [this.eyes.left, this.eyes.right].forEach(el => {
            el.className = 'eye'; // Reset a base
        });
        this.stopGlitchEffect();

        switch(expression) {
            case 'happy':
            case 'laugh':
                this.eyes.left.classList.add('happy');
                this.eyes.right.classList.add('happy');
                this.updateMouth('M 5 15 Q 50 45 95 15');
                break;
            
            case 'surprise':
                this.eyes.left.classList.add('surprise');
                this.eyes.right.classList.add('surprise');
                this.updateMouth('M 30 25 Q 50 35 70 25');
                break;

            case 'glitch':
                this.eyes.left.classList.add('glitch-left');
                this.eyes.right.classList.add('glitch-right');
                this.updateMouth('M 20 20 L 40 25 L 60 15 L 80 20'); // Boca en zigzag
                this.startGlitchEffect();
                break;

            case 'singing':
                this.eyes.left.classList.add('happy');
                this.eyes.right.classList.add('happy');
                this.updateMouth('M 30 20 Q 50 10 70 20 Q 50 30 30 20'); // Boca circular/O
                this.setTalking(true);
                break;

            case 'energized':
                this.eyes.left.classList.add('energized');
                this.eyes.right.classList.add('energized');
                this.updateMouth('M 10 20 Q 50 45 90 20');
                break;

            case 'thinking':
                this.eyes.left.classList.add('flat');
                this.eyes.right.classList.add('flat');
                this.updateMouth('M 20 20 Q 50 20 80 20'); // Boca plana
                this.startGlitchEffect();
                break;

            default: // neutral
                this.updateMouth('M 10 20 Q 50 40 90 20');
        }
    },

    // Sistema de Glitch Visual
    startGlitchEffect() {
        this.stopGlitchEffect(); // Evitar duplicados
        this.glitchInterval = setInterval(() => {
            const block = document.createElement('div');
            block.className = 'glitch-block';
            
            // Posición y tamaño aleatorio
            const size = Math.random() * 100 + 20;
            block.style.width = `${size}px`;
            block.style.height = `${size / 2}px`;
            block.style.left = `${Math.random() * 100}vw`;
            block.style.top = `${Math.random() * 100}vh`;
            
            this.glitchOverlay.appendChild(block);
            
            setTimeout(() => block.remove(), 200);
        }, 100);
    },

    stopGlitchEffect() {
        clearInterval(this.glitchInterval);
        this.glitchOverlay.innerHTML = '';
    },

    // Actualizar curva de la boca (Mouth Path)
    updateMouth(d) {
        this.mouth.setAttribute('d', d);
    },

    // Simular habla (Vibración)
    setTalking(isTalking) {
        if (isTalking) {
            this.mouthContainer.classList.add('mouth-vibrate');
        } else {
            this.mouthContainer.classList.remove('mouth-vibrate');
        }
    },

    setupInteractions() {
        // Ciclo de expresiones al hacer click
        const expressions = ['neutral', 'happy', 'surprise', 'glitch', 'singing', 'energized', 'thinking'];
        let currentIndex = 0;

        document.body.addEventListener('click', (e) => {
            // Intentar entrar en pantalla completa real (oculta barras de Android/iOS)
            this.goFullscreen();

            currentIndex = (currentIndex + 1) % expressions.length;
            this.setExpression(expressions[currentIndex]);
            
            if (expressions[currentIndex] === 'singing') {
                setTimeout(() => this.setTalking(false), 2000);
            }
        });

        // Soporte para teclas
        window.addEventListener('keydown', (e) => {
            if (e.key === 'f') this.goFullscreen();
            if (e.key === 'g') this.setExpression('glitch');
            if (e.key === 'n') this.setExpression('neutral');
        });
    },

    goFullscreen() {
        const doc = window.document;
        const docEl = doc.documentElement;

        const requestFullScreen = docEl.requestFullscreen || docEl.mozRequestFullScreen || docEl.webkitRequestFullScreen || docEl.msRequestFullscreen;
        
        if (!doc.fullscreenElement && !doc.mozFullScreenElement && !doc.webkitFullscreenElement && !doc.msFullscreenElement) {
            if (requestFullScreen) {
                requestFullScreen.call(docEl).catch(err => {
                    console.log(`Error al intentar modo inmersivo: ${err.message}`);
                });
            }
        }
    }
};

// Registro de Service Worker para PWA (permite ocultar la barra de navegación)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').then(reg => {
            console.log('Ron PWA listo:', reg.scope);
        }).catch(err => {
            console.log('Error PWA:', err);
        });
    });
}

window.onload = () => ronFace.init();

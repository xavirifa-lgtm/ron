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
        
        // Limpiar clases previas
        [this.eyes.left, this.eyes.right].forEach(el => {
            el.classList.remove('laugh', 'surprise');
        });

        if (expression === 'laugh') {
            this.eyes.left.classList.add('laugh');
            this.eyes.right.classList.add('laugh');
            this.updateMouth('M 5 15 Q 50 45 95 15'); // Gran sonrisa
        } else if (expression === 'surprise') {
            this.eyes.left.classList.add('surprise');
            this.eyes.right.classList.add('surprise');
            this.updateMouth('M 30 25 Q 50 35 70 25'); // Oh!
        } else {
            this.updateMouth('M 10 20 Q 50 40 90 20'); // Sonrisa suave (Neutral)
        }
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
        // Al hacer click/toque, Ron se sorprende
        document.body.addEventListener('mousedown', () => {
            this.setExpression('surprise');
            this.setTalking(true);
        });
        
        document.body.addEventListener('mouseup', () => {
            setTimeout(() => {
                this.setExpression('neutral');
                this.setTalking(false);
            }, 500);
        });
    }
};

window.onload = () => ronFace.init();

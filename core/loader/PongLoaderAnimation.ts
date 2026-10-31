const STYLE_ID = 'pong-loader-animation-styles';
const ROOT_CLASS = 'pong-loader-animation';

/** One paddle's own feel: how stiff its spring is, how it idles, where on its face it likes to meet the ball. */
interface Paddle {
    el: HTMLDivElement;
    y: number;
    velocity: number;
    /** Spring stiffness and damping (a little under-damped: it overshoots, then settles). */
    stiffness: number;
    damping: number;
    /** While the ball is heading away, it drifts on its own wave (its own speed and phase, so the two never move together). */
    idleSpeed: number;
    idlePhase: number;
    idleAmplitude: number;
    /** Where on its face it aims to meet the ball this rally (-1..1), rerolled each hit: varied angles. */
    aim: number;
    /** 1 on a hit, easing to 0: the paddle recoils and widens. */
    hit: number;
}

/**
 * The loading screen's Pong: a quick, squashy rally. The ball speeds up with every hit, stretches along its
 * direction of travel (more the faster it goes), squashes flat on each bounce and leaves a short fading trail.
 * Each paddle is its own spring, so they lag, overshoot and stretch as they move; the one the ball is
 * heading away from wanders on its own wave, out of step with the other, and each hit makes a paddle recoil.
 */
export class PongLoaderAnimation {
    private static root: HTMLDivElement | null = null;
    private static ball: HTMLDivElement | null = null;
    private static trail: HTMLDivElement[] = [];
    private static paddles: [Paddle, Paddle] | null = null;

    private static animationFrame = 0;
    private static lastTime = 0;
    private static time = 0;

    private static ballX = 0;
    private static ballY = 0;
    private static velocityX = 0;
    private static velocityY = 0;
    /** 1 on a bounce, easing to 0: the ball squashes flat against what it hit. */
    private static squash = 0;
    /** Which way the last bounce pushed: true = off a paddle (squash across X), false = off a wall (across Y). */
    private static squashOnPaddle = true;
    /** Where the ball was over the last frames (newest first), for the trail. */
    private static history: { x: number; y: number }[] = [];

    private static readonly WIDTH = 220;
    private static readonly HEIGHT = 120;

    private static readonly BALL_SIZE = 13;

    private static readonly PADDLE_WIDTH = 10;
    private static readonly PADDLE_HEIGHT = 40;
    private static readonly PADDLE_MARGIN = 10;

    /** Ball speed across (px/s): each rally starts at START, each hit adds SPEED_UP, up to MAX. */
    private static readonly START_SPEED = 240;
    private static readonly SPEED_UP = 1.08;
    private static readonly MAX_SPEED = 430;
    private static readonly MAX_VERTICAL = 260;

    private static readonly TRAIL = 4;

    public static create(parent: HTMLElement): void {
        if (this.root) return;

        this.injectStyles();

        this.root = document.createElement('div');
        this.root.className = ROOT_CLASS;

        const field = document.createElement('div');
        field.className = `${ROOT_CLASS}__field`;

        this.trail = [];
        for (let i = 0; i < this.TRAIL; i++) {
            const ghost = document.createElement('div');
            ghost.className = `${ROOT_CLASS}__ball ${ROOT_CLASS}__ghost`;
            field.appendChild(ghost);
            this.trail.push(ghost);
        }

        const paddle = (stiffness: number, damping: number, idleSpeed: number, idlePhase: number, idleAmplitude: number): Paddle => {
            const el = document.createElement('div');
            el.className = `${ROOT_CLASS}__paddle`;
            field.appendChild(el);
            return { el, y: 0, velocity: 0, stiffness, damping, idleSpeed, idlePhase, idleAmplitude, aim: 0, hit: 0 };
        };
        // Different springs and idle waves: the left one snappier, the right one looser, never in step.
        this.paddles = [paddle(260, 15, 2.6, 0, 34), paddle(190, 11, 1.9, Math.PI * 0.8, 40)];

        this.ball = document.createElement('div');
        this.ball.className = `${ROOT_CLASS}__ball`;
        field.appendChild(this.ball);

        this.root.appendChild(field);
        parent.appendChild(this.root);

        this.reset();

        this.lastTime = performance.now();
        this.animationFrame = requestAnimationFrame(this.update);
    }

    public static remove(): void {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = 0;
        }

        this.root?.remove();

        this.root = null;
        this.ball = null;
        this.trail = [];
        this.paddles = null;
        this.history = [];

        this.lastTime = 0;
    }

    /** A new rally: the ball from the middle at the starting speed, off at a random angle. */
    private static reset(): void {
        this.ballX = this.WIDTH / 2 - this.BALL_SIZE / 2;
        this.ballY = this.HEIGHT / 2 - this.BALL_SIZE / 2;
        this.history = [];

        const direction = Math.random() > 0.5 ? 1 : -1;
        this.velocityX = this.START_SPEED * direction;
        this.velocityY = (90 + Math.random() * 110) * (Math.random() > 0.5 ? 1 : -1);
        this.squash = 0;

        for (const paddle of this.paddles ?? []) {
            paddle.y = this.HEIGHT / 2 - this.PADDLE_HEIGHT / 2;
            paddle.velocity = 0;
            paddle.aim = Math.random() * 1.4 - 0.7;
        }
    }

    private static update = (time: number): void => {
        if (!this.root || !this.ball || !this.paddles) return;

        const delta = Math.min((time - this.lastTime) / 1000, 0.05);
        this.lastTime = time;
        this.time += delta;

        this.updateBall(delta);
        this.updatePaddles(delta);
        this.render();

        this.animationFrame = requestAnimationFrame(this.update);
    };

    private static updateBall(delta: number): void {
        this.history.unshift({ x: this.ballX, y: this.ballY });
        if (this.history.length > this.TRAIL * 2) this.history.pop();

        this.ballX += this.velocityX * delta;
        this.ballY += this.velocityY * delta;
        this.squash = Math.max(0, this.squash - delta * 7);

        if (this.ballY <= 0) {
            this.ballY = 0;
            this.velocityY = Math.abs(this.velocityY);
            this.bounce(false);
        }

        if (this.ballY + this.BALL_SIZE >= this.HEIGHT) {
            this.ballY = this.HEIGHT - this.BALL_SIZE;
            this.velocityY = -Math.abs(this.velocityY);
            this.bounce(false);
        }

        const [left, right] = this.paddles!;
        const leftX = this.PADDLE_MARGIN;
        if (
            this.velocityX < 0 &&
            this.ballX <= leftX + this.PADDLE_WIDTH &&
            this.ballX + this.BALL_SIZE >= leftX &&
            this.ballY + this.BALL_SIZE >= left.y &&
            this.ballY <= left.y + this.PADDLE_HEIGHT
        ) {
            this.ballX = leftX + this.PADDLE_WIDTH;
            this.hitPaddle(left, 1);
        }

        const rightX = this.WIDTH - this.PADDLE_MARGIN - this.PADDLE_WIDTH;
        if (
            this.velocityX > 0 &&
            this.ballX + this.BALL_SIZE >= rightX &&
            this.ballX <= rightX + this.PADDLE_WIDTH &&
            this.ballY + this.BALL_SIZE >= right.y &&
            this.ballY <= right.y + this.PADDLE_HEIGHT
        ) {
            this.ballX = rightX - this.BALL_SIZE;
            this.hitPaddle(right, -1);
        }

        if (this.ballX < -30 || this.ballX > this.WIDTH + 30) {
            this.reset();
        }
    }

    /** The ball off a paddle: back the other way, faster, angled by where it met the face; the paddle recoils. */
    private static hitPaddle(paddle: Paddle, direction: 1 | -1): void {
        const speed = Math.min(this.MAX_SPEED, Math.abs(this.velocityX) * this.SPEED_UP);
        this.velocityX = speed * direction;

        const offset = (this.ballY + this.BALL_SIZE / 2 - (paddle.y + this.PADDLE_HEIGHT / 2)) / (this.PADDLE_HEIGHT / 2);
        // The paddle's own movement carries into the ball too: a swipe sends it off steeper.
        this.velocityY += offset * 120 + paddle.velocity * 0.25;
        this.velocityY = Math.max(-this.MAX_VERTICAL, Math.min(this.MAX_VERTICAL, this.velocityY));
        if (Math.abs(this.velocityY) < 50) this.velocityY = 50 * (Math.sign(this.velocityY) || 1);

        paddle.hit = 1;
        // Next time it meets the ball somewhere else on its face.
        paddle.aim = Math.random() * 1.4 - 0.7;
        this.bounce(true);
    }

    private static bounce(onPaddle: boolean): void {
        this.squash = onPaddle ? 1 : 0.7;
        this.squashOnPaddle = onPaddle;
    }

    private static updatePaddles(delta: number): void {
        const [left, right] = this.paddles!;
        const middle = this.HEIGHT / 2 - this.PADDLE_HEIGHT / 2;
        const ballTarget = (paddle: Paddle) => this.ballY + this.BALL_SIZE / 2 - this.PADDLE_HEIGHT / 2 - paddle.aim * (this.PADDLE_HEIGHT / 2);
        const idle = (paddle: Paddle) => middle + Math.sin(this.time * paddle.idleSpeed + paddle.idlePhase) * paddle.idleAmplitude;

        // The paddle the ball heads for chases it; the other one wanders on its own wave.
        this.spring(left, this.velocityX < 0 ? ballTarget(left) : idle(left), delta);
        this.spring(right, this.velocityX > 0 ? ballTarget(right) : idle(right), delta);
    }

    /** Pulls a paddle towards `target` on its spring (overshooting a little), kept inside the field. */
    private static spring(paddle: Paddle, target: number, delta: number): void {
        const pull = paddle.stiffness * (target - paddle.y) - paddle.damping * paddle.velocity;
        paddle.velocity += pull * delta;
        paddle.y += paddle.velocity * delta;
        const max = this.HEIGHT - this.PADDLE_HEIGHT;
        if (paddle.y < 0 || paddle.y > max) {
            paddle.y = Math.max(0, Math.min(max, paddle.y));
            // A soft bump off the edge rather than a dead stop.
            paddle.velocity *= -0.3;
        }
        paddle.hit = Math.max(0, paddle.hit - delta * 6);
    }

    private static render(): void {
        if (!this.ball || !this.paddles) return;

        // Stretched along its path, more the faster it goes; squashed flat against whatever it just bounced off.
        const speed = Math.hypot(this.velocityX, this.velocityY);
        const stretch = 1 + Math.min(0.75, speed / 650);
        const angle = Math.atan2(this.velocityY, this.velocityX);
        const ease = this.squash * this.squash;
        let transform: string;
        if (ease > 0.01) {
            // A squash is across the bounce: flat along X off a paddle, along Y off a wall.
            const flat = 1 - 0.45 * ease;
            const wide = 1 + 0.5 * ease;
            transform = this.squashOnPaddle ? `scale(${flat}, ${wide})` : `scale(${wide}, ${flat})`;
        } else {
            transform = `rotate(${angle}rad) scale(${stretch}, ${1 / Math.sqrt(stretch)})`;
        }
        this.ball.style.transform = `translate3d(${this.ballX}px, ${this.ballY}px, 0) ${transform}`;

        // The trail: older positions, smaller and fainter.
        for (let i = 0; i < this.trail.length; i++) {
            const ghost = this.trail[i];
            const point = this.history[(i + 1) * 2 - 1];
            if (!point) {
                ghost.style.opacity = '0';
                continue;
            }
            const fade = 1 - (i + 1) / (this.trail.length + 1);
            ghost.style.opacity = String(0.35 * fade * Math.min(1, speed / this.MAX_SPEED + 0.3));
            ghost.style.transform = `translate3d(${point.x}px, ${point.y}px, 0) rotate(${angle}rad) scale(${0.55 + fade * 0.4})`;
        }

        // Paddles stretch tall while they move fast (thinner to keep their volume), and recoil out and wide on a hit.
        const rightX = this.WIDTH - this.PADDLE_MARGIN - this.PADDLE_WIDTH;
        this.paddles.forEach((paddle, i) => {
            const motion = Math.min(0.45, Math.abs(paddle.velocity) / 900);
            const hit = paddle.hit * paddle.hit;
            const scaleY = (1 + motion) * (1 - 0.18 * hit);
            const scaleX = (1 / Math.sqrt(1 + motion)) * (1 + 0.6 * hit);
            const recoil = (i === 0 ? -1 : 1) * hit * 5;
            const x = (i === 0 ? this.PADDLE_MARGIN : rightX) + recoil;
            paddle.el.style.transform = `translate3d(${x}px, ${paddle.y}px, 0) scale(${scaleX}, ${scaleY})`;
        });
    }

    private static injectStyles(): void {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');

        style.id = STYLE_ID;

        style.textContent = `
            .${ROOT_CLASS} {
                position: relative;
                width: ${this.WIDTH}px;
                height: ${this.HEIGHT}px;
                margin-bottom: 24px;
                flex-shrink: 0;
            }

            .${ROOT_CLASS}__field {
                position: relative;
                width: 100%;
                height: 100%;
                overflow: hidden;
            }

            .${ROOT_CLASS}__paddle {
                position: absolute;
                left: 0;
                top: 0;

                width: ${this.PADDLE_WIDTH}px;
                height: ${this.PADDLE_HEIGHT}px;

                border-radius: 999px;
                background: var(--loader-accent, #ffffff);
                box-shadow: var(--loader-accent-shadow, none);

                transform-origin: 50% 50%;
                will-change: transform;
            }

            .${ROOT_CLASS}__ball {
                position: absolute;
                left: 0;
                top: 0;

                width: ${this.BALL_SIZE}px;
                height: ${this.BALL_SIZE}px;

                border-radius: 50%;
                background: var(--loader-accent, #ffffff);
                box-shadow: var(--loader-accent-shadow, none);

                transform-origin: 50% 50%;
                will-change: transform;
            }

            .${ROOT_CLASS}__ghost {
                box-shadow: none;
                opacity: 0;
            }
        `;

        document.head.appendChild(style);
    }
}

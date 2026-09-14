const STYLE_ID = 'pong-loader-animation-styles';
const ROOT_CLASS = 'pong-loader-animation';

export class PongLoaderAnimation {
    private static root: HTMLDivElement | null = null;
    private static ball: HTMLDivElement | null = null;
    private static leftPaddle: HTMLDivElement | null = null;
    private static rightPaddle: HTMLDivElement | null = null;

    private static animationFrame = 0;
    private static lastTime = 0;

    private static ballX = 0;
    private static ballY = 0;

    private static velocityX = 150;
    private static velocityY = 100;

    private static leftY = 0;
    private static rightY = 0;

    private static readonly WIDTH = 220;
    private static readonly HEIGHT = 120;

    private static readonly BALL_SIZE = 12;

    private static readonly PADDLE_WIDTH = 10;
    private static readonly PADDLE_HEIGHT = 42;

    private static readonly PADDLE_MARGIN = 10;

    public static create(parent: HTMLElement): void {
        if (this.root) return;

        this.injectStyles();

        this.root = document.createElement('div');
        this.root.className = ROOT_CLASS;

        const field = document.createElement('div');
        field.className = `${ROOT_CLASS}__field`;

        this.leftPaddle = document.createElement('div');
        this.leftPaddle.className = `${ROOT_CLASS}__paddle`;

        this.rightPaddle = document.createElement('div');
        this.rightPaddle.className = `${ROOT_CLASS}__paddle`;

        this.ball = document.createElement('div');
        this.ball.className = `${ROOT_CLASS}__ball`;

        field.appendChild(this.leftPaddle);
        field.appendChild(this.rightPaddle);
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
        this.leftPaddle = null;
        this.rightPaddle = null;

        this.lastTime = 0;
    }

    private static reset(): void {
        this.ballX = this.WIDTH / 2 - this.BALL_SIZE / 2;
        this.ballY = this.HEIGHT / 2 - this.BALL_SIZE / 2;

        this.leftY = this.HEIGHT / 2 - this.PADDLE_HEIGHT / 2;
        this.rightY = this.leftY;

        const direction = Math.random() > 0.5 ? 1 : -1;

        this.velocityX = 145 * direction;
        this.velocityY =
            (70 + Math.random() * 70) *
            (Math.random() > 0.5 ? 1 : -1);
    }

    private static update = (time: number): void => {
        if (
            !this.root ||
            !this.ball ||
            !this.leftPaddle ||
            !this.rightPaddle
        ) {
            return;
        }

        const delta = Math.min((time - this.lastTime) / 1000, 0.05);
        this.lastTime = time;

        this.updateBall(delta);
        this.updatePaddles(delta);
        this.render();

        this.animationFrame = requestAnimationFrame(this.update);
    };

    private static updateBall(delta: number): void {
        this.ballX += this.velocityX * delta;
        this.ballY += this.velocityY * delta;

        if (this.ballY <= 0) {
            this.ballY = 0;
            this.velocityY = Math.abs(this.velocityY);
        }

        if (this.ballY + this.BALL_SIZE >= this.HEIGHT) {
            this.ballY = this.HEIGHT - this.BALL_SIZE;
            this.velocityY = -Math.abs(this.velocityY);
        }

        const leftPaddleX = this.PADDLE_MARGIN;

        if (
            this.velocityX < 0 &&
            this.ballX <= leftPaddleX + this.PADDLE_WIDTH &&
            this.ballX + this.BALL_SIZE >= leftPaddleX &&
            this.ballY + this.BALL_SIZE >= this.leftY &&
            this.ballY <= this.leftY + this.PADDLE_HEIGHT
        ) {
            this.ballX = leftPaddleX + this.PADDLE_WIDTH;
            this.velocityX = Math.abs(this.velocityX);

            this.addPaddleBounce(this.leftY);
        }

        const rightPaddleX =
            this.WIDTH -
            this.PADDLE_MARGIN -
            this.PADDLE_WIDTH;

        if (
            this.velocityX > 0 &&
            this.ballX + this.BALL_SIZE >= rightPaddleX &&
            this.ballX <= rightPaddleX + this.PADDLE_WIDTH &&
            this.ballY + this.BALL_SIZE >= this.rightY &&
            this.ballY <= this.rightY + this.PADDLE_HEIGHT
        ) {
            this.ballX = rightPaddleX - this.BALL_SIZE;
            this.velocityX = -Math.abs(this.velocityX);

            this.addPaddleBounce(this.rightY);
        }

        if (
            this.ballX < -30 ||
            this.ballX > this.WIDTH + 30
        ) {
            this.reset();
        }
    }

    private static addPaddleBounce(paddleY: number): void {
        const paddleCenter = paddleY + this.PADDLE_HEIGHT / 2;
        const ballCenter = this.ballY + this.BALL_SIZE / 2;

        const normalizedOffset =
            (ballCenter - paddleCenter) /
            (this.PADDLE_HEIGHT / 2);

        this.velocityY += normalizedOffset * 45;

        const maxVelocityY = 160;

        this.velocityY = Math.max(
            -maxVelocityY,
            Math.min(maxVelocityY, this.velocityY),
        );
    }

    private static updatePaddles(delta: number): void {
        const targetY =
            this.ballY +
            this.BALL_SIZE / 2 -
            this.PADDLE_HEIGHT / 2;

        this.leftY = this.moveTowards(
            this.leftY,
            targetY,
            115 * delta,
        );

        this.rightY = this.moveTowards(
            this.rightY,
            targetY,
            105 * delta,
        );

        this.leftY = this.clampPaddle(this.leftY);
        this.rightY = this.clampPaddle(this.rightY);
    }

    private static moveTowards(
        current: number,
        target: number,
        maxDelta: number,
    ): number {
        const difference = target - current;

        if (Math.abs(difference) <= maxDelta) {
            return target;
        }

        return current + Math.sign(difference) * maxDelta;
    }

    private static clampPaddle(value: number): number {
        return Math.max(
            0,
            Math.min(
                this.HEIGHT - this.PADDLE_HEIGHT,
                value,
            ),
        );
    }

    private static render(): void {
        if (
            !this.ball ||
            !this.leftPaddle ||
            !this.rightPaddle
        ) {
            return;
        }

        this.ball.style.transform =
            `translate3d(${this.ballX}px, ${this.ballY}px, 0)`;

        this.leftPaddle.style.transform =
            `translate3d(${this.PADDLE_MARGIN}px, ${this.leftY}px, 0)`;

        const rightX =
            this.WIDTH -
            this.PADDLE_MARGIN -
            this.PADDLE_WIDTH;

        this.rightPaddle.style.transform =
            `translate3d(${rightX}px, ${this.rightY}px, 0)`;
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
                background: #ffffff;

                will-change: transform;
            }

            .${ROOT_CLASS}__ball {
                position: absolute;
                left: 0;
                top: 0;

                width: ${this.BALL_SIZE}px;
                height: ${this.BALL_SIZE}px;

                border-radius: 50%;
                background: #ffffff;

                will-change: transform;
            }
        `;

        document.head.appendChild(style);
    }
}
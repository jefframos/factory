import { LoaderConfig } from './LoaderConfig';
import { PongLoaderAnimation } from './PongLoaderAnimation';

const STYLE_ID = 'html-loader-styles';

function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;

    style.textContent = `
        .html-loader {
            position: fixed;
            inset: 0;
            z-index: 9999;

            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;

            background-color: var(--loader-bg, #111111);

            transition: opacity var(--loader-fade, 400ms) ease;
            opacity: 1;
        }

        .html-loader.is-hidden {
            opacity: 0;
            pointer-events: none;
        }

        .html-loader__pattern {
            position: absolute;
            inset: 0;

            background-image: var(--loader-pattern-image, none);
            background-size: var(--loader-pattern-size, auto);
            background-repeat: repeat;

            opacity: var(--loader-pattern-opacity, 0.15);

            pointer-events: none;
        }

        .html-loader__content {
            position: relative;
            z-index: 1;

            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
        }

        .html-loader__bar {
            position: relative;

            width: var(--loader-bar-width, 300px);
            height: var(--loader-bar-height, 24px);

            background-color: var(
                --loader-bar-bg,
                rgba(255, 255, 255, 0.15)
            );

            border-style: solid;
            border-color: var(--loader-bar-border-color, #ffffff);
            border-width: var(--loader-bar-border-width, 2px);
            border-radius: var(--loader-bar-radius, 999px);

            overflow: hidden;
        }

        .html-loader__bar-fill {
            height: 100%;
            width: 0%;

            background-color: var(--loader-bar-fill, #ffffff);

            transition: width 120ms ease-out;
        }
    `;

    document.head.appendChild(style);
}

/**
 * Pure HTML/CSS boot loader.
 *
 * Paints as soon as the constructor runs, with no PIXI/Application dependency,
 * so it can be created before the platform SDK or asset pipeline finishes.
 */
export default class HtmlLoader {
    /**
     * Must be >= the bar-fill CSS transition duration so 100%
     * is visible before the overlay fades.
     */
    private static readonly FILL_SETTLE_MS = 150;

    private root: HTMLDivElement;
    private fill: HTMLDivElement;
    private fadeDuration: number;

    constructor(config: LoaderConfig = {}) {
        injectStyles();

        const bar = config.bar ?? {};

        this.fadeDuration = config.fadeDuration ?? 400;

        this.root = document.createElement('div');
        this.root.className = 'html-loader';

        this.root.style.setProperty(
            '--loader-bg',
            config.backgroundColor ?? '#111111',
        );

        this.root.style.setProperty(
            '--loader-fade',
            `${this.fadeDuration}ms`,
        );

        this.root.style.setProperty(
            '--loader-bar-width',
            bar.width ?? '300px',
        );

        this.root.style.setProperty(
            '--loader-bar-height',
            bar.height ?? '24px',
        );

        this.root.style.setProperty(
            '--loader-bar-bg',
            bar.backgroundColor ?? 'rgba(255, 255, 255, 0.15)',
        );

        this.root.style.setProperty(
            '--loader-bar-border-color',
            bar.borderColor ?? '#ffffff',
        );

        this.root.style.setProperty(
            '--loader-bar-border-width',
            bar.borderWidth ?? '2px',
        );

        this.root.style.setProperty(
            '--loader-bar-radius',
            bar.borderRadius ?? '999px',
        );

        this.root.style.setProperty(
            '--loader-bar-fill',
            bar.fillColor ?? '#ffffff',
        );

        if (config.pattern?.image) {
            const pattern = document.createElement('div');
            pattern.className = 'html-loader__pattern';

            pattern.style.setProperty(
                '--loader-pattern-image',
                `url('${config.pattern.image}')`,
            );

            pattern.style.setProperty(
                '--loader-pattern-size',
                config.pattern.size ?? 'auto',
            );

            pattern.style.setProperty(
                '--loader-pattern-opacity',
                String(config.pattern.opacity ?? 0.15),
            );

            this.root.appendChild(pattern);
        }

        /**
         * Keep Pong + progress bar in one centered content container.
         * This also prevents the background pattern from interfering
         * with the flex layout.
         */
        const content = document.createElement('div');
        content.className = 'html-loader__content';

        /**
         * Pong first = Pong above the progress bar.
         */
        PongLoaderAnimation.create(content);

        const barEl = document.createElement('div');
        barEl.className = 'html-loader__bar';

        this.fill = document.createElement('div');
        this.fill.className = 'html-loader__bar-fill';

        barEl.appendChild(this.fill);
        content.appendChild(barEl);

        this.root.appendChild(content);

        document.body.appendChild(this.root);
    }

    /** percent: 0-1 */
    public updateLoader(percent: number): void {
        const clamped = Math.max(0, Math.min(1, percent));

        this.fill.style.width = `${clamped * 100}%`;
    }

    /**
     * Snaps the bar to 100%, lets that fill animate into view,
     * then fades the whole overlay out and removes it from the DOM.
     */
    public hide(): void {
        this.updateLoader(1);

        window.setTimeout(() => {
            this.root.classList.add('is-hidden');

            window.setTimeout(() => {
                PongLoaderAnimation.remove();
                this.root.remove();
            }, this.fadeDuration);
        }, HtmlLoader.FILL_SETTLE_MS);
    }
}
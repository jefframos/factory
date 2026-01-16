import * as PIXI from 'pixi.js';
import { Signal } from 'signals';

type KeyDir = 'left' | 'right' | 'up' | 'down';

const keyMap: Record<string, KeyDir> = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
    w: 'up',
    s: 'down',
    a: 'left',
    d: 'right',
    W: 'up',
    S: 'down',
    A: 'left',
    D: 'right',
};

export default class KeyboardInputMovement {
    public onMove: Signal = new Signal();

    private held: Set<KeyDir> = new Set();
    private history: KeyDir[] = [];

    constructor() {
        window.addEventListener('keydown', this.onKeyDown);
        window.addEventListener('keyup', this.onKeyUp);
    }

    private onKeyDown = (e: KeyboardEvent) => {
        const dir = keyMap[e.key];
        if (!dir) return;

        if (!this.held.has(dir)) {
            this.held.add(dir);
            this.history.push(dir);
        }

        this.updateDirection();
    };

    private onKeyUp = (e: KeyboardEvent) => {
        const dir = keyMap[e.key];
        if (!dir) return;

        if (this.held.has(dir)) {
            this.held.delete(dir);
            this.history = this.history.filter(d => d !== dir);
        }

        this.updateDirection();
    };

    private updateDirection() {
        let x = 0, y = 0;

        // Process active keys from latest to oldest
        for (let i = this.history.length - 1; i >= 0; i--) {
            const dir = this.history[i];
            if (!this.held.has(dir)) continue;
            switch (dir) {
                case 'left': x = -1; break;
                case 'right': x = 1; break;
                case 'up': y = -1; break;
                case 'down': y = 1; break;
            }
            break; // prioritize the most recent
        }

        // Add extra direction if applicable
        for (const dir of this.held) {
            switch (dir) {
                case 'left': x = x === 0 ? -1 : x; break;
                case 'right': x = x === 0 ? 1 : x; break;
                case 'up': y = y === 0 ? -1 : y; break;
                case 'down': y = y === 0 ? 1 : y; break;
            }
        }

        const direction = new PIXI.Point(x, y);
        const magnitude = direction.x === 0 && direction.y === 0 ? 0 : 1;

        if (magnitude) {
            const len = Math.hypot(direction.x, direction.y);
            direction.x /= len;
            direction.y /= len;
        }

        this.onMove.dispatch({ direction, magnitude });
    }

    public destroy() {
        window.removeEventListener('keydown', this.onKeyDown);
        window.removeEventListener('keyup', this.onKeyUp);
    }
}

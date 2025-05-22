import { Signal } from 'signals';

export type Direction = 'up' | 'down' | 'left' | 'right';

export default class SwipeInputManager {
    public onMove: Signal = new Signal();

    private startX = 0;
    private startY = 0;
    private readonly threshold = 30; // Minimum swipe distance

    constructor() {
        window.addEventListener('keydown', this.handleKey);
        window.addEventListener('touchstart', this.handleTouchStart, { passive: true });
        window.addEventListener('touchend', this.handleTouchEnd);
    }

    private handleKey = (e: KeyboardEvent) => {
        switch (e.key) {
            case 'ArrowUp':
            case 'w':
            case 'W':
                this.onMove.dispatch('up');
                break;
            case 'ArrowDown':
            case 's':
            case 'S':
                this.onMove.dispatch('down');
                break;
            case 'ArrowLeft':
            case 'a':
            case 'A':
                this.onMove.dispatch('left');
                break;
            case 'ArrowRight':
            case 'd':
            case 'D':
                this.onMove.dispatch('right');
                break;
        }
    };

    private handleTouchStart = (e: TouchEvent) => {
        const touch = e.changedTouches[0];
        this.startX = touch.clientX;
        this.startY = touch.clientY;
    };

    private handleTouchEnd = (e: TouchEvent) => {
        const touch = e.changedTouches[0];
        const deltaX = touch.clientX - this.startX;
        const deltaY = touch.clientY - this.startY;

        if (Math.abs(deltaX) > Math.abs(deltaY)) {
            // Horizontal swipe
            if (Math.abs(deltaX) > this.threshold) {
                this.onMove.dispatch(deltaX > 0 ? 'right' : 'left');
            }
        } else {
            // Vertical swipe
            if (Math.abs(deltaY) > this.threshold) {
                this.onMove.dispatch(deltaY > 0 ? 'down' : 'up');
            }
        }
    };

    public destroy() {
        window.removeEventListener('keydown', this.handleKey);
        window.removeEventListener('touchstart', this.handleTouchStart);
        window.removeEventListener('touchend', this.handleTouchEnd);
    }
}

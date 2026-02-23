export enum InputMode {
    HOLD,    // Fires every frame the key is down (e.g., Accelerating)
    PRESSED, // Fires exactly once when the key is first hit (e.g., Jumping)
    RELEASED // Fires exactly once when the key is let go
}

type InputCallback = () => void;

interface Binding {
    codes: string[];
    mode: InputMode;
    callback: InputCallback;
    isProcessed: boolean; // Used to track "Pressed" state
}

export class InputBinder {
    private keysDown: Set<string> = new Set();
    private bindings: Binding[] = [];

    constructor() {
        window.addEventListener('keydown', (e) => this.keysDown.add(e.code));
        window.addEventListener('keyup', (e) => {
            this.keysDown.delete(e.code);
            // Reset "Processed" state for PRESSED mode when key is released
            this.bindings.forEach(b => {
                if (b.codes.includes(e.code)) {
                    if (b.mode === InputMode.RELEASED) b.callback();
                    b.isProcessed = false;
                }
            });
        });
    }

    /**
     * Bind an action to one or more keys.
     */
    public bind(codes: string | string[], mode: InputMode, callback: InputCallback): void {
        this.bindings.push({
            codes: Array.isArray(codes) ? codes : [codes],
            mode,
            callback,
            isProcessed: false
        });
    }

    /**
     * Call this inside your game loop (update).
     */
    public update(): void {
        for (const binding of this.bindings) {
            const isAnyKeyDown = binding.codes.some(code => this.keysDown.has(code));

            if (isAnyKeyDown) {
                if (binding.mode === InputMode.HOLD) {
                    binding.callback();
                }
                else if (binding.mode === InputMode.PRESSED && !binding.isProcessed) {
                    binding.callback();
                    binding.isProcessed = true; // Block until key is released
                }
            } else {
                // If no keys for this binding are down, reset the processed flag
                binding.isProcessed = false;
            }
        }
    }
}
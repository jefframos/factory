// waitForFirstInput.ts
//
// Fires `onStart` once, on the first genuine keydown or pointerdown seen
// AFTER this is called — used by the minigame scenes so a scene doesn't
// launch the player straight into automatic runner movement using whatever
// input state carried over from crossing the hub's own entry gate a moment
// earlier. A STILL-HELD key/touch from before the scene switch doesn't
// spuriously trigger this: a held key only ever re-fires 'keydown' as a
// repeat (filtered out below), and a continuously-held pointer never fires
// a new 'pointerdown' at all — only an actual fresh press/tap does, on
// either input, so this is naturally immune to that carry-over.
//
// Returns a cancel function — call it if the scene is destroyed before the
// player ever provides that first input, so the listeners don't leak (see
// WorldEnvironment.destroy()'s own doc on why leaked window listeners are a
// real, previously-hit problem in this project).

export function waitForFirstInput(onStart: () => void): () => void {
    const handleKeyDown = (e: KeyboardEvent): void => {
        if (e.repeat) {
            return;
        }
        trigger();
    };

    const handlePointerDown = (): void => {
        trigger();
    };

    function trigger(): void {
        cancel();
        onStart();
    }

    function cancel(): void {
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('pointerdown', handlePointerDown);
    }

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('pointerdown', handlePointerDown);

    return cancel;
}

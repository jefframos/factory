// Tuning.ts
//
// The feel of the game, in one place (the debug panel's sliders change these live): how fast the ants walk, and how
// long a slot waits between sending two of them. Slow and steady keeps it cozy.

export const TUNING = {
    /** Ant walking speed, world units a second. */
    antSpeed: 5.5,
    /** Seconds between two ants leaving the same slot. */
    releaseSec: 0.2,
};

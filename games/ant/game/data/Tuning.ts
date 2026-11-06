// Tuning.ts
//
// The feel of the game, in one place (the debug panel's sliders change these live): how big the ants are, how fast they
// walk, and how long a slot waits between sending two of them. Slow and steady keeps it cozy.

export const TUNING = {
    /** An ant's length, world units: the same in every level, whatever the picture's pixel size. */
    antSize: 0.85,
    /** Ant walking speed, world units a second. */
    antSpeed: 5.5,
    /** Seconds between two ants leaving the same slot. */
    releaseSec: 0.2,
};

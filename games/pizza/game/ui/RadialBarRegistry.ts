// RadialBarRegistry.ts
//
// Named radial-progress presets — the circular counterpart to BarRegistry.ts,
// turned into a live, progress-settable object by RadialBarComponent.ts.
// Three stacked circles, back to front:
//
//   1. bg      — `radius`, `bgColor`: the outer ring/border.
//   2. fillBg  — `radius - padding`, `fillBgColor`: the empty track.
//   3. fill    — `radius - padding - fillPadding`, `fillColor`: a pie wedge
//                sweeping clockwise from 12 o'clock as progress goes 0 -> 1.
//
// Each style's `fillColor` is read straight off BarRegistry's own entry of the
// SAME name, so 'Green' is the same green whether a readout is a flat bar or a
// radial — only the bg/track colors are new here. Any field can be overridden
// per call too (see RadialBarComponent's constructor), for a one-off size
// without a whole new preset.

import { BarRegistry } from './BarRegistry';

export interface RadialBarStyleDef {
    /** Outer radius of the bg circle, in px. */
    radius: number;
    /** Gap between the bg circle's edge and the fillBg circle's edge — i.e. how thick the outer border reads. */
    padding: number;
    /** Gap between the fillBg circle's edge and the fill wedge's edge — 0 fills the track edge-to-edge, >0 leaves a visible rim of track color around the fill. */
    fillPadding: number;
    bgColor: number;
    fillBgColor: number;
    fillColor: number;
}

/** Shared bg/track look every preset uses unless it overrides it — a dark outline around a slightly lighter, desaturated track, so the tinted fill is the only saturated thing in the readout. */
const DEFAULT_RADIAL: Omit<RadialBarStyleDef, 'fillColor'> = {
    radius: 16,
    padding: 3,
    fillPadding: 2,
    bgColor: 0x1e2433,
    fillBgColor: 0x3b4458,
};

export const RadialBarRegistry = {
    /** FarmCropHud's own growth readout. */
    Green: { ...DEFAULT_RADIAL, fillColor: BarRegistry.Green.fillColor },
    Red: { ...DEFAULT_RADIAL, fillColor: BarRegistry.Red.fillColor },
    Blue: { ...DEFAULT_RADIAL, fillColor: BarRegistry.Blue.fillColor },
    Yellow: { ...DEFAULT_RADIAL, fillColor: BarRegistry.Yellow.fillColor },
} satisfies Record<string, RadialBarStyleDef>;

export type RadialBarStyleName = keyof typeof RadialBarRegistry;

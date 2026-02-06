import * as PIXI from 'pixi.js';
export interface CurveKeyframe {
    time: number;              // 0 to 1
    value: number;   // range for randomized alpha at this point
}
export type CurveKeyframePoint = { time: number; value: [number, number] | [number] };
export type SpawnShape =
    | { type: 'point' }
    | { type: 'rect'; width: number; height: number }
    | { type: 'circle'; radius: number };

export interface ParticleDescriptor {
    texture: PIXI.Texture;
    blendMode?: PIXI.BLEND_MODES;
    anchor?: PIXI.IPointData;

    spawnShape: SpawnShape;

    scaleStartRange: [number, number];

    alphaCurve?: CurveKeyframePoint[];
    scaleCurve?: CurveKeyframePoint[];
    gradientCurve?: CurveKeyframePoint[];

    alphaTransition: number;// alpha lerp speed

    maxLifeRange: [number, number];
    speedRange: [number, number];
    angleRange: [number, number]; // in degrees
}

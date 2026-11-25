// swing.ts
//
// A held tool's swing, as plain maths (There Is Rope's player/toolSwing, the arm's length its own here).
//
// Everything happens in the swing frame: origin at the shoulder, turned so the target is straight ahead (x right, y up, -z
// toward the target). The arm swings in the vertical plane through the target: the hand goes round the shoulder, so a turn
// of the arc is also a change of the hand's pitch.
//
// Phases: wind-up (from wherever the hand was to the raised pose), strike (accelerating down the arc; the contact point
// lands on the target at its end), follow-through (a little past), recover (back to the ready pose).

export type Vec3 = [number, number, number];

export interface SwingSettings {
    /** Seconds of each phase. */
    windup: number;
    strike: number;
    follow: number;
    recover: number;
    /** Degrees the arm is raised back at the top of the wind-up (from the impact). */
    raise: number;
    /** Arm length at the top of the wind-up, times its length at impact (an elbow bend). */
    windupReach: number;
    /** Degrees the tool is tilted up at impact (0: arm, hand and contact point in a line toward the target). */
    hitAngle: number;
    /** Degrees past the impact the arm goes on (the head bites in). */
    followThrough: number;
}

/** How a tool sits in the hand: degrees and scale, its grip at the mesh's origin; `contact`: the point that hits, in the mesh. */
export interface HoldPose {
    rotation: Vec3;
    scale: number;
    contact: Vec3;
    /** Half its handle's thickness, in the mesh (the fingers close to it). */
    grip?: number;
}

/** A hand in the swing frame: its centre, its pitch and roll (radians). */
export interface HandPose {
    pos: Vec3;
    pitch: number;
    roll: number;
}

/** How far a hand gets from the shoulder (metres), and the shoulder from the eyes: out to the side, and down. */
export const ARM_LENGTH = 1.25;
export const SHOULDER = { side: 0.16, down: 0.2 };

const DEG = Math.PI / 180;

export const swingDuration = (s: SwingSettings): number => s.windup + s.strike + s.follow + s.recover;

/** Seconds from the start to the contact point reaching the target. */
export const swingLands = (s: SwingSettings): number => s.windup + s.strike;

/** XYZ Euler (radians: Rx Ry Rz) applied to a vector. */
function rotateXYZ([x, y, z]: Vec3, rx: number, ry: number, rz: number): Vec3 {
    let c = Math.cos(rz);
    let s = Math.sin(rz);
    [x, y] = [x * c - y * s, x * s + y * c];
    c = Math.cos(ry);
    s = Math.sin(ry);
    [x, z] = [x * c + z * s, -x * s + z * c];
    c = Math.cos(rx);
    s = Math.sin(rx);
    [y, z] = [y * c - z * s, y * s + z * c];
    return [x, y, z];
}

/** Rotation about x (the arc's axis): positive raises what's in front. */
function rotateX([x, y, z]: Vec3, a: number): Vec3 {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return [x, y * c - z * s, y * s + z * c];
}

/** The tool's contact point in the right hand's space (the fist's centre; x right, y up, z toward the viewer). */
export function contactInHand(hold: HoldPose): Vec3 {
    const local: Vec3 = [hold.contact[0] * hold.scale, hold.contact[1] * hold.scale, hold.contact[2] * hold.scale];
    return rotateXYZ(local, hold.rotation[0] * DEG, hold.rotation[1] * DEG, hold.rotation[2] * DEG);
}

/**
 * The hand at impact: pitched so the contact point lies `hitAngle` above the shoulder-to-target line, and placed so it's on
 * the target; if that would need a longer arm, the target is brought in along the line until the hand reaches.
 */
function impact(s: SwingSettings, contact: Vec3, target: Vec3): HandPose {
    const solve = (ty: number, tz: number): HandPose => {
        const elevation = Math.atan2(ty, -tz);
        const contactElevation = Math.atan2(contact[1], -contact[2]);
        const pitch = elevation + s.hitAngle * DEG - contactElevation;
        const offset = rotateX(contact, pitch);
        return { pos: [-contact[0], ty - offset[1], tz - offset[2]], pitch, roll: 0 };
    };
    const [, ty, tz] = target;
    const arm = (pose: HandPose) => Math.hypot(pose.pos[0], pose.pos[1], pose.pos[2]);
    const full = solve(ty, tz);
    if (arm(full) <= ARM_LENGTH) return full;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 20; i++) {
        const mid = (lo + hi) / 2;
        if (arm(solve(ty * mid, tz * mid)) <= ARM_LENGTH) lo = mid;
        else hi = mid;
    }
    return solve(ty * lo, tz * lo);
}

/** The hand on the arc, `angle` radians back from the impact (positive: raised). */
function onArc(s: SwingSettings, hit: HandPose, angle: number): HandPose {
    const raise = s.raise * DEG;
    const t = raise > 0 && angle > 0 ? Math.min(1, angle / raise) : 0;
    // The arm shortens toward the top of the wind-up (the elbow bends).
    const k = 1 + (s.windupReach - 1) * t;
    return { pos: rotateX([hit.pos[0], hit.pos[1] * k, hit.pos[2] * k], angle), pitch: hit.pitch + angle, roll: 0 };
}

export function mixPose(a: HandPose, b: HandPose, t: number): HandPose {
    const lerp = (x: number, y: number) => x + (y - x) * t;
    return {
        pos: [lerp(a.pos[0], b.pos[0]), lerp(a.pos[1], b.pos[1]), lerp(a.pos[2], b.pos[2])],
        pitch: lerp(a.pitch, b.pitch),
        roll: lerp(a.roll, b.roll),
    };
}

const easeInOut = (t: number) => t * t * (3 - 2 * t);
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/**
 * A hit without the arm's swing (a fast arc from behind is hard on the eyes): the arm only stirs, then it's there at once, the
 * wrist cocked; the hand and the tool flick down onto the spot (that's when it lands), press in, spring back a little; and it
 * all comes back smoothly, the wrist a little behind. Seconds, metres, radians (`cock`: how far back the tool's tilted before
 * the flick, `past`: how far it goes past, `rebound`: how far it springs back).
 */
export const SNAP = { stir: 0.05, flick: 0.06, hold: 0.09, back: 0.32, up: 0.035, behind: 0.03, pitch: 0.4, cock: 0.95, past: 0.14, rebound: 0.2, lag: 0.3 };

/** Seconds to its landing, and in all. */
export const snapLands = SNAP.stir + SNAP.flick;
export const snapDuration = snapLands + SNAP.hold + SNAP.back;

/** The hand `t` seconds into such a hit. */
export function snapPose(s: SwingSettings, contact: Vec3, target: Vec3, from: HandPose, ready: HandPose, t: number): HandPose {
    if (t < SNAP.stir) {
        const k = easeOut(clamp01(t / SNAP.stir));
        return { pos: [from.pos[0], from.pos[1] + SNAP.up * k, from.pos[2] + SNAP.behind * k], pitch: from.pitch + SNAP.pitch * k, roll: from.roll };
    }
    t -= SNAP.stir;
    const hit = impact(s, contact, target);
    // (About the wrist: the hand stays where it'll hit from.)
    const tilted = (tilt: number): HandPose => ({ pos: hit.pos, pitch: hit.pitch + tilt, roll: hit.roll });
    if (t < SNAP.flick) {
        // Faster and faster, onto the spot.
        const k = clamp01(t / SNAP.flick);
        return tilted(SNAP.cock * (1 - k * k));
    }
    t -= SNAP.flick;
    if (t < SNAP.hold) {
        // Past it, and springing back.
        const k = clamp01(t / SNAP.hold);
        return tilted(k < 0.35 ? -SNAP.past * Math.sin((k / 0.35) * Math.PI * 0.5) : -SNAP.past + (SNAP.past + SNAP.rebound) * easeInOut((k - 0.35) / 0.65));
    }
    t -= SNAP.hold;
    const k = clamp01(t / SNAP.back);
    const back = mixPose(tilted(SNAP.rebound), ready, easeInOut(k));
    return { ...back, pitch: back.pitch + SNAP.lag * Math.sin(k * Math.PI) };
}

/** The hand `t` seconds into a swing: out of `from` (where it was), back to `ready`. */
export function swingPose(s: SwingSettings, contact: Vec3, target: Vec3, from: HandPose, ready: HandPose, t: number): HandPose {
    const hit = impact(s, contact, target);
    if (t < s.windup) return mixPose(from, onArc(s, hit, s.raise * DEG), easeInOut(clamp01(t / s.windup)));
    t -= s.windup;
    if (t < s.strike) {
        // Slow off the top, fastest at the wall.
        const e = clamp01(t / s.strike);
        return onArc(s, hit, s.raise * DEG * (1 - e * e));
    }
    t -= s.strike;
    if (t < s.follow) return onArc(s, hit, -s.followThrough * DEG * easeOut(clamp01(t / s.follow)));
    t -= s.follow;
    const end = onArc(s, hit, -s.followThrough * DEG);
    return mixPose(end, ready, easeInOut(clamp01(t / s.recover)));
}

// PerformanceConfig.ts
//
// One place to tune "how far/how much renders" — as opposed to WorldConfig.ts
// (what's IN the world) or MeshConfig.ts (what things LOOK like). A plain
// mutable object, not individual `const`s, so DevGuiManager's dat.GUI sliders
// (see PizzaScene.setupDebugGui()) can bind straight to its properties and
// have every reader — WorldManager.update()'s per-frame distance check,
// ResourceNode's pop-in/out tween durations, PizzaScene's camera far plane —
// pick up the new value immediately, no rebuild/restart needed.
//
// Nothing here is squared/cached at module scope (unlike the old
// LOAD_RADIUS_SQ in WorldConfig.ts) precisely because a cached value
// wouldn't change when a slider drags PERFORMANCE_CONFIG.resourceLoadRadius —
// callers square it fresh each time they read it.

export const PERFORMANCE_CONFIG = {
    /**
     * THREE.PerspectiveCamera far clip plane, world units — see PizzaScene's constructor,
     * which applies this once at startup, and setupDebugGui()'s "Camera Far" slider, which
     * re-applies it (and the required updateProjectionMatrix()) on change. Geometry beyond
     * this is never rendered no matter what else is tuned — raise this FIRST if increasing
     * resourceLoadRadius/UnloadRadius below doesn't seem to make anything render further.
     */
    cameraFar: 1000,

    /**
     * A resource node (tree/rock/etc.) only gets a live mesh + physics once the player is
     * within this radius — see WorldManager.update(). This is the actual "mesh render
     * radius" knob for resources: raise it to have them appear/stay visible further out.
     */
    resourceLoadRadius: 30,
    /**
     * ...and stays materialized until the player drifts out past this LARGER radius —
     * deliberately wider than resourceLoadRadius so a resource sitting right at the
     * boundary doesn't load/unload every frame as the player jitters back and forth across
     * one line. Keep this comfortably above resourceLoadRadius when tuning either.
     */
    resourceUnloadRadius: 34,

    /**
     * How long ResourceNode.playSpawnIn()/playDespawnOut() take to scale a resource in/out
     * — see ResourceNode.ts. Raising resourceLoadRadius/UnloadRadius moves WHERE
     * materialize/dematerialize happens (ideally off-screen); these instead soften what it
     * looks like when it does happen, in case the camera's zoomed out enough to still catch
     * it. 0 disables the animation entirely (mesh just snaps to full/zero scale).
     */
    resourcePopInSec: 0.35,
    resourcePopOutSec: 0.25,
};

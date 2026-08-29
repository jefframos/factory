// TriggerTypes.ts
//
// A designer-placed trigger volume (a Tiled "trigger" mapSettings object — see
// WorldObjectRegistry.ts's own doc; a new "type" string needs no registration there, it's
// bucketed automatically) that marks its own id ACTIVATED (see TriggerStorage.ts) the instant
// the player walks into it. Deliberately just that — no effect/action config here at all.
// What activating a trigger actually DOES (unlock a zone, open a gate, ...) lives entirely on
// the CONSUMER side, as MilestoneRequirement.ts's own 'trigger' kind, which any Zone/Gate/
// Queue/Shop's existing requirement field can already reference — a trigger firing is no
// different, from a consumer's point of view, than a gate unlocking or a building leveling up.
// This keeps a trigger reusable for whatever a designer wants it to gate, rather than baking in
// one hardcoded "unlock zone" behavior a second, different use would have to route around.
//
// Keyed by the placed object's own "id" custom property, open-ended like queues/shops/crafting
// (not enum-backed like Gate/Building) — however many trigger volumes a designer draws on the
// map, each with its own unique id, referenced by that same id from a 'trigger' requirement
// elsewhere.

export interface TriggerConfig {
    /**
     * Removes this trigger's entity (collider included) the instant it activates — a one-shot
     * switch. Left false, the collider keeps standing and re-activates (harmlessly —
     * TriggerStorage.activate() is already idempotent) on every subsequent entry.
     */
    destroyOnTrigger: boolean;
}

export const TRIGGER_CONFIG_BY_ID: Partial<Record<string, TriggerConfig>> = {
    "walkTutorialTrigger": {
        destroyOnTrigger: true,
    },
};

export function getTriggerConfig(id: string): TriggerConfig | undefined {
    return TRIGGER_CONFIG_BY_ID[id];
}

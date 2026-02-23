// EditorSchema.ts
export const OBJECT_SCHEMA: Record<string, string[]> = {
    box: ['x', 'y', 'width', 'height', 'isStatic', 'label'],
    sensor: ['x', 'y', 'width', 'height', 'label'],
    circle: ['x', 'y', 'radius', 'isStatic', 'label'],
    polygon: ['x', 'y', 'label'] // Vertices are handled via specialized tool usually
};

export const MODIFIER_SCHEMA = {
    triggers: ['start', 'active', 'end'],
    modes: ['add', 'set', 'multiply'],
    fields: ['trigger', 'mode', 'force.x', 'force.y', 'useRadialDirection']
};
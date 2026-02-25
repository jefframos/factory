export const OBJECT_SCHEMA: Record<string, string[]> = {
    box: ['x', 'y', 'width', 'height', 'isStatic', 'label'],
    circle: ['x', 'y', 'radius', 'isStatic', 'label'],
    // ...
    // New schemas for the UI to recognize
    coin: ['x', 'y', 'radius', 'label'],
    cargo: ['x', 'y', 'width', 'height', 'label']
};

// Add this to help the Properties UI render a specific "Collectible" section
export const COLLECTIBLE_SCHEMA = {
    types: ['coin', 'cargo'],
    fields: ['collectible.type', 'collectible.cargoId', 'collectible.value']
};
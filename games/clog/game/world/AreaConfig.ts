export interface AreaConfig {
    /** Side length of the square area in world units. */
    size: number;
    /** Player value required to pass through any gate (0 = always open). */
    gateValue: number;
    /** Pool of food values; one is drawn at random on each spawn. */
    foodValues: number[];
    /**
     * Optional grid layout. Each character is a tile id matching TILE_DEFS
     * ('0' = free, '1' = wall, '2' = obstacle, …). Row 0 = south / gate side.
     * When omitted the room is auto-generated from `size`.
     */
    layout?: string[];
    /** Noise-driven obstacle placement. null = no obstacles; omit = use DEFAULT_OBSTACLES. */
    obstacles?: import('./LinearConfig').ObstacleConfig | null;
}

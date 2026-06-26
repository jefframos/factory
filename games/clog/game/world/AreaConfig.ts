export interface AreaConfig {
    /** Side length of the square area in world units. */
    size: number;
    /** Player value required to pass through any gate (0 = always open). */
    gateValue: number;
    /** Pool of food values; one is drawn at random on each spawn. */
    foodValues: number[];
}

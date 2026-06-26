export interface AreaConfig {
    /** Side length of the square area in world units. */
    size: number;
    /** Player value required to pass through any gate. */
    gateValue: number;
    /** Pool of food values; one is drawn at random on each spawn. */
    foodValues: number[];
}

/** Ordered sequence of areas. The player starts in area 0. */
export const AREAS: AreaConfig[] = [
    { size: 40, gateValue: 32,  foodValues: [2]    },
    { size: 50, gateValue: 128, foodValues: [2, 4] },
    { size: 60, gateValue: 512, foodValues: [4, 8] },
];

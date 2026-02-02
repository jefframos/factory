import { IFeatureConfig } from "../entity/BaseMergeEntity";

interface IPatternDefinition {
    texture: string;
    data?: Partial<IFeatureConfig>; // Additional metadata if needed
}

export const PatternRegistry: Record<string, IPatternDefinition> = {
    tiger: {
        texture: "patterns0001",
        data: { yOffset: 2 }
    },
    jaguar: {
        texture: "patterns0006",
        data: { widthFactor: 0.9 }
    },
    belly: {
        texture: "patterns0002",
        data: { yOffset: -5 }
    },
    bellyFluff: {
        texture: "patterns0003",
        data: { yOffset: -4 }
    },
    singleStripe: {
        texture: "patterns0004",
        data: { widthFactor: 0.9 }
    },
    tabby: {
        texture: "patterns0005",
        data: {
            widthFactor: 0.9
        }
    }
};
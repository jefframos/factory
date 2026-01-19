// PuzzleDataBuilder.ts
import { LevelDefinition, SectionDefinition } from "games/game4/types";
import * as PIXI from "pixi.js";

export type PuzzleMasterJson = {
    version: number;
    prizes: number[];
    prizesSpecial: number[];
    basePath: string;
    tiers: PuzzleTierJson[];
};

export type PuzzleTierJson = {
    id: string;
    name: string;
    enabled: boolean;
    items: PuzzleTierItemJson[];
};

export type PuzzleTierItemJson = {
    id: string;
    enabled: boolean;
    type: number;
    json: string;        // asset key/path used by PIXI.Assets.get()
    sectionCost: number; // unlock cost for that section
};

export type PuzzleCategoryJson = {
    section: {
        id: string;
        name: string;
        type: number;
        coverLevelId: string;
        levels: Array<{
            id: string;
            isSpecial: boolean;
            name: string;
            thumb: string;
            cost: number;
            image: string;
        }>;
    };
};

// Optional metadata you may want at runtime (progression, UI, sorting).
export type SectionMeta = {
    sectionId: string;
    tierId: string;
    tierName: string;
    type: number;
    sectionCost: number;
    levelCosts: Record<string, number>;
    sourceJson: string;
};

export class PuzzleDataBuilder {
    /**
     * Builds ordered sections from:
     * - master puzzleData.json (already loaded)
     * - category json files (already loaded)
     */
    public static buildSections(
        master: PuzzleMasterJson,
        folderPath: string
    ): { sections: SectionDefinition[]; meta: Record<string, SectionMeta> } {
        const sections: SectionDefinition[] = [];
        const meta: Record<string, SectionMeta> = {};

        const basePath = folderPath

        console.log(master)

        for (const tier of master.tiers) {
            if (!tier.enabled) {
                continue;
            }

            for (const item of tier.items) {
                if (!item.enabled) {
                    continue;
                }

                const category = PIXI.Assets.get(master.basePath + item.json) as PuzzleCategoryJson;
                if (!category || !category.section) {
                    // Fail-soft: ignore missing category data so a bad config doesn't hard-crash.
                    // If you prefer strict, throw here.
                    continue;
                }

                const s = category.section;

                const levels: LevelDefinition[] = s.levels.map((l) => {
                    return {
                        id: l.id,
                        sectionId: s.id,
                        name: l.name,
                        thumb: l.thumb,
                        isSpecial: l.isSpecial,
                        imageSrc: this.joinPaths(basePath, l.image),
                        unlockCost: l.cost,
                        prize: master.prizes,
                        prizesSpecial: master.prizesSpecial
                    };
                });

                const sectionDef: SectionDefinition = {
                    id: s.id,
                    name: s.name,
                    type: s.type || 0,
                    coverLevelId: s.coverLevelId,
                    levels,
                };

                sections.push(sectionDef);

                // Store progression metadata separately so you don't have to change core types.
                const levelCosts: Record<string, number> = {};
                for (const l of s.levels) {
                    levelCosts[l.id] = l.cost;
                }

                meta[s.id] = {
                    sectionId: s.id,
                    tierId: tier.id,
                    tierName: tier.name,
                    type: item.type,
                    sectionCost: item.sectionCost,
                    levelCosts,
                    sourceJson: item.json,
                };
            }
        }

        return { sections, meta };
    }

    private static joinPaths(a: string, b: string): string {
        const aTrim = a.endsWith("/") ? a.slice(0, -1) : a;
        const bTrim = b.startsWith("/") ? b.slice(1) : b;
        return `${aTrim}/${bTrim}`;
    }
}

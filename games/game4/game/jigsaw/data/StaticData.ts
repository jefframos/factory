import { LevelDefinition, SectionDefinition } from "games/game4/types";

export default class StaticData {
    private static _sections: SectionDefinition[] = [];
    private static _flatLevels: LevelDefinition[] = [];

    /**
     * Initialize the static store with parsed data
     */
    public static setData(sections: SectionDefinition[]): void {
        this._sections = sections;
        // Flatten all levels into a single list for easy linear navigation
        this._flatLevels = sections.flatMap(s => s.levels);
    }

    /**
     * Gets the very next level in the sequence regardless of lock status
     */
    public static getNextLevel(currentLevelId: string): LevelDefinition | null {
        const index = this._flatLevels.findIndex(l => l.id === currentLevelId);
        if (index !== -1 && index < this._flatLevels.length - 1) {
            return this._flatLevels[index + 1];
        }
        return null;
    }

    public static getNextAvailableLevel(
        currentLevelId: string,
        isUnlockedCallback: (id: string) => boolean
    ): LevelDefinition | null {
        // 1. Find where we are right now
        const currentIndex = this._flatLevels.findIndex(l => l.id === currentLevelId);

        // 2. Start searching from the next item in the array
        for (let i = currentIndex + 1; i < this._flatLevels.length; i++) {
            const potentialLevel = this._flatLevels[i];

            // 3. Check if this specific level is unlocked/available in the cookie
            if (isUnlockedCallback(potentialLevel.id)) {
                return potentialLevel;
            }
        }

        // Return null if no more unlocked levels exist after this one
        return null;
    }

    public static get sections(): SectionDefinition[] {
        return this._sections;
    }

    public static getSectionById(id: string): SectionDefinition | undefined {
        return this._sections.find(l => l.id === id);
    }

    public static getLevelById(id: string): LevelDefinition | undefined {
        return this._flatLevels.find(l => l.id === id);
    }
}
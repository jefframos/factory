import { PieceViewData } from './Types';

export default class GameplayCharacterData {
    // Store tables by name
    private static characterTableStore: Record<string, PieceViewData[]> = {};

    // Currently active table name
    private static currentTable: string | null = null;

    // Register a table by name
    public static registerTable(name: string, viewData: PieceViewData[]): void {
        this.characterTableStore[name] = viewData;

        if (!this.currentTable) {
            this.setTable(name);
        }
    }

    // Set the active table by name
    public static setTable(name: string): void {
        if (!(name in this.characterTableStore)) {
            throw new Error(`Table "${name}" is not registered.`);
        }
        this.currentTable = name;
    }

    // Fetch an element by ID from the current active table
    public static fetchById(id: number): PieceViewData | undefined {
        if (!this.currentTable) {
            throw new Error(`No active table is set.`);
        }

        const table = this.characterTableStore[this.currentTable];
        return table[id]
    }

    // Fetch an element by ID from the current active table
    public static fetchByName(id: number): PieceViewData | undefined {
        if (!this.currentTable) {
            throw new Error(`No active table is set.`);
        }

        const table = this.characterTableStore[this.currentTable];
        return table.find(entry => entry.id === id);
    }
}

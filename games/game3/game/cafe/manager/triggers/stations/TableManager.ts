// TableManager.ts
import TableStation from './TableStation';

export class TableManager {
    private static _instance: TableManager;
    public static get instance(): TableManager {
        if (!this._instance) this._instance = new TableManager();
        return this._instance;
    }

    private tables: Set<TableStation> = new Set();

    public registerTable(table: TableStation): void {
        this.tables.add(table);
    }

    public unregisterTable(table: TableStation): void {
        this.tables.delete(table);
    }

    public getAvailableTable(): TableStation | null {
        for (const table of this.tables) {
            if (table.isAvailableForCustomer()) return table;
        }
        return null;
    }
}

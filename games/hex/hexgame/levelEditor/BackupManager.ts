export interface BackupEntry {
    name: string;
    createdAtMs: number;
    data: any; // full json object
}

export class BackupManager {
    private static readonly STORAGE_KEY = "hex_level_editor_backups_v1";
    private static readonly MAX_BACKUPS = 5;

    public static createBackupAndDownload(currentJson: any): void {
        const now = new Date();
        const stamp = this.formatTimestamp(now);

        const entry: BackupEntry = {
            name: `levelData_${stamp}.bkp`,
            createdAtMs: now.getTime(),
            data: currentJson
        };

        // 1) store in localStorage (keep last 5)
        const list = this.loadBackups();
        list.unshift(entry);
        while (list.length > this.MAX_BACKUPS) {
            list.pop();
        }
        this.saveBackups(list);

        // 2) download .bkp
        this.downloadBackup(entry.name, entry.data);
    }

    public static loadBackups(): BackupEntry[] {
        try {
            const raw = localStorage.getItem(this.STORAGE_KEY);
            if (!raw) return [];
            const parsed = JSON.parse(raw) as BackupEntry[];
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    private static saveBackups(list: BackupEntry[]): void {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(list));
        } catch {
            // ignore (storage full / blocked)
        }
    }

    private static downloadBackup(filename: string, data: any): void {
        const json = JSON.stringify(data, null, 4);
        const blob = new Blob([json], { type: "application/octet-stream" });
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();

        URL.revokeObjectURL(url);
    }

    private static formatTimestamp(d: Date): string {
        const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);

        const yyyy = d.getFullYear();
        const mm = pad(d.getMonth() + 1);
        const dd = pad(d.getDate());
        const hh = pad(d.getHours());
        const mi = pad(d.getMinutes());
        const ss = pad(d.getSeconds());

        return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
    }
}

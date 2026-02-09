export class MapBoundaryLogic {
    private boundaries: any[] = [];
    private container: HTMLDivElement;
    public onBoundariesChanged?: (data: any[]) => void;

    constructor(parent: HTMLDivElement) {
        this.container = document.createElement("div");
        this.container.style.cssText = `
            position: fixed; bottom: 80px; left: 20px;
            background: rgba(30, 0, 30, 0.9); padding: 15px;
            border-radius: 12px; border: 2px solid #FF00FF; color: white;
            display: none; flex-direction: column; gap: 10px; width: 200px;
            pointer-events: auto; z-index: 1000;
        `;

        const header = document.createElement("div");
        header.innerHTML = `<b style="color:#FF00FF">WORLD BOUNDARIES</b>`;

        const addBtn = document.createElement("button");
        addBtn.innerText = "➕ Add Boundary Box";
        addBtn.style.cssText = "cursor:pointer; padding:8px; background:#FF00FF; border:none; color:white; font-weight:bold; border-radius:4px;";
        addBtn.onclick = () => this.addNew();

        this.container.append(header, addBtn);
        parent.appendChild(this.container);
    }

    public setEnabled(enabled: boolean) {
        this.container.style.display = enabled ? "flex" : "none";
    }

    public setData(data: any[]) {
        this.boundaries = data || [];
        this.refreshUI();
    }

    private addNew() {
        this.boundaries.push({
            id: `bound_${Date.now()}`,
            x: -250, y: -250, width: 500, height: 500
        });
        this.onBoundariesChanged?.(this.boundaries);
        this.refreshUI();
    }

    public updateBoundary(id: string, updates: any) {
        const b = this.boundaries.find(x => x.id === id);
        if (b) {
            Object.assign(b, updates);
            this.onBoundariesChanged?.(this.boundaries);
        }
    }

    private refreshUI() {
        const items = this.container.querySelectorAll('.bound-item');
        items.forEach(i => i.remove());
        // Add list items here if you want to see IDs or delete buttons
    }
}
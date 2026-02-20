/** * Centralized Stylesheet to remove clutter from the logic 
 */
const STYLES = {
    ROOT: `position: fixed; inset: 0; z-index: 9999; pointer-events: none; color: white; font-family: 'Segoe UI', sans-serif; font-size: 14px; user-select: none;`,
    SIDEBAR: `position: absolute; left: 15px; top: 15px; bottom: 15px; width: 280px; background: rgba(25, 25, 25, 0.95); border-radius: 12px; padding: 18px; pointer-events: auto; display: flex; flex-direction: column; border: 1px solid rgba(255, 255, 255, 0.15); backdrop-filter: blur(15px); box-shadow: 0 8px 32px rgba(0,0,0,0.5);`,
    TOP_BAR: `position: absolute; top: 15px; left: 310px; right: 15px; height: 60px; background: rgba(25, 25, 25, 0.85); border-radius: 12px; display: flex; align-items: center; padding: 0 20px; gap: 20px; pointer-events: auto; border: 1px solid rgba(255, 255, 255, 0.15); backdrop-filter: blur(10px); box-shadow: 0 4px 16px rgba(0,0,0,0.3);`,
    SAVE_BTN: `background: #2ecc71; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; transition: background 0.2s;`,
    STATUS: `font-weight: bold; font-size: 12px; text-shadow: 0 1px 2px black;`,
    // BTN_SMALL: `background: rgba(255,255,255,0.1); border: none; color: white; cursor: pointer; padding: 2px 6px; border-radius: 3px; font-size: 10px; pointer-events: auto;`,
    WORLD_BOX: (active: boolean) => `padding: 10px; border-radius: 6px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; pointer-events: auto; margin-bottom: 2px; background: ${active ? 'rgba(46, 204, 113, 0.2)' : 'rgba(255,255,255,0.05)'}; border: 1px solid ${active ? '#2ecc71' : 'rgba(255,255,255,0.1)'};`,
    LEVEL_ITEM: (selected: boolean) => `flex: 1; padding: 6px 10px; font-size: 13px; cursor: pointer; border-radius: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; background: ${selected ? 'rgba(52, 152, 219, 0.3)' : 'rgba(255,255,255,0.03)'}; border: 1px solid ${selected ? '#3498db' : 'transparent'}; color: ${selected ? '#fff' : '#ccc'};`,
    BTN_SMALL: `background: rgba(255,255,255,0.1); border: none; color: white; cursor: pointer; padding: 2px 6px; border-radius: 3px; font-size: 10px; pointer-events: auto;`,
    BTN_DANGER: `background: rgba(231, 76, 60, 0.2); border: none; color: #e74c3c; cursor: pointer; padding: 2px 6px; border-radius: 3px; font-size: 10px; pointer-events: auto; margin-left: 4px; transition: background 0.2s;`,
};

export class EditorDomUI {
    public readonly root: HTMLDivElement;
    public readonly saveBtn!: HTMLButtonElement;
    public readonly statusLabel!: HTMLDivElement;
    private worldContainer!: HTMLDivElement;

    // Callbacks
    public onAddWorld?: () => void;
    public onAddLevel?: (worldId: string) => void;
    public onMoveWorld?: (worldId: string, dir: -1 | 1) => void;
    public onMoveLevel?: (worldId: string, index: number, dir: -1 | 1) => void;
    public onSelectLevel?: (worldId: string, index: number) => void;
    public onSaveServer?: () => void;
    public onDeleteWorld?: (worldId: string) => void;
    public onDeleteLevel?: (worldId: string, index: number) => void;

    constructor() {
        this.root = this.createElement("div", STYLES.ROOT, "editor-ui-root");
        this.initLayout();
        document.body.appendChild(this.root);
    }

    /** 1. Layout Initialization */
    private initLayout(): void {
        const sidebar = this.createElement("div", STYLES.SIDEBAR);
        sidebar.appendChild(this.createSidebarHeader());
        this.worldContainer = this.createElement("div", `flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px;`);
        sidebar.appendChild(this.worldContainer);

        const topBar = this.createElement("div", STYLES.TOP_BAR);
        this.initTopBar(topBar);

        this.root.appendChild(sidebar);
        this.root.appendChild(topBar);
    }

    private initTopBar(parent: HTMLElement): void {
        // Save Button
        (this as any).saveBtn = this.createElement("button", STYLES.SAVE_BTN);
        this.saveBtn.innerText = "SAVE WORLD DATA";
        this.saveBtn.onclick = () => this.onSaveServer?.();
        this.saveBtn.onmouseenter = () => this.saveBtn.style.background = "#27ae60";
        this.saveBtn.onmouseleave = () => this.saveBtn.style.background = "#2ecc71";

        // Status Label
        (this as any).statusLabel = this.createElement("div", STYLES.STATUS);
        this.statusLabel.innerText = "SERVER STATUS: READY";

        parent.appendChild(this.saveBtn);
        parent.appendChild(this.statusLabel);
    }

    /** 2. Public API */
    public refreshAccordion(manifest: any, worldsData: any, activeWorldId: string, activeLevelIdx: number): void {
        this.worldContainer.innerHTML = "";
        manifest.worlds.forEach((world: any, idx: number) => {
            this.worldContainer.appendChild(this.createWorldNode(world, idx, manifest, worldsData, activeWorldId, activeLevelIdx));
        });
    }

    public setStatus(msg: string, color: string = '#000000'): void {
        this.statusLabel.innerText = `SERVER STATUS: ${msg.toUpperCase()}`;
        this.statusLabel.style.color = color;
    }

    /** 3. Sub-Component Factories */
    private createWorldNode(world: any, worldIdx: number, manifest: any, worldsData: any, activeWorldId: string, activeLevelIdx: number): HTMLDivElement {
        const container = document.createElement("div");
        const isActive = world.id === activeWorldId;

        const header = this.createElement("div", STYLES.WORLD_BOX(isActive));
        header.innerHTML = `<span>${world.name} <small style="opacity:0.5">(${worldsData[world.levelFile]?.levels.length || 0})</small></span>`;
        header.onclick = () => this.onSelectLevel?.(world.id, 0);

        // Control Group
        const controls = this.createElement("div", "display: flex; align-items: center;");

        // Reorder
        const reorder = this.createReorderGroup(
            () => this.onMoveWorld?.(world.id, -1),
            () => this.onMoveWorld?.(world.id, 1),
            worldIdx === 0,
            worldIdx === manifest.worlds.length - 1
        );

        // Delete World Button
        const delBtn = this.createElement("button", STYLES.BTN_DANGER);
        delBtn.innerHTML = "✖";
        delBtn.title = "Delete World";
        delBtn.onclick = (e) => {
            e.stopPropagation();
            if (confirm(`Delete world "${world.name}" and all its levels?`)) {
                this.onDeleteWorld?.(world.id);
            }
        };

        controls.appendChild(reorder);
        controls.appendChild(delBtn);
        header.appendChild(controls);

        // Level List
        const levelList = this.createElement("div", `display: ${isActive ? "flex" : "none"}; flex-direction: column; padding: 5px 0 10px 15px; gap: 4px; pointer-events: auto;`);
        const levels = worldsData[world.levelFile]?.levels || [];

        levels.forEach((lvl: any, lIdx: number) => {
            levelList.appendChild(this.createLevelItem(world.id, lvl, lIdx, isActive && lIdx === activeLevelIdx, levels.length));
        });

        levelList.appendChild(this.createAddLevelBtn(world.id));

        container.appendChild(header);
        container.appendChild(levelList);
        return container;
    }

    private createLevelItem(worldId: string, lvl: any, idx: number, isSelected: boolean, total: number): HTMLDivElement {
        const row = this.createElement("div", `display: flex; align-items: center; gap: 5px;`);

        const item = this.createElement("div", STYLES.LEVEL_ITEM(isSelected));
        item.innerText = lvl.name || `Level ${idx + 1}`;
        item.onclick = (e) => { e.stopPropagation(); this.onSelectLevel?.(worldId, idx); };

        const controls = this.createElement("div", "display: flex; align-items: center;");

        const reorder = this.createReorderGroup(
            () => this.onMoveLevel?.(worldId, idx, -1),
            () => this.onMoveLevel?.(worldId, idx, 1),
            idx === 0,
            idx === total - 1
        );

        // Delete Level Button
        const delBtn = this.createElement("button", STYLES.BTN_DANGER);
        delBtn.innerHTML = "✖";
        delBtn.style.fontSize = "8px";
        delBtn.onclick = (e) => {
            e.stopPropagation();
            if (confirm(`Delete level "${lvl.name}"?`)) {
                this.onDeleteLevel?.(worldId, idx);
            }
        };

        controls.appendChild(reorder);
        controls.appendChild(delBtn);

        row.appendChild(item);
        row.appendChild(controls);
        return row;
    }

    /** 4. Utility Helpers */
    private createElement<T extends keyof HTMLElementTagNameMap>(tag: T, css: string, id?: string): HTMLElementTagNameMap[T] {
        const el = document.createElement(tag);
        if (id) el.id = id;
        el.style.cssText = css;
        return el;
    }

    private createReorderGroup(onUp: Function, onDown: Function, upDisabled: boolean, downDisabled: boolean): HTMLDivElement {
        const group = this.createElement("div", "display: flex; gap: 4px;");
        const up = this.createElement("button", STYLES.BTN_SMALL);
        const down = this.createElement("button", STYLES.BTN_SMALL);

        up.innerText = "▲"; down.innerText = "▼";
        up.disabled = upDisabled; down.disabled = downDisabled;
        if (upDisabled) up.style.opacity = "0.3";
        if (downDisabled) down.style.opacity = "0.3";

        up.onclick = (e) => { e.stopPropagation(); onUp(); };
        down.onclick = (e) => { e.stopPropagation(); onDown(); };

        group.appendChild(up);
        group.appendChild(down);
        return group;
    }

    private createSidebarHeader(): HTMLDivElement {
        const header = this.createElement("div", `display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 10px;`);
        header.innerHTML = `<h3 style="margin:0; color: #ecf0f1;">Worlds Manifest</h3>`;
        const btn = this.createElement("button", `background: #3498db; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; font-size: 11px;`);
        btn.innerText = "+ New World";
        btn.onclick = () => this.onAddWorld?.();
        header.appendChild(btn);
        return header;
    }

    private createAddLevelBtn(worldId: string): HTMLDivElement {
        const btn = this.createElement("div", `padding: 8px; font-size: 11px; opacity: 0.6; cursor: pointer; font-style: italic; text-align: center; border: 1px dashed rgba(255,255,255,0.2); margin-top: 5px; border-radius: 4px;`);
        btn.innerText = "+ Add New Level";
        btn.onclick = (e) => { e.stopPropagation(); this.onAddLevel?.(worldId); };
        return btn;
    }

    public destroy() { this.root.remove(); }
}
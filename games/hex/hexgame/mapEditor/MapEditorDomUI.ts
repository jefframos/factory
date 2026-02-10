import { VisualImage } from "./VisualViewController";

export class MapEditorDomUI {
    public readonly root: HTMLDivElement;

    // Containers
    private tabContainer!: HTMLDivElement;
    private mapEditorHUD!: HTMLDivElement;
    private visualEditorHUD!: HTMLDivElement;

    // HUD Elements - Map Mode
    public levelEditToggle!: HTMLInputElement;
    public deleteModeToggle!: HTMLInputElement;
    public serverStatusLabel!: HTMLDivElement;
    public coordinatesLabel!: HTMLDivElement;
    // MapEditorDomUI fields
    private selectedSpritePanel!: HTMLDivElement;
    private scaleSlider!: HTMLInputElement;
    private scaleValueLabel!: HTMLDivElement;
    private resetScaleBtn!: HTMLButtonElement;
    private orderActionsRow!: HTMLDivElement;

    private typeGroup!: HTMLDivElement;
    private sizeDrawer!: HTMLDivElement;
    private tilingDrawer!: HTMLDivElement;
    private nineSliceDrawer!: HTMLDivElement;


    public onTypeChanged?: (type: "sprite" | "tiling" | "nineslice") => void;
    public onSizeChanged?: (w: number | null, h: number | null) => void;
    public onTilingChanged?: (settings: { scale?: number, offsetX?: number, offsetY?: number }) => void;
    public onPaddingChanged?: (padding: { left?: number, top?: number, right?: number, bottom?: number }) => void;
    public onMoveSelectedImage?: (direction: "up" | "down" | "top" | "bottom") => void;

    public onSelectedScaleChanged?: (scale: number) => void;
    public onResetSelectedScale?: () => void;

    // Callbacks
    public onModeChange?: (mode: "map" | "visual") => void;
    public onSaveMap?: () => void;
    public onToggleLevelEdit?: (enabled: boolean) => void;
    public onToggleDeleteMode?: (enabled: boolean) => void;
    public onLayerSelected?: (id: string) => void;
    public onToggleBoundaries?: (enabled: boolean) => void;
    constructor() {
        this.root = document.createElement("div");
        this.root.style.cssText = `
            position: absolute; 
            inset: 0; 
            pointer-events: none; 
            color: white; 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
            font-size: 14px; 
            user-select: none; 
            z-index: 100;
        `;

        this.createTabs();
        this.createHUDContainers();
        this.setupMapHUD();
        this.setupVisualHUD();

        document.body.appendChild(this.root);
    }
    private setupVisualHUD() {
        const panel = document.createElement("div");
        panel.style.cssText = `
            position: absolute;
            top: 0;
            right: 0;
            background: rgba(20, 20, 20, 0.85);
            border-radius: 10px;
            padding: 10px;
            pointer-events: auto;
            display: flex;
            flex-direction: column;
            gap: 10px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            width: 220px;
        `;

        // 1. Title
        const title = document.createElement("div");
        title.innerText = "SELECTED OBJECT";
        title.style.cssText = "font-weight: bold; font-size: 11px; color: #2196F3; letter-spacing: 1px;";

        // 2. Scale Section
        const scaleLabel = document.createElement("div");
        scaleLabel.innerText = "Scale";
        scaleLabel.style.cssText = "font-size: 10px; opacity: 0.7;";

        const sliderRow = document.createElement("div");
        sliderRow.style.cssText = "display: flex; align-items: center; gap: 8px;";

        const slider = document.createElement("input");
        slider.type = "range"; slider.min = "0.1"; slider.max = "3"; slider.step = "0.05"; slider.value = "1";
        slider.style.cssText = "flex: 1; cursor: pointer;";

        const valueText = document.createElement("div");
        valueText.style.cssText = "font-family: monospace; font-size: 10px; min-width: 40px;";
        valueText.innerText = "1.00x";

        slider.oninput = () => {
            const s = parseFloat(slider.value);
            valueText.innerText = `${s.toFixed(2)}x`;
            this.onSelectedScaleChanged?.(s);
        };

        // 3. Reordering Section (NEW)
        const orderLabel = document.createElement("div");
        orderLabel.innerText = "Depth (Layer Order)";
        orderLabel.style.cssText = "font-size: 10px; opacity: 0.7; margin-top: 4px;";

        const orderRow = document.createElement("div");
        orderRow.style.cssText = "display: flex; gap: 4px;";

        const btnStyle = `
            flex: 1;
            padding: 6px 0;
            background: rgba(255,255,255,0.05);
            color: white;
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 4px;
            cursor: pointer;
            font-size: 10px;
            font-weight: bold;
            transition: background 0.2s;
        `;

        const moveUp = document.createElement("button");
        moveUp.innerText = "▲ Up";
        moveUp.style.cssText = btnStyle;
        moveUp.onclick = () => this.onMoveSelectedImage?.("up");

        const moveDown = document.createElement("button");
        moveDown.innerText = "▼ Down";
        moveDown.style.cssText = btnStyle;
        moveDown.onclick = () => this.onMoveSelectedImage?.("down");

        // 4. Footer Actions
        const footerRow = document.createElement("div");
        footerRow.style.cssText = "display: flex; justify-content: space-between; margin-top: 4px;";

        const reset = document.createElement("button");
        reset.innerText = "Reset Scale";
        reset.style.cssText = "background: none; border: none; color: #888; font-size: 10px; cursor: pointer; text-decoration: underline;";
        reset.onclick = () => {
            slider.value = "1";
            valueText.innerText = "1.00x";
            this.onResetSelectedScale?.();
        };

        // Append everything
        sliderRow.append(slider, valueText);
        orderRow.append(moveDown, moveUp);
        panel.append(title, scaleLabel, sliderRow, orderLabel, orderRow, footerRow);
        footerRow.append(reset);

        this.selectedSpritePanel = panel;
        this.scaleSlider = slider;
        this.scaleValueLabel = valueText;
        this.visualEditorHUD.appendChild(panel);


        // 1. Type Selection (Checkboxes acting like Radios)
        this.typeGroup = this.createSection("OBJECT TYPE");
        const tilingCheck = this.createInlineCheckbox("Tiling", "typeTiling");
        const nineSliceCheck = this.createInlineCheckbox("9-Slice", "typeNineSlice");
        this.typeGroup.append(tilingCheck.container, nineSliceCheck.container);

        // 2. Size Drawer (Width/Height)
        this.sizeDrawer = this.createSection("DIMENSIONS");
        this.sizeDrawer.style.display = "none";
        const wInput = this.createNumberInput("Width", (v) => this.onSizeChanged?.(v, null));
        const hInput = this.createNumberInput("Height", (v) => this.onSizeChanged?.(null, v));
        this.sizeDrawer.append(wInput, hInput);

        // 3. Tiling Drawer
        this.tilingDrawer = this.createSection("TILING SETTINGS");
        this.tilingDrawer.style.display = "none";
        const tScale = this.createNumberInput("Tile Scale", (v) => this.onTilingChanged?.({ scale: v }));
        this.tilingDrawer.append(tScale);

        // 4. Nine Slice Drawer
        this.nineSliceDrawer = this.createSection("9-SLICE PADDING");
        this.nineSliceDrawer.style.display = "none";
        const padding = this.createNumberInput("Padding (All)", (v) => this.onPaddingChanged?.(v));
        this.nineSliceDrawer.append(padding);

        tilingCheck.input.onchange = () => {
            if (tilingCheck.input.checked) nineSliceCheck.input.checked = false;
            const newType = tilingCheck.input.checked ? "tiling" : "sprite";
            this.refreshDrawers(newType);
            this.onTypeChanged?.(newType);
        };

        nineSliceCheck.input.onchange = () => {
            if (nineSliceCheck.input.checked) tilingCheck.input.checked = false;
            const newType = nineSliceCheck.input.checked ? "nineslice" : "sprite";
            this.refreshDrawers(newType);
            this.onTypeChanged?.(newType);
        };

        this.selectedSpritePanel.append(this.typeGroup, this.sizeDrawer, this.tilingDrawer, this.nineSliceDrawer);
    }
    private refreshDrawers(type: string) {
        const isTiling = type === "tiling";
        const isNine = type === "nineslice";

        this.sizeDrawer.style.display = (isTiling || isNine) ? "block" : "none";
        this.tilingDrawer.style.display = isTiling ? "block" : "none";
        this.nineSliceDrawer.style.display = isNine ? "block" : "none";
    }
    private createNumberInput(label: string, onChange: (val: number) => void): HTMLDivElement {
        const container = document.createElement("div");
        container.style.cssText = "display: flex; align-items: center; justify-content: space-between; gap: 5px; margin-bottom: 4px;";

        const lbl = document.createElement("span");
        lbl.innerText = label;
        lbl.style.fontSize = "10px";

        const input = document.createElement("input");
        input.type = "number";
        input.style.cssText = "width: 60px; background: #222; color: white; border: 1px solid #444; font-size: 10px; padding: 2px;";
        input.oninput = () => onChange(parseFloat(input.value) || 0);

        container.append(lbl, input);
        return container;
    }

    private createInlineCheckbox(text: string, id: string) {
        const container = document.createElement("div");
        container.style.cssText = "display: flex; align-items: center; gap: 4px; font-size: 11px;";

        const input = document.createElement("input");
        input.type = "checkbox";
        input.id = id;
        input.style.cursor = "pointer";

        const label = document.createElement("label");
        label.innerText = text;
        label.htmlFor = id;
        label.style.cursor = "pointer";

        container.append(input, label);
        return { container, input };
    }
    public updateSelectedObjectUI(data: VisualImage) {
        const isTiling = data.type === "tiling";
        const isNine = data.type === "nineslice";

        this.sizeDrawer.style.display = (isTiling || isNine) ? "block" : "none";
        this.tilingDrawer.style.display = isTiling ? "block" : "none";
        this.nineSliceDrawer.style.display = isNine ? "block" : "none";

        // Set checkbox states
        (this.root.querySelector("#typeTiling") as HTMLInputElement).checked = isTiling;
        (this.root.querySelector("#typeNineSlice") as HTMLInputElement).checked = isNine;
    }

    private createSection(titleText: string) {
        const div = document.createElement("div");
        div.style.cssText = "margin-top: 10px; border-top: 1px solid #333; padding-top: 8px;";
        const t = document.createElement("div");
        t.innerText = titleText;
        t.style.cssText = "font-size: 9px; color: #888; margin-bottom: 5px;";
        div.appendChild(t);
        return div;
    }

    public setActiveLayerUI(id: string) {
        const items = this.root.querySelectorAll('.layer-item');
        items.forEach(item => {
            (item as HTMLElement).style.outline = (item as HTMLElement).dataset.id === id
                ? "2px solid #2196F3"
                : "none";
        });
    }
    public setSelectedSpriteScale(scale: number | null) {
        if (!this.selectedSpritePanel) return;

        if (scale === null) {
            this.selectedSpritePanel.style.display = "none";
            return;
        }

        this.selectedSpritePanel.style.display = "flex";
        const clamped = Math.max(0.1, Math.min(3, scale));
        this.scaleSlider.value = String(clamped);
        this.scaleValueLabel.innerText = `${clamped.toFixed(2)}x`;
    }

    private createTabs() {
        this.tabContainer = document.createElement("div");
        this.tabContainer.style.cssText = `
            position: absolute; 
            top: 0; 
            left: 50%; 
            transform: translateX(-50%); 
            background: rgba(30, 30, 30, 0.95); 
            padding: 6px 20px; 
            border-radius: 0 0 12px 12px; 
            pointer-events: auto; 
            display: flex; 
            gap: 10px; 
            border: 1px solid rgba(255, 255, 255, 0.1); 
            border-top: none; 
            backdrop-filter: blur(10px);
            box-shadow: 0 4px 15px rgba(0,0,0,0.5);
        `;

        const btnMap = this.createTabBtn("🗺️ Map Editor", true);
        const btnVisual = this.createTabBtn("🎨 Visual Editor", false);

        btnMap.onclick = () => {
            this.switchTab("map");
            btnMap.style.background = "#4CAF50";
            btnVisual.style.background = "rgba(255,255,255,0.05)";
            this.onModeChange?.("map");
        };

        btnVisual.onclick = () => {
            this.switchTab("visual");
            btnVisual.style.background = "#2196F3";
            btnMap.style.background = "rgba(255,255,255,0.05)";
            this.onModeChange?.("visual");
        };

        this.tabContainer.append(btnMap, btnVisual);
        this.root.appendChild(this.tabContainer);
    }
    public setTab(mode: "map" | "visual"): void {
        const isMap = mode === "map";
        this.mapEditorHUD.style.display = isMap ? "block" : "none";
        this.visualEditorHUD.style.display = isMap ? "none" : "block";

        // Subtly update the button colors so they look "active"
        const buttons = this.tabContainer.querySelectorAll('button');
        if (buttons.length >= 2) {
            (buttons[0] as HTMLElement).style.background = isMap ? "#4CAF50" : "rgba(255,255,255,0.05)";
            (buttons[1] as HTMLElement).style.background = !isMap ? "#2196F3" : "rgba(255,255,255,0.05)";
        }
    }
    private createTabBtn(text: string, active: boolean) {
        const btn = document.createElement("button");
        btn.innerText = text;
        btn.style.cssText = `
            padding: 8px 16px; 
            border: none; 
            border-radius: 6px; 
            cursor: pointer; 
            color: white; 
            font-weight: bold; 
            font-size: 12px;
            transition: all 0.2s ease;
            background: ${active ? '#4CAF50' : 'rgba(255,255,255,0.05)'};
        `;
        return btn;
    }

    private createHUDContainers() {
        this.mapEditorHUD = document.createElement("div");
        this.mapEditorHUD.style.cssText = `position: absolute; top: 60px; left: 12px; right: 12px; pointer-events: none;`;

        this.visualEditorHUD = document.createElement("div");
        this.visualEditorHUD.style.cssText = `position: absolute; top: 60px; left: 12px; right: 12px; pointer-events: none; display: none;`;

        this.root.append(this.mapEditorHUD, this.visualEditorHUD);
    }

    private setupMapHUD() {
        const toolbar = document.createElement("div");
        toolbar.style.cssText = `
        background: rgba(20, 20, 20, 0.85); 
        border-radius: 12px; 
        padding: 12px 18px; 
        pointer-events: auto; 
        display: flex; 
        gap: 20px; 
        align-items: center; 
        border: 1px solid rgba(255, 255, 255, 0.1); 
        backdrop-filter: blur(10px);
    `;

        // 1. Toggles
        const editToggleData = this.createToggle("Edit Mode", "levelEdit", "#4CAF50");
        this.levelEditToggle = editToggleData.input;
        this.levelEditToggle.onchange = () => this.onToggleLevelEdit?.(this.levelEditToggle.checked);

        const deleteToggleData = this.createToggle("Delete Mode", "deleteMode", "#ff4c4c");
        this.deleteModeToggle = deleteToggleData.input;
        this.deleteModeToggle.onchange = () => this.onToggleDeleteMode?.(this.deleteModeToggle.checked);

        // --- NEW: Boundary Toggle ---
        const boundToggleData = this.createToggle("Boundaries", "boundMode", "#FF00FF");
        boundToggleData.input.onchange = () => this.onToggleBoundaries?.(boundToggleData.input.checked);

        // 2. Save Button
        const saveBtn = document.createElement("button");
        saveBtn.innerText = "💾 Save Map";
        saveBtn.style.cssText = `padding: 8px 16px; background: #4CAF50; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;`;
        saveBtn.onclick = () => this.onSaveMap?.();

        // 3. Status Labels
        this.serverStatusLabel = document.createElement("div");
        this.serverStatusLabel.style.cssText = `font-size: 11px; padding: 6px 12px; background: rgba(0,0,0,0.3); border-radius: 6px; min-width: 120px;`;
        this.serverStatusLabel.innerText = "Status: Ready";

        this.coordinatesLabel = document.createElement("div");
        this.coordinatesLabel.style.cssText = `font-size: 11px; font-family: monospace; padding: 6px 12px; background: rgba(0,0,0,0.3); border-radius: 6px; margin-left: auto;`;
        this.coordinatesLabel.innerText = "X: 0, Y: 0";

        // Add everything to toolbar (Notice boundToggleData.container is added here)
        toolbar.append(
            editToggleData.container,
            deleteToggleData.container,
            boundToggleData.container, // <--- New line
            saveBtn,
            this.serverStatusLabel,
            this.coordinatesLabel
        );
        this.mapEditorHUD.appendChild(toolbar);
    }

    private createToggle(text: string, id: string, color: string) {
        const container = document.createElement("div");
        container.style.cssText = `display: flex; align-items: center; gap: 8px; color: ${color}; font-weight: bold; font-size: 12px;`;

        const input = document.createElement("input");
        input.type = "checkbox";
        input.id = id;
        input.style.cursor = "pointer";

        const label = document.createElement("label");
        label.innerText = text;
        label.htmlFor = id;
        label.style.cursor = "pointer";

        container.append(input, label);
        return { container, input };
    }

    private switchTab(mode: "map" | "visual") {
        this.mapEditorHUD.style.display = mode === "map" ? "block" : "none";
        this.visualEditorHUD.style.display = mode === "visual" ? "block" : "none";
    }

    // --- Public API for the Scene ---

    public setServerStatus(text: string, ok: boolean): void {
        if (this.serverStatusLabel) {
            this.serverStatusLabel.innerText = `Status: ${text}`;
            this.serverStatusLabel.style.color = ok ? "#a0ffb4" : "#ffb4b4";
        }
    }

    public updateCoordinates(x: number, y: number, zoom: number): void {
        if (this.coordinatesLabel) {
            this.coordinatesLabel.innerText = `X: ${Math.round(x)}, Y: ${Math.round(y)} | ${(zoom * 100).toFixed(0)}%`;
        }
    }

    public getVisualHUDParent(): HTMLDivElement {
        return this.visualEditorHUD;
    }

    public destroy(): void {
        this.root.remove();
    }
}
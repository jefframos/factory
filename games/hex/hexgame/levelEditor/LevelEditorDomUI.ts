import { colorToHex6, Difficulty, getColorValueById, LevelFeature, LevelFeatureData, PIECE_COLOR_PALETTE } from "../HexTypes";
import { WorldData } from "../LevelDataManager";
import { LevelMatrixCodec } from "./LevelMatrixCodec";

export type PieceUiData = { color: number };

export class LevelEditorDomUI {
    public readonly root: HTMLDivElement;
    private sidebar: HTMLDivElement;
    private worldContainer: HTMLDivElement;
    private editorPanel: HTMLDivElement;

    // Sidebar
    public readonly addWorldBtn: HTMLButtonElement;

    // Editor Panel Header
    public readonly levelTitleLabel: HTMLDivElement;
    public readonly saveServerBtn: HTMLButtonElement;
    public readonly serverStatusLabel: HTMLDivElement;

    // Editor Config
    public readonly difficultySelect: HTMLSelectElement;
    public readonly bakePiecesBtn: HTMLButtonElement;
    public readonly erasePiecesBtn: HTMLButtonElement;
    public readonly deleteLevelBtn: HTMLButtonElement;
    public readonly rerollGridBtn: HTMLButtonElement;

    // Piece Editor
    public readonly pieceModeToggle: HTMLInputElement;
    public readonly addPieceBtn: HTMLButtonElement;
    public readonly pieceColorSelect: HTMLSelectElement;
    public readonly pieceList: HTMLDivElement;
    public readonly validityLabel: HTMLDivElement;
    public readonly worldEnabledToggle: HTMLInputElement;
    public readonly worldBackgroundInput: HTMLInputElement;
    public readonly featureContainer: HTMLDivElement;
    // Callbacks
    public onFeatureToggle?: (featureId: LevelFeature, enabled: boolean, value: string) => void;
    public onMoveLevel?: (worldId: string, levelIndex: number, direction: -1 | 1) => void;
    public onMoveWorld?: (worldId: string, direction: -1 | 1) => void;
    public onRerollGrid?: () => void;
    public onRenameLevel?: (worldId: string, levelIndex: number, newName: string) => void;
    public onAddWorld?: () => void;
    public onSelectLevel?: (worldId: string, levelIndex: number) => void;
    public onAddLevel?: (worldId: string) => void;
    public onSaveServer?: () => void;
    public onDeleteLevel?: () => void;
    public onDifficultyChanged?: (difficulty: Difficulty) => void;
    public onBakePieces?: () => void;
    public onErasePieces?: () => void;
    public onTogglePieceMode?: (enabled: boolean) => void;
    public onAddPiece?: (color: number) => void;
    public onSelectPiece?: (index: number) => void;
    public onSelectedPieceColorChanged?: (color: string) => void;
    public onDeletePiece?: () => void;

    private pieceItems: HTMLDivElement[] = [];

    public constructor() {
        this.root = document.createElement("div");
        this.root.style.cssText = `position:absolute; inset:0; pointer-events:none; color:white; font-family:Arial; font-size:14px; user-select:none;`;

        // --- SIDEBAR (Left) ---
        this.sidebar = document.createElement("div");
        this.sidebar.style.cssText = `position:absolute; left:12px; top:12px; bottom:12px; width:260px; background:rgba(20,20,20,0.85); border-radius:12px; padding:15px; pointer-events:auto; display:flex; flex-direction:column; border:1px solid rgba(255,255,255,0.1); backdrop-filter:blur(10px);`;

        const sideHeader = this.makeRow();
        sideHeader.innerHTML = `<h3 style="margin:0; flex:1">Worlds</h3>`;
        this.addWorldBtn = document.createElement("button");
        this.addWorldBtn.innerText = "+ World";
        sideHeader.appendChild(this.addWorldBtn);

        this.worldContainer = document.createElement("div");
        this.worldContainer.style.cssText = `flex:1; overflow-y:auto; margin-top:15px; display:flex; flex-direction:column; gap:8px;`;

        this.sidebar.appendChild(sideHeader);
        this.sidebar.appendChild(this.worldContainer);

        // --- EDITOR PANEL (Bottom Right) ---
        this.editorPanel = document.createElement("div");
        this.editorPanel.style.cssText = `position:absolute; right:12px; bottom:12px; width:340px; background:rgba(0,0,0,0.7); border-radius:12px; padding:15px; pointer-events:auto; display:flex; flex-direction:column; gap:10px; border:1px solid rgba(255,255,255,0.1); backdrop-filter:blur(10px);`;

        this.levelTitleLabel = document.createElement("div");
        this.levelTitleLabel.style.cssText = `font-weight:bold; color:#4CAF50; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:5px; margin-bottom:5px;`;
        this.levelTitleLabel.innerText = "Level Editor";

        const rowActions = this.makeRow();
        this.saveServerBtn = document.createElement("button");
        this.saveServerBtn.innerText = "Save to Server";
        this.saveServerBtn.style.flex = "1";
        this.serverStatusLabel = document.createElement("div");
        this.serverStatusLabel.style.fontSize = "11px";
        this.serverStatusLabel.innerText = "Status: -";
        rowActions.appendChild(this.saveServerBtn);
        rowActions.appendChild(this.serverStatusLabel);

        const rowSettings = this.makeRow();
        rowSettings.appendChild(this.makeLabel("Diff:", 40));
        this.difficultySelect = document.createElement("select");
        this.difficultySelect.style.flex = "1";
        this.populateDifficulty(this.difficultySelect);
        rowSettings.appendChild(this.difficultySelect);

        const rowBake = this.makeRow();
        this.bakePiecesBtn = document.createElement("button");
        this.bakePiecesBtn.innerText = "Bake";
        this.bakePiecesBtn.style.flex = "1";
        this.erasePiecesBtn = document.createElement("button");
        this.erasePiecesBtn.innerText = "Erase";
        this.erasePiecesBtn.style.background = "#e67e22";
        this.erasePiecesBtn.style.color = "white";
        rowBake.appendChild(this.bakePiecesBtn);
        rowBake.appendChild(this.erasePiecesBtn);

        // Piece Editor Section
        const pieceSection = document.createElement("div");
        pieceSection.style.cssText = `border-top:1px solid rgba(255,255,255,0.1); padding-top:10px; display:flex; flex-direction:column; gap:8px;`;

        const featureSection = document.createElement("div");
        featureSection.style.cssText = `border-top:1px solid rgba(255,255,255,0.1); padding-top:10px; display:flex; flex-direction:column; gap:8px;`;

        const featureTitle = document.createElement("div");
        featureTitle.innerText = "Level Features";
        featureTitle.style.cssText = `font-size:11px; opacity:0.7; margin-bottom:4px;`;
        featureSection.appendChild(featureTitle);

        this.featureContainer = document.createElement("div");
        this.featureContainer.style.cssText = `display:flex; flex-direction:column; gap:6px;`;
        featureSection.appendChild(this.featureContainer);

        this.editorPanel.appendChild(featureSection);

        const rowMode = this.makeRow();
        this.pieceModeToggle = document.createElement("input");
        this.pieceModeToggle.type = "checkbox";
        const modeLabel = document.createElement("label");
        modeLabel.innerText = " Edit Pieces";
        modeLabel.prepend(this.pieceModeToggle);
        rowMode.appendChild(modeLabel);

        const rowAddP = this.makeRow();
        this.pieceColorSelect = document.createElement("select");
        this.pieceColorSelect.style.flex = "1";
        this.populatePieceColors(this.pieceColorSelect);
        this.addPieceBtn = document.createElement("button");
        this.addPieceBtn.innerText = "Add Piece";
        rowAddP.appendChild(this.pieceColorSelect);
        rowAddP.appendChild(this.addPieceBtn);

        this.pieceList = document.createElement("div");
        this.pieceList.style.cssText = `display:flex; flex-wrap:wrap; gap:5px; padding:8px; background:rgba(0,0,0,0.3); border-radius:8px; max-height:100px; overflow-y:auto;`;

        this.validityLabel = document.createElement("div");
        this.validityLabel.style.cssText = `font-size:11px; padding:5px; border-radius:4px; background:rgba(0,0,0,0.3);`;
        this.validityLabel.innerText = "Validity: -";

        pieceSection.appendChild(rowMode);
        pieceSection.appendChild(rowAddP);
        pieceSection.appendChild(this.pieceList);
        pieceSection.appendChild(this.validityLabel);

        this.deleteLevelBtn = document.createElement("button");
        this.deleteLevelBtn.innerText = "Delete Level";
        this.deleteLevelBtn.style.cssText = `background:#c0392b; color:white; margin-top:5px;`;

        this.editorPanel.appendChild(this.levelTitleLabel);
        this.editorPanel.appendChild(rowActions);
        this.editorPanel.appendChild(rowSettings);
        this.editorPanel.appendChild(rowBake);
        this.editorPanel.appendChild(pieceSection);
        this.editorPanel.appendChild(this.deleteLevelBtn);

        this.worldEnabledToggle = document.createElement("input");
        this.worldEnabledToggle.type = "checkbox";

        const enabledLabel = document.createElement("label");
        enabledLabel.innerText = " World Enabled";
        enabledLabel.prepend(this.worldEnabledToggle);

        this.worldBackgroundInput = document.createElement("input");
        this.worldBackgroundInput.placeholder = "Background Asset Name";

        this.root.appendChild(this.sidebar);
        this.root.appendChild(this.editorPanel);
        document.body.appendChild(this.root);

        // Inside LevelEditorDomUI.ts constructor
        this.rerollGridBtn = document.createElement("button");
        this.rerollGridBtn.innerText = "🎲 Reroll Grid";
        this.rerollGridBtn.style.flex = "1";
        // Add it to one of your rows
        rowBake.appendChild(this.rerollGridBtn);

        // In initEvents

        this.initEvents();
    }

    private initEvents() {
        this.rerollGridBtn.onclick = () => this.onRerollGrid?.();
        this.addWorldBtn.onclick = () => this.onAddWorld?.();
        this.saveServerBtn.onclick = () => this.onSaveServer?.();
        this.deleteLevelBtn.onclick = () => this.onDeleteLevel?.();
        this.bakePiecesBtn.onclick = () => this.onBakePieces?.();
        this.erasePiecesBtn.onclick = () => this.onErasePieces?.();
        this.addPieceBtn.onclick = () => {
            const selectedId = this.pieceColorSelect.value;
            this.onAddPiece?.(selectedId as any); // Type cast to any or update your onAddPiece signature
        };

        this.pieceColorSelect.onchange = () => {
            this.onSelectedPieceColorChanged?.(this.pieceColorSelect.value);
        };
        this.pieceModeToggle.onchange = () => this.onTogglePieceMode?.(this.pieceModeToggle.checked);
        this.difficultySelect.onchange = () => this.onDifficultyChanged?.(Difficulty[this.difficultySelect.value as keyof typeof Difficulty]);

    }

    public refreshAccordion(worlds: WorldData[], activeWorldId: string, activeLevelIdx: number) {
        this.worldContainer.innerHTML = "";

        let globalCounter = 1;

        worlds.forEach((world, worldIdx) => {
            const worldBox = document.createElement("div");
            const isWorldActive = world.id === activeWorldId;

            const levelStatuses = world.levels.map(l => LevelMatrixCodec.validateLevel(l).ok);
            const isWorldValid = levelStatuses.every(status => status === true);

            const header = document.createElement("div");
            header.style.cssText = `padding:10px; background:rgba(255,255,255,0.05); border-radius:6px; cursor:pointer; display:flex; justify-content:space-between; align-items:center; border: 1px solid ${isWorldActive ? '#4CAF50' : 'transparent'};`;

            // --- WORLD HEADER CONTENT ---
            const titleSpan = document.createElement("span");
            titleSpan.innerHTML = `${world.name} <span style="font-size:10px; opacity:0.6">(${world.levels.length})</span>`;
            header.appendChild(titleSpan);

            const worldBg = isWorldValid ? "rgba(76, 175, 80, 0.2)" : "rgba(244, 67, 54, 0.2)";
            const worldBorder = isWorldActive ? (isWorldValid ? "#4CAF50" : "#f44336") : "transparent";

            header.style.cssText = `padding:10px; background:${worldBg}; border-radius:6px; cursor:pointer; display:flex; justify-content:space-between; align-items:center; border: 1px solid ${worldBorder}; margin-bottom: 2px;`;
            // --- WORLD MOVE BUTTONS ---
            const worldControls = document.createElement("div");
            worldControls.style.cssText = `display:flex; gap:4px; align-items:center;`;

            const btnStyle = `background:rgba(255,255,255,0.1); border:none; color:white; cursor:pointer; padding:2px 6px; border-radius:3px; font-size:10px;`;

            const moveUp = document.createElement("button");
            moveUp.innerText = "▲";
            moveUp.style.cssText = btnStyle;
            moveUp.disabled = worldIdx === 0;
            moveUp.onclick = (e) => { e.stopPropagation(); this.onMoveWorld?.(world.id, -1); };

            const moveDown = document.createElement("button");
            moveDown.innerText = "▼";
            moveDown.style.cssText = btnStyle;
            moveDown.disabled = worldIdx === worlds.length - 1;
            moveDown.onclick = (e) => { e.stopPropagation(); this.onMoveWorld?.(world.id, 1); };

            worldControls.appendChild(moveUp);
            worldControls.appendChild(moveDown);
            header.appendChild(worldControls);

            // --- LEVEL LIST CONTAINER ---
            const levelList = document.createElement("div");
            // We force flex-direction column here to ensure vertical stacking
            levelList.style.cssText = `display: ${isWorldActive ? "flex" : "none"}; flex-direction: column; padding: 5px 0 5px 12px; gap: 4px;`;


            header.onclick = () => {
                const isHidden = levelList.style.display === "none";
                levelList.style.display = isHidden ? "flex" : "none";

                // 2. If we are opening the world, select the first level
                if (isHidden) {
                    if (world.levels && world.levels.length > 0) {
                        // Trigger the selection of index 0
                        this.onSelectLevel?.(world.id, 0);
                    }
                }

            };

            if (!world.enabled) {
                header.style.opacity = "0.5";
                header.style.background = "rgba(255,0,0,0.1)";
            }

            // --- RENDER LEVELS ---
            world.levels.forEach((lvl, idx) => {
                const itemContainer = document.createElement("div");
                itemContainer.style.cssText = `display:flex; align-items:center; gap:4px; width: 100%;`;

                const globalOrderLabel = `<span style="opacity:0.5; font-family:monospace; margin-right:5px;">#${globalCounter}</span>`;
                const item = document.createElement("div");
                const validation = LevelMatrixCodec.validateLevel(lvl);
                const isSelected = isWorldActive && idx === activeLevelIdx;

                const textColor = validation.ok ? "white" : "#ff5252";
                const itemBg = isSelected ? 'rgba(255,255,255,0.1)' : 'transparent';

                //item.style.cssText = `flex:1; padding:6px; font-size:13px; cursor:pointer; border-radius:4px; background:${isSelected ? 'rgba(76,175,80,0.3)' : 'transparent'}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
                item.style.cssText = `flex:1; padding:6px; font-size:13px; cursor:pointer; border-radius:4px; background:${itemBg}; color:${textColor}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;

                const featureCount = (lvl.features?.filter(f => f.enabled && f.id !== LevelFeature.PIECE_PLACEMENT).length || 0);
                const featureBadge = featureCount > 0 ? ` <span style="color:#64B5F6;">(${featureCount})</span>` : "";
                item.innerHTML = `[${globalOrderLabel}] - ${validation.ok ? "" : "⚠️ "}${lvl.name || `Level ${idx + 1}`}${featureBadge}`;

                // Double click to rename
                item.ondblclick = (e) => {
                    e.stopPropagation();
                    const currentName = lvl.name || `Level ${idx + 1}`;
                    const name = prompt("Rename Level:", currentName);
                    if (name !== null && name.trim() !== "" && name !== currentName) {
                        this.onRenameLevel?.(world.id, idx, name.trim());
                    }
                };

                // Add a tooltip so users know they can rename
                item.title = "Double-click to rename";
                item.onclick = (e) => {
                    e.stopPropagation();
                    this.onSelectLevel?.(world.id, idx);
                };

                const upBtn = document.createElement("button");
                upBtn.innerText = "▲";
                upBtn.style.cssText = btnStyle;
                upBtn.disabled = idx === 0;
                upBtn.onclick = (e) => {
                    e.stopPropagation();
                    this.onMoveLevel?.(world.id, idx, -1);
                };

                const downBtn = document.createElement("button");
                downBtn.innerText = "▼";
                downBtn.style.cssText = btnStyle;
                downBtn.disabled = idx === world.levels.length - 1;
                downBtn.onclick = (e) => {
                    e.stopPropagation();
                    this.onMoveLevel?.(world.id, idx, 1);
                };

                itemContainer.appendChild(item);
                itemContainer.appendChild(upBtn);
                itemContainer.appendChild(downBtn);
                levelList.appendChild(itemContainer);

                globalCounter++;
            });

            const addLvl = document.createElement("div");
            addLvl.innerText = "+ Add Level";
            addLvl.style.cssText = "padding:6px; font-size:11px; opacity:0.5; cursor:pointer; font-style:italic;";
            addLvl.onclick = (e) => { e.stopPropagation(); this.onAddLevel?.(world.id); };
            levelList.appendChild(addLvl);

            worldBox.appendChild(header);
            worldBox.appendChild(levelList);
            this.worldContainer.appendChild(worldBox);
        });
    }
    public refreshFeatureUI(features: LevelFeatureData[]) {
        this.featureContainer.innerHTML = "";

        Object.values(LevelFeature).forEach(fId => {
            const featData = features.find(f => f.id === fId) || { id: fId, enabled: false, value: "" };
            const isMandatory = fId === LevelFeature.PIECE_PLACEMENT;

            const row = document.createElement("div");
            row.style.cssText = `display:flex; align-items:center; gap:8px; font-size:12px;`;

            const chk = document.createElement("input");
            chk.type = "checkbox";
            chk.checked = isMandatory || featData.enabled;
            chk.disabled = isMandatory; // Can't untoggle PiecePlacement

            const label = document.createElement("span");
            label.innerText = fId;
            label.style.flex = "1";

            const valInput = document.createElement("input");
            valInput.placeholder = "Value";
            valInput.value = featData.value?.toString() || "";
            valInput.style.cssText = `width:60px; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); color:white; padding:2px;`;

            // Hide value field for PiecePlacement if not needed, or keep for consistency
            valInput.style.visibility = isMandatory ? "hidden" : "visible";

            const handleChange = () => {
                this.onFeatureToggle?.(fId, chk.checked, valInput.value);
            };

            chk.onchange = handleChange;
            valInput.oninput = handleChange;

            row.appendChild(chk);
            row.appendChild(label);
            row.appendChild(valInput);
            this.featureContainer.appendChild(row);
        });
    }
    public setPiecesList(pieces: { color: string | number }[], selectedIndex: number): void {
        this.pieceList.innerHTML = "";
        this.pieceItems = [];
        pieces.forEach((p, i) => {
            // We need the hex value just for the UI swatch
            const hexValue = getColorValueById(p.color);
            const el = this.createPieceItem(i, hexValue);
            this.pieceItems.push(el);
            this.pieceList.appendChild(el);
        });
        this.setSelectedPiece(selectedIndex);
    }

    public setSelectedPiece(index: number): void {
        this.pieceItems.forEach((el, i) => {
            const sel = i === index;
            el.style.outline = sel ? "2px solid white" : "1px solid rgba(255,255,255,0.2)";
            el.style.transform = sel ? "scale(1.05)" : "scale(1)";
        });
    }

    public setSelectedPieceColorDropdown(colorId: string): void {
        const options = Array.from(this.pieceColorSelect.options);
        const index = options.findIndex(o => o.value === colorId);

        if (index !== -1) {
            this.pieceColorSelect.selectedIndex = index;
            const opt = this.pieceColorSelect.options[index];
            this.pieceColorSelect.style.backgroundColor = opt.style.backgroundColor;
            this.pieceColorSelect.style.color = opt.style.color;
        }
    }

    private createPieceItem(index: number, color: number): HTMLDivElement {
        const el = document.createElement("div");
        el.style.cssText = `display:flex; align-items:center; gap:5px; padding:4px 8px; border-radius:6px; cursor:pointer; background:rgba(255,255,255,0.1); position:relative;`;

        const swatch = document.createElement("div");
        swatch.style.cssText = `width:14px; height:14px; border-radius:3px; background:#${colorToHex6(color)}`;

        const label = document.createElement("div");
        label.innerText = `P${index + 1}`;

        const delBtn = document.createElement("div");
        delBtn.innerHTML = "×";
        delBtn.style.cssText = `margin-left:5px; color:#ff5252; font-weight:bold; padding:0 2px;`;
        delBtn.onclick = (e) => {
            e.stopPropagation(); // Don't trigger 'select'
            this.onDeletePiece?.();
        };

        el.appendChild(swatch);
        el.appendChild(label);
        el.appendChild(delBtn);
        el.onclick = () => this.onSelectPiece?.(index);
        return el;
    }

    public setServerStatus(text: string, ok: boolean): void {
        this.serverStatusLabel.innerText = text;
        this.serverStatusLabel.style.color = ok ? "#a0ffb4" : "#ffb4b4";
    }

    private populateDifficulty(sel: HTMLSelectElement) {
        ["EASY", "MEDIUM", "HARD"].forEach(k => {
            const opt = document.createElement("option");
            opt.value = opt.text = k;
            sel.appendChild(opt);
        });
    }

    private populatePieceColors(sel: HTMLSelectElement): void {
        sel.innerHTML = "";
        for (const entry of PIECE_COLOR_PALETTE) {
            const opt = document.createElement("option");
            opt.value = entry.id; // Store ID "color_1"
            opt.text = entry.name.toUpperCase();

            // Use the actual hex for the UI preview
            const hex = colorToHex6(entry.value);
            opt.style.backgroundColor = `#${hex}`;
            // ... (contrast logic)
            sel.appendChild(opt);
        }
    }
    private makeRow() {
        const d = document.createElement("div");
        d.style.display = "flex"; d.style.gap = "8px"; d.style.alignItems = "center";
        return d;
    }

    private makeLabel(txt: string, w: number) {
        const d = document.createElement("div");
        d.innerText = txt; d.style.width = w + "px";
        return d;
    }

    public destroy() { this.root.remove(); }
}
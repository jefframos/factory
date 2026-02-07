import { Game } from "@core/Game";
import { GameScene } from "@core/scene/GameScene";
import PatternBackground from "@core/ui/PatternBackground";
import * as PIXI from "pixi.js";

import { ClusterManager } from "../cluster/ClusterManager";
import { HexGameMediator } from "../HexGameMediator";
import { HexGridView } from "../HexGridView";
import { ClusterData, Difficulty, HexUtils, LevelData, WorldData, WorldManifestEntry } from "../HexTypes";
import { HexHUD } from "../ui/HexHud";

import { LevelDataManager } from "../LevelDataManager";
import { LevelEditorDomUI } from "./LevelEditorDomUI";
import { LevelEditorGridView } from "./LevelEditorGridView";
import { LevelMatrixCodec } from "./LevelMatrixCodec";
import { LevelPatternGenerator } from "./LevelPatternGenerator";
import { WorldEditorDomUI } from "./WorldEditorDomUI";

type TileMode = "active" | "preview";
const STORAGE_KEY = "hex_editor_last_session";
const API_BASE = "http://localhost:3031";

export default class LevelEditorScene extends GameScene {
    private patternBackground?: PatternBackground;
    private ui?: LevelEditorDomUI;

    private gameplayContainer: PIXI.Container = new PIXI.Container();
    private editorGridView: LevelEditorGridView = new LevelEditorGridView();
    private pieceOverlay: PieceOverlayView = new PieceOverlayView();

    private clusterManager: ClusterManager = new ClusterManager();
    private mediator?: HexGameMediator;

    private levelDataJson: { worlds: WorldData[] } = { worlds: [] };
    private currentWorldId: string = "";
    private currentLevelIndex: number = 0;

    private activeTiles: Set<string> = new Set<string>();
    private previewTiles: Set<string> = new Set<string>();

    private isPieceEditMode: boolean = false;
    private workingPiecesAbs: ClusterData[] = [];
    private editingPieceIndex: number = 0;
    private editingCellsAbs: Set<string> = new Set<string>();

    private worldEditorUi?: WorldEditorDomUI;

    private readonly axialNeighbors = [
        { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
        { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }
    ];

    public build(): void {
        this.patternBackground = new PatternBackground({
            background: 0x2b2b2b,
            patternAlpha: 1,
            tileSpeedX: 0,
            tileSpeedY: 0
        });
        this.addChild(this.patternBackground);
        this.patternBackground.init();
        this.addChild(this.gameplayContainer);


        const gridLayer = new PIXI.Container();
        gridLayer.addChild(this.pieceOverlay);
        gridLayer.addChild(this.editorGridView);
        this.gameplayContainer.addChild(gridLayer);
        this.gameplayContainer.addChild(this.clusterManager);

        this.editorGridView.position.set(Game.DESIGN_WIDTH / 2, Game.DESIGN_HEIGHT * 0.30);
        this.pieceOverlay.position.copyFrom(this.editorGridView.position);

        this.mediator = new HexGameMediator(
            new PIXI.Rectangle(40, 80, Game.DESIGN_WIDTH - 80, Game.DESIGN_HEIGHT * 0.45),
            new PIXI.Rectangle(40, Game.DESIGN_HEIGHT * 0.55, Game.DESIGN_WIDTH - 80, Game.DESIGN_HEIGHT * 0.42),
            new HexGridView(),
            this.clusterManager,
            this.gameplayContainer,
            this.gameplayContainer,
            new HexHUD()
        );

        this.editorGridView.onTileToggle = (key: string, mode: TileMode) => {
            if (this.isPieceEditMode) {
                if (mode !== "active") return;
                this.editingCellsAbs.has(key) ? this.editingCellsAbs.delete(key) : this.editingCellsAbs.add(key);
                this.commitEditingCellsToWorkingPieceAbs();
                this.applyWorkingPiecesAbsToSelectedLevelLocal();
                this.refreshPieceOverlay();
                this.updateValidityLabel();
                return;
            }

            if (mode === "preview") this.activeTiles.add(key);
            else if (this.activeTiles.size > 1) this.activeTiles.delete(key);

            this.normalizeGridCoordinates();
            const lvl = this.getSelectedLevel();
            if (lvl) delete (lvl as any).pieces;

            this.applyMatrixToSelectedLevel();
            this.rebuildPreview();
            this.refreshEditorRender();
            this.refreshLivePreview();
        };

        this.setupDomUi();
        void this.loadJsonAndPopulate();
    }
    private getSelectedWorld(): WorldData | null {
        return LevelDataManager.getWorld(this.currentWorldId);
    }

    // 2. Update the helper to get the level from the DataManager
    private getSelectedLevel(): LevelData | null {
        const world = this.getSelectedWorld();
        if (!world || !world.levels) return null;
        return world.levels[this.currentLevelIndex] || null;
    }

    // 3. Fix the UI refresh to use the DataManager's world list
    private refreshUi() {
        if (!this.ui) return;

        const allWorlds = LevelDataManager.getWorlds();
        this.ui.refreshAccordion(allWorlds, this.currentWorldId, this.currentLevelIndex);

        const lvl = this.getSelectedLevel();
        const world = this.getSelectedWorld();

        if (lvl && world) {
            // BAKED vs PROCEDURAL LOGIC
            const isBaked = !!(lvl.pieces && lvl.pieces.length > 0);
            const badge = isBaked ? " [BAKED]" : " [PROCEDURAL]";

            this.ui.levelTitleLabel.innerText = `${world.name} > ${lvl.name}${badge}`;
            this.ui.levelTitleLabel.style.color = isBaked ? "#4CAF50" : "#ff9800";
        }
    }

    // 4. Fix createNewLevel to push into the DataManager's world object
    private createNewLevel(): void {
        const world = this.getSelectedWorld();
        if (!world) return;

        const lvl: LevelData = {
            id: `level_${Date.now()}`,
            name: `Level ${world.levels.length + 1}`,
            gridType: "Shape",
            matrix: LevelMatrixCodec.toMatrix(new Set([LevelMatrixCodec.key(0, 0)])),
            difficulty: Difficulty.MEDIUM
        };

        // This pushes to the array inside LevelDataManager's Map
        world.levels.push(lvl);
        this.currentLevelIndex = world.levels.length - 1;
        this.loadSelectedLevelIntoEditor();
    }

    // 5. Fix deleteSelectedLevel to use DataManager source
    private deleteSelectedLevel() {
        const world = this.getSelectedWorld();
        if (!world || world.levels.length === 0) return;

        // Note: You might need to update BackupManager to handle the new structure
        // BackupManager.createBackupAndDownload(LevelDataManager.getWorlds());

        world.levels.splice(this.currentLevelIndex, 1);
        if (world.levels.length === 0) {
            this.createNewLevel();
        } else {
            this.currentLevelIndex = Math.max(0, this.currentLevelIndex - 1);
            this.loadSelectedLevelIntoEditor();
        }
        this.refreshUi();
    }
    private setupDomUi(): void {
        this.ui = new LevelEditorDomUI();

        this.worldEditorUi = new WorldEditorDomUI(this.ui.root);

        this.worldEditorUi.onChanged = (data) => {
            if (this.currentWorldId) {
                LevelDataManager.updateWorld(this.currentWorldId, data);
                this.refreshUi(); // Refresh accordion to reflect name changes
            }
        };

        this.worldEditorUi.onDeleteWorld = () => {
            if (!this.currentWorldId) return;

            // 1. Delete from Manager
            LevelDataManager.deleteWorld(this.currentWorldId);

            // 2. Select the next available world
            const remainingWorlds = LevelDataManager.getWorlds();
            if (remainingWorlds.length > 0) {
                this.currentWorldId = remainingWorlds[0].id;
                this.currentLevelIndex = 0;
            } else {
                // If no worlds left, create a fresh one so the editor doesn't crash
                this.ui?.onAddWorld?.();
                return;
            }

            // 3. Refresh everything
            this.loadSelectedLevelIntoEditor();
            this.refreshUi();
        };
        // Inside setupDomUi() in LevelEditorScene.ts
        this.ui.onRenameLevel = (worldId, index, newName) => {
            const world = LevelDataManager.getWorld(worldId);
            if (world && world.levels[index]) {
                world.levels[index].name = newName;

                // If this is the level we are currently looking at, update the main title too
                if (this.currentWorldId === worldId && this.currentLevelIndex === index) {
                    this.refreshUi(); // This updates the sidebar and the green title label
                } else {
                    this.refreshUi();
                }
            }
        };
        this.ui.onMoveWorld = (worldId, direction) => {
            LevelDataManager.moveWorld(worldId, direction);
            this.refreshUi(); // This passes this.currentWorldId, keeping the accordion open
        };
        this.ui.onMoveLevel = (worldId, index, direction) => {
            // 1. Update the data in the manager
            const newIndex = LevelDataManager.moveLevel(worldId, index, direction);

            // 2. Update the scene's tracking state if the moved level was the active one
            if (this.currentWorldId === worldId && this.currentLevelIndex === index) {
                this.currentLevelIndex = newIndex;
            } else if (this.currentWorldId === worldId && this.currentLevelIndex === newIndex) {
                // If we moved a level into the slot of the currently active level
                this.currentLevelIndex = index;
            }

            // 3. Refresh the Sidebar and Scene
            this.refreshUi();

            // Optional: If you want the editor to follow the moved level
            // this.loadSelectedLevelIntoEditor(); 
        };
        this.ui.onAddWorld = () => {
            const id = `world_${Date.now()}`;
            const newWorld: WorldData = {
                id,
                name: "New World",
                levels: [],
                enabled: true,
                levelFile: `${id}.json`, // Server needs this to create the file
                icon: "icon_default",
                background: "bg_default",
                customData: {}
            };

            LevelDataManager.addWorld(newWorld);
            this.currentWorldId = id;
            this.currentLevelIndex = 0;
            this.createNewLevel();
            this.refreshUi();
        };
        this.ui.onRerollGrid = () => {
            this.rerollCurrentLevelPattern();
        };
        this.ui.onAddLevel = (worldId) => {
            this.currentWorldId = worldId;
            this.createNewLevel();
            this.refreshUi();
        };

        this.ui.onSelectLevel = (worldId, idx) => {
            this.currentWorldId = worldId;
            this.currentLevelIndex = idx;
            this.loadSelectedLevelIntoEditor();
            this.refreshUi();
        };

        this.ui.onSaveServer = () => void this.saveToServer();
        this.ui.onDeleteLevel = () => this.deleteSelectedLevel();
        this.ui.onDifficultyChanged = (diff) => {
            const lvl = this.getSelectedLevel();
            if (lvl) { lvl.difficulty = diff; this.refreshLivePreview(); }
        };

        this.ui.onBakePieces = () => this.bakeCurrentPreviewPiecesToLevel();
        this.ui.onErasePieces = () => this.erasePiecesFromLevel();
        this.ui.onTogglePieceMode = (en) => this.setPieceEditMode(en);
        this.ui.onAddPiece = (c) => this.addNewPieceAbs(c);
        this.ui.onSelectPiece = (i) => this.selectPieceAbs(i);
        this.ui.onSelectedPieceColorChanged = (c) => this.setSelectedPieceColorAbs(c);
    }

    private manifestData: { worlds: WorldManifestEntry[] } = { worlds: [] };
    private worldFilesMap: Record<string, any> = {};

    private async loadJsonAndPopulate(): Promise<void> {
        const response = await this.tryLoadFromServer();

        if (response && response.ok) {
            this.manifestData = response.manifest;
            this.worldFilesMap = response.worldFiles;

            console.log(this.worldFilesMap)

            // Initialize the manager with the multi-file data
            LevelDataManager.init(this.manifestData, this.worldFilesMap);
            this.ui?.setServerStatus("Server: Multi-File ON", true);
        } else {
            this.ui?.setServerStatus("Server: Connection Failed", false);
            return;
        }

        // Session Restoration
        const lastSession = localStorage.getItem(STORAGE_KEY);
        if (lastSession) {
            const { worldId, levelIndex } = JSON.parse(lastSession);
            // Check manifest for world existence
            if (this.manifestData.worlds.some(w => w.id === worldId)) {
                this.currentWorldId = worldId;
                this.currentLevelIndex = levelIndex;
            }
        }

        // Default selection
        if (!this.currentWorldId && this.manifestData.worlds.length > 0) {
            this.currentWorldId = this.manifestData.worlds[0].id;
        }

        this.loadSelectedLevelIntoEditor();
    }

    private loadSelectedLevelIntoEditor(): void {
        this.forceExitPieceEditor();
        const lvl = this.getSelectedLevel();
        const world = this.getSelectedWorld();

        if (!lvl || !world) return;

        // Populate the floating world editor with current world data
        this.worldEditorUi?.setData(world);

        this.activeTiles = LevelMatrixCodec.fromMatrix(lvl.matrix);
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            worldId: this.currentWorldId,
            levelIndex: this.currentLevelIndex
        }));

        this.rebuildPreview();
        this.refreshEditorRender();
        this.refreshLivePreview();
        this.refreshUi();
    }



    private bakeCurrentPreviewPiecesToLevel(): void {
        const lvl = this.getSelectedLevel();
        if (!lvl) return;

        const localPieces = this.clusterManager.getPieces().map(p => ({
            coords: p.data.coords.map(c => ({ q: c.q, r: c.r })),
            color: p.data.color,
            rootPos: { q: p.data.rootPos.q, r: p.data.rootPos.r }
        }));

        if (localPieces.length === 0) return;

        lvl.pieces = JSON.parse(JSON.stringify(localPieces));

        if (this.isPieceEditMode) {
            this.workingPiecesAbs = this.piecesLocalToAbs(lvl.pieces!);
            this.syncUiPieceListFromWorking();
            this.selectPieceAbs(0);
        }

        this.refreshLivePreview();
    }

    private erasePiecesFromLevel(): void {
        const lvl = this.getSelectedLevel();
        if (lvl) delete (lvl as any).pieces;
        this.forceExitPieceEditor();
        this.refreshLivePreview();
    }

    private setPieceEditMode(enabled: boolean): void {
        const lvl = this.getSelectedLevel();
        if (!lvl) return;

        this.isPieceEditMode = enabled;
        this.mediator?.setInputEnabled?.(!enabled);
        this.clusterManager.visible = !enabled;
        this.pieceOverlay.visible = enabled;

        if (!enabled) {
            this.applyWorkingPiecesAbsToSelectedLevelLocal();
            this.refreshLivePreview();
            return;
        }

        if (!lvl.pieces || lvl.pieces.length === 0) {
            this.bakeCurrentPreviewPiecesToLevel();
        }

        this.workingPiecesAbs = this.piecesLocalToAbs(lvl.pieces ?? []);
        this.editingPieceIndex = 0;
        this.syncUiPieceListFromWorking();
        this.selectPieceAbs(0);
    }

    private syncUiPieceListFromWorking(): void {
        this.ui?.setPiecesList(this.workingPiecesAbs.map(p => ({ color: p.color })), this.editingPieceIndex);
    }

    private selectPieceAbs(index: number): void {
        if (index < 0 || index >= this.workingPiecesAbs.length) return;
        this.editingPieceIndex = index;
        this.editingCellsAbs.clear();

        const p = this.workingPiecesAbs[index];
        p.coords.forEach(c => this.editingCellsAbs.add(LevelMatrixCodec.key(p.rootPos.q + c.q, p.rootPos.r + c.r)));

        this.ui?.setSelectedPiece(index);
        this.refreshPieceOverlay();
        this.updateValidityLabel();
    }

    private addNewPieceAbs(color: number): void {
        if (!this.isPieceEditMode) return;
        this.workingPiecesAbs.push({ coords: [], color, rootPos: { q: 0, r: 0 } });
        this.editingPieceIndex = this.workingPiecesAbs.length - 1;
        this.syncUiPieceListFromWorking();
        this.selectPieceAbs(this.editingPieceIndex);
    }

    private setSelectedPieceColorAbs(color: number): void {
        if (!this.isPieceEditMode || !this.workingPiecesAbs[this.editingPieceIndex]) return;
        this.workingPiecesAbs[this.editingPieceIndex].color = color;
        this.applyWorkingPiecesAbsToSelectedLevelLocal();
        this.refreshPieceOverlay();
        this.refreshLivePreview();
    }

    private commitEditingCellsToWorkingPieceAbs(): void {
        const cells = Array.from(this.editingCellsAbs).map(k => LevelMatrixCodec.parseKey(k));
        const piece = this.workingPiecesAbs[this.editingPieceIndex];
        if (!piece || cells.length === 0) return;

        const minQ = Math.min(...cells.map(c => c.q));
        const minR = Math.min(...cells.map(c => c.r));

        piece.rootPos = { q: minQ, r: minR };
        piece.coords = cells.map(c => ({ q: c.q - minQ, r: c.r - minR }));
    }

    private applyWorkingPiecesAbsToSelectedLevelLocal(): void {
        const lvl = this.getSelectedLevel();
        if (lvl && this.isPieceEditMode) {
            lvl.pieces = this.piecesAbsToLocal(this.workingPiecesAbs);
        }
    }

    private refreshPieceOverlay(): void {
        if (this.isPieceEditMode) this.pieceOverlay.setPieces(this.workingPiecesAbs, this.editingPieceIndex);
    }

    private updateValidityLabel(): void {
        if (!this.ui) return;
        const res = this.validatePiecesAbs();
        this.ui.validityLabel.innerText = `Validity: ${res.ok ? "OK" : "INVALID"} — ${res.msg}`;
        this.ui.validityLabel.style.background = res.ok ? "rgba(0,160,80,0.35)" : "rgba(200,60,60,0.35)";
    }

    private validatePiecesAbs() {
        const board = this.activeTiles;
        if (board.size === 0) return { ok: false, msg: "Empty grid." };
        const seen = new Set<string>();
        for (let i = 0; i < this.workingPiecesAbs.length; i++) {
            const p = this.workingPiecesAbs[i];
            for (const c of p.coords) {
                const k = LevelMatrixCodec.key(p.rootPos.q + c.q, p.rootPos.r + c.r);
                if (!board.has(k)) return { ok: false, msg: `P${i + 1} out of bounds.` };
                if (seen.has(k)) return { ok: false, msg: `Overlap at ${k}.` };
                seen.add(k);
            }
        }
        return seen.size === board.size ? { ok: true, msg: "All tiles covered." } : { ok: false, msg: `${seen.size}/${board.size} covered.` };
    }
    private syncGridPivots(): void {
        if (this.activeTiles.size === 0) return;

        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        this.activeTiles.forEach(key => {
            const { q, r } = LevelMatrixCodec.parseKey(key);
            const pos = HexUtils.offsetToPixel(q, r);
            minX = Math.min(minX, pos.x);
            maxX = Math.max(maxX, pos.x);
            minY = Math.min(minY, pos.y);
            maxY = Math.max(maxY, pos.y);
        });

        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;

        // Set the pivot to the center of the actual hexagons
        this.editorGridView.pivot.set(centerX, centerY);
        this.pieceOverlay.pivot.set(centerX, centerY);
    }
    private getBoardOffsetMins() {
        let minR = Infinity, minQOff = Infinity;
        this.activeTiles.forEach(k => {
            const { q, r } = LevelMatrixCodec.parseKey(k);
            const off = LevelMatrixCodec.axialToOffset(q, r);
            if (off.r < minR) minR = off.r;
            if (off.q < minQOff) minQOff = off.q;
        });
        return { minR: isFinite(minR) ? minR : 0, minQOff: isFinite(minQOff) ? minQOff : 0 };
    }

    private piecesLocalToAbs(pieces: ClusterData[]): ClusterData[] {
        const { minR, minQOff } = this.getBoardOffsetMins();
        return pieces.map(p => {
            const absCells = p.coords.map(c => {
                const localAxial = { q: p.rootPos.q + c.q, r: p.rootPos.r + c.r };
                const off = LevelMatrixCodec.axialToOffset(localAxial.q, localAxial.r);
                return LevelMatrixCodec.offsetToAxial(off.q + minQOff, off.r + minR);
            });
            return this.cellsToCluster(absCells, p.color);
        });
    }

    private piecesAbsToLocal(pieces: ClusterData[]): ClusterData[] {
        const { minR, minQOff } = this.getBoardOffsetMins();
        return pieces.map(p => {
            const localCells = p.coords.map(c => {
                const absAxial = { q: p.rootPos.q + c.q, r: p.rootPos.r + c.r };
                const off = LevelMatrixCodec.axialToOffset(absAxial.q, absAxial.r);
                return LevelMatrixCodec.offsetToAxial(off.q - minQOff, off.r - minR);
            });
            return this.cellsToCluster(localCells, p.color);
        });
    }

    private cellsToCluster(cells: { q: number, r: number }[], color: number): ClusterData {
        if (cells.length === 0) return { color, rootPos: { q: 0, r: 0 }, coords: [] };
        const minQ = Math.min(...cells.map(c => c.q)), minR = Math.min(...cells.map(c => c.r));
        return { color, rootPos: { q: minQ, r: minR }, coords: cells.map(c => ({ q: c.q - minQ, r: c.r - minR })) };
    }

    private applyMatrixToSelectedLevel() {
        const lvl = this.getSelectedLevel();
        if (lvl) lvl.matrix = LevelMatrixCodec.toMatrix(this.activeTiles);
    }

    private rebuildPreview() {
        const next = new Set<string>();
        this.activeTiles.forEach(k => {
            const { q, r } = LevelMatrixCodec.parseKey(k);
            this.axialNeighbors.forEach(n => {
                const kk = LevelMatrixCodec.key(q + n.q, r + n.r);
                if (!this.activeTiles.has(kk)) next.add(kk);
            });
        });
        this.previewTiles = next;
    }
    private refreshEditorRender() {
        this.editorGridView.setState(this.activeTiles, this.previewTiles);
        this.syncGridPivots(); // Ensure the overlay and grid stay aligned
    }
    private refreshLivePreview(): void {
        if (!this.mediator) return;

        const lvl = this.getSelectedLevel();
        const matrix = LevelMatrixCodec.toMatrix(this.activeTiles);
        const diff = lvl?.difficulty ?? Difficulty.MEDIUM;

        // If lvl.pieces is undefined, the mediator/generator will create random ones.
        // If lvl.pieces exists (is baked), the mediator will use those exact pieces.
        const piecesLocal = (lvl?.pieces && lvl.pieces.length > 0) ? lvl.pieces : undefined;

        this.mediator.startLevel(matrix, diff, piecesLocal);
        this.mediator.layout();
    }
    private forceExitPieceEditor(): void {
        this.isPieceEditMode = false;
        this.workingPiecesAbs = [];
        this.editingCellsAbs.clear();
        this.editingPieceIndex = 0;

        this.pieceOverlay.visible = false;
        this.pieceOverlay.setPieces([], -1); // Clear the graphics

        if (this.ui) {
            this.ui.pieceModeToggle.checked = false;
            this.ui.setPiecesList([], -1);
            this.ui.validityLabel.innerText = "Validity: -";
            this.ui.validityLabel.style.background = "rgba(0,0,0,0.35)";
        }

        this.clusterManager.visible = true;
        this.mediator?.setInputEnabled?.(true);
    }
    public rerollCurrentLevelPattern(): void {
        const lvl = this.getSelectedLevel();
        if (!lvl) return;

        this.erasePiecesFromLevel();

        // Generate
        const newMatrix = LevelPatternGenerator.generateRandomPattern(15);
        this.activeTiles = LevelMatrixCodec.fromMatrix(newMatrix);

        // --- NEW: Normalize immediately after generation ---
        this.normalizeGridCoordinates();

        this.applyMatrixToSelectedLevel();
        this.rebuildPreview();
        this.refreshEditorRender();
        this.refreshLivePreview();
    }
    private normalizeGridCoordinates(): void {
        if (this.activeTiles.size === 0) return;

        // 1. Find the minimum bounds in axial coordinates
        let minQ = Infinity;
        let minR = Infinity;

        this.activeTiles.forEach(key => {
            const { q, r } = LevelMatrixCodec.parseKey(key);
            if (q < minQ) minQ = q;
            if (r < minR) minR = r;
        });

        // 2. If already normalized, stop to avoid unnecessary work
        if (minQ === 0 && minR === 0) return;

        // 3. Create a new set with shifted coordinates
        const normalizedSet = new Set<string>();
        this.activeTiles.forEach(key => {
            const { q, r } = LevelMatrixCodec.parseKey(key);
            normalizedSet.add(LevelMatrixCodec.key(q - minQ, r - minR));
        });

        // 4. Update the activeTiles
        this.activeTiles = normalizedSet;

        // 5. IMPORTANT: If pieces existed, they must be shifted by the same amount 
        // to stay aligned with the new grid origin
        const lvl = this.getSelectedLevel();
        if (lvl && lvl.pieces) {
            lvl.pieces.forEach(p => {
                p.rootPos.q -= minQ;
                p.rootPos.r -= minR;
            });
        }
    }
    private async tryLoadFromServer(): Promise<any> {
        try {
            const res = await fetch(`${API_BASE}/api/load`);
            if (!res.ok) return null;
            return await res.json();
        } catch {
            return null;
        }
    }

    private async saveToServer(): Promise<void> {
        if (!this.ui) return;

        // 1. Get the source of truth from the Manager
        const worlds = LevelDataManager.getWorlds();

        // 2. Build the Manifest structure
        const manifest = {
            worlds: worlds.map(w => ({
                id: w.id,
                name: w.name,
                icon: (w as any).icon || "icon_default",
                background: (w as any).background || "bg_default",
                enabled: (w as any).enabled !== false, // default true
                levelFile: (w as any).levelFile || `${w.id}.json`,
                customData: (w as any).customData || {}
            }))
        };

        // 3. Build the individual World Files structure
        const worldsData: Record<string, any> = {};
        worlds.forEach(w => {
            w.levels.forEach(element => {
                if (!element.id) {
                    element.id = `level_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
                }
            });
            const fileName = (w as any).levelFile || `${w.id}.json`;
            worldsData[fileName] = {
                id: w.id,
                levels: w.levels // This contains the actual LevelData[]
            };
        });

        try {
            this.ui.setServerStatus("Saving...", true);

            const res = await fetch(`${API_BASE}/api/save`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ manifest, worldsData })
            });

            const result = await res.json();
            if (result.ok) {
                this.ui.setServerStatus("Saved All Files ✅", true);
            } else {
                this.ui.setServerStatus("Save Error ❌", false);
            }
        } catch (err) {
            this.ui.setServerStatus("Server Offline", false);
            console.error("Save failed:", err);
        }
    }


    public update(delta: number) {
        this.patternBackground?.update(delta);
        const centerX = Game.DESIGN_WIDTH / 2;
        const centerY = Game.DESIGN_HEIGHT / 2;

        //this.mediator?.layout();

        this.patternBackground?.position?.set(centerX, centerY);
        this.editorGridView.update(delta);

        // Force the overlay to match the grid exactly every frame if needed
        this.pieceOverlay.pivot.copyFrom(this.editorGridView.pivot);
        this.pieceOverlay.position.copyFrom(this.editorGridView.position);
    }

    public destroy() {
        this.ui?.destroy();
        this.mediator?.destroy();
        super.destroy();
    }
}

class PieceOverlayView extends PIXI.Container {
    private g: PIXI.Graphics = new PIXI.Graphics();
    constructor() { super(); this.addChild(this.g); this.eventMode = "none"; }
    public setPieces(pieces: ClusterData[], selectedIndex: number) {
        this.g.clear();
        pieces.forEach((p, i) => {
            const alpha = (i === selectedIndex) ? 0.75 : 0.25;
            p.coords.forEach(c => {
                const pos = HexUtils.offsetToPixel(p.rootPos.q + c.q, p.rootPos.r + c.r);
                this.drawHex(pos.x, pos.y, HexUtils.HEX_SIZE, p.color, alpha);
            });
        });
    }
    private drawHex(x: number, y: number, size: number, color: number, alpha: number) {
        const pts: number[] = [];
        for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 180) * (60 * i - 30);
            pts.push(x + size * Math.cos(angle), y + size * Math.sin(angle));
        }
        this.g.beginFill(color, alpha).drawPolygon(pts).endFill();
    }
}
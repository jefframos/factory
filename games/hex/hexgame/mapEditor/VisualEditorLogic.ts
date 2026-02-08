export interface VisualLayer {
    id: string;
    name: string;
    visible: boolean;
    isBelowSpline: boolean; // The new checkbox property
    opacity: number;
    images: any[];
}

export class VisualEditorLogic {
    private layers: VisualLayer[] = [];
    private selectedLayerId: string | null = null;
    private container: HTMLDivElement;

    // Fix: Add these missing callback properties
    public onSaveRequested?: (layers: VisualLayer[]) => void;
    public onLayerSelected?: (id: string) => void;
    public onLayersChanged?: (layers: VisualLayer[]) => void;
    public onImageDelete?: (layerId: string, imageId: string) => void;
    public onLayerDeleted?: (id: string) => void;
    constructor(parent: HTMLDivElement) {
        this.container = document.createElement("div");
        this.container.style.cssText = `
        position:fixed; bottom:20px; right:20px;
        background: rgba(20, 20, 20, 0.95); border-radius: 12px; padding: 12px; 
        pointer-events: auto; width: 240px; border: 1px solid rgba(255, 255, 255, 0.1); 
        backdrop-filter: blur(10px); display: flex; flex-direction: column; gap: 8px;
        max-height: 400px; overflow-y: auto;
    `;

        const header = document.createElement("div");
        header.style.cssText = `display: flex; justify-content: space-between; align-items: center;`;
        header.innerHTML = `<h4 style="margin:0">Layers</h4>`;

        const saveBtn = document.createElement("button");
        saveBtn.innerText = "💾 Save Visuals";
        saveBtn.style.cssText = `padding: 5px 10px; background: #2196F3; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 11px;`;
        saveBtn.onclick = () => this.onSaveRequested?.(this.layers);
        header.appendChild(saveBtn);

        const addBtn = document.createElement("button");
        addBtn.innerText = "➕ New Layer";
        addBtn.style.cssText = `width: 100%; padding: 8px; cursor: pointer; background: #4CAF50; color: white; border: none; border-radius: 6px; font-weight: bold;`;
        if (addBtn) {
            addBtn.onclick = () => {
                this.addLayer(); // Call the internal function
                this.onLayersChanged?.(this.layers); // Notify scene to create PIXI container
            };
        }

        this.container.append(header, addBtn);
        parent.appendChild(this.container);


    }


    private deleteLayer(index: number) {
        const layer = this.layers[index];
        if (!confirm(`Are you sure you want to delete "${layer.name}" and all its images?`)) return;

        const deletedId = layer.id;
        this.layers.splice(index, 1);

        // If the deleted layer was selected, select the next available one
        if (this.selectedLayerId === deletedId) {
            this.selectedLayerId = this.layers.length > 0 ? this.layers[this.layers.length - 1].id : null;
            if (this.selectedLayerId) this.onLayerSelected?.(this.selectedLayerId);
        }

        this.renderLayers();

        // Notify the scene to clean up PIXI objects
        this.onLayerDeleted?.(deletedId);
        this.onLayersChanged?.(this.layers);
    }
    private addLayer() {
        const layer: VisualLayer = {
            id: `layer_${Date.now()}`,
            name: `Layer ${this.layers.length + 1}`,
            visible: true,
            isBelowSpline: false,
            opacity: 1,
            images: []
        };
        this.layers.push(layer);
        this.selectedLayerId = layer.id;

        this.renderLayers();

        // CRITICAL: Notify scene immediately so the Controller can create the PIXI container
        this.onLayersChanged?.(this.layers);
        this.onLayerSelected?.(layer.id);
    }

    private moveLayer(index: number, direction: number) {
        const newIndex = index + direction;
        if (newIndex < 0 || newIndex >= this.layers.length) return;
        const [element] = this.layers.splice(index, 1);
        this.layers.splice(newIndex, 0, element);
        this.renderLayers();
    }

    private toggleVisibility(index: number) {
        this.layers[index].visible = !this.layers[index].visible;
        this.renderLayers();
    }

    private renderLayers() {
        const existing = this.container.querySelectorAll('.layer-item');
        existing.forEach(el => el.remove());

        // We render the array in REVERSE so that the "Top" layer in the list 
        // is the one at the end of the array (rendered last/on top).
        [...this.layers].reverse().forEach((layer, revIdx) => {
            const actualIdx = this.layers.length - 1 - revIdx;

            const div = document.createElement("div");
            div.className = "layer-item";
            div.dataset.id = layer.id;

            const isSelected = this.selectedLayerId === layer.id;
            div.style.cssText = `
            background: ${isSelected ? 'rgba(33, 150, 243, 0.15)' : 'rgba(255,255,255,0.03)'};
            border: 1px solid ${isSelected ? '#2196F3' : 'rgba(255,255,255,0.1)'};
            border-radius: 8px; padding: 10px; margin-bottom: 8px; pointer-events: auto;
            display: flex; flex-direction: column; gap: 8px;
        `;

            // --- ROW 1: HEADER (Visibility, Name, Move Controls) ---
            const header = document.createElement("div");
            header.style.cssText = `display:flex; align-items:center; gap:8px;`;

            // Visibility Toggle
            const visBtn = document.createElement("button");
            visBtn.innerText = layer.visible ? "👁️" : "👓";
            visBtn.style.cssText = `background:none; border:none; cursor:pointer; font-size:14px; padding:0; opacity:${layer.visible ? '1' : '0.4'}`;
            visBtn.onclick = (e) => {
                e.stopPropagation();
                this.toggleVisibility(actualIdx);
                this.onLayersChanged?.(this.layers);
            };

            // Layer Name (Clicking this selects the layer)
            const nameSpan = document.createElement("span");
            nameSpan.innerText = layer.name;
            nameSpan.style.cssText = `flex:1; font-weight:bold; cursor:pointer; font-size:12px;`;
            nameSpan.onclick = () => {
                this.selectedLayerId = layer.id;
                this.onLayerSelected?.(layer.id);
                this.renderLayers();
            };

            // Move Controls
            const moveControls = document.createElement("div");
            moveControls.style.cssText = `display:flex; gap:2px;`;
            const upBtn = this.createSmallBtn("▲", () => { this.moveLayer(actualIdx, 1); this.onLayersChanged?.(this.layers); });
            const dnBtn = this.createSmallBtn("▼", () => { this.moveLayer(actualIdx, -1); this.onLayersChanged?.(this.layers); });
            moveControls.append(upBtn, dnBtn);

            header.append(visBtn, nameSpan, moveControls);

            // --- ROW 2: DEPTH SETTINGS ---
            const depthRow = document.createElement("div");
            depthRow.style.cssText = `display:flex; align-items:center; justify-content:space-between; font-size:10px; color:#aaa;`;

            const depthLabel = document.createElement("label");
            depthLabel.style.cssText = `display:flex; align-items:center; gap:4px; cursor:pointer;`;
            depthLabel.innerHTML = `<input type="checkbox" ${layer.isBelowSpline ? 'checked' : ''}> Below Spline`;
            const depthCheck = depthLabel.querySelector('input')!;

            depthCheck.onchange = () => {
                layer.isBelowSpline = depthCheck.checked;
                this.onLayersChanged?.(this.layers);
                this.renderLayers();
            };
            const delLayerBtn = document.createElement("button");
            delLayerBtn.innerText = "🗑️";
            delLayerBtn.style.cssText = `background:none; border:none; cursor:pointer; font-size:12px; margin-left:5px; filter:grayscale(1);`;
            delLayerBtn.onmouseenter = () => delLayerBtn.style.filter = "none";
            delLayerBtn.onmouseleave = () => delLayerBtn.style.filter = "grayscale(1)";
            delLayerBtn.onclick = (e) => {
                e.stopPropagation();
                this.deleteLayer(actualIdx);
            };
            moveControls.appendChild(delLayerBtn);
            depthRow.appendChild(depthLabel);

            // --- ROW 3: NESTED IMAGE LIST ---
            const imgList = document.createElement("div");
            imgList.style.cssText = `
            background: rgba(0,0,0,0.2); border-radius: 4px; 
            max-height: 100px; overflow-y: auto; padding: 4px;
        `;

            if (layer.images.length === 0) {
                imgList.innerHTML = `<div style="font-size:9px; color:#666; font-style:italic; text-align:center;">No images</div>`;
            }

            layer.images.forEach(img => {
                const row = document.createElement("div");
                row.style.cssText = `display:flex; align-items:center; gap:5px; font-size:10px; padding:3px; border-bottom:1px solid rgba(255,255,255,0.03);`;

                const thumb = document.createElement("img");
                thumb.src = img.url;
                thumb.style.cssText = `width:16px; height:16px; object-fit:contain;`;

                const imgName = document.createElement("span");
                imgName.innerText = img.url.split('/').pop() || "img";
                imgName.style.cssText = `flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;`;

                const del = document.createElement("button");
                del.innerText = "×";
                del.style.cssText = `background:none; border:none; color:#ff4c4c; cursor:pointer; font-weight:bold; font-size:12px; padding:0 4px;`;
                del.onclick = (e) => {
                    e.stopPropagation();
                    this.onImageDelete?.(layer.id, img.id);
                    this.renderLayers();
                };

                row.append(thumb, imgName, del);
                imgList.appendChild(row);
            });

            div.append(header, depthRow, imgList);
            this.container.appendChild(div);
        });
    }

    public setData(layers: VisualLayer[]) {
        this.layers = layers || [];
        if (this.layers.length > 0 && !this.selectedLayerId) {
            this.selectedLayerId = this.layers[0].id;
            this.onLayerSelected?.(this.selectedLayerId);
        }
        this.renderLayers();
    }

    private createSmallBtn(text: string, cb: () => void) {
        const b = document.createElement("button");
        b.innerText = text;
        b.style.cssText = `background: #333; color: white; border: 1px solid #444; border-radius: 3px; cursor: pointer; padding: 2px 4px; font-size: 10px;`;
        b.onclick = cb;
        return b;
    }
}
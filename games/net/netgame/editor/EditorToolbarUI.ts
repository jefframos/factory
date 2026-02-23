const TOOL_STYLES = {
    BAR: `
        position: absolute; 
        top: 90px; 
        left: 310px; 
        background: rgba(25, 25, 25, 0.9); 
        padding: 8px; 
        border-radius: 10px; 
        display: flex; 
        gap: 8px; 
        pointer-events: auto; 
        border: 1px solid rgba(255, 255, 255, 0.15);
        backdrop-filter: blur(10px);
        box-shadow: 0 4px 15px rgba(0,0,0,0.4);
    `,
    BTN: `
        background: #34495e; 
        color: white; 
        border: none; 
        padding: 8px 12px; 
        border-radius: 6px; 
        cursor: pointer; 
        font-size: 11px; 
        font-weight: bold; 
        transition: all 0.2s;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
    `
};

export type EditorObjectType = 'box' | 'circle' | 'polygon' | 'sensor';

export class EditorToolbarUI {
    public root: HTMLDivElement;
    public onAddObject?: (type: EditorObjectType) => void;

    constructor(parent: HTMLElement) {
        this.root = document.createElement("div");
        this.root.style.cssText = TOOL_STYLES.BAR;

        this.createTool('box', 'Rect');
        this.createTool('circle', 'Circ');
        this.createTool('polygon', 'Poly');
        this.createTool('sensor', 'Sens');

        parent.appendChild(this.root);
    }

    private createTool(type: EditorObjectType, label: string) {
        const btn = document.createElement("button");
        btn.style.cssText = TOOL_STYLES.BTN;
        btn.innerHTML = `<span>${label}</span>`;

        btn.onmouseenter = () => btn.style.background = "#3498db";
        btn.onmouseleave = () => btn.style.background = "#34495e";
        btn.onclick = () => this.onAddObject?.(type);

        this.root.appendChild(btn);
    }

    public destroy() {
        this.root.remove();
    }
}
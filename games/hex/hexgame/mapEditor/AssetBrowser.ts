export class AssetBrowser {
    private container: HTMLDivElement;
    public onDragImage?: (url: string, x: number, y: number) => void;

    constructor() {
        this.container = document.createElement("div");
        this.container.style.cssText = `
        position:absolute; left:12px; top:60px; bottom:12px; width:240px;
        background:rgba(20,20,20,0.9); border-radius:12px; padding:10px;
        pointer-events:auto; overflow-y:auto; border:1px solid rgba(255,255,255,0.1);
        backdrop-filter:blur(10px); color:white; display:flex; flex-direction:column; gap:8px;
    `;
        document.body.appendChild(this.container);
        this.loadAssets();
    }

    private renderTree(nodes: any[], parent: HTMLElement) {
        nodes.forEach(node => {
            if (node.type === "directory") {
                const folder = document.createElement("details");
                folder.style.marginBottom = "4px";
                folder.innerHTML = `<summary style="cursor:pointer; padding:6px; background:rgba(255,255,255,0.05); border-radius:4px;">📁 ${node.name}</summary>`;
                const content = document.createElement("div");
                content.style.paddingLeft = "12px";
                this.renderTree(node.children, content);
                folder.appendChild(content);
                parent.appendChild(folder);
            } else {
                const item = document.createElement("div");
                item.style.cssText = `
                display:flex; align-items:center; gap:8px; padding:6px; cursor:grab; 
                background:rgba(255,255,255,0.03); border-radius:4px; margin-top:2px;
            `;

                // Thumbnail Preview
                const img = document.createElement("img");
                img.src = node.url;
                img.style.cssText = `width:32px; height:32px; object-fit:contain; background:#000; border-radius:2px;`;

                const name = document.createElement("span");
                name.innerText = node.name;
                name.style.fontSize = "11px";

                item.append(img, name);
                item.draggable = true;
                item.ondragstart = (e) => {
                    e.dataTransfer?.setData("text/plain", node.url);
                    // Visual feedback for drag
                    const dragIcon = document.createElement('img');
                    dragIcon.src = node.url;
                    dragIcon.style.width = "64px";
                    e.dataTransfer?.setDragImage(dragIcon, 32, 32);
                };
                parent.appendChild(item);
            }
        });
    }

    private async loadAssets() {
        const res = await fetch("http://localhost:3031/api/assets");
        const data = await res.json();
        if (data.ok) this.renderTree(data.tree, this.container);
    }
    public setVisible(show: boolean) {
        this.container.style.display = show ? "block" : "none";
    }
}